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
from .train import DEV


@torch.no_grad()
def reconstruct(model, inputs_path, stats, start, end, window, batch=4, mc_dropout=False):
    ds = SurfaceWindows(inputs_path, None, stats, (start, end), window=window, need_target=False)
    model.to(DEV).eval()
    std = torch.tensor(stats["depth_std"], device=DEV).view(1, -1, 1, 1)
    means, sigmas, times = [], [], []
    loader = torch.utils.data.DataLoader(ds, batch)
    for b in loader:
        mean, logvar, _ = model(b["x"].to(DEV), b["missing"].to(DEV), b["static"].to(DEV))
        doy = [min(ds.time[int(t)].dayofyear, 366) - 1 for t in b["t"]]
        clim = torch.tensor(stats["clim"][doy], device=DEV)
        T = unpad(mean * std)[:, :, :, :] + torch.nan_to_num(clim)
        sig = unpad(torch.exp(0.5 * logvar) * std)
        means.append(T.cpu().numpy()); sigmas.append(sig.cpu().numpy())
        times += [ds.time[int(t)] for t in b["t"]]
    T = np.concatenate(means); S = np.concatenate(sigmas)
    ocean = stats["ocean"] > 0
    clim_valid = np.isfinite(stats["clim"][0])          # sea-floor mask per depth
    T = np.where(ocean & clim_valid, T, np.nan); S = np.where(ocean & clim_valid, S, np.nan)
    coords = {"time": pd.DatetimeIndex(times), "depth": np.array(C.DEPTHS, float), "lat": C.LATS, "lon": C.LONS}
    out = xr.Dataset({
        "thetao": (("time", "depth", "lat", "lon"), T.astype("f4"),
                   {"units": "degC", "long_name": "reconstructed sea water potential temperature"}),
        "thetao_sigma": (("time", "depth", "lat", "lon"), S.astype("f4"),
                         {"units": "degC", "long_name": "predicted 1-sigma uncertainty"}),
    }, coords=coords, attrs={"title": "OceanEmbed NIO subsurface temperature reconstruction",
                             "source": "surface satellite observations only (SST, SSS, SLA, currents, winds)",
                             "grid": "0.25 deg, daily", "Conventions": "CF-1.8"})
    return out


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
