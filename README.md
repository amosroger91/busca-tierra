# busca-tierra

Owner-financed and seller-financed property listings within 40 miles of Fort Smith, Arkansas, gathered into one deduplicated CSV.

## Overview

Public land and real-estate sites do not share one search. This app queries the sources that answer a plain HTTP client, keeps listings whose own text offers owner or seller financing, drops anything outside a 40-mile circle around Fort Smith, and merges the same tract when it shows up on more than one site.

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

## Quick start

```powershell
npm test
npm start
```

The search writes `output/properties.csv` and `output/run-report.json`. A later run reuses `output/cache/`. Pass `--refresh` to request every page again.

## Configuration

No environment variables are required. `.env.example` is only a reminder of that.

| Flag | Default | Purpose |
| --- | --- | --- |
| `--radius` | `40` | Miles from Fort Smith. The center is 35.38592, -94.39855. |
| `--out` | `output/properties.csv` | CSV path. |
| `--report` | `output/run-report.json` | Per-source status, request counts, and match counts. |
| `--cache` | `output/cache` | Saved responses and geocodes. |
| `--refresh` | off | Ignore the cache and request again. |
| `--sources` | `craigslist,landcentury,landflip,landhub,landwatch,landandfarm,landmodo,probes` | Comma-separated subset. |

## Usage

| Command | What it does |
| --- | --- |
| `npm start` | Full search at the default 40-mile radius. |
| `npm start -- --radius 25` | Same search, tighter circle. |
| `npm start -- --sources craigslist,landcentury` | Query only those sources. |
| `npm test` | Unit tests for distance, financing phrases, price units, and dedupe. |

CSV columns: `sources`, `title`, `price`, `acres`, `financing_signal`, `financing_terms`, `address`, `city`, `county`, `state`, `zip`, `latitude`, `longitude`, `miles_from_fort_smith`, `property_type`, `url`, `other_urls`, `listed_at`.

A row is kept when the listing text contains an owner-financing phrase (`owner financing`, `seller will carry`, `contract for deed`, `land contract`, `carry back`, and the close variants) and the pin is inside the radius. "No owner financing" and bank products such as conventional or FHA financing do not qualify. Land Century's owner-finance catalog, LandWatch and LandAndFarm owner-financing searches, and Landmodo's owner-financed catalog are trusted as that phrase.

## Project structure

```
src/cli.js                  command line
src/run.js                  source order, radius gate, dedupe, files
src/http.js                 cached, spaced HTTP with a curl fallback
src/geocode.js              Census geocoder, Nominatim fallback
src/signals.js              financing phrases, terms, acres, street address
src/money.js                Land Century cents-versus-dollars prices
src/dedupe.js               same street address, or a shared pin when the addresses do not differ
src/csv.js                  CSV writer
src/sources/                Craigslist, Land Century, Landflip, Landhub, LandWatch, LandAndFarm, Landmodo, probes
test/core.test.js           unit tests
output/properties.csv       generated listing file
output/run-report.json      what each source returned
```

## Tech stack

- Node.js 20 or newer
- No runtime dependencies
- US Census geocoder and OpenStreetMap Nominatim for pins that a listing does not already include

## Notes

Requests are spaced per host and saved under `output/cache/`. Craigslist posting pages, Landflip listing pages, and Landhub detail pages are opened only for candidates already inside or near the circle.

Land Century's feed mixes cent and dollar amounts. The price column uses the unit that agrees with the published down payment and monthly terms.

Landflip coverage is the counties that reach the circle: Sebastian, Crawford, Franklin, Logan, and Scott in Arkansas, and Le Flore, Sequoyah, Haskell, Adair, and Muskogee in Oklahoma. A listing in one of those counties is kept only when its pin is inside the radius.

LandWatch and LandAndFarm are read from their Arkansas and Oklahoma owner-financing result pages. Landmodo is read from its Arkansas and Oklahoma owner-financed catalog. Each of those catalogs is statewide, so only pins inside the circle are written to the CSV. Two listings with different street addresses stay separate even when the site pins both lots on the same coordinate. LandWatch's Arkansas owner-financing pager repeats its last page after 500 of the 552 listings it advertises, and LandAndFarm does the same. Oklahoma's 401 owner-financing listings were all retrieved.

The blocked marketplaces in the report need a browser session this app does not automate. Re-run with `--refresh` after a source starts answering.
