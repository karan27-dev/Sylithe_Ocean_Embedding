"""One leaderboard, one referee: every method is scored on the same held-out year (2023), the same grid,
the same 15 depths and the same Argo profiles.

Two scores per method:
  vs GLORYS — RMSE over every valid (day, depth, ocean cell) of the test year against the training target
  vs Argo   — RMSE over every valid (profile, depth) against independent float observations, the
              measure the PS asks for; reference products (GLORYS, HYCOM) are scored on the same profiles

Published numbers are listed separately as context: they come from other regions, depths and
reference data, so they are not a like-for-like comparison and the table says so.
"""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd
import xarray as xr

from . import argo as A
from . import config as C
from .metrics import region_mask

# Reported in the literature. Not comparable to rows computed here (different region/depths/reference).
PUBLISHED_CONTEXT = [
    {"method": "Attention 3D U-Net++ (Wang et al., ESSD 18:4617, 2026)", "rmse_argo": 0.61,
     "setup": "NW Pacific 0–40°N 120–160°E, 5–2000 m, vs WOD profiles 2023, SST+SSH inputs"},
    {"method": "DSVIT downscaling ViT (Deep-Sea Res. II, 2025)", "rmse_target": 0.29,
     "setup": "tropical Indian Ocean, vs its independent test set"},
]

BANDS = {"0-1000 m": (0, 1000), "0-200 m": (0, 200), "200-1000 m": (201, 1000)}


def _stats(err: np.ndarray, pred: np.ndarray, ref: np.ndarray) -> dict:
    ok = np.isfinite(err)
    if ok.sum() < 3:
        return {"rmse": np.nan, "bias": np.nan, "r": np.nan, "n": int(ok.sum())}
    e, p, r = err[ok], pred[ok], ref[ok]
    return {"rmse": float(np.sqrt(np.mean(e ** 2))), "bias": float(e.mean()),
            "r": float(np.corrcoef(p, r)[0, 1]), "n": int(ok.sum())}


def score_vs_field(pred: xr.DataArray, ref: xr.DataArray) -> dict:
    """RMSE / bias / r against a gridded reference, per region and depth band. Each day is loaded once and
    running sums are accumulated, so a year of 3D fields never needs a second full copy in memory."""
    ref = ref.sel(time=pred.time)
    depths = np.array(C.DEPTHS)
    keys = [(reg, band) for reg in C.REGIONS for band in BANDS]
    masks = {reg: region_mask(reg) for reg in C.REGIONS}
    dsel = {band: (depths >= z0) & (depths <= z1) for band, (z0, z1) in BANDS.items()}
    acc = {k: np.zeros(8) for k in keys}              # n, Σe, Σe², Σp, Σr, Σp², Σr², Σpr
    for i in range(pred.sizes["time"]):
        P = pred.isel(time=i).values.astype(np.float64)
        R = ref.isel(time=i).values.astype(np.float64)
        for reg, band in keys:
            p = P[dsel[band]][:, masks[reg]]; r = R[dsel[band]][:, masks[reg]]
            ok = np.isfinite(p) & np.isfinite(r)
            p, r = p[ok], r[ok]; e = p - r
            acc[(reg, band)] += [e.size, e.sum(), (e * e).sum(), p.sum(), r.sum(), (p * p).sum(), (r * r).sum(), (p * r).sum()]
    out = {}
    for k, (n, se, se2, sp, sr, spp, srr, spr) in acc.items():
        cov = spr / n - (sp / n) * (sr / n)
        corr = cov / np.sqrt((spp / n - (sp / n) ** 2) * (srr / n - (sr / n) ** 2))
        out[k] = {"rmse": float(np.sqrt(se2 / n)), "bias": float(se / n), "r": float(corr), "n": int(n)}
    return out


def score_vs_argo(profiles: pd.DataFrame, field: xr.DataArray, name: str) -> tuple[dict, pd.DataFrame]:
    """Match a gridded field to Argo profiles (nearest 0.25° cell, same day) and score per region/band."""
    m = A.match(profiles, field, name)
    out = {}
    for reg, r in C.REGIONS.items():
        sub = m[m.lat.between(*r["lat"]) & m.lon.between(*r["lon"])]
        for band, (z0, z1) in BANDS.items():
            ds = [d for d in C.DEPTHS if z0 <= d <= z1]
            pred = sub[[f"{name}_T{d}" for d in ds]].values.ravel()
            obs = sub[[f"T{d}" for d in ds]].values.ravel()
            out[(reg, band)] = _stats(pred - obs, pred, obs)
    return out, m


class Leaderboard:
    def __init__(self, glorys: xr.DataArray, profiles: pd.DataFrame | None = None):
        self.glorys, self.profiles = glorys, profiles
        self.rows: list[dict] = []

    def add(self, method: str, kind: str, field: xr.DataArray, vs_glorys: bool = True):
        """kind: 'ours' | 'published method (retrained here)' | 'baseline' | 'reference product'."""
        row = {"method": method, "kind": kind}
        if vs_glorys:
            g = score_vs_field(field, self.glorys)
            for (reg, band), v in g.items():
                row[f"glorys_{reg}_{band}_rmse"] = v["rmse"]
                row[f"glorys_{reg}_{band}_bias"] = v["bias"]
                row[f"glorys_{reg}_{band}_r"] = v["r"]
        if self.profiles is not None:
            a, _ = score_vs_argo(self.profiles, field, "p")
            for (reg, band), v in a.items():
                row[f"argo_{reg}_{band}_rmse"] = v["rmse"]
                row[f"argo_{reg}_{band}_bias"] = v["bias"]
                row[f"argo_{reg}_{band}_n"] = v["n"]
        self.rows.append(row)
        return row

    def table(self) -> pd.DataFrame:
        return pd.DataFrame(self.rows)

    def summary(self) -> pd.DataFrame:
        """The headline table: NIO 0–1000 m RMSE vs GLORYS and vs Argo, plus BoB / AS vs Argo."""
        t = self.table()
        cols = {"method": "Method", "kind": "Type",
                "glorys_NIO_0-1000 m_rmse": "RMSE vs GLORYS (°C)",
                "argo_NIO_0-1000 m_rmse": "RMSE vs Argo (°C)",
                "argo_NIO_0-200 m_rmse": "Argo 0–200 m",
                "argo_NIO_200-1000 m_rmse": "Argo 200–1000 m",
                "argo_BoB_0-1000 m_rmse": "Argo Bay of Bengal",
                "argo_AS_0-1000 m_rmse": "Argo Arabian Sea",
                "argo_NIO_0-1000 m_bias": "Argo bias (°C)",
                "argo_NIO_0-1000 m_n": "Argo points"}
        s = t[[c for c in cols if c in t]].rename(columns=cols)
        key = "RMSE vs Argo (°C)" if "RMSE vs Argo (°C)" in s else "RMSE vs GLORYS (°C)"
        return s.sort_values(key, na_position="last").reset_index(drop=True)

    def save(self, out_dir: str):
        os.makedirs(out_dir, exist_ok=True)
        self.table().to_csv(os.path.join(out_dir, "leaderboard_full.csv"), index=False)
        s = self.summary()
        s.to_csv(os.path.join(out_dir, "leaderboard.csv"), index=False)
        try:
            md = s.round(3).to_markdown(index=False)
        except ImportError:                              # tabulate not installed
            md = "```\n" + s.round(3).to_string(index=False) + "\n```"
        ctx = "\n".join(f"- {c['method']}: " + ", ".join(f"{k} {v} °C" for k, v in c.items() if k.startswith("rmse"))
                        + f" ({c['setup']})" for c in PUBLISHED_CONTEXT)
        with open(os.path.join(out_dir, "leaderboard.md"), "w") as f:
            f.write("## North Indian Ocean, test year 2023 (never seen in training)\n\n" + md +
                    "\n\n### Published results, for context only (different region, depths or reference data)\n\n" + ctx + "\n")
        with open(os.path.join(out_dir, "leaderboard.json"), "w") as f:
            json.dump({"rows": json.loads(s.to_json(orient="records")), "context": PUBLISHED_CONTEXT}, f, indent=1)
        return s
