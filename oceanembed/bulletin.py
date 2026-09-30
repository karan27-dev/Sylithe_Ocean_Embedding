"""Cyclone-potential bulletin for the live console, optionally worded by DeepSeek.

    python -m oceanembed.bulletin --state STATE            (also called at the end of every live run)

Computes, for the newest predicted day, the same Ocean Cyclone Potential Index (OCPI), hotspots and disturbance
watch as web/src/lib/cyclone.js, builds the structured payload, and writes web/bulletin.json:
    { date, payload, template: [...], llm: { model, text, checked, generated_at } | null }

The language model only words the bulletin. It is called when DEEPSEEK_API_KEY is set (a GitHub Actions secret,
never in the repository or the browser); every number in its answer must appear in the payload, otherwise the
answer is discarded and the template text is used.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import urllib.request
from datetime import datetime, timezone

import numpy as np

from . import config as C

DEPTHS = np.array(C.DEPTHS, float)
K100 = C.DEPTHS.index(100)
RHO, CP = 1025.0, 3985.0
# key, label, unit, lo, hi, weight — keep in step with web/src/lib/cyclone.js
RULES = [
    ("t100", "Upper-100 m mean temperature", "°C", 25.0, 29.5, 0.25),
    ("tchp", "Cyclone heat potential", "kJ cm⁻²", 0.0, 120.0, 0.25),
    ("sst", "Sea surface temperature", "°C", 26.0, 30.5, 0.15),
    ("d26", "Depth of the 26 °C isotherm", "m", 30.0, 120.0, 0.10),
    ("mld", "Mixed-layer depth", "m", 10.0, 60.0, 0.10),
    ("sla", "Sea level anomaly", "m", -0.1, 0.2, 0.10),
    ("sss", "Sea surface salinity", "psu", 35.0, 31.0, 0.05),
]
CATS = [(0.7, "Very high"), (0.5, "High"), (0.3, "Moderate"), (0.0, "Low")]
VORT, WIND = 2e-5, 10.0
REGION_LABEL = {"NIO": "North Indian Ocean", "BoB": "Bay of Bengal", "AS": "Arabian Sea"}
MODEL = "deepseek-chat"
API = "https://api.deepseek.com/chat/completions"
PROMPT = """You write the daily ocean-heat bulletin of the Sylithe Ocean Model for cyclone forecasters.
Use ONLY the numbers in the JSON below; never invent, round differently or add numbers.
Do not forecast cyclone genesis, track, intensity or landfall: the data describe the ocean only;
vertical wind shear, humidity and other atmospheric conditions are not assessed.
Write 120–180 words: a one-line headline, then Bay of Bengal, Arabian Sea, hotspots
(with coordinates and their strongest drivers), any disturbance-over-warm-ocean watch points,
the 7-day change, and the caveats listed in the JSON.
End with "Watch next:" and two short, specific suggestions for forecasters, each tied to a hotspot,
watch point or trend in the JSON (e.g. which coordinates to monitor and why).
Plain text with short section labels; no markdown tables."""


def _r(v, d=2):
    return None if v is None or not np.isfinite(v) else round(float(v), d)


def _cat(v):
    return next((l for m, l in CATS if v >= m), None) if np.isfinite(v) else None


# ---------------------------------------------------------------- column diagnostics (per cell, vectorised over cells)
def _isotherm(T, iso):
    """T: (15, N). Depth where T first reaches iso, linear between levels."""
    out = np.full(T.shape[1], np.nan)
    out[T[0] <= iso] = 0.0
    todo = T[0] > iso
    for k in range(1, len(DEPTHS)):
        hit = todo & (T[k] <= iso)
        f = (T[k - 1, hit] - iso) / (T[k - 1, hit] - T[k, hit])
        out[hit] = DEPTHS[k - 1] + f * (DEPTHS[k] - DEPTHS[k - 1])
        todo &= ~hit
    return out


def _tchp(T):
    J = np.zeros(T.shape[1]); live = T[0] > 26
    for k in range(1, len(DEPTHS)):
        t0, t1, dz = T[k - 1], T[k], DEPTHS[k] - DEPTHS[k - 1]
        full = live & (t1 >= 26)
        J[full] += ((t0[full] + t1[full]) / 2 - 26) * dz
        part = live & (t1 < 26) & (t0 > 26)
        J[part] += ((t0[part] - 26) / 2) * ((t0[part] - 26) / (t0[part] - t1[part])) * dz
        live &= t1 >= 26
    out = RHO * CP * J / 1e7
    out[~np.isfinite(T[0])] = np.nan
    return out


def _mld(T, dT=0.5):
    thr = T[2] - dT
    out = np.full(T.shape[1], np.nan); todo = np.isfinite(thr)
    for k in range(3, len(DEPTHS)):
        hit = todo & (T[k] < thr)
        f = (T[k - 1, hit] - thr[hit]) / (T[k - 1, hit] - T[k, hit])
        out[hit] = DEPTHS[k - 1] + f * (DEPTHS[k] - DEPTHS[k - 1])
        todo &= ~hit
    return out


def _t100(T):
    s = sum((T[k] + T[k - 1]) / 2 * (DEPTHS[k] - DEPTHS[k - 1]) for k in range(1, K100 + 1))
    return s / 100.0


def ocpi(x: dict) -> tuple[np.ndarray, dict]:
    """x: arrays keyed like RULES (+ 't0'); returns OCPI and per-driver scores. Missing drivers renormalise."""
    s = x.get("sst") if x.get("sst") is not None else x["t0"]
    s = np.where(np.isfinite(s), s, x["t0"])
    num = np.zeros_like(s, dtype=float); den = np.zeros_like(s, dtype=float); parts = {}
    for key, _, _, lo, hi, w in RULES:
        v = x.get(key)
        if v is None:
            continue
        sc = np.clip((v - lo) / (hi - lo), 0, 1)
        ok = np.isfinite(sc)
        num += np.where(ok, w * sc, 0); den += np.where(ok, w, 0); parts[key] = sc
    out = np.where(den > 0, num / np.maximum(den, 1e-9), np.nan)
    out = np.where(s < 26, 0.0, out)
    out[~np.isfinite(s)] = np.nan
    t100 = x.get("t100")
    if t100 is not None:                       # open ocean only: shelves shallower than 100 m are left out
        out[~np.isfinite(t100)] = np.nan
    return out, parts


# ---------------------------------------------------------------- payload
def _record_ocpi(r):
    if not r or not r.get("T"):
        return float("nan")
    T = np.array(r["T"], float)[:, None]
    x = {"t0": T[0], "t100": _t100(T)}
    for k in ("sst", "sss", "sla", "tchp", "d26", "mld"):
        x[k] = np.array([r.get(k) if r.get(k) is not None else np.nan], float)
    return float(ocpi(x)[0][0])


def _peaks(v, lat, lon, k, sep, vmin, keep=None):
    idx = np.where(np.isfinite(v) & (v >= vmin) & (keep if keep is not None else True))[0]
    idx = idx[np.argsort(-v[idx])]
    out = []
    for i in idx:
        if all(np.hypot(lat[i] - lat[j], lon[i] - lon[j]) > sep for j in out):
            out.append(i)
        if len(out) == k:
            break
    return out


def build(T: np.ndarray, inp: dict, series: dict, day: str, run: dict) -> dict:
    """T: (15, lat, lon) predicted temperature; inp: input fields on the grid; series: live series.json."""
    H, W = T.shape[1:]
    Tf = T.reshape(len(DEPTHS), -1)
    lat = np.repeat(C.LATS, W); lon = np.tile(C.LONS, H)
    get = lambda k: inp[k].reshape(-1).astype(float) if k in inp else None
    x = {"t0": Tf[0], "t100": _t100(Tf), "tchp": _tchp(Tf), "d26": _isotherm(Tf, 26), "mld": _mld(Tf),
         "sst": get("sst"), "sss": get("sss"), "sla": get("sla")}
    O, parts = ocpi(x)
    vort = wind = None
    if "uw" in inp and "vw" in inp:
        u, v = inp["uw"].astype(float), inp["vw"].astype(float)
        R = 6.371e6; dy = np.deg2rad(C.RES) * R; dx = dy * np.cos(np.deg2rad(C.LATS))[:, None]
        dvdx = np.gradient(v, axis=1) / dx
        dudy = np.gradient(u, axis=0) / dy            # LATS run south→north, so axis 0 increases northward
        vort = (dvdx - dudy).reshape(-1); wind = np.hypot(u, v).reshape(-1)

    regions = {}
    prev_day = str(np.datetime64(day) - np.timedelta64(7, "D"))
    for r, b in C.REGIONS.items():
        m = (lat >= b["lat"][0]) & (lat <= b["lat"][1]) & (lon >= b["lon"][0]) & (lon <= b["lon"][1]) & np.isfinite(O)
        a = series["days"].get(day, {}).get(r, {}); p = series["days"].get(prev_day, {}).get(r, {})
        oc, ocp = _record_ocpi(a), _record_ocpi(p)
        watch = int(((O >= 0.5) & (vort > VORT) & (wind >= WIND) & m).sum()) if vort is not None else 0
        g = lambda dct, k: np.nan if dct.get(k) is None else float(dct[k])
        regions[REGION_LABEL[r]] = {
            "sst_c": _r(g(a, "sst")), "sss_psu": _r(g(a, "sss")), "sla_m": _r(g(a, "sla"), 3), "wind_ms": _r(g(a, "wind"), 1),
            "tchp_kj_cm2": _r(g(a, "tchp"), 0), "d26_m": _r(g(a, "d26"), 0), "mld_m": _r(g(a, "mld"), 0),
            "t100_c": _r(_t100(np.array(a["T"], float)[:, None])[0]) if a.get("T") else None,
            "ocpi_of_mean_conditions": _r(oc), "ocpi_mean_of_cells": _r(O[m].mean() if m.any() else np.nan),
            "share_ocpi_high": _r((O[m] >= 0.5).mean() if m.any() else np.nan),
            "share_ocpi_very_high": _r((O[m] >= 0.7).mean() if m.any() else np.nan), "watch_cells": watch,
            "change_7d": {"ocpi": _r(oc - ocp), "tchp_kj_cm2": _r(g(a, "tchp") - g(p, "tchp"), 0)},
        }
    hs = _peaks(O, lat, lon, 6, 4, 0.5)
    hotspots = []
    for j, i in enumerate(hs):
        dr = sorted(((parts[k][i], lab, x[k][i], unit) for k, lab, unit, *_ in RULES if k in parts and np.isfinite(parts[k][i])), reverse=True)[:3]
        hotspots.append({"rank": j + 1, "lat": _r(lat[i]), "lon": _r(lon[i]), "ocpi": _r(O[i]), "category": _cat(O[i]),
                         "drivers": [{"name": lab, "value": _r(val, 2), "unit": unit} for _, lab, val, unit in dr]})
    watch_pts = []
    if vort is not None:
        for i in _peaks(O, lat, lon, 5, 3, 0.5, keep=(vort > VORT) & (wind >= WIND)):
            watch_pts.append({"lat": _r(lat[i]), "lon": _r(lon[i]), "ocpi": _r(O[i]),
                              "surface_vorticity_1e5_s": _r(vort[i] * 1e5, 1), "wind_ms": _r(wind[i], 1)})
    return {
        "product": "Sylithe Ocean Model · ocean cyclone potential", "date": day, "mode": "live, near-real-time inputs",
        "model": {"members": run.get("members"), "window_days": run.get("window"), "revision": run.get("revision"),
                  "inputs_pending": run.get("missing_today", [])},
        "index": {"name": "OCPI", "range": [0, 1], "categories": [{"label": l, "from": m} for m, l in CATS],
                  "weights": {k: w for k, *_, w in RULES}, "gate": "OCPI = 0 where SST < 26 °C"},
        "regions": regions, "hotspots": hotspots, "watch_points": watch_pts,
        "caveats": ["Ocean conditions only; atmospheric shear and humidity are not included.",
                    "Surface vorticity comes from satellite surface winds, a proxy for low-level circulation.",
                    "Live inputs are near-real-time; the live check against Argo gives about 1.05 °C RMSE."],
    }


def template(p: dict) -> list[str]:
    b, a = p["regions"]["Bay of Bengal"], p["regions"]["Arabian Sea"]
    pct = lambda v: f"{round((v or 0) * 100)} %"
    lines = [f"{p['date']} · ocean cyclone potential from the Sylithe Ocean Model ({p['mode']}).",
             f"Bay of Bengal: {pct(b['share_ocpi_high'])} High or above on the OCPI (mean {b['ocpi_mean_of_cells']}); heat potential "
             f"{b['tchp_kj_cm2']} kJ cm⁻², upper-100 m {b['t100_c']} °C, D26 {b['d26_m']} m.",
             f"Arabian Sea: {pct(a['share_ocpi_high'])} High or above (mean {a['ocpi_mean_of_cells']}); heat potential "
             f"{a['tchp_kj_cm2']} kJ cm⁻², upper-100 m {a['t100_c']} °C, D26 {a['d26_m']} m."]
    if p["watch_points"]:
        w = p["watch_points"][0]
        lines.append(f"Watch: {len(p['watch_points'])} disturbance point(s) over High-potential ocean, strongest near {w['lat']}°N {w['lon']}°E.")
    lines.append("Ocean conditions only: vertical wind shear and humidity are not assessed. Verify against IMD and INCOIS advisories.")
    return lines


# ---------------------------------------------------------------- LLM
def _numbers(obj):
    if isinstance(obj, dict):
        for v in obj.values():
            yield from _numbers(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _numbers(v)
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        yield float(obj)
    elif isinstance(obj, str):
        for s in re.findall(r"\d+(?:\.\d+)?", obj):
            yield float(s)


def check(text: str, payload: dict) -> list[str]:
    """Numbers in `text` that cannot be traced to the payload, compared at the precision they are written with
    (shares may appear as percentages; small integers and the date's parts are allowed as labels)."""
    vals = [v for v in _numbers(payload)]
    y, mo, d = (int(x) for x in payload["date"].split("-"))
    labels = set(range(0, 11)) | {y, mo, d}
    bad = []
    for s_ in re.findall(r"\d+(?:\.\d+)?", text):
        v, dec = float(s_), len(s_.split(".")[1]) if "." in s_ else 0
        if dec == 0 and int(v) in labels:
            continue
        if any(round(abs(p), dec) == v or round(abs(p) * 100, dec) == v for p in vals):
            continue
        bad.append(s_)
    return bad


def deepseek(payload: dict, key: str, timeout=60) -> str:
    body = {"model": MODEL, "temperature": 0.2, "max_tokens": 600,
            "messages": [{"role": "system", "content": PROMPT}, {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]}
    req = urllib.request.Request(API, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)["choices"][0]["message"]["content"].strip()


def write(state_root: str, log=print):
    """Build the bulletin for the newest predicted day and write web/bulletin.json."""
    from .live import State, _pred
    st = State(state_root)
    days = sorted(f[:-4] for f in os.listdir(os.path.join(st.root, "pred")) if f.endswith(".npz"))
    if not days:
        log("  bulletin: no prediction yet"); return None
    day = days[-1]
    T, _ = _pred(st, day)
    inp = st.inputs(day)
    # late winds: use the newest day that has them for the disturbance watch
    if "uw" not in inp:
        for d in reversed(days):
            w = st.inputs(d)
            if "uw" in w:
                inp = inp | {"uw": w["uw"], "vw": w["vw"]}; break
    payload = build(T, inp, st.series, day, st.index.get(day, {}))
    out = {"date": day, "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "payload": payload, "template": template(payload), "prompt": PROMPT, "llm": None}
    key = os.environ.get("DEEPSEEK_API_KEY")
    if key:
        try:
            text = deepseek(payload, key)
            bad = check(text, payload)
            out["llm"] = {"model": MODEL, "text": text, "checked": not bad, "untraced_numbers": bad}
            log(f"  bulletin: DeepSeek {'passed' if not bad else 'FAILED'} the number check" + (f" ({bad[:5]})" if bad else ""))
        except Exception as e:
            out["llm"] = {"model": MODEL, "error": repr(e)[:200]}
            log(f"  bulletin: DeepSeek call failed ({e!r})")
    else:
        log("  bulletin: template only (no DEEPSEEK_API_KEY)")
    os.makedirs(os.path.join(st.root, "web"), exist_ok=True)
    with open(os.path.join(st.root, "web", "bulletin.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, allow_nan=False, default=lambda o: None)
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--state", required=True)
    a = p.parse_args(argv)
    write(a.state)


if __name__ == "__main__":
    main()
