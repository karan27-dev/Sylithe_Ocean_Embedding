#!/usr/bin/env bash
# Final stretch on the pod (replaces runpod_final.sh):
#   every 10 min  back up to Google Drive
#   when training ends
#     1. daily pipeline: replay 2023 day by day with the ensemble (cached), then export the Daily-page files
#     2. console export (oceanembed.run web)   3. paper evaluation + figures
#     4. final copy to Drive, then stop the pod (only if the copy succeeded)
#
#   nohup bash scripts/runpod_final2.sh > /workspace/autosave.log 2>&1 &
REPO=/workspace/Sylithe_Ocean_Embedding
OUT=/workspace/OceanEmbed
DATA=/workspace/data
DEST=gdrive:OceanEmbed/runpod_results
save() { rclone copy "$OUT" "$DEST" --exclude "*_last.pt" --transfers 16 -q; }

while pgrep -f "[o]ceanembed.run" >/dev/null; do
  sleep 600
  save
done
cd "$REPO" || exit 1
{ python -m oceanembed.daily run --data "$DATA" --root "$OUT" --start 2023-01-01 --end 2023-12-31 \
  && python -m oceanembed.daily export --data "$DATA" --root "$OUT" --out "$OUT/web_ops" --maps-last 31; } \
  > /workspace/daily.log 2>&1
save
python -m oceanembed.run web --data "$DATA" --root "$OUT" --workers 6 > /workspace/web.log 2>&1
save
python -m oceanembed.paper_eval --data "$DATA" --root "$OUT" --out "$OUT/paper" --figures > /workspace/paper.log 2>&1
save && runpodctl stop pod "$RUNPOD_POD_ID"
