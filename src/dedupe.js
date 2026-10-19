import { milesBetween } from "./geo.js";

const STOP = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "in", "on", "at", "to",
  "sale", "acres", "acre", "land", "property", "owner", "finance", "financing",
  "financed", "seller", "beautiful", "available", "near", "county",
]);

export function normalizeAddress(address) {
  return String(address || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\broad\b/g, "rd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\blane\b/g, "ln")
    .replace(/\bcourt\b/g, "ct")
    .replace(/\bhighway\b/g, "hwy")
    .replace(/\bnorth\b/g, "n")
    .replace(/\bsouth\b/g, "s")
    .replace(/\beast\b/g, "e")
    .replace(/\bwest\b/g, "w")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !STOP.has(token))
  );
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

function pricesClose(left, right) {
  if (left == null || right == null) return true;
  const high = Math.max(left, right);
  if (high === 0) return true;
  return Math.abs(left - right) / high <= 0.15;
}

function cityOf(listing) {
  return String(listing.city || "").trim().toLowerCase();
}

function citiesConflict(left, right) {
  const leftCity = cityOf(left);
  const rightCity = cityOf(right);
  return Boolean(leftCity && rightCity && leftCity !== rightCity);
}

function lotNumber(listing) {
  const match = `${listing.address || ""} ${listing.title || ""}`.match(/\b(?:lot|tract)\s*#?\s*(\d+[a-z]?)\b/i);
  return match ? match[1].toLowerCase() : "";
}

const GENERIC_TITLE = new Set(["vacant", "undeveloped", "homesite", "lot", "tract", "residential", "commercial"]);

function distinctiveTokens(listing) {
  const cityTokens = new Set(cityOf(listing).split(/\s+/).filter(Boolean));
  return [...tokens(listing.title)].filter((token) => !cityTokens.has(token) && !GENERIC_TITLE.has(token));
}

function samePlace(left, right) {
  if (citiesConflict(left, right)) return false;
  const leftLot = lotNumber(left);
  const rightLot = lotNumber(right);
  if (leftLot && rightLot && leftLot !== rightLot) return false;

  const addressLeft = normalizeAddress(left.address);
  const addressRight = normalizeAddress(right.address);
  if (addressLeft.length >= 8 && addressRight.length >= 8 && addressLeft !== addressRight) return false;
  if (addressLeft.length >= 8 && addressLeft === addressRight) return true;

  if (
    left.latitude == null ||
    right.latitude == null ||
    left.longitude == null ||
    right.longitude == null
  ) {
    return false;
  }
  const miles = milesBetween(left.latitude, left.longitude, right.latitude, right.longitude);
  if (miles > 0.35) return false;
  if (!pricesClose(left.price, right.price)) return false;
  const overlap = jaccard(distinctiveTokens(left), distinctiveTokens(right));
  const sameShortAddress = addressLeft.length >= 5 && addressLeft === addressRight;
  if (sameShortAddress) return true;
  return overlap >= 0.5;
}

function richness(listing) {
  return (
    (listing.address ? 4 : 0) +
    (listing.financingTerms ? 3 : 0) +
    (listing.price ? 2 : 0) +
    (listing.acres ? 1 : 0) +
    Math.min(String(listing.title || "").length, 80) / 80
  );
}

function prefer(current, incoming) {
  const currentTime = Date.parse(current.listedAt || "") || 0;
  const incomingTime = Date.parse(incoming.listedAt || "") || 0;
  if (currentTime !== incomingTime) return incomingTime > currentTime ? incoming : current;
  return richness(incoming) > richness(current) ? incoming : current;
}

function earlierPrice(primary, secondary) {
  const current = primary.price ?? secondary.price;
  return [primary.previousPrice, secondary.previousPrice, primary.price, secondary.price]
    .find((value) => Number.isFinite(value) && value !== current) ?? null;
}

const LOCATION_RANK = {
  seller_provided_point: 4,
  address_interpolation: 3,
  listing_map_point: 2,
  locality_centroid: 1,
};

function mergePair(left, right) {
  const primary = prefer(left, right);
  const secondary = primary === left ? right : left;
  const located = (LOCATION_RANK[secondary.locationMethod] || 0) > (LOCATION_RANK[primary.locationMethod] || 0)
    ? secondary
    : primary;
  const urls = [primary.url, secondary.url, ...(primary.otherUrls || []), ...(secondary.otherUrls || [])]
    .filter(Boolean);
  const sources = [primary.source, secondary.source, ...(primary.sources || []), ...(secondary.sources || [])]
    .filter(Boolean);
  return {
    ...secondary,
    ...primary,
    price: primary.price ?? secondary.price,
    previousPrice: earlierPrice(primary, secondary),
    financingAssertion: primary.financingAssertion === "explicit_offer" || secondary.financingAssertion === "explicit_offer"
      ? "explicit_offer"
      : primary.financingAssertion || secondary.financingAssertion,
    financingEvidence: primary.financingEvidence || secondary.financingEvidence,
    acres: primary.acres ?? secondary.acres,
    acresLabel: primary.acresLabel || secondary.acresLabel || "",
    address: primary.address || secondary.address,
    city: primary.city || secondary.city,
    county: primary.county || secondary.county,
    state: primary.state || secondary.state,
    zip: primary.zip || secondary.zip,
    financingSignal: primary.financingSignal || secondary.financingSignal,
    financingTerms: primary.financingTerms || secondary.financingTerms,
    listedAt: primary.listedAt || secondary.listedAt,
    propertyType: primary.propertyType || secondary.propertyType,
    latitude: located.latitude ?? primary.latitude ?? secondary.latitude,
    longitude: located.longitude ?? primary.longitude ?? secondary.longitude,
    locationMethod: located.locationMethod || primary.locationMethod || secondary.locationMethod,
    apn: primary.apn || secondary.apn,
    url: primary.url || secondary.url,
    otherUrls: [...new Set(urls.filter((url) => url !== (primary.url || secondary.url)))],
    sources: [...new Set(sources)],
  };
}

export function dedupeListings(listings) {
  const groups = [];
  for (const listing of listings) {
    const index = groups.findIndex((group) => samePlace(group, listing));
    if (index === -1) {
      groups.push({
        ...listing,
        sources: [listing.source].filter(Boolean),
        otherUrls: [...(listing.otherUrls || [])],
      });
    } else {
      groups[index] = mergePair(groups[index], listing);
    }
  }
  return groups;
}
