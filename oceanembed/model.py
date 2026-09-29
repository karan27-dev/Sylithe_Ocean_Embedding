"""OceanEmbed models.

1. SurfaceEncoder  — the "satellite embedding engine". Takes a window of daily surface fields
   (B, C, T, H, W), collapses time with a 3D-conv stem + learned temporal attention, then a 2D
   CBAM-attention encoder produces multiscale features and a compact latent map z (B, E, H/8, W/8).
   Pretrained self-supervised as a masked autoencoder (SSL), so the embedding exists before any
   subsurface label is seen.
2. NestedDecoder   — U-Net++ dense-skip decoder with CBAM and deep supervision (Zhou et al. 2018;
   Wang et al., ESSD 2026). Works in 2D or 3D.
3. OceanEmbedNet   — encoder + decoder → 15 depth levels, each with a mean and a log-variance
   (per-pixel uncertainty, shown in the UI).
4. AttnUNetPP3D    — faithful replication of the ESSD-2026 Attention 3D U-Net++ (time axis as the
   3D "depth" axis, spatial-only pooling), used as the published-method baseline.
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

from .config import DEPTHS, INPUT_VARS

N_STATIC = 5          # ocean mask, lat, lon, sin(doy), cos(doy)
N_IN = 2 * len(INPUT_VARS)   # raw + day-of-year anomaly per variable (see dataset.py)
N_DEPTH = len(DEPTHS)


# ------------------------------------------------------------------ building blocks
def _nd(dims):
    return (nn.Conv2d, nn.BatchNorm2d, nn.MaxPool2d, nn.ConvTranspose2d) if dims == 2 else \
           (nn.Conv3d, nn.BatchNorm3d, nn.MaxPool3d, nn.ConvTranspose3d)


class CBAM(nn.Module):
    """Channel attention (Eq. 1) then spatial attention with a 7-wide kernel (Eq. 2), Woo et al. 2018."""

    def __init__(self, ch, dims=2, r=8):
        super().__init__()
        Conv = _nd(dims)[0]
        self.dims = dims
        self.mlp = nn.Sequential(Conv(ch, max(ch // r, 4), 1), nn.ReLU(inplace=True), Conv(max(ch // r, 4), ch, 1))
        self.spatial = Conv(2, 1, 7, padding=3)

    def forward(self, x):
        red = tuple(range(2, x.dim()))
        avg = x.mean(red, keepdim=True)
        mx = x.amax(red, keepdim=True)
        x = x * torch.sigmoid(self.mlp(avg) + self.mlp(mx))
        s = torch.cat([x.mean(1, keepdim=True), x.amax(1, keepdim=True)], 1)
        return x * torch.sigmoid(self.spatial(s))


class ConvBlock(nn.Module):
    def __init__(self, cin, cout, dims=2, attn=True):
        super().__init__()
        Conv, BN, _, _ = _nd(dims)
        self.body = nn.Sequential(Conv(cin, cout, 3, padding=1, bias=False), BN(cout), nn.GELU(),
                                  Conv(cout, cout, 3, padding=1, bias=False), BN(cout), nn.GELU())
        self.skip = Conv(cin, cout, 1) if cin != cout else nn.Identity()
        self.attn = CBAM(cout, dims) if attn else nn.Identity()

    def forward(self, x):
        return self.attn(self.body(x) + self.skip(x))


# ------------------------------------------------------------------ embedding engine
class SurfaceEncoder(nn.Module):
    def __init__(self, n_vars=N_IN, base=32, levels=4, embed_dim=64):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv3d(n_vars * 2, base, 3, padding=1), nn.GELU(),          # values + missing-flags
            nn.Conv3d(base, base, 3, padding=1), nn.GELU())
        self.t_score = nn.Conv3d(base, 1, 1)                                # temporal attention pooling
        self.fuse = ConvBlock(base + N_STATIC, base)
        chs = [base * 2 ** i for i in range(levels)]
        self.downs = nn.ModuleList([ConvBlock(chs[i - 1], chs[i]) for i in range(1, levels)])
        self.to_embed = nn.Conv2d(chs[-1], embed_dim, 1)
        self.chs = chs

    def forward(self, x, missing, static):
        """x, missing: (B, V, T, H, W); static: (B, N_STATIC, H, W).
        Returns multiscale features [X00, X10, ...] and the compact embedding z."""
        h = self.stem(torch.cat([x, missing], 1))                           # (B, base, T, H, W)
        w = torch.softmax(self.t_score(h), dim=2)
        h = (h * w).sum(2)                                                  # (B, base, H, W)
        feats = [self.fuse(torch.cat([h, static], 1))]
        for d in self.downs:
            feats.append(d(F.max_pool2d(feats[-1], 2)))
        return feats, self.to_embed(feats[-1])


# ------------------------------------------------------------------ U-Net++ decoder
class NestedDecoder(nn.Module):
    """X[i][j] = Conv(cat(X[i][0..j-1], Up(X[i+1][j-1]))); deep supervision averages heads on X[0][1..L-1]."""

    def __init__(self, chs, out_ch, dims=2, pool=2, deep_supervision=True):
        super().__init__()
        Conv, _, _, Up = _nd(dims)
        L = len(chs)
        self.L, self.ds = L, deep_supervision
        self.up = nn.ModuleDict()
        self.node = nn.ModuleDict()
        for j in range(1, L):
            for i in range(0, L - j):
                self.up[f"{i}_{j}"] = Up(chs[i + 1], chs[i], pool, stride=pool)
                self.node[f"{i}_{j}"] = ConvBlock(chs[i] * (j + 1), chs[i], dims)
        n_heads = L - 1 if deep_supervision else 1
        self.heads = nn.ModuleList([Conv(chs[0], out_ch, 1) for _ in range(n_heads)])

    def forward(self, feats):
        X = {(i, 0): f for i, f in enumerate(feats)}
        for j in range(1, self.L):
            for i in range(0, self.L - j):
                up = self.up[f"{i}_{j}"](X[(i + 1, j - 1)])
                X[(i, j)] = self.node[f"{i}_{j}"](torch.cat([X[(i, k)] for k in range(j)] + [up], 1))
        if self.ds:
            return torch.stack([h(X[(0, j + 1)]) for j, h in enumerate(self.heads)]).mean(0)
        return self.heads[0](X[(0, self.L - 1)])


# ------------------------------------------------------------------ full models
class OceanEmbedNet(nn.Module):
    """Surface window → embedding → 15-level temperature anomaly (mean, log-variance)."""

    def __init__(self, base=32, levels=4, embed_dim=64):
        super().__init__()
        self.encoder = SurfaceEncoder(base=base, levels=levels, embed_dim=embed_dim)
        self.decoder = NestedDecoder(self.encoder.chs, 2 * N_DEPTH)

    def forward(self, x, missing, static):
        feats, z = self.encoder(x, missing, static)
        out = self.decoder(feats)
        mean, logvar = out[:, :N_DEPTH], out[:, N_DEPTH:].clamp(-8, 6)
        return mean, logvar, z


class SurfaceMAE(nn.Module):
    """Self-supervised pretext: reconstruct the last-day surface fields from a patch- and
    variable-masked window. Only `encoder` is kept afterwards."""

    def __init__(self, base=32, levels=4, embed_dim=64):
        super().__init__()
        self.encoder = SurfaceEncoder(base=base, levels=levels, embed_dim=embed_dim)
        self.decoder = NestedDecoder(self.encoder.chs, len(INPUT_VARS), deep_supervision=False)

    def forward(self, x, missing, static):
        feats, z = self.encoder(x, missing, static)
        return self.decoder(feats), z


class AttnUNetPP3D(nn.Module):
    """Wang et al. (ESSD 2026) layout: input (B, V, T, H, W), 3D convs, pooling only in space, output
    (B, 1, T, H, W) whose T axis is mapped to depth. A Linear(T→15) handles T ≠ 15."""

    def __init__(self, base=16, levels=4, window=15):
        super().__init__()
        chs = [base * 2 ** i for i in range(levels)]
        self.inp = ConvBlock(N_IN * 2 + N_STATIC, chs[0], dims=3)
        self.downs = nn.ModuleList([ConvBlock(chs[i - 1], chs[i], dims=3) for i in range(1, levels)])
        self.decoder = NestedDecoder(chs, 2, dims=3, pool=(1, 2, 2))
        self.t2d = nn.Linear(window, N_DEPTH) if window != N_DEPTH else nn.Identity()

    def forward(self, x, missing, static):
        T = x.shape[2]
        s = static.unsqueeze(2).expand(-1, -1, T, -1, -1)
        feats = [self.inp(torch.cat([x, missing, s], 1))]
        for d in self.downs:
            feats.append(d(F.max_pool3d(feats[-1], (1, 2, 2))))
        out = self.decoder(feats)                                           # (B, 2, T, H, W)
        out = self.t2d(out.movedim(2, -1)).movedim(-1, 2)                   # (B, 2, 15, H, W)
        return out[:, 0], out[:, 1].clamp(-8, 6), None


def build(arch: str, cfg) -> nn.Module:
    if arch == "embed_unetpp2d":
        return OceanEmbedNet(base=cfg.base, levels=cfg.levels)
    if arch == "attn_unetpp3d":
        return AttnUNetPP3D(base=max(cfg.base // 2, 8), levels=cfg.levels, window=cfg.window)
    raise ValueError(arch)
