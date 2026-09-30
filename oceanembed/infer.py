"""Inference → the PS deliverable: daily, 0.25°, 15-level temperature (+ uncertainty) over the NIO,
written as CF-style NetCDF/Zarr, plus compact JSON tiles for the web console."""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd
import torch
import xarray as xr

from . import config as C
from .dataset import SurfaceWindows, unpad
from .metrics import isotherm_depth, mld, tchp
from . import train as TR
from .train import DEV


def _to_dataset(T, S, times, stats, source):
    ocean = stats["ocean"] > 0
    valid = ocean & np.isfinite(stats["clim"][0])        # land and sea-floor mask per depth
    T = np.where(valid, T, np.nan)
    coords = {"time": pd.DatetimeIndex(times), "depth": np.array(C.DEPTHS, float), "lat": C.LATS, "lon": C.LONS}
    data = {"thetao": (("time", "depth", "lat", "lon"), T.astype("f4"),
                       {"units": "degC", "long_name": "reconstructed sea water potential temperature"})}
    if S is not None:
        data["thetao_sigma"] = (("time", "depth", "lat", "lon"), np.where(valid, S, np.nan).astype("f4"),
                                {"units": "degC", "long_name": "predicted 1-sigma uncertainty"})
    return xr.Dataset(data, coords=coords, attrs={
        "title": "OceanEmbed NIO subsurface temperature reconstruction", "source": source,
        "grid": "0.25 deg, daily", "Conventions": "CF-1.8"})


@torch.no_grad()
def reconstruct(models, inputs_path, stats, start, end, window, batch=4):
    """Daily 3D temperature from surface inputs. `models` may be one network or a list (seed ensemble):
    the ensemble mean is the prediction, and σ² = mean of member variances + spread of member means."""
    models = models if isinstance(models, (list, tuple)) else [models]
    ds = SurfaceWindows(inputs_path, None, stats, (start, end), window=window, need_target=False)
    for m in models:
        m.to(DEV).eval()
    std = torch.tensor(stats["depth_std"], device=DEV).view(1, -1, 1, 1)
    Ts, Ss, times = [], [], []
    for b in torch.utils.data.DataLoader(ds, batch):
        b = TR._to(b)
        outs = [m(b["x"], b["missing"], b["static"]) for m in models]
        mu = torch.stack([o[0] for o in outs])                                  # (M, B, 15, H, W), normalised
        var = torch.stack([torch.exp(o[1]) for o in outs]).mean(0) + mu.var(0, unbiased=False)
        doy = [int(ds.doy[int(t)]) - 1 for t in b["t"]]
        clim = torch.nan_to_num(torch.tensor(stats["clim"][doy], device=DEV))
        Ts.append((unpad(mu.mean(0) * std) + clim).cpu().numpy())
        Ss.append(unpad(var.sqrt() * std).cpu().numpy())
        times += [ds.time[int(t)] for t in b["t"]]
    src = f"OceanEmbed ({len(models)}-model ensemble) from surface satellite observations only"
    return _to_dataset(np.concatenate(Ts), np.concatenate(Ss), times, stats, src)


def reconstruct_baseline(predictor, inputs_path, stats, start, end, window):
    """Same output format for a non-neural predictor (baselines.Climatology / baselines.Ridge)."""
    ds = SurfaceWindows(inputs_path, None, stats, (start, end), window=window, need_target=False)
    std = stats["depth_std"][:, None, None]
    Ts, times = [], []
    for k in range(len(ds)):
        it = ds[k]; t = ds.idx[k]
        Ts.append(stats["clim"][ds.doy[t] - 1] + predictor.predict(it) * std)
        times.append(ds.time[t])
    return _to_dataset(np.stack(Ts), None, times, stats, predictor.name)


def _round(a, nd=2):
    return [[None if not np.isfinite(v) else round(float(v), nd) for v in row] for row in a]


def export_web(ds: xr.Dataset, out_dir: str, comparison: xr.Dataset | None = None):
    """One JSON per day: temp, sigma, and derived D20 / D26 / TCHP / MLD maps for the console."""
    os.makedirs(out_dir, exist_ok=True)
    index = []
    for t in ds.time.values:
        day = str(pd.Timestamp(t).date())
        T = ds.thetao.sel(time=t).values
        rec = {"date": day, "source": "OceanEmbed reconstruction", "lon0": C.LON_MIN, "lat0": C.LAT_MAX,
               "step": C.RES, "width": len(C.LONS), "height": len(C.LATS), "depths": C.DEPTHS,
               # rows north→south to match image rows
               "temp": [_round(x[::-1]) for x in T],
               "sigma": [_round(x[::-1], 3) for x in ds.thetao_sigma.sel(time=t).values],
               "d20": _round(isotherm_depth(T, 20.0)[::-1], 0),
               "d26": _round(isotherm_depth(T, 26.0)[::-1], 0),
               "tchp": _round(tchp(T)[::-1], 1),
               "mld": _round(mld(T)[::-1], 0)}
        if comparison is not None and t in comparison.time.values:
            rec["reference"] = [_round(x[::-1]) for x in comparison.thetao.sel(time=t).values]
        json.dump(rec, open(os.path.join(out_dir, f"recon_{day}.json"), "w"), separators=(",", ":"))
        index.append(day)
    json.dump({"days": index}, open(os.path.join(out_dir, "index.json"), "w"))
