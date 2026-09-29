"""Build the console's pre-training demo data in format v2 (see oceanembed/webexport.py).

Until the model is trained, the console shows real HYCOM GOFS 3.1 daily-mean fields pulled from Google Earth
Engine (web/data-src/hycom_*.json) and scores them against real Argo profiles, so every screen of the
console works on genuine data and nothing is invented. Notebook 03 overwrites this folder with model output.

    PYTHONUTF8=1 python web/scripts/build_demo_data.py          (from the repo root; needs numpy + pandas)

The GEE export was sampled coarsely and carries values onto land (Sri Lanka, the Malay peninsula), so
every field is masked with a 0.25° land mask from Natural Earth 1:50m land polygons (cell centres; built once
into web/data-src/land_mask_0p25.npy, north→south rows).

Argo floats surface every 5–10 days, so profiles within ±WINDOW days of each field day are matched to that
day's field. The manifest records this; the model export matches same-day only.
"""
import glob
import json
import os
import shutil
import sys
import urllib.request

import numpy as np
import pandas as pd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)
from oceanembed import argo as A, config as C, webexport as W  # noqa: E402

SRC = os.path.join(ROOT, "web", "data-src")
OUT = os.path.join(ROOT, "web", "public", "data")
WINDOW = 3
NOTES = {"2024-01-15": "Northeast monsoon · Bay of Bengal barrier layer",
         "2024-05-15": "Pre-monsoon · peak cyclone-season heat"}


NE_LAND = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson"
MASK = os.path.join(SRC, "land_mask_0p25.npy")


def land_mask() -> np.ndarray:
    """(H, W) bool, north→south rows, True where the cell centre is on land."""
    if os.path.exists(MASK):
        return np.load(MASK)
    from matplotlib.path import Path
    geo = json.load(urllib.request.urlopen(NE_LAND, timeout=120))
    lats = C.LAT_MAX - np.arange(len(C.LATS)) * C.RES
    lon2, lat2 = np.meshgrid(C.LONS, lats)
    pts = np.column_stack([lon2.ravel(), lat2.ravel()])
    land = np.zeros(len(pts), bool)
    for feat in geo["features"]:
        g = feat["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            ring = np.asarray(poly[0])
            if ring[:, 0].max() < C.LON_MIN - 1 or ring[:, 0].min() > C.LON_MAX + 1 or                ring[:, 1].max() < C.LAT_MIN - 1 or ring[:, 1].min() > C.LAT_MAX + 1:
                continue
            inside = Path(ring).contains_points(pts)
            land |= inside
    mask = land.reshape(lon2.shape)
    np.save(MASK, mask)
    return mask


class Field:
    """The two things argo.match needs from an xarray DataArray: .time.values and .isel(...).values."""

    def __init__(self, days, cube):             # cube: (time, depth, lat south→north, lon)
        self.cube = cube
        self.time = type("T", (), {"values": np.array(days, dtype="datetime64[ns]")})

    def isel(self, time, depth):
        return type("V", (), {"values": self.cube[time, depth]})


def to_array(grid):
    return np.array([[np.nan if v is None else v for v in row] for row in grid], dtype="f8")


def profiles_near(day: pd.Timestamp) -> pd.DataFrame:
    df = A._qc(A._query(day - pd.Timedelta(days=WINDOW), day + pd.Timedelta(days=WINDOW + 1)))
    rows = []
    for (pl, cy), g in df.groupby(["platform_number", "cycle_number"]):
        if len(g) < 5:
            continue
        t = pd.Timestamp(g["time"].iloc[0]).tz_localize(None)
        rows.append({"time": day, "obs_time": t, "lat": float(g["latitude"].iloc[0]),
                     "lon": float(g["longitude"].iloc[0]), "platform": int(pl), "cycle": int(cy),
                     **{f"T{d}": v for d, v in zip(C.DEPTHS, A.to_std_depths(g["z"].values, g["t"].values))}})
    return pd.DataFrame(rows)


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    ex = W.WebExport(OUT, "reference", "HYCOM GOFS 3.1 daily mean",
                     "Independent ocean model via Google Earth Engine, with NOAA OISST v2.1 as the surface input. "
                     "Shown until the OceanEmbed reconstruction is exported by notebook 03.")
    land = land_mask()
    days, cubes = [], []
    for path in sorted(glob.glob(os.path.join(SRC, "hycom_*.json"))):
        f = json.load(open(path, encoding="utf-8"))
        temp = np.stack([to_array(l) for l in f["temp"]])        # north→south
        temp[:, land] = np.nan
        sst = to_array(f["sst"]); sst[land] = np.nan
        ex.add(f["date"], "temp", temp, north_up=True, note=NOTES.get(f["date"]))
        ex.add(f["date"], "sst", sst, north_up=True)
        days.append(f["date"]); cubes.append(temp[:, ::-1])       # south→north for argo.match
        print(f["date"], "field written")

    field = Field(days, np.stack(cubes))
    matched = []
    for d in days:
        p = profiles_near(pd.Timestamp(d))
        m = A.match(p, field, "hycom")
        m["day"] = d
        matched.append(m)
        print(d, len(p), "Argo profiles within ±%d days" % WINDOW)
    m = pd.concat(matched, ignore_index=True)

    recs = W.argo_records(m.assign(time=m["obs_time"]), ["hycom"])
    ex.write_json("argo.json", {"window_days": WINDOW, "profiles": recs})
    ex.write_json("skill_depth.json", W.skill_rows(m, ["hycom"], vs="argo"))
    ex.finish(products={"hycom": {"label": "HYCOM GOFS 3.1", "kind": "reference"}},
              inputs=["sst"], primary="hycom",
              argo_match=f"profiles within ±{WINDOW} days of the field day, nearest 0.25° cell")
    print(len(recs), "profiles exported")


if __name__ == "__main__":
    main()
