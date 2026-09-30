"""Everything the paper needs, computed once on the held-out test year and saved as small files.
figures.py draws every figure from these files, so plots can be restyled without recomputing.

    python -m oceanembed.paper_eval --data /workspace/data --root /workspace/OceanEmbed --out /workspace/OceanEmbed/paper

Methods scored (whatever exists under --root): OceanEmbed ensemble (+ single member), the published Attention 3D
U-Net++ retrained here, ridge, climatology; HYCOM as an independent reference product.

Outputs in --out:
  metrics_depth.csv     method × reference (glorys | argo) × depth → rmse, bias, r, n
  metrics_month.csv     method × month × depth → rmse vs GLORYS
  metrics_region.csv    method × region × depth → rmse, bias vs GLORYS
  maps_rmse.npz         method → (depth, lat, lon) time-mean RMSE and bias vs GLORYS
  coverage.csv          fraction of |error| ≤ kσ for OceanEmbed (vs GLORYS and vs Argo)
  argo_matchups.parquet every Argo profile with each method's values at the same cell/day
  samples.npz           full 3D fields (truth, OceanEmbed, published method, σ) on showcase days
  tchp_case.npz         Tropical Cyclone Heat Potential / D26 during Cyclone Mocha (May 2023), truth vs OceanEmbed
  training_curves.csv   validation RMSE per epoch for every training run
  meta.json             test period, member count, which methods were found
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import time

import numpy as np
import pandas as pd
import xarray as xr

from . import argo as A
from . import baselines as B
from . import config as C
from . import dataset as D
from . import infer as I
from . import metrics as M
from . import train as TR

SHOWCASE_DAYS = ["2023-01-01", "2023-05-12", "2023-08-15", "2023-01-15"]  # paper's Fig. 9 day · Mocha · SW monsoon · NE monsoon
MOCHA = ("2023-05-01", "2023-05-20")                              # Mocha: genesis ~11 May, landfall 14 May 2023
K_SIGMA = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]


class Scorer:
    """Streaming skill statistics of one predicted field against a gridded reference, one day at a time."""

    def __init__(self, sigma: bool = False):
        Z, H, W = len(C.DEPTHS), len(C.LATS), len(C.LONS)
        self.depth = np.zeros((Z, 8))                    # n, Σe, Σe², Σp, Σr, Σp², Σr², Σpr
        self.month = np.zeros((12, Z, 7))                # n, Σe², Σp, Σr, Σp², Σr², Σpr (monthly RMSE and r)
        self.region = {r: np.zeros((Z, 3)) for r in C.REGIONS}      # n, Σe, Σe²
        self.map = np.zeros((3, Z, H, W))                # n, Σe, Σe²
        self.masks = {r: M.region_mask(r) for r in C.REGIONS}
        self.cov = np.zeros((len(K_SIGMA) + 1,)) if sigma else None  # counts within kσ, then total

    def add(self, p: np.ndarray, r: np.ndarray, month: int, s: np.ndarray | None = None):
        ok = np.isfinite(p) & np.isfinite(r)
        e = np.where(ok, p - r, 0.0)
        self.map += np.stack([ok, e, e * e])
        for d in range(p.shape[0]):
            o = ok[d]
            pd_, rd, ed = p[d][o].astype(np.float64), r[d][o].astype(np.float64), e[d][o]
            self.depth[d] += [ed.size, ed.sum(), (ed * ed).sum(), pd_.sum(), rd.sum(), (pd_ * pd_).sum(),
                              (rd * rd).sum(), (pd_ * rd).sum()]
            self.month[month - 1, d] += [ed.size, (ed * ed).sum(), pd_.sum(), rd.sum(), (pd_ * pd_).sum(),
                                         (rd * rd).sum(), (pd_ * rd).sum()]
            for reg, m in self.masks.items():
                om = o & m
                er = e[d][om]
                self.region[reg][d] += [er.size, er.sum(), (er * er).sum()]
        if self.cov is not None and s is not None:
            ae = np.abs(e[ok]); sg = s[ok]
            self.cov[:-1] += [(ae <= k * sg).sum() for k in K_SIGMA]
            self.cov[-1] += ae.size

    def depth_table(self) -> pd.DataFrame:
        n, se, se2, sp, sr, spp, srr, spr = self.depth.T
        with np.errstate(invalid="ignore", divide="ignore"):
            cov = spr / n - (sp / n) * (sr / n)
            r = cov / np.sqrt((spp / n - (sp / n) ** 2) * (srr / n - (sr / n) ** 2))
            return pd.DataFrame({"depth": C.DEPTHS, "rmse": np.sqrt(se2 / n), "bias": se / n, "r": r, "n": n.astype(int)})

    def month_table(self) -> pd.DataFrame:
        n, se2, sp, sr, spp, srr, spr = np.moveaxis(self.month, -1, 0)
        with np.errstate(invalid="ignore", divide="ignore"):
            rm = np.sqrt(se2 / n)
            r = (spr / n - sp / n * sr / n) / np.sqrt((spp / n - (sp / n) ** 2) * (srr / n - (sr / n) ** 2))
        return pd.DataFrame([{"month": m + 1, "depth": d, "rmse": rm[m, k], "r": r[m, k]} for m in range(12)
                             for k, d in enumerate(C.DEPTHS)])

    def region_table(self) -> pd.DataFrame:
        rows = []
        with np.errstate(invalid="ignore", divide="ignore"):
            for reg, a in self.region.items():
                for k, d in enumerate(C.DEPTHS):
                    n, se, se2 = a[k]
                    rows.append({"region": reg, "depth": d, "rmse": np.sqrt(se2 / n), "bias": se / n, "n": int(n)})
        return pd.DataFrame(rows)

    def maps(self):
        n, se, se2 = self.map
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.sqrt(se2 / n).astype("f4"), (se / n).astype("f4")


def _argo_depth_table(m: pd.DataFrame, name: str) -> pd.DataFrame:
    rows = []
    for d in C.DEPTHS:
        p, o = m[f"{name}_T{d}"].values, m[f"T{d}"].values
        ok = np.isfinite(p) & np.isfinite(o)
        e = p[ok] - o[ok]
        rows.append({"depth": d, "rmse": float(np.sqrt(np.mean(e ** 2))) if ok.sum() else np.nan,
                     "bias": float(e.mean()) if ok.sum() else np.nan,
                     "r": float(np.corrcoef(p[ok], o[ok])[0, 1]) if ok.sum() > 2 else np.nan, "n": int(ok.sum())})
    return pd.DataFrame(rows)


def _training_curves(root: str) -> pd.DataFrame:
    rows = []
    for f in sorted(glob.glob(os.path.join(root, "checkpoints", "**", "*_log.csv"), recursive=True)):
        df = pd.read_csv(f)
        run = os.path.relpath(os.path.dirname(f), os.path.join(root, "checkpoints"))
        df["run"] = run + "/" + os.path.basename(f).replace("_log.csv", "")
        rows.append(df)
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()


def _on_disk(ds: xr.Dataset, work: str, name: str) -> xr.Dataset:
    """Write a year of 3D fields to local disk and reopen lazily: scoring reads one day at a time, so memory
    stays at one method's day instead of every method's year (the RunPod evaluation was OOM-killed)."""
    path = os.path.join(work, name.replace(" ", "_").replace("/", "_") + ".nc")
    if not os.path.exists(path):
        ds.to_netcdf(path + ".part"); os.replace(path + ".part", path)
    del ds
    return xr.open_dataset(path, chunks={"time": 1})


def significance(m: pd.DataFrame, ours: str, others: list[str], n_boot: int = 2000, seed: int = 0) -> pd.DataFrame:
    """Paired bootstrap over Argo *profiles* (all depths of a profile resampled together): distribution of
    RMSE(other) − RMSE(ours) on the same points. p = share of resamples where ours is not better."""
    rng = np.random.default_rng(seed)
    obs = np.stack([m[f"T{d}"].values for d in C.DEPTHS], 1)
    def sq(name):
        return (np.stack([m[f"{name}_T{d}"].values for d in C.DEPTHS], 1) - obs) ** 2
    e_o = sq(ours); rows = []
    for name in others:
        e_x = sq(name)
        ok = np.isfinite(e_o) & np.isfinite(e_x)
        a = np.where(ok, e_o, 0.0); b = np.where(ok, e_x, 0.0); n = ok.sum(1)
        keep = n > 0; a, b, n = a[keep].sum(1), b[keep].sum(1), n[keep]
        idx = rng.integers(0, len(n), (n_boot, len(n)))
        d = np.sqrt(b[idx].sum(1) / n[idx].sum(1)) - np.sqrt(a[idx].sum(1) / n[idx].sum(1))
        full = np.sqrt(b.sum() / n.sum()) - np.sqrt(a.sum() / n.sum())
        rows.append({"vs": name, "profiles": int(len(n)), "rmse_ours": float(np.sqrt(a.sum() / n.sum())),
                     "rmse_other": float(np.sqrt(b.sum() / n.sum())), "improvement": float(full),
                     "ci95_low": float(np.percentile(d, 2.5)), "ci95_high": float(np.percentile(d, 97.5)),
                     "p_not_better": float((d <= 0).mean())})
    return pd.DataFrame(rows)


def run(data: str, root: str, out: str, window: int = C.TrainConfig.window, ensemble_nc: str | None = None,
        log=print):
    t0 = time.time()
    os.makedirs(out, exist_ok=True)
    work = os.path.join(out, "_work"); os.makedirs(work, exist_ok=True)
    S = D.load_stats(os.path.join(root, "stats_v2.npz"))
    inputs = os.path.join(data, "inputs.zarr")
    G = xr.open_zarr(os.path.join(data, "target.zarr")).thetao.sel(time=slice(*C.TEST))
    argo_path = os.path.join(data, "argo_2023.parquet")
    prof = pd.read_parquet(argo_path) if os.path.exists(argo_path) else None

    # ---------------------------------------------------------------- predictions for the test year
    methods: dict[str, tuple[str, xr.Dataset]] = {}
    seeds = TR.seed_checkpoints(os.path.join(root, "checkpoints", f"oceanembed_w{window}"))
    if seeds:
        members = [TR.load_model(p)[0] for p in seeds]
        log(f"Sylithe Ocean Model ensemble ({len(members)} members)")
        name = f"Sylithe Ocean Model ({len(members)}-model ensemble)"
        if ensemble_nc and os.path.exists(ensemble_nc):            # reuse the reconstruction made on the GPU run
            log(f"  using saved ensemble reconstruction {ensemble_nc}")
            ens = xr.open_dataset(ensemble_nc, chunks={"time": 1}).sel(time=slice(*C.TEST))
        else:
            ens = _on_disk(I.reconstruct(members, inputs, S, *C.TEST, window=window), work, "ensemble")
        methods[name] = ("ours", ens)
        if len(members) > 1:
            methods["Sylithe Ocean Model (single model)"] = ("ours", _on_disk(
                I.reconstruct(members[0], inputs, S, *C.TEST, window=window), work, "single"))
    p3 = os.path.join(root, "checkpoints", f"attn_unetpp3d_w{window}", "glorys_best.pt")
    if os.path.exists(p3):
        log("published method")
        net3, cfg3 = TR.load_model(p3)
        methods["Attention 3D U-Net++ (Wang et al. 2026)"] = ("published method (retrained here)", _on_disk(
            I.reconstruct(net3, inputs, S, *C.TEST, window=cfg3.window), work, "attn_unetpp3d"))
    ridge = os.path.join(root, "baselines", "ridge.npz")
    if os.path.exists(ridge):
        methods["Ridge regression"] = ("baseline", _on_disk(
            I.reconstruct_baseline(B.Ridge(S).load(ridge), inputs, S, *C.TEST, window=window), work, "ridge"))
    methods["Climatology"] = ("baseline", _on_disk(
        I.reconstruct_baseline(B.Climatology(S), inputs, S, *C.TEST, window=window), work, "climatology"))
    hy = os.path.join(data, "hycom.zarr")
    if os.path.exists(hy):
        methods["HYCOM (independent model)"] = ("reference product",
                                               xr.open_zarr(hy).thetao.sel(time=slice(*C.TEST)).to_dataset(name="thetao"))
    ours_name = next((k for k, (kind, _) in methods.items() if kind == "ours"), None)

    # ---------------------------------------------------------------- scores vs GLORYS
    depth_rows, month_rows, region_rows, maps = [], [], [], {}
    Gt = pd.DatetimeIndex(G.time.values)
    for name, (kind, ds) in methods.items():
        log(f"scoring vs GLORYS: {name}")
        sc = Scorer(sigma="thetao_sigma" in ds and name == ours_name)
        T = ds.thetao.sel(time=G.time)
        for i, day in enumerate(Gt):
            s = ds.thetao_sigma.sel(time=day).values if sc.cov is not None else None
            sc.add(T.isel(time=i).values, G.isel(time=i).values, day.month, s)
        depth_rows.append(sc.depth_table().assign(method=name, kind=kind, reference="glorys"))
        month_rows.append(sc.month_table().assign(method=name, kind=kind))
        region_rows.append(sc.region_table().assign(method=name, kind=kind))
        maps[name] = sc.maps()
        if sc.cov is not None:
            cov_glorys = sc.cov[:-1] / sc.cov[-1]

    # ---------------------------------------------------------------- scores vs Argo (independent observations)
    cov_rows = []
    if prof is not None:
        m = prof.copy()
        fields = {n: ds.thetao for n, (_, ds) in methods.items()} | {"GLORYS12 reanalysis": G}
        for key, (name, f) in enumerate(fields.items()):
            m = A.match(m, f, f"m{key}")
            kind = methods[name][0] if name in methods else "reference product"
            depth_rows.append(_argo_depth_table(m, f"m{key}").assign(method=name, kind=kind, reference="argo"))
        if ours_name and "thetao_sigma" in methods[ours_name][1]:
            m = A.match(m, methods[ours_name][1].thetao_sigma, "sig")
            k0 = list(fields).index(ours_name)
            e = np.concatenate([np.abs(m[f"m{k0}_T{d}"] - m[f"T{d}"]).values for d in C.DEPTHS])
            s = np.concatenate([m[f"sig_T{d}"].values for d in C.DEPTHS])
            ok = np.isfinite(e) & np.isfinite(s)
            cov_rows += [{"k": k, "reference": "argo", "observed": float((e[ok] <= k * s[ok]).mean())} for k in K_SIGMA]
        m.columns = [c if not c.startswith("m") or "_T" not in c else
                     list(fields)[int(c[1:c.index("_")])] + c[c.index("_"):] for c in m.columns]
        m.to_parquet(os.path.join(out, "argo_matchups.parquet"))
        if ours_name:
            others = [n for n in list(methods) + ["GLORYS12 reanalysis"] if n != ours_name and f"{n}_T0" in m]
            sig = significance(m, ours_name, others)
            sig.to_csv(os.path.join(out, "significance.csv"), index=False)
            log("significance vs Argo:\n" + sig.round(4).to_string(index=False))
    if ours_name is not None and "cov_glorys" in locals():
        cov_rows += [{"k": k, "reference": "glorys", "observed": float(v)} for k, v in zip(K_SIGMA, cov_glorys)]
    from math import erf, sqrt
    pd.DataFrame([r | {"expected_gaussian": erf(r["k"] / sqrt(2))} for r in cov_rows]).to_csv(
        os.path.join(out, "coverage.csv"), index=False)

    pd.concat(depth_rows).to_csv(os.path.join(out, "metrics_depth.csv"), index=False)
    pd.concat(month_rows).to_csv(os.path.join(out, "metrics_month.csv"), index=False)
    pd.concat(region_rows).to_csv(os.path.join(out, "metrics_region.csv"), index=False)
    np.savez_compressed(os.path.join(out, "maps_rmse.npz"),
                        **{f"{n}|rmse": v[0] for n, v in maps.items()}, **{f"{n}|bias": v[1] for n, v in maps.items()})

    # ---------------------------------------------------------------- showcase fields and the Mocha case study
    pub = "Attention 3D U-Net++ (Wang et al. 2026)"
    samples = {}
    for day in SHOWCASE_DAYS:
        if pd.Timestamp(day) not in Gt:
            continue
        samples[f"{day}|truth"] = G.sel(time=day).values
        if ours_name:
            samples[f"{day}|ours"] = methods[ours_name][1].thetao.sel(time=day).values
            if "thetao_sigma" in methods[ours_name][1]:
                samples[f"{day}|sigma"] = methods[ours_name][1].thetao_sigma.sel(time=day).values
        if pub in methods:
            samples[f"{day}|published"] = methods[pub][1].thetao.sel(time=day).values
    np.savez_compressed(os.path.join(out, "samples.npz"), **samples)

    if ours_name:
        days = [d for d in pd.date_range(*MOCHA) if d in Gt]
        bob = M.region_mask("BoB")
        case = {"days": np.array([str(d.date()) for d in days])}
        for tag, arr in [("truth", G), ("ours", methods[ours_name][1].thetao)]:
            tc = np.stack([M.tchp_fast(arr.sel(time=d).values) for d in days])
            d26 = np.stack([M.isotherm_depth_fast(arr.sel(time=d).values, 26.0) for d in days])
            case[f"{tag}_tchp"] = tc.astype("f4"); case[f"{tag}_d26"] = d26.astype("f4")
            case[f"{tag}_tchp_bob_mean"] = np.array([np.nanmean(t[bob]) for t in tc])
        np.savez_compressed(os.path.join(out, "tchp_case.npz"), **case)

    _training_curves(root).to_csv(os.path.join(out, "training_curves.csv"), index=False)
    json.dump({"test": C.TEST, "methods": {n: k for n, (k, _) in methods.items()}, "ours": ours_name,
               "members": len(seeds), "argo_profiles": 0 if prof is None else len(prof),
               "depths": C.DEPTHS, "regions": C.REGIONS, "showcase_days": SHOWCASE_DAYS, "mocha": MOCHA,
               "minutes": round((time.time() - t0) / 60, 1)}, open(os.path.join(out, "meta.json"), "w"), indent=1)
    np.save(os.path.join(out, "ocean_mask.npy"), (S["ocean"] > 0))
    log(f"paper evaluation written to {out} in {(time.time() - t0) / 60:.1f} min")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", required=True); p.add_argument("--root", required=True); p.add_argument("--out", required=True)
    p.add_argument("--window", type=int, default=C.TrainConfig.window)
    p.add_argument("--ensemble-nc", default=None, help="reuse a saved ensemble reconstruction (NetCDF) instead of recomputing")
    p.add_argument("--figures", action="store_true", help="also draw all figures (figures.py)")
    a = p.parse_args(argv)
    run(a.data, a.root, a.out, a.window, a.ensemble_nc)
    if a.figures:
        from . import figures, figures_paper
        figures.draw_all(a.out)
        figures_paper.draw_all(a.out)                 # the same results in Wang et al. (2026)'s figure layouts


if __name__ == "__main__":
    main()
