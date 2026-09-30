"""Command-line runner for any GPU box (RunPod, a lab server, a laptop with CUDA). Same steps as the Colab
notebooks, without Colab. Every step is resumable: re-run the same command after an interruption.

    python -m oceanembed.run all --data /workspace/data --root /workspace/OceanEmbed --hours 8

  --data   folder with inputs.zarr, target.zarr (+ hycom.zarr, argo_2023.parquet for the leaderboard)
  --root   where statistics, checkpoints, baselines, the leaderboard and the NetCDF product are written
  --hours  GPU time to spend on training; split across stages (see BUDGET) so the whole run fits a
           fixed amount of money, and every stage anneals its learning rate inside its share

Steps: stats → ssl → ours (seed ensemble) → paper (published method) → ridge → leaderboard → web.
`web` writes <root>/web_export/: copy its contents into web/public/data/ and the console shows the model.
"""
from __future__ import annotations

import argparse
import glob
import math
import os
import shutil
import time

import numpy as np
import pandas as pd
import xarray as xr

from . import baselines as B
from . import benchmark as BM
from . import config as C
from . import dataset as D
from . import infer as I
from . import train as TR

# share of --hours per GPU stage; the rest (stats, ridge, leaderboard) runs mostly on CPU
BUDGET = {"ssl": 0.15, "ours": 0.55, "paper": 0.25}


class Run:
    def __init__(self, a):
        self.a = a
        self.data, self.root = a.data, a.root
        os.makedirs(self.root, exist_ok=True)
        self.inputs = os.path.join(self.data, "inputs.zarr")
        self.target = os.path.join(self.data, "target.zarr")
        self.stats_path = os.path.join(self.root, "stats_v2.npz")
        lr = C.TrainConfig.lr * math.sqrt(a.batch / 8)           # square-root LR scaling with batch size
        self.cfg = C.TrainConfig(window=a.window, base=a.base, batch_size=a.batch, num_workers=a.workers, lr=lr,
                                 epochs_ssl=a.epochs_ssl, epochs_glorys=a.epochs)
        self.cfg3 = C.TrainConfig(**{**self.cfg.__dict__, "arch": "attn_unetpp3d", "base": 16,
                                     "batch_size": max(a.batch // 4, 2)})
        self.ck = os.path.join(self.root, "checkpoints", f"oceanembed_w{a.window}")
        self.ck3 = os.path.join(self.root, "checkpoints", f"attn_unetpp3d_w{a.window}")
        self.S = None

    def log(self, msg):
        print(f"{time.strftime('%H:%M:%S')}  {msg}", flush=True)

    def minutes(self, stage, n=1):
        return self.a.hours * 60 * BUDGET[stage] / n if self.a.hours else None

    # ---------------------------------------------------------------- steps
    def stats(self):
        if not os.path.exists(self.stats_path):
            self.log("computing statistics and climatologies from the training years")
            D.compute_stats(self.inputs, self.target, self.stats_path)
        self.S = D.load_stats(self.stats_path)

    def windows(self, period, train, cfg, target=True, **kw):
        crop = (cfg.crop_h, cfg.crop_w) if train and target and cfg.crop_h else None
        return D.SurfaceWindows(self.inputs, self.target if target else None, self.S, period, cfg.window, train=train,
                                var_dropout=cfg.var_dropout if train else 0, need_target=target, crop=crop, **kw)

    def ssl(self):
        self.stats()
        c = self.cfg
        mae, _ = TR.new_models(c)
        TR.fit(mae, self.windows(C.TRAIN, True, c, target=False, patch_mask=0.5),
               self.windows(C.VAL, False, c, target=False, patch_mask=0.5), c, "ssl", self.ck, c.epochs_ssl,
               max_minutes=self.minutes("ssl"), log=self.log)

    def ours(self):
        self.stats()
        for seed in self.a.seeds:
            c = C.TrainConfig(**{**self.cfg.__dict__, "seed": seed})
            _, net = TR.new_models(c)
            TR.load_encoder_from_ssl(net, os.path.join(self.ck, "ssl_best.pt"))
            self.log(f"OceanEmbed seed {seed}")
            TR.fit(net, self.windows(C.TRAIN, True, c), self.windows(C.VAL, False, c), c, "glorys",
                   os.path.join(self.ck, f"seed{seed}"), c.epochs_glorys, depth_std=self.S["depth_std"],
                   max_minutes=self.minutes("ours", len(self.a.seeds)), log=self.log)

    def paper(self):
        self.stats()
        c = self.cfg3
        _, net = TR.new_models(c)
        self.log("Attention 3D U-Net++ (Wang et al. 2026) on the same data")
        TR.fit(net, self.windows(C.TRAIN, True, c), self.windows(C.VAL, False, c), c, "glorys", self.ck3,
               c.epochs_glorys, depth_std=self.S["depth_std"], max_minutes=self.minutes("paper"), log=self.log)

    def ridge(self):
        self.stats()
        out = os.path.join(self.root, "baselines", "ridge.npz")
        if not os.path.exists(out):
            os.makedirs(os.path.dirname(out), exist_ok=True)
            B.Ridge(self.S).fit(self.windows(C.TRAIN, False, self.cfg), n_days=400, log=self.log).save(out)

    def leaderboard(self):
        self.stats()
        load = lambda p, c: TR.load_weights(TR.new_models(c)[1], p)
        G = xr.open_zarr(self.target).thetao.sel(time=slice(*C.TEST))
        argo_path = os.path.join(self.data, "argo_2023.parquet")
        prof = pd.read_parquet(argo_path) if os.path.exists(argo_path) else None
        lb = BM.Leaderboard(G, prof)
        seeds = TR.seed_checkpoints(self.ck)
        members = [TR.load_model(p)[0] for p in seeds]
        if members:
            self.log(f"scoring Sylithe Ocean Model ({len(members)} members)")
            rec = I.reconstruct(members, self.inputs, self.S, *C.TEST, window=self.cfg.window)
            rec.to_netcdf(os.path.join(self.root, "OceanEmbed_NIO_T_2023.nc"))
            lb.add(f"Sylithe Ocean Model ({len(members)}-model ensemble)", "ours", rec.thetao)
            if len(members) > 1:
                lb.add("Sylithe Ocean Model (single model)", "ours",
                       I.reconstruct(members[0], self.inputs, self.S, *C.TEST, window=self.cfg.window).thetao)
        p3 = os.path.join(self.ck3, "glorys_best.pt")
        if os.path.exists(p3):
            self.log("scoring the published method")
            lb.add("Attention 3D U-Net++ (Wang et al. 2026), retrained here", "published method (retrained here)",
                   I.reconstruct(TR.load_model(p3)[0], self.inputs, self.S, *C.TEST, window=self.cfg3.window).thetao)
        ridge = os.path.join(self.root, "baselines", "ridge.npz")
        if os.path.exists(ridge):
            lb.add(B.Ridge.name, "baseline", I.reconstruct_baseline(B.Ridge(self.S).load(ridge), self.inputs, self.S,
                   *C.TEST, window=self.cfg.window).thetao)
        lb.add(B.Climatology.name, "baseline", I.reconstruct_baseline(B.Climatology(self.S), self.inputs, self.S,
               *C.TEST, window=self.cfg.window).thetao)
        if prof is not None:
            lb.add("GLORYS12 reanalysis (the training target)", "reference product", G, vs_glorys=False)
            hy = os.path.join(self.data, "hycom.zarr")
            if os.path.exists(hy):
                lb.add("HYCOM GOFS 3.1 (independent model, via GEE)", "reference product", xr.open_zarr(hy).thetao)
        summary = lb.save(os.path.join(self.root, "leaderboard"))
        self.log("leaderboard written to " + os.path.join(self.root, "leaderboard"))
        print(summary.round(3).to_string(index=False))

    def web(self):
        """Console export (oceanembed/webexport.py): maps for --web-days, Argo scores over the whole test year."""
        from . import webexport as W
        self.stats()
        seeds = TR.seed_checkpoints(self.ck)
        if not seeds:
            self.log("web: no trained OceanEmbed checkpoints yet, skipped")
            return
        members = [TR.load_model(p)[0] for p in seeds]
        nc = os.path.join(self.root, "OceanEmbed_NIO_T_2023.nc")
        rec = xr.open_dataset(nc) if os.path.exists(nc) else             I.reconstruct(members, self.inputs, self.S, *C.TEST, window=self.cfg.window)
        G = xr.open_zarr(self.target).thetao
        hy = os.path.join(self.data, "hycom.zarr")
        argo_path = os.path.join(self.data, "argo_2023.parquet")
        W.export_model(os.path.join(self.root, "web_export"), rec, G, self.inputs, self.S, members, self.cfg.window,
                       pd.date_range(*self.a.web_days),
                       profiles=pd.read_parquet(argo_path) if os.path.exists(argo_path) else None,
                       hycom=xr.open_zarr(hy).thetao if os.path.exists(hy) else None,
                       leaderboard_json=os.path.join(self.root, "leaderboard", "leaderboard.json"), log=self.log)
        self.log("console export written to " + os.path.join(self.root, "web_export"))

    def all(self):
        t0 = time.time()
        for step in ["stats", "ssl", "ours", "paper", "ridge", "leaderboard", "web"]:
            self.log(f"===== {step} =====")
            getattr(self, step)()
        self.log(f"all done in {(time.time() - t0) / 3600:.1f} h")


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("step", choices=["all", "stats", "ssl", "ours", "paper", "ridge", "leaderboard", "web"])
    p.add_argument("--data", required=True)
    p.add_argument("--root", required=True)
    p.add_argument("--hours", type=float, default=None, help="GPU hours for training stages (None = epoch-limited)")
    p.add_argument("--seeds", type=int, nargs="+", default=[42])
    p.add_argument("--window", type=int, default=C.TrainConfig.window)
    p.add_argument("--base", type=int, default=C.TrainConfig.base)
    p.add_argument("--batch", type=int, default=16)
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--epochs", type=int, default=C.TrainConfig.epochs_glorys)
    p.add_argument("--epochs-ssl", type=int, default=C.TrainConfig.epochs_ssl)
    p.add_argument("--web-days", nargs=2, default=["2023-05-01", "2023-05-31"], metavar=("START", "END"),
                   help="days written as maps for the console (default: the Cyclone Mocha window)")
    a = p.parse_args(argv)
    getattr(Run(a), a.step)()


if __name__ == "__main__":
    main()
