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
if os.path.exists(REPO):
    !git -C {REPO} pull -q
else:
    !git clone -q https://github.com/karan27-dev/Sylithe_Ocean_Embedding {REPO}
sys.path.insert(0, REPO)
for m in [m for m in sys.modules if m.startswith('oceanembed')]:
    del sys.modules[m]                              # re-running this cell picks up freshly pulled code
!git -C {REPO} log --oneline -1
# Install only what this Colab image lacks (images differ between sessions), one package at a time, so pip
# never searches a large version space (that is what hung before).
import importlib, importlib.util, subprocess
NEED = {'xarray': 'xarray', 'zarr': 'zarr', 'dask': 'dask', 'netCDF4': 'netCDF4', 'scipy': 'scipy',
        'ee': 'earthengine-api', 'copernicusmarine': 'copernicusmarine', 'earthaccess': 'earthaccess', 'psutil': 'psutil'}
for mod, pkg in NEED.items():
    if importlib.util.find_spec(mod) is None:
        print('installing', pkg)
        subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '--upgrade-strategy', 'only-if-needed', pkg], check=True)
importlib.invalidate_caches()
for mod in NEED:
    print(f'{mod:17s}', getattr(importlib.import_module(mod), '__version__', 'ok'))
''')

NB1 = [
("markdown", """
# 01 · Data pipeline — 19 years (2005–2023) of surface inputs + GLORYS target → Zarr on Drive
Runs entirely on Colab. Nothing touches the laptop disk. Every step is **resumable**: re-run a cell after a
disconnect and it continues from `<store>.done.json`.

| Store | Contents | Size (approx) |
|---|---|---|
| `inputs.zarr` | SST (OSTIA), SSS (CMEMS multi-obs), SLA (DUACS), currents (OSCAR), winds (CCMP), 2005–2023 daily, 0.25° | ~3 GB |
| `target.zarr` | GLORYS12 θ at 15 standard depths, int16 (0.001 °C) | ~3–5 GB |
| `hycom.zarr` | HYCOM via **your GEE** (test year, independent comparator) | ~0.3 GB |
| `argo_2023.parquet` | Argo profiles for independent validation | small |

**Secrets** (🔑 icon in the left bar): `CMEMS_USER`, `CMEMS_PASS` (free at marine.copernicus.eu),
`EARTHDATA_USER`, `EARTHDATA_PASS` (free at urs.earthdata.nasa.gov). GEE uses your own login, project `syltihe`.
"""),
SETUP,
("code", r'''
# ── Credentials ───────────────────────────────────────────────────────────
# Do NOT type usernames/passwords here. Put them in the 🔑 Secrets panel (left bar) under exactly
# these four NAMES, with "Notebook access" switched on. This cell only reads them by name.
try:
    import copernicusmarine, earthaccess, ee
except ModuleNotFoundError:
    raise SystemExit('Run the Setup cell above first (it installs copernicusmarine, earthaccess, ...).')
from google.colab.userdata import SecretNotFoundError, NotebookAccessError
secrets = {}
for name in ['CMEMS_USER', 'CMEMS_PASS', 'EARTHDATA_USER', 'EARTHDATA_PASS']:
    try:
        secrets[name] = userdata.get(name)
    except (SecretNotFoundError, NotebookAccessError):
        raise SystemExit(f'Secret "{name}" is missing or has Notebook access switched off: add it in 🔑 Secrets.')
copernicusmarine.login(username=secrets['CMEMS_USER'], password=secrets['CMEMS_PASS'], force_overwrite=True)
os.environ['EARTHDATA_USERNAME'] = secrets['EARTHDATA_USER']
os.environ['EARTHDATA_PASSWORD'] = secrets['EARTHDATA_PASS']
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
from oceanembed import config as C, ingest
FULL = (C.START, C.END)
C.START, C.END = '2023-01-01', '2023-01-31'
ingest.ingest_inputs('/content/dry', days_per_block=31)
import xarray as xr, matplotlib.pyplot as plt
d = xr.open_zarr('/content/dry/inputs.zarr').isel(time=14)
fig, ax = plt.subplots(2, 4, figsize=(20, 7))
for a, v in zip(ax.flat, C.INPUT_VARS): d[v].plot(ax=a, cmap='RdYlBu_r'); a.set_title(v)
ax.flat[-1].axis('off'); plt.tight_layout()
C.START, C.END = FULL                            # restore the full period from config.py
'''),
("markdown", "## Full 2005–2023 ingest (long: run, close the tab, come back — it resumes)"),
("code", r'''
from oceanembed import config as C, ingest
print('period', C.START, '→', C.END)
ingest.ingest_inputs(ROOT, days_per_block=31)
'''),
("code", r'''
# Target (OUTPUT) data via the fast time-series layout: ~2000-day windows, level by level, in lat bands.
# C.TARGET_PRODUCT = 'glorys12' (PS target, 1/12° → 0.25°) or 'glorys2v4' (paper's target, native 0.25°, ~6× faster)
from oceanembed import config as C, ingest
C.TARGET_PRODUCT = 'glorys12'
ingest.ingest_target(ROOT)
'''),
("code", r'''
# Optional (~30 min): re-fetch OSCAR currents with the exact-grid fix (earlier runs lost one ring of coastal
# cells: ocean-valid 0.47 → ~0.52). Winds were unaffected, so only uc/vc are redone.
ingest.forget(f'{ROOT}/inputs.zarr', ['uc:', 'vc:'])
ingest.ingest_inputs(ROOT, variables=['uc', 'vc'], workers=8)
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
Export **monthly gridded Argo** temperature for 2005–2023 over 45–105°E, 5–30°N from the INCOIS LAS
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
import xarray as xr
from oceanembed import config as C
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
# 02 · Train — embedding engine → GLORYS fine-tune (seed ensemble) + the models we compare against
Runtime: **GPU** (T4 works; L4/A100 faster). Every stage checkpoints to Drive each epoch and resumes after a
disconnect: just re-run the same cell.

| Cell | What | Needed for the leaderboard |
|---|---|---|
| Stage 0 | self-supervised embedding engine (no labels) | ✅ |
| Stage 2 | OceanEmbed fine-tune on GLORYS, one run per seed | ✅ (≥1 seed; 3 seeds = ensemble) |
| Published method | Attention 3D U-Net++ (Wang et al., ESSD 2026) retrained on **our** data | ✅ |
| Ridge | classical statistical baseline | ✅ |
| Ablation | input-window length | optional |
"""),
SETUP,
("code", r'''
import torch, shutil, numpy as np, pandas as pd
print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'NO GPU: Runtime → Change runtime type')
from oceanembed import config as C, dataset as D, train as TR, baselines as B
# Drive is slow at tens of thousands of small files, fast at one big file. First session: copy the stores
# (~40 min, into a .part folder so an interrupted copy is never mistaken for a finished one), then save one
# archive to Drive. Every later session just unpacks that archive (a few minutes).
STORES, TAR = ['inputs.zarr', 'target.zarr'], f'{ROOT}/cache_inputs_target.tar'
if not all(os.path.exists(f'/content/{s}') for s in STORES):
    if os.path.exists(TAR):
        print('unpacking cached archive')
        !tar -xf {TAR} -C /content
    else:
        for s in STORES:
            if not os.path.exists(f'/content/{s}'):
                print('copying', s); shutil.rmtree(f'/content/{s}.part', ignore_errors=True)
                shutil.copytree(f'{ROOT}/{s}', f'/content/{s}.part'); os.rename(f'/content/{s}.part', f'/content/{s}')
        print('saving archive for fast future sessions')
        !tar -cf {TAR}.part -C /content inputs.zarr target.zarr && mv {TAR}.part {TAR}
STATS = f'{ROOT}/stats_v2.npz'                    # v2 = includes the input climatology for anomaly channels
if not os.path.exists(STATS):
    D.compute_stats('/content/inputs.zarr', '/content/target.zarr', STATS)
S = D.load_stats(STATS)
cfg = C.TrainConfig()                             # window 15, base 32, β-NLL 0.5, EMA 0.999
CK = f'{ROOT}/checkpoints/oceanembed_w{cfg.window}'
windows = lambda period, train, c=cfg: D.SurfaceWindows('/content/inputs.zarr', '/content/target.zarr', S, period,
                                                        c.window, train=train, var_dropout=c.var_dropout if train else 0,
                                                        crop=(c.crop_h, c.crop_w) if train and c.crop_h else None)
print('train days', len(windows(C.TRAIN, False)), '| val days', len(windows(C.VAL, False)))
'''),
("markdown", "## Stage 0 · Self-supervised embedding engine (masked surface autoencoder, no labels)"),
("code", r'''
ssl = lambda period, train: D.SurfaceWindows('/content/inputs.zarr', None, S, period, cfg.window, train=train,
                                             var_dropout=cfg.var_dropout if train else 0, patch_mask=0.5, need_target=False)
mae, _ = TR.new_models(cfg)
TR.fit(mae, ssl(C.TRAIN, True), ssl(C.VAL, False), cfg, 'ssl', CK, cfg.epochs_ssl)
'''),
("markdown", """
## Stage 2 · OceanEmbed on GLORYS, all layers trainable (the paper's best transfer strategy)
One run per seed. Start with one seed; if GPU time allows, add two more: the ensemble of 3 usually lowers RMSE.
The printed `val RMSE °C` is against GLORYS 2022 (validation year, used only to pick the best epoch).
"""),
("code", r'''
SEEDS = [42]                     # e.g. [42, 7, 1234] for a 3-model ensemble
for seed in SEEDS:
    c = C.TrainConfig(**{**cfg.__dict__, 'seed': seed})
    _, net = TR.new_models(c)
    TR.load_encoder_from_ssl(net, f'{CK}/ssl_best.pt')
    TR.fit(net, windows(C.TRAIN, True, c), windows(C.VAL, False, c), c, 'glorys', f'{CK}/seed{seed}', c.epochs_glorys,
           depth_std=S['depth_std'])
'''),
("code", r'''
# Validation RMSE per depth (°C, vs GLORYS 2022) for the best epoch of each seed
rows = {f'seed {s}': torch.load(f'{CK}/seed{s}/glorys_best.pt', weights_only=False)['val']['per_depth'] for s in SEEDS
        if os.path.exists(f'{CK}/seed{s}/glorys_best.pt')}
pd.DataFrame({k: {d: v[d]['rmse'] for d in v} for k, v in rows.items()}).round(3)
'''),
("markdown", """
## Published method · Attention 3D U-Net++ (Wang et al., ESSD 2026), retrained on our exact data
Same inputs, years, grid and scoring. This is the "we beat the published state of the art" comparison.
"""),
("code", r'''
cfg3 = C.TrainConfig(arch='attn_unetpp3d', base=16, batch_size=2)
_, net3 = TR.new_models(cfg3)
TR.fit(net3, windows(C.TRAIN, True, cfg3), windows(C.VAL, False, cfg3), cfg3, 'glorys',
       f'{ROOT}/checkpoints/attn_unetpp3d_w{cfg3.window}', cfg3.epochs_glorys, depth_std=S['depth_std'])
'''),
("markdown", "## Classical baseline · ridge regression (CPU, a few minutes)"),
("code", r'''
os.makedirs(f'{ROOT}/baselines', exist_ok=True)
B.Ridge(S).fit(windows(C.TRAIN, False), n_days=400).save(f'{ROOT}/baselines/ridge.npz')
'''),
("markdown", "## Optional ablation · input window length (paper: gain saturates ≈ 26 d)"),
("code", r'''
for w in [7, 26]:
    c = C.TrainConfig(window=w, epochs_glorys=20)
    _, n = TR.new_models(c); TR.load_encoder_from_ssl(n, f'{CK}/ssl_best.pt')   # encoder is window-agnostic
    print(w, TR.fit(n, windows(C.TRAIN, True, c), windows(C.VAL, False, c), c, 'glorys',
                    f'{ROOT}/checkpoints/ablate_w{w}', c.epochs_glorys, depth_std=S['depth_std']))
'''),
]

NB3 = [
("markdown", """
# 03 · Leaderboard on the held-out year 2023, independent Argo check, and export
Every method is scored on the same year (never used in training), grid, depths and Argo profiles.
GLORYS and HYCOM are scored against the same floats, so the Argo column compares like with like.
"""),
SETUP,
("code", r'''
import glob, shutil, torch, numpy as np, pandas as pd, xarray as xr
from oceanembed import config as C, dataset as D, train as TR, infer as I, baselines as B, benchmark as BM
for s in ['inputs.zarr', 'target.zarr', 'hycom.zarr']:
    if os.path.exists(f'{ROOT}/{s}') and not os.path.exists(f'/content/{s}'):
        print('copying', s); shutil.copytree(f'{ROOT}/{s}', f'/content/{s}')
S = D.load_stats(f'{ROOT}/stats_v2.npz')
cfg = C.TrainConfig(); CK = f'{ROOT}/checkpoints/oceanembed_w{cfg.window}'
G = xr.open_zarr('/content/target.zarr').thetao.sel(time=slice(*C.TEST))
prof = pd.read_parquet(f'{ROOT}/argo_2023.parquet'); print(len(prof), 'Argo profiles')
lb = BM.Leaderboard(G, prof)
def load(ckpt, c):
    _, m = TR.new_models(c); return TR.load_weights(m, ckpt)
'''),
("code", r'''
# OceanEmbed: every trained seed (ensemble) and the first seed alone
seeds = sorted(glob.glob(f'{CK}/seed*/glorys_best.pt')); print('seeds:', seeds)
members = [load(p, cfg) for p in seeds]
rec = I.reconstruct(members, '/content/inputs.zarr', S, *C.TEST, window=cfg.window)
rec.to_netcdf(f'{ROOT}/OceanEmbed_NIO_T_2023.nc')                     # the PS deliverable (with σ)
lb.add(f'OceanEmbed ({len(members)}-model ensemble)', 'ours', rec.thetao)
if len(members) > 1:
    lb.add('OceanEmbed (single model)', 'ours', I.reconstruct(members[0], '/content/inputs.zarr', S, *C.TEST, window=cfg.window).thetao)
'''),
("code", r'''
# The published method, retrained on our data; then the baselines; then reference products vs Argo
cfg3 = C.TrainConfig(arch='attn_unetpp3d', base=16, batch_size=2)
p3 = f'{ROOT}/checkpoints/attn_unetpp3d_w{cfg3.window}/glorys_best.pt'
if os.path.exists(p3):
    lb.add('Attention 3D U-Net++ (Wang et al. 2026), retrained here', 'published method (retrained here)',
           I.reconstruct(load(p3, cfg3), '/content/inputs.zarr', S, *C.TEST, window=cfg3.window).thetao)
lb.add(B.Ridge.name, 'baseline', I.reconstruct_baseline(B.Ridge(S).load(f'{ROOT}/baselines/ridge.npz'),
       '/content/inputs.zarr', S, *C.TEST, window=cfg.window).thetao)
lb.add(B.Climatology.name, 'baseline', I.reconstruct_baseline(B.Climatology(S), '/content/inputs.zarr', S, *C.TEST,
       window=cfg.window).thetao)
lb.add('GLORYS12 reanalysis (the training target)', 'reference product', G, vs_glorys=False)
if os.path.exists('/content/hycom.zarr'):
    lb.add('HYCOM GOFS 3.1 (independent model, via GEE)', 'reference product', xr.open_zarr('/content/hycom.zarr').thetao)
summary = lb.save(f'{ROOT}/leaderboard'); summary.round(3)
'''),
("code", r'''
# Is the predicted uncertainty honest? Fraction of Argo errors inside ±1σ should be ≈ 68 %
m = BM.A.match(BM.A.match(prof, rec.thetao, 'ours'), rec.thetao_sigma, 'sig')
inside = [(np.abs(m[f'ours_T{d}'] - m[f'T{d}']) <= m[f'sig_T{d}']).mean() for d in C.DEPTHS]
pd.Series(inside, index=C.DEPTHS, name='coverage@1σ').round(2)
'''),
("code", r'''
# Export for the web console (format v2, oceanembed/webexport.py): maps for the Cyclone Mocha window,
# Argo scores, σ calibration and the embedding over the test year. Copy the folder's contents into web/public/data/.
from oceanembed import webexport as W
days = pd.date_range('2023-05-01', '2023-05-31')   # pre-monsoon / Cyclone Mocha window
W.export_model(f'{ROOT}/web_export', rec, G, '/content/inputs.zarr', S, members, cfg.window, days, profiles=prof,
               hycom=xr.open_zarr('/content/hycom.zarr').thetao if os.path.exists('/content/hycom.zarr') else None,
               leaderboard_json=f'{ROOT}/leaderboard/leaderboard.json')
'''),
]


NB4 = [
("markdown", """
# 04 · Finalise — figures, significance, daily 2023 pipeline and dashboard data, from the trained models
Free Colab is enough: nothing is trained here. **Runtime → Change runtime type → T4 GPU** is faster (the published
method's 3D network is slow on CPU); a CPU runtime works too. Reads `MyDrive/OceanEmbed/pack.tar` (data) and
`MyDrive/OceanEmbed/runpod_results/` (trained models, ensemble reconstruction); writes back into `runpod_results/`.
Every step logs to Drive and can be re-run on its own.
"""),
SETUP,
("code", r'''
# ── Data and trained models onto the local disk (~10 min) ────────────────────
import shutil, glob
RES, DATA, WORK = f'{ROOT}/runpod_results', '/content/data', '/content/root'
os.makedirs(DATA, exist_ok=True); os.makedirs(WORK, exist_ok=True)
if not os.path.exists(f'{DATA}/target.zarr'):
    print('copying pack.tar'); shutil.copy(f'{ROOT}/pack.tar', '/content/pack.tar')
    !cd {REPO} && python -m oceanembed.pack unpack --tar /content/pack.tar --dst {DATA}
    os.remove('/content/pack.tar')
if not os.path.exists(f'{DATA}/hycom.zarr'):
    print('copying hycom.zarr'); shutil.copytree(f'{ROOT}/hycom.zarr', f'{DATA}/hycom.zarr')
shutil.copy(f'{ROOT}/argo_2023.parquet', f'{DATA}/argo_2023.parquet')
for f in ['stats_v2.npz', 'OceanEmbed_NIO_T_2023.nc']:
    if not os.path.exists(f'{WORK}/{f}'):
        print('copying', f); shutil.copy(f'{RES}/{f}', f'{WORK}/{f}')
for d in ['checkpoints', 'baselines']:
    shutil.copytree(f'{RES}/{d}', f'{WORK}/{d}', dirs_exist_ok=True)
ENS = f'{WORK}/OceanEmbed_NIO_T_2023.nc'
print('seeds:', sorted(glob.glob(f'{WORK}/checkpoints/oceanembed_w15/seed*/glorys_best.pt')))
'''),
("code", r'''
# ── Leaderboard labels: same numbers, the model's name ───────────────────────
for f in glob.glob(f'{RES}/leaderboard/leaderboard*'):
    t = open(f, encoding='utf-8').read()
    open(f, 'w', encoding='utf-8').write(t.replace('OceanEmbed (', 'Sylithe Ocean Model ('))
print(open(f'{RES}/leaderboard/leaderboard.md', encoding='utf-8').read())
'''),
("markdown", "## Daily pipeline: every day of 2023 predicted once and cached, plus the Daily-page files (~10 min)"),
("code", r'''
!cd {REPO} && python -m oceanembed.daily run --data {DATA} --root {WORK} --start 2023-01-01 --end 2023-12-31 --from-nc {ENS} 2>&1 | tee {RES}/daily_colab.log
!cd {REPO} && python -m oceanembed.daily export --data {DATA} --root {WORK} --out {WORK}/web_ops --maps-last 31 2>&1 | tee -a {RES}/daily_colab.log
for d in ['ops', 'web_ops']:
    shutil.copytree(f'{WORK}/{d}', f'{RES}/{d}', dirs_exist_ok=True)
'''),
("markdown", "## Dashboard export (maps for May 2023, Argo scores, embedding regimes)"),
("code", r'''
!cd {REPO} && python -m oceanembed.run web --data {DATA} --root {WORK} --workers 2 2>&1 | tee {RES}/web_colab.log
shutil.copytree(f'{WORK}/web_export', f'{RES}/web_export', dirs_exist_ok=True)
'''),
("markdown", "## Paper evaluation: every metric, the significance test and all 20 figures (longest step)"),
("code", r'''
!cd {REPO} && python -m oceanembed.paper_eval --data {DATA} --root {WORK} --out {WORK}/paper --ensemble-nc {ENS} --figures 2>&1 | tee {RES}/paper_colab.log
shutil.copytree(f'{WORK}/paper', f'{RES}/paper', dirs_exist_ok=True, ignore=shutil.ignore_patterns('_work'))
print(open(f'{WORK}/paper/significance.csv').read())
'''),
]

for name, cells in [("01_data_pipeline", NB1), ("02_train", NB2), ("03_validate_export", NB3), ("04_finalize", NB4)]:
    json.dump(nb(cells), open(os.path.join(HERE, f"{name}.ipynb"), "w"), indent=1)
    print("wrote", name)
