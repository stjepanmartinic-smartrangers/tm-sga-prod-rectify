# TailorMade — SGA vs Prod rectify

Hosted app for deciding problem-sheet issues (P1–P6, P8–P11, SA1, SA3, SA5).

## Live site

https://stjepanmartinic-smartrangers.github.io/tm-sga-prod-rectify/

GitHub Pages stays up for as long as this repository exists (months is fine). It does not expire after a few hours.

## Where decisions are stored

| Place | Survives if the site is offline? |
| --- | --- |
| Browser `localStorage` | Yes, on that computer/browser |
| **Download JSON** | Yes — keep the file in `C:\ForSharing` |
| **`decisions.json` in this repo** (Save online) | Yes — it is git history, independent of Pages |

Save online needs a GitHub token (Contents: Read and write on this repo only). Open **GitHub token** on the page, paste it, then **Save online**. Reload from GitHub to pick up someone else’s saves.

## Local copy

`C:\ForSharing\tm-sga-prod-rectify\` — open `index.html` (use a local static server if the browser blocks `data.js`).

## Data

`data.js` is generated from the current SGA vs Prod Excel problem sheets. Re-run `export_rectify_data.py` in `C:\VsCode\TailorMade\data\tm-packages-v1` when the workbooks change, then replace `data.js` here.

## Merge back into Excel

When decisions are finished, run:

`python merge_rectify_decisions.py`

from `C:\VsCode\TailorMade\data\tm-packages-v1`. That writes **Rectify status / decision / selected / notes** onto each P/SA sheet and onto **By TM package**, then copies the workbooks to `C:\ForSharing`.
