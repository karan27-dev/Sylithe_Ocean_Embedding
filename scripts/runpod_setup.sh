#!/usr/bin/env bash
# One-time setup on a RunPod pod (PyTorch template, network volume mounted at /workspace).
# Safe to re-run: every step skips work that is already done.
#
#   bash scripts/runpod_setup.sh            # after cloning the repo into /workspace/Sylithe_Ocean_Embedding
#
# Needs an rclone remote called "gdrive" for your Google Drive (see README: "Train on RunPod").
set -euo pipefail

DATA=/workspace/data
DRIVE_DIR=${DRIVE_DIR:-OceanEmbed}          # folder in My Drive written by notebook 01
mkdir -p "$DATA"

echo "== python packages"
pip install -q xarray zarr dask netCDF4 scipy pandas pyarrow psutil tabulate

echo "== rclone"
if ! command -v rclone >/dev/null; then
  curl -fsSL https://rclone.org/install.sh | bash
fi
if ! rclone listremotes | grep -q '^gdrive:$'; then
  echo "No rclone remote 'gdrive' yet. Run:  rclone config   (see README: Train on RunPod), then re-run this script."
  exit 1
fi

echo "== training data from Google Drive"
if [ ! -d "$DATA/inputs.zarr" ] || [ ! -d "$DATA/target.zarr" ]; then
  rclone copy -P "gdrive:$DRIVE_DIR/cache_inputs_target.tar" "$DATA/"
  tar -xf "$DATA/cache_inputs_target.tar" -C "$DATA" && rm "$DATA/cache_inputs_target.tar"
fi

echo "== validation data (HYCOM comparator, Argo profiles)"
[ -f "$DATA/argo_2023.parquet" ] || rclone copy -P "gdrive:$DRIVE_DIR/argo_2023.parquet" "$DATA/"
[ -d "$DATA/hycom.zarr" ] || rclone copy -P --transfers 32 "gdrive:$DRIVE_DIR/hycom.zarr" "$DATA/hycom.zarr"

echo "== check"
python - <<'PY'
import xarray as xr, torch
for s in ["inputs", "target"]:
    ds = xr.open_zarr(f"/workspace/data/{s}.zarr"); print(s, dict(ds.sizes), str(ds.time.values[0])[:10], "→", str(ds.time.values[-1])[:10])
print("GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none")
PY
echo "setup done"
