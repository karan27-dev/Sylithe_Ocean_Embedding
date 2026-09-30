# Live operation

Whenever the satellites publish a new day of surface data, the Sylithe Ocean Model predicts the ocean beneath it.
`.github/workflows/live.yml` runs `python -m oceanembed.live run` four times a day on GitHub Actions (free, CPU).

## What one run does
1. Reads the newest date of every near-real-time source from the Copernicus catalogue.
2. Ingests only the days it has not stored yet, straight onto the 0.25° grid.
3. Predicts every day whose SST and sea level are in (3-model ensemble, 15-day window).
4. Predicts recent days again when late inputs arrive (salinity ~6 days, winds ~1 day); each day keeps a revision number.
5. Checks the predictions against Argo floats that surfaced in the last 30 days.
6. Publishes the console files to the `live-data` branch; the Daily page's **Live** mode reads them.

| Input | Near-real-time product | Delay |
|---|---|---|
| SST | OSTIA NRT | ~1 day |
| SLA | DUACS NRT all-satellite L4 | same day |
| Currents | geostrophic currents from DUACS NRT | same day |
| Winds | ASCAT-blended L4 winds NRT | ~1 day |
| SSS | SMOS/SMAP multi-observation NRT | ~6 days |

Training used reprocessed OSCAR currents and CCMP winds, which arrive a month late. The live run uses the
substitutes above, so live accuracy is tracked separately against Argo on the page.

## One-time setup (≈10 minutes)
1. **Secrets.** GitHub → repository → Settings → Secrets and variables → Actions → *New repository secret*:
   `CMEMS_USER` and `CMEMS_PASS` (your Copernicus Marine login).
2. **Model release.** From Google Drive `OceanEmbed/runpod_results/`, download
   `checkpoints/oceanembed_w15/seed42/glorys_best.pt`, `…/seed7/glorys_best.pt`, `…/seed1234/glorys_best.pt` and `stats_v2.npz`.
   Rename the three checkpoints to `seed42.pt`, `seed7.pt`, `seed1234.pt`.
   GitHub → Releases → *Draft a new release* → tag `models-v1` → attach the four files → *Publish*.
3. **First run.** GitHub → Actions → *live* → *Run workflow*. The first run ingests the last 45 days (~15 min);
   later runs take a few minutes.

## Run it anywhere else
```bash
export COPERNICUSMARINE_SERVICE_USERNAME=… COPERNICUSMARINE_SERVICE_PASSWORD=…
python -m oceanembed.live sources                      # newest date per feed, no login needed
python -m oceanembed.live run --state live_state --models MODELS_DIR   # MODELS_DIR: seed*/glorys_best.pt + stats_v2.npz
```
