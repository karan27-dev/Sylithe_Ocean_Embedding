# OceanEmbed

Satellite-embedding deep learning that reconstructs **daily 0.25° subsurface temperature at 15 depths (0–1000 m)**
over the North Indian Ocean from surface observations only. Built for SIH 2026, PS 26066 (MoES / INCOIS).

→ Full design, research notes and roadmap: **[ARCHITECTURE.md](ARCHITECTURE.md)**

## Quick start

**Data + training (Google Colab):** the notebooks clone this repo themselves, so nothing needs uploading.
1. In Colab secrets (🔑) add `CMEMS_USER`, `CMEMS_PASS`, `EARTHDATA_USER`, `EARTHDATA_PASS` and enable notebook access.
2. Run in order:
   - [01 · Data pipeline](https://colab.research.google.com/github/karan27-dev/Sylithe_Ocean_Embedding/blob/main/colab/01_data_pipeline.ipynb)
   - [02 · Train (GPU)](https://colab.research.google.com/github/karan27-dev/Sylithe_Ocean_Embedding/blob/main/colab/02_train.ipynb)
   - [03 · Validate & export](https://colab.research.google.com/github/karan27-dev/Sylithe_Ocean_Embedding/blob/main/colab/03_validate_export.ipynb)

**Console (local):**
```bash
cd web && npm install && npm run dev
```
Open `http://localhost:5173/?layer=tchp&probe=88,15`. Until a model is trained, the console shows real HYCOM + OISST
reference fields pulled from Google Earth Engine.

## Layout
```
oceanembed/   Python package: config, regrid, ingest, dataset, model, losses, train, metrics, argo, infer
colab/        three notebooks (regenerate with python colab/_build_notebooks.py)
web/          React + Leaflet + Recharts console, Sylithe design tokens
```

## Train on RunPod (or any CUDA machine)

Everything in notebooks 02–03, as one resumable command. Data comes straight from your Google Drive.

**1 · Pack the data (once, Colab CPU runtime).** Drive is slow at the stores' ~55,000 one-day files, so they are
read with 32 threads, rewritten as ~600 larger chunks and uploaded as one file; RunPod restores one-day chunks:
```python
from google.colab import drive; drive.mount('/content/drive')
!git clone -q https://github.com/karan27-dev/Sylithe_Ocean_Embedding /content/code
!pip -q install zarr
!cd /content/code && python -m oceanembed.pack pack --src /content/drive/MyDrive/OceanEmbed --out /content/drive/MyDrive/OceanEmbed/pack.tar
```

**2 · Create the pod.** PyTorch template, one GPU (RTX 4090 / L40S / A100), a **network volume of ~40 GB mounted at
`/workspace`** so data and checkpoints survive a stop. Open the pod's terminal.

**3 · Connect rclone to your Google Drive** (you sign in; nobody else sees your token):
```bash
curl -fsSL https://rclone.org/install.sh | bash
rclone config        # n → name: gdrive → storage: drive → client id/secret: blank → scope: 1 (full)
                     # → service account: blank → edit advanced: n → use web browser: n
```
rclone prints a command like `rclone authorize "drive" "…"`. Run that on your **laptop** (`brew install rclone`),
sign in to Google there, and paste the token it prints back into the pod. Finish with `n` (not a team drive) and `y`.

**4 · Code + data:**
```bash
cd /workspace && git clone https://github.com/karan27-dev/Sylithe_Ocean_Embedding && cd Sylithe_Ocean_Embedding
bash scripts/runpod_setup.sh
```

**5 · Train and score everything within a budget:**
```bash
nohup python -m oceanembed.run all --data /workspace/data --root /workspace/OceanEmbed \
      --hours 6 --seeds 42 7 1234 --batch 16 --workers 8 > /workspace/run.log 2>&1 &
tail -f /workspace/run.log
```
`--hours` is GPU time for training, split 15 % embedding engine / 55 % OceanEmbed seeds / 25 % published method.
Each stage's learning rate anneals inside its share, so a budget stop still ends on a converged model. Leave
~1.5 h on top for setup, statistics and the leaderboard: with **$10** at a pod price of **P $/h**, use
`--hours ≈ 10 / P − 1.5`. If the pod stops, re-run the same command: it resumes.

**6 · Results back to Drive** (small):
```bash
rclone copy -P /workspace/OceanEmbed gdrive:OceanEmbed/runpod_results --exclude "*_last.pt"
```
Leaderboard: `/workspace/OceanEmbed/leaderboard/leaderboard.md`; product: `OceanEmbed_NIO_T_2023.nc`.
**Stop the pod when finished** (billing continues while it runs).
