"""Training losses. Everything is masked: land and below-sea-floor cells carry no label.

Deliberately NOT included: a "temperature must decrease with depth" penalty. The Bay of Bengal has
real winter temperature inversions under its fresh barrier layer, so monotonicity would be wrong physics.
"""
import torch
import torch.nn.functional as F

from .config import DEPTHS

_DZ = torch.tensor(DEPTHS, dtype=torch.float32).diff()      # 14 layer thicknesses (m)


def masked_mean(x, m):
    return (x * m).sum() / m.sum().clamp_min(1)


def gaussian_nll(mean, logvar, y, m):
    """Heteroscedastic loss: learns a per-pixel, per-depth uncertainty alongside the value."""
    return masked_mean(0.5 * (logvar + (y - mean) ** 2 * torch.exp(-logvar)), m)


def vertical_gradient(pred_T, true_T, m):
    """Match dT/dz between adjacent standard levels (keeps the thermocline sharp instead of smeared)."""
    dz = _DZ.to(pred_T.device).view(1, -1, 1, 1)
    gp = pred_T.diff(dim=1) / dz
    gt = true_T.diff(dim=1) / dz
    mm = m[:, 1:] * m[:, :-1]
    return masked_mean(F.smooth_l1_loss(gp, gt, reduction="none", beta=0.01), mm)


def surface_consistency(pred_T0, sst, m0):
    """Reconstructed 0 m temperature should agree with the observed SST input."""
    return masked_mean(F.smooth_l1_loss(pred_T0, sst, reduction="none"), m0)
