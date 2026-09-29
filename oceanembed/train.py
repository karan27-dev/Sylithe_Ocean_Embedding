"""Three-stage training, resumable from Drive checkpoints.

  Stage 0  ssl     SurfaceMAE on inputs only (no labels)   → embedding engine weights
  Stage 1  argo    monthly inputs → gridded Argo            → observation-anchored background (paper §2.2.2)
  Stage 2  glorys  daily inputs  → GLORYS                   → mesoscale detail, FULL fine-tune (paper: no freezing
                                                              beat every freezing strategy, RMSE 0.351 vs 0.456)
"""
from __future__ import annotations

import csv
import math
import os
import random
import time

import numpy as np
import torch
from torch.utils.data import DataLoader

from . import config as C
from .dataset import unpad, worker_init
from .losses import gaussian_nll, masked_mean, surface_consistency, vertical_gradient
from .metrics import skill
from .model import SurfaceMAE, build

DEV = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")
torch.backends.cudnn.benchmark = True        # fixed input shapes: let cuDNN pick the fastest kernels


def _to(batch):
    return {k: (v.to(DEV, non_blocking=True) if torch.is_tensor(v) else v) for k, v in batch.items()}


def _physical(mean, b, depth_std):
    return b["clim"] + mean * depth_std.view(1, -1, 1, 1)


def step_loss(model, b, cfg, depth_std):
    mean, logvar, _ = model(b["x"], b["missing"], b["static"])
    m = b["m"]
    loss = gaussian_nll(mean, logvar, b["y"], m, beta=cfg.beta_nll)
    T_pred = _physical(mean, b, depth_std)
    if cfg.w_vgrad:
        loss = loss + cfg.w_vgrad * vertical_gradient(T_pred, b["Ttrue"], m)
    if cfg.w_surface:
        sst = b["sst"]
        m0 = torch.isfinite(sst).float() * m[:, 0]
        loss = loss + cfg.w_surface * surface_consistency(T_pred[:, 0], torch.nan_to_num(sst), m0)
    return loss, T_pred


def ssl_loss(model, b):
    rec, _ = model(b["x"], b["missing"], b["static"])
    return masked_mean((rec - b["surface"]) ** 2, b["surface_mask"])


def seed_everything(seed: int):
    random.seed(seed); np.random.seed(seed); torch.manual_seed(seed); torch.cuda.manual_seed_all(seed)


def _ema(model, decay):
    """EMA of the weights with warm-up: effective decay = min(decay, (1+n)/(10+n)) after n updates. A fixed
    0.999 from step 0 keeps the average ~95 % the random initial weights for the first ~50 steps and ~37 % after
    1000, so early validation (and best-epoch picking) would score an almost untrained model."""
    from torch.optim.swa_utils import AveragedModel

    def avg_fn(avg, cur, n):
        n = int(n)
        d = min(decay, (1 + n) / (10 + n))
        return avg * d + cur * (1 - d)
    return AveragedModel(model, avg_fn=avg_fn, use_buffers=True)


def _log_row(path, row: dict):
    new = not os.path.exists(path)
    with open(path, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(row))
        if new:
            w.writeheader()
        w.writerow(row)


def _lr_at(progress: float, lr_max: float, warmup: float = 0.03) -> float:
    """Linear warm-up then cosine decay to ~0 over progress ∈ [0, 1]."""
    if progress < warmup:
        return lr_max * (progress / warmup)
    return lr_max * 0.5 * (1 + math.cos(math.pi * min(1.0, (progress - warmup) / (1 - warmup))))


def fit(model, train_ds, val_ds, cfg: C.TrainConfig, stage: str, ckpt_dir: str, epochs: int,
        depth_std=None, max_minutes: float | None = None, log=print):
    """Train one stage. Validation, 'best' selection and saved weights all use the EMA of the weights.
    Checkpoint keys: model = EMA weights (use these), raw = live weights (for resuming).

    Budget-aware schedule: progress = max(steps done / planned steps, time used / max_minutes), and the
    learning rate follows warm-up + cosine on that progress. So a run capped by a time budget (a fixed $ on
    a rented GPU) still anneals properly and ends on a converged model instead of being cut off at a high LR.
    Resumable: re-running continues from the last epoch with the same step count and elapsed time."""
    os.makedirs(ckpt_dir, exist_ok=True)
    seed_everything(cfg.seed)
    model.to(DEV)
    ema = _ema(model, cfg.ema_decay)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    per_epoch = math.ceil(len(train_ds) / cfg.batch_size)
    total_steps = max(epochs * per_epoch, 1)
    budget_s = max_minutes * 60 if max_minutes else None
    scaler = torch.amp.GradScaler(enabled=cfg.amp and DEV == "cuda")
    ds_t = torch.tensor(depth_std, device=DEV) if depth_std is not None else None
    last = os.path.join(ckpt_dir, f"{stage}_last.pt")
    start_ep, best, step, elapsed = 0, float("inf"), 0, 0.0
    if os.path.exists(last):                                  # resume after a disconnect
        s = torch.load(last, map_location=DEV, weights_only=False)
        if s.get("done"):
            log(f"{stage} already finished (best {s['best']:.4f})")
            return s["best"]
        model.load_state_dict(s["raw"]); ema.module.load_state_dict(s["model"]); opt.load_state_dict(s["opt"])
        start_ep, best, step, elapsed = s["epoch"] + 1, s["best"], s.get("step", 0), s.get("elapsed", 0.0)
        log(f"resumed {stage} at epoch {start_ep}")
    progress = lambda: max(step / total_steps, elapsed / budget_s if budget_s else 0.0)
    tl = DataLoader(train_ds, cfg.batch_size, shuffle=True, num_workers=cfg.num_workers, pin_memory=True,
                    drop_last=True, worker_init_fn=worker_init, persistent_workers=cfg.num_workers > 0)
    vl = DataLoader(val_ds, cfg.batch_size, shuffle=False, num_workers=cfg.num_workers, worker_init_fn=worker_init)
    for ep in range(start_ep, epochs):
        model.train(); t0 = time.time(); tot = n = 0
        for b in tl:
            for g in opt.param_groups:
                g["lr"] = _lr_at(progress(), cfg.lr)
            b = _to(b)
            with torch.autocast(DEV if DEV != "mps" else "cpu", enabled=cfg.amp and DEV == "cuda"):
                loss = ssl_loss(model, b) if stage == "ssl" else step_loss(model, b, cfg, ds_t)[0]
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(opt); scaler.update()
            ema.update_parameters(model)
            tot += float(loss.detach()); n += 1; step += 1
        val = evaluate(ema.module, vl, cfg, stage, ds_t)
        score = val["loss"] if stage == "ssl" else val["rmse_mean"]
        dt = time.time() - t0; elapsed += dt
        done = ep == epochs - 1 or progress() >= 1.0
        unit = "loss" if stage == "ssl" else "RMSE °C"
        log(f"[{stage}] ep {ep:03d}  train loss {tot / max(n, 1):.4f}  val {unit} {score:.4f}  {dt:.0f}s"
            f"  progress {min(progress(), 1):.0%}")
        row = {"epoch": ep, "train_loss": tot / max(n, 1), "val_score": score, "seconds": round(dt)}
        if "per_depth" in val:
            row |= {f"rmse_{d}m": v["rmse"] for d, v in val["per_depth"].items()}
        _log_row(os.path.join(ckpt_dir, f"{stage}_log.csv"), row)
        best_now = min(best, score)
        state = dict(model=ema.module.state_dict(), raw=model.state_dict(), opt=opt.state_dict(), epoch=ep,
                     best=best_now, step=step, elapsed=elapsed, done=done, cfg=cfg.__dict__, val=val)
        if score < best:
            best = score
            torch.save(state, os.path.join(ckpt_dir, f"{stage}_best.pt"))
        torch.save(state, last)
        if done:
            if ep < epochs - 1:
                log(f"[{stage}] time budget reached after {elapsed / 60:.0f} min: schedule completed, stopping")
            break
    return best


@torch.no_grad()
def evaluate(model, loader, cfg, stage, depth_std):
    model.eval(); tot = n = 0
    preds, trues = [], []
    for b in loader:
        b = _to(b)
        if stage == "ssl":
            tot += float(ssl_loss(model, b)); n += 1; continue
        loss, T_pred = step_loss(model, b, cfg, depth_std)
        tot += float(loss); n += 1
        m = b["m"] > 0
        preds.append(unpad(torch.where(m, T_pred, torch.nan)).float().cpu().numpy())
        trues.append(unpad(torch.where(m, b["Ttrue"], torch.nan)).float().cpu().numpy())
    out = {"loss": tot / max(n, 1)}
    if preds:
        s = skill(np.concatenate(preds), np.concatenate(trues))
        out["per_depth"] = s
        out["rmse_mean"] = float(np.nanmean([v["rmse"] for v in s.values()]))
    return out


def load_encoder_from_ssl(model, ssl_ckpt):
    """Copy the pretrained embedding engine into the reconstruction model (encoder only)."""
    s = torch.load(ssl_ckpt, map_location="cpu", weights_only=False)["model"]
    enc = {k[len("encoder."):]: v for k, v in s.items() if k.startswith("encoder.")}
    missing, unexpected = model.encoder.load_state_dict(enc, strict=False)
    return missing, unexpected


def load_weights(model, ckpt):
    model.load_state_dict(torch.load(ckpt, map_location="cpu", weights_only=False)["model"])
    return model


def load_model(ckpt):
    """Rebuild a trained network from its checkpoint alone: architecture and width come from the config saved
    with it, so evaluation can never pair weights with a differently-sized model. Returns (model, cfg)."""
    s = torch.load(ckpt, map_location="cpu", weights_only=False)
    known = set(C.TrainConfig.__dataclass_fields__)
    cfg = C.TrainConfig(**{k: v for k, v in s["cfg"].items() if k in known})
    _, model = new_models(cfg)
    model.load_state_dict(s["model"])
    return model, cfg


def new_models(cfg):
    return SurfaceMAE(base=cfg.base, levels=cfg.levels), build(cfg.arch, cfg)
