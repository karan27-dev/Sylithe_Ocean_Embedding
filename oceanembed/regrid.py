"""Harmonisation to the 0.25° daily target grid.

Rule: a source finer than the target (OSTIA 0.05°, GLORYS 1/12°, DUACS/SSS 0.125°) is
area-averaged into each 0.25° cell (NaN-aware, so coastlines are not smeared with land);
a source at the same or coarser resolution (OSCAR, CCMP) is bilinearly interpolated.
Vertical profiles are linearly interpolated to the PS standard depths.
"""
import numpy as np
import xarray as xr
from scipy import sparse

from .config import LATS, LONS, RES, DEPTHS


_NAMES = {"lat": ("lat", "latitude", "y", "nav_lat"), "lon": ("lon", "longitude", "x", "nav_lon"),
          "depth": ("depth", "lev", "z")}


def _std_coords(da: xr.DataArray) -> xr.DataArray:
    """Normalise to 1-D *indexed* coords named lat / lon / depth, whatever the product's layout:
    dims latitude/longitude with index coords (Copernicus), dims longitude/latitude with separate
    non-index lat/lon variables (OSCAR v2), un-indexed coords, 0–360 longitudes, descending latitudes."""
    for kind, names in _NAMES.items():
        coord = next((c for c in da.coords if c.lower() in names and da[c].ndim == 1), None)
        dim = da[coord].dims[0] if coord is not None else next((d for d in da.dims if d.lower() in names), None)
        if dim is None:
            continue
        vals = da[coord].values if coord is not None else np.arange(da.sizes[dim])
        drop = [c for c in da.coords if c != dim and dim in da[c].dims and da[c].ndim == 1]
        da = da.drop_vars(drop + ([dim] if dim in da.coords else []))
        if dim != kind:
            da = da.rename({dim: kind})
        da = da.assign_coords({kind: vals})
    if "lon" in da.dims and float(da.lon.max()) > 180:
        da = da.assign_coords(lon=((da.lon + 180) % 360) - 180).sortby("lon")
    if "lat" in da.dims:
        da = da.sortby("lat")
    return da


def bin_matrix(src_lat: np.ndarray, src_lon: np.ndarray) -> sparse.csr_matrix:
    """Sparse (n_target, n_source) averaging matrix: each source cell → the 0.25° cell holding its centre.
    Weights include cos(lat) so the mean is area-weighted."""
    iy = np.floor((src_lat - (LATS[0] - RES / 2)) / RES).astype(int)
    ix = np.floor((src_lon - (LONS[0] - RES / 2)) / RES).astype(int)
    YY, XX = np.meshgrid(iy, ix, indexing="ij")
    w = np.cos(np.deg2rad(src_lat))[:, None].repeat(len(src_lon), 1)
    ok = (YY >= 0) & (YY < len(LATS)) & (XX >= 0) & (XX < len(LONS))
    rows = (YY * len(LONS) + XX)[ok]
    cols = np.arange(YY.size).reshape(YY.shape)[ok]
    return sparse.csr_matrix((w[ok], (rows, cols)), shape=(len(LATS) * len(LONS), YY.size))


def bin_average(da: xr.DataArray, M: sparse.csr_matrix | None = None) -> xr.DataArray:
    """NaN-aware area mean onto the target grid. Works for any leading dims (time, depth, ...)."""
    da = _std_coords(da)
    if M is None:
        M = bin_matrix(da.lat.values, da.lon.values)
    lead = [d for d in da.dims if d not in ("lat", "lon")]
    da = da.transpose(*lead, "lat", "lon")
    x = da.values.reshape(-1, da.sizes["lat"] * da.sizes["lon"])
    valid = np.isfinite(x)
    num = (M @ np.where(valid, x, 0.0).T).T
    den = (M @ valid.T.astype(np.float64)).T
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(den > 0, num / den, np.nan)
    shape = [da.sizes[d] for d in lead] + [len(LATS), len(LONS)]
    coords = {d: da[d] for d in lead} | {"lat": LATS, "lon": LONS}
    return xr.DataArray(out.reshape(shape).astype(np.float32), dims=lead + ["lat", "lon"],
                        coords=coords, name=da.name, attrs=da.attrs)


def to_target_grid(da: xr.DataArray, M=None) -> xr.DataArray:
    da = _std_coords(da)
    src_res = float(np.abs(np.diff(da.lat.values)).mean())
    if src_res < RES * 0.8:
        return bin_average(da, M)
    return da.interp(lat=LATS, lon=LONS, method="linear").astype(np.float32)


def to_std_depths(da: xr.DataArray) -> xr.DataArray:
    """Linear interpolation in depth. 0 m takes the shallowest model level (GLORYS top ≈ 0.49 m).
    Columns shallower than a standard depth stay NaN (sea floor), never extrapolated."""
    da = _std_coords(da)
    top = float(da.depth.min())
    tgt = np.clip(np.array(DEPTHS, dtype=float), top, None)
    out = da.interp(depth=tgt, method="linear")
    return out.assign_coords(depth=np.array(DEPTHS, dtype=float))


def daily_mean(da: xr.DataArray) -> xr.DataArray:
    return da.resample(time="1D").mean() if "time" in da.dims else da
