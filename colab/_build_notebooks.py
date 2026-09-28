"""Regenerates the three Colab notebooks from the cell lists below (keeps them diff-able)."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))

def nb(cells):
    out = []
    for kind, src in cells:
        c = {"cell_type": kind, "metadata": {}, "source": src.strip("\n").splitlines(keepends=True)}
        if kind == "code":
            c |= {"execution_count": None, "outputs": []}
        out.append(c)
    return {"cells": out, "nbformat": 4, "nbformat_minor": 5,
            "metadata": {"accelerator": "GPU", "colab": {"provenance": [], "gpuType": "T4"},
                         "kernelspec": {"name": "python3", "display_name": "Python 3"}}}

SETUP = ("code", r'''
# ── Setup: Drive (data) + GitHub (code) + deps ──────────────────────────────
from google.colab import drive, userdata
drive.mount('/content/drive')
ROOT = '/content/drive/MyDrive/OceanEmbed'          # data, checkpoints, outputs live here
REPO = '/content/Sylithe_Ocean_Embedding'
import os, sys; os.makedirs(ROOT, exist_ok=True)
if os.path.exists(REPO): !git -C {REPO} pull -q
else: !git clone -q https://github.com/karan27-dev/Sylithe_Ocean_Embedding {REPO}
sys.path.insert(0, REPO)
!pip -q install copernicusmarine earthaccess argopy "xarray>=2024.6" zarr dask netcdf4 earthengine-api
''')

NB1 = [
("markdown", """
# 01 · Data pipeline — 10 years of surface inputs + GLORYS target → Zarr on Drive
Runs entirely on Colab. Nothing touches the laptop disk. Every step is **resumable**: re-run a cell after a
disconnect and it continues from `<store>.done.json`.

| Store | Contents | Size (approx) |
|---|---|---|
| `inputs.zarr` | SST (OSTIA), SSS (CMEMS multi-obs), SLA (DUACS), currents (OSCAR), winds (CCMP), 2014–2023 daily, 0.25° | ~1.5 GB |
| `target.zarr` | GLORYS12 θ at 15 standard depths, int16 (0.001 °C) | ~2.5 GB |
| `hycom.zarr` | HYCOM via **your GEE** (test year, independent comparator) | ~0.3 GB |
| `argo_2023.parquet` | Argo profiles for independent validation | small |

**Secrets** (🔑 icon in the left bar): `CMEMS_USER`, `CMEMS_PASS` (free at marine.copernicus.eu),
`EARTHDATA_USER`, `EARTHDATA_PASS` (free at urs.earthdata.nasa.gov). GEE uses your own login, project `syltihe`.
"""),
SETUP,
("code", r'''
# ── Credentials ───────────────────────────────────────────────────────────
import copernicusmarine, earthaccess, ee
copernicusmarine.login(username=userdata.get('CMEMS_USER'), password=userdata.get('CMEMS_PASS'), force_overwrite=True)
os.environ['EARTHDATA_USERNAME'] = userdata.get('EARTHDATA_USER')
os.environ['EARTHDATA_PASSWORD'] = userdata.get('EARTHDATA_PASS')
earthaccess.login(strategy='environment')
ee.Authenticate(); ee.Initialize(project='syltihe')
print('all providers authenticated')
'''),
("code", r'''
# ── Verify dataset IDs before a multi-hour pull (IDs change with product versions) ──
from oceanembed import config as C
ids = {s.dataset_id for v in C.SOURCES.values() for s in v if s.provider == 'cmems'} | set(C.GLORYS_IDS)
for i in sorted(ids):
    try:
        ds = copernicusmarine.open_dataset(dataset_id=i, **C.BBOX)
        print(f'OK  {i}: {str(ds.time.values[0])[:10]} → {str(ds.time.values[-1])[:10]}  vars={list(ds.data_vars)[:5]}')
    except Exception as e:
        print(f'ERR {i}: {str(e)[:200]}  → fix the ID in oceanembed/config.py')
for sn in ['OSCAR_L4_OC_FINAL_V2.0', 'CCMP_WINDS_10M6HR_L4_V3.1']:
    r = earthaccess.search_data(short_name=sn, temporal=('2023-01-01', '2023-01-02'))
    print(('OK ' if r else 'ERR'), sn, len(r), 'granules')
'''),
("code", r'''
# ── Dry run: one month of every input into a scratch store, then look at it ──
from oceanembed import ingest
C.START, C.END = '2023-01-01', '2023-01-31'
ingest.ingest_inputs('/content/dry', days_per_block=31)
import xarray as xr, matplotlib.pyplot as plt
d = xr.open_zarr('/content/dry/inputs.zarr').isel(time=14)
fig, ax = plt.subplots(2, 4, figsize=(20, 7))
for a, v in zip(ax.flat, C.INPUT_VARS): d[v].plot(ax=a, cmap='RdYlBu_r'); a.set_title(v)
ax.flat[-1].axis('off'); plt.tight_layout()
C.START, C.END = '2014-01-01', '2023-12-31'      # restore the full 10-year period
'''),
("markdown", "## Full 10-year ingest (long: run, close the tab, come back — it resumes)"),
("code", r'''
ingest.ingest_inputs(ROOT, days_per_block=31)
'''),
("code", r'''
# GLORYS target: streamed from Copernicus ARCO, vertical → 15 std depths, 1/12° → 0.25° area mean.
ingest.ingest_glorys(ROOT, days_per_block=8)
'''),
("code", r'''
# Independent comparator from YOUR Google Earth Engine account (not used in training)
ingest.ingest_hycom(ROOT)
'''),
("code", r'''
# ── Independent Argo profiles for the test year ────────────────────────────
from oceanembed import argo
prof = argo.fetch_profiles()
prof.to_parquet(f'{ROOT}/argo_2023.parquet'); print(len(prof), 'profiles')
'''),
("markdown", """
### Optional — Stage-1 transfer learning data (paper §2.2.2)
Export **monthly gridded Argo** temperature for 2014–2023 over 45–105°E, 5–30°N from the INCOIS LAS
(the PS's named source) as NetCDF, upload to `MyDrive/OceanEmbed/argo_grid/`, set `VAR` to its variable name.
"""),
("code", r'''
import glob
files = sorted(glob.glob(f'{ROOT}/argo_grid/*.nc'))
VAR = 'TEMP'                      # check with xr.open_dataset(files[0])
if files: ingest.ingest_gridded_argo(ROOT, files, VAR)
else: print('no gridded Argo files yet: stage 1 will be skipped')
'''),
("code", r'''
# ── QA: coverage per variable (fraction of ocean pixel-days that are valid) ──
ds = xr.open_zarr(f'{ROOT}/inputs.zarr'); T = xr.open_zarr(f'{ROOT}/target.zarr').thetao
ocean = T.isel(time=0, depth=0).notnull()
for v in C.INPUT_VARS:
    frac = float(ds[v].where(ocean).notnull().sum() / (ocean.sum() * ds.sizes['time']))
    print(f'{v:4s} {frac:6.1%}')
print('target', float(T.isel(depth=0).where(ocean).notnull().sum() / (ocean.sum() * T.sizes['time'])))
'''),
]

NB2 = [
("markdown", """
# 02 · Train — embedding engine → gridded-Argo pretrain → GLORYS fine-tune
Runtime: **GPU** (T4 works; A100/L4 ≈ 3× faster). Checkpoints go to Drive every epoch and training resumes.
"""),
SETUP,
("code", r'''
import torch, shutil, numpy as np
print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NO GPU: Runtime → Change runtime type')
from oceanembed import config as C, dataset as D, train as TR
# Local copy: Drive reads per sample are slow, local SSD is fast
for s in ['inputs.zarr', 'target.zarr', 'inputs_monthly.zarr', 'argo_monthly.zarr']:
    if os.path.exists(f'{ROOT}/{s}') and not os.path.exists(f'/content/{s}'):
        shutil.copytree(f'{ROOT}/{s}', f'/content/{s}')
STATS = f'{ROOT}/stats.npz'
if not os.path.exists(STATS): D.compute_stats('/content/inputs.zarr', '/content/target.zarr', STATS)
S = D.load_stats(STATS)
cfg = C.TrainConfig(window=15, base=32, batch_size=8)
CK = f'{ROOT}/checkpoints/{cfg.arch}_w{cfg.window}'
'''),
("markdown", "## Stage 0 · Self-supervised embedding engine (masked surface autoencoder, no labels)"),
("code", r'''
mk = lambda period, train: D.SurfaceWindows('/content/inputs.zarr', None, S, period, cfg.window, train=train,
                                            var_dropout=cfg.var_dropout if train else 0, patch_mask=0.5, need_target=False)
mae, net = TR.new_models(cfg)
TR.fit(mae, mk(C.TRAIN, True), mk(C.VAL, False), cfg, 'ssl', CK, cfg.epochs_ssl)
TR.load_encoder_from_ssl(net, f'{CK}/ssl_best.pt')
'''),
("markdown", "## Stage 1 · Gridded-Argo monthly pretrain (skipped automatically if notebook 01 had no files)"),
("code", r'''
if os.path.exists('/content/argo_monthly.zarr'):
    Sm = dict(S)   # same normalisation; monthly samples use the mid-month climatology
    mkm = lambda p, tr: D.SurfaceWindows('/content/inputs_monthly.zarr', '/content/argo_monthly.zarr', Sm, p,
                                         cfg.window, train=tr, var_dropout=cfg.var_dropout if tr else 0)
    TR.fit(net, mkm(C.TRAIN, True), mkm(C.VAL, False), cfg, 'argo', CK, cfg.epochs_argo, depth_std=S['depth_std'])
    TR.load_weights(net, f'{CK}/argo_best.pt')
'''),
("markdown", "## Stage 2 · GLORYS daily fine-tune — all layers trainable (the paper's best strategy)"),
("code", r'''
mkd = lambda p, tr: D.SurfaceWindows('/content/inputs.zarr', '/content/target.zarr', S, p, cfg.window,
                                     train=tr, var_dropout=cfg.var_dropout if tr else 0)
TR.fit(net, mkd(C.TRAIN, True), mkd(C.VAL, False), cfg, 'glorys', CK, cfg.epochs_glorys, depth_std=S['depth_std'])
'''),
("code", r'''
# Validation skill per depth (vs GLORYS 2022)
import pandas as pd
v = torch.load(f'{CK}/glorys_best.pt', weights_only=False)['val']['per_depth']
pd.DataFrame(v).T.round(3)
'''),
("markdown", """
## Baseline · faithful Attention 3D U-Net++ (Wang et al., ESSD 2026)
Same data, no embedding pretraining. Needed for the "ours vs published method" table.
"""),
("code", r'''
cfg3 = C.TrainConfig(window=15, base=16, batch_size=2, arch='attn_unetpp3d')
_, net3 = TR.new_models(cfg3)
CK3 = f'{ROOT}/checkpoints/attn_unetpp3d_w15'
TR.fit(net3, mkd(C.TRAIN, True), mkd(C.VAL, False), cfg3, 'glorys', CK3, cfg3.epochs_glorys, depth_std=S['depth_std'])
'''),
("markdown", "## Ablation · input window length (paper: gain saturates ≈ 26 d)"),
("code", r'''
for w in [1, 7, 26]:
    c = C.TrainConfig(window=w, epochs_glorys=20)
    _, n = TR.new_models(c); TR.load_encoder_from_ssl(n, f'{CK}/ssl_best.pt')   # encoder is window-agnostic
    mk_w = lambda p, tr: D.SurfaceWindows('/content/inputs.zarr', '/content/target.zarr', S, p, w, train=tr,
                                          var_dropout=c.var_dropout if tr else 0)
    print(w, TR.fit(n, mk_w(C.TRAIN, True), mk_w(C.VAL, False), c, 'glorys', f'{ROOT}/checkpoints/ablate_w{w}',
                    c.epochs_glorys, depth_std=S['depth_std']))
'''),
]

NB3 = [
("markdown", """
# 03 · Reconstruct 2023, validate independently, export for the console
Test year 2023 was never seen in training. Scores against **GLORYS** (the target), **HYCOM** (your GEE,
independent model) and **Argo** profiles (independent observations), for NIO / Bay of Bengal / Arabian Sea.
"""),
SETUP,
("code", r'''
import torch, numpy as np, pandas as pd, xarray as xr, shutil
from oceanembed import config as C, dataset as D, train as TR, infer as I, argo as A, metrics as M
for s in ['inputs.zarr', 'target.zarr', 'hycom.zarr']:
    if os.path.exists(f'{ROOT}/{s}') and not os.path.exists(f'/content/{s}'): shutil.copytree(f'{ROOT}/{s}', f'/content/{s}')
S = D.load_stats(f'{ROOT}/stats.npz')
cfg = C.TrainConfig(window=15)
_, net = TR.new_models(cfg); TR.load_weights(net, f'{ROOT}/checkpoints/{cfg.arch}_w{cfg.window}/glorys_best.pt')
rec = I.reconstruct(net, '/content/inputs.zarr', S, *C.TEST, window=cfg.window)
rec.to_netcdf(f'{ROOT}/OceanEmbed_NIO_T_2023.nc')          # the PS deliverable
'''),
("code", r'''
# ── vs GLORYS and vs HYCOM, per depth and region ────────────────────────────
gl = xr.open_zarr('/content/target.zarr').thetao.sel(time=rec.time)
hy = xr.open_zarr('/content/hycom.zarr').thetao.sel(time=rec.time)
rows = []
for reg in C.REGIONS:
    mask = M.region_mask(reg)
    for name, ref in [('GLORYS', gl), ('HYCOM', hy)]:
        s = M.skill(np.where(mask, rec.thetao.values, np.nan), np.where(mask, ref.values, np.nan))
        rows += [dict(region=reg, vs=name, depth=d, **v) for d, v in s.items()]
skill = pd.DataFrame(rows); skill.to_csv(f'{ROOT}/skill_2023.csv', index=False)
skill.pivot_table(index='depth', columns=['region', 'vs'], values='rmse').round(3)
'''),
("code", r'''
# ── Independent Argo check: ours vs GLORYS vs HYCOM at the same profiles ────
prof = pd.read_parquet(f'{ROOT}/argo_2023.parquet')
m = A.match(A.match(A.match(prof, rec.thetao, 'ours'), gl, 'glorys'), hy, 'hycom')
tab = {n: A.score(m, n).set_index('depth')[['rmse', 'bias', 'r']] for n in ['ours', 'glorys', 'hycom']}
argo_skill = pd.concat(tab, axis=1); argo_skill.to_csv(f'{ROOT}/argo_skill_2023.csv'); argo_skill.round(3)
'''),
("code", r'''
# ── Is the predicted uncertainty honest? (fraction of Argo errors inside ±1σ should be ≈ 68 %) ──
sig = A.match(prof, rec.thetao_sigma, 'sig')
inside = [(np.abs(m[f'ours_T{d}'] - m[f'T{d}']) <= sig[f'sig_T{d}']).mean() for d in C.DEPTHS]
pd.Series(inside, index=C.DEPTHS, name='coverage@1σ').round(2)
'''),
("code", r'''
# ── Export for the web console → download the folder into OceanEmbed/web/public/data/ ──
days = pd.date_range('2023-05-01', '2023-05-31')   # e.g. the pre-monsoon / Cyclone Mocha window
I.export_web(rec.sel(time=days), f'{ROOT}/web_export', comparison=gl.sel(time=days).to_dataset(name='thetao'))
flat = argo_skill.copy(); flat.columns = [f'{a}_{b}' for a, b in flat.columns]   # ours_rmse, glorys_bias, ...
open(f'{ROOT}/web_export/skill.json', 'w').write(flat.reset_index().to_json(orient='records'))
'''),
]

for name, cells in [("01_data_pipeline", NB1), ("02_train", NB2), ("03_validate_export", NB3)]:
    json.dump(nb(cells), open(os.path.join(HERE, f"{name}.ipynb"), "w"), indent=1)
    print("wrote", name)
