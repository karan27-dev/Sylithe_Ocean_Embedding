"""PyTorch datasets over the Zarr stores.

Target = temperature anomaly from a smoothed day-of-year GLORYS climatology, divided by a per-depth
std. The network learns the (hard) perturbation; the climatology carries the (easy) background —
the same "background → perturbation" idea the ESSD-2026 paper gets from transfer learning.

Inputs are given twice: normalised raw fields (absolute state, e.g. how warm the mixed layer is) and
normalised day-of-year anomalies (the perturbation that drives subsurface anomalies). All climatologies
and statistics come from the training years only, so nothing leaks from validation/test.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import torch
import xarray as xr
from torch.utils.data import Dataset

from . import config as C
from .model import N_STATIC


N_VARS = len(C.INPUT_VARS)
N_IN = 2 * N_VARS                     # raw + anomaly channel per variable


# ------------------------------------------------------------------ statistics (train period only)
def _doy_climatology(da: xr.DataArray, smooth_days: int) -> np.ndarray:
    """Day-of-year mean with all 366 slots filled and a circular running mean. Returns (366, ...) float32."""
    clim = da.groupby("time.dayofyear").mean("time").compute()
    present = clim.dayofyear.values
    clim = clim.reindex(dayofyear=np.arange(1, 367))
    nearest = present[np.abs(np.arange(1, 367)[:, None] - present[None]).argmin(1)]   # empty slot → nearest day
    clim = clim.copy(data=clim.sel(dayofyear=nearest).values)
    k = smooth_days // 2
    ext = xr.concat([clim.isel(dayofyear=slice(-k, None)), clim, clim.isel(dayofyear=slice(0, k))], "dayofyear")
    return ext.rolling(dayofyear=smooth_days, center=True).mean().isel(dayofyear=slice(k, k + 366)).values.astype("f4")


def compute_stats(inputs_path, target_path, out_path, smooth_days=31):
    ds_in = xr.open_zarr(inputs_path).sel(time=slice(*C.TRAIN))
    T = xr.open_zarr(target_path)["thetao"].sel(time=slice(*C.TRAIN))
    ocean_da = T.isel(time=0, depth=0).notnull().compute()        # GLORYS sea mask (winds/SST also cover land/lakes)
    stats = {}
    inclim = []
    for v in C.INPUT_VARS:
        a = ds_in[v].where(ocean_da.values)
        stats[f"{v}_mean"] = float(a.mean(skipna=True).compute())
        stats[f"{v}_std"] = float(a.std(skipna=True).compute()) or 1.0
        c = _doy_climatology(a, smooth_days)                                     # (366, H, W)
        sub = a.isel(time=slice(0, None, 7)).compute()
        stats[f"{v}_astd"] = float(np.nanstd(sub.values - c[sub["time.dayofyear"].values - 1])) or 1.0
        inclim.append(c)

    clim_np = _doy_climatology(T, smooth_days)                                   # (366, 15, H, W)
    # per-depth std of the anomaly, subsampled in time to keep it cheap
    sub = T.isel(time=slice(0, None, 7)).compute()
    anom = sub.values - clim_np[sub["time.dayofyear"].values - 1]
    # floor: deep anomalies are tiny, and dividing by ~0 would explode the normalised target
    depth_std = np.maximum(np.nanstd(anom, axis=(0, 2, 3)), 0.05).astype("f4")
    ocean = np.isfinite(clim_np[0, 0]).astype("f4")
    np.savez_compressed(out_path, clim=clim_np, depth_std=depth_std, ocean=ocean, inclim=np.stack(inclim),
                        **{k: np.float32(v) for k, v in stats.items()})
    return out_path


def load_stats(path):
    z = np.load(path)
    if "inclim" not in z.files:
        raise ValueError(f"{path} predates the anomaly inputs: delete it and re-run compute_stats")
    return {k: z[k] for k in z.files}


def worker_init(worker_id):
    """Give every DataLoader worker its own numpy seed. Forked workers otherwise share one RNG state and
    apply identical random masks, which silently weakens the augmentation."""
    np.random.seed((torch.initial_seed() + worker_id) % 2 ** 32)


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


_INPUT_CACHE: dict = {}


def _load_inputs(inputs_path, stats) -> np.ndarray:
    """Whole input record in RAM as float16 (~2.4 GB for 2005–2023), shared by every dataset built on the same
    store (train/val/SSL/baselines); separate copies would need ~10 GB. Normalised one variable at a time so
    the float32 copy never exists for all 7 at once."""
    key = (inputs_path, float(stats["sst_mean"]))
    if key not in _INPUT_CACHE:
        _INPUT_CACHE.clear()
        ds = xr.open_zarr(inputs_path)
        inp = np.empty((len(C.INPUT_VARS), ds.sizes["time"], len(C.LATS), len(C.LONS)), dtype="f2")
        land = stats["ocean"] <= 0
        for i, v in enumerate(C.INPUT_VARS):
            a = (ds[v].values.astype("f4") - stats[f"{v}_mean"]) / stats[f"{v}_std"]
            a[:, land] = np.nan                                   # land → "missing", never a value
            inp[i] = a
        _INPUT_CACHE[key] = inp
    return _INPUT_CACHE[key]


_TARGET_CACHE: dict = {}


def _load_target(target_path) -> tuple[np.ndarray, float, float, int]:
    """Whole target record in RAM in its stored int16 encoding (~5 GB for 2005–2023), read once in the main
    process. DataLoader workers then only index memory. Reading the Zarr store inside forked workers deadlocks:
    zarr's background I/O thread does not survive fork (the first RunPod run hung for hours at epoch 0)."""
    if target_path not in _TARGET_CACHE:
        _TARGET_CACHE.clear()
        da = xr.open_zarr(target_path, mask_and_scale=False)["thetao"]
        a = da.attrs | da.encoding
        raw = da.values
        _TARGET_CACHE[target_path] = (raw, float(a.get("scale_factor", 1.0)), float(a.get("add_offset", 0.0)),
                                      a.get("_FillValue", None))
    return _TARGET_CACHE[target_path]


class SurfaceWindows(Dataset):
    """Items: x (2V,T,H,W) = [raw, anomaly], missing (2V,T,H,W), static (5,H,W), y (15,H,W), m (15,H,W),
    plus physical helpers (clim, sst at t). All spatial arrays padded to (PAD_H, PAD_W)."""

    def __init__(self, inputs_path, target_path, stats, period, window=C.TrainConfig.window,
                 train=False, var_dropout=0.0, patch_mask=0.0, need_target=True):
        self.S, self.window, self.train = stats, window, train
        self.var_dropout, self.patch_mask = var_dropout, patch_mask
        ds = xr.open_zarr(inputs_path)
        self.time = pd.DatetimeIndex(ds.time.values)
        self.inp = _load_inputs(inputs_path, stats)
        self.T = _load_target(target_path) if need_target else None
        # searchsorted (not get_loc) so the same class works on the monthly stores of the Argo stage
        t0 = int(self.time.searchsorted(pd.Timestamp(period[0])))
        t1 = int(self.time.searchsorted(pd.Timestamp(period[1]), side="right")) - 1
        self.idx = [t for t in range(t0, t1 + 1) if t - window + 1 >= 0]
        self.ocean = stats["ocean"]
        self.doy = np.minimum(self.time.dayofyear.values, 366)
        self.mean = np.array([stats[f"{v}_mean"] for v in C.INPUT_VARS], "f4")[:, None, None, None]
        self.std = np.array([stats[f"{v}_std"] for v in C.INPUT_VARS], "f4")[:, None, None, None]
        self.astd = np.array([stats[f"{v}_astd"] for v in C.INPUT_VARS], "f4")[:, None, None, None]

    def _anomalies(self, raw, t):
        """(V, T, H, W) normalised raw → normalised day-of-year anomalies for the same window."""
        doys = self.doy[t - self.window + 1: t + 1] - 1
        clim = self.S["inclim"][:, doys]                                    # (V, T, H, W)
        return ((raw * self.std + self.mean) - clim) / self.astd

    def __len__(self):
        return len(self.idx)

    def __getitem__(self, k):
        t = self.idx[k]
        day = self.time[t]
        doy = min(day.dayofyear, 366)
        raw = self.inp[:, t - self.window + 1: t + 1].astype("f4")          # (V, T, H, W)
        x = np.concatenate([raw, self._anomalies(raw, t)])                   # (2V, T, H, W)
        miss = ~np.isfinite(x)
        if self.train and self.var_dropout > 0:
            for i, v in enumerate(C.INPUT_VARS):
                if v in C.DROPPABLE_VARS and np.random.rand() < self.var_dropout:
                    miss[i] = miss[i + N_VARS] = True                   # drop raw and anomaly together
        target_surface = None
        if self.patch_mask > 0:                                              # SSL: hide 16×16 patches
            target_surface = np.nan_to_num(x[:N_VARS, -1].copy())              # reconstruct the raw fields
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
            item["surface_mask"] = _pad((pm[None] & (self.ocean > 0)).repeat(N_VARS, 0).astype("f4"))
        if self.T is not None:
            clim = self.S["clim"][doy - 1]
            raw, scale, offset, fill = self.T
            enc = raw[t]
            Tt = enc.astype("f4") * np.float32(scale) + np.float32(offset) if raw.dtype.kind == "i" else enc.astype("f4")
            if fill is not None:
                Tt[enc == fill] = np.nan
            y = (Tt - clim) / self.S["depth_std"][:, None, None]
            m = np.isfinite(y)
            item |= {"y": _pad(np.nan_to_num(y)), "m": _pad(m.astype("f4")),
                     "clim": _pad(np.nan_to_num(clim)), "Ttrue": _pad(np.nan_to_num(Tt))}
        return item


def unpad(a):
    return a[..., : len(C.LATS), : len(C.LONS)]
