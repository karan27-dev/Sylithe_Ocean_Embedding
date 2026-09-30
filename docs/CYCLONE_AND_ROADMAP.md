# Cyclone logic and roadmap

## 1. Cyclone watch: how it works

```
Satellite input ──► Sylithe Ocean Model ──► Ocean state ──► Cyclone logic ──► LLM bulletin
SST SSS SLA           3-model ensemble        T(z) 0–1000 m     OCPI, hotspots,    DeepSeek, words only
currents winds        15-day window           TCHP T100 D26     disturbance watch  (planned)
                                              MLD, σ
```

Everything up to "Cyclone logic" is deterministic and runs in the browser from the published live prediction
(`web/src/lib/cyclone.js`). The language model only rewords the structured JSON; it never computes a number.

### Ocean Cyclone Potential Index (OCPI)

Each driver is scored 0–1 linearly between two limits, then combined as a weighted mean.
OCPI = 0 wherever SST < 26 °C. A driver missing on a day (late salinity or winds) is left out and the weights rescale.

| Driver | 0 at | 1 at | Weight | Source |
|---|---|---|---|---|
| Upper-100 m mean temperature (T100) | 25 °C | 29.5 °C | 0.25 | Price (2009) |
| Tropical cyclone heat potential | 0 | 120 kJ cm⁻² | 0.25 | Leipper & Volgenau (1972); Mainelli et al. (2008) |
| Sea surface temperature | 26 °C | 30.5 °C | 0.15 | Gray (1968) |
| 26 °C isotherm depth | 30 m | 120 m | 0.10 | Shay et al. (2000) |
| Mixed-layer depth | 10 m | 60 m | 0.10 | Lin et al. (2013) |
| Sea level anomaly | −0.10 m | +0.20 m | 0.10 | Lin et al. (2005) |
| Sea surface salinity (barrier layer) | 35 psu | 31 psu | 0.05 | Balaguru et al. (2012) |

Categories: Low < 0.3 ≤ Moderate < 0.5 ≤ High < 0.7 ≤ Very high.

**Disturbance watch**: a cell where the satellite surface wind has cyclonic relative vorticity above 2 × 10⁻⁵ s⁻¹,
wind ≥ 10 m s⁻¹, and OCPI ≥ 0.5. It flags an existing circulation over ocean that could feed it.

**What it is not**: a genesis, track or intensity forecast. Vertical wind shear, mid-level humidity and upper-level
divergence are atmospheric and not in the data.

### LLM hand-off (DeepSeek)

The Cyclone page shows the exact JSON and prompt. To switch it on, keep the key out of the browser and the repo:

1. GitHub → repository → Settings → Secrets and variables → Actions → `DEEPSEEK_API_KEY`.
2. The live workflow computes the same payload after each run, sends it with the prompt to the DeepSeek chat API,
   and publishes `bulletin.json` next to the other live files; the page shows it when present.
3. The response is checked: every number in the text must appear in the payload, otherwise the template bulletin is kept.

## 2. PS 26066: what is asked and where we stand

| Requirement (PS 26066, MoES / INCOIS) | Status |
|---|---|
| Subsurface temperature from surface satellite data, North Indian Ocean | Done: 15 depths, 0–1000 m, 0.25°, daily |
| Inputs: SST, SSS, SLA, currents, winds | Done: all five, reprocessed for training, NRT for live |
| Target GLORYS12, independent validation with Argo | Done: 0.662 °C vs GLORYS12, 0.757 °C vs 9,469 Argo values (2023) |
| Beat existing methods, fair comparison | Done: leaderboard vs published Attention 3D U-Net++, ridge, climatology, HYCOM |
| Uncertainty | Done: per-cell σ from β-NLL + ensemble spread |
| Operational / near-real-time | Done: GitHub Actions every 6 h, revisions when late inputs arrive |
| Visualisation for users | Done: Daily, Explorer, Cyclone watch, Validation, Research |
| Applications (cyclone, fisheries, monsoon) | Cyclone watch done; others below |

## 3. Suggested next features (in priority order)

1. **DeepSeek bulletin in the live workflow** (section 1), with the number check.
2. **Fine-tune on the NRT archive**: live RMSE is 1.05 °C against Argo vs 0.757 °C with reprocessed inputs; training
   a few epochs on NRT inputs closes most of that gap.
3. **Cyclone track overlay**: pull IMD / IBTrACS best tracks and draw them over the OCPI and TCHP maps; score OCPI along
   past tracks (Mocha 2023, Biparjoy 2023) to calibrate the weights instead of fixing them by hand.
4. **Cold-wake forecast**: estimate the SST drop a storm of given speed would cause from MLD and the stratification
   below it (Price 2009), shown along a forecast track.
5. **Marine heatwaves**: daily anomaly against the climatology at every depth; flag cells above the 90th percentile
   for 5+ days (Hobday et al. 2016). Subsurface heatwaves are invisible to SST products.
6. **Fisheries (PFZ support)**: thermocline depth and fronts are what INCOIS Potential Fishing Zone advisories use
   alongside chlorophyll; add a thermocline-front layer and a chlorophyll input.
7. **Monsoon and Bay of Bengal barrier layer**: salinity-stratification diagnostics (barrier-layer thickness) once a
   salinity target is added.
8. **Predict salinity too**: the same network with a second output head, trained on GLORYS12 salinity.
9. **Alerts**: e-mail or webhook when OCPI "Very high" covers a set share of a user's AOI, or a watch point appears.
10. **API**: a small documented endpoint for point profiles and area statistics (the static files already serve most of it).
