"""Figures in the layout and style of Wang et al. (ESSD 18, 4617–4638, 2026), drawn for OceanEmbed from the
files paper_eval.py writes. Only the region (North Indian Ocean), depth range (0–1000 m), comparison products
and in-situ reference (Argo instead of WOD) differ, so the two studies can be read side by side.

    python -m oceanembed.figures_paper --out /workspace/OceanEmbed/paper

  paper_fig07  RMSE and r vs depth vs GLORYS, one curve per month                  (their Fig. 7)
  paper_fig09  Reconstruction / GLORYS / error maps at 50, 200, 500, 1000 m, 1 Jan (their Fig. 9)
  paper_fig11  Spatial RMSE vs GLORYS at the same four depths                      (their Fig. 11)
  paper_fig12  Argo profile locations + temperature RMSE vs depth                  (their Fig. 12)
  paper_fig13  2°×2° binned RMSE vs Argo: reconstruction, GLORYS, difference       (their Fig. 13)
  paper_fig14  Monthly RMSE vs Argo for every product                              (their Fig. 14)
  paper_fig16  RMSE profiles of every product vs Argo                              (their Fig. 16)
  paper_fig17  Density scatter vs Argo: products × four depths, R² and RMSE        (their Fig. 17)
"""
from __future__ import annotations

import argparse
import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.colors import LogNorm  # noqa: E402

from . import config as C  # noqa: E402

MAP_DEPTHS = (50, 200, 500, 1000)          # their 50/200/800/1000 m; our grid has no 800 m level
CMAP = "gist_earth"                         # their maps: navy → green → sand → white
EXT = [C.LON_MIN - C.RES / 2, C.LON_MAX + C.RES / 2, C.LAT_MIN - C.RES / 2, C.LAT_MAX + C.RES / 2]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
PRODUCT_LABEL = {                           # their legends name each product with resolution and cadence
    "ours": "Sylithe Ocean Model (1/4°, daily)",
    "GLORYS12 reanalysis": "GLORYS12 (1/4°, daily)",
    "HYCOM (independent model)": "HYCOM (1/12°→1/4°, daily)",
    "Attention 3D U-Net++ (Wang et al. 2026)": "Attn 3D U-Net++ (1/4°, daily)",
    "Ridge regression": "Ridge regression (1/4°, daily)",
    "Climatology": "Climatology (1/4°)",
}
PRODUCT_COLOR = {"ours": "#d62728", "GLORYS12 reanalysis": "#0000cc", "HYCOM (independent model)": "#2ca02c",
                 "Attention 3D U-Net++ (Wang et al. 2026)": "#ff7f0e", "Ridge regression": "#7f7f7f",
                 "Climatology": "#17becf"}

plt.rcParams.update({"font.family": "serif", "font.serif": ["Times New Roman", "DejaVu Serif"], "font.size": 9,
                     "axes.titlesize": 10, "axes.titleweight": "bold", "axes.grid": True, "grid.linestyle": ":",
                     "grid.color": "#bbbbbb", "savefig.bbox": "tight", "mathtext.fontset": "dejavuserif"})


class PaperFigs:
    def __init__(self, out):
        self.out, self.dir = out, os.path.join(out, "figures_paper")
        os.makedirs(self.dir, exist_ok=True)
        self.meta = json.load(open(os.path.join(out, "meta.json")))
        self.ours = self.meta.get("ours")
        self.ocean = np.load(os.path.join(out, "ocean_mask.npy"))
        self.written = []
        p = os.path.join(out, "argo_matchups.parquet")
        self.m = pd.read_parquet(p) if os.path.exists(p) else None

    # ---------------------------------------------------------------- helpers
    def save(self, fig, name):
        for ext in ("png", "pdf"):
            fig.savefig(os.path.join(self.dir, f"{name}.{ext}"), dpi=300)
        plt.close(fig)
        self.written.append(name)

    def key(self, name):
        return "ours" if name == self.ours else name

    def label(self, name):
        return PRODUCT_LABEL.get(self.key(name), name)

    def color(self, name):
        return PRODUCT_COLOR.get(self.key(name), "#333333")

    def geo_axes(self, ax):
        """Grey land with a coastline, °E/°N ticks: their map frame."""
        land = np.where(self.ocean, np.nan, 1.0)
        ax.imshow(land, origin="lower", extent=EXT, cmap=matplotlib.colors.ListedColormap(["#cfcfcf"]), zorder=3)
        ax.contour(C.LONS, C.LATS, self.ocean.astype(float), levels=[0.5], colors="k", linewidths=0.4, zorder=4)
        ax.set_xlim(EXT[:2]); ax.set_ylim(EXT[2:]); ax.set_aspect("equal"); ax.grid(True, lw=0.3)
        ax.set_xticks([50, 60, 70, 80, 90, 100]); ax.set_xticklabels([f"{v}°E" for v in [50, 60, 70, 80, 90, 100]], fontsize=7)
        ax.set_yticks([5, 10, 15, 20, 25, 30]); ax.set_yticklabels([f"{v}°N" for v in [5, 10, 15, 20, 25, 30]], fontsize=7)

    def field(self, ax, a, vmin, vmax, cmap=CMAP, label="Temperature (°C)"):
        im = ax.imshow(np.where(self.ocean, a, np.nan), origin="lower", extent=EXT, cmap=cmap, vmin=vmin, vmax=vmax,
                       interpolation="bilinear", zorder=2)
        self.geo_axes(ax)
        cb = plt.colorbar(im, ax=ax, fraction=0.035, pad=0.02)
        cb.set_label(label, fontsize=7); cb.ax.tick_params(labelsize=6)
        return im

    def argo_arrays(self, name, depths=None):
        depths = depths or C.DEPTHS
        o = np.concatenate([self.m[f"T{d}"].values for d in depths])
        p = np.concatenate([self.m[f"{name}_T{d}"].values for d in depths])
        z = np.concatenate([np.full(len(self.m), d) for d in depths])
        ok = np.isfinite(o) & np.isfinite(p)
        return o[ok], p[ok], z[ok]

    def products(self):
        """Every product present in the Argo matchups, ours first, then GLORYS, HYCOM, the published method."""
        order = [self.ours, "GLORYS12 reanalysis", "HYCOM (independent model)",
                 "Attention 3D U-Net++ (Wang et al. 2026)", "Ridge regression", "Climatology"]
        return [n for n in order if n and self.m is not None and f"{n}_T0" in self.m]

    # ---------------------------------------------------------------- their Fig. 7
    def fig07(self):
        mm = pd.read_csv(os.path.join(self.out, "metrics_month.csv"))
        g = mm[mm.method == self.ours]
        if g.empty:
            return
        cols = plt.cm.jet(np.linspace(0, 1, 12))
        fig, (a, b) = plt.subplots(1, 2, figsize=(8.2, 5.6), sharey=True)
        for mo in range(1, 13):
            d = g[g.month == mo].sort_values("depth")
            if d.rmse.notna().any():
                a.plot(d.rmse, d.depth, color=cols[mo - 1], lw=1.3, label=MONTHS[mo - 1])
                b.plot(d.r, d.depth, color=cols[mo - 1], lw=1.3)
        a.set_ylim(1000, 0); a.set_ylabel("Depth (m)")
        a.set_title("(a) RMSE (°C)", fontweight="normal"); a.set_xlabel("RMSE (°C)")
        b.set_title("(b) Correlation Coefficient", fontweight="normal"); b.set_xlabel("Correlation Coefficient")
        fig.legend(*a.get_legend_handles_labels(), loc="center right", title="Month", fontsize=7.5, frameon=True,
                   bbox_to_anchor=(1.07, 0.6))
        self.save(fig, "paper_fig07_rmse_r_depth_monthly")

    # ---------------------------------------------------------------- their Fig. 9
    def fig09(self, day="2023-01-01"):
        s = np.load(os.path.join(self.out, "samples.npz"))
        day = day if f"{day}|ours" in s else next((k.split("|")[0] for k in s.files if k.endswith("|ours")), None)
        if day is None:
            return
        fig, axes = plt.subplots(4, 3, figsize=(11.5, 7.6))
        for i, z in enumerate(MAP_DEPTHS):
            k = C.DEPTHS.index(z)
            rec, ref = s[f"{day}|ours"][k], s[f"{day}|truth"][k]
            lo, hi = np.nanpercentile(ref[self.ocean], [1, 99])
            err = rec - ref
            e = np.nanpercentile(np.abs(err[self.ocean]), 99) or 0.1
            for j, (a, title, lims, lab) in enumerate([(rec, f"Reconstruction-{z}m", (lo, hi), "Temperature (°C)"),
                                                      (ref, f"GLORYS12-{z}m", (lo, hi), "Temperature (°C)"),
                                                      (err, f"Error-{z}m", (-e, e), "Temperature (°C)")]):
                ax = axes[i, j]
                self.field(ax, a, *lims, label=lab)
                ax.set_title(title, fontsize=9)
        fig.suptitle(f"Reconstructed temperature (left), GLORYS12 (middle) and their differences (right), {day}", fontsize=10, y=1.0)
        fig.tight_layout()
        self.save(fig, "paper_fig09_maps_" + day)

    # ---------------------------------------------------------------- their Fig. 11
    def fig11(self):
        z = np.load(os.path.join(self.out, "maps_rmse.npz"))
        if f"{self.ours}|rmse" not in z:
            return
        fig, axes = plt.subplots(1, 4, figsize=(15, 2.9))
        for ax, d in zip(axes, MAP_DEPTHS):
            a = z[f"{self.ours}|rmse"][C.DEPTHS.index(d)]
            self.field(ax, a, 0, np.nanpercentile(a[self.ocean], 99), label="RMSE (°C)")
            ax.set_title(f"Temp RMSE ({d} m)", fontsize=9)
        fig.tight_layout()
        self.save(fig, "paper_fig11_rmse_maps")

    # ---------------------------------------------------------------- their Fig. 12
    def fig12(self):
        if self.m is None:
            return
        fig = plt.figure(figsize=(11, 4.6))
        gs = fig.add_gridspec(1, 2, width_ratios=[2.1, 1])
        ax = fig.add_subplot(gs[0])
        ax.scatter(self.m.lon, self.m.lat, s=9, color="#1f77b4", zorder=5, lw=0)
        self.geo_axes(ax); ax.set_title(f"(a) Argo Profile Location ({len(self.m)} profiles)")
        ax2 = fig.add_subplot(gs[1])
        for n in [self.ours, "GLORYS12 reanalysis"]:
            if n and f"{n}_T0" in self.m:
                r = [np.sqrt(np.nanmean((self.m[f"{n}_T{d}"] - self.m[f"T{d}"]) ** 2)) for d in C.DEPTHS]
                ax2.plot(r, C.DEPTHS, color=self.color(n), lw=1.5, label="Reconstruction" if n == self.ours else "GLORYS12")
        ax2.set_ylim(1000, 0); ax2.set_ylabel("Depth (m)"); ax2.set_xlabel("RMSE (°C)")
        ax2.set_title("(b) Temperature RMSE"); ax2.legend(loc="lower right")
        fig.tight_layout()
        self.save(fig, "paper_fig12_argo_locations_rmse")

    # ---------------------------------------------------------------- their Fig. 13
    def fig13(self, cell=2.0):
        if self.m is None or not self.ours or "GLORYS12 reanalysis_T0" not in self.m:
            return
        lat_e = np.arange(C.LAT_MIN, C.LAT_MAX + cell, cell); lon_e = np.arange(C.LON_MIN, C.LON_MAX + cell, cell)

        def binned(name):
            rows = []
            for d in C.DEPTHS:
                rows.append(pd.DataFrame({"lat": self.m.lat, "lon": self.m.lon, "e2": (self.m[f"{name}_T{d}"] - self.m[f"T{d}"]) ** 2}))
            t = pd.concat(rows).dropna()
            iy = np.digitize(t.lat, lat_e) - 1; ix = np.digitize(t.lon, lon_e) - 1
            g = t.assign(iy=iy, ix=ix).groupby(["iy", "ix"]).e2.mean() ** 0.5
            a = np.full((len(lat_e) - 1, len(lon_e) - 1), np.nan)
            for (y, x), v in g.items():
                if 0 <= y < a.shape[0] and 0 <= x < a.shape[1]:
                    a[y, x] = v
            return a
        A, B = binned(self.ours), binned("GLORYS12 reanalysis")
        vmax = np.nanpercentile(np.concatenate([A.ravel(), B.ravel()]), 98)
        dmax = np.nanpercentile(np.abs(A - B), 98) or 0.1
        fig, axes = plt.subplots(1, 3, figsize=(15, 3.3))
        ext = [lon_e[0], lon_e[-1], lat_e[0], lat_e[-1]]
        for ax, a, title, cm, lim in [(axes[0], A, "(a) Reconstruction Temperature", "Reds", (0, vmax)),
                                      (axes[1], B, "(b) GLORYS12 Temperature", "Reds", (0, vmax)),
                                      (axes[2], A - B, "(c) Difference Temperature ((a)-(b))", "bwr", (-dmax, dmax))]:
            ax.set_facecolor("#bdbdbd")
            im = ax.imshow(a, origin="lower", extent=ext, cmap=cm, vmin=lim[0], vmax=lim[1], zorder=2)
            self.geo_axes(ax); ax.set_title(title, fontsize=9)
            cb = plt.colorbar(im, ax=ax, fraction=0.035, pad=0.02); cb.set_label("RMSE (°C)", fontsize=7)
        fig.tight_layout()
        self.save(fig, "paper_fig13_binned_rmse_argo")

    # ---------------------------------------------------------------- their Fig. 14
    def fig14(self):
        if self.m is None:
            return
        t = pd.to_datetime(self.m.time)
        fig, ax = plt.subplots(figsize=(11, 3.2))
        for n in self.products():
            e2 = np.nanmean(np.stack([(self.m[f"{n}_T{d}"] - self.m[f"T{d}"]) ** 2 for d in C.DEPTHS]), axis=0)
            s = pd.Series(e2, index=t).resample("MS").mean() ** 0.5
            ax.plot(s.index, s.values, color=self.color(n), lw=1.4, label=self.label(n))
            ax.axhline(np.sqrt(np.nanmean(e2)), color=self.color(n), lw=0.8, ls=":")
        ax.set_ylabel("Temperature RMSE (°C)")
        ax.set_title(f"Monthly RMSE vs Argo temperature profiles, upper 1000 m ({t.min().year})", fontweight="normal")
        ax.legend(loc="center left", bbox_to_anchor=(1.01, 0.5), fontsize=7.5, frameon=False)
        self.save(fig, "paper_fig14_monthly_rmse_argo")

    # ---------------------------------------------------------------- their Fig. 16
    def fig16(self):
        if self.m is None:
            return
        fig, ax = plt.subplots(figsize=(3.6, 5.2))
        for n in self.products():
            r = [np.sqrt(np.nanmean((self.m[f"{n}_T{d}"] - self.m[f"T{d}"]) ** 2)) for d in C.DEPTHS]
            ax.plot(r, C.DEPTHS, color=self.color(n), lw=1.3, label=self.label(n))
        ax.set_ylim(1000, 0); ax.set_ylabel("Depth (m)"); ax.set_xlabel("RMSE (°C)"); ax.set_title("Temp RMSE", fontweight="normal")
        ax.legend(fontsize=6.5, loc="lower right", frameon=True)
        self.save(fig, "paper_fig16_rmse_profiles_argo")

    # ---------------------------------------------------------------- their Fig. 17
    def fig17(self):
        if self.m is None:
            return
        prods = [n for n in self.products() if n != "Climatology"]
        fig, axes = plt.subplots(len(prods), 4, figsize=(12.5, 2.75 * len(prods)), squeeze=False)
        letters = iter("abcdefghijklmnopqrstuvwxyz")
        for i, n in enumerate(prods):
            for j, d in enumerate(MAP_DEPTHS):
                ax = axes[i, j]
                o, p, _ = self.argo_arrays(n, [d])
                if o.size < 3:
                    ax.axis("off"); continue
                lo, hi = np.floor(min(o.min(), p.min())), np.ceil(max(o.max(), p.max()))
                hb = ax.hexbin(o, p, gridsize=45, extent=(lo, hi, lo, hi), mincnt=1, cmap="viridis", norm=LogNorm())
                ax.plot([lo, hi], [lo, hi], ls="--", lw=0.7, color="#1f77b4")
                r2 = np.corrcoef(o, p)[0, 1] ** 2; rmse = np.sqrt(np.mean((p - o) ** 2))
                ax.text(0.03, 0.97, f"R² = {r2:.3f}\nRMSE = {rmse:.3f}", transform=ax.transAxes, va="top", fontsize=7.5,
                        bbox=dict(fc="white", ec="none", alpha=0.7, pad=1))
                ax.set_title(f"({next(letters)}) {d} m", fontweight="normal", fontsize=9)
                ax.set_xlabel("Argo Temperature (°C)", fontsize=7.5)
                if j == 0:
                    ax.set_ylabel(f"{self.label(n).split(' (')[0]} Temperature (°C)", fontsize=7.5)
                cb = plt.colorbar(hb, ax=ax, fraction=0.045, pad=0.02); cb.set_label("count (log)", fontsize=6); cb.ax.tick_params(labelsize=5)
        fig.tight_layout()
        self.save(fig, "paper_fig17_density_scatter_argo")

    def draw_all(self):
        for fn in [self.fig07, self.fig09, self.fig11, self.fig12, self.fig13, self.fig14, self.fig16, self.fig17]:
            try:
                fn()
            except Exception as e:
                print(f"paper figure failed: {fn.__name__}: {e!r}")
        print("paper-style figures:", ", ".join(self.written))
        return self.written


def draw_all(out):
    return PaperFigs(out).draw_all()


def main(argv=None):
    p = argparse.ArgumentParser(); p.add_argument("--out", required=True)
    draw_all(p.parse_args(argv).out)


if __name__ == "__main__":
    main()
