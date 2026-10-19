# Busca Tierra: data accuracy and coverage implementation plan

Date: October 19, 2026 (America/Chicago)

Status: proposed implementation plan, based on the repository and data reviewed on this date. Tasks below are planned work, not completed implementation.

Participants: user/requester and Codex, with parallel reviews of core accuracy, source adapters, and exported data.

Purpose: turn the existing Fort Smith owner-finance search into a reproducible, evidence-backed property research dataset, then increase independent listing coverage and add useful property facts.

## 1. Intended outcomes

The application should answer six questions for every result:

1. What property or group of parcels is being offered?
2. Is owner financing actually offered, and what text supports that conclusion?
3. What is the purchase price, and which amounts are down payments, installments, fees, or previous prices?
4. Where is the property, how precise is that location, and how does it relate to the search radius?
5. When was the listing last successfully checked, and what availability did the source report?
6. Which sources support each field, and where do those sources disagree?

More data means more independently useful records and more useful facts per record. More marketplace URLs, repeated syndicated listings, and unverified map pins do not by themselves satisfy that objective.

### 1.1 Scope assumptions

These are proposed defaults for implementation, not new requirements already approved individually.

| Decision | Proposed default | Why |
| --- | --- | --- |
| Geography | Preserve Fort Smith center 35.38592, -94.39855 and default 40-mile straight-line radius | Matches the current product |
| Property scope | Preserve houses, vacant land, mixed property, and commercial listings; classify them correctly | Existing results include all of these |
| Interface | Keep the Node CLI, CSV, and JSON reports | A UI rewrite would delay the data work |
| Runtime | Preserve the declared Node 20+ ESM compatibility during the first releases | Avoid coupling accuracy fixes to a runtime migration |
| Storage | Versioned local JSON/JSONL observations, manifests, and snapshots behind a storage interface | Appropriate initial scope for a small local dataset |
| Additional database | Evaluate SQLite only if measured volume, querying, or concurrency warrants it | No database is necessary to correct the demonstrated defects |
| Financing | Separate explicit offers, catalog classifications, conditional offers, denials, and unknowns | Current labels imply more certainty than the evidence supports |
| Uncertainty | Retain unresolved leads in a separate export and review queue | Prevent silent loss without presenting uncertain leads as confirmed |
| New inventory | Improve existing adapters, then pilot independent sources | Highest immediate value and lowest integration dependency |
| Paid services | Optional later work, with a provider/access/cost decision before integration | No paid service is assumed available |
| Scheduling | Design a refresh command and operating policy; do not create an automation as part of this plan | This request is for the implementation plan |
| AI extraction | Optional evaluated fallback, excluded from the initial critical path | Deterministic structured extraction should handle the immediate defects |

### 1.2 Definition of a useful first release

A useful first release fixes the demonstrated price and financing bugs, prevents unsafe duplicate merges, exports evidence and freshness, and makes incomplete sources visible. It does not have to integrate every marketplace or resolve every parcel.

Do not require the new release to reproduce exactly 103 output rows. Correct processing can remove false positives, separate accidentally merged properties, merge missed duplicates, and place uncertain records in review.

## 2. Measured baseline and motivating cases

The baseline is the saved October 19 run and its cached source content. It is not a fresh seller-confirmed market census.

| Measure | Observed baseline | Interpretation |
| --- | --- | --- |
| Collected adapter matches | 192 | Already filtered inside adapters; not all discovered candidates |
| Exported rows | 103 | Not proven to be 103 distinct properties |
| Rows carrying both LandWatch and LandAndFarm | 85, or 82.5% | Substantial syndicated overlap |
| Incremental rows from LandAndFarm over LandWatch in this export | 0 | Its value may be corroboration/fallback rather than additional inventory |
| Missing financing terms | 89, or 86.4% | A financing tag usually does not provide a usable payment offer |
| Missing street address | 15 | Parcel/detail enrichment has clear value |
| Missing listed date | 7 | Listed date is also different from last verification |
| Missing title | 2 | Basic completeness issue |
| Missing city/state | 3 | Basic normalization issue |
| Rows at least 38 miles away | 18 | Location precision matters near the boundary |
| Rows at least 39 miles away | 8 | Especially useful location-review sample |
| Existing automated tests | 11 passing | Important demonstrated failures are outside the current suite |
| Arkansas CoStar catalog scanned versus advertised | 500 of 552 | 52 statewide records unexamined; local impact unknown |
| Oklahoma CoStar catalog scanned versus advertised | 401 of 401 | Observed reconciliation for that saved run only |
| Additional probe sources | 11, contributing no rows | Reachability checks are not implemented integrations |

### 2.1 Regression cases that must become fixtures

| Case | Current behavior | Required behavior |
| --- | --- | --- |
| LandFlip 395603 and 405555 | $999 exported as purchase price; cached detail says Contact for Price | Asking price unknown; $999 retained as down payment |
| LandFlip 425727 / LandWatch 428326539 | Same Altus offer exported twice with $35,000 and $33,900 | Link evidence to the same offer when identity is corroborated; current $33,900 with prior price history |
| Altus location | LandFlip output pin is about 2.8 miles from the coordinates in its description | Preserve both claims; prefer corroborated property coordinates and explain the conflict |
| Same street address in different towns | Synthetic 100 Main Street records merge | Distinct municipalities/locations prevent automatic merge |
| Same subdivision pin | Distinct tracts can merge | Coordinate equality alone cannot establish parcel identity |
| Owner financing is not available | Accepted | Negative financing assertion |
| No credit check owner financing available | Rejected | Positive financing assertion; credit-check language is not financing negation |
| $180,000 for one acre | Price helper can convert it to $1,800 | Never infer cents solely from an expensive per-acre value |
| 1,250 acres | Parser returns 250 | Parse 1,250 correctly |
| 0.25 to 1 acre lots | Range collapses to one value | Preserve range and multi-lot context |
| 10% down and 8% interest | First percentage loses its meaning | Separate down-payment percentage and stated interest rate |
| CoStar property type | Numeric bitmask causes generic land output | Use the available labels and preserve source classification |
| Page 21 repeats page 20 | Source reports ok | Partial traversal with a repetition/cap stop reason |

The Altus cached page includes address 9708 Wandering Way, acreage 1.97, APN 001-00710-000, and coordinates about 35.4283, -93.7188. Use that saved evidence to build a fixture; confirm county scope before forming a parcel key.

Three public LandSearch leads were absent by supplied address and nearby pin: 1417 Lyman Street in Fort Smith, 5109 Grand Meadow Road Lot 15 in Van Buren, and N May Avenue in Fort Smith. These are coverage investigation cases, not already verified new inventory. Two other sampled LandSearch properties were already present.

## 3. Product semantics before implementation

### 3.1 Separate five concepts

- **Source listing:** one advertisement identified within one publishing source.
- **Observation:** extracted claims from a particular version of a source listing.
- **Parcel:** a jurisdiction-scoped assessor/tax parcel, if known.
- **Offer:** a particular collection of property interests offered together under particular commercial terms.
- **Resolved result:** the best-supported current view of an offer, with conflicts and evidence attached.

A parcel may have several advertisements. An offer may include several parcels. A subdivision advertisement may describe several alternative lots rather than one purchasable bundle. A shared parcel number does not prove two offers have identical scope.

### 3.2 Financing qualification

Use explicit values:

| Assertion | Meaning | Default export treatment |
| --- | --- | --- |
| explicit_offer | Listing-specific affirmative seller-financing statement | Eligible for confirmed results if other gates pass |
| conditional_offer | Seller may finance under stated conditions | Include as conditional, never unconditional |
| catalog_tagged | Marketplace filter/category says owner financing, without listing evidence | Candidate/review until stronger evidence is obtained |
| explicit_denial | Listing-specific statement says financing is not offered | Exclude from qualifying results; retain evidence |
| conflicting | Relevant current evidence disagrees | Review queue |
| unknown | No useful evidence | Candidate only if another reason justifies review |

An advertisement saying owner financing is available is still a source claim. Do not label it seller-verified unless a documented seller verification actually occurred. Bank mortgage calculators, generic educational text, footer categories, and sitewide promotions do not qualify.

### 3.3 Location and radius

Keep the existing point-distance interpretation as the default for compatibility. Calculate distance at full precision; round only for display.

Store the location method separately: parcel geometry, parcel centroid, seller-provided point, listing map point, address interpolation, street approximation, locality centroid, county centroid, or unknown.

For a point with a defensible uncertainty distance u and center distance d:

- Clearly inside: d + u is within the radius.
- Clearly outside: d - u exceeds the radius.
- Otherwise: boundary uncertain.

Do not invent a numeric uncertainty for a provider that supplies none. Use an uncertainty class and require enrichment/review near the boundary. A listing map point is not automatically precise because it has many decimal places.

For polygons, add separate facts such as intersects_search_circle and minimum_distance_to_parcel. Do not silently replace the default point-based inclusion rule with polygon intersection. Offers that span the boundary must state that explicitly. Drive time is a separate future product feature.

### 3.4 Availability and freshness are separate

Availability: advertised_active, pending, sold, withdrawn, unavailable, unknown, conflicting.

Freshness: fresh, stale, expired, never_verified.

Fetch result: success, not_modified, not_found, access_denied, rate_limited, transport_error, parse_error.

A source outage cannot make a property sold. A single missing search result cannot make a property withdrawn. A recently retrieved page can contain an old source update date; preserve both.

## 4. Target architecture

~~~mermaid
flowchart TD
    A[Source registry and run policy] --> B[Discover candidates]
    B --> C[Persist candidate identities and coverage ledger]
    C --> D[Fetch permitted detail pages]
    D --> E[Versioned observations and evidence]
    E --> F[Normalize amounts, terms, addresses, and types]
    F --> G[Resolve location and optional parcel match]
    G --> H[Resolve listing, offer, and parcel relationships]
    H --> I[Apply financing, availability, freshness, and radius policy]
    I --> J[Confirmed and conditional exports]
    I --> K[Candidate and conflict review queues]
    E --> L[History and source observations]
    J --> M[Run manifest and quality report]
    K --> M
    L --> M
~~~

### 4.1 Design boundaries

Keep orchestration in src/run.js, but move policy and normalization into focused functions with explicit inputs. Source adapters should interpret source-specific structures and return observations; they should not independently decide the final truth of a property.

Avoid turning this into a distributed crawler. Start with one local process, controlled concurrency, explicit per-host budgets, replayable fixtures, and generation-based outputs.

### 4.2 Proposed module responsibilities

| Existing/proposed path | Responsibility |
| --- | --- |
| src/cli.js | Validate options, select commands, show meaningful completion status |
| src/run.js | Coordinate stages and publish a completed run |
| src/config.js | Search defaults and user configuration |
| src/http.js | Transport, bounded retries, conditional requests, request metadata |
| src/cache.js | Versioned cache envelope, TTL, failure cache, content hashes |
| src/model.js | Record schemas and validation, without hiding source values |
| src/store.js | File storage interface and generation manifests |
| src/sources/registry.js | Source identity, family, capabilities, access mode, policy |
| src/sources/*.js | Discovery and source-specific detail extraction |
| src/evidence.js | Evidence spans, links, assertion provenance |
| src/money.js | Explicit price types, units, and labeled terms |
| src/signals.js | Financing assertions, acreage, contextual text extraction |
| src/geocode.js | Provider-specific matching and provenance |
| src/geo.js | Validated point distance and uncertainty decisions |
| src/parcels/*.js | Optional county/state parcel lookup and geometry |
| src/dedupe.js | Candidate matching, constraints, relationship decisions |
| src/resolve.js | Field-level selection, conflict creation, current view |
| src/lifecycle.js | Listing observation/status history |
| src/review.js | Durable review decisions and reason codes |
| src/csv.js | Explicit export views and spreadsheet-safe text |
| src/report.js | Source reconciliation and quality metrics |
| scripts/evaluate-data.js | Offline benchmark scoring |
| scripts/compare-runs.js | Explain additions, removals, field changes, merges, splits |
| test/fixtures/ and test/*.test.js | Sanitized source fixtures and meaningful regressions |

These are boundaries, not a mandate to create every file in one PR. Introduce modules when a work item needs them.

## 5. Data model and storage contract

### 5.1 Source and listing identity

Source metadata should include sourceId, sourceFamily, upstreamProvider when known, geographic coverage, discovery mode, access mode, parserVersion, capabilities, configured limits, and policy references.

Keep publication source IDs separate from upstream listing IDs. LandWatch and LandAndFarm may share upstream identifiers, but only use a common ID namespace after verifying that relationship in fixtures and metadata. Two mirrors count as two observations, not two independent confirmations.

Source listing IDs should be stable across repeated downloads. Preserve canonical URL, observed URL, and redirects. Strip known tracking parameters only; do not strip parameters that identify the property.

### 5.2 Observation schema

~~~json
{
  "schemaVersion": 2,
  "observationId": "obs_example",
  "sourceListingId": "landflip:395603",
  "sourceId": "landflip",
  "sourceFamily": "landflip",
  "sourceUrl": "https://www.landflip.com/land/395603",
  "snapshotHash": "sha256:example",
  "parserVersion": "landflip-v2",
  "retrievedAt": "2026-10-19T21:00:00.000Z",
  "sourceModifiedAt": null,
  "retrievalMode": "network",
  "fields": {
    "askingPrice": {
      "value": null,
      "unit": "USD",
      "state": "not_published",
      "raw": "Contact for Price",
      "evidenceIds": ["ev_price"]
    },
    "downPayment": {
      "value": 99900,
      "unit": "USD_minor",
      "state": "observed",
      "raw": "$999 Down",
      "evidenceIds": ["ev_down"]
    }
  },
  "warnings": []
}
~~~

This is an illustrative shape, not an implemented API. Choose consistent money units in the final schema: integer USD cents for numeric money, explicit currency, and null for unknown. Numeric JSON values must stay within safe integer bounds.

Each field needs a value state: observed, derived, not_published, not_parsed, conflicting, invalid, or unknown. This distinguishes absence in the source from extractor failure. Zero is a valid observed amount, not a missing value.

### 5.3 Evidence record

Evidence should identify observation, source URL, snapshot hash, extraction method, parser version, evidence kind, text span or structured field path, and the claim it supports.

Store only the necessary supporting excerpt in exported evidence. Raw snapshots remain local according to source retention permissions. Do not embed entire copyrighted descriptions in public-facing exports by default.

Keep historical and current assertions distinct. Replaying old HTML today must not make its claims freshly verified today.

### 5.4 Financial fields

| Field group | Required distinctions |
| --- | --- |
| Price | asking price, cash price, financed purchase price, previous price, auction minimum, contact-for-price |
| Upfront payment | down-payment amount, down-payment percentage, deposit, document fee, closing costs |
| Recurring payment | monthly amount, minimum/from amount, principal-only versus combined charges if stated |
| Rate | stated interest rate, APR only when explicitly identified as APR, rate type if stated |
| Duration | months, range of terms, amortization duration, maturity/balloon date |
| Charges | recurring service fee, taxes included/excluded/unknown, association fees |
| Conditions | credit check, approval required, seller discretion, prepayment statements |
| Derived values | separately labeled calculations with their inputs and assumptions |

Do not infer purchase price from down payment plus installments. Interest, balloon amounts, fees, and alternative payment plans make that unsafe. A consistency calculation may create a warning, not silently rewrite a published amount.

Multiple financing plans belong in an offerPlans array. Do not combine a down payment from one plan with the monthly payment from another.

### 5.5 Location and parcel fields

Store raw/normalized address, city, county name, county FIPS where resolved, state, ZIP as text, APN as text, location claims, chosen location, method, matched address, provider, provider dataset/version, uncertainty class, and observed time.

Normalize APNs using jurisdiction-specific rules. Preserve leading zeros and the original punctuation. Do not treat APNs as globally unique.

Parcel records may carry multiple geometries/vintages, recorded acreage, calculated area, legal description, source date, and publication date. Listing acreage, assessor acreage, and geometry-derived acreage remain distinct claims.

### 5.6 Offer relationships and resolution

An offer record should have stable offerId, sourceListingIds, parcelRefs, scope classification, chosen fields, conflicts, qualification decisions, and review state.

Scope classifications: single_parcel, parcel_bundle, part_of_parcel, alternative_lots, unknown.

Persist stable offer IDs and aliases through merges and splits. Do not derive the permanent ID only from a hash of the current member URLs: membership changes would change the identity. Replays use the same identity registry or a deterministic test registry.

Human corrections are versioned overrides with field, value, reason, evidence, reviewer, creation time, and optional expiry. They must survive refreshes and be reviewable when new evidence conflicts.

### 5.7 File layout

~~~text
output/
  properties.csv                 compatibility export
  properties-v2.csv              richer confirmed/conditional view
  candidates.csv                 unresolved or catalog-only leads
  review-queue.csv               conflicts and actionable questions
  run-report.json                summary pointing at one completed generation
  latest.json                    selected generation manifest
  runs/<run-id>/
    manifest.json
    observations.jsonl
    candidates.jsonl
    offers.jsonl
    relationships.jsonl
    lifecycle-events.jsonl
    source-reports.json
    quality-report.json
    diff-from-previous.json
    properties-v2.csv
  state/
    identities.json
    overrides.jsonl
  cache/
    http/
    geocode/
    parcels/
~~~

Treat this layout as proposed. Keep operational snapshots, contact data, caches, and imports out of Git by default; commit only intentionally selected sanitized fixtures. Existing sample exports already tracked in Git require a deliberate decision about whether to remain samples.

### 5.8 Atomicity and recovery

Acquire a single-writer lock before mutating shared state. Write a run to a staging directory, validate every record and count, write its manifest with hashes, then publish the completed generation. Publish latest.json only after the complete generation is available.

The generation manifest is authoritative. Two top-level convenience files cannot be made atomically consistent with each other using independent renames; readers requiring consistency must read the manifest and generation files. Include runId in the report so mismatches are detectable.

Use same-volume staging and renames, and test actual Windows replacement behavior. Clean stale staging directories only after verifying their paths and that no active lock owns them. Never delete the prior good generation during publication.

An interrupted write must leave the previous completed run usable. A failed identity/override update must not partially publish a new generation. Bundle state revisions into the generation commit protocol or use a recoverable transaction journal.

SQLite remains a later implementation option behind the same interfaces. Evaluate it if state scans or joins become materially slow, the retained history grows substantially, or concurrent writers become a real requirement. Verify runtime/driver compatibility before choosing a driver.

## 6. Collection and normalization contracts

### 6.1 Adapter interface

An adapter should declare capabilities and implement discovery, optional detail enrichment, and source-specific normalization. A suggested conceptual interface is:

~~~text
discover(context) -> candidates + coverage report
fetchDetail(candidate, context) -> fetch result + snapshot reference
parseDetail(snapshot, candidate) -> source observation + extraction warnings
~~~

Initially wrap the existing adapter functions rather than rewrite every parser at once. Normalized records pass through common validation and policy.

Candidates need source ID, source listing ID/URL, discovery partition, advertised location, preliminary classification, and reasons for enrichment. Reject only clearly irrelevant candidates; explain every rejection.

### 6.2 Count reconciliation

Track units explicitly. Pages requested, HTTP attempts, cache hits, source listings discovered, unique source listings, normalized observations, canonical offers, and parcels are different quantities.

Within a completed discovery partition, every discovered unique candidate must have one stage disposition: processed, rejected with reason, deferred with reason, or failed with reason. Preserve candidates that reach a later stage in a different ledger; do not sum repeated stage counts as unique properties.

A source report should include advertised count when available, unique listing count, completed partitions, failed partitions, repeated pages, missing detail count, unknown-location count, cache-only count, stop reason, and known/unknown coverage gaps.

Use source statuses complete, partial, blocked, rate_limited, parser_error, transport_error, no_adapter, empty_confirmed, and disabled. A complete search can return zero; a parse failure cannot be called empty.

### 6.3 Request policy

Maintain per-source discovery/detail budgets and per-host request rate/concurrency. Record actual requests, including retries and curl fallback attempts. Honor Retry-After. Bound exponential backoff and retry count.

Do not immediately change transport to evade a 429. A 403 is an access outcome, not evidence of zero listings. Redirects and transport fallback must preserve metadata and the same access policy.

A fetch budget stops optional work as deferred; it does not pretend coverage is complete. Network retry storms must not consume the entire run.

### 6.4 Extraction precedence

Prefer source-specific structured fields and JSON-LD when their semantics are validated. Then use listing-specific DOM sections, then bounded text extraction. Do not evaluate arbitrary JavaScript from a page to obtain state.

An authoritative-looking structured field can still be old or mislabeled. Compare current displayed price, strike-through historical price, offer scope, and source timestamp before selecting values.

Website chrome, related listings, mortgage calculators, agent biographies, and generic financing guides must stay outside property evidence.

### 6.5 Property types and attributes

Normalize a small vocabulary: vacant_land, residential_with_improvements, commercial, agricultural, mixed, other, unknown. Preserve source labels and allow multiple classifications when supported.

Extract buildings, beds, baths, building square feet, listing acreage, seller/broker identity, upstream listing identifiers, parcel IDs, utilities, access statements, restrictions, and status when present. Every assertion keeps its source.

Treat utility availability, access rights, and unrestricted-use claims as advertised claims until supported by appropriate records. Do not infer legal access from a visible road.

## 7. Freshness, caching, and lifecycle

### 7.1 Proposed defaults to tune after measurement

| Resource | Initial refresh policy | Qualification |
| --- | --- | --- |
| Listing discovery pages | 24 hours | Shorter only if useful and allowed |
| Detail pages for active shortlist | 24 hours | Highest priority |
| Other active candidate detail | 72 hours | Budgeted rotation |
| Explicit sold/withdrawn pages | Longer revisit interval, such as 14 days | Relisting can still occur |
| Failed transient requests | Short bounded retry; obey Retry-After | Do not overwrite last successful payload |
| 403/access denial | Disable/review source access until policy permits retry | Never permanent proof of no listings |
| 404 | Record unavailable observation and recheck under policy | Not proof of sale |
| Successful geocode | Reuse while query/provider/dataset remains applicable | Recompute on address or benchmark change |
| No geocode match | Retry after input/parser/provider change; otherwise bounded negative TTL | Separate no-match from service failure |
| Parcel data | Respect provider update cadence and source date | New retrieval does not mean new assessment |

These intervals are configuration proposals, not provider guarantees. Cache freshness and listing freshness must not share one ambiguous timestamp.

### 7.2 Cache envelope

Store requested/final URL, HTTP status, fetchedAt, lastValidatedAt, ETag, Last-Modified, response content type, body hash, source policy, and expiry. Keep response headers on an allowlist; do not save cookies or authorization.

Use conditional GET where supported. A 304 may update successful validation time for the retained body, but not invent a new source modification date.

Legacy cache entries have no trustworthy fetchedAt. They may be used for offline replay, but mark their age unknown. File modification time is not proof of source verification.

Define refresh scopes: discovery, details, geocodes, parcels, all. Retain existing --refresh as a documented alias; bypassing a cache does not bypass provider limits or force repeated public bulk geocoding.

### 7.3 Availability transitions

- A successful source-specific active status supports advertised_active.
- A clear pending/sold/withdrawn status records that source assertion.
- A failed fetch updates check outcome without changing active to sold.
- Absence from one complete partition creates a missing observation, not immediate withdrawal.
- Repeated absence can flag unavailable/needs_review under a documented policy, but must not invent a transaction outcome.
- Conflicting current source statuses produce a conflict unless a tested field-specific precedence resolves it.
- A later relisting preserves the prior listing history and can create a new offer when its scope changes.

Prefer the originating listing/agent for availability when its identity, freshness, and authority are established. Do not use a universal rule that the newest timestamp always wins; it may be a mirror retrieval date.

## 8. Matching and conflict resolution

### 8.1 Candidate generation

Generate possible matches using stable source/upstream IDs, county-scoped parcel references, full normalized addresses, and nearby precise points. Use these indexes to avoid comparing every pair as history grows.

### 8.2 Automatic merge requirements

Automatic merging requires strong identity agreement and no hard conflict in offer scope. Examples:

- Same validated upstream listing ID and compatible offer scope.
- Same county-scoped parcel set, compatible tract/lot identity, and compatible sale scope.
- Same full address and corroborating parcel/location/acreage evidence where parcel ID is missing.

Reject automatic merging for different known parcels, different lot numbers, different municipalities with the same street text, incompatible parcel sets, clearly different acreage/scope, or ambiguous shared subdivision pins.

Price disagreement is a conflict to investigate, not always proof of different property. A price change must not create a new property by itself.

### 8.3 Cluster rules

Pairwise similarity is not transitive: A matching B and B weakly matching C does not prove A and C are one offer. Validate group-wide constraints before merging groups. Do not use unconstrained connected components.

Results must be independent of adapter order and input row order. Store match reasons, evidence, parser/policy version, and accepted/rejected/manual relationships.

### 8.4 Field resolution

For each field, consider relevance to the same offer, original versus mirrored source, evidence specificity, source modification time, successful check time, and manual override.

If two supported values remain incompatible, export a conflict and the selected value's reason, or leave the canonical value unresolved. Never silently replace a clear current price with a richer but older record.

Keep duplicate confidence, financing evidence, location quality, and freshness separate. An attractive overall score must not hide a failed qualification gate.

## 9. Geography and parcel enrichment

### 9.1 Repair existing geocoding first

Validate finite coordinates, latitude/longitude order and bounds, state/county consistency, provider result class, and input completeness. Record all meaningful candidates when the provider returns several.

The Census geocoder requires a structure address and returns a position calculated along an address range. Use it for appropriate addresses and label the result address interpolation, not a surveyed parcel point. Preserve benchmark metadata. [Census API documentation](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html)

The existing public Nominatim fallback needs an explicit provider policy. Its public service limits traffic to at most one request/second; regular or day-long scripts are restricted to four requests/minute, with one thread/machine, caching, identifying requests, and attribution. Default recurring bulk work to a suitable alternative unless public-service use is deliberately configured within that policy. Keep the endpoint configurable. [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)

### 9.2 Arkansas parcel pilot

Start with relevant parcels in Sebastian and Crawford, then Franklin, Logan, and Scott as matches require. Use the published Arkansas services: layer 0 for centroids and layer 6 for polygons.

Prefer county + APN lookup, then constrained address matching. A point-in-polygon lookup can propose a match but cannot prove a vague listing pin identifies that parcel.

Request a known output coordinate system, respect the current record limit, paginate or batch IDs, and preserve geometry validity warnings. Store raw APN, normalized APN, county, source date, CAMA date, publication date, and matched attributes.

The state's published data can be partial, is a snapshot, and is not a legal boundary survey. County presence in the dataset does not imply county-wide completeness. Preserve those limitations in enrichment metadata. [Arkansas parcel layer](https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6)

### 9.3 Oklahoma parcel pilot

Inventory official lookup/export routes for Sequoyah and Le Flore first, then other intersecting counties as useful. Treat each county as a separate access and schema evaluation. Do not assume a county website provides an unrestricted API.

Where only human lookup is practical, support manual APN/evidence import through the same schema. A paid normalized parcel provider remains optional if county integration costs exceed its demonstrated value. [Sequoyah assessor](https://sequoyah.okcounties.org/offices/county-assessor)

### 9.4 Useful land facts after parcel matching

Add mapped flood-zone intersections, soil characteristics, and elevation/slope only after reliable property location is available. Intersect whole parcels when possible rather than sampling just a town or listing pin.

Record dataset version, coverage, observation date, method, and null reason. Missing coverage is unknown, not no flood risk. Soil ratings do not establish septic approval; mapped slope and road proximity do not prove buildability.

Sources to pilot: [FEMA NFHL](https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer), [USDA Soil Data Access](https://sdmdataaccess.nrcs.usda.gov/WebServiceHelp.aspx), and [USGS 3DEP](https://www.usgs.gov/3d-elevation-program).

## 10. Independent listing sources and source selection

### 10.1 Source admission checklist

For each proposed source, record:

- Geographic and property-type coverage.
- Evidence that it contains relevant inventory.
- Public/manual/permitted-feed/licensed access route.
- Stable IDs, update timestamps, status, and detail availability.
- Whether it mirrors an existing upstream catalog.
- Terms, request limits, retention/display restrictions, and attribution.
- Parser maintenance burden and measured request cost.
- Incremental verified offers and additional supported fields from a pilot.

Keep unavailable access as an explicit dependency on the source item. It does not block unrelated accuracy work.

### 10.2 Existing sources

| Source | First improvement | Expansion condition |
| --- | --- | --- |
| LandWatch/LandAndFarm | Detail enrichment, correct types, cap reconciliation, shared upstream IDs | Measure whether both need full traversal |
| LandFlip | Current price, description coordinates/APNs, cautious locality prefilter | Recover missing county/detail candidates |
| LandHub | Preserve unresolved pins, improve status and detail extraction | Prove pagination completeness |
| Craigslist | Align discovery phrases with classifier, reconcile pagination, use safe geography | Measure unique local additions per phrase |
| LandCentury | Explicit units and payment fields, location rescue | Do not assume zero prior local matches means permanent irrelevance |
| Landmodo | Catalog evidence separation, detail/coordinate rescue | Measure local yield before increasing budget |
| Probe-only sites | Report as probes separately | A real adapter/feed and access validation are required |

### 10.3 LandSearch

Use the three absent sampled addresses as pilot leads, rechecking current identity, location, financing, and availability. Do not treat the landing-page count as a count within the application's exact circle.

Begin with user-supplied saved links or manual factual imports. Automated extraction requires the provider's express written permission under its current terms. Its advertised feed program receives listings into LandSearch; it is not evidence of an outbound public inventory API. [Terms](https://www.landsearch.com/corp/terms), [feed program](https://www.landsearch.com/feed)

Pilot references: [1417 Lyman Street](https://www.landsearch.com/properties/1417-lyman-st-fort-smith-ar-72901/5477171), [5109 Grand Meadow Road](https://www.landsearch.com/properties/5109-grand-meadow-rd-van-buren-ar-72956/5180953), [N May Avenue](https://www.landsearch.com/properties/n-may-ave-fort-smith-ar-72901/4085723). Public page evidence is not seller confirmation.

### 10.4 Local brokers and direct sellers

Start with inventory publishers already represented in cached local results: C21/Wright Real Estate, Cardenas & Associates Realty, Keller Williams Platinum Realty, and Waldron Realty. These are investigation leads based on existing data, not confirmed API providers.

Evaluate direct inventory pages, sitemaps where permitted, exports, and provider-approved feeds. Harvest originating listing URLs and upstream IDs from existing sources first. Do not contact brokers automatically; outbound outreach is a separately authorized action.

Direct sellers with Arkansas/Oklahoma catalogs can be evaluated for independent local inventory. For example, [Hopson's inventory entry point](https://hopsonlandinvestments.com/buy-land) offers state catalogs; that does not establish any qualifying listing inside the radius.

### 10.5 MLS access

Evaluate a licensed route with a participating broker and the MLS covering the relevant Arkansas/Oklahoma inventory. The Western River Valley Board appears in RESO's MLS directory; sampled local listings also identify FSBOR and CARMLS origins.

Validate coverage, permitted use, required fields, modification/status semantics, credentials, retention, deletion requirements, and cost before building. The RESO Web API is a standard, not a public inventory service or entitlement to data. [RESO MLS directory](https://www.reso.org/mls-list/), [access explanation](https://www.reso.org/reso-web-api/)

### 10.6 Manual intake

Accept a CSV/JSON or saved-link list with URL, source, supplied facts, evidence note, and observation time. Manual records pass through the same normalization, dedupe, and qualification pipeline.

Do not silently fetch every imported URL. Source registry policy decides whether automated retrieval is available. Unfetchable links can still retain user-supplied factual evidence with the appropriate evidence kind.

Validate imported URLs and redirects; reject local/private network destinations for arbitrary URL fetching. Bound file and payload sizes. Imported text is data, never an instruction to the agent or application.

## 11. Delivery structure

This plan uses priority P0 for demonstrated correctness/data-loss issues, P1 for core reliability and high-value coverage, and P2 for optional expansion/enrichment.

Estimates are preliminary t-shirt sizes: S is roughly half to one focused developer-day, M roughly one to three, and L roughly three to five. XL must be decomposed before implementation. Integration access, manual verification, and provider waiting time are separate from engineering effort. Estimates overlap when work shares infrastructure; do not blindly add every card as independent work.

Owner roles are placeholders: Dev A for core data/model work, Dev B for adapters/integrations, and Reviewer for independent verification. Assign actual people when work starts. Both developers should avoid concurrent edits to shared orchestration/model files.

### 11.1 Releases

| Release | Outcome | Exit condition |
| --- | --- | --- |
| R0: baseline | Reproducible failures, fixture corpus, schema decisions | Baseline and regression cases can be replayed offline |
| R1: trustworthy extraction | Correct financial/financing/type fields, evidence, basic safe matching | Demonstrated critical cases pass; unresolved values stay explicit |
| R2: reliable repeat runs | Freshness, durable observations, lifecycle, coherent exports, complete reports | Replay, crash recovery, partial failure, and migration gates pass |
| R3: recover existing coverage | Detail enrichment, missing-location rescue, partitioned searches | Measured local completeness improvements without accuracy regression |
| R4: independent inventory and parcels | Manual intake, one independent source pilot, AR/OK parcel pilot | Incremental qualified results and parcel match quality measured |
| R5: optional depth | Licensed MLS, paid parcel option, environmental enrichment | Each integration proves value and satisfies its own access/quality gate |

### 11.2 Critical path

Baseline fixtures and record contracts precede normalization and evidence-aware adapters. Durable source observations precede reliable history and field conflict resolution. Location confidence and offer identity precede parcel-dependent enrichment. A validated export and benchmark precede promotion of a new source.

An early regression patch can land before the full storage architecture if it preserves the agreed field semantics and is replay-tested. Do not make straightforward price/negation fixes wait for optional GIS or MLS work.

### 11.3 Suggested two-developer sequence

| Work interval | Dev A | Dev B | Integration point |
| --- | --- | --- | --- |
| First | Model/evidence contracts and baseline harness | Extract sanitized source fixtures | Agree candidate and observation shapes |
| Next | Money/financing/location normalization | LandFlip and CoStar extraction fixes | Offline regression run |
| Next | Storage/cache/lifecycle | Adapter coverage ledger and missing-pin rescue | Repeat-run simulation |
| Next | Identity/conflict resolution and exports | Pagination and full-detail enrichment | Shadow comparison |
| Next | Quality metrics and release hardening | Manual intake and independent-source pilot | Release gates |
| Later | Parcel matching and review tools | Provider integrations and optional enrichments | Source-specific promotion |

Do not start more source integrations than can be independently validated. A proposed limit is one unproven inventory adapter at a time.

<!-- WORK_PACKAGES -->

## 12. Session decisions and follow-up

The user requested a large implementation plan following a read-only data review. The plan therefore makes the proposed changes concrete without starting the application implementation.

| Choice considered | Proposed choice | Rationale/status |
| --- | --- | --- |
| Add many marketplaces immediately or repair existing data first | Repair and enrich first | Demonstrated errors already affect exported rows |
| Require a database immediately or retain local files | File-backed versioned storage first | Preserves current runtime and keeps first delivery small |
| One flat row as source of truth or retained observations | Retained observations with resolved export | Needed for disagreements, refresh, and audits |
| Treat catalog tags as explicit offers | Preserve a separate classification | Evidence strength differs |
| Drop uncertain records or mix them into confirmed results | Candidate/review views | Preserves leads and confidence |
| Fully traverse both syndicated marketplaces forever | Measure marginal value and allow primary/fallback policy | Current export shows complete overlap from the second marketplace |
| Count all new URLs as success | Count qualified offers and added facts | Avoids rewarding duplicates |
| Enable all optional services | Pilot each with an explicit access/value decision | Provider availability and value remain unproven |

No board issues, milestones, external messages, source accounts, subscriptions, or scheduled jobs are created by this planning document.

Repository publication context: origin currently points to https://github.com/amosroger91/busca-tierra.git. Session instructions permit pushes/PRs only against the live Gitea host, https://gitea.kscomputing.com. Before future publication, resolve the intended live repository through the specified Gitea resolver/search process; do not guess its organization or automatically replace origin. This does not block writing or reviewing the local plan.

For later Gitea PRs, use the configured CI pipeline and verify commit statuses exist. Zero checks means onboarding is needed. Do not run the retired pr-review-bot.

Open decisions for implementation kickoff: confirmed-output strictness, how long to retain local snapshots/history, available source access/budget, actual task owners, and whether the first release needs any property-type filters. Proposed defaults above allow local correctness work to proceed while optional integrations remain conditional.

This file also serves as the dated planning-session recap. No existing recap was overwritten.
