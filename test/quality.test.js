import assert from "node:assert/strict";
import test from "node:test";
import { dedupeListings } from "../src/dedupe.js";
import { interpretPrice } from "../src/money.js";
import { parseMarketplacePage, propertyLabels } from "../src/sources/costar.js";
import { parseDetail, parsePriceBlock } from "../src/sources/landflip.js";
import { partitionListings } from "../src/run.js";
import { classifyFinancing, extractTerms, parseAcreage, parseAcres } from "../src/signals.js";

test("an offer with no published terms stays out of the property list", () => {
  const shared = { latitude: 35.4, longitude: -94.4, miles: 10, locationMethod: "listing_map_point" };
  const partitioned = partitionListings([
    { ...shared, title: "Stated terms", financingAssertion: "explicit_offer", financingTerms: "$2,000 down; $400/month" },
    { ...shared, title: "Phrase only", financingAssertion: "explicit_offer", financingTerms: "" },
    { ...shared, title: "Catalog", financingAssertion: "catalog_tagged", financingTerms: "" },
  ]);
  assert.deepEqual(partitioned.listings.map((row) => row.title), ["Stated terms"]);
  assert.equal(partitioned.withoutTerms, 1);
  assert.equal(partitioned.candidates.length, 1);
  assert.equal(partitioned.review.length, 0);
});

test("owner financing is not available is a denial", () => {
  assert.equal(classifyFinancing("Owner financing is not available").assertion, "explicit_denial");
  assert.equal(classifyFinancing("no owner financing").assertion, "explicit_denial");
});

test("no credit check does not negate an owner-financing offer", () => {
  const result = classifyFinancing("No credit check owner financing available");
  assert.equal(result.assertion, "explicit_offer");
  assert.equal(result.label, "owner financing");
});

test("a high price per acre stays in dollars", () => {
  assert.equal(interpretPrice(180000, { acres: 1 }), 180000);
});

test("acreage keeps thousands separators and ranges", () => {
  assert.equal(parseAcres("1,250 acres of pasture"), 1250);
  const range = parseAcreage("0.25 to 1 acre lots");
  assert.equal(range.ranged, true);
  assert.equal(range.min, 0.25);
  assert.equal(range.max, 1);
  assert.equal(parseAcres("0.25 to 1 acre lots"), null);
});

test("down-payment percent stays distinct from the interest rate", () => {
  const terms = extractTerms("10% down and 8% interest");
  assert.match(terms, /10% down/);
  assert.match(terms, /8% interest/);
  assert.doesNotMatch(terms, /^10% interest/);
});

test("contact for price does not become the asking price", () => {
  const html = `<div class="price">Contact for Price</div><div class="acres">4.63 acres</div><p>Listing 395603 acres of notes. $999 Down near the trail. Owner will finance.</p>`;
  const price = parsePriceBlock(html);
  assert.equal(price.price, null);
  assert.equal(price.priceState, "not_published");
  const listing = parseDetail(html, {
    title: "$999 Down Near Ogden Mills Trail",
    excerpt: "$999 Down",
    price: 999,
    financingTerms: "",
    acres: 999,
  });
  assert.equal(listing.price, null);
  assert.equal(listing.acres, 4.63);
  assert.equal(listing.acresLabel, "4.63 acres");
  assert.match(listing.financingTerms, /\$999 Down/);
  assert.equal(listing.financingAssertion, "explicit_offer");
});

test("the Altus detail keeps the current price, the prior price, and the described pin", () => {
  const html = `
    <div class="acres">1.97 acres</div>
    <div class="price">$33,900 USD <span class="price-last has-tip" title="Decreased by $1,100 (3.1%) on Oct 19, 2026">$35,000</span></div>
    <address><p>9708 Wandering Way : Altus, AR 72821</p></address>
    <p>Owner financing terms: $6,780 down and $389.09/Month for 120 months. 12% interest.
    Coordinates: 35.4283, -93.7188. Parcel number 001-00710-000.</p>`;
  const listing = parseDetail(html, {
    source: "landflip",
    title: "Owner Financed Homesite Altus AR",
    excerpt: "",
    price: 35000,
    city: "Altus",
    state: "AR",
    financingTerms: "",
    url: "https://www.landflip.com/land/425727",
  });
  assert.equal(listing.price, 33900);
  assert.equal(listing.previousPrice, 35000);
  assert.equal(listing.address, "9708 Wandering Way");
  assert.equal(listing.latitude, 35.4283);
  assert.equal(listing.longitude, -93.7188);
  assert.equal(listing.apn, "001-00710-000");
  assert.equal(listing.locationMethod, "seller_provided_point");

  const merged = dedupeListings([
    listing,
    {
      source: "landwatch",
      title: "1.97-Acre Altus, AR Homesite with Owner Financing",
      price: 33900,
      acres: 1.97,
      address: "9708 Wandering Way",
      city: "Altus",
      state: "AR",
      latitude: 35.42832565,
      longitude: -93.71881866,
      financingSignal: "owner financing",
      financingAssertion: "explicit_offer",
      locationMethod: "listing_map_point",
      listedAt: "2026-10-19T13:05:42.117",
      url: "https://www.landwatch.com/example",
    },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].price, 33900);
  assert.equal(merged[0].previousPrice, 35000);
  assert.equal(merged[0].acres, 1.97);
  assert.equal(merged[0].acresLabel, "1.97 acres");
  assert.equal(merged[0].latitude, 35.4283);
  assert.equal(merged[0].longitude, -93.7188);
  assert.equal(merged[0].locationMethod, "seller_provided_point");
  assert.equal(merged[0].apn, "001-00710-000");
  assert.equal(merged[0].sources.length, 2);
});

test("the same street in different towns stays two offers", () => {
  const rows = dedupeListings([
    { source: "a", title: "House", price: 100000, address: "100 Main Street", city: "Fort Smith", state: "AR", latitude: 35.38, longitude: -94.4 },
    { source: "b", title: "House", price: 100000, address: "100 Main Street", city: "Van Buren", state: "AR", latitude: 35.44, longitude: -94.35 },
  ]);
  assert.equal(rows.length, 2);
});

test("a shared subdivision pin does not merge distinct tracts", () => {
  const shared = { price: 35000, city: "Cookson", state: "OK", latitude: 35.67434, longitude: -94.93977, financingSignal: "owner financing" };
  const rows = dedupeListings([
    { ...shared, source: "landwatch", title: "Vacant Land, Cookson, OK", address: "" },
    { ...shared, source: "landandfarm", title: "Vacant Land, Cookson, OK", address: "" },
  ]);
  assert.equal(rows.length, 2);
});

test("CoStar labels survive a numeric property type bitmask", () => {
  const labels = propertyLabels({ propertyTypes: 4128, types: ["Undeveloped Land", "Homesite"] });
  assert.deepEqual(labels, ["Undeveloped Land", "Homesite"]);
  const html = `<script id="__SERVER_STATE__" type="application/json">${JSON.stringify({
    searchCriteria: { ownerFinancing: true },
    searchPage: {
      searchResults: {
        totalCount: 1,
        propertyResults: [{
          id: 7,
          title: "Creek tract",
          price: 45000,
          acres: 12,
          latitude: 35.4,
          longitude: -94.4,
          city: "Hackett",
          county: "Sebastian County",
          stateAbbreviation: "AR",
          canonicalUrl: "/example",
          propertyTypes: 4128,
          types: ["Undeveloped Land"],
          executiveSummary: "",
        }],
      },
    },
  })}</script>`;
  const page = parseMarketplacePage(html, "https://www.landwatch.com");
  assert.equal(page.listings[0].propertyType, "Undeveloped Land");
  assert.equal(page.listings[0].financingAssertion, "catalog_tagged");
});
