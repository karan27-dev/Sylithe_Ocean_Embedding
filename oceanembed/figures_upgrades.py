"""Paper-style figures of the finale experiments, drawn from upgrades.json alone (no data needed).

    python -m oceanembed.figures_upgrades --json web/public/data/upgrades.json --out web/public/figures
"""
from __future__ import annotations

import argparse
import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

DEPTHS = [0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000]
OURS, GLO, HYC, GREY = "#D9722B", "#2F6F6A", "#64748B", "#94A3B8"
COL = {"Sylithe Ocean Model": OURS, "GLORYS12": GLO, "HYCOM GOFS 3.1": HYC}
plt.rcParams.update({"font.family": "serif", "font.size": 9, "axes.spines.top": False, "axes.spines.right": False,
                     "axes.titlesize": 10, "axes.titleweight": "bold", "figure.dpi": 200, "savefig.bbox": "tight"})


def _depth_axis(ax):
    ax.set_yscale("function", functions=(lambda z: np.sqrt(np.maximum(z, 0)), lambda s: s ** 2))
    ax.set_ylim(1000, 0); ax.set_yticks([0, 50, 100, 200, 500, 1000]); ax.set_ylabel("Depth (m)")
    ax.grid(alpha=0.25, linestyle=":")


def gridded(d, out):
    rows = d["rows"]
    fig, (a, b) = plt.subplots(1, 2, figsize=(9.2, 4.0), gridspec_kw={"width_ratios": [1, 1.25]})
    for r in rows:
        z = [zz for zz, v in zip(DEPTHS, r["by_depth"]) if v is not None]
        v = [v for v in r["by_depth"] if v is not None]
        a.plot(v, z, "-o", ms=3, lw=1.8 if r["product"].startswith("Sylithe") else 1.2, color=COL.get(r["product"], GREY), label=r["product"])
    _depth_axis(a); a.set_xlabel("RMSE (°C)"); a.set_title("(a) RMSE by depth"); a.legend(frameon=False, fontsize=8)
    bands = ["0–1000 m", "0–200 m", "75–150 m", "200–1000 m", "Bay of Bengal", "Arabian Sea"]
    x = np.arange(len(bands)); w = 0.26
    for i, r in enumerate(rows):
        vals = [r.get(k) or np.nan for k in bands]
        bars = b.bar(x + (i - 1) * w, vals, w, color=COL.get(r["product"], GREY), label=r["product"])
        if r["product"].startswith("Sylithe"):
            for bb, v in zip(bars, vals):
                b.text(bb.get_x() + bb.get_width() / 2, v + 0.02, f"{v:.2f}", ha="center", fontsize=7, color=OURS)
    b.set_xticks(x, bands, rotation=20, ha="right"); b.set_ylabel("RMSE (°C)"); b.set_title("(b) RMSE by layer and basin")
    b.grid(axis="y", alpha=0.25, linestyle=":")
    fig.suptitle(f"Monthly 2023 fields against gridded Argo ({d['source']}, {d['grid']} grid)", fontsize=10.5)
    fig.savefig(os.path.join(out, "upg_gridded_argo.png")); plt.close(fig)


def calibration(d, out):
    fig, (a, b) = plt.subplots(1, 2, figsize=(9.2, 4.0), gridspec_kw={"width_ratios": [1.1, 1]})
    a.plot(d["by_depth_before"], DEPTHS, "-o", ms=3, color=GREY, label="raw σ")
    a.plot(d["by_depth_after"], DEPTHS, "-o", ms=3, lw=1.8, color=OURS, label="calibrated σ")
    a.axvline(68.3, color="k", ls="--", lw=0.9); a.text(68.8, 15, "ideal 68 %", fontsize=7.5)
    _depth_axis(a); a.set_xlabel("Argo errors inside ±1σ (%)"); a.set_xlim(35, 90); a.set_title("(a) Coverage by depth, 2023")
    a.legend(frameon=False, fontsize=8, loc="lower right")
    labels = ["±1σ", "±2σ"]
    before = [d["inside_1sigma_before"], d["inside_2sigma_before"]]; after = [d["inside_1sigma_after"], d["inside_2sigma_after"]]
    ideal = [d["ideal_1sigma"], d["ideal_2sigma"]]
    x = np.arange(2); w = 0.27
    for off, vals, c, lab in ((-w, before, GREY, "raw σ"), (0, after, OURS, "calibrated σ"), (w, ideal, "#CBD5E1", "ideal (Gaussian)")):
        bars = b.bar(x + off, vals, w, color=c, label=lab)
        for bb, v in zip(bars, vals):
            b.text(bb.get_x() + bb.get_width() / 2, v + 1, f"{v:.1f}", ha="center", fontsize=7.5)
    b.set_xticks(x, labels); b.set_ylim(0, 118); b.set_ylabel("Share of Argo errors (%)"); b.set_title("(b) Whole column, 2023")
    b.legend(frameon=False, fontsize=8, loc="upper left", ncol=3); b.grid(axis="y", alpha=0.25, linestyle=":")
    fig.suptitle("Uncertainty calibration: per-depth σ scale fitted on 2022 Argo, tested on 2023", fontsize=10.5)
    fig.savefig(os.path.join(out, "upg_calibration.png")); plt.close(fig)


def cyclones(d, out):
    st = sorted(d["storms"], key=lambda s: -s["max_wind_kt"])
    names = [s["storm"] for s in st]
    fig, (a, b) = plt.subplots(1, 2, figsize=(9.6, 4.0), gridspec_kw={"width_ratios": [1.35, 1]})
    x = np.arange(len(st)); w = 0.38
    a.bar(x - w / 2, [s["tchp_mean"] for s in st], w, color=OURS, label="Sylithe Ocean Model")
    a.bar(x + w / 2, [s["tchp_glorys_mean"] for s in st], w, color=GLO, label="GLORYS12")
    a.axhline(50, color="k", ls="--", lw=0.8); a.text(len(st) - 0.6, 52, "50 kJ cm⁻²", fontsize=7, ha="right")
    for i, s in enumerate(st):
        a.text(i, max(s["tchp_mean"], s["tchp_glorys_mean"]) + 3, f"{s['max_wind_kt']} kt", ha="center", fontsize=7, color="#334155")
    a.set_xticks(x, names, rotation=25, ha="right"); a.set_ylabel("Mean TCHP along track (kJ cm⁻²)")
    a.set_title(f"(a) Heat potential along tracks · r = {d['tchp_r_vs_glorys']:.2f}, bias {d['tchp_bias_vs_glorys']:+.1f}")
    a.legend(frameon=False, fontsize=8); a.grid(axis="y", alpha=0.25, linestyle=":")
    vals = [d["ocpi_mean_otherwise"], d["ocpi_mean_before_ri"]]
    bars = b.bar([0, 1], vals, 0.55, color=[GREY, OURS])
    for bb, v in zip(bars, vals):
        b.text(bb.get_x() + bb.get_width() / 2, v + 0.015, f"{v:.2f}", ha="center", fontsize=9)
    b.set_xticks([0, 1], ["other track points", f"before rapid\nintensification (n={d['ri_points']})"])
    b.set_ylim(0, 1); b.set_ylabel("Mean Ocean Cyclone Potential Index")
    b.set_title(f"(b) OCPI before rapid intensification · AUC {d['ocpi_auc_ri']:.2f}"); b.grid(axis="y", alpha=0.25, linestyle=":")
    fig.suptitle(f"All 2023 North Indian Ocean cyclones ({d['track_points']} IBTrACS 6-hourly points, ocean sampled the day before)", fontsize=10.5)
    fig.savefig(os.path.join(out, "upg_cyclones.png")); plt.close(fig)


def main(argv=None):
    p = argparse.ArgumentParser(); p.add_argument("--json", required=True); p.add_argument("--out", required=True)
    a = p.parse_args(argv)
    u = json.load(open(a.json)); os.makedirs(a.out, exist_ok=True)
    for k, fn in (("gridded_argo", gridded), ("calibration", calibration), ("cyclones", cyclones)):
        if u.get(k) and (u[k].get("rows") or u[k].get("by_depth_after") or u[k].get("storms")):
            fn(u[k], a.out); print("figure:", k)


if __name__ == "__main__":
    main()
