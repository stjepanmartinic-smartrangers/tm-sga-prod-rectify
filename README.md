# TailorMade — SGA vs Prod rectify

Hosted app for deciding problem-sheet issues (P1–P2, P4–P6, P8–P11, SA1, SA3, SA5). Cards list **TM packages** and **SGA itineraries** (chips labelled `SGA …`). **P1 Package not in ST** is TM packages only — SGA itinerary services are not expected on ST.

## Live site

https://stjepanmartinic-smartrangers.github.io/tm-sga-prod-rectify/

GitHub Pages stays up for as long as this repository exists (months is fine). It does not expire after a few hours.

## Where decisions are stored

| Place | Survives if the site is offline? |
| --- | --- |
| Browser `localStorage` | Yes, on that computer/browser only |
| **Save online** | Yes — Cloudflare Worker. No GitHub token. Does not expire with inactivity. |
| GitHub `decisions.json` | Last published snapshot. Reload falls back here if the live store is down. |

The yellow banner at the top is the reminder: **Save online** or other people will not see your work. Local browser save is not enough. Clicking Save online does not ask for a token.

The header shows **% decided in total** (all P/SA cards). It updates as Yes/No are chosen.

**Reload saved work** warns and then overwrites this browser with the shared online copy. If the live store does not respond, Reload uses the last published GitHub snapshot instead.

**P4 Missing Prod pricing** shows ST vs Prod amounts by price category. **Yes** = insert the ST price. **No** = keep the Prod price. If there is no ST price, **Yes** opens a pre-filled Service Template form so prices can be added. Yes and No are both green so No is not the “wrong” answer.

**P3 Brand new no Prod** was removed. If the name is not on Prod (no exact Item, no usable fuzzy match), ST is the source of truth and the service is created from ST later — no team decision.

**P6 PC name mismatch:** Yes = map package PCs to the existing ST/Prod names. No = do not apply the map; **new price categories will be created** from the package names.

Every P and SA tab has a short Yes/No description at the top. After you pick an option, the card shows what that choice will do (same pattern as P6 No).

Filter **TM packages** or **SGA itineraries**, then pick a specific package / trip from the second dropdown.

Service create forms (P1 No, P4 no-price Yes) let you add **multiple price categories**. There is no Skip for now on any tab.

Worker source: `C:\VsCode\TailorMade\data\tm-packages-v1\rectify-store`. Cloudflare account claimed 9 Nov 2026. Live: https://tm-sga-prod-rectify-store.graceful-kryptops.workers.dev

## Local copy

`C:\ForSharing\tm-sga-prod-rectify\` — open `index.html` (use a local static server if the browser blocks `data.js`).

## Data

`data.js` is generated from the current SGA vs Prod Excel problem sheets. Extract date **9 Nov 2026** (`Templates_09112026.xlsx`); catalog matches 4 Nov. Re-run `export_rectify_data.py` in `C:\VsCode\TailorMade\data\tm-packages-v1` when the workbooks change, then replace `data.js` here.

## Who are you / History

The header has **Who are you**. Your name is stored in this browser (`localStorage`) so you are not asked every time. **Add a name…** grows the shared people list. After **Save online**, other machines see those names.

**History** tab lists who changed what, newest first. It is stored with the decisions (same Save online). When we merge back to Excel, History becomes a **Rectify History** sheet, and two JSON snapshots are written to `C:\ForSharing` (`tm-sga-prod-rectify-decisions.json` and `tm-sga-prod-rectify-history.json`).

## Review / change decisions

The default list is **All on this tab**, so a Yes or No stays on the same screen (use **Reopen** if it was accidental). **No** on a missing service opens the Service Template fields on that card — you do not need All decided to fill them. **All decided** is only for review; it has a Yes / No / Done filter.

## Fully missing services

Cards that are not on ST and not on Prod show the Service Template field set **only after you mark No** (brand new). Hidden on Yes / fuzzy Prod match. Saved in `decisions.json` as `form` (price categories in `form.priceLines`).

SA1 uses Yes/No (not Done). **Yes** opens the Supplier Agreement Template fields. SA3 **No** opens the same agreement fields. SA5 **No** (different / new account) opens Supplier Name plus the supplier fields from the Service Template, and the TM package.

Picklist fields use dropdowns from IntrepidProd (read-only describe): service record type, cost type, pricing type, allocation, time setup, preferred communication, pricelist, price type, currency, inventory type, confirmation method, invoice basis, agreement type, payment type/method, cost bearer, when. Lookups stay typed: location, business unit, tax group, supplier name, price category. If a saved value is not in the list, it is kept as an extra option.

The Service Template create form is grouped: Service, then one or more **Price category** blocks (each with Price Category / Price Season / Pricing), then Supplier. Use **Add another price category** to add more. P4 **Yes** with no ST price uses the same form, pre-filled from the service / package PCs.

The Supplier Agreement create form is grouped: Agreement (Supplier Name last), Payment Rule, Supplier Agreement Assignment. Agreement Name has help text: include the Account name in the name.

## Merge back into Excel

When decisions are finished, run:

`python merge_rectify_decisions.py`

from `C:\VsCode\TailorMade\data\tm-packages-v1`. That writes **Rectify status / decision / selected / notes / form** onto each P/SA sheet and onto **By TM package**, then copies the workbooks to `C:\ForSharing`.
