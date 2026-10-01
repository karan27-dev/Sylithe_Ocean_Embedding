"""Finale upgrades: the experiments that close the remaining gaps, each one resumable and each writing a JSON
result that the console's Research page and the paper read.

    python -m oceanembed.upgrades all --data /workspace/data --root /workspace/OceanEmbed

  calibrate   σ: per-depth scale fitted on 2022 Argo so ±1σ covers 68 %; checked on 2023    (~20 min GPU)
  cyclones    every 2023 North Indian Ocean cyclone (IBTrACS): TCHP along the tracks vs GLORYS12, and
              whether the Ocean Cyclone Potential Index is higher before rapid intensification  (~10 min)
  gridded     monthly 2023 against gridded Argo (INCOIS LAS file in <data>/gridded_argo/, else the
              Roemmich–Gilson Argo product is downloaded), with GLORYS12 and HYCOM on the same grid  (~10 min)
  thermo      thermocline: fine-tune the 3 members with a depth-weighted loss (75–150 m), compare 2023  (~2 h)
  ablate      ablations at equal budget: −SSL pretraining, −temporal attention, −vertical-gradient loss,
              7-day window; plus a linear probe of the frozen embedding (SSL vs random encoder)  (~5 h)
  nrt         near-real-time gap: build 2022-07…2023 NRT inputs, score the model on NRT 2023, fine-tune on
              NRT 2022 H2, score again; packages the best models for the live system  (~3 h, needs CMEMS login)
  report      gathers everything into <root>/upgrades/upgrades.json (copy to web/public/data/)

Budgets (minutes of training per run) come from --minutes; every step skips work already on disk.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import shutil
import time
import urllib.request

import numpy as np
import pandas as pd
import xarray as xr

from . import argo as A
from . import config as C
from . import dataset as D
from . import infer as I
from . import train as TR

BANDS = {"0–1000 m": (0, 1000), "0–200 m": (0, 200), "75–150 m": (75, 150), "200–1000 m": (201, 1000)}
IBTRACS = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.NI.list.v04r01.csv"
RG = "https://sio-argo.ucsd.edu/RG/"


def _r(v, d=3):
    return None if v is None or not np.isfinite(v) else round(float(v), d)


class Up:
    def __init__(self, a):
        self.a = a
        self.data, self.root = a.data, a.root
        self.out = os.path.join(self.root, "upgrades")
        os.makedirs(self.out, exist_ok=True)
        self.inputs = os.path.join(self.data, "inputs.zarr")
        self.target = os.path.join(self.data, "target.zarr")
        self.S = D.load_stats(os.path.join(self.root, "stats_v2.npz"))
        self.ck = os.path.join(self.root, "checkpoints", f"oceanembed_w{a.window}")
        self._prof = {}

    # ---------------------------------------------------------------- helpers
    def log(self, msg):
        print(f"{time.strftime('%H:%M:%S')}  {msg}", flush=True)

    def path(self, name):
        return os.path.join(self.out, name)

    def done(self, name):
        if os.path.exists(self.path(name)) and not self.a.force:
            self.log(f"{name} exists, skipped (use --force to redo)")
            return True
        return False

    def save(self, name, obj):
        with open(self.path(name), "w") as f:
            json.dump(obj, f, indent=1, default=lambda o: None)
        self.log(f"wrote {self.path(name)}")

    def members(self, ck_dir=None):
        return [TR.load_model(p)[0] for p in TR.seed_checkpoints(ck_dir or self.ck)]

    def base_rec(self):
        nc = os.path.join(self.root, "OceanEmbed_NIO_T_2023.nc")
        if os.path.exists(nc):
            return xr.open_dataset(nc)
        rec = I.reconstruct(self.members(), self.inputs, self.S, *C.TEST, window=self.a.window)
        rec.to_netcdf(nc)
        return rec

    def argo(self, year):
        if year in self._prof:
            return self._prof[year]
        p = os.path.join(self.data, f"argo_{year}.parquet")
        if not os.path.exists(p):
            self.log(f"fetching Argo {year} from ERDDAP")
            A.fetch_profiles(f"{year}-01-01", f"{year}-12-31", log=self.log).to_parquet(p)
        self._prof[year] = pd.read_parquet(p)
        return self._prof[year]

    def glorys(self, period=C.TEST):
        return xr.open_zarr(self.target).thetao.sel(time=slice(*period))

    def depth_rmse_field(self, pred, ref):
        """Per-depth RMSE of a daily field against a reference, accumulated day by day."""
        ref = ref.sel(time=pred.time)
        se, n = np.zeros(len(C.DEPTHS)), np.zeros(len(C.DEPTHS))
        for i in range(pred.sizes["time"]):
            e = pred.isel(time=i).values.astype("f8") - ref.isel(time=i).values.astype("f8")
            ok = np.isfinite(e)
            se += np.where(ok, e * e, 0).sum((1, 2)); n += ok.sum((1, 2))
        return np.sqrt(se / np.maximum(n, 1))

    def summary(self, field, name, depth_table=True):
        """RMSE vs GLORYS12 (per band) and vs Argo 2023 (per band + per depth) for a 2023 field."""
        out = {"name": name}
        g = self.depth_rmse_field(field, self.glorys())
        m = A.match(self.argo(2023), field, "p")
        for band, (z0, z1) in BANDS.items():
            ks = [k for k, d in enumerate(C.DEPTHS) if z0 <= d <= z1]
            out[f"glorys {band}"] = _r(np.sqrt(np.mean(g[ks] ** 2)))
            cols = [d for d in C.DEPTHS if z0 <= d <= z1]
            e = (m[[f"p_T{d}" for d in cols]].values - m[[f"T{d}" for d in cols]].values).ravel()
            e = e[np.isfinite(e)]
            out[f"argo {band}"] = _r(np.sqrt(np.mean(e ** 2))) if e.size else None
        if depth_table:
            out["glorys_by_depth"] = [_r(v) for v in g]
            out["argo_by_depth"] = [_r(r.get("rmse")) for r in A.score(m, "p").to_dict("records")]
        return out

    def finetune(self, src_ck, dst_ck, extra=None, inputs=None, train=None, val=None, minutes=None, lr=5e-5):
        """Continue training each seed from src_ck into dst_ck (own optimiser, low LR, cosine over the budget)."""
        for p in TR.seed_checkpoints(src_ck):
            seed = os.path.basename(os.path.dirname(p))
            net, cfg = TR.load_model(p)
            cfg = C.TrainConfig(**{**cfg.__dict__, "lr": lr, "extra": {**(cfg.extra or {}), **(extra or {})},
                                   "num_workers": self.a.workers, "batch_size": self.a.batch})
            ds = lambda per, tr: D.SurfaceWindows(inputs or self.inputs, self.target, self.S, per, cfg.window, train=tr,
                                                  var_dropout=cfg.var_dropout if tr else 0,
                                                  crop=(cfg.crop_h, cfg.crop_w) if tr else None)
            self.log(f"fine-tune {seed} → {dst_ck}")
            TR.fit(net, ds(train or C.TRAIN, True), ds(val or C.VAL, False), cfg, "glorys", os.path.join(dst_ck, seed),
                   epochs=40, depth_std=self.S["depth_std"], max_minutes=minutes or self.a.minutes, log=self.log)

    # ---------------------------------------------------------------- 1 · σ calibration
    def calibrate(self):
        if self.done("calibration.json"):
            return
        members = self.members()
        self.log("reconstructing 2022 (validation year) for the σ fit")
        rec22 = I.reconstruct(members, self.inputs, self.S, *C.VAL, window=self.a.window)
        p22 = self.argo(2022)
        m = A.match(A.match(p22, rec22.thetao, "p"), rec22.thetao_sigma, "s")
        scale = []
        for d in C.DEPTHS:
            z = np.abs(m[f"p_T{d}"] - m[f"T{d}"]) / m[f"s_T{d}"]
            z = z[np.isfinite(z)]
            scale.append(float(np.quantile(z, 0.6827)) if z.size >= 30 else np.nan)
        glob_s = float(np.nanmedian(scale))
        scale = [s if np.isfinite(s) else glob_s for s in scale]
        rec = self.base_rec()
        m23 = A.match(A.match(self.argo(2023), rec.thetao, "p"), rec.thetao_sigma, "s")

        def cover(k_sig, sc):
            hit = n = 0
            per = []
            for d, s in zip(C.DEPTHS, sc):
                e = np.abs(m23[f"p_T{d}"] - m23[f"T{d}"]); sg = m23[f"s_T{d}"] * s * k_sig
                ok = np.isfinite(e) & np.isfinite(sg)
                per.append(_r((e[ok] <= sg[ok]).mean() * 100, 1) if ok.any() else None)
                hit += int((e[ok] <= sg[ok]).sum()); n += int(ok.sum())
            return _r(100 * hit / max(n, 1), 1), per
        ones = [1.0] * len(C.DEPTHS)
        b1, b1d = cover(1, ones); a1, a1d = cover(1, scale)
        b2, _ = cover(2, ones); a2, _ = cover(2, scale)
        json.dump({"scale": [round(s, 4) for s in scale], "fitted_on": "Argo 2022 (validation year)",
                   "target": "68.27 % of errors inside ±1σ"}, open(self.path("sigma_scale.json"), "w"), indent=1)
        self.save("calibration.json", {
            "title": "Uncertainty calibration", "fitted_on": "2022 Argo", "tested_on": "2023 Argo (never used for fitting)",
            "inside_1sigma_before": b1, "inside_1sigma_after": a1, "inside_2sigma_before": b2, "inside_2sigma_after": a2,
            "ideal_1sigma": 68.3, "ideal_2sigma": 95.4, "scale_by_depth": [round(s, 3) for s in scale],
            "by_depth_before": b1d, "by_depth_after": a1d})

    # ---------------------------------------------------------------- 2 · cyclones along IBTrACS tracks
    def cyclones(self):
        if self.done("cyclones.json"):
            return
        from . import bulletin as Bu
        p = os.path.join(self.data, "ibtracs_NI.csv")
        if not os.path.exists(p):
            self.log("downloading IBTrACS (North Indian Ocean)")
            urllib.request.urlretrieve(IBTRACS, p)
        tr = pd.read_csv(p, skiprows=[1], low_memory=False)
        tr["t"] = pd.to_datetime(tr["ISO_TIME"])
        tr = tr[(tr.t >= C.TEST[0]) & (tr.t <= f"{C.TEST[1]} 23:59")]
        tr["wind"] = pd.to_numeric(tr["USA_WIND"], errors="coerce").fillna(pd.to_numeric(tr["WMO_WIND"], errors="coerce"))
        tr["lat"], tr["lon"] = pd.to_numeric(tr["LAT"]), pd.to_numeric(tr["LON"])
        tr = tr[tr.lat.between(C.LAT_MIN, C.LAT_MAX) & tr.lon.between(C.LON_MIN, C.LON_MAX) & tr.wind.notna()]
        tr = tr[tr.t.dt.hour.isin([0, 6, 12, 18])].copy()
        later = tr[["SID", "t", "wind"]].assign(t=lambda d: d.t - pd.Timedelta(hours=24)).rename(columns={"wind": "w24"})
        tr = tr.merge(later, on=["SID", "t"], how="left")
        tr["dw24"] = tr.w24 - tr.wind
        rec, G, inp = self.base_rec().thetao, self.glorys(), xr.open_zarr(self.inputs)
        rows = []
        for _, r in tr.iterrows():
            day = (r.t - pd.Timedelta(days=1)).normalize()                # the ocean the storm is about to meet
            if day < pd.Timestamp(C.TEST[0]):
                continue
            iy, ix = int(round((r.lat - C.LAT_MIN) / C.RES)), int(round((r.lon - C.LON_MIN) / C.RES))
            ours = rec.sel(time=day).values[:, iy, ix][:, None].astype("f8")
            ref = G.sel(time=day).values[:, iy, ix][:, None].astype("f8")
            if not np.isfinite(ours[0, 0]) or not np.isfinite(ref[0, 0]):
                continue
            iv = {k: np.array([float(inp[k].sel(time=day).values[iy, ix])]) for k in ("sst", "sss", "sla")}
            x = {"t0": ours[0], "t100": Bu._t100(ours), "tchp": Bu._tchp(ours), "d26": Bu._isotherm(ours, 26),
                 "mld": Bu._mld(ours), **iv}
            rows.append({"storm": str(r.get("NAME", "")).title(), "sid": r.SID, "t": str(r.t), "wind": r.wind, "dw24": r.dw24,
                         "tchp": float(Bu._tchp(ours)[0]), "tchp_glorys": float(Bu._tchp(ref)[0]),
                         "ocpi": float(Bu.ocpi(x)[0][0])})
        df = pd.DataFrame(rows)
        if df.empty:
            self.save("cyclones.json", {"title": "Cyclones 2023", "note": "no track point inside the domain"}); return
        e = df.tchp - df.tchp_glorys
        ri = df[df.dw24 >= 30]; non = df[df.dw24.notna() & (df.dw24 < 30)]
        auc = None
        if len(ri) and len(non):                                   # P(OCPI before RI > OCPI before non-RI)
            a, b = ri.ocpi.values[:, None], non.ocpi.values[None, :]
            auc = _r(((a > b).mean() + 0.5 * (a == b).mean()), 3)
        storms = [{"storm": s, "points": len(g), "max_wind_kt": int(g.wind.max()),
                   "tchp_mean": _r(g.tchp.mean(), 1), "tchp_glorys_mean": _r(g.tchp_glorys.mean(), 1),
                   "ocpi_mean": _r(g.ocpi.mean(), 2), "ri_points": int((g.dw24 >= 30).sum())}
                  for s, g in df.groupby("storm")]
        self.save("cyclones.json", {
            "title": "2023 cyclones along their IBTrACS tracks", "track_points": len(df), "storms": storms,
            "tchp_rmse_vs_glorys": _r(np.sqrt((e ** 2).mean()), 1), "tchp_bias_vs_glorys": _r(e.mean(), 1),
            "tchp_r_vs_glorys": _r(np.corrcoef(df.tchp, df.tchp_glorys)[0, 1], 3),
            "ri_points": len(ri), "ocpi_mean_before_ri": _r(ri.ocpi.mean(), 3) if len(ri) else None,
            "ocpi_mean_otherwise": _r(non.ocpi.mean(), 3) if len(non) else None, "ocpi_auc_ri": auc,
            "note": "Ocean sampled the day before each 6-hourly track point; rapid intensification = +30 kt in 24 h.",
            "points": [{"storm": r.storm, "t": r.t, "wind": r.wind, "dw24": _r(r.dw24, 0), "tchp": _r(r.tchp, 1),
                        "tchp_glorys": _r(r.tchp_glorys, 1), "ocpi": _r(r.ocpi, 3)} for r in df.itertuples()]})

    # ---------------------------------------------------------------- 3 · gridded Argo (INCOIS LAS or Roemmich–Gilson)
    def _gridded_files(self):
        d = os.path.join(self.data, "gridded_argo")
        os.makedirs(d, exist_ok=True)
        files = sorted(glob.glob(os.path.join(d, "*.nc")))
        if files:
            return "INCOIS / user-supplied gridded Argo", files
        self.log("no INCOIS file in data/gridded_argo/: downloading the Roemmich–Gilson Argo product for 2023")
        names = ["RG_ArgoClim_Temperature_2019.nc.gz"] + [f"RG_ArgoClim_2023{m:02d}_2019.nc.gz" for m in range(1, 13)]
        import gzip
        got = []
        for n in names:
            dst = os.path.join(d, n[:-3])
            if not os.path.exists(dst):
                try:
                    urllib.request.urlretrieve(RG + n, dst + ".gz")
                    with gzip.open(dst + ".gz") as fi, open(dst, "wb") as fo:
                        shutil.copyfileobj(fi, fo)
                    os.remove(dst + ".gz")
                except Exception as e:
                    self.log(f"  {n}: {e!r}")
                    continue
            got.append(dst)
        return "Roemmich–Gilson Argo (SIO)", got

    @staticmethod
    def _std(da):
        ren = {}
        for c in da.dims:
            lc = c.lower()
            if lc.startswith("lat"): ren[c] = "lat"
            elif lc.startswith("lon"): ren[c] = "lon"
            elif lc in ("depth", "pressure", "lev", "level", "z", "deptht", "depth_std"): ren[c] = "depth"
            elif lc.startswith("time") or lc == "t": ren[c] = "time"
        return da.rename(ren)

    def _read_gridded(self, files):
        """→ DataArray (month, depth, lat, lon) for 2023 on the product's own grid, lon in 0–360."""
        rg_base = [f for f in files if "Temperature_2019" in f]
        if rg_base:                                              # Roemmich–Gilson: mean + monthly anomaly
            base = xr.open_dataset(rg_base[0], decode_times=False)
            mean = self._std(base["ARGO_TEMPERATURE_MEAN"])
            months = []
            for f in sorted(x for x in files if x not in rg_base):
                ds = xr.open_dataset(f, decode_times=False)
                an = self._std(ds["ARGO_TEMPERATURE_ANOMALY"]).squeeze(drop=True)
                months.append((mean + an).expand_dims(month=[pd.Timestamp(f"2023-{int(os.path.basename(f)[16:18]):02d}-01")]))
            return xr.concat(months, "month")
        ds = xr.open_mfdataset(files, combine="by_coords") if len(files) > 1 else xr.open_dataset(files[0])
        var = next(v for v in ds.data_vars if any(k in v.lower() for k in ("temp", "thetao", "t_an", "tem")))
        da = self._std(ds[var])
        da = da.sel(time=slice("2023-01-01", "2023-12-31")) if "time" in da.dims else da
        da = da.rename({"time": "month"})
        da["month"] = pd.DatetimeIndex(da.month.values).to_period("M").to_timestamp()
        return da

    def gridded(self):
        if self.done("gridded_argo.json"):
            return
        source, files = self._gridded_files()
        if not files:
            self.save("gridded_argo.json", {"title": "Gridded Argo", "note": "no gridded Argo file available"}); return
        obs = self._read_gridded(files)
        obs = obs.assign_coords(lon=(obs.lon % 360)).sortby("lon")
        obs = obs.sel(lat=slice(C.LAT_MIN, C.LAT_MAX), lon=slice(C.LON_MIN, C.LON_MAX))
        obs = obs.transpose("month", "depth", "lat", "lon").interp(depth=np.array(C.DEPTHS, float)).load()
        alat, alon = obs.lat.values, obs.lon.values
        k = max(1, int(round(float(np.median(np.diff(alat))) / C.RES)))   # area-average to the product's cell size

        def monthly(field):
            mm = field.resample(time="MS").mean().rename({"time": "month"})
            mm = mm.rolling(lat=k, lon=k, center=True, min_periods=max(1, k * k // 2)).mean()
            return mm.interp(lat=alat, lon=alon).load()
        prods = {"Sylithe Ocean Model": self.base_rec().thetao, "GLORYS12": self.glorys()}
        hy = os.path.join(self.data, "hycom.zarr")
        if os.path.exists(hy):
            prods["HYCOM GOFS 3.1"] = xr.open_zarr(hy).thetao.sel(time=slice(*C.TEST))
        lat2 = np.broadcast_to(alat[:, None], (len(alat), len(alon)))
        lon2 = np.broadcast_to(alon[None, :], (len(alat), len(alon)))
        reg = {"North Indian Ocean": np.ones_like(lat2, bool)}
        for key, nm in (("BoB", "Bay of Bengal"), ("AS", "Arabian Sea")):
            r = C.REGIONS[key]
            reg[nm] = (lat2 >= r["lat"][0]) & (lat2 <= r["lat"][1]) & (lon2 >= r["lon"][0]) & (lon2 <= r["lon"][1])
        rows = []
        for name, f in prods.items():
            mm = monthly(f)
            common = np.intersect1d(mm.month.values, obs.month.values)
            P, O = mm.sel(month=common).values, obs.sel(month=common).values       # (m, depth, lat, lon)
            row = {"product": name, "months": len(common)}
            for band, (z0, z1) in BANDS.items():
                ks = [i for i, d in enumerate(C.DEPTHS) if z0 <= d <= z1]
                e = (P[:, ks] - O[:, ks]).ravel(); e = e[np.isfinite(e)]
                row[band] = _r(np.sqrt(np.mean(e ** 2))) if e.size else None
            for rn, msk in reg.items():
                if rn == "North Indian Ocean":
                    continue
                e = (P - O)[..., msk].ravel(); e = e[np.isfinite(e)]
                row[rn] = _r(np.sqrt(np.mean(e ** 2))) if e.size else None
            e = (P - O).ravel(); ok = np.isfinite(e)
            row["bias"] = _r(e[ok].mean())
            row["r"] = _r(np.corrcoef(P.ravel()[ok], O.ravel()[ok])[0, 1])
            row["by_depth"] = [_r(np.sqrt(np.nanmean((P[:, i] - O[:, i]) ** 2))) for i in range(len(C.DEPTHS))]
            rows.append(row)
        self.save("gridded_argo.json", {"title": "2023 monthly fields against gridded Argo", "source": source,
                                        "grid": f"{float(np.median(np.diff(alat))):.2f}°", "rows": rows,
                                        "note": "Monthly means, area-averaged to the gridded product's cells, at the 15 standard depths."})

    # ---------------------------------------------------------------- 4 · thermocline (depth-weighted fine-tune)
    def thermo(self):
        if self.done("thermocline.json"):
            return
        dst = self.ck + "_dw"
        self.finetune(self.ck, dst, extra={"depth_weight": self.a.depth_weight})
        base = self.summary(self.base_rec().thetao, "Sylithe Ocean Model (current)")
        rec = I.reconstruct(self.members(dst), self.inputs, self.S, *C.TEST, window=self.a.window)
        new = self.summary(rec.thetao, f"+ thermocline-weighted fine-tune (α = {self.a.depth_weight})")
        adopt = (new["argo 75–150 m"] or 9) < (base["argo 75–150 m"] or 9) and (new["argo 0–1000 m"] or 9) <= (base["argo 0–1000 m"] or 9) + 0.002
        if adopt:
            rec.to_netcdf(os.path.join(self.out, "OceanEmbed_NIO_T_2023_dw.nc"))
        self.save("thermocline.json", {"title": "Thermocline-weighted fine-tune", "depths": C.DEPTHS, "rows": [base, new],
                                       "adopted": bool(adopt), "checkpoints": dst if adopt else None})

    # ---------------------------------------------------------------- 5 · ablations + embedding probe
    VARIANTS = {
        "full": {"label": "Sylithe Ocean Model (all parts)"},
        "no_ssl": {"label": "− self-supervised pretraining", "ssl": False},
        "no_tattn": {"label": "− temporal attention (plain mean over days)", "extra": {"no_tattn": True}},
        "no_vgrad": {"label": "− vertical-gradient loss", "cfg": {"w_vgrad": 0.0}},
        "window7": {"label": "7-day window instead of 15", "cfg": {"window": 7}},
        "probe_ssl": {"label": "Linear probe on the frozen SSL embedding", "cfg": {"arch": "probe"}, "probe": True},
        "probe_random": {"label": "Linear probe on a frozen random encoder", "cfg": {"arch": "probe"}, "probe": True, "ssl": False},
    }

    def ablate(self):
        res_path = self.path("ablation_runs.json")
        res = json.load(open(res_path)) if os.path.exists(res_path) else {}
        base_cfg = TR.load_model(TR.seed_checkpoints(self.ck)[0])[1]
        for key, v in self.VARIANTS.items():
            if key in res and not self.a.force:
                continue
            cfg = C.TrainConfig(**{**base_cfg.__dict__, "seed": 42, "num_workers": self.a.workers, "batch_size": self.a.batch,
                                   "extra": v.get("extra", {}), **v.get("cfg", {})})
            _, net = TR.new_models(cfg)
            if v.get("ssl", True):
                TR.load_encoder_from_ssl(net, os.path.join(self.ck, "ssl_best.pt"))
            ck = os.path.join(self.root, "checkpoints", "ablation", key)
            mins = self.a.minutes * (0.4 if v.get("probe") else 1.0)
            ds = lambda per, tr: D.SurfaceWindows(self.inputs, self.target, self.S, per, cfg.window, train=tr,
                                                  var_dropout=cfg.var_dropout if tr else 0,
                                                  crop=(cfg.crop_h, cfg.crop_w) if tr else None)
            self.log(f"ablation {key}: {v['label']} ({mins:.0f} min)")
            TR.fit(net, ds(C.TRAIN, True), ds(C.VAL, False), cfg, "glorys", ck, epochs=60, depth_std=self.S["depth_std"],
                   max_minutes=mins, log=self.log)
            model = TR.load_model(os.path.join(ck, "glorys_best.pt"))[0]
            rec = I.reconstruct(model, self.inputs, self.S, *C.TEST, window=cfg.window)
            res[key] = {"label": v["label"], **self.summary(rec.thetao, key, depth_table=False)}
            json.dump(res, open(res_path, "w"), indent=1)
        full = res.get("full", {})
        rows = []
        for key in self.VARIANTS:
            if key not in res:
                continue
            r = dict(res[key])
            for k in ("glorys 0–1000 m", "argo 0–1000 m", "argo 75–150 m"):
                if r.get(k) is not None and full.get(k) is not None and key != "full":
                    r[f"Δ {k}"] = _r(r[k] - full[k])
            rows.append(r)
        self.save("ablation.json", {"title": "Ablations at equal budget (seed 42, test year 2023)", "rows": rows,
                                    "budget_minutes": self.a.minutes,
                                    "note": "Every variant trained with the same seed, data and time budget; RMSE in °C. "
                                            "Probes train one linear layer on a frozen encoder: the SSL-vs-random gap is "
                                            "what the self-supervised satellite embedding knows about the subsurface."})

    # ---------------------------------------------------------------- 6 · near-real-time gap
    def _nrt_store(self, start, end):
        from . import live as L
        from . import ingest
        path = os.path.join(self.data, "nrt_inputs.zarr")
        done_p = path + ".chunks.json"
        done = set(json.load(open(done_p))) if os.path.exists(done_p) else set()
        ingest.init_store(path, C.INPUT_VARS, with_depth=False, start=start, end=end)
        cov = {}
        for did, vars_ in L.NRT.items():
            for a in pd.date_range(start, end, freq="15D"):
                b = min(a + pd.Timedelta(days=14), pd.Timestamp(end))
                key = f"{did}:{a.date()}"
                if key in done:
                    continue
                try:
                    got = L.fetch(did, str(a.date()), str(b.date()))
                except Exception as e:
                    self.log(f"  {L.LABEL[did]} {a.date()}: unavailable ({repr(e)[:100]})")
                    done.add(key); json.dump(sorted(done), open(done_p, "w")); continue
                for v, _, _ in vars_:
                    days = sorted(d for d in got if v in got[d])
                    if not days:
                        continue
                    t = pd.to_datetime(days)
                    da = xr.DataArray(np.stack([got[d][v] for d in days]), dims=["time", "lat", "lon"],
                                      coords={"time": t, "lat": C.LATS, "lon": C.LONS})
                    full = da.reindex(time=pd.date_range(t[0], t[-1], freq="D"))
                    ingest.write_block(path, full, v)
                    cov[v] = cov.get(v, 0) + len(days)
                done.add(key); json.dump(sorted(done), open(done_p, "w"))
                self.log(f"  {L.LABEL[did]} {a.date()} → {b.date()}: {len(got)} day(s)")
        return path

    def nrt(self):
        if self.done("nrt.json"):
            return
        start = str((pd.Timestamp(self.a.nrt_from) - pd.Timedelta(days=self.a.window)).date())
        path = self._nrt_store(start, C.TEST[1])
        cover = {v: _r(float(np.isfinite(xr.open_zarr(path)[v].sel(time=slice(*C.TEST)).isel(lat=40, lon=172)).mean()), 3)
                 for v in C.INPUT_VARS}
        self.log(f"NRT 2023 coverage at 15°N 88°E: {cover}")
        ref = self.summary(self.base_rec().thetao, "reprocessed inputs (offline, as evaluated)", depth_table=False)
        rec0 = I.reconstruct(self.members(), path, self.S, *C.TEST, window=self.a.window)
        before = self.summary(rec0.thetao, "near-real-time inputs, current models", depth_table=False)
        dst = self.ck + "_nrt"
        val0 = str((pd.Timestamp(C.VAL[1]) - pd.Timedelta(days=30)).date())
        self.finetune(self.ck, dst, inputs=path, train=(self.a.nrt_from, val0), val=(val0, C.VAL[1]), lr=3e-5)
        rec1 = I.reconstruct(self.members(dst), path, self.S, *C.TEST, window=self.a.window)
        after = self.summary(rec1.thetao, "near-real-time inputs, fine-tuned on NRT 2022", depth_table=False)
        better = (after["argo 0–1000 m"] or 9) < (before["argo 0–1000 m"] or 9)
        rel = self.path("release_models")
        shutil.rmtree(rel, ignore_errors=True); os.makedirs(rel)
        for p in TR.seed_checkpoints(dst if better else self.ck):
            shutil.copy(p, os.path.join(rel, os.path.basename(os.path.dirname(p)) + ".pt"))
        shutil.copy(os.path.join(self.root, "stats_v2.npz"), rel)
        if os.path.exists(self.path("sigma_scale.json")):
            shutil.copy(self.path("sigma_scale.json"), rel)
        self.save("nrt.json", {"title": "Near-real-time inputs (2023, never used for training)", "rows": [ref, before, after],
                               "fine_tune_period": f"{self.a.nrt_from} – {C.VAL[1]}", "nrt_coverage_2023": cover,
                               "release": "fine-tuned" if better else "current", "release_dir": rel})

    # ---------------------------------------------------------------- report
    def report(self):
        out = {"generated_at": pd.Timestamp.now("UTC").isoformat(timespec="seconds")}
        for n in ("calibration", "cyclones", "gridded_argo", "thermocline", "ablation", "nrt"):
            p = self.path(f"{n}.json")
            if os.path.exists(p):
                out[n] = json.load(open(p))
        self.save("upgrades.json", out)

    def all(self):
        for step in self.a.steps:
            self.log(f"===== {step} =====")
            try:
                getattr(self, step)()
            except Exception as e:                   # one failed step must not cost the others
                self.log(f"{step} FAILED: {e!r}")
        self.report()


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("step", choices=["all", "calibrate", "cyclones", "gridded", "thermo", "ablate", "nrt", "report"])
    p.add_argument("--data", required=True); p.add_argument("--root", required=True)
    p.add_argument("--window", type=int, default=C.TrainConfig.window)
    p.add_argument("--minutes", type=float, default=40, help="training minutes per fine-tune / ablation run")
    p.add_argument("--batch", type=int, default=16); p.add_argument("--workers", type=int, default=6)
    p.add_argument("--depth-weight", type=float, default=2.0, help="α of the thermocline-weighted loss")
    p.add_argument("--nrt-from", default="2022-07-01", help="first day of near-real-time inputs used for fine-tuning")
    p.add_argument("--steps", nargs="+", default=["calibrate", "cyclones", "gridded", "thermo", "nrt", "ablate"])
    p.add_argument("--force", action="store_true")
    a = p.parse_args(argv)
    u = Up(a)
    u.all() if a.step == "all" else (getattr(u, a.step)(), u.report())


if __name__ == "__main__":
    main()
