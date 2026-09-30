"""Export for the web console (format v2): a manifest plus one small binary file per layer and day.

    web/public/data/
      manifest.json                    grid, depths, days, layers (scale/offset), what else is present
      days/<YYYY-MM-DD>/<layer>.bin    int16 little-endian, rows north→south, NODATA = -32768
      argo.json                        matched profiles: observation + every product at the 15 depths
      skill_depth.json                 RMSE / bias / r per product, reference, region and depth
      coverage.json                    fraction of Argo errors inside ±1σ per depth (model only)
      leaderboard.json                 written by benchmark.Leaderboard (copied as is)

int16 with a per-layer scale keeps a 15-level day at ~0.7 MB (JSON was ~2 MB for temperature alone),
so a month of model output stays small enough for a static site. This module needs numpy/pandas only,
so the demo-data script can use it on a laptop without torch.
"""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

from . import argo as A
from . import config as C

NODATA = -32768

# value = int16 * scale + offset. Ranges: temperature −12.7…52.7 °C at 0.001 °C; σ up to 16 °C.
LAYERS = {
    "temp":    dict(scale=0.001, offset=20.0, unit="°C", label="Temperature"),
    "sigma":   dict(scale=0.0005, offset=0.0, unit="°C", label="Uncertainty (1σ)"),
    "ref":     dict(scale=0.001, offset=20.0, unit="°C", label="GLORYS12 reference"),
    "sst":     dict(scale=0.001, offset=20.0, unit="°C", label="Sea surface temperature"),
    "sss":     dict(scale=0.001, offset=35.0, unit="psu", label="Sea surface salinity"),
    "sla":     dict(scale=0.0001, offset=0.0, unit="m", label="Sea level anomaly"),
    "uc":      dict(scale=0.0001, offset=0.0, unit="m/s", label="Current U"),
    "vc":      dict(scale=0.0001, offset=0.0, unit="m/s", label="Current V"),
    "uw":      dict(scale=0.001, offset=0.0, unit="m/s", label="Wind U"),
    "vw":      dict(scale=0.001, offset=0.0, unit="m/s", label="Wind V"),
    "embed":   dict(scale=1 / 30000, offset=0.0, unit="", label="Embedding (3 principal components, 0–1)"),
    "cluster": dict(scale=1.0, offset=0.0, unit="", label="Latent ocean regime"),
}


def _grid():
    return {"lon0": C.LON_MIN, "lat0": C.LAT_MAX, "step": C.RES, "width": len(C.LONS), "height": len(C.LATS)}


def encode(values: np.ndarray, name: str, north_up: bool = False) -> bytes:
    """values: (levels, lat, lon) or (lat, lon), south→north like every array in this package.
    Rows are flipped to north→south (image order) unless north_up says they already are."""
    a = np.asarray(values, dtype="f8")
    if a.ndim == 2:
        a = a[None]
    if not north_up:
        a = a[:, ::-1, :]
    s = LAYERS[name]
    q = np.round((a - s["offset"]) / s["scale"])
    q = np.where(np.isfinite(q), np.clip(q, -32767, 32767), NODATA).astype("<i2")
    return q.tobytes()


class WebExport:
    """Collects days and layers, then writes the manifest. Use one instance per export folder."""

    def __init__(self, out_dir: str, source_kind: str, source_label: str, detail: str = ""):
        self.out = out_dir
        self.source = {"kind": source_kind, "label": source_label, "detail": detail}
        self.days: dict[str, dict] = {}
        self.levels: dict[str, int] = {}
        self.extra: dict = {}
        os.makedirs(os.path.join(out_dir, "days"), exist_ok=True)

    def add(self, day: str, name: str, values: np.ndarray, north_up: bool = False, note: str | None = None):
        d = os.path.join(self.out, "days", day)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{name}.bin"), "wb") as f:
            f.write(encode(values, name, north_up))
        self.levels[name] = 1 if np.ndim(values) == 2 else int(np.shape(values)[0])
        rec = self.days.setdefault(day, {"date": day, "layers": []})
        if name not in rec["layers"]:
            rec["layers"].append(name)
        if note:
            rec["note"] = note

    def write_json(self, name: str, obj) -> str:
        with open(os.path.join(self.out, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, separators=(",", ":"), allow_nan=False, default=_clean, ensure_ascii=False)
        self.extra[name.split(".")[0]] = name
        return name

    def finish(self, **meta):
        layers = {k: {**LAYERS[k], "levels": n} for k, n in self.levels.items()}
        man = {"version": 2, "source": self.source, "grid": _grid(), "depths": C.DEPTHS,
               "regions": {k: {"lat": list(v["lat"]), "lon": list(v["lon"])} for k, v in C.REGIONS.items()},
               "days": [self.days[d] for d in sorted(self.days)], "layers": layers, "files": self.extra,
               "nodata": NODATA, **meta}
        with open(os.path.join(self.out, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(man, f, indent=1, ensure_ascii=False)
        return man


def _clean(o):
    if isinstance(o, np.floating):
        return None if not np.isfinite(o) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, pd.Timestamp):
        return str(o.date())
    raise TypeError(type(o))


def _num(v, nd=3):
    return None if v is None or not np.isfinite(v) else round(float(v), nd)


# ---------------------------------------------------------------- Argo
def argo_records(matched: pd.DataFrame, products: list[str], sigma: str | None = None) -> list[dict]:
    """matched: output of argo.match chained over products (columns T<d>, <product>_T<d>)."""
    out = []
    for r in matched.to_dict("records"):
        rec = {"id": f"{r['platform']}_{r['cycle']}", "platform": int(r["platform"]), "cycle": int(r["cycle"]),
               "date": str(pd.Timestamp(r["time"]).date()), "lat": round(float(r["lat"]), 3),
               "lon": round(float(r["lon"]), 3), "obs": [_num(r[f"T{d}"]) for d in C.DEPTHS]}
        if "day" in r:
            rec["day"] = r["day"]
        rec["products"] = {p: [_num(r[f"{p}_T{d}"]) for d in C.DEPTHS] for p in products}
        if sigma:
            rec["sigma"] = [_num(r[f"{sigma}_T{d}"]) for d in C.DEPTHS]
        if sum(v is not None for v in rec["obs"]) >= 3:
            out.append(rec)
    return out


def skill_rows(matched: pd.DataFrame, products: list[str], vs: str = "argo") -> list[dict]:
    rows = []
    for p in products:
        for reg in C.REGIONS:
            t = A.score(matched, p, None if reg == "NIO" else reg)
            for rec in t.to_dict("records"):
                rows.append({"product": p, "vs": vs, "region": reg, "depth": int(rec["depth"]),
                             "n": int(rec["n"]), **{k: _num(rec.get(k, np.nan), 4) for k in ["rmse", "bias", "r"]}})
    return rows


def coverage_rows(matched: pd.DataFrame, pred: str, sigma: str) -> list[dict]:
    rows = []
    for d in C.DEPTHS:
        e = (matched[f"{pred}_T{d}"] - matched[f"T{d}"]).abs()
        s = matched[f"{sigma}_T{d}"]
        ok = e.notna() & s.notna()
        rows.append({"depth": d, "n": int(ok.sum()),
                     "inside1": _num((e[ok] <= s[ok]).mean(), 4) if ok.any() else None,
                     "inside2": _num((e[ok] <= 2 * s[ok]).mean(), 4) if ok.any() else None})
    return rows


def field_skill_rows(pred, ref, product: str, vs: str) -> list[dict]:
    """Per-depth skill of a gridded product against a gridded reference over all days, per region."""
    from .metrics import region_mask, skill
    P, R = np.asarray(pred), np.asarray(ref)
    rows = []
    for reg in C.REGIONS:
        m = region_mask(reg)
        s = skill(np.where(m, P, np.nan), np.where(m, R, np.nan))
        rows += [{"product": product, "vs": vs, "region": reg, "depth": int(d), "n": v["n"],
                  **{k: _num(v[k], 4) for k in ["rmse", "bias", "r"]}} for d, v in s.items()]
    return rows


def error_map(pred, ref) -> np.ndarray:
    """RMSE per depth and cell over the time axis: (time, depth, lat, lon) → (depth, lat, lon)."""
    e = np.asarray(pred, dtype="f8") - np.asarray(ref, dtype="f8")
    with np.errstate(invalid="ignore"):
        return np.sqrt(np.nanmean(e ** 2, axis=0))


# ---------------------------------------------------------------- embedding (model export)
def embedding_maps(z: np.ndarray, ocean: np.ndarray, factor: int = 8, k: int = 6, seed: int = 0, basis=None):
    """z: (days, D, h, w) latent maps over the padded grid (padding is bottom/right, see dataset.pad), one
    latent cell per `factor`×`factor` output cells; ocean: (H, W) bool, south→north like every array here.
    Returns per-day RGB (days, 3, H, W) in 0–1 from a PCA fitted on all days together (so colours mean
    the same thing on every day), per-day k-means regime labels (days, H, W), and the fitted basis."""
    H, W = ocean.shape
    z = z[:, :, : -(-H // factor), : -(-W // factor)]         # drop latent cells that only cover padding
    n, D, h, w = z.shape
    X = z.transpose(0, 2, 3, 1).reshape(-1, D).astype("f8")
    if basis is None:
        mu = X.mean(0)
        _, _, Vt = np.linalg.svd(X - mu, full_matrices=False)
        P = (X - mu) @ Vt[:3].T
        lo, hi = np.percentile(P, 1, 0), np.percentile(P, 99, 0)
        rng = np.random.default_rng(seed)
        cent = X[rng.choice(len(X), k, replace=False)]
        for _ in range(30):
            lab = np.argmin(((X[:, None] - cent[None]) ** 2).sum(-1), 1)
            cent = np.stack([X[lab == j].mean(0) if (lab == j).any() else cent[j] for j in range(k)])
        basis = dict(mu=mu, Vt=Vt[:3], lo=lo, hi=hi, cent=cent)
    P = (X - basis["mu"]) @ basis["Vt"].T
    rgb = np.clip((P - basis["lo"]) / (basis["hi"] - basis["lo"]), 0, 1).reshape(n, h, w, 3).transpose(0, 3, 1, 2)
    lab = np.argmin(((X[:, None] - basis["cent"][None]) ** 2).sum(-1), 1).reshape(n, h, w).astype("f4")
    # each output cell takes the latent cell it lies in
    iy, ix = np.arange(H) // factor, np.arange(W) // factor
    rgb = rgb[:, :, iy][:, :, :, ix]
    lab = lab[:, iy][:, :, ix]
    rgb = np.where(ocean[None, None], rgb, np.nan)
    lab = np.where(ocean[None], lab, np.nan)
    return rgb, lab, basis


# ---------------------------------------------------------------- full model export (run.py `web`, notebook 03)
def embeddings(model, inputs_path, stats, start, end, window, batch=4):
    """Latent maps z (days, 64, h, w) from the first ensemble member's encoder, one per day in [start, end]."""
    import torch
    from .dataset import SurfaceWindows
    from .train import DEV
    ds = SurfaceWindows(inputs_path, None, stats, (start, end), window=window, need_target=False)
    model.to(DEV).eval()
    zs, times = [], []
    with torch.no_grad():
        for b in torch.utils.data.DataLoader(ds, batch):
            _, _, z = model(b["x"].to(DEV), b["missing"].to(DEV), b["static"].to(DEV))
            if z is None:
                raise ValueError("this architecture has no embedding head (use an OceanEmbedNet checkpoint)")
            zs.append(z.float().cpu().numpy())
            times += [ds.time[int(t)] for t in b["t"]]
    return np.concatenate(zs), pd.DatetimeIndex(times)


def export_model(out_dir, rec, glorys, inputs_path, stats, models, window, days, profiles=None, hycom=None,
                 leaderboard_json=None, log=print):
    """Everything the console reads, from a trained run.

    rec       xr.Dataset from infer.reconstruct (thetao, thetao_sigma) covering at least `days`; for the Argo
              scores it should cover the whole test year
    glorys    target DataArray (time, depth, lat, lon); hycom: optional comparator on the same grid
    days      the days written as maps (e.g. the May 2023 cyclone window); Argo, skill and coverage use all of rec
    """
    import shutil
    import xarray as xr
    days = pd.DatetimeIndex(days)
    ex = WebExport(out_dir, "model", "OceanEmbed reconstruction",
                   f"{len(models)}-model ensemble from surface satellite observations only; test year never seen in training.")
    ocean = np.asarray(stats["ocean"]) > 0
    inp = xr.open_zarr(inputs_path)

    log(f"embedding {len(days)} days")
    z, zt = embeddings(models[0], inputs_path, stats, str(days[0].date()), str(days[-1].date()), window)
    rgb, lab, _ = embedding_maps(z, ocean)
    zi = {t: k for k, t in enumerate(zt.normalize())}

    for t in days:
        day = str(t.date())
        ex.add(day, "temp", rec.thetao.sel(time=t).values)
        if "thetao_sigma" in rec:
            ex.add(day, "sigma", rec.thetao_sigma.sel(time=t).values)
        ex.add(day, "ref", glorys.sel(time=t).values)
        for v in C.INPUT_VARS:
            ex.add(day, v, inp[v].sel(time=t).values)
        if t in zi:
            ex.add(day, "embed", rgb[zi[t]])
            ex.add(day, "cluster", lab[zi[t]])
    log(f"wrote {len(days)} days of maps")

    products = ["ours", "glorys"] + (["hycom"] if hycom is not None else [])
    if profiles is not None and len(profiles):
        fields = {"ours": rec.thetao, "glorys": glorys.sel(time=rec.time), **({"hycom": hycom.sel(time=rec.time)} if hycom is not None else {})}
        m = profiles
        for name, f in fields.items():
            m = A.match(m, f, name)
        has_sigma = "thetao_sigma" in rec
        if has_sigma:
            m = A.match(m, rec.thetao_sigma, "sigma")
        ex.write_json("argo.json", {"window_days": 0, "profiles": argo_records(m, products, sigma="sigma" if has_sigma else None)})
        ex.write_json("skill_depth.json", skill_rows(m, products, vs="argo"))
        if has_sigma:
            ex.write_json("coverage.json", coverage_rows(m, "ours", "sigma"))
        log(f"scored {len(m)} Argo profiles")
    if leaderboard_json and os.path.exists(leaderboard_json):
        shutil.copy(leaderboard_json, os.path.join(out_dir, "leaderboard.json"))
        ex.extra["leaderboard"] = "leaderboard.json"

    labels = {"ours": ("OceanEmbed", "ours"), "glorys": ("GLORYS12", "reference"), "hycom": ("HYCOM GOFS 3.1", "reference")}
    return ex.finish(products={p: {"label": labels[p][0], "kind": labels[p][1]} for p in products},
                     inputs=list(C.INPUT_VARS), primary="ours", argo_match="same day, nearest 0.25° cell")
