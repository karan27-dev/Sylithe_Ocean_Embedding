"""Publication figures from the files written by paper_eval.py. PNG (300 dpi) + PDF for every figure.

    python -m oceanembed.figures --out /workspace/OceanEmbed/paper

Colour rules: every method keeps one colour in every figure (never re-assigned by rank); temperature uses a
lightness-monotonic ramp, errors a two-hue diverging ramp centred on zero, RMSE a single-hue sequential ramp.
"""
from __future__ import annotations

import argparse
import json
import os

import matplotlib
import matplotlib.dates  # noqa: F401

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from . import config as C  # noqa: E402
from .metrics import isotherm_depth  # noqa: E402

try:
    import cmocean
    CMAP_T = cmocean.cm.thermal
except ImportError:                                   # lightness-monotonic fallback
    CMAP_T = "magma"
CMAP_ERR, CMAP_RMSE, CMAP_HEAT = "RdBu_r", "Reds", "YlOrRd"
EXTENT = [C.LON_MIN - C.RES / 2, C.LON_MAX + C.RES / 2, C.LAT_MIN - C.RES / 2, C.LAT_MAX + C.RES / 2]
LAND = "#d9d9d6"

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 9, "axes.titlesize": 10, "axes.labelsize": 9,
    "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.color": "#e5e7eb",
    "grid.linewidth": 0.6, "legend.frameon": False, "savefig.bbox": "tight", "figure.dpi": 110,
})


def style(method: str) -> dict:
    m = method.lower()
    if "oceanembed" in m or "sylithe" in m:
        return dict(color="#16a34a", lw=2.4, ls="--" if "single" in m else "-", zorder=5)
    if "u-net" in m:
        return dict(color="#ea580c", lw=1.8, ls="-", zorder=4)
    if "ridge" in m:
        return dict(color="#6b7280", lw=1.4, ls="-", zorder=3)
    if "climatology" in m:
        return dict(color="#9ca3af", lw=1.4, ls=":", zorder=2)
    if "hycom" in m:
        return dict(color="#2563eb", lw=1.6, ls="-.", zorder=3)
    if "glorys" in m:
        return dict(color="#0f172a", lw=1.6, ls="-.", zorder=3)
    return dict(color="#111827", lw=1.2, ls="-")


class Figs:
    def __init__(self, out: str):
        self.out = out
        self.fig_dir = os.path.join(out, "figures")
        os.makedirs(self.fig_dir, exist_ok=True)
        self.meta = json.load(open(os.path.join(out, "meta.json")))
        self.ocean = np.load(os.path.join(out, "ocean_mask.npy"))
        self.depth = pd.read_csv(os.path.join(out, "metrics_depth.csv"))
        self.written = []

    def save(self, fig, name):
        for ext in ("png", "pdf"):
            fig.savefig(os.path.join(self.fig_dir, f"{name}.{ext}"), dpi=300)
        plt.close(fig)
        self.written.append(name)

    def _map(self, ax, a, cmap, vmin, vmax, title=None):
        a = np.where(self.ocean, a, np.nan)
        ax.set_facecolor(LAND)
        im = ax.imshow(a, origin="lower", extent=EXTENT, cmap=cmap, vmin=vmin, vmax=vmax, interpolation="nearest")
        ax.set_xlim(EXTENT[:2]); ax.set_ylim(EXTENT[2:]); ax.grid(False); ax.set_aspect("equal")
        ax.set_xticks([50, 60, 70, 80, 90, 100]); ax.set_yticks([5, 10, 15, 20, 25, 30])
        ax.tick_params(labelsize=7)
        if title:
            ax.set_title(title, fontsize=9)
        return im

    @staticmethod
    def _depth_axis(ax, zmax=1000):
        ax.set_yscale("function", functions=(lambda z: np.sqrt(np.maximum(z, 0)), lambda s: s ** 2))
        ax.set_ylim(zmax, 0); ax.set_yticks([0, 20, 50, 100, 200, 300, 500, 700, 1000])
        ax.set_ylabel("Depth (m)")

    # ---------------------------------------------------------------- figures
    def domain(self):
        fig, ax = plt.subplots(figsize=(7.2, 3.4))
        self._map(ax, np.where(self.ocean, 1.0, np.nan), "Blues", 0, 2.2)
        p = os.path.join(self.out, "argo_matchups.parquet")
        if os.path.exists(p):
            m = pd.read_parquet(p)
            ax.scatter(m.lon, m.lat, s=5, c="#0f172a", lw=0, alpha=0.7, label=f"Argo profiles {self.meta['test'][0][:4]} (n={len(m)})")
        for reg, st in [("BoB", "#16a34a"), ("AS", "#ea580c")]:
            r = C.REGIONS[reg]
            ax.add_patch(plt.Rectangle((r["lon"][0], r["lat"][0]), r["lon"][1] - r["lon"][0], r["lat"][1] - r["lat"][0],
                                       fill=False, ec=st, lw=1.6, ls="--"))
            ax.text(r["lon"][0] + 0.6, r["lat"][1] - 1.6, {"BoB": "Bay of Bengal", "AS": "Arabian Sea"}[reg], color=st, fontsize=8, weight="bold")
        ax.legend(loc="lower left", fontsize=7)
        ax.set_title("Study domain: North Indian Ocean, 0.25° grid, 5–30°N 45–105°E")
        self.save(fig, "fig01_domain")

    def training(self):
        p = os.path.join(self.out, "training_curves.csv")
        if not os.path.exists(p) or os.path.getsize(p) < 10:
            return
        t = pd.read_csv(p)
        import re
        # final runs only: seed<digits>/glorys for ours, the published method; archived runs (e.g. *_v1_overfit) left out
        runs = [r for r in t.run.unique() if r.endswith("glorys") and ("attn" in r or re.search(r"/seed\d+/glorys$", r))]
        if not runs:
            return
        fig, ax = plt.subplots(figsize=(5.2, 3.2))
        for r in runs:
            d = t[t.run == r]
            name = "Attention 3D U-Net++" if "attn" in r else "Sylithe Ocean Model " + r.split("/")[-2]
            ax.plot(d.epoch, d.val_score, label=name, **{k: v for k, v in style(name).items() if k != "zorder"})
        ax.set_xlabel("Epoch"); ax.set_ylabel("Validation RMSE vs GLORYS 2022 (°C)")
        ax.set_title("Training: validation error (EMA weights)"); ax.legend(fontsize=7)
        self.save(fig, "fig02_training_curves")

    def depth_profiles(self, reference: str, name: str, title: str):
        d = self.depth[self.depth.reference == reference]
        if d.empty:
            return
        fig, axes = plt.subplots(1, 3, figsize=(9.6, 4.2), sharey=True)
        for (method, g) in d.groupby("method", sort=False):
            st = style(method)
            for ax, col in zip(axes, ["rmse", "bias", "r"]):
                ax.plot(g[col], g.depth, marker="o", ms=3, label=method, **st)
        axes[0].set_xlabel("RMSE (°C)"); axes[1].set_xlabel("Bias (°C)"); axes[2].set_xlabel("Correlation r")
        axes[1].axvline(0, color="#9ca3af", lw=0.8)
        for ax in axes:
            self._depth_axis(ax)
        axes[0].legend(fontsize=7, loc="lower right")
        fig.suptitle(title, fontsize=10)
        self.save(fig, name)

    def month_depth(self):
        m = pd.read_csv(os.path.join(self.out, "metrics_month.csv"))
        ours = self.meta.get("ours")
        if not ours:
            return
        g = m[m.method == ours].pivot(index="depth", columns="month", values="rmse").reindex(C.DEPTHS)
        fig, ax = plt.subplots(figsize=(6.4, 3.8))
        im = ax.imshow(g.values, aspect="auto", cmap=CMAP_RMSE, origin="upper")
        ax.set_yticks(range(len(C.DEPTHS))); ax.set_yticklabels(C.DEPTHS); ax.set_ylabel("Depth (m)")
        ax.set_xticks(range(12)); ax.set_xticklabels("JFMAMJJASOND"); ax.set_xlabel("Month of test year"); ax.grid(False)
        for i in range(g.shape[0]):
            for j in range(g.shape[1]):
                v = g.values[i, j]
                if np.isfinite(v):
                    ax.text(j, i, f"{v:.2f}", ha="center", va="center", fontsize=5.5,
                            color="white" if v > np.nanpercentile(g.values, 70) else "#111827")
        fig.colorbar(im, ax=ax, label="RMSE vs GLORYS (°C)")
        ax.set_title(f"{ours}: error by month and depth")
        self.save(fig, "fig05_rmse_month_depth")

    def _showcase(self, s, prefer=1):
        days = [d for d in self.meta.get("showcase_days", []) if f"{d}|truth" in s and f"{d}|ours" in s]
        return days[min(prefer, len(days) - 1)] if days else None

    def sample_maps(self, day=None, depths=(50, 100, 200, 500)):
        s = np.load(os.path.join(self.out, "samples.npz"))
        day = day or self._showcase(s)
        if not day:
            return
        cols = [("truth", "GLORYS12 (reference)"), ("ours", "Sylithe Ocean Model"), ("err_ours", "Sylithe Ocean Model − GLORYS")]
        if f"{day}|published" in s:
            cols.append(("err_pub", "Attention 3D U-Net++ − GLORYS"))
        fig, axes = plt.subplots(len(depths), len(cols), figsize=(3.1 * len(cols), 1.75 * len(depths)))
        for i, z in enumerate(depths):
            k = C.DEPTHS.index(z)
            tr = s[f"{day}|truth"][k]
            lo, hi = np.nanpercentile(tr[self.ocean], [2, 98])
            if hi - lo < 0.5:                               # near-uniform level: keep a readable colour range
                mid = (hi + lo) / 2; lo, hi = mid - 0.25, mid + 0.25
            for j, (key, title) in enumerate(cols):
                ax = axes[i, j]
                if key == "truth":
                    im_t = self._map(ax, tr, CMAP_T, lo, hi)
                elif key == "ours":
                    self._map(ax, s[f"{day}|ours"][k], CMAP_T, lo, hi)
                else:
                    src = "ours" if key == "err_ours" else "published"
                    im_e = self._map(ax, s[f"{day}|{src}"][k] - tr, CMAP_ERR, -1.5, 1.5)
                if i == 0:
                    ax.set_title(title, fontsize=8)
                if j == 0:
                    ax.set_ylabel(f"{z} m", fontsize=9, weight="bold")
            fig.colorbar(im_t, ax=axes[i, :2].tolist(), shrink=0.85, pad=0.01, label="°C")
        fig.colorbar(im_e, ax=axes[:, 2:].ravel().tolist(), shrink=0.5, pad=0.01, label="Error (°C)")
        fig.suptitle(f"Sylithe Ocean Model on {day} (held-out year, from surface satellite data only)", fontsize=10)
        self.save(fig, "fig06_maps_" + day)

    def rmse_maps(self, depths=(50, 100, 200, 500)):
        z = np.load(os.path.join(self.out, "maps_rmse.npz"))
        names = [n for n in [self.meta.get("ours"), "Attention 3D U-Net++ (Wang et al. 2026)"] if n and f"{n}|rmse" in z]
        if not names:
            return
        fig, axes = plt.subplots(len(names), len(depths), figsize=(3.0 * len(depths), 1.9 * len(names)), squeeze=False)
        vmax = max(np.nanpercentile(z[f"{n}|rmse"][C.DEPTHS.index(d)][self.ocean], 98) for n in names for d in depths)
        for i, n in enumerate(names):
            for j, d in enumerate(depths):
                im = self._map(axes[i, j], z[f"{n}|rmse"][C.DEPTHS.index(d)], CMAP_RMSE, 0, vmax,
                               title=f"{d} m" if i == 0 else None)
                if j == 0:
                    axes[i, j].set_ylabel("Sylithe Ocean Model" if "Sylithe Ocean Model" in n or "OceanEmbed" in n else "Attn 3D U-Net++", fontsize=8, weight="bold")
        fig.colorbar(im, ax=axes.ravel().tolist(), shrink=0.8, pad=0.01, label="Time-mean RMSE vs GLORYS (°C)")
        fig.suptitle(f"Where the error is: {self.meta['test'][0][:4]} mean RMSE by depth", fontsize=10)
        self.save(fig, "fig07_rmse_maps")

    def argo_scatter(self):
        p = os.path.join(self.out, "argo_matchups.parquet")
        ours = self.meta.get("ours")
        if not os.path.exists(p) or not ours:
            return
        m = pd.read_parquet(p)
        names = [n for n in [ours, "Attention 3D U-Net++ (Wang et al. 2026)", "GLORYS12 reanalysis"] if f"{n}_T0" in m]
        fig, axes = plt.subplots(1, len(names), figsize=(3.4 * len(names), 3.4), squeeze=False)
        for ax, n in zip(axes[0], names):
            o = np.concatenate([m[f"T{d}"].values for d in C.DEPTHS])
            pr = np.concatenate([m[f"{n}_T{d}"].values for d in C.DEPTHS])
            zz = np.concatenate([np.full(len(m), d) for d in C.DEPTHS])
            ok = np.isfinite(o) & np.isfinite(pr)
            sc = ax.scatter(o[ok], pr[ok], c=zz[ok], s=3, cmap="viridis_r", norm=matplotlib.colors.PowerNorm(0.5), lw=0)
            lim = [np.nanmin(o[ok]) - 1, np.nanmax(o[ok]) + 1]
            ax.plot(lim, lim, color="#9ca3af", lw=0.8); ax.set_xlim(lim); ax.set_ylim(lim); ax.set_aspect("equal")
            e = pr[ok] - o[ok]
            ax.text(0.04, 0.96, f"RMSE {np.sqrt(np.mean(e ** 2)):.3f} °C\nbias {e.mean():+.3f} °C\nr {np.corrcoef(o[ok], pr[ok])[0, 1]:.4f}\nn {ok.sum()}",
                    transform=ax.transAxes, va="top", fontsize=7)
            ax.set_title(n.replace(" (Wang et al. 2026)", "").replace(" reanalysis", ""), fontsize=8)
            ax.set_xlabel("Argo temperature (°C)")
        axes[0, 0].set_ylabel("Reconstructed / reanalysis (°C)")
        fig.colorbar(sc, ax=axes.ravel().tolist(), label="Depth (m)", shrink=0.85)
        fig.suptitle("Independent check against Argo floats (never used in training)", fontsize=10)
        self.save(fig, "fig08_argo_scatter")

    def section(self, day=None, lat=15.0, zmax=500):
        s = np.load(os.path.join(self.out, "samples.npz"))
        day = day or self._showcase(s)
        if not day:
            return
        y = int(round((lat - C.LAT_MIN) / C.RES))
        zi = [k for k, d in enumerate(C.DEPTHS) if d <= zmax]
        Z = np.array(C.DEPTHS)[zi]
        tr, ou = s[f"{day}|truth"][zi, y, :], s[f"{day}|ours"][zi, y, :]
        lo, hi = np.nanpercentile(tr, [2, 99])
        fig, axes = plt.subplots(3, 1, figsize=(7.4, 6.2), sharex=True)
        for ax, a, cm, vl, vh, title in [(axes[0], tr, CMAP_T, lo, hi, "GLORYS12"), (axes[1], ou, CMAP_T, lo, hi, "Sylithe Ocean Model"),
                                         (axes[2], ou - tr, CMAP_ERR, -1.5, 1.5, "Sylithe Ocean Model − GLORYS")]:
            ax.set_facecolor(LAND)
            im = ax.pcolormesh(C.LONS, Z, a, cmap=cm, vmin=vl, vmax=vh, shading="nearest")
            if title != "Sylithe Ocean Model − GLORYS":
                for iso, ls in [(26, "--"), (20, "-")]:
                    zc = isotherm_depth(np.concatenate([a, np.full((len(C.DEPTHS) - len(zi), a.shape[1]), np.nan)])[:, None, :], iso)[0]
                    ax.plot(C.LONS, zc, color="black", lw=0.9, ls=ls)
            self._depth_axis(ax, zmax); ax.set_yticks([0, 50, 100, 200, 300, 500]); ax.grid(False)
            ax.set_title(title, fontsize=8, loc="left")
            fig.colorbar(im, ax=ax, pad=0.01, label="°C")
        axes[-1].set_xlabel("Longitude (°E)")
        fig.suptitle(f"Zonal section at {lat:.0f}°N on {day}; solid 20 °C (thermocline), dashed 26 °C isotherm", fontsize=9)
        self.save(fig, "fig09_section_" + day)

    def uncertainty(self):
        p = os.path.join(self.out, "coverage.csv")
        if not os.path.exists(p) or os.path.getsize(p) < 10:
            return
        c = pd.read_csv(p)
        if c.empty:
            return
        fig, ax = plt.subplots(figsize=(4.0, 3.6))
        k = sorted(c.k.unique())
        ax.plot(k, [c[c.k == v].expected_gaussian.iloc[0] for v in k], color="#9ca3af", ls=":", label="ideal (Gaussian)")
        for ref, st in [("glorys", dict(color="#0f172a", marker="s")), ("argo", dict(color="#16a34a", marker="o"))]:
            g = c[c.reference == ref]
            if len(g):
                ax.plot(g.k, g.observed, label=f"observed vs {ref.upper() if ref == 'argo' else 'GLORYS'}", **st)
        ax.set_xlabel("k (interval ±kσ)"); ax.set_ylabel("Fraction of errors inside ±kσ"); ax.set_ylim(0, 1.02)
        ax.set_title("Is the predicted uncertainty honest?"); ax.legend(fontsize=7)
        self.save(fig, "fig10_uncertainty_calibration")

    def mocha(self):
        p = os.path.join(self.out, "tchp_case.npz")
        if not os.path.exists(p):
            return
        z = np.load(p)
        days = list(z["days"])
        picks = [d for d in ["2023-05-08", "2023-05-16"] if d in days] or [days[0], days[-1]]
        fig = plt.figure(figsize=(12, 6.2), layout="constrained")
        gs = fig.add_gridspec(2, len(picks) + 1, width_ratios=[1] * len(picks) + [1.25])
        vmax = np.nanpercentile(z["truth_tchp"], 99)
        maps = []
        for j, d in enumerate(picks):
            i = days.index(d)
            for r, (tag, lab) in enumerate([("truth", "GLORYS12"), ("ours", "Sylithe Ocean Model")]):
                ax = fig.add_subplot(gs[r, j])
                im = self._map(ax, z[f"{tag}_tchp"][i], CMAP_HEAT, 0, vmax, title=f"{lab}\n{d}")
                ax.set_xlim(78, 100); ax.set_ylim(5, 24)
                maps.append(ax)
        fig.colorbar(im, ax=maps, shrink=0.8, label="TCHP (kJ cm⁻²)", location="bottom", aspect=40)
        ax = fig.add_subplot(gs[:, -1])
        dd = pd.to_datetime(days)
        ax.plot(dd, z["truth_tchp_bob_mean"], label="GLORYS12", **{k: v for k, v in style("glorys").items() if k != "zorder"})
        ax.plot(dd, z["ours_tchp_bob_mean"], label="Sylithe Ocean Model", **{k: v for k, v in style("sylithe").items() if k != "zorder"})
        if dd[0] <= pd.Timestamp("2023-05-11") and dd[-1] >= pd.Timestamp("2023-05-14"):
            ax.axvspan(pd.Timestamp("2023-05-11"), pd.Timestamp("2023-05-14"), color="#fde68a", alpha=0.6, lw=0, label="Mocha active")
        ax.set_ylabel("Bay of Bengal mean TCHP (kJ cm⁻²)"); ax.legend(fontsize=8)
        ax.xaxis.set_major_locator(matplotlib.dates.DayLocator(interval=4))
        ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%d %b"))
        fig.suptitle("Cyclone Mocha (May 2023): ocean heat available to the storm, from satellites only", fontsize=11)
        self.save(fig, "fig11_mocha_tchp")

    def regions(self):
        r = pd.read_csv(os.path.join(self.out, "metrics_region.csv"))
        fig, axes = plt.subplots(1, 2, figsize=(7.0, 4.0), sharey=True, sharex=True)
        for ax, reg, lab in [(axes[0], "BoB", "Bay of Bengal"), (axes[1], "AS", "Arabian Sea")]:
            for method, g in r[r.region == reg].groupby("method", sort=False):
                ax.plot(g.rmse, g.depth, marker="o", ms=3, label=method, **style(method))
            self._depth_axis(ax); ax.set_title(lab); ax.set_xlabel("RMSE vs GLORYS (°C)")
        axes[0].legend(fontsize=6.5, loc="lower right")
        self.save(fig, "fig12_regions")

    def tables(self):
        """LaTeX + Markdown tables for the paper."""
        d = self.depth
        head = d[d.depth.isin([0, 50, 100, 200, 500, 1000])]
        for ref in ["glorys", "argo"]:
            t = head[head.reference == ref].pivot(index="method", columns="depth", values="rmse")
            if t.empty:
                continue
            t.columns = [f"{c} m" for c in t.columns]
            t = t.sort_values(t.columns[2])
            t.round(3).to_csv(os.path.join(self.fig_dir, f"table_rmse_depth_{ref}.csv"))
            with open(os.path.join(self.fig_dir, f"table_rmse_depth_{ref}.tex"), "w") as f:
                f.write(t.round(3).to_latex(escape=True))

    def draw_all(self):
        for fn in [self.domain, self.training,
                   lambda: self.depth_profiles("glorys", "fig03_skill_depth_glorys", "Skill by depth vs GLORYS12, held-out year"),
                   lambda: self.depth_profiles("argo", "fig04_skill_depth_argo", "Skill by depth vs independent Argo profiles"),
                   self.month_depth, self.sample_maps, self.rmse_maps, self.argo_scatter, self.section,
                   self.uncertainty, self.mocha, self.regions, self.tables]:
            try:
                fn()
            except Exception as e:                        # one broken figure must not cost the others
                print(f"figure failed: {getattr(fn, '__name__', 'lambda')}: {e!r}")
        print("figures:", ", ".join(self.written))
        return self.written


def draw_all(out: str):
    return Figs(out).draw_all()


def main(argv=None):
    p = argparse.ArgumentParser(); p.add_argument("--out", required=True)
    draw_all(p.parse_args(argv).out)


if __name__ == "__main__":
    main()
