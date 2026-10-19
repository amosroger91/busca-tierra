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

function samePlace(left, right) {
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
  const overlap = jaccard(tokens(left.title), tokens(right.title));
  const sameCity =
    left.city &&
    right.city &&
    left.city.toLowerCase() === right.city.toLowerCase();
  return overlap >= 0.34 || (sameCity && overlap >= 0.2) || addressLeft.length >= 8;
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
  return richness(incoming) > richness(current) ? incoming : current;
}

function mergePair(left, right) {
  const primary = prefer(left, right);
  const secondary = primary === left ? right : left;
  const urls = [primary.url, secondary.url, ...(primary.otherUrls || []), ...(secondary.otherUrls || [])]
    .filter(Boolean);
  const sources = [primary.source, secondary.source, ...(primary.sources || []), ...(secondary.sources || [])]
    .filter(Boolean);
  return {
    ...secondary,
    ...primary,
    price: primary.price ?? secondary.price,
    acres: primary.acres ?? secondary.acres,
    address: primary.address || secondary.address,
    city: primary.city || secondary.city,
    county: primary.county || secondary.county,
    state: primary.state || secondary.state,
    zip: primary.zip || secondary.zip,
    financingSignal: primary.financingSignal || secondary.financingSignal,
    financingTerms: primary.financingTerms || secondary.financingTerms,
    listedAt: primary.listedAt || secondary.listedAt,
    propertyType: primary.propertyType || secondary.propertyType,
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
