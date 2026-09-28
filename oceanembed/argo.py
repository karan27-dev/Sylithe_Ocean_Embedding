"""Independent validation against Argo float profiles (never seen in training).

Profiles are fetched with argopy, QC-filtered ('standard' mode), interpolated to the PS standard
depths with gap limits, then matched to the reconstruction (and to GLORYS / HYCOM for reference) at
the nearest 0.25° cell on the same day.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config as C

# largest allowed gap between the two measurements bracketing a standard depth (m)
MAX_GAP = lambda z: 15 if z <= 100 else (50 if z <= 300 else 150)


def fetch_profiles(start=C.TEST[0], end=C.TEST[1], log=print) -> pd.DataFrame:
    from argopy import DataFetcher
    rows = []
    for m0 in pd.date_range(start, end, freq="MS"):
        m1 = m0 + pd.offsets.MonthBegin(1)
        try:
            ds = DataFetcher(src="erddap", mode="standard").region(
                [C.LON_MIN, C.LON_MAX, C.LAT_MIN, C.LAT_MAX, 0, 1100, str(m0.date()), str(m1.date())]).to_xarray()
        except Exception as e:
            log(f"{m0:%Y-%m}: {e}"); continue
        prof = ds.argo.point2profile()
        P, T = prof["PRES"].values, prof["TEMP"].values
        for i in range(prof.sizes["N_PROF"]):
            z = P[i] * 0.99                     # dbar → m (≈1 % in this depth range; gsw.z_from_p for exact)
            t = T[i]
            ok = np.isfinite(z) & np.isfinite(t)
            z, t = z[ok], t[ok]
            if z.size < 5:
                continue
            o = np.argsort(z); z, t = z[o], t[o]
            vals = []
            for d in C.DEPTHS:
                if d == 0:
                    vals.append(t[0] if z[0] <= 5 else np.nan); continue
                j = np.searchsorted(z, d)
                if j == 0 or j == z.size or (z[j] - z[j - 1]) > MAX_GAP(d):
                    vals.append(np.nan); continue
                vals.append(np.interp(d, z[j - 1:j + 1], t[j - 1:j + 1]))
            rows.append({"time": pd.Timestamp(prof["TIME"].values[i]).normalize(),
                         "lat": float(prof["LATITUDE"].values[i]), "lon": float(prof["LONGITUDE"].values[i]),
                         "platform": int(prof["PLATFORM_NUMBER"].values[i]),
                         **{f"T{d}": v for d, v in zip(C.DEPTHS, vals)}})
        log(f"{m0:%Y-%m}: {len(rows)} profiles so far")
    return pd.DataFrame(rows)


def match(df: pd.DataFrame, field, name: str) -> pd.DataFrame:
    """field: xarray DataArray (time, depth, lat, lon) on the target grid. Adds columns <name>_T<d>."""
    iy = np.clip(np.rint((df.lat.values - C.LAT_MIN) / C.RES).astype(int), 0, len(C.LATS) - 1)
    ix = np.clip(np.rint((df.lon.values - C.LON_MIN) / C.RES).astype(int), 0, len(C.LONS) - 1)
    times = np.asarray(field.time.values, dtype="datetime64[D]")
    it = np.searchsorted(times, df.time.values.astype("datetime64[D]"))
    ok = (it < len(times)) & (times[np.clip(it, 0, len(times) - 1)] == df.time.values.astype("datetime64[D]"))
    out = df.copy()
    for k, d in enumerate(C.DEPTHS):
        col = np.full(len(df), np.nan)
        # load only the rows needed: one (time, depth) slab per unique day
        for u in np.unique(it[ok]):
            sel = ok & (it == u)
            slab = field.isel(time=int(u), depth=k).values
            col[sel] = slab[iy[sel], ix[sel]]
        out[f"{name}_T{d}"] = col
    return out


def score(df: pd.DataFrame, name: str, region=None) -> pd.DataFrame:
    if region:
        r = C.REGIONS[region]
        df = df[df.lat.between(*r["lat"]) & df.lon.between(*r["lon"])]
    rows = []
    for d in C.DEPTHS:
        a, b = df[f"{name}_T{d}"].values, df[f"T{d}"].values
        ok = np.isfinite(a) & np.isfinite(b)
        if ok.sum() < 3:
            rows.append(dict(depth=d, n=int(ok.sum()))); continue
        e = a[ok] - b[ok]
        rows.append(dict(depth=d, n=int(ok.sum()), rmse=float(np.sqrt((e ** 2).mean())),
                         bias=float(e.mean()), r=float(np.corrcoef(a[ok], b[ok])[0, 1])))
    return pd.DataFrame(rows)
