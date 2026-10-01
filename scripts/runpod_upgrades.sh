#!/usr/bin/env bash
# Finale upgrades on a RunPod pod: σ calibration, cyclone tracks, gridded Argo, thermocline fine-tune,
# near-real-time fine-tune, ablations + embedding probe. Saves to Google Drive every 10 min and stops the pod
# at the end.
#
#   1. Pod: PyTorch template, A40 or RTX A6000 (48 GB), 50 GB container + network volume at /workspace
#   2. cd /workspace && git clone https://github.com/karan27-dev/Sylithe_Ocean_Embedding.git   (private repo:
#      use a GitHub token as the password, or upload the repo)
#   3. bash Sylithe_Ocean_Embedding/scripts/runpod_setup.sh       (data from Drive; skips what is already there)
#   4. export COPERNICUSMARINE_SERVICE_USERNAME=…  COPERNICUSMARINE_SERVICE_PASSWORD=…   (for the NRT step)
#   5. nohup bash Sylithe_Ocean_Embedding/scripts/runpod_upgrades.sh > /workspace/upgrades.log 2>&1 &
#      tail -f /workspace/upgrades.log
#
# MINUTES (default 40) is the training time per run: 3 thermo + 3 NRT fine-tunes + 5 ablations (+2 short probes)
# ≈ 12 runs → ~9 h of GPU at 40 min. MINUTES=25 brings it to ~6 h.
set -u
REPO=/workspace/Sylithe_Ocean_Embedding
OUT=/workspace/OceanEmbed
DATA=/workspace/data
SRC=gdrive:OceanEmbed/runpod_results
# Drive rate-limits rclone's shared app: go gently and retry
RC="--tpslimit 6 --retries 10 --low-level-retries 30"
DEST=gdrive:OceanEmbed/runpod_results/upgrades
MINUTES=${MINUTES:-40}
cd "$REPO" || exit 1
pip install -q copernicusmarine pyarrow netCDF4

echo "== trained models, statistics and the 2023 ensemble from Drive"
mkdir -p "$OUT"
rclone copy $RC "$SRC" "$OUT" --include "stats_v2.npz" --include "OceanEmbed_NIO_T_2023.nc" \
  --include "checkpoints/oceanembed_w15/seed*/glorys_best.pt" --include "checkpoints/oceanembed_w15/ssl_best.pt" -P
n=$(ls "$OUT"/checkpoints/oceanembed_w15/seed*/glorys_best.pt 2>/dev/null | wc -l)
[ -f "$OUT/stats_v2.npz" ] && [ "$n" -ge 1 ] || { echo "models/statistics did not arrive from Drive (rate limit?): re-run this script"; exit 1; }
echo "models: $n members"

save() { rclone copy $RC "$OUT/upgrades" "$DEST" --exclude "release_models/**" -q
         rclone copy $RC "$OUT/upgrades/release_models" "$DEST/release_models" -q 2>/dev/null
         rclone copy $RC "$OUT/checkpoints" "$DEST/checkpoints" --include "*_best.pt" --include "*_log.csv" -q; }
( while true; do sleep 600; save; done ) & SAVER=$!

python -m oceanembed.upgrades all --data "$DATA" --root "$OUT" --minutes "$MINUTES" \
  --steps calibrate cyclones gridded thermo nrt ablate

kill $SAVER; save
echo "upgrades finished: results in $DEST"
runpodctl stop pod "$RUNPOD_POD_ID"
