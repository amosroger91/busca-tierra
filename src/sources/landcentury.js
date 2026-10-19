import { interpretPrice, parseTermHints } from "../money.js";
import { classifyFinancing, parseAcres } from "../signals.js";
import { normalizeState } from "../geocode.js";

const DEALS_PAGE = "https://www.landcentury.com/owner-finance-deals";

export function listingFromProperty(property) {
  const terms = String(property.ownerFinanceTerms || "").replace(/\s+/g, " ").trim();
  const hints = parseTermHints(terms);
  const financing = classifyFinancing(`${property.name || ""}\n${terms}`);
  const assertion = financing.assertion === "explicit_offer" || hints.down || hints.monthly
    ? "explicit_offer"
    : "catalog_tagged";
  const acres = parseAcres(property.name || "");
  const state = normalizeState(property.stateRegion || "");
  const slug = property.slug || "";
  const statePath = String(property.stateRegion || "arkansas").trim().toLowerCase().replace(/\s+/g, "-");
  const latitude = Number(property.lat);
  const longitude = Number(property.lng);
  return {
    source: "landcentury",
    sourceId: String(property.id || slug),
    title: String(property.name || "").replace(/\s+/g, " ").trim(),
    price: interpretPrice(property.cashPrice, { ...hints, acres }),
    acres,
    financingSignal: assertion === "explicit_offer" ? financing.label || "owner financing" : "owner financing",
    financingAssertion: assertion,
    financingEvidence: financing.evidence || (assertion === "catalog_tagged" ? "Land Century owner-finance catalog" : terms),
    financingTerms: terms,
    address: String(property.street || "").trim(),
    city: String(property.city || "").trim(),
    county: String(property.county || "").replace(/\s+County$/i, "").trim(),
    state,
    zip: String(property.zip || "").trim(),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    propertyType: property.type || "land",
    url: slug ? `https://www.landcentury.com/land-for-sale/${statePath}/${slug}` : DEALS_PAGE,
    listedAt: property.created_at || "",
  };
}

export async function searchLandCentury({ http, log, inside }) {
  const home = await http.getText(DEALS_PAGE);
  const buildId = home.text.match(/"buildId":"([^"]+)"/)?.[1];
  if (!buildId) {
    return {
      id: "landcentury",
      status: "error",
      requests: 1,
      scanned: 0,
      listings: [],
      notes: `Owner-finance page returned HTTP ${home.status} and no build id.`,
    };
  }

  const listings = [];
  let scanned = 0;
  let page = 1;
  let total = Infinity;
  let requests = 1;
  while (scanned < total && page <= 40) {
    const url = `https://www.landcentury.com/_next/data/${buildId}/owner-finance-deals.json?page=${page}&limit=100`;
    const result = await http.getJson(url);
    requests += 1;
    const data = result.data?.pageProps?.data;
    if (!data?.properties?.length) break;
    total = Number(data.total) || data.properties.length;
    scanned += data.properties.length;
    let keptOnPage = 0;
    for (const property of data.properties) {
      if (!property.isOwnerFinance && !property.ownerFinanceTerms) continue;
      const listing = listingFromProperty(property);
      if (listing.latitude == null || listing.longitude == null) continue;
      if (!inside(listing.latitude, listing.longitude)) continue;
      listings.push(listing);
      keptOnPage += 1;
    }
    log(`landcentury page ${page}: ${data.properties.length} deals, ${keptOnPage} inside the radius`);
    if (data.properties.length < 100) break;
    page += 1;
  }

  return {
    id: "landcentury",
    status: "complete",
    requests,
    scanned,
    listings,
    notes: "Owner-finance catalog at landcentury.com/owner-finance-deals. Prices are interpreted from the published terms when the feed mixes cents and dollars.",
  };
}
