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
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd
import xarray as xr

from . import config as C
from .regrid import bin_average, bin_matrix, daily_mean, to_std_depths, to_target_grid, _std_coords

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


_MARK_LOCK = threading.Lock()


def _mark(path, key):
    with _MARK_LOCK:                              # parallel workers must not overwrite each other's progress
        s = _done(path); s.add(key)
        tmp = path + ".done.json.tmp"
        json.dump(sorted(s), open(tmp, "w"))
        os.replace(tmp, path + ".done.json")      # atomic: a disconnect never leaves a half-written file


def forget(path: str, prefixes: list[str]):
    """Drop progress entries (e.g. ["uc:", "vc:"]) so the next ingest run re-fetches those blocks."""
    with _MARK_LOCK:
        s = {k for k in _done(path) if not any(k.startswith(p) for p in prefixes)}
        json.dump(sorted(s), open(path + ".done.json", "w"))
    return len(s)


def write_block(path: str, da: xr.DataArray, name: str):
    """Region-write a block whose time axis is a contiguous slice of the store's axis."""
    store_time = xr.open_zarr(path).time.values
    i0 = int(np.searchsorted(store_time, da.time.values[0]))
    i1 = i0 + da.sizes["time"]
    order = ["time", "depth", "lat", "lon"] if "depth" in da.dims else ["time", "lat", "lon"]
    ds = da.transpose(*order).astype("f4", copy=False).to_dataset(name=name)
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


def cmems_open(dataset_id: str, variable: str, depth: bool = False, service: str = "arco-geo-series",
               chunk_size_limit: int = -1) -> xr.DataArray:
    import copernicusmarine as cm
    key = (dataset_id, variable, service, chunk_size_limit)
    if key not in _CMEMS_CACHE:
        # Force the map-optimised layout (chunks = 1 day × ~1000² cells). Over a 30-year span the client can
        # otherwise pick "arco-time-series" (chunks = ~3000 days × 16² cells), and then every month we read
        # drags in ~8 years of data per tile: that was the slowness and the RAM growth in the first full run.
        kw = dict(dataset_id=dataset_id, variables=[variable], service=service, chunk_size_limit=chunk_size_limit,
                  **C.BBOX)
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
            da = da.sel(time=slice(t0, t1 + pd.Timedelta(hours=23)))
            # load 8 days at a time (fetched in parallel by dask) and cast to float32 as they arrive, so the
            # whole block never exists as float64
            arr = np.empty(da.shape, dtype=np.float32)
            for i in range(0, da.sizes["time"], 8):
                arr[i:i + 8] = da.isel(time=slice(i, i + 8)).values
            arr *= np.float32(s.scale); arr += np.float32(s.offset)
            return da.copy(data=arr)
    return None


# ------------------------------------------------------------------ NASA PO.DAAC (OSCAR, CCMP)
def _std_time(da: xr.DataArray) -> xr.DataArray:
    """OSCAR v2 decodes time as cftime objects (non-standard calendar); make it numpy datetime64."""
    if "time" in da.dims and not np.issubdtype(da["time"].dtype, np.datetime64):
        da = da.assign_coords(time=pd.to_datetime([t.isoformat() for t in da["time"].values]))
    return da



_PODAAC_CACHE: dict = {}
_PODAAC_LOCKS: dict = {}
_PODAAC_GUARD = threading.Lock()
# The netCDF4/HDF5 C library is not thread-safe: two threads parsing files at once can kill the Python
# process with no traceback ("session crashed for an unknown reason" at 2 GB RAM). Downloads stay
# parallel; only the few seconds of file parsing per block are serialised.
_NETCDF_LOCK = threading.Lock()


def podaac_block(src: C.Source, t0, t1) -> xr.DataArray | None:
    """Download a block of global files once and extract every variable we use from that dataset
    (OSCAR u+v, CCMP uwnd+vwnd), so the second component comes from cache instead of a re-download."""
    key = (src.dataset_id, t0)
    with _PODAAC_GUARD:
        lock = _PODAAC_LOCKS.setdefault(key, threading.Lock())
    with lock:
        if key not in _PODAAC_CACHE:
            _PODAAC_CACHE[key] = _podaac_download(src.dataset_id, t0, t1)
        cached = _PODAAC_CACHE[key]
        if cached is None:
            del _PODAAC_CACHE[key]
            return None
        da = cached.pop(src.variable)
        if not cached:
            del _PODAAC_CACHE[key]                # both components taken: free memory; a retry re-downloads
    return da * np.float32(src.scale) + np.float32(src.offset)


def _podaac_download(dataset_id, t0, t1) -> dict | None:
    import earthaccess
    names = sorted({s.variable for v in C.SOURCES.values() for s in v if s.dataset_id == dataset_id})
    res = earthaccess.search_data(short_name=dataset_id, temporal=(str(t0.date()), str(t1.date())),
                                  bounding_box=(C.LON_MIN, C.LAT_MIN, C.LON_MAX, C.LAT_MAX))
    if not res:
        return None
    tmp = tempfile.mkdtemp(dir="/content" if os.path.isdir("/content") else None)
    try:
        files = earthaccess.download(res, tmp)
        parts = {n: [] for n in names}
        with _NETCDF_LOCK:
            for f in sorted(files):
                with xr.open_dataset(f) as ds:
                    for n in names:
                        da = _std_coords(ds[n])
                        parts[n].append(da.sel(lat=slice(C.LAT_MIN - 1, C.LAT_MAX + 1),
                                               lon=slice(C.LON_MIN - 1, C.LON_MAX + 1)).load().astype("f4"))
        out = {}
        for n in names:
            da = _std_time(xr.concat(parts[n], "time")).sortby("time")
            out[n] = da.sel(time=slice(t0, t1 + pd.Timedelta(hours=23)))
        return out
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
def _fetch_input(var, t0, t1, log):
    for src in C.SOURCES[var]:
        try:
            if src.provider == "cmems":
                da = cmems_block([src], t0, t1)
            elif src.provider == "podaac":
                da = podaac_block(src, t0, t1)
            else:
                da = gee_block(src, t0, t1)
        except Exception as e:   # a failing source falls through to the next one
            log(f"  {var} {t0.date()} {src.provider}:{src.dataset_id} failed: {e!r}")
            da = None
        if da is not None and da.sizes.get("time", 0):
            return da
    return None


def _ingest_input_block(path, var, t0, t1, M_cache, log):
    da = _fetch_input(var, t0, t1, log)
    if da is None:
        return f"!! {var} {t0.date()}–{t1.date()}: no source, left NaN"
    da = daily_mean(_std_coords(da))
    # surface products may carry a length-1 vertical axis (e.g. multi-obs SSS has depth=[0]); drop it
    extra = [d for d in da.dims if d not in ("time", "lat", "lon")]
    if any(da.sizes[d] != 1 for d in extra):
        raise ValueError(f"{var}: unexpected non-singleton dims {extra}")
    da = da.isel({d: 0 for d in extra}, drop=True)
    grid_key = (da.sizes["lat"], da.sizes["lon"], float(da.lat[0]), float(da.lon[0]))
    if grid_key not in M_cache and float(np.abs(np.diff(da.lat.values)).mean()) < C.RES * 0.8:
        M_cache[grid_key] = bin_matrix(da.lat.values, da.lon.values)
    da = to_target_grid(da, M_cache.get(grid_key))
    da = da.reindex(time=pd.date_range(t0, t1, freq="D"))
    write_block(path, da, var)
    _mark(path, f"{var}:{t0.date()}")
    return f"ok {var} {t0.date()}–{t1.date()}  ocean-valid={float(np.isfinite(da).mean()):.2f}"


def _ram():
    try:
        import psutil
        m = psutil.virtual_memory()
        return f"  RAM {m.used / 1e9:.1f}/{m.total / 1e9:.1f} GB"
    except Exception:
        return ""


def _run(tasks, fn, workers, log):
    """Run blocks in parallel threads (the work is network-bound). Each block writes its own time slice
    of the store (chunks are one day), so parallel writes never touch the same chunk."""
    failures = 0
    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(fn, *t): t for t in tasks}
        for i, f in enumerate(as_completed(futs), 1):
            try:
                msg = f.result()
            except Exception as e:
                failures += 1
                msg = f"!! {futs[f][:3]} crashed: {e!r}"
            log(f"[{i}/{len(tasks)}] {msg}{_ram()}")
    log(f"done: {len(tasks) - failures} ok, {failures} failed (re-run the cell to retry only the failures)")


def ingest_inputs(root: str, variables=C.INPUT_VARS, days_per_block=31, workers=4, log=print):
    path = os.path.join(root, "inputs.zarr")
    init_store(path, C.INPUT_VARS, with_depth=False)
    done, M_cache = _done(path), {}
    # block-major order, so paired components (uc/vc, uw/vw) of a block run close together and share a download
    tasks = [(path, v, t0, t1, M_cache, log) for t0, t1 in blocks(C.START, C.END, days_per_block)
             for v in variables if f"{v}:{t0.date()}" not in done]
    log(f"inputs: {len(tasks)} blocks to fetch with {workers} workers")
    _run(tasks, _ingest_input_block, workers, log)


def _ingest_glorys_block(path, srcs, t0, t1, M_box, log):
    da = cmems_block(srcs, t0, t1, depth=True)
    if da is None:
        return f"!! GLORYS {t0.date()}–{t1.date()}: not covered by {[s.dataset_id for s in srcs]}"
    da = to_std_depths(da)                      # vertical first: 15 levels instead of ~35
    if not M_box:
        M_box.append(bin_matrix(da.lat.values, da.lon.values))
    da = to_target_grid(da, M_box[0])
    write_block(path, da, "thetao")
    _mark(path, f"thetao:{t0.date()}")
    return f"ok GLORYS {t0.date()}–{t1.date()}"


def ingest_glorys(root: str, days_per_block=8, workers=2, log=print):
    path = os.path.join(root, "target.zarr")
    init_store(path, ["thetao"], with_depth=True, encode_int16=True)
    srcs = [C.Source("thetao", "cmems", i, C.GLORYS_VAR) for i in C.GLORYS_IDS]
    done, M_box = _done(path), []
    tasks = [(path, srcs, t0, t1, M_box, log) for t0, t1 in blocks(C.START, C.END, days_per_block)
             if f"thetao:{t0.date()}" not in done]
    log(f"GLORYS: {len(tasks)} blocks to fetch with {workers} workers")
    _run(tasks, _ingest_glorys_block, workers, log)


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


# ------------------------------------------------------------------ fast target reader (time-series layout)
def _ts_time_chunk(dataset_id: str, variable: str) -> int:
    """Length (days) of one storage chunk along time in the arco-time-series layout (GLORYS12: 2081)."""
    import copernicusmarine as cm
    part = cm.describe(dataset_id=dataset_id, disable_progress_bar=True).products[0].datasets[0].versions[-1].parts[0]
    for s in part.services:
        if s.service_name == "arco-time-series":
            v = [x for x in s.variables if x.short_name == variable][0]
            return int([c for c in v.coordinates if c.coordinate_id == "time"][0].chunking_length)
    return 365


def depth_plan(src: np.ndarray):
    """For each PS standard depth: (k0, k1, w) so T = (1-w)·level[k0] + w·level[k1]; None below the deepest level.
    Same arithmetic as regrid.to_std_depths (0 m takes the shallowest level)."""
    plan = []
    for z in np.clip(np.array(C.DEPTHS, dtype=float), src[0], None):
        if z > src[-1]:
            plan.append(None); continue
        k = int(np.clip(np.searchsorted(src, z), 1, len(src) - 1))
        plan.append((k - 1, k, float((z - src[k - 1]) / (src[k] - src[k - 1]))))
    return plan


def _level_to_grid(level: xr.DataArray, M) -> np.ndarray:
    """(time, lat, lon) source level → (time, 101, 241) float32 on the target grid (NaN outside this band)."""
    # One read for the whole window: windows follow the storage chunks, so every tile is fetched exactly once
    # (slicing a window in time would re-download the same ~2000-day tiles for each slice).
    lv = level.copy(data=np.asarray(level.values, dtype=np.float32))
    if M is not None:
        return bin_average(lv, M).values
    # native 0.25° (GLORYS2V4): same cell centres as ours, so select exactly instead of interpolating
    return lv.reindex(lat=C.LATS, lon=C.LONS, method="nearest", tolerance=1e-3).values


def ingest_target(root: str, product: str | None = None, band_rows: int = 16, dask_threads: int = 8,
                  write_days: int = 128, log=print):
    """Target reanalysis → target.zarr via the arco-time-series layout.

    The map layout stores 1 day × 1 depth × ~43°×170° per chunk, so each day of our box drags in ~10× its size
    over ~37 levels (2 blocks per 6 min ≈ 40 h for 2005–2023). Here chunks are ~16×16 cells × ~2000 days, so
    we read one storage time-window at a time, level by level, in latitude bands, and only the levels that
    bracket the 15 standard depths. Each window is written once. Resumable per window."""
    import dask
    product = product or C.TARGET_PRODUCT
    did, var = C.TARGETS[product]
    path = os.path.join(root, "target.zarr")
    init_store(path, ["thetao"], with_depth=True, encode_int16=True)
    # chunk_size_limit=1 → dask chunks = storage tiles. The client's default (-1) merges up to 100 tiles per dask
    # chunk, preferring the depth axis, so reading one level loaded dozens of levels at once: the RAM crash.
    da = cmems_open(did, var, depth=True, service="arco-time-series", chunk_size_limit=1)
    src_z = da.depth.values.astype(float)
    plan = depth_plan(src_z)
    tlen = _ts_time_chunk(did, var)
    t_all = pd.DatetimeIndex(da.time.values).normalize()
    i_start = int(t_all.searchsorted(pd.Timestamp(C.START)))
    i_end = int(t_all.searchsorted(pd.Timestamp(C.END), side="right"))
    if i_start >= i_end or t_all[i_start] != pd.Timestamp(C.START) or t_all[i_end - 1] != pd.Timestamp(C.END):
        raise ValueError(f"{did} does not cover {C.START} → {C.END} (has {t_all[0].date()} → {t_all[-1].date()})")
    edges = sorted({i_start, i_end} | {k * tlen for k in range(i_start // tlen + 1, (i_end - 1) // tlen + 1)})
    windows = list(zip(edges[:-1], edges[1:]))
    fine = float(np.abs(np.diff(da.lat.values)).mean()) < C.RES * 0.8
    bands = [(r, min(r + band_rows, len(C.LATS))) for r in range(0, len(C.LATS), band_rows)]
    done = _done(path)
    log(f"target {product} ({did}): {len(windows)} time windows of ≤{tlen} days × {len(bands)} lat bands, "
        f"{len({k for p in plan if p for k in p[:2]})} source levels")
    with dask.config.set(scheduler="threads", num_workers=dask_threads):   # many small HTTP reads: IO-bound
        for i0, i1 in windows:
            key = f"{product}:{t_all[i0].date()}"
            if key in done:
                continue
            out = np.full((i1 - i0, len(C.DEPTHS), len(C.LATS), len(C.LONS)), np.nan, dtype=np.float32)
            for r0, r1 in bands:
                lo, hi = C.LATS[r0] - C.RES / 2, C.LATS[r1 - 1] + C.RES / 2
                sub = da.isel(time=slice(i0, i1)).sel(lat=slice(lo, hi))
                M = bin_matrix(sub.lat.values, sub.lon.values) if fine else None
                cache = {}
                for ti, p in enumerate(plan):
                    if p is None:
                        continue
                    k0, k1, w = p
                    for k in (k0, k1):
                        if k not in cache:
                            cache[k] = _level_to_grid(sub.isel(depth=k), M)
                    for k in [k for k in cache if k < k0]:
                        del cache[k]                                  # keep at most the two levels in use
                    out[:, ti, r0:r1] = (cache[k0][:, r0:r1] * np.float32(1 - w) + cache[k1][:, r0:r1] * np.float32(w))
                del cache
                log(f"  {t_all[i0].date()}–{t_all[i1 - 1].date()}  lat band {C.LATS[r0]:.2f}–{C.LATS[r1 - 1]:.2f}°N done{_ram()}")
            times = t_all[i0:i1]
            for j in range(0, i1 - i0, write_days):                  # small writes: int16 encoding upcasts in memory
                blk = xr.DataArray(out[j:j + write_days], dims=["time", "depth", "lat", "lon"],
                                   coords={"time": times[j:j + write_days], "depth": np.array(C.DEPTHS, float),
                                           "lat": C.LATS, "lon": C.LONS})
                write_block(path, blk, "thetao")
            del out
            _mark(path, key)
            log(f"ok target window {t_all[i0].date()}–{t_all[i1 - 1].date()}{_ram()}")
    log("target done")
