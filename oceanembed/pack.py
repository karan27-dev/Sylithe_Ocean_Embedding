"""Move the training stores between machines without paying Drive's per-file cost.

The stores keep one chunk per day (what training wants: one random day per sample), which on Google Drive
means ~55k files in ~110k folders. Reading them serially through the Drive mount ran at ~6 MB/min.

  pack    Drive stores → big time-chunks on local disk, read with many threads in parallel → one tar file
  unpack  that tar → back to one-chunk-per-day stores on a fast local disk (RunPod NVMe)

    python -m oceanembed.pack pack   --src /content/drive/MyDrive/OceanEmbed --out /content/pack.tar
    python -m oceanembed.pack unpack --tar /workspace/data/pack.tar --dst /workspace/data
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tarfile
import time

import dask
import xarray as xr

STORES = ["inputs", "target"]
PACK_CHUNK = {"inputs": 128, "target": 32}      # days per packed chunk (target is 15 levels deep)


def _clean_encoding(ds: xr.Dataset) -> xr.Dataset:
    """Keep dtype/scale/fill encodings (target stays int16) but drop the old chunk layout."""
    for v in ds.variables:
        for k in ("chunks", "preferred_chunks", "shards"):
            ds[v].encoding.pop(k, None)
    return ds


def _rewrite(src: str, dst: str, days: int, threads: int, log):
    t0 = time.time()
    ds = _clean_encoding(xr.open_zarr(src))
    tmp = dst + ".part"
    shutil.rmtree(tmp, ignore_errors=True)
    with dask.config.set(scheduler="threads", num_workers=threads):
        ds.chunk({"time": days}).to_zarr(tmp, mode="w")
    shutil.rmtree(dst, ignore_errors=True)
    os.rename(tmp, dst)                                      # only a finished store gets the final name
    log(f"{os.path.basename(src)} → {dst}: {ds.sizes['time']} days in {(time.time() - t0) / 60:.1f} min")


def pack(src_root: str, out_tar: str, work: str = "/content/pack", threads: int = 32, log=print):
    os.makedirs(work, exist_ok=True)
    for s in STORES:
        dst = os.path.join(work, f"{s}.zarr")
        if not os.path.exists(dst):
            _rewrite(os.path.join(src_root, f"{s}.zarr"), dst, PACK_CHUNK[s], threads, log)
    local_tar = os.path.join(os.path.dirname(work), "pack.tar")
    subprocess.run(["tar", "-cf", local_tar, "-C", work] + [f"{s}.zarr" for s in STORES], check=True)
    log(f"archive {os.path.getsize(local_tar) / 1e9:.2f} GB")
    if os.path.abspath(local_tar) != os.path.abspath(out_tar):
        shutil.copyfile(local_tar, out_tar + ".part")
        os.replace(out_tar + ".part", out_tar)
    log(f"done: {out_tar}")


def unpack(tar_path: str, dst_root: str, threads: int = 16, log=print):
    staging = os.path.join(dst_root, "_packed")
    os.makedirs(staging, exist_ok=True)
    if not all(os.path.exists(os.path.join(staging, f"{s}.zarr")) for s in STORES):
        with tarfile.open(tar_path) as tf:
            tf.extractall(staging)
    for s in STORES:
        dst = os.path.join(dst_root, f"{s}.zarr")
        if not os.path.exists(dst):
            _rewrite(os.path.join(staging, f"{s}.zarr"), dst, 1, threads, log)   # back to one chunk per day
    shutil.rmtree(staging, ignore_errors=True)
    log("unpacked to one-chunk-per-day stores in " + dst_root)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("pack"); a.add_argument("--src", required=True); a.add_argument("--out", required=True)
    a.add_argument("--work", default="/content/pack"); a.add_argument("--threads", type=int, default=32)
    b = sub.add_parser("unpack"); b.add_argument("--tar", required=True); b.add_argument("--dst", required=True)
    b.add_argument("--threads", type=int, default=16)
    args = p.parse_args(argv)
    if args.cmd == "pack":
        pack(args.src, args.out, args.work, args.threads)
    else:
        unpack(args.tar, args.dst, args.threads)


if __name__ == "__main__":
    main()
