"""Live operation: whenever the satellites publish new surface data, predict the ocean beneath it.

    python -m oceanembed.live run --state STATE --models MODELS [--today 2026-09-30]

Each run (a cron job, e.g. daily; running it more often is harmless):
  1. asks Copernicus Marine for the newest date of every near-real-time source
  2. ingests only days it has not stored yet, straight onto the 0.25° grid (a few MB per day)
  3. predicts every day whose core inputs (SST and SLA) are in, with the 3-model ensemble
  4. re-predicts recent days whose inputs improved since their last prediction (salinity arrives ~6 days
     late, winds a day late): each day keeps a revision number and the inputs it was computed from
  5. checks the newest predictions against Argo floats that surfaced in the last 30 days
  6. writes the console files (manifest, maps of the last days, series, run index, status)

Near-real-time sources (the reprocessed products used for training arrive weeks to months late):
  SST       OSTIA NRT                                 ~1 day
  SLA       DUACS NRT all-satellite L4                same day
  currents  geostrophic currents from DUACS NRT        same day   (training used OSCAR total currents)
  winds     Copernicus ASCAT-blended L4 winds          ~1 day     (training used CCMP)
  SSS       multi-observation SMOS/SMAP NRT            ~6 days    (missing days are flagged, not filled)
The two substitutes are the reason real-time accuracy is tracked separately against Argo (status.json).

State directory (small; kept between runs, e.g. on a git branch):
  inputs/<date>.npz   the 7 inputs on the target grid (float16), rolling INPUT_DAYS
  pred/<date>.npz     temperature and σ (int16, 0.001 °C), rolling MAP_DAYS
  series.json index.json status.json skill.json and web/ (what the console reads)
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import xarray as xr

from . import config as C
from . import dataset as D
from . import infer as I
from . import ingest
from . import metrics as M
from . import train as TR
from .daily import _region_stats
from .regrid import bin_matrix, daily_mean, to_target_grid, _std_coords

# dataset → [(our variable, source variable, offset)]
NRT = {
    "METOFFICE-GLO-SST-L4-NRT-OBS-SST-V2": [("sst", "analysed_sst", -273.15)],
    "cmems_obs-sl_glo_phy-ssh_nrt_allsat-l4-duacs-0.125deg_P1D": [("sla", "sla", 0.0), ("uc", "ugos", 0.0), ("vc", "vgos", 0.0)],
    "cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H": [("uw", "eastward_wind", 0.0), ("vw", "northward_wind", 0.0)],
    "cmems_obs-mob_glo_phy-sss_nrt_multi_P1D": [("sss", "sos", 0.0)],
}
LABEL = {"METOFFICE-GLO-SST-L4-NRT-OBS-SST-V2": "OSTIA NRT",
         "cmems_obs-sl_glo_phy-ssh_nrt_allsat-l4-duacs-0.125deg_P1D": "DUACS NRT (SLA + geostrophic currents)",
         "cmems_obs-wind_glo_phy_nrt_l4_0.125deg_PT1H": "ASCAT-blended L4 winds NRT",
         "cmems_obs-mob_glo_phy-sss_nrt_multi_P1D": "SMOS/SMAP multi-obs SSS NRT"}
CORE = ("sst", "sla")          # a day is predicted as soon as these are in
INPUT_DAYS = 60                # inputs kept (≥ window + revision horizon)
MAP_DAYS = 31                  # days with full maps on the site
REVISE_DAYS = 21               # how far back an improved input triggers a re-prediction
BOOTSTRAP_DAYS = 45            # first run: how far back to ingest
SST_CARRY_DAYS = 3             # SST (OSTIA NRT) lags 1–2 days: carry the newest SST forward this far so the newest
                               # sea-level day can be predicted now; such days are provisional and re-predicted when
                               # the real SST lands (it raises the input signature)


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _dates(a, b):
    return [str(d.date()) for d in pd.date_range(a, b, freq="D")] if a <= b else []


def _json(path, default):
    return json.load(open(path)) if os.path.exists(path) else default


def _save_json(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), allow_nan=False, default=lambda o: None)
    os.replace(tmp, path)


# ---------------------------------------------------------------- sources
def latest_available(dataset_id: str) -> str | None:
    """Newest date in the Copernicus catalogue for a dataset (metadata only, no login needed)."""
    import copernicusmarine as cm
    part = cm.describe(dataset_id=dataset_id, disable_progress_bar=True).products[0].datasets[0].versions[-1].parts[0]
    for s in part.services:
        for v in s.variables:
            for c in v.coordinates:
                if c.coordinate_id == "time" and isinstance(c.maximum_value, (int, float)):
                    return str(pd.Timestamp(c.maximum_value, unit="ms").date())
    return None


def fetch(dataset_id: str, start: str, end: str) -> dict[str, dict[str, np.ndarray]]:
    """{date: {our_var: (H, W) float32}} for every day in [start, end] the dataset provides (login required)."""
    import copernicusmarine as cm
    vars_ = NRT[dataset_id]
    ds = cm.open_dataset(dataset_id=dataset_id, variables=[v for _, v, _ in vars_], start_datetime=f"{start}T00:00:00",
                         end_datetime=f"{end}T23:59:59", **C.BBOX)
    out: dict = {}
    M_ = None
    for ours, src, off in vars_:
        da = daily_mean(_std_coords(ds[src].load().astype("f4")))
        extra = [d for d in da.dims if d not in ("time", "lat", "lon")]
        da = da.isel({d: 0 for d in extra}, drop=True) + np.float32(off)
        if M_ is None and float(np.abs(np.diff(da.lat.values)).mean()) < C.RES * 0.8:
            M_ = bin_matrix(da.lat.values, da.lon.values)
        g = to_target_grid(da, M_)
        for t in g.time.values:
            day = str(pd.Timestamp(t).date())
            a = g.sel(time=t).values
            if np.isfinite(a).any():
                out.setdefault(day, {})[ours] = a.astype("f4")
    return out


# ---------------------------------------------------------------- state
class State:
    def __init__(self, root: str):
        self.root = root
        for d in ("inputs", "pred", "web"):
            os.makedirs(os.path.join(root, d), exist_ok=True)
        self.series = _json(os.path.join(root, "series.json"), {"depths": C.DEPTHS, "regions": list(C.REGIONS), "days": {}})
        self.index = _json(os.path.join(root, "index.json"), {})
        self.status = _json(os.path.join(root, "status.json"), {})

    def inp_path(self, day):
        return os.path.join(self.root, "inputs", f"{day}.npz")

    def inputs(self, day) -> dict[str, np.ndarray]:
        p = self.inp_path(day)
        if not os.path.exists(p):
            return {}
        z = np.load(p)
        return {k: z[k].astype("f4") for k in z.files}

    def add_inputs(self, day, fields: dict):
        cur = self.inputs(day) | fields
        np.savez_compressed(self.inp_path(day), **{k: v.astype("f2") for k, v in cur.items()})

    def stored_days(self, var=None):
        days = sorted(f[:-4] for f in os.listdir(os.path.join(self.root, "inputs")) if f.endswith(".npz"))
        return [d for d in days if var is None or var in np.load(self.inp_path(d)).files]

    def save(self):
        for name in ("series", "index", "status"):
            _save_json(os.path.join(self.root, f"{name}.json"), getattr(self, name))

    def prune(self, keep_from_inputs: str, keep_from_pred: str):
        for sub, first in (("inputs", keep_from_inputs), ("pred", keep_from_pred)):
            for f in os.listdir(os.path.join(self.root, sub)):
                if f.endswith(".npz") and f[:-4] < first:
                    os.remove(os.path.join(self.root, sub, f))


def signature(state: State, day: str, window: int) -> int:
    """Number of (variable, day) inputs available in the window ending on `day`: rises when late data arrive."""
    return sum(len(state.inputs(d)) for d in _dates(str((pd.Timestamp(day) - pd.Timedelta(days=window - 1)).date()), day))


# ---------------------------------------------------------------- steps
def ingest_new(state: State, today: str, log=print, fetch_fn=fetch, latest_fn=latest_available):
    """For each source: fetch the days between what we hold and what the source now has."""
    first_ever = str((pd.Timestamp(today) - pd.Timedelta(days=BOOTSTRAP_DAYS)).date())
    src_status = {}
    for did, vars_ in NRT.items():
        try:
            latest = latest_fn(did)
        except Exception as e:
            log(f"  {LABEL[did]}: catalogue unavailable ({e!r})"); src_status[did] = {"error": repr(e)[:200]}
            continue
        held = state.stored_days(vars_[0][0])
        start = str((pd.Timestamp(held[-1]) + pd.Timedelta(days=1)).date()) if held else first_ever
        end = min(latest or start, today)
        n_new = 0
        if start <= end:
            try:
                got = fetch_fn(did, start, end)
                for day, fields in got.items():
                    state.add_inputs(day, fields); n_new += 1
            except Exception as e:
                log(f"  {LABEL[did]}: fetch {start}→{end} failed ({e!r})")
                src_status[did] = {"latest_available": latest, "error": repr(e)[:200]}
                continue
        held = state.stored_days(vars_[0][0])
        lag = (pd.Timestamp(today) - pd.Timestamp(latest)).days if latest else None
        src_status[did] = {"label": LABEL[did], "variables": [v for v, _, _ in vars_], "latest_available": latest,
                           "latest_stored": held[-1] if held else None, "lag_days": lag, "new_days": n_new}
        log(f"  {LABEL[did]}: newest {latest} (lag {lag} d), {n_new} new day(s)")
    return src_status


def backfill_inputs(state: State, today: str, days: int, window: int, log=print, fetch_fn=fetch, chunk: int = 15):
    """Extend the stored inputs backwards so that `days` more days can be predicted (one-time history build).
    Fetches in `chunk`-day pieces, oldest last; a piece the near-real-time archive does not hold is skipped."""
    want_from = str((pd.Timestamp(today) - pd.Timedelta(days=days + window)).date())
    for did, vars_ in NRT.items():
        held = state.stored_days(vars_[0][0])
        end = str((pd.Timestamp(held[0]) - pd.Timedelta(days=1)).date()) if held else str(pd.Timestamp(today).date())
        t = pd.Timestamp(end)
        n = 0
        while str(t.date()) >= want_from:
            a = max(pd.Timestamp(want_from), t - pd.Timedelta(days=chunk - 1))
            try:
                for day, fields in fetch_fn(did, str(a.date()), str(t.date())).items():
                    state.add_inputs(day, fields); n += 1
            except Exception as e:
                log(f"  backfill {LABEL[did]} {a.date()}→{t.date()}: skipped ({repr(e)[:120]})")
            t = a - pd.Timedelta(days=1)
        log(f"  backfill {LABEL[did]}: {n} day(s) added back to {want_from}")


def carried_sst(state: State, day: str):
    """(field, source_day) of the newest stored SST on or before `day`, at most SST_CARRY_DAYS old; None if none."""
    for k in range(0, SST_CARRY_DAYS + 1):
        d = str((pd.Timestamp(day) - pd.Timedelta(days=k)).date())
        f = state.inputs(d).get("sst")
        if f is not None:
            return f, d
    return None


def inputs_for(state: State, day: str) -> tuple[dict, str | None]:
    """Stored inputs of a day, with SST carried forward when it has not arrived yet. Returns (fields, sst_source_day)."""
    inp = state.inputs(day)
    if "sst" in inp:
        return inp, None
    c = carried_sst(state, day)
    return (inp | {"sst": c[0]}, c[1]) if c else (inp, None)


def _build_store(state: State, path: str, start: str, end: str):
    ingest.init_store(path, C.INPUT_VARS, with_depth=False, start=start, end=end)
    days = _dates(start, end)
    for v in C.INPUT_VARS:
        a = np.stack([inputs_for(state, d)[0].get(v, np.full((len(C.LATS), len(C.LONS)), np.nan, "f4")) for d in days])
        ingest.write_block(path, xr.DataArray(a, dims=["time", "lat", "lon"],
                                              coords={"time": pd.to_datetime(days), "lat": C.LATS, "lon": C.LONS}), v)


def predict_new(state: State, members, window: int, S, today: str, log=print, sigma_scale=None):
    """Predict new days and re-predict recent days whose inputs improved. Returns the days (re)computed."""
    ready = [d for d in state.stored_days() if all(k in inputs_for(state, d)[0] for k in CORE)]
    first = state.stored_days()[0] if state.stored_days() else None
    if not ready or first is None:
        return []
    earliest = str((pd.Timestamp(first) + pd.Timedelta(days=window - 1)).date())
    horizon = str((pd.Timestamp(today) - pd.Timedelta(days=REVISE_DAYS)).date())
    todo = []
    for d in ready:
        if d < earliest:
            continue
        sig = signature(state, d, window)
        rec = state.index.get(d)
        if rec is None or (d >= horizon and sig > rec.get("signature", 0)):
            todo.append((d, sig))
    if not todo:
        log("  no new or improved days to predict")
        return []
    a, b = todo[0][0], todo[-1][0]
    tmp = tempfile.mkdtemp()
    try:
        path = os.path.join(tmp, "inputs.zarr")
        _build_store(state, path, str((pd.Timestamp(a) - pd.Timedelta(days=window - 1)).date()), b)
        D._INPUT_CACHE.clear()
        rec = I.reconstruct(members, path, S, a, b, window=window, sigma_scale=sigma_scale)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    ocean = S["ocean"] > 0
    masks = {r: M.region_mask(r) & ocean for r in C.REGIONS}
    stamp = _now()
    for d, sig in todo:
        T = rec.thetao.sel(time=d).values; Sg = rec.thetao_sigma.sel(time=d).values
        np.savez_compressed(os.path.join(state.root, "pred", f"{d}.npz"),
                            temp=np.where(np.isfinite(T), np.round((T - 20) * 1000), -32768).astype("i2"),
                            sigma=np.where(np.isfinite(Sg), np.round(Sg * 1000), -32768).astype("i2"))
        raw = state.inputs(d)
        inp, sst_from = inputs_for(state, d)
        fields = {v: np.where(ocean, inp.get(v, np.full(ocean.shape, np.nan, "f4")), np.nan) for v in C.INPUT_VARS}
        state.series["days"][d] = _region_stats(T, Sg, fields, masks)
        prev = state.index.get(d, {})
        window_days = _dates(str((pd.Timestamp(d) - pd.Timedelta(days=window - 1)).date()), d)
        state.index[d] = {
            "computed_at": stamp, "revision": prev.get("revision", -1) + 1, "signature": sig,
            "members": len(members), "window": window,
            "inputs_today": sorted(raw), "missing_today": [v for v in C.INPUT_VARS if v not in raw],
            "provisional": sst_from is not None, "sst_from": sst_from,
            "inputs_valid": {v: round(float(np.isfinite(fields[v][ocean]).mean()), 3) for v in C.INPUT_VARS},
            "window_coverage": round(sig / (len(C.INPUT_VARS) * len(window_days)), 3),
            "sources": "near-real-time",
        }
    log(f"  predicted {len(todo)} day(s): " + ", ".join(f"{d} (rev {state.index[d]['revision']})" for d, _ in todo))
    return [d for d, _ in todo]


def _pred(state: State, day: str):
    z = np.load(os.path.join(state.root, "pred", f"{day}.npz"))
    dec = lambda a, s, o: np.where(a == -32768, np.nan, a.astype("f4") * s + o)
    return dec(z["temp"], 0.001, 20.0), dec(z["sigma"], 0.001, 0.0)


def argo_check(state: State, today: str, days_back: int = 30, log=print):
    """Recent Argo profiles (real-time QC) against the live predictions of the same day and cell."""
    from . import argo as A
    preds = sorted(f[:-4] for f in os.listdir(os.path.join(state.root, "pred")) if f.endswith(".npz"))
    if not preds:
        return None
    start = max(preds[0], str((pd.Timestamp(today) - pd.Timedelta(days=days_back)).date()))
    try:
        rows = []
        for m0 in pd.date_range(pd.Timestamp(start).replace(day=1), today, freq="MS"):
            df = A._qc(A._query(max(m0, pd.Timestamp(start)), min(m0 + pd.offsets.MonthBegin(1), pd.Timestamp(today) + pd.Timedelta(days=1))))
            for (pl, cy), g in df.groupby(["platform_number", "cycle_number"]):
                if len(g) >= 5:
                    rows.append({"time": pd.Timestamp(g["time"].iloc[0]).tz_localize(None).normalize(),
                                 "lat": float(g["latitude"].iloc[0]), "lon": float(g["longitude"].iloc[0]),
                                 "platform": int(pl), "cycle": int(cy),
                                 **{f"T{d}": v for d, v in zip(C.DEPTHS, A.to_std_depths(g["z"].values, g["t"].values))}})
        prof = pd.DataFrame(rows)
    except Exception as e:
        log(f"  Argo check skipped ({e!r})"); return None
    prof = prof[prof.time.astype(str).str[:10].isin(preds)] if len(prof) else prof
    if prof.empty:
        log("  no Argo profile on a predicted day yet"); return {"profiles": 0, "updated_at": _now()}
    days = sorted(prof.time.astype(str).str[:10].unique())
    field = xr.DataArray(np.stack([_pred(state, d)[0] for d in days]), dims=["time", "depth", "lat", "lon"],
                         coords={"time": pd.to_datetime(days), "depth": C.DEPTHS, "lat": C.LATS, "lon": C.LONS})
    m = A.match(prof, field, "live")
    obs = np.stack([m[f"T{d}"].values for d in C.DEPTHS], 1); pr = np.stack([m[f"live_T{d}"].values for d in C.DEPTHS], 1)
    ok = np.isfinite(obs) & np.isfinite(pr)
    e = (pr - obs)[ok]
    per_depth = [{"depth": d, "n": int(ok[:, k].sum()),
                  "rmse": float(np.sqrt(np.mean((pr[:, k] - obs[:, k])[ok[:, k]] ** 2))) if ok[:, k].any() else None}
                 for k, d in enumerate(C.DEPTHS)]
    out = {"updated_at": _now(), "profiles": int(len(m)), "points": int(ok.sum()), "from": days[0], "to": days[-1],
           "rmse": float(np.sqrt(np.mean(e ** 2))) if e.size else None, "bias": float(e.mean()) if e.size else None,
           "per_depth": per_depth,
           "floats": [{"date": str(r.time)[:10], "lat": r.lat, "lon": r.lon, "platform": r.platform,
                       "rmse": float(np.sqrt(np.nanmean((pr[i] - obs[i]) ** 2))) if ok[i].any() else None}
                      for i, r in enumerate(m.itertuples())]}
    log(f"  Argo check: {out['profiles']} profile(s), RMSE {out['rmse']:.3f} °C" if out["rmse"] is not None else "  Argo check: no overlap")
    return out


def export_web(state: State, S, log=print):
    """Console files in format v2 (same as webexport/daily): the Daily page's live mode reads web/."""
    from .webexport import WebExport
    preds = sorted(f[:-4] for f in os.listdir(os.path.join(state.root, "pred")) if f.endswith(".npz"))[-MAP_DAYS:]
    out = os.path.join(state.root, "web")
    tmp = out + ".new"
    shutil.rmtree(tmp, ignore_errors=True)
    ocean = S["ocean"] > 0
    W = WebExport(tmp, "model", "Sylithe Ocean Model · live",
                  "3-model ensemble on near-real-time satellite inputs; each day recomputed when late inputs arrive.")
    for d in preds:
        T, Sg = _pred(state, d)
        W.add(d, "temp", T); W.add(d, "sigma", Sg)
        inp = state.inputs(d)
        for v in C.INPUT_VARS:
            if v in inp:
                W.add(d, v, np.where(ocean, inp[v], np.nan))
    W.write_json("series.json", state.series)
    W.write_json("status.json", state.status)
    # same shape as daily.export, so the console reads live and replay alike
    W.write_json("index.json", {"days": sorted(state.index), "runs": state.index, "maps": preds})
    if os.path.exists(os.path.join(state.root, "skill.json")):
        W.write_json("skill.json", _json(os.path.join(state.root, "skill.json"), {}))
    W.finish(ops={"mode": "live", "first": min(state.series["days"]) if state.series["days"] else None,
                  "last": max(state.series["days"]) if state.series["days"] else None,
                  "cached": len(state.series["days"]), "maps": len(preds)})
    shutil.rmtree(out, ignore_errors=True)
    os.replace(tmp, out)
    log(f"  web export: {len(preds)} mapped day(s), {len(state.series['days'])} day(s) of statistics")


def run(state_dir: str, models_dir: str, stats_path: str | None = None, today: str | None = None,
        argo: bool = True, log=print, fetch_fn=fetch, latest_fn=latest_available, backfill: int = 0):
    t0 = time.time()
    today = today or str(pd.Timestamp.utcnow().date())
    state = State(state_dir)
    S = D.load_stats(stats_path or os.path.join(models_dir, "stats_v2.npz"))
    ck = TR.seed_checkpoints(models_dir) or TR.seed_checkpoints(os.path.join(models_dir, "oceanembed_w15"))
    if not ck:
        raise SystemExit(f"no seed*/glorys_best.pt under {models_dir}")
    loaded = [TR.load_model(p) for p in ck]
    members, window = [m for m, _ in loaded], loaded[0][1].window
    log(f"live run {today}: {len(members)}-model ensemble, {window}-day window")
    sources = ingest_new(state, today, log, fetch_fn, latest_fn)
    if backfill > 0:
        backfill_inputs(state, today, backfill, window, log, fetch_fn)
    cal = os.path.join(models_dir, "sigma_scale.json")       # σ calibration (oceanembed.upgrades calibrate), optional
    sigma_scale = json.load(open(cal))["scale"] if os.path.exists(cal) else None
    if sigma_scale:
        log("  σ calibration: on")
    done = predict_new(state, members, window, S, today, log, sigma_scale=sigma_scale)
    skill = argo_check(state, today, log=log) if argo else None
    if skill is not None:
        _save_json(os.path.join(state.root, "skill.json"), skill)
    days = sorted(state.series["days"])
    state.status = {
        "updated_at": _now(), "run_seconds": round(time.time() - t0, 1), "today": today, "sources": sources,
        "last_predicted": days[-1] if days else None, "recomputed": done, "predicted_days": len(days),
        "core_inputs": list(CORE), "members": len(members), "window": window,
    }
    state.prune(str((pd.Timestamp(today) - pd.Timedelta(days=INPUT_DAYS)).date()),
                days[-MAP_DAYS] if len(days) >= MAP_DAYS else "0000")
    state.save()
    export_web(state, S, log)
    try:                                   # cyclone bulletin (DeepSeek wording when DEEPSEEK_API_KEY is set)
        from .bulletin import write as write_bulletin
        write_bulletin(state.root, log)
    except Exception as e:
        log(f"  bulletin skipped ({e!r})")
    log(f"live run done in {time.time() - t0:.0f} s · latest prediction {state.status['last_predicted']}")
    return state


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--state", required=True); r.add_argument("--models", required=True)
    r.add_argument("--stats", default=None); r.add_argument("--today", default=None)
    r.add_argument("--no-argo", action="store_true")
    r.add_argument("--backfill", type=int, default=0, help="also fetch and predict this many past days (one-time history build)")
    s = sub.add_parser("sources", help="print the newest date of every NRT source (no login needed)")
    a = p.parse_args(argv)
    if a.cmd == "run":
        run(a.state, a.models, a.stats, a.today, not a.no_argo, backfill=a.backfill)
    else:
        for did in NRT:
            print(f"{LABEL[did]:40s} {latest_available(did)}")


if __name__ == "__main__":
    main()
