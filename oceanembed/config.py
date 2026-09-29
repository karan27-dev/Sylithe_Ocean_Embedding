"""Single source of truth for grid, periods, variables and dataset IDs.

Every notebook imports from here, so changing the domain or the years happens in one place.
"""
from dataclasses import dataclass, field
import numpy as np

# ---------------------------------------------------------------- target grid (PS: 0.25°, daily)
LAT_MIN, LAT_MAX = 5.0, 30.0
LON_MIN, LON_MAX = 45.0, 105.0
RES = 0.25
LATS = np.round(np.arange(LAT_MIN, LAT_MAX + RES / 2, RES), 3)   # 101 cell centres, south→north
LONS = np.round(np.arange(LON_MIN, LON_MAX + RES / 2, RES), 3)   # 241 cell centres
BBOX = dict(minimum_longitude=LON_MIN - RES, maximum_longitude=LON_MAX + RES,
            minimum_latitude=LAT_MIN - RES, maximum_latitude=LAT_MAX + RES)

# PS standard depths (m)
DEPTHS = [0, 5, 10, 20, 30, 50, 75, 100, 125, 150, 200, 300, 500, 700, 1000]

# ---------------------------------------------------------------- periods (19 years)
# 2005 onward = the dense-Argo era, so GLORYS is well constrained by real profiles; satellite SSS from 2010.
# Wang et al. (ESSD 2026) fine-tuned on 1993–2022 and pretrained on Argo 2005–2019; every input here exists from 1993.
START, END = "2005-01-01", "2023-12-31"
TRAIN = ("2005-01-01", "2021-12-31")
VAL = ("2022-01-01", "2022-12-31")
TEST = ("2023-01-01", "2023-12-31")      # held-out year, also used for the independent Argo check

# PoC sub-regions for scoring
REGIONS = {
    "NIO": dict(lat=(5, 30), lon=(45, 105)),
    "BoB": dict(lat=(5, 23), lon=(80, 100)),     # Bay of Bengal
    "AS":  dict(lat=(5, 25), lon=(50, 78)),      # Arabian Sea
}

# ---------------------------------------------------------------- input channels
INPUT_VARS = ["sst", "sss", "sla", "uc", "vc", "uw", "vw"]
# Can be missing in near-real-time (latency), so they are randomly dropped during training
DROPPABLE_VARS = ["sss", "uc", "vc", "uw", "vw"]


@dataclass
class Source:
    var: str               # our canonical name
    provider: str          # cmems | podaac | gee
    dataset_id: str
    variable: str
    note: str = ""
    scale: float = 1.0
    offset: float = 0.0


# Dataset IDs follow the PS table. Copernicus IDs change with product versions: run
# `copernicusmarine describe --product-id <PRODUCT>` in notebook 01 (cell "verify IDs") before a long pull.
SOURCES = {
    # PS: OSTIA 0.05° daily (moi-00168)
    "sst": [Source("sst", "cmems", "METOFFICE-GLO-SST-L4-REP-OBS-SST", "analysed_sst",
                   "OSTIA reprocessed; K → °C", offset=-273.15),
            Source("sst", "cmems", "METOFFICE-GLO-SST-L4-NRT-OBS-SST-V2", "analysed_sst",
                   "OSTIA NRT for dates after the REP series ends", offset=-273.15),
            Source("sst", "gee", "NOAA/CDR/OISST/V2_1", "sst", "fallback", scale=0.01)],
    # PS: SMAP/SMOS multi-obs 0.125° daily (moi-00051)
    "sss": [Source("sss", "cmems", "cmems_obs-mob_glo_phy-sss_my_multi_P1D", "sos")],
    # PS: DUACS daily (moi-00145)
    # No GEE fallback on purpose: HYCOM SSH is a different quantity from DUACS SLA and would put a
    # discontinuity into the channel. A failed block stays NaN and is reported instead.
    "sla": [Source("sla", "cmems", "cmems_obs-sl_glo_phy-ssh_my_allsat-l4-duacs-0.125deg_P1D", "sla")],
    # PS: OSCAR v2 final 0.25° daily (PO.DAAC)
    "uc": [Source("uc", "podaac", "OSCAR_L4_OC_FINAL_V2.0", "u")],
    "vc": [Source("vc", "podaac", "OSCAR_L4_OC_FINAL_V2.0", "v")],
    # PS: CCMP v3.1 0.25° 6-hourly → daily mean (PO.DAAC)
    "uw": [Source("uw", "podaac", "CCMP_WINDS_10M6HR_L4_V3.1", "uwnd")],
    "vw": [Source("vw", "podaac", "CCMP_WINDS_10M6HR_L4_V3.1", "vwnd")],
}

# PS target: GLORYS12 (moi-00021). Checked 2026-09-29: the "my" dataset now runs 1993-01-01 → 2026-06-23,
# covering the whole 2005–2023 period; the old "myint" continuation ID no longer exists.
GLORYS_IDS = ["cmems_mod_glo_phy_my_0.083deg_P1D-m"]
GLORYS_VAR = "thetao"

# Which reanalysis is the training target. Both are read with the fast time-series reader (ingest_target):
#   "glorys12"  = GLORYS12V1 1/12° (moi-00021), the product the PS names; averaged down to 0.25°
#   "glorys2v4" = GLORYS2V4 0.25° (moi-00024, member of the multi-reanalysis product), the target used by
#                 Wang et al. (ESSD 2026); already on our grid, ~6× less to download
TARGET_PRODUCT = "glorys12"
TARGETS = {
    "glorys12": ("cmems_mod_glo_phy_my_0.083deg_P1D-m", "thetao"),
    "glorys2v4": ("cmems_mod_glo_phy-all_my_0.25deg_P1D-m", "thetao_glor"),
}
GLORYS_MAX_DEPTH = 1300   # one level below 1000 m so vertical interpolation is not an extrapolation

# Independent comparator available in GEE (never used as a training target)
HYCOM_GEE = "HYCOM/sea_temp_salinity"


@dataclass
class TrainConfig:
    window: int = 15            # days of surface history (paper: saturates ~26 d; ablate 1/7/15/26)
    base: int = 32              # channel width of the first level
    levels: int = 4
    batch_size: int = 8
    epochs_ssl: int = 30
    epochs_argo: int = 40
    epochs_glorys: int = 60
    lr: float = 3e-4
    weight_decay: float = 1e-4
    var_dropout: float = 0.3    # P(drop each droppable input variable) — trains the SST+SSH-only mode
    w_surface: float = 0.1      # T(0 m) ≈ SST consistency
    w_vgrad: float = 0.5        # vertical-gradient (thermocline sharpness) loss
    beta_nll: float = 0.5       # β-NLL weighting (0 = plain NLL, 1 ≈ MSE); protects RMSE while learning σ
    ema_decay: float = 0.999    # EMA of weights used for validation, checkpoints and inference
    arch: str = "embed_unetpp2d"   # or "attn_unetpp3d" (faithful replication of Wang et al. 2026)
    amp: bool = True
    num_workers: int = 2
    seed: int = 42
    extra: dict = field(default_factory=dict)


# padded spatial size divisible by 2**levels (101×241 → 112×256)
PAD_H, PAD_W = 112, 256
