"""Ingest every source into Zarr stores on Google Drive, block by block, resumably.

Stores (under DATA_ROOT, e.g. /content/drive/MyDrive/OceanEmbed):
  inputs.zarr   sst sss sla uc vc uw vw          (time, lat, lon)        float32
  target.zarr   thetao                           (time, depth, lat, lon) int16, scale 0.001, offset 20
  hycom.zarr    thetao (independent comparator)  (time, depth, lat, lon) same encoding
Progress lives in <store>.done.json, so a Colab disconnect only loses the block in flight.
"""
from __future__ import annotations

import json
import os
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
import xarray as xr

from . import config as C
from .regrid import bin_matrix, daily_mean, to_std_depths, to_target_grid, _std_coords

T_ENCODING = {"dtype": "int16", "scale_factor": 0.001, "add_offset": 20.0, "_FillValue": -32768}


# ------------------------------------------------------------------ store helpers
def init_store(path: str, names: list[str], with_depth: bool, start=None, end=None, encode_int16=False):
    """Create an empty (all-NaN) store with the full time axis, so later writes are region writes."""
    if os.path.exists(path):
        return
    start, end = start or C.START, end or C.END
    import dask.array as dsa
    time = pd.date_range(start, end, freq="D")
    dims = ["time", "depth", "lat", "lon"] if with_depth else ["time", "lat", "lon"]
    shape = [len(time)] + ([len(C.DEPTHS)] if with_depth else []) + [len(C.LATS), len(C.LONS)]
    chunks = [1] + ([len(C.DEPTHS)] if with_depth else []) + [len(C.LATS), len(C.LONS)]
    coords = {"time": time, "lat": C.LATS, "lon": C.LONS}
    if with_depth:
        coords["depth"] = np.array(C.DEPTHS, dtype=float)
    ds = xr.Dataset({n: (dims, dsa.full(shape, np.nan, chunks=chunks, dtype="f4")) for n in names}, coords=coords)
    enc = {n: dict(T_ENCODING) for n in names} if encode_int16 else {}
    ds.to_zarr(path, compute=False, encoding=enc, mode="w")


def _done(path):
    p = path + ".done.json"
    return set(json.load(open(p))) if os.path.exists(p) else set()


def _mark(path, key):
    s = _done(path); s.add(key)
    json.dump(sorted(s), open(path + ".done.json", "w"))


def write_block(path: str, da: xr.DataArray, name: str):
    """Region-write a block whose time axis is a contiguous slice of the store's axis."""
    store_time = xr.open_zarr(path).time.values
    i0 = int(np.searchsorted(store_time, da.time.values[0]))
    i1 = i0 + da.sizes["time"]
    order = ["time", "depth", "lat", "lon"] if "depth" in da.dims else ["time", "lat", "lon"]
    ds = da.transpose(*order).astype("f4").to_dataset(name=name)
    ds = ds.drop_vars([c for c in ds.coords])   # region writes must not rewrite coordinates
    ds.to_zarr(path, region={d: (slice(i0, i1) if d == "time" else slice(None)) for d in order})


def blocks(start, end, days):
    t = pd.Timestamp(start)
    end = pd.Timestamp(end)
    while t <= end:
        e = min(t + pd.Timedelta(days=days - 1), end)
        yield t, e
        t = e + pd.Timedelta(days=1)


# ------------------------------------------------------------------ Copernicus Marine (OSTIA, SSS, DUACS, GLORYS)
_CMEMS_CACHE: dict = {}


def cmems_open(dataset_id: str, variable: str, depth: bool = False) -> xr.DataArray:
    import copernicusmarine as cm
    key = (dataset_id, variable)
    if key not in _CMEMS_CACHE:
        kw = dict(dataset_id=dataset_id, variables=[variable], **C.BBOX)
        if depth:
            kw.update(minimum_depth=0, maximum_depth=C.GLORYS_MAX_DEPTH)
        _CMEMS_CACHE[key] = _std_coords(cm.open_dataset(**kw)[variable])   # lazy ARCO/Zarr, nothing downloaded yet
    return _CMEMS_CACHE[key]


def cmems_block(sources: list[C.Source], t0, t1, depth=False) -> xr.DataArray | None:
    """First source whose time coverage contains the block wins (REP before NRT, my before myint)."""
    for s in sources:
        if s.provider != "cmems":
            continue
        da = cmems_open(s.dataset_id, s.variable, depth)
        tmin, tmax = pd.Timestamp(da.time.values[0]), pd.Timestamp(da.time.values[-1])
        if tmin <= t0 and tmax >= t1:
            return (da.sel(time=slice(t0, t1 + pd.Timedelta(hours=23))).load() * s.scale + s.offset)
    return None


# ------------------------------------------------------------------ NASA PO.DAAC (OSCAR, CCMP)
def _std_time(da: xr.DataArray) -> xr.DataArray:
    """OSCAR v2 decodes time as cftime objects (non-standard calendar); make it numpy datetime64."""
    if "time" in da.dims and not np.issubdtype(da["time"].dtype, np.datetime64):
        da = da.assign_coords(time=pd.to_datetime([t.isoformat() for t in da["time"].values]))
    return da



def podaac_block(src: C.Source, t0, t1) -> xr.DataArray | None:
    import earthaccess
    res = earthaccess.search_data(short_name=src.dataset_id, temporal=(str(t0.date()), str(t1.date())),
                                  bounding_box=(C.LON_MIN, C.LAT_MIN, C.LON_MAX, C.LAT_MAX))
    if not res:
        return None
    tmp = tempfile.mkdtemp(dir="/content" if os.path.isdir("/content") else None)
    try:
        files = earthaccess.download(res, tmp)
        parts = []
        for f in sorted(files):
            with xr.open_dataset(f) as ds:
                da = _std_coords(ds[src.variable])
                da = da.sel(lat=slice(C.LAT_MIN - 1, C.LAT_MAX + 1),
                            lon=slice(C.LON_MIN - 1, C.LON_MAX + 1)).load()
                parts.append(da)
        da = xr.concat(parts, "time")
        return _std_time(da).sortby("time").sel(time=slice(t0, t1 + pd.Timedelta(hours=23))) * src.scale + src.offset
    finally:
        shutil.rmtree(tmp, ignore_errors=True)   # keeps Colab disk flat


# ------------------------------------------------------------------ Google Earth Engine (fallbacks + HYCOM comparator)
_GRID = {"dimensions": {"width": len(C.LONS), "height": len(C.LATS)},
         "affineTransform": {"scaleX": C.RES, "shearX": 0, "translateX": C.LON_MIN - C.RES / 2,
                             "shearY": 0, "scaleY": -C.RES, "translateY": C.LAT_MAX + C.RES / 2},
         "crsCode": "EPSG:4326"}


def gee_pixels(image) -> np.ndarray:
    """One ee.Image → structured numpy array on the exact target grid (rows flipped to south→north)."""
    import ee
    arr = ee.data.computePixels({"expression": image, "fileFormat": "NUMPY_NDARRAY", "grid": _GRID})
    return arr[::-1]


def gee_day(collection: str, bands: list[str], day: pd.Timestamp, scale=1.0, offset=0.0) -> np.ndarray:
    import ee
    img = (ee.ImageCollection(collection).filterDate(str(day.date()), str((day + pd.Timedelta(days=1)).date()))
           .select(bands).mean().resample("bilinear").toFloat())
    a = gee_pixels(img)
    out = np.stack([a[b].astype("f8") for b in bands]) * scale + offset
    out[np.abs(out) > 1e3] = np.nan
    return out.astype("f4")


def gee_block(src: C.Source, t0, t1, workers=16) -> xr.DataArray:
    days = pd.date_range(t0, t1, freq="D")
    with ThreadPoolExecutor(workers) as ex:
        arrs = list(ex.map(lambda d: gee_day(src.dataset_id, [src.variable], d, src.scale, src.offset)[0], days))
    return xr.DataArray(np.stack(arrs), dims=["time", "lat", "lon"],
                        coords={"time": days, "lat": C.LATS, "lon": C.LONS})


HYCOM_SRC_DEPTHS = [0, 4, 6, 10, 20, 30, 50, 70, 80, 100, 125, 150, 200, 300, 500, 700, 1000]


def hycom_day(day: pd.Timestamp) -> np.ndarray:
    raw = gee_day(C.HYCOM_GEE, [f"water_temp_{d}" for d in HYCOM_SRC_DEPTHS], day, 0.001, 20.0)
    col = xr.DataArray(raw, dims=["depth", "lat", "lon"], coords={"depth": HYCOM_SRC_DEPTHS})
    return col.interp(depth=C.DEPTHS).values.astype("f4")


# ------------------------------------------------------------------ drivers
def ingest_inputs(root: str, variables=C.INPUT_VARS, days_per_block=31, log=print):
    path = os.path.join(root, "inputs.zarr")
    init_store(path, C.INPUT_VARS, with_depth=False)
    M_cache: dict = {}
    for var in variables:
        for t0, t1 in blocks(C.START, C.END, days_per_block):
            key = f"{var}:{t0.date()}"
            if key in _done(path):
                continue
            da = None
            for src in C.SOURCES[var]:
                try:
                    if src.provider == "cmems":
                        da = cmems_block([src], t0, t1)
                    elif src.provider == "podaac":
                        da = podaac_block(src, t0, t1)
                    elif src.provider == "gee":
                        da = gee_block(src, t0, t1)
                except Exception as e:   # a failing source falls through to the next one
                    log(f"  {var} {t0.date()} {src.provider}:{src.dataset_id} failed: {e}")
                    da = None
                if da is not None and da.sizes.get("time", 0):
                    break
            if da is None:
                log(f"!! {var} {t0.date()}–{t1.date()}: no source, left NaN")
                continue
            da = daily_mean(_std_coords(da))
            # surface products may carry a length-1 vertical axis (e.g. multi-obs SSS has depth=[0]); drop it
            extra = [d for d in da.dims if d not in ("time", "lat", "lon")]
            if any(da.sizes[d] != 1 for d in extra):
                raise ValueError(f"{var}: unexpected non-singleton dims {extra}")
            da = da.isel({d: 0 for d in extra}, drop=True)
            grid_key = (da.sizes["lat"], da.sizes["lon"])
            if grid_key not in M_cache and float(np.abs(np.diff(da.lat.values)).mean()) < C.RES * 0.8:
                M_cache[grid_key] = bin_matrix(da.lat.values, da.lon.values)
            da = to_target_grid(da, M_cache.get(grid_key))
            da = da.reindex(time=pd.date_range(t0, t1, freq="D"))
            write_block(path, da, var)
            _mark(path, key)
            log(f"ok {var} {t0.date()}–{t1.date()}  ocean-valid={float(np.isfinite(da).mean()):.2f}")


def ingest_glorys(root: str, days_per_block=8, log=print):
    path = os.path.join(root, "target.zarr")
    init_store(path, ["thetao"], with_depth=True, encode_int16=True)
    srcs = [C.Source("thetao", "cmems", i, C.GLORYS_VAR) for i in C.GLORYS_IDS]
    M = None
    for t0, t1 in blocks(C.START, C.END, days_per_block):
        key = f"thetao:{t0.date()}"
        if key in _done(path):
            continue
        da = cmems_block(srcs, t0, t1, depth=True)
        if da is None:   # block straddles the my/myint seam → do it day by day
            parts = [cmems_block(srcs, d, d, depth=True) for d in pd.date_range(t0, t1)]
            da = xr.concat([p for p in parts if p is not None], "time")
        da = to_std_depths(da)                      # vertical first: 15 levels instead of ~30
        if M is None:
            M = bin_matrix(da.lat.values, da.lon.values)
        da = to_target_grid(da, M)
        write_block(path, da, "thetao")
        _mark(path, key)
        log(f"ok GLORYS {t0.date()}–{t1.date()}")


def ingest_hycom(root: str, start=None, end=None, workers=16, log=print):
    """HYCOM from GEE for the test year only — an independent product to compare against, like the
    paper's comparison with HYCOM/ORAS5/CGOF."""
    start, end = start or C.TEST[0], end or C.TEST[1]
    path = os.path.join(root, "hycom.zarr")
    init_store(path, ["thetao"], with_depth=True, start=start, end=end, encode_int16=True)
    for t0, t1 in blocks(start, end, 31):
        key = f"hycom:{t0.date()}"
        if key in _done(path):
            continue
        days = pd.date_range(t0, t1)
        with ThreadPoolExecutor(workers) as ex:
            cube = np.stack(list(ex.map(hycom_day, days)))
        da = xr.DataArray(cube, dims=["time", "depth", "lat", "lon"],
                          coords={"time": days, "depth": C.DEPTHS, "lat": C.LATS, "lon": C.LONS})
        write_block(path, da, "thetao")
        _mark(path, key)
        log(f"ok HYCOM {t0.date()}–{t1.date()}")


# ------------------------------------------------------------------ Stage-A transfer learning data (paper §2.2.2)
def ingest_gridded_argo(root: str, nc_paths: list[str], variable: str, log=print):
    """Monthly gridded Argo (INCOIS LAS export, or Roemmich–Gilson) → argo_monthly.zarr on our grid,
    plus inputs_monthly.zarr (monthly means of inputs.zarr) on the same monthly time axis."""
    ds = xr.open_mfdataset(nc_paths, combine="by_coords")
    da = _std_coords(ds[variable])
    if "time" not in da.dims:
        da = da.rename({[d for d in da.dims if d not in ("depth", "lat", "lon")][0]: "time"})
    da = da.sel(lat=slice(C.LAT_MIN - 2, C.LAT_MAX + 2), lon=slice(C.LON_MIN - 2, C.LON_MAX + 2)).load()
    da = to_std_depths(da).interp(lat=C.LATS, lon=C.LONS)                  # 1° → 0.25° linear (paper Table 1)
    da["time"] = pd.DatetimeIndex(da.time.values).to_period("M").to_timestamp()
    inp = xr.open_zarr(os.path.join(root, "inputs.zarr")).resample(time="MS").mean()
    common = np.intersect1d(inp.time.values, da.time.values)
    inp.sel(time=common).chunk({"time": 1}).to_zarr(os.path.join(root, "inputs_monthly.zarr"), mode="w")
    da.sel(time=common).transpose("time", "depth", "lat", "lon").astype("f4").to_dataset(name="thetao") \
      .chunk({"time": 1}).to_zarr(os.path.join(root, "argo_monthly.zarr"), mode="w")
    log(f"gridded Argo: {len(common)} months aligned")
