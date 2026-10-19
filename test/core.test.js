import assert from "node:assert/strict";
import test from "node:test";
import { dedupeListings } from "../src/dedupe.js";
import { milesBetween } from "../src/geo.js";
import { interpretPrice } from "../src/money.js";
import { decodeItems } from "../src/sources/craigslist.js";
import { parseMarketplacePage } from "../src/sources/costar.js";
import { parseDetail, parseListHtml } from "../src/sources/landflip.js";
import { parseLandmodoPage } from "../src/sources/landmodo.js";
import { extractTerms, findFinancingSignal, parseStreetAddress } from "../src/signals.js";

const FORT_SMITH = { latitude: 35.38592, longitude: -94.39855 };

test("one degree of latitude is about 69 miles", () => {
  const miles = milesBetween(FORT_SMITH.latitude, FORT_SMITH.longitude, FORT_SMITH.latitude + 1, FORT_SMITH.longitude);
  assert.ok(Math.abs(miles - 69) < 0.6);
});

test("Pocola is inside a 40 mile circle and a degree east is not", () => {
  const pocola = milesBetween(FORT_SMITH.latitude, FORT_SMITH.longitude, 35.2436, -94.476);
  assert.ok(pocola > 9 && pocola < 13);
  const east = milesBetween(FORT_SMITH.latitude, FORT_SMITH.longitude, 35.38592, -93.2);
  assert.ok(east > 40);
});

test("financing phrases are specific and negations do not match", () => {
  assert.equal(findFinancingSignal("Owner financing available, $2,000 down"), "owner financing");
  assert.equal(findFinancingSignal("Seller will carry the note"), "seller will carry");
  assert.equal(findFinancingSignal("Contract for deed with 10% down"), "contract for deed");
  assert.equal(findFinancingSignal("no owner financing"), null);
  assert.equal(findFinancingSignal("This pasture will carry 20 head"), null);
  assert.equal(findFinancingSignal("conventional financing and FHA welcome"), null);
  assert.equal(findFinancingSignal("homeowner financing through a bank"), null);
});

test("terms and street addresses are pulled from a posting", () => {
  const text = "Address: 901 C West McKenzie Ave, Pocola, OK 74902. $2,000 down. Payment approx. $640/month. OWNER WILL FINANCE.";
  assert.match(extractTerms(text), /\$2,000 down/);
  assert.match(extractTerms(text), /\$640\/month/);
  assert.deepEqual(parseStreetAddress(text), {
    address: "901 C West McKenzie Ave",
    city: "Pocola",
    state: "OK",
    zip: "74902",
  });
  const barling = "Contract for Deed -- $2,500.00 Down 2 Bedroom / 2 Bathroom 955 sq ft 2207 K St, Barling, AR 72923";
  assert.equal(parseStreetAddress(barling).address, "2207 K St");
});

test("cents are used when they match the published payoff", () => {
  assert.equal(interpretPrice(445500, { monthly: 99, months: 45, down: 0 }), 4455);
  assert.equal(interpretPrice(208000, { monthly: 99, months: 20, down: 100 }), 2080);
  assert.equal(interpretPrice(22500, { monthly: 225, months: 69, down: 225 }), 22500);
});

test("the same tract on two sites becomes one row", () => {
  const rows = dedupeListings([
    {
      source: "craigslist",
      title: "30 acres owner finance Natural Dam",
      price: 199000,
      address: "Highway 59",
      city: "Natural Dam",
      state: "AR",
      latitude: 35.6743,
      longitude: -94.4124,
      url: "https://craigslist.example/1",
      financingSignal: "owner financing",
    },
    {
      source: "landflip",
      title: "30 acres with owner financing near Natural Dam",
      price: 199000,
      address: "Highway 59",
      city: "Natural Dam",
      state: "AR",
      latitude: 35.6744,
      longitude: -94.4125,
      url: "https://landflip.example/2",
      financingTerms: "$30,000 down",
    },
    {
      source: "landcentury",
      title: "Lot in Holbrook",
      price: 5000,
      city: "Holbrook",
      state: "AZ",
      latitude: 34.9,
      longitude: -110.1,
      url: "https://landcentury.example/3",
    },
  ]);
  assert.equal(rows.length, 2);
  const naturalDam = rows.find((row) => row.city === "Natural Dam");
  assert.deepEqual(naturalDam.sources.sort(), ["craigslist", "landflip"]);
  assert.equal(naturalDam.financingTerms, "$30,000 down");
  assert.equal(naturalDam.otherUrls.length, 1);
});

test("different street addresses stay separate when a site repeats one pin", () => {
  const shared = {
    source: "landwatch",
    title: "Vacant Land, Cookson, OK",
    city: "Cookson",
    state: "OK",
    latitude: 35.67434,
    longitude: -94.93977,
    financingSignal: "owner financing",
  };
  const rows = dedupeListings([
    { ...shared, price: 35000, address: "20506 S Chicken Creek Road", url: "https://www.landwatch.com/a" },
    { ...shared, source: "landandfarm", price: 35000, address: "20506 S Chicken Creek Road", url: "https://www.landandfarm.com/a" },
    { ...shared, price: 35000, address: "20508 S Chicken Creek Road", url: "https://www.landwatch.com/b" },
  ]);
  assert.equal(rows.length, 2);
  const first = rows.find((row) => row.address.includes("20506"));
  assert.deepEqual(first.sources.sort(), ["landandfarm", "landwatch"]);
});

test("craigslist compact rows decode to a posting", () => {
  const [item] = decodeItems({
    data: {
      decode: {
        minPostingId: 7961238405,
        minPostedDate: 1790026427,
        locations: [0, [358, "fortsmith"]],
      },
      items: [[
        4905324,
        2061043,
        143,
        57900,
        "1:1~35.2436~-94.4760",
        "0kA0sg",
        [6, "pocola-owner-financed"],
        [10, "$57,900"],
        "Land/Home in Le Flore Co For Sale Owner Financed",
      ]],
    },
  });
  assert.equal(item.id, "7966143729");
  assert.equal(item.site, "fortsmith");
  assert.equal(item.latitude, 35.2436);
  assert.equal(item.price, 57900);
  assert.match(item.title, /Owner Financed/);
});

test("landflip cards keep a financing excerpt and ignore the filter chrome", () => {
  const html = `
    <article class="list-block" data-url="/land/424198">
      <img alt="5 Wooded Acres : Hackett : Sebastian County : Arkansas">
      <p class="excerpt">Owner financing at $500 down.</p>
      <span class="tag price-ac">5 Acre : $12,000</span>
    </article>`;
  const [card] = parseListHtml(html);
  assert.equal(card.city, "Hackett");
  assert.equal(card.state, "AR");
  assert.equal(card.price, 12000);
  assert.equal(card.financingSignal, "owner financing");

  const chromeOnly = `<fieldset><span>owner finance</span></fieldset><p>Wooded homesite on a paved road.</p>`;
  assert.equal(parseDetail(chromeOnly, { title: "Wooded homesite", excerpt: "", financingTerms: "" }).financingSignal, "");

  const real = `<fieldset><span>owner finance</span></fieldset><p>Owner financing: $150 down and $150 per month for 35 months.</p>
    <script>new google.maps.LatLng(35.1901, -94.4102)</script>`;
  const detailed = parseDetail(real, { title: "Hackett tract", excerpt: "", financingTerms: "", price: 5400 });
  assert.equal(detailed.financingSignal, "owner financing");
  assert.equal(detailed.latitude, 35.1901);
  assert.match(detailed.financingTerms, /\$150 down/);
});

test("marketplace pages keep owner-financing pins and prices in dollars", () => {
  const html = `<script id="__SERVER_STATE__" type="application/json">${JSON.stringify({
    searchCriteria: { ownerFinancing: true },
    searchPage: {
      searchResults: {
        totalCount: 1,
        propertyResults: [{
          id: 42,
          title: "Creek tract",
          price: 45000,
          acres: 12,
          latitude: 35.4,
          longitude: -94.4,
          city: "Hackett",
          county: "Sebastian County",
          stateAbbreviation: "AR",
          canonicalUrl: "/sebastian-county-arkansas-land-for-sale/pid/42",
          executiveSummary: "$500 down",
          propertyTypes: ["Recreational"],
        }],
      },
    },
  })}</script>`;
  const page = parseMarketplacePage(html, "https://www.landwatch.com");
  assert.equal(page.ownerFinancing, true);
  assert.equal(page.listings[0].price, 45000);
  assert.equal(page.listings[0].county, "Sebastian");
  assert.equal(page.listings[0].financingSignal, "owner financing");
  assert.equal(page.listings[0].url, "https://www.landwatch.com/sebastian-county-arkansas-land-for-sale/pid/42");
});

test("landmodo cards join the map pin and stay owner financed", () => {
  const html = `
    <div data-lat="35.2436" data-lng="-94.4760" data-name="Pocola lot" data-filename="properties/99/pocola-ok-74902/pocola-lot"></div>
    <div class="search_result row-fluid">
      <a href="/properties/99/pocola-ok-74902/pocola-lot"></a>
      <a class="h3 title">Pocola acre</a>
      <div class="bg-secondary">$12,500.00</div>
      <span class="post-location-snippet"><i></i> Pocola, OK 74902</span>
      <p class="bpad">1 acre. $200 down and $150 per month.</p>
    </div>`;
  const page = parseLandmodoPage(html);
  assert.equal(page.listings.length, 1);
  assert.equal(page.listings[0].price, 12500);
  assert.equal(page.listings[0].city, "Pocola");
  assert.equal(page.listings[0].latitude, 35.2436);
  assert.equal(page.listings[0].financingSignal, "owner financing");
  assert.match(page.listings[0].financingTerms, /\$200 down/);
});
