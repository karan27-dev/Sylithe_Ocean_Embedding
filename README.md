# OceanEmbed

Satellite-embedding deep learning that reconstructs **daily 0.25° subsurface temperature at 15 depths (0–1000 m)**
over the North Indian Ocean from surface observations only. Built for SIH 2026, PS 26066 (MoES / INCOIS).

→ Full design, research notes and roadmap: **[ARCHITECTURE.md](ARCHITECTURE.md)**

## Quick start

**Data + training (Google Colab):**
1. Copy the `oceanembed/` folder to `MyDrive/OceanEmbed/code/oceanembed/`.
2. In Colab secrets add `CMEMS_USER`, `CMEMS_PASS`, `EARTHDATA_USER`, `EARTHDATA_PASS`.
3. Run `colab/01_data_pipeline.ipynb` → `02_train.ipynb` (GPU) → `03_validate_export.ipynb`.

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
