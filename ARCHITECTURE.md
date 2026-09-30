# OceanEmbed — Architecture

**SIH 2026 · PS 26066 · MoES / INCOIS.** Reconstruct daily, 0.25° ocean temperature at 15 standard depths
(0–1000 m) over the North Indian Ocean (5–30°N, 45–105°E) from surface satellite observations only.

| | |
|---|---|
| Inputs | SST (OSTIA), SSS (SMOS/SMAP multi-obs), SLA (DUACS), surface currents (OSCAR), 10 m winds (CCMP) |
| Target | GLORYS12 reanalysis temperature (moi-00021) |
| Independent validation | Argo profiles (never trained on) + HYCOM (independent model) + INCOIS gridded Argo |
| Period | 2005–2023 (19 years): train 2005–2021, validate 2022, test 2023 |
| Compute | Google Colab GPU with Google Drive storage. The laptop only runs the web console |
| Output | CF-NetCDF `thetao(time, depth, lat, lon)` + `thetao_sigma` (uncertainty) + derived D20/D26/TCHP/MLD |

---

## 1. What the research says, and what we take from it

### 1.1 The blueprint paper: Wang et al., *ESSD* 18, 4617–4638 (2026)
Attention-enhanced 3D U-Net++ over the NW Pacific (0–40°N, 120–160°E). Daily T and S on 26 levels (5–2000 m) at 1/4°,
from SST + SSH only.

| Finding in the paper | How OceanEmbed uses it |
|---|---|
| U-Net++ nested skip connections + deep supervision beat a plain U-Net for "surface → volume" | Our decoder is a U-Net++ (`NestedDecoder`), with deep supervision in "precise" (averaged-heads) mode |
| CBAM (channel + spatial attention) inside every block | Every `ConvBlock` ends in CBAM (Eq. 1–2 of the paper) |
| **Time as input**: 26 days of SST/SSH stacked as the 3D conv's depth axis. RMSE falls from 1 → 20 days and saturates near 26 | We use a 15-day window by default and run a 1/7/15/26-day ablation (notebook 02) |
| **Transfer learning**: pretrain on monthly gridded Argo, then fine-tune on daily GLORYS. Full fine-tune (RMSE 0.351) beat no transfer (0.378) and every freezing strategy (encoder frozen: 0.456) | Stage 1 (INCOIS gridded Argo) → Stage 2 (GLORYS), all layers trainable |
| Inference takes about 5 s per day on an A100, versus weeks-to-years latency for reanalyses | Makes the "near-real-time from satellites" pitch concrete |
| Reconstruction skill vs in-situ data is bounded by the label product's own skill vs in-situ data | Argo validation always reports GLORYS's own score next to ours (§5) |

We keep a **faithful replication** (`AttnUNetPP3D`) as the published baseline. Our model has to beat it on the same data.

### 1.2 Other methods (from the team's shortlist, used as references)
| Method | Idea | Role here |
|---|---|---|
| DP-CNN (dual-path CNN) | SST+SSS+SSH → subsurface T & S | Cheap baseline if time is short |
| VI-UNet (ViT + U-Net) | Transformer bottleneck for global context | Optional swap for the encoder bottleneck |
| ConvLSTM (Shi et al. 2015 architecture; global Argo reconstructions) | Explicit temporal memory | Our temporal-attention stem is a lighter alternative |
| Graph Attention Network (21 depths) | Irregular-graph formulation | Useful if we move from the grid to Argo points directly |
| Physics-informed NN | Physics losses on sparse in-situ + SST | Our vertical-gradient and SST-consistency losses |
| GLONET (Mercator), XiHe, Aurora | Neural ocean/Earth *forecasting* foundation models | Show SOTA context. They forecast, not reconstruct, so they are not our baseline |

> The shortlist's numbers (e.g. GAT RMSE ≈ 0.916 °C) come from those papers' own regions and depths. They are not
> comparable to our NIO numbers until we run them on our data.

### 1.3 Why "satellite embeddings" and not just a CNN
The PS asks for an embedding engine. Google's GEE Satellite Embedding dataset targets land surfaces at annual
resolution, so it does not fit daily ocean dynamics. We train our **own ocean-surface embedding**:
a masked autoencoder (He et al. 2022 idea, conv version) on eight years of surface windows. It sees no subsurface labels.
This does three things:
1. **The embedding exists independently of the target.** It can be reused for other tasks (MHW detection,
   salinity, fisheries) and visualised as a map of latent ocean state.
2. **Robustness to missing inputs.** SSS arrives 3–7 days late and winds 1–3 days late (the paper notes this too).
   Training hides whole variables (`var_dropout`), so the model degrades gracefully to SST + SLA-only real-time mode.
3. **Better initialisation** before the paper's two transfer-learning stages.

---

## 2. System overview

```
             ┌──────────────── Google Colab (GPU) ─────────────────┐        ┌──── Laptop / Vercel ────┐
 Copernicus ─┤ 01 ingest  → regrid → Zarr (Drive)                  │        │  web console (React)    │
 PO.DAAC   ──┤ 02 train   SSL → Argo → GLORYS  (checkpoints/Drive) │ JSON → │  map · profile · section│
 GEE (yours)─┤ 03 infer   2023 daily NetCDF + skill + web export   │        │  validation · copilot   │
 argopy    ──┘                                                     │        └──────────┬──────────────┘
             └─────────────────────────────────────────────────────┘                   │ phase 2
                                                                           FastAPI + Claude tool-use (§7)
```

Repository layout:
```
oceanembed/        Python package, the single source of truth imported by every notebook
  config.py        grid, depths, periods, dataset IDs, TrainConfig
  regrid.py        NaN-aware area-mean (sparse matrix) + bilinear + vertical interpolation
  ingest.py        resumable Copernicus / PO.DAAC / GEE → Zarr on Drive
  dataset.py       windows, normalisation, climatology anomalies, variable & patch masking
  model.py         SurfaceEncoder, NestedDecoder, OceanEmbedNet, SurfaceMAE, AttnUNetPP3D
  losses.py        Gaussian NLL, vertical gradient, SST consistency
  train.py         three-stage fit with AMP, OneCycle, resume from Drive
  metrics.py       RMSE/bias/r + D20, D26, TCHP, MLD, heat content
  argo.py          Argo fetch → standard depths → match → score
  infer.py         daily product + web JSON export
colab/             01_data_pipeline · 02_train · 03_validate_export (generated by _build_notebooks.py)
web/               Vite + React + Tailwind console in the Sylithe design language
```

---

## 3. Data pipeline (notebook 01)

### 3.1 Sources and access
| Var | Product | Native | Access | Harmonisation |
|---|---|---|---|---|
| SST | OSTIA L4 REP → NRT | 0.05° daily | `copernicusmarine.open_dataset` (lazy ARCO) | NaN-aware area mean → 0.25°, K → °C |
| SSS | Multi-obs SMOS/SMAP L4 | 0.125° daily | Copernicus Marine | area mean |
| SLA | DUACS L4 | 0.125° daily | Copernicus Marine | area mean |
| U,V currents | OSCAR v2.0 final | 0.25° daily | `earthaccess` download → subset → delete | bilinear |
| U,V wind | CCMP v3.1 | 0.25° 6-hourly | `earthaccess` | daily mean + bilinear |
| **Target T** | GLORYS12 my + myint | 1/12° daily, 50 levels | Copernicus Marine, 0–1300 m | vertical interpolation to 15 depths, then area mean |
| Comparator T | HYCOM GOFS 3.1 | 1/12° 3-hourly, 40 levels | **your GEE** (`syltihe`) via `computePixels` on the exact grid | daily mean, 15 depths |
| SST fallback | NOAA OISST v2.1 | 0.25° daily | GEE | used only if OSTIA fails, and logged |
| Validation | Argo core profiles | points | `argopy` (erddap, standard QC) | per-profile interpolation with gap limits |
| Pretrain | INCOIS gridded Argo | 1° monthly | LAS export (manual) | linear → 0.25° |

Verified on 2026-09-29 from this account: GEE has OISST (to Sept 2026), HYCOM T/S/SSH/currents (1992 to Sept 2024) and ERA5.
It does **not** host GLORYS, DUACS, SMAP/SMOS SSS, OSCAR or CCMP. Those need free Copernicus Marine and NASA Earthdata
logins, stored as Colab secrets.

### 3.2 Design decisions
- **Region writes into pre-allocated Zarr.** The full 6,939-day axis is created first. Each block writes its own slice
  and is logged in `<store>.done.json`, so a Colab disconnect costs at most one block.
- **Area-mean, not interpolation, for finer grids.** A sparse (target × source) matrix with cos(lat) weights and
  NaN-aware normalisation. Coastal cells average the ocean part only, never land.
- **Vertical before horizontal** for GLORYS: 50 levels become 15 first, cutting horizontal-regrid work by 3×. Columns
  shallower than a standard depth stay NaN; nothing is extrapolated below the sea floor.
- **int16 target storage** (scale 0.001 °C, offset 20) halves Drive usage with no loss that matters.
- **No silent product mixing.** The SLA channel has no GEE fallback, because HYCOM SSH is a different quantity from
  DUACS SLA and mixing them would put a discontinuity into the input.

### 3.3 Volumes (float32 equivalent)
Inputs 7 × 6,939 × 101 × 241 ≈ 4.7 GB. Target 15 × 6,939 × 101 × 241 ≈ 10 GB, or ≈ 5 GB as int16, less after
compression (about 48 % of cells are land). Expect roughly 5–7 GB on Drive in total, inside the free 15 GB.

### 3.4 Why 2005–2023
The paper fine-tuned on 30 years (1993–2022) and pretrained on Argo from 2005. We take 2005–2023: it is the dense-Argo
era, so the GLORYS target is anchored to real profiles; satellite SSS exists from 2010 (SMOS) and 2015 (SMAP); and it
spans many more monsoon, Indian Ocean Dipole and El Niño cycles, plus cyclone cold wakes, than 10 years would. Every input
exists back to 1993, so extending to the paper's full 30 years is a one-line change in `config.py` (at ~1.6× the download
time and Drive space).

---

## 4. Model (notebook 02)

### 4.1 Tensors
- `x`: (B, 7, T, 112, 256): normalised inputs over a T-day window, padded from 101 × 241
- `missing`: same shape, 1 where the input is absent (gap, dropped variable or masked patch). The network always knows what it cannot see
- `static`: (B, 5, 112, 256): ocean mask, latitude, longitude, sin/cos day-of-year
- output: μ and log σ² for 15 depths, as **anomalies** from a 31-day-smoothed GLORYS day-of-year climatology,
  divided by the per-depth anomaly σ (floored at 0.05 °C)

Predicting anomalies means the climatology carries the easy background (seasonal stratification) and the
network spends capacity on the hard part (eddies, Kelvin/Rossby waves, cyclone cold wakes). That is the same
"background → perturbation" split the paper gets from transfer learning.

### 4.2 OceanEmbedNet
```
x,missing ─► Conv3d×2 ─► temporal attention (softmax over T) ─► ⊕ static ─► CBAM block  X0,0  (32 ch, full res)
                                                                               │ maxpool
                                                                             CBAM block  X1,0  (64)
                                                                               │
                                                                             CBAM block  X2,0  (128)
                                                                               │
                                                                             CBAM block  X3,0  (256) ─► 1×1 ─► z (64-d embedding, 1/8 res)
U-Net++ decoder: X(i,j) = CBAM-Conv( [X(i,0..j-1), Up(X(i+1,j-1))] ),  heads on X(0,1..3) averaged ─► (μ, log σ²) × 15 depths
```
Temporal attention replaces the paper's use of time as the 3D depth axis. It learns which past days matter
(a cyclone's cold wake 5 days ago matters more than calm days) and makes the encoder independent of window length.

### 4.3 Losses (`losses.py`)
| Term | Why |
|---|---|
| Heteroscedastic Gaussian NLL | Learns the value *and* a per-pixel, per-depth σ, which gives the uncertainty maps in the UI |
| Vertical-gradient loss (×0.5) | Matches dT/dz between levels so the thermocline stays sharp instead of smeared |
| Surface consistency (×0.1) | T(0 m) should agree with the observed SST input |
| *No monotonicity penalty* | Deliberate: Bay of Bengal winter **temperature inversions** under the fresh barrier layer are real physics |

### 4.4 Training schedule
| Stage | Data | Epochs | Notes |
|---|---|---|---|
| 0 · SSL | inputs only, 50 % of 16×16 patches hidden in the last 3 days, whole-variable dropout | 30 | Keeps the encoder = embedding engine |
| 1 · Argo | monthly inputs → INCOIS gridded Argo | 40 | Anchors the model to observations (paper §2.2.2) |
| 2 · GLORYS | daily inputs → GLORYS, full fine-tune | 60 | AdamW 3e-4, OneCycle, AMP, grad-clip 1.0 |

On a T4 the 2D model (2.4 M params at base 32) fits batch 8 at 112 × 256. The 3D replication (1.6 M params at base 16) needs batch 2, because its activations carry the time axis at full resolution.

### 4.5 Experiments the final report needs
1. **Ours vs published baseline** (AttnUNetPP3D) on identical data
2. **Real-time mode**: SST + SLA only (the other variables dropped at inference)
3. **Window ablation**: 1 / 7 / 15 / 26 days
4. **With / without** SSL pretraining and the Argo stage
5. **Reference products**: GLORYS and HYCOM scored against the *same* Argo profiles

---

## 5. Validation (notebook 03)

- **vs GLORYS 2023** (held-out year): RMSE, bias, Pearson r per depth, for NIO / Bay of Bengal / Arabian Sea
- **vs HYCOM** (your GEE): an independent model, which shows we are not just copying GLORYS's quirks
- **vs Argo profiles** (independent observations): QC'd profiles, interpolated to standard depths with gap limits
  (15 m ≤ 100 m, 50 m ≤ 300 m, 150 m deeper), matched to the nearest cell on the same day. **GLORYS and HYCOM are
  scored on exactly the same profiles**, so the comparison is fair
- **Uncertainty calibration**: the fraction of Argo errors inside ±1σ should be ≈ 68 %
- **Physics diagnostics**: D20 (thermocline), D26 and TCHP (cyclone heat potential), MLD, compared to the reference
  products. These are verified in code against analytic profiles (D20 = 100 m, D26 = 40 m, TCHP = 32.68 kJ cm⁻² exact)

Caveat to state in the report: Argo pretraining uses *gridded* Argo from the training years. The 2023 profile check
stays temporally independent, but it is not independent of the Argo network as a whole.

---

## 6. Web console (web/)

A static React + Leaflet site that reads the export written by `oceanembed/webexport.py`. It needs no server.
The design is quiet on purpose: warm paper, charcoal ink, one ocean-teal accent, hairlines instead of cards,
Newsreader / Geist / Geist Mono type. All colour comes from the data, through cmocean colour maps (Thyng et al. 2016).

| Page | What it does |
|---|---|
| **Overview** | The problem and the method; the hero is a real cutaway (SST map over the 15°N section) |
| **Explorer** | Full-screen map of any layer: temperature, σ, GLORYS, model − GLORYS at a depth, D20 / D26 / TCHP / MLD, T₀ − SST, and the seven inputs. Depth gauge, timeline, region framing. Click to probe: profile with ±σ band, GLORYS and the nearest same-day Argo float, E–W / N–S section, depth–time view, CSV |
| **Embedding** | Linked triptych: surface state → latent representation (3 PCs of z through OKLab) → subsurface; latent regimes (k-means) with their mean profiles |
| **Validation** | Skill by depth vs Argo per product and region, float map coloured by error with click-through profiles, error strip plot, σ calibration (68 % / 95 %), table, leaderboard |
| **Cyclone watch** | TCHP map and 2° hotspots, share of each basin above 50 kJ cm⁻², a template-written printable bulletin |
| **Pipeline · Model · Data** | Sources and harmonisation; architecture diagram, stages, losses, experiments; output format and downloads |
| **Ask (`/`)** | A deterministic command line: phrases become the same actions as the controls, answers are computed from the loaded fields |

Data format v2: `manifest.json` plus `days/<date>/<layer>.bin` (int16, rows north→south, per-layer scale/offset; a
15-level day is 0.73 MB), `argo.json`, `skill_depth.json`, `coverage.json`, `leaderboard.json`. `python -m oceanembed.run web`
(or notebook 03) writes it from a trained run. Before training, `web/scripts/build_demo_data.py` builds it from the HYCOM
reference days with a 0.25° Natural Earth land mask and scores them against real Argo profiles (±3 days), and every page says so.

Engineering notes:
- Map overlays are resampled to Web-Mercator row spacing before Leaflet stretches them (a plain lat/lon image drifts ~0.3°).
- Derived metrics are a JS port of `metrics.py` with exact piecewise-linear integrals.
- Every view is a URL (`/explorer?date=…&layer=…&depth=…&probe=lon,lat&region=…`).
- Deploy on Vercel with Root Directory `web`.

## 7. Where an LLM belongs (and where it doesn't)

**Not inside the reconstruction model.** Mapping surface fields to a temperature cube is numerical regression on
gridded tensors. An LLM would add no skill, add latency and cost, and risk hallucinating numbers in a
disaster-management product. The science stays in the CNN, and it stays auditable.

**In the product layer, as an analyst that calls the same deterministic functions.** Phase 2 adds a FastAPI backend
that exposes the console's operations as tools for Claude (tool use):

| Tool | Returns |
|---|---|
| `get_profile(lat, lon, date)` | 15-level profile + σ, D20/D26/TCHP/MLD |
| `get_field(layer, depth, date, bbox)` | summary stats / hotspots for a layer |
| `compare_argo(date_range, region)` | skill table vs Argo for ours / GLORYS / HYCOM |
| `tchp_alert(date, threshold=50)` | regions over the rapid-intensification threshold |
| `set_view(layer, depth, date, probe)` | drives the console (the phase-1 command parser already emits these actions) |

Uses: natural-language exploration ("how deep is the warm layer under the cyclone track?"), **auto-drafted daily
ocean-state bulletins** for INCOIS forecasters (TCHP hotspots, D26 anomalies, marine-heatwave flags) with every
number coming from a tool call, and plain-language explanations of skill metrics for judges and non-specialists.
Model choice: `claude-sonnet-5-5` for interactive chat, `claude-opus-5-5` for bulletin drafting. Phase 1 already
ships the drawer with a deterministic, offline command parser, so the UI contract exists before the backend.

---

## 8. Roadmap to the SIH demo

| Step | Where | Output |
|---|---|---|
| 1. Create Copernicus Marine + Earthdata logins, add Colab secrets | browser | — |
| 2. Upload `oceanembed/` to `MyDrive/OceanEmbed/code/`, run notebook 01 (dry run, then full) | Colab | Zarr stores on Drive |
| 3. Export INCOIS gridded Argo from LAS (optional Stage 1) | LAS | NetCDF on Drive |
| 4. Notebook 02: SSL → (Argo) → GLORYS, then the 3D baseline and ablations | Colab GPU | checkpoints |
| 5. Notebook 03: 2023 product, skill vs GLORYS / HYCOM / Argo, web export | Colab | NetCDF + JSON |
| 6. Drop `web_export/*` into `web/public/data/`, wire the day picker to `index.json` | laptop | live console |
| 7. Phase 2: FastAPI + Claude copilot + bulletin generator | — | analyst features |

### Risks
| Risk | Mitigation |
|---|---|
| Copernicus dataset IDs change between versions | notebook 01 "verify IDs" cell before any long pull; all IDs in `config.py` |
| Colab session limits | resumable ingest and training; everything persists on Drive |
| SSS/wind latency in real time | variable-dropout training + separately reported SST+SLA-only mode |
| Model inherits GLORYS biases | Argo stage + always report GLORYS-vs-Argo alongside ours |
| Coastal / shallow cells | per-depth sea-floor mask from the climatology; no extrapolation |

---

## 9. References
- Wang, H., Zhang, L., Yang, S., Yan, X., Li, Z. (2026). Attention enhanced 3D-U-Net++ ocean temperature and salinity reconstruction in the northwestern Pacific based on transfer learning. *ESSD* 18, 4617–4638. doi:10.5194/essd-18-4617-2026
- Zhou, Z. et al. (2018). UNet++: A Nested U-Net Architecture for Medical Image Segmentation.
- Woo, S. et al. (2018). CBAM: Convolutional Block Attention Module. *ECCV*.
- He, K. et al. (2022). Masked Autoencoders Are Scalable Vision Learners. *CVPR*.
- Shi, X. et al. (2015). Convolutional LSTM Network. *NeurIPS*.
- Pan, S. J., Yang, Q. (2010). A Survey on Transfer Learning. *IEEE TKDE*.
- Data: GLORYS12 (doi:10.48670/moi-00021), OSTIA (moi-00168), multi-obs SSS (moi-00051), DUACS (moi-00145), OSCAR v2.0, CCMP v3.1, NOAA OISST v2.1, HYCOM GOFS 3.1, Argo (argopy).
- Tooling: `copernicusmarine`, `earthaccess`, `argopy`, `earthengine-api`, xarray + Zarr, PyTorch.
