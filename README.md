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

## Who are you

The header has **Who are you**. Your name is stored in this browser (`localStorage`) so you are not asked every time. **Add a name…** grows the shared people list. After **Save online**, other machines see those names in the dropdown (Reload from GitHub).

## Review / change decisions

The default list is **All on this tab**, so a Yes or No stays on the same screen (use **Reopen** if it was accidental). **No** on a missing service opens the Service Template fields on that card — you do not need All decided to fill them. **All decided** is only for review; it has a Yes / No / Done filter.

## Fully missing services

Cards that are not on ST and not on Prod show the Service Template field set **only after you mark No** (brand new). Hidden on Yes / fuzzy Prod match. Saved in `decisions.json` as `form`.

SA1 uses Yes/No (not Done). **Yes** opens the Supplier Agreement Template fields. SA3 **No** opens the same agreement fields. SA5 **No** (different / new account) opens Supplier Name plus the supplier fields from the Service Template, and the TM package.

Picklist fields use dropdowns from IntrepidProd (read-only describe): service record type, cost type, pricing type, allocation, time setup, preferred communication, pricelist, price type, currency, inventory type, confirmation method, invoice basis, agreement type, payment type/method, cost bearer, when. Lookups stay typed: location, business unit, tax group, supplier name, price category. If a saved value is not in the list, it is kept as an extra option.

The Service Template create form is grouped: Service, Price Category, Price Season, Pricing, Supplier.

The Supplier Agreement create form is grouped: Agreement (Supplier Name last), Payment Rule, Supplier Agreement Assignment. Agreement Name has help text: include the Account name in the name.

## Merge back into Excel

When decisions are finished, run:

`python merge_rectify_decisions.py`

from `C:\VsCode\TailorMade\data\tm-packages-v1`. That writes **Rectify status / decision / selected / notes / form** onto each P/SA sheet and onto **By TM package**, then copies the workbooks to `C:\ForSharing`.
