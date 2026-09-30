#!/usr/bin/env bash
# Replaces runpod_watch.sh for the last stretch of a run:
#   every 30 min  back up checkpoints/logs/leaderboard to Google Drive
#   when training ends
#     1. web export   (oceanembed.run web: maps for May 2023, Argo scores, leaderboard → web_export/)
#     2. paper evaluation + figures
#     3. final copy to Drive, then stop the pod (only if the copy succeeded)
#
#   nohup bash scripts/runpod_final.sh > /workspace/autosave.log 2>&1 &
REPO=/workspace/Sylithe_Ocean_Embedding
OUT=/workspace/OceanEmbed
DATA=/workspace/data
DEST=gdrive:OceanEmbed/runpod_results
save() { rclone copy "$OUT" "$DEST" --exclude "*_last.pt" -q; }

while pgrep -f "[o]ceanembed.run" >/dev/null; do
  sleep 600
  save
done
cd "$REPO" || exit 1
python -m oceanembed.run web --data "$DATA" --root "$OUT" --workers 6 > /workspace/web.log 2>&1
save
python -m oceanembed.paper_eval --data "$DATA" --root "$OUT" --out "$OUT/paper" --figures > /workspace/paper.log 2>&1
save && runpodctl stop pod "$RUNPOD_POD_ID"
