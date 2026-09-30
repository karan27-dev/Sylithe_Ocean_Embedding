"""Skill metrics (PS: correlation, RMSE, bias) plus the ocean-physics diagnostics used in the UI:
isotherm depths D20/D26, mixed-layer depth, upper-ocean heat content and Tropical Cyclone Heat
Potential (TCHP) — the operational Disaster-Management quantity for Bay of Bengal cyclones."""
from __future__ import annotations

import numpy as np

from .config import DEPTHS, REGIONS, LATS, LONS

Z = np.array(DEPTHS, dtype=float)
RHO, CP = 1025.0, 3985.0


def skill(pred, true, axis=None):
    """pred/true (..., depth, lat, lon) with NaN where invalid. Returns rmse, bias, r, n per depth."""
    ok = np.isfinite(pred) & np.isfinite(true)
    out = {}
    for k in range(pred.shape[-3]):
        p, t = pred[..., k, :, :][ok[..., k, :, :]], true[..., k, :, :][ok[..., k, :, :]]
        if p.size < 3:
            out[DEPTHS[k]] = dict(rmse=np.nan, bias=np.nan, r=np.nan, n=int(p.size)); continue
        d = p - t
        out[DEPTHS[k]] = dict(rmse=float(np.sqrt((d ** 2).mean())), bias=float(d.mean()),
                             r=float(np.corrcoef(p, t)[0, 1]), n=int(p.size))
    return out


def region_mask(name):
    r = REGIONS[name]
    la = (LATS >= r["lat"][0]) & (LATS <= r["lat"][1])
    lo = (LONS >= r["lon"][0]) & (LONS <= r["lon"][1])
    return la[:, None] & lo[None, :]


def _fine(T, dz=1.0, zmax=1000.0):
    """Linear interpolation of a (depth, ...) column stack onto a 1 m grid."""
    zf = np.arange(0, zmax + dz, dz)
    flat = T.reshape(len(Z), -1)
    out = np.full((len(zf), flat.shape[1]), np.nan, dtype="f4")
    for j in range(flat.shape[1]):
        c = flat[:, j]
        ok = np.isfinite(c)
        if ok.sum() >= 2:
            zmax_ok = Z[ok].max()
            v = np.interp(zf, Z[ok], c[ok])
            v[zf > zmax_ok] = np.nan
            out[:, j] = v
    return zf, out.reshape((len(zf),) + T.shape[1:])


def isotherm_depth(T, iso):
    """Depth (m) where temperature first drops below `iso`. T: (depth, lat, lon)."""
    zf, Tf = _fine(T)
    below = Tf <= iso
    idx = np.argmax(below, axis=0).astype(float)
    idx[~below.any(0)] = np.nan
    idx[~np.isfinite(Tf[0])] = np.nan
    return idx * (zf[1] - zf[0])


def tchp(T):
    """kJ cm⁻² : ρ·cp·∫₀^D26 (T − 26) dz. Zero where SST < 26 °C."""
    zf, Tf = _fine(T, zmax=300.0)
    excess = np.clip(np.nan_to_num(Tf, nan=0.0) - 26.0, 0, None)
    # stop integrating once below the 26 °C isotherm
    below = np.cumsum(np.nan_to_num(Tf, nan=0.0) < 26.0, axis=0) > 0
    excess[below] = 0
    J = RHO * CP * np.trapezoid(excess, dx=zf[1] - zf[0], axis=0)   # J m⁻²
    out = J / 1e7                                               # → kJ cm⁻²
    out[~np.isfinite(T[0])] = np.nan
    return out


def mld(T, dT=0.5):
    """Temperature-criterion mixed-layer depth relative to 10 m (de Boyer Montégut style)."""
    zf, Tf = _fine(T)
    ref = Tf[10]
    below = Tf < (ref - dT)[None]
    below[:10] = False
    d = np.argmax(below, axis=0).astype(float) * (zf[1] - zf[0])
    d[~below.any(0)] = np.nan
    return d


def heat_content(T, zmax=300.0):
    zf, Tf = _fine(T, zmax=zmax)
    return RHO * CP * np.nansum(Tf, 0) * (zf[1] - zf[0])        # J m⁻² (relative to 0 °C)


# ---------------------------------------------------------------- vectorised, exact piecewise-linear versions
# Same definitions as above (and as the web console's ocean.js), evaluated on the 15 standard levels with
# linear interpolation between them, for every column at once: ~1000× faster than the 1 m resampling above.
# Used by the daily pipeline, which needs these diagnostics for 365 days × ~24k cells.

def _cols(T):
    """(depth, ...) → (depth, n) float64 plus the original trailing shape."""
    T = np.asarray(T, dtype="f8")
    return T.reshape(T.shape[0], -1), T.shape[1:]


def isotherm_depth_fast(T, iso):
    A, shape = _cols(T)
    out = np.full(A.shape[1], np.nan)
    surf = A[0]
    out[surf <= iso] = 0.0
    todo = np.isfinite(surf) & (surf > iso)
    for k in range(1, len(Z)):
        t0, t1 = A[k - 1], A[k]
        hit = todo & np.isfinite(t1) & (t1 <= iso)
        with np.errstate(invalid="ignore", divide="ignore"):
            out[hit] = Z[k - 1] + (t0[hit] - iso) / (t0[hit] - t1[hit]) * (Z[k] - Z[k - 1])
        todo &= ~hit & np.isfinite(t1)                 # sea floor reached: stays NaN
    out[~np.isfinite(surf)] = np.nan
    return out.reshape(shape)


def tchp_fast(T):
    """kJ cm⁻², exact integral of (T − 26)⁺ down to the 26 °C isotherm of the piecewise-linear profile."""
    A, shape = _cols(T)
    J = np.zeros(A.shape[1])
    live = np.isfinite(A[0]) & (A[0] > 26)
    for k in range(1, len(Z)):
        t0, t1, dz = A[k - 1], A[k], Z[k] - Z[k - 1]
        ok = live & np.isfinite(t1)
        full = ok & (t1 >= 26)
        J[full] += ((t0[full] + t1[full]) / 2 - 26) * dz
        part = ok & (t1 < 26)
        with np.errstate(invalid="ignore", divide="ignore"):
            zc = (t0[part] - 26) / (t0[part] - t1[part]) * dz
        J[part] += (t0[part] - 26) / 2 * zc
        live &= full
    out = RHO * CP * J / 1e7
    out[~np.isfinite(A[0])] = np.nan
    return out.reshape(shape)


def mld_fast(T, dT=0.5):
    A, shape = _cols(T)
    ref = A[2]                                          # 10 m
    thr = ref - dT
    out = np.full(A.shape[1], np.nan)
    todo = np.isfinite(ref)
    for k in range(3, len(Z)):
        t0, t1 = A[k - 1], A[k]
        hit = todo & np.isfinite(t1) & (t1 < thr)
        with np.errstate(invalid="ignore", divide="ignore"):
            out[hit] = Z[k - 1] + (t0[hit] - thr[hit]) / (t0[hit] - t1[hit]) * (Z[k] - Z[k - 1])
        todo &= ~hit & np.isfinite(t1)
    return out.reshape(shape)
