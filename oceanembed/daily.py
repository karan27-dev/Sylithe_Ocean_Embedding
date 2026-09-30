"""Operational daily pipeline: satellite inputs of a day → 3D temperature forecast, computed once and cached.

    python -m oceanembed.daily run    --data /workspace/data --root /workspace/OceanEmbed --start 2023-01-01 --end 2023-12-31
    python -m oceanembed.daily export --data /workspace/data --root /workspace/OceanEmbed --out web/public/data/ops --maps-last 31

run     For every requested day not yet in the cache: the ensemble reconstructs the 15-level temperature and σ
        from the preceding window of the 7 surface inputs, stores them in ops/predictions.zarr, and appends the
        day's regional statistics (inputs, temperature per depth, σ, TCHP, D26, D20, MLD) to ops/series.json.
        ops/index.json records what was computed, when and by which model; cached days are never recomputed
        (unless --force), so a daily cron job only ever does the new day's work.
export  Web files for the console's Daily page: statistics for every cached day (week/month/quarter/year
        charts) plus full maps for the most recent --maps-last days (a rolling archive keeps the site small).

In near-real-time use the new day's inputs are ingested first (oceanembed.ingest, NRT product IDs); here the
held-out year 2023 is replayed day by day, exactly as it would have run operationally.
"""
from __future__ import annotations

import argparse
import json
import os
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

REGION_KEYS = list(C.REGIONS)
SCALARS = ["sst", "sss", "sla", "cur", "wind", "tchp", "d26", "d20", "mld"]


def _atomic_json(path: str, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), allow_nan=True)
    os.replace(tmp, path)


class OpsStore:
    """ops/ under --root: predictions.zarr (thetao, sigma), index.json (cache), series.json (daily statistics)."""

    def __init__(self, root: str, start: str, end: str):
        self.dir = os.path.join(root, "ops")
        os.makedirs(self.dir, exist_ok=True)
        self.zarr = os.path.join(self.dir, "predictions.zarr")
        ingest.init_store(self.zarr, ["thetao", "sigma"], with_depth=True, start=start, end=end, encode_int16=True)
        self.index_path = os.path.join(self.dir, "index.json")
        self.series_path = os.path.join(self.dir, "series.json")
        self.index = json.load(open(self.index_path)) if os.path.exists(self.index_path) else {}
        self.series = json.load(open(self.series_path)) if os.path.exists(self.series_path) else {
            "depths": C.DEPTHS, "regions": REGION_KEYS, "days": {}}

    def ensure_range(self, start: str, end: str):
        """Grow the store's time axis so new days (tomorrow's run) have somewhere to go: append empty days."""
        have = pd.DatetimeIndex(xr.open_zarr(self.zarr).time.values)
        if pd.Timestamp(start) < have[0]:
            raise SystemExit(f"{start} is before the start of the ops store ({have[0].date()}); use a new --root")
        if pd.Timestamp(end) <= have[-1]:
            return
        extra = pd.date_range(have[-1] + pd.Timedelta(days=1), end, freq="D")
        empty = np.full((len(extra), len(C.DEPTHS), len(C.LATS), len(C.LONS)), np.nan, dtype="f4")
        ds = xr.Dataset({n: (("time", "depth", "lat", "lon"), empty) for n in ("thetao", "sigma")},
                        coords={"time": extra, "depth": np.array(C.DEPTHS, float), "lat": C.LATS, "lon": C.LONS})
        ds.chunk({"time": 1}).to_zarr(self.zarr, append_dim="time")

    def done(self, day: str) -> bool:
        return day in self.index

    def save(self):
        _atomic_json(self.index_path, self.index)
        _atomic_json(self.series_path, self.series)


def _region_stats(T, S, inp, masks) -> dict:
    """Regional means for one day. T, S: (15, H, W); inp: dict of (H, W) physical input fields."""
    cur = np.hypot(inp["uc"], inp["vc"]); wind = np.hypot(inp["uw"], inp["vw"])
    derived = {"tchp": M.tchp_fast(T), "d26": M.isotherm_depth_fast(T, 26.0), "d20": M.isotherm_depth_fast(T, 20.0),
               "mld": M.mld_fast(T)}
    fields = {"sst": inp["sst"], "sss": inp["sss"], "sla": inp["sla"], "cur": cur, "wind": wind, **derived}
    out = {}
    with np.errstate(invalid="ignore"):
        for r, m in masks.items():
            rec = {k: _mean(v[m]) for k, v in fields.items()}
            rec["T"] = [_mean(T[k][m]) for k in range(T.shape[0])]
            rec["sigma"] = [_mean(S[k][m]) for k in range(S.shape[0])]
            rec["tchp_ge50"] = _mean((derived["tchp"][m] >= 50).astype(float)) if np.isfinite(derived["tchp"][m]).any() else None
            out[r] = rec
    return out


def _mean(a):
    a = np.asarray(a, dtype="f8")
    a = a[np.isfinite(a)]
    return round(float(a.mean()), 4) if a.size else None


def _runs(days: list[pd.Timestamp], max_len: int = 31):
    """Contiguous runs of days, split into chunks of at most max_len (one reconstruct call each)."""
    run = []
    for d in days:
        if run and ((d - run[-1]).days != 1 or len(run) >= max_len):
            yield run; run = []
        run.append(d)
    if run:
        yield run


def run(data: str, root: str, start: str, end: str, force: bool = False, batch: int = 8,
        window: int = C.TrainConfig.window, from_nc: str | None = None, log=print):
    """from_nc: a reconstruction already made by this same ensemble (e.g. OceanEmbed_NIO_T_2023.nc from the
    training run); its days are cached instead of being recomputed, with identical results."""
    t0 = time.time()
    S = D.load_stats(os.path.join(root, "stats_v2.npz"))
    ck = TR.seed_checkpoints(os.path.join(root, "checkpoints", f"oceanembed_w{window}"))
    if not ck:
        raise SystemExit("no trained OceanEmbed checkpoints under --root")
    members = [TR.load_model(p)[0] for p in ck]
    window = TR.load_model(ck[0])[1].window
    inputs_path = os.path.join(data, "inputs.zarr")
    inp = xr.open_zarr(inputs_path)
    avail = pd.DatetimeIndex(inp.time.values)
    store = OpsStore(root, start, end)
    store.ensure_range(start, end)

    days = pd.date_range(start, end, freq="D")
    missing = [d for d in days if d not in avail or avail.get_loc(d) < window - 1]
    if missing:
        raise SystemExit(f"inputs not available for {len(missing)} day(s), first {missing[0].date()}: ingest them "
                         f"first (oceanembed.ingest with NRT products), then re-run")
    todo = [d for d in days if force or not store.done(str(d.date()))]
    log(f"daily: {len(days)} day(s) requested, {len(days) - len(todo)} cached, {len(todo)} to compute "
        f"with a {len(members)}-member ensemble")
    ocean = S["ocean"] > 0
    masks = {r: M.region_mask(r) & ocean for r in REGION_KEYS}
    model_tag = [os.path.relpath(p, root) for p in ck]
    for chunk in _runs(todo):
        a, b = str(chunk[0].date()), str(chunk[-1].date())
        if from_nc:
            rec = xr.open_dataset(from_nc).sel(time=slice(a, b)).load()
            if rec.sizes["time"] != len(chunk):
                raise SystemExit(f"{from_nc} does not cover {a} → {b}")
        else:
            rec = I.reconstruct(members, inputs_path, S, a, b, window=window, batch=batch)
        for name, var in [("thetao", "thetao"), ("sigma", "thetao_sigma")]:
            ingest.write_block(store.zarr, rec[var].rename(name), name)
        raw = inp.sel(time=slice(a, b))[C.INPUT_VARS].load()
        for i, day in enumerate(pd.DatetimeIndex(rec.time.values)):
            T = rec.thetao.values[i]; Sg = rec.thetao_sigma.values[i]
            fields = {v: np.where(ocean, raw[v].sel(time=day).values, np.nan) for v in C.INPUT_VARS}
            key = str(day.date())
            store.series["days"][key] = _region_stats(T, Sg, fields, masks)
            store.index[key] = {"computed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                                "members": len(members), "model": model_tag, "window": window,
                                "inputs_valid": {v: round(float(np.isfinite(fields[v][ocean]).mean()), 3)
                                                 for v in C.INPUT_VARS}}
        store.save()                                       # resumable: a crash loses at most one chunk
        log(f"  {a} → {b}: {len(chunk)} day(s) computed and cached")
    log(f"daily: done in {(time.time() - t0) / 60:.1f} min · {len(store.index)} day(s) in the cache")
    return store


def export(data: str, root: str, out: str, maps_last: int = 31, log=print):
    """Console files (format v2, same as webexport) for the Daily page."""
    from .webexport import WebExport
    store_dir = os.path.join(root, "ops")
    index = json.load(open(os.path.join(store_dir, "index.json")))
    series = json.load(open(os.path.join(store_dir, "series.json")))
    days = sorted(index)
    if not days:
        raise SystemExit("the ops cache is empty: run `daily run` first")
    pred = xr.open_zarr(os.path.join(store_dir, "predictions.zarr"))
    inp = xr.open_zarr(os.path.join(data, "inputs.zarr"))
    S = D.load_stats(os.path.join(root, "stats_v2.npz"))
    ocean = S["ocean"] > 0
    W = WebExport(out, "model", "Sylithe Ocean Model daily forecast",
                  "Ensemble reconstruction from that day's satellite inputs, computed once by the daily pipeline "
                  "and served from its cache.")
    for day in days[-maps_last:]:
        W.add(day, "temp", pred.thetao.sel(time=day).values)
        W.add(day, "sigma", pred.sigma.sel(time=day).values)
        for v in C.INPUT_VARS:
            W.add(day, v, np.where(ocean, inp[v].sel(time=day).values, np.nan))
    W.write_json("series.json", series)
    W.write_json("index.json", {"days": days, "runs": index, "maps": days[-maps_last:]})
    man = W.finish(ops={"first": days[0], "last": days[-1], "cached": len(days), "maps": min(maps_last, len(days))})
    log(f"daily export: {len(days)} day(s) of statistics, maps for {man['ops']['maps']} → {out}")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("run", "export"):
        s = sub.add_parser(name)
        s.add_argument("--data", required=True); s.add_argument("--root", required=True)
    r = sub.choices["run"]
    r.add_argument("--start", default=C.TEST[0]); r.add_argument("--end", default=C.TEST[1])
    r.add_argument("--force", action="store_true", help="recompute days that are already cached")
    r.add_argument("--batch", type=int, default=8)
    r.add_argument("--from-nc", default=None, help="take predictions from a saved ensemble reconstruction")
    r.add_argument("--window", type=int, default=C.TrainConfig.window, help="checkpoint folder oceanembed_w<window>")
    e = sub.choices["export"]
    e.add_argument("--out", required=True); e.add_argument("--maps-last", type=int, default=31)
    a = p.parse_args(argv)
    if a.cmd == "run":
        run(a.data, a.root, a.start, a.end, a.force, a.batch, a.window, a.from_nc)
    else:
        export(a.data, a.root, a.out, a.maps_last)


if __name__ == "__main__":
    main()
