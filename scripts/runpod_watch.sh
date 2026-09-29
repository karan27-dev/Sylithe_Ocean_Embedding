#!/usr/bin/env bash
# Runs next to training on a RunPod pod:
#   every 30 min  copy checkpoints/logs/leaderboard to Google Drive (so nothing is lost if the pod dies)
#   at the end    paper evaluation + figures, final copy, then stop the pod (only if the copy succeeded)
#
#   nohup bash scripts/runpod_watch.sh > /workspace/autosave.log 2>&1 &
REPO=/workspace/Sylithe_Ocean_Embedding
OUT=/workspace/OceanEmbed
DEST=gdrive:OceanEmbed/runpod_results
save() { rclone copy "$OUT" "$DEST" --exclude "*_last.pt" -q; }

while pgrep -f "[o]ceanembed.run" >/dev/null; do
  sleep 1800
  save
done
cd "$REPO" && python -m oceanembed.paper_eval --data /workspace/data --root "$OUT" --out "$OUT/paper" --figures \
  > /workspace/paper.log 2>&1
save && runpodctl stop pod "$RUNPOD_POD_ID"
