"""PyTorch datasets over the Zarr stores.

Target = temperature anomaly from a smoothed day-of-year GLORYS climatology, divided by a per-depth
std. The network learns the (hard) perturbation; the climatology carries the (easy) background —
the same "background → perturbation" idea the ESSD-2026 paper gets from transfer learning.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import torch
import xarray as xr
from torch.utils.data import Dataset

from . import config as C
from .model import N_STATIC


# ------------------------------------------------------------------ statistics (train period only)
def compute_stats(inputs_path, target_path, out_path, smooth_days=31):
    ds_in = xr.open_zarr(inputs_path).sel(time=slice(*C.TRAIN))
    stats = {}
    for v in C.INPUT_VARS:
        a = ds_in[v]
        stats[f"{v}_mean"] = float(a.mean(skipna=True).compute())
        stats[f"{v}_std"] = float(a.std(skipna=True).compute()) or 1.0

    T = xr.open_zarr(target_path)["thetao"].sel(time=slice(*C.TRAIN))
    clim = T.groupby("time.dayofyear").mean("time").compute()
    # guarantee all 366 slots so clim[doy-1] is always the right day (doy 366 only exists in leap years)
    present = clim.dayofyear.values
    clim = clim.reindex(dayofyear=np.arange(1, 367))                                  # (366, 15, H, W)
    nearest = present[np.abs(np.arange(1, 367)[:, None] - present[None]).argmin(1)]   # empty slot → nearest day
    clim = clim.copy(data=clim.sel(dayofyear=nearest).values)
    k = smooth_days // 2                                                       # circular running mean
    ext = xr.concat([clim.isel(dayofyear=slice(-k, None)), clim, clim.isel(dayofyear=slice(0, k))], "dayofyear")
    clim = ext.rolling(dayofyear=smooth_days, center=True).mean().isel(dayofyear=slice(k, k + 366))
    clim_np = clim.values.astype("f4")
    # per-depth std of the anomaly, subsampled in time to keep it cheap
    sub = T.isel(time=slice(0, None, 7)).compute()
    anom = sub.values - clim_np[sub["time.dayofyear"].values - 1]
    # floor: deep anomalies are tiny, and dividing by ~0 would explode the normalised target
    depth_std = np.maximum(np.nanstd(anom, axis=(0, 2, 3)), 0.05).astype("f4")
    ocean = np.isfinite(clim_np[0, 0]).astype("f4")
    np.savez_compressed(out_path, clim=clim_np, depth_std=depth_std, ocean=ocean,
                        **{k: np.float32(v) for k, v in stats.items()})
    return out_path


def load_stats(path):
    z = np.load(path)
    return {k: z[k] for k in z.files}


# ------------------------------------------------------------------ helpers
def _pad(a, value=0.0):
    ph, pw = C.PAD_H - a.shape[-2], C.PAD_W - a.shape[-1]
    return np.pad(a, [(0, 0)] * (a.ndim - 2) + [(0, ph), (0, pw)], constant_values=value)


def static_channels(ocean, doy):
    H, W = len(C.LATS), len(C.LONS)
    lat = np.broadcast_to(((C.LATS - 17.5) / 12.5)[:, None], (H, W))
    lon = np.broadcast_to(((C.LONS - 75.0) / 30.0)[None, :], (H, W))
    ang = 2 * np.pi * (doy - 1) / 365.25
    return np.stack([ocean, lat, lon, np.full((H, W), np.sin(ang)), np.full((H, W), np.cos(ang))]).astype("f4")


class SurfaceWindows(Dataset):
    """Items: x (V,T,H,W), missing (V,T,H,W), static (5,H,W), y (15,H,W), m (15,H,W), plus physical
    helpers (clim, sst at t). All spatial arrays padded to (PAD_H, PAD_W)."""

    def __init__(self, inputs_path, target_path, stats, period, window=C.TrainConfig.window,
                 train=False, var_dropout=0.0, patch_mask=0.0, need_target=True):
        self.S, self.window, self.train = stats, window, train
        self.var_dropout, self.patch_mask = var_dropout, patch_mask
        ds = xr.open_zarr(inputs_path)
        self.time = pd.DatetimeIndex(ds.time.values)
        # whole input record in RAM as float16 (~2.4 GB for 2005–2023). Normalised one variable at a time
        # so the float32 copy never exists for all 7 at once (that would peak near 5 GB).
        self.inp = np.empty((len(C.INPUT_VARS), ds.sizes["time"], len(C.LATS), len(C.LONS)), dtype="f2")
        for i, v in enumerate(C.INPUT_VARS):
            self.inp[i] = (ds[v].values.astype("f4") - stats[f"{v}_mean"]) / stats[f"{v}_std"]
        self.T = xr.open_zarr(target_path)["thetao"] if need_target else None
        # searchsorted (not get_loc) so the same class works on the monthly stores of the Argo stage
        t0 = int(self.time.searchsorted(pd.Timestamp(period[0])))
        t1 = int(self.time.searchsorted(pd.Timestamp(period[1]), side="right")) - 1
        self.idx = [t for t in range(t0, t1 + 1) if t - window + 1 >= 0]
        self.ocean = stats["ocean"]

    def __len__(self):
        return len(self.idx)

    def __getitem__(self, k):
        t = self.idx[k]
        day = self.time[t]
        doy = min(day.dayofyear, 366)
        x = self.inp[:, t - self.window + 1: t + 1].astype("f4")            # (V, T, H, W)
        miss = ~np.isfinite(x)
        if self.train and self.var_dropout > 0:
            for i, v in enumerate(C.INPUT_VARS):
                if v in C.DROPPABLE_VARS and np.random.rand() < self.var_dropout:
                    miss[i] = True
        target_surface = None
        if self.patch_mask > 0:                                              # SSL: hide 16×16 patches
            target_surface = np.nan_to_num(x[:, -1].copy())
            ph, pw = len(C.LATS) // 16 + 1, len(C.LONS) // 16 + 1
            pm = np.random.rand(ph, pw) < self.patch_mask
            pm = np.kron(pm, np.ones((16, 16), bool))[: len(C.LATS), : len(C.LONS)]
            miss[:, -3:, pm] = True
        x = np.where(miss, 0.0, x).astype("f4")
        item = {
            "x": _pad(x), "missing": _pad(miss.astype("f4"), 1.0),
            "static": _pad(static_channels(self.ocean, doy)),
            "t": np.int64(t),
        }
        sst_phys = x[0, -1] * self.S["sst_std"] + self.S["sst_mean"]
        item["sst"] = _pad(np.where(miss[0, -1], np.nan, sst_phys).astype("f4"), np.nan)
        if target_surface is not None:
            item["surface"] = _pad(target_surface)
            item["surface_mask"] = _pad((pm[None] & (self.ocean > 0)).repeat(len(C.INPUT_VARS), 0).astype("f4"))
        if self.T is not None:
            clim = self.S["clim"][doy - 1]
            Tt = self.T.isel(time=t).values.astype("f4")
            y = (Tt - clim) / self.S["depth_std"][:, None, None]
            m = np.isfinite(y)
            item |= {"y": _pad(np.nan_to_num(y)), "m": _pad(m.astype("f4")),
                     "clim": _pad(np.nan_to_num(clim)), "Ttrue": _pad(np.nan_to_num(Tt))}
        return item


def unpad(a):
    return a[..., : len(C.LATS), : len(C.LONS)]
