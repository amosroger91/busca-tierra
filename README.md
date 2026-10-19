# busca-tierra

Owner-financed and seller-financed property listings within 40 miles of Fort Smith, Arkansas, gathered into one deduplicated CSV.

## Overview

Public land and real-estate sites do not share one search. This app queries every source that answers a plain HTTP client, keeps listings whose own text offers owner or seller financing, drops anything outside a 40-mile circle around Fort Smith, and merges the same tract when it shows up on more than one site.

The result of a run is `output/properties.csv`. `output/run-report.json` records what each source returned, including sites that refused the request or had no parser. Rows are never invented for a source that did not answer.

LandWatch, LandAndFarm, and Landmodo publish owner-financed catalogs and are parsed. Sites that refuse a non-browser client, including Land.com, Lands of America, and Zillow, are still requested. Their HTTP status is written to the run report and they do not add rows.

## Architecture

```
src/cli.js
   |
   |-- Craigslist search API (Fort Smith, 40 miles) + posting pages
   |-- Land Century owner-finance catalog
   |-- Landflip county pages + listing pages
   |-- Landhub Arkansas and Oklahoma list pages + nearby detail pages
   |-- LandWatch and LandAndFarm owner-financing catalogs
   |-- Landmodo Arkansas and Oklahoma owner-financed pages
   |-- one-shot probes of other public listing sites
   |
   v
geocode missing pins (US Census, then Nominatim)
   |
   v
radius filter -> dedupe -> output/properties.csv
                         -> output/run-report.json
```

Each source adapter returns listings plus a status. `src/run.js` geocodes any row that has an address and no pin, drops rows that still have no pin or sit outside the radius, dedupes, sorts by distance then price, and writes both files. A source that throws is recorded as `error` and the rest of the run continues.

## Quick start

Node.js 20 or newer. `curl.exe` needs to be on `PATH`. Landflip, Land.com, and Lands of America are requested with curl because those hosts refuse Node's fetch. No `npm install` is required.

```powershell
npm test
npm start
```

The search writes four tables and a report:

| File | Contents |
| --- | --- |
| `output/properties.csv` | Confirmed explicit offers inside the radius. Compatibility columns. |
| `output/properties-v2.csv` | The same confirmed rows, plus assertion, evidence, price state, previous price, location method, and APN. |
| `output/candidates.csv` | Inside-radius leads whose only financing evidence is a catalog or category tag. |
| `output/review-queue.csv` | Confirmed or candidate rows whose pin is a city centroid, or that sit near the 40-mile line without a seller-provided point. |
| `output/run-report.json` | Per-source status, request counts, and match counts. |

A later run reuses `output/cache/`. Pass `--refresh` to request every page again. The first full search takes several minutes. A cached run is mostly disk reads plus any page that was not saved yet.

## Configuration

No environment variables are required. `.env.example` is only a reminder of that. Real secrets do not belong in this repo. The app does not log in and does not call n8n.

| Flag | Default | Purpose |
| --- | --- | --- |
| `--radius` | `40` | Miles from Fort Smith. The center is 35.38592, -94.39855. |
| `--out` | `output/properties.csv` | CSV path. |
| `--report` | `output/run-report.json` | Per-source status, request counts, and match counts. |
| `--cache` | `output/cache` | Saved responses and geocodes. Git ignores this directory. |
| `--refresh` | off | Ignore the cache and request again. |
| `--sources` | `craigslist,landcentury,landflip,landhub,landwatch,landandfarm,landmodo,probes` | Comma-separated subset. |

The center is the point used by the distance math. A degree of latitude here is about 69 miles. Flags are read from the working directory, so run the commands from the repo root.

## Usage

| Command | What it does |
| --- | --- |
| `npm start` | Full search at the default 40-mile radius. |
| `npm start -- --radius 25` | Same search, tighter circle. |
| `npm start -- --sources craigslist,landcentury` | Query only those sources. |
| `npm start -- --out output\fort-smith.csv --report output\fort-smith.json` | Write the files somewhere else. |
| `npm start -- --refresh` | Bypass cached responses. |
| `npm test` | Unit tests for distance, financing phrases, price units, address parsing, and dedupe. |

A radius that is missing, zero, or not a number exits with status 1 before any request.

### What qualifies

A confirmed row requires all of these:

- Listing-specific text offers seller-held financing (`explicit_offer`). Matching phrases are `owner will finance`, `seller will finance`, `owner will carry`, `seller will carry`, `owner financing` (and `financed` / `finance`), `seller financing`, `owner carry`, `will carry the note` (also mortgage, contract, balance, financing, or paper), `carry back`, `contract for deed`, `land contract`, `bond for deed`, `owner terms`, and `seller terms`.
- The listing states financing terms: a down payment, a monthly amount, a term length, or an interest rate. A phrase with none of those stays out of `properties.csv`. The run report counts those omissions as `withoutTerms`.
- The pin is inside the radius. Distance is haversine miles from the Fort Smith center. Rows with no pin after geocoding are dropped.

`Owner financing is not available` and `no owner financing` are denials. `No credit check` does not negate an offer. Conventional loans, FHA, VA, and the word `homeowner` do not qualify. A pasture that "will carry 20 head" does not qualify. The search query `will carry` is still sent to Craigslist, and the stricter phrase list decides.

A marketplace owner-financing category, without that phrase on the listing itself, is `catalog_tagged`. Those leads go to `output/candidates.csv`. They are not confirmed results. Landmodo and Land Century rows with only the catalog behind them are handled the same way. A Land Century record that publishes its own down payment or monthly terms is an explicit offer.

`financing_terms` keeps a down payment, a monthly amount, a term, and an interest rate when the text has them. `price` is the asking price in dollars. Land Century sometimes publishes cents. The price column uses the unit that agrees with the down payment and the monthly terms.

### Sources

| Source | What is read | How a row gets in |
| --- | --- | --- |
| `craigslist` | Fort Smith search API, postal 72901, one query per phrase, then each posting body | The title or the body has a financing phrase, and the pin is inside the radius. |
| `landcentury` | The nationwide owner-finance catalog, 100 deals per page | `isOwnerFinance` or published terms, and the pin is inside the radius. |
| `landflip` | County list pages, then the detail page | Counties that reach the circle, a financing phrase in the description, and a pin inside the radius. The county filter checkbox is ignored. |
| `landhub` | Arkansas and Oklahoma list pages, then detail pages for pins already inside the radius | The title, description, features, or directions contain a financing phrase. |
| `landwatch` | Arkansas and Oklahoma `/owner-financing` result pages | The search itself is the signal. The pin must be inside the radius. |
| `landandfarm` | The same owner-financing catalogs on LandAndFarm | Same rule as LandWatch. The two sites usually list the same tract and collapse to one CSV row. |
| `landmodo` | Arkansas and Oklahoma owner-financed catalog pages, including the map pin on each card | A pin inside the radius is a catalog lead unless that card's own title or excerpt states the offer. |
| `probes` | One URL each for Land.com, Lands of America, Zillow, LoopNet, Homes.com, Realtor.com, Redfin, Point2Homes, United Country, ByOwner, and Rehold | Status only. These probes do not add rows. |

Landflip counties: Sebastian, Crawford, Franklin, Logan, and Scott in Arkansas, and Le Flore (both slug spellings), Sequoyah, Haskell, Adair, and Muskogee in Oklahoma. A city just outside the circle can still be fetched when its geocoded point is within 15 miles of the radius. The listing pin is the final gate.

Craigslist queries are full words. The site does not prefix-match, so `owner financing` is searched on its own rather than as a fragment. Posting URLs are the canonical `/reo/d/{slug}/{id}.html` form.

LandWatch and LandAndFarm share one page shape (`__SERVER_STATE__`). Prices on those pages are already dollars. Their Arkansas owner-financing pager repeats the last page after 500 of the 552 listings it advertises. Oklahoma's 401 owner-financing listings were all retrieved on the run that produced the CSV in this repo.

### CSV columns

Rows are sorted by `miles_from_fort_smith`, then by `price`.

| Column | Meaning |
| --- | --- |
| `sources` | Sites that had this tract, separated by `; `. |
| `title` | Listing title from the richest source. |
| `price` | Asking price in dollars. Blank when the source had no price. |
| `acres` | Acreage when the source or the text provided it. |
| `financing_signal` | The phrase that qualified the row, such as `owner financing` or `contract for deed`. |
| `financing_terms` | Down payment, monthly payment, term, and rate, joined with `; `. |
| `address`, `city`, `county`, `state`, `zip` | Best address fields after the merge. State is the two-letter code. |
| `latitude`, `longitude` | Pin used for the radius check. |
| `miles_from_fort_smith` | Distance from 35.38592, -94.39855, rounded. |
| `property_type` | Source type label, when there was one. |
| `url` | Primary listing URL. |
| `other_urls` | The other URLs for the same tract, separated by ` \| `. |
| `listed_at` | Source timestamp, when the page had one. |

### Dedupe

Two rows become one when either of these is true:

- Both street addresses normalize to the same string of at least 8 characters. `Highway` becomes `hwy`, `Street` becomes `st`, and similar shortenings are applied.
- Either address is missing or shorter than that, the pins are within 0.35 miles, the prices are within 15 percent (a missing price counts as close), and the titles share enough words. The same city lowers the title overlap that is required.

Two long street addresses that differ stay as two rows. That keeps subdivision lots apart when LandWatch or LandAndFarm drops every lot on one coordinate. The merged row keeps the richer address, terms, price, and title, and it unions `sources` and `other_urls`.

### Run report

`output/run-report.json` has the center, the radius, and counts for collected rows, rows inside the radius, deduped rows, rows outside the radius, and rows with no pin. Each source has:

| Status | Meaning |
| --- | --- |
| `complete` | The adapter finished the partitions it requested. `matched` can still be 0. |
| `partial` | Paging stopped early. LandWatch and LandAndFarm report `repeated_page` when a later page repeats an earlier `pageIndex` before the advertised count is reached. |
| `blocked` | HTTP 401 or 403. |
| `rate_limited` | HTTP 429. |
| `empty_confirmed` | A short page with no listing payload. |
| `no_adapter` | The page loaded and this build has no parser for it. |
| `error` | The adapter threw. The message is in `notes`. |

`scanned` is how many listings the adapter looked at. `matched` is how many it handed to the radius step. `requests` counts HTTP calls, including cache hits.

## Project structure

```
src/cli.js                  command line
src/run.js                  source order, radius gate, dedupe, files
src/config.js               Fort Smith center, radius, queries, counties
src/http.js                 cached, spaced HTTP with a curl fallback
src/geocode.js              Census geocoder, Nominatim fallback
src/geo.js                  haversine miles and the bounding box
src/signals.js              financing phrases, terms, acres, street address
src/money.js                Land Century cents-versus-dollars prices
src/dedupe.js               same street address, or a shared pin when the addresses do not differ
src/csv.js                  CSV writer
src/html.js                 entity decode and HTML-to-text
src/sources/                Craigslist, Land Century, Landflip, Landhub, LandWatch, LandAndFarm, Landmodo, probes
test/core.test.js           unit tests
output/properties.csv       generated listing file
output/run-report.json      what each source returned
output/cache/               response cache, not committed
docs/progress/              daily progress notes
```

## Tech stack

- Node.js 20 or newer, ES modules
- No runtime dependencies
- `node --test` for the unit tests
- US Census geocoder (`geocoding.geo.census.gov`) and OpenStreetMap Nominatim for pins that a listing does not already include
- `curl.exe` for hosts that refuse Node's fetch

## Notes

Requests send `User-Agent: busca-tierra/1.0 (owner-finance property research; Fort Smith AR)`. Each host is paced at about 350 milliseconds between uncached requests. Responses with status 200, 404, and 403 are cached. Cache hits skip the pause. Nominatim calls wait about 1.1 seconds, which matches that service's usage policy. The app does not solve CAPTCHAs and does not use a logged-in session.

The Census geocoder is tried first. Coordinates come back as `x` = longitude and `y` = latitude. Nominatim is the fallback, limited to the United States. Geocodes are stored in `output/cache/geocode.json`.

`Contact for Price` stays an unknown asking price. A `$999 Down` line is a down payment. A decreased price keeps the current amount and the previous amount. Described coordinates are preferred over a city geocode, and both claims stay on the record when the page has them. The same street in two towns does not merge. A shared subdivision pin does not merge tracts that have no other identity.

The October 19 baseline export had 103 rows before these evidence rules. `npm start` replaces the output files, and the confirmed count can be lower once catalog-only tags move to `candidates.csv`. LandWatch and LandAndFarm still advertise 552 Arkansas owner-financing listings and repeat the last page after 500 unique rows. That stop is `partial` with reason `repeated_page`. Oklahoma's 401 owner-financing listings were all retrieved on that saved run. Parcel geometry, flood, soil, elevation, MLS, and automated LandSearch collection are outside this release. LandSearch's terms require written permission before automated extraction.

Land.com, Lands of America, LoopNet, Homes.com, Redfin, and Point2Homes returned HTTP 403 on the saved run. Realtor.com returned HTTP 429. Zillow, United Country, and ByOwner returned a page this build does not parse. Rehold's Fort Smith page was empty.

The blocked marketplaces in the report need a browser session this app does not automate. Re-run with `--refresh` after a source starts answering.
