"""Independent validation against Argo float profiles (never seen in training).

Profiles come straight from the Ifremer Argo ERDDAP (the server argopy itself queries), as CSV via
pandas: no extra dependency to break. Standard Argo QC: delayed/adjusted mode ('D'/'A') uses the
*_adjusted variables, real-time ('R') the raw ones, and only flags 1–2 (good / probably good) are kept
for position, pressure and temperature. Profiles are then interpolated to the PS standard depths with
gap limits and matched to the reconstruction (and GLORYS / HYCOM) at the nearest 0.25° cell, same day.
"""
from __future__ import annotations

import io
import time
import urllib.parse
import urllib.request

import numpy as np
import pandas as pd

from . import config as C

ERDDAP = "https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.csv"
COLS = ["platform_number", "cycle_number", "time", "latitude", "longitude", "position_qc", "data_mode",
        "pres_adjusted", "pres_adjusted_qc", "temp_adjusted", "temp_adjusted_qc", "pres", "pres_qc", "temp", "temp_qc"]
GOOD = {1, 2}

# largest allowed gap between the two measurements bracketing a standard depth (m)
MAX_GAP = lambda z: 15 if z <= 100 else (50 if z <= 300 else 150)


def _query(t0: pd.Timestamp, t1: pd.Timestamp, bbox=None, retries=3) -> pd.DataFrame:
    lat0, lat1, lon0, lon1 = bbox or (C.LAT_MIN, C.LAT_MAX, C.LON_MIN, C.LON_MAX)
    cons = [f"latitude>={lat0}", f"latitude<={lat1}", f"longitude>={lon0}", f"longitude<={lon1}",
            f"time>={t0:%Y-%m-%dT%H:%M:%SZ}", f"time<{t1:%Y-%m-%dT%H:%M:%SZ}", "pres<=1100"]
    url = ERDDAP + "?" + ",".join(COLS) + "&" + "&".join(urllib.parse.quote(c, safe="=") for c in cons)
    for k in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=300) as r:
                return pd.read_csv(io.BytesIO(r.read()), skiprows=[1])        # row 1 = units
        except urllib.error.HTTPError as e:
            if e.code == 404:                                                  # ERDDAP: "no matching rows"
                return pd.DataFrame(columns=COLS)
            err = e
        except Exception as e:
            err = e
        time.sleep(5 * (k + 1))
    raise err


def _qc(df: pd.DataFrame) -> pd.DataFrame:
    adj = df["data_mode"].isin(["A", "D"])
    df = df.assign(
        z=np.where(adj, df["pres_adjusted"], df["pres"]) * 0.99,               # dbar → m (≈1 % here)
        t=np.where(adj, df["temp_adjusted"], df["temp"]),
        zq=np.where(adj, df["pres_adjusted_qc"], df["pres_qc"]),
        tq=np.where(adj, df["temp_adjusted_qc"], df["temp_qc"]),
    )
    ok = df["position_qc"].isin(GOOD) & df["zq"].isin(GOOD) & df["tq"].isin(GOOD) & df["z"].notna() & df["t"].notna()
    return df[ok]


def to_std_depths(z: np.ndarray, t: np.ndarray) -> list[float]:
    o = np.argsort(z); z, t = z[o], t[o]
    vals = []
    for d in C.DEPTHS:
        if d == 0:
            vals.append(t[0] if z[0] <= 5 else np.nan); continue
        j = np.searchsorted(z, d)
        if j == 0 or j == z.size or (z[j] - z[j - 1]) > MAX_GAP(d):
            vals.append(np.nan); continue
        vals.append(float(np.interp(d, z[j - 1:j + 1], t[j - 1:j + 1])))
    return vals


def fetch_profiles(start=None, end=None, bbox=None, log=print) -> pd.DataFrame:
    start, end = start or C.TEST[0], end or C.TEST[1]
    rows = []
    for m0 in pd.date_range(start, end, freq="MS"):
        m1 = m0 + pd.offsets.MonthBegin(1)
        df = _qc(_query(m0, m1, bbox))
        for (pl, cy), g in df.groupby(["platform_number", "cycle_number"]):
            if len(g) < 5:
                continue
            rows.append({"time": pd.Timestamp(g["time"].iloc[0]).tz_localize(None).normalize(),
                         "lat": float(g["latitude"].iloc[0]), "lon": float(g["longitude"].iloc[0]),
                         "platform": int(pl), "cycle": int(cy),
                         **{f"T{d}": v for d, v in zip(C.DEPTHS, to_std_depths(g["z"].values, g["t"].values))}})
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
