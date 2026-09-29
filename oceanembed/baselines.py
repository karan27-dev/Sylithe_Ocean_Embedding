"""Reference predictors for the leaderboard. Same inputs, same splits, same scoring as the deep models.

  Climatology — GLORYS day-of-year mean (train years). The "no model" floor any method must beat.
  Ridge       — per-depth linear regression from local surface features to the temperature anomaly,
                the classical statistical approach (regression-based reconstructions, e.g. Guinehut 2012).
"""
from __future__ import annotations

import numpy as np

from . import config as C
from .dataset import N_VARS, SurfaceWindows, unpad

N_FEAT = 3 * N_VARS + 5          # raw(t), anomaly(t), window-mean anomaly, lat, lon, sin/cos doy, bias


def _features(item) -> np.ndarray:
    """(H·W, N_FEAT) features per grid cell from one SurfaceWindows item (missing inputs → 0)."""
    x = unpad(item["x"])                                        # (2V, T, H, W), missing already 0
    st = unpad(item["static"])                                  # ocean, lat, lon, sin, cos
    f = np.concatenate([x[:N_VARS, -1], x[N_VARS:, -1], x[N_VARS:].mean(1), st[1:5], np.ones_like(st[:1])])
    return f.reshape(N_FEAT, -1).T.astype(np.float64)


class Climatology:
    name = "Climatology (GLORYS day-of-year mean)"

    def __init__(self, stats):
        self.S = stats

    def predict(self, item) -> np.ndarray:
        """Normalised anomaly prediction: zero everywhere, i.e. T = climatology."""
        return np.zeros((len(C.DEPTHS), len(C.LATS), len(C.LONS)), np.float32)


class Ridge:
    name = "Ridge regression (per-depth, local surface features)"

    def __init__(self, stats, lam: float = 1e-2):
        self.S, self.lam = stats, lam
        self.W = None                                           # (15, N_FEAT)

    def fit(self, ds: SurfaceWindows, n_days: int = 300, log=print):
        """Exact per-depth ridge via accumulated normal equations over evenly spaced training days
        (each depth has its own mask: shallow shelves have no deep label)."""
        D = len(C.DEPTHS)
        XtX = np.zeros((D, N_FEAT, N_FEAT)); Xty = np.zeros((D, N_FEAT))
        for k in np.linspace(0, len(ds) - 1, min(n_days, len(ds))).astype(int):
            it = ds[k]
            X = _features(it)
            y = unpad(it["y"]).reshape(D, -1); m = unpad(it["m"]).reshape(D, -1) > 0
            for d in range(D):
                Xd = X[m[d]]
                XtX[d] += Xd.T @ Xd
                Xty[d] += Xd.T @ y[d, m[d]]
        reg = self.lam * np.eye(N_FEAT); reg[-1, -1] = 0        # do not shrink the bias
        self.W = np.stack([np.linalg.solve(XtX[d] + reg * max(np.trace(XtX[d]) / N_FEAT, 1), Xty[d]) for d in range(D)])
        log(f"ridge fitted on {min(n_days, len(ds))} days")
        return self

    def predict(self, item) -> np.ndarray:
        pred = (_features(item) @ self.W.T).T                   # (15, H·W)
        return pred.reshape(len(C.DEPTHS), len(C.LATS), len(C.LONS)).astype(np.float32)

    def save(self, path):
        np.savez(path, W=self.W, lam=self.lam)

    def load(self, path):
        self.W = np.load(path)["W"]
        return self
