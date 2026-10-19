import { CRAIGSLIST_QUERIES } from "../config.js";
import { htmlToText } from "../html.js";
import { extractTerms, findFinancingSignal, parseAcres, parseStreetAddress } from "../signals.js";
import { normalizeState } from "../geocode.js";

function searchUrl(query, radiusMiles) {
  const radius = Math.max(1, Math.ceil(radiusMiles || 40));
  return (
    "https://sapi.craigslist.org/web/v8/postings/search/full?batch=1-0-360-1-0&cc=US&lang=en" +
    `&searchPath=rea&postal=72901&search_distance=${radius}&sort=date&query=${encodeURIComponent(query)}`
  );
}

function siteSlug(locations, locHead) {
  const locIdx = Number(String(locHead || "0").split(":")[0]);
  const row = locations?.[locIdx];
  if (Array.isArray(row)) return String(row[1] || "fortsmith");
  return "fortsmith";
}

function titleOf(item) {
  for (let index = item.length - 1; index >= 0; index -= 1) {
    const part = item[index];
    if (typeof part !== "string") continue;
    if (part.includes("~")) continue;
    if (/^0[A-Za-z0-9]{3,8}$/.test(part)) continue;
    if (part.length < 6) continue;
    return part;
  }
  return "";
}

export function decodeItems(payload) {
  const data = payload?.data;
  if (!data?.decode || !Array.isArray(data.items)) return [];
  const { minPostingId, minPostedDate, locations } = data.decode;
  return data.items.map((item) => {
    const loc = String(item[4] || "").split("~");
    let slug = "";
    let priceLabel = "";
    for (const part of item) {
      if (!Array.isArray(part)) continue;
      if (part[0] === 6 && typeof part[1] === "string") slug = part[1];
      if (part[0] === 10 && typeof part[1] === "string") priceLabel = part[1];
    }
    const latitude = loc[1] == null ? null : Number(loc[1]);
    const longitude = loc[2] == null ? null : Number(loc[2]);
    const postedSeconds = Number(minPostedDate) + Number(item[1]);
    return {
      id: String(Number(minPostingId) + Number(item[0])),
      title: titleOf(item),
      price: Number.isFinite(Number(item[3])) && Number(item[3]) > 0 ? Number(item[3]) : null,
      priceLabel,
      slug,
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      site: siteSlug(locations, loc[0]),
      listedAt: Number.isFinite(postedSeconds) ? new Date(postedSeconds * 1000).toISOString() : "",
    };
  });
}

function postingUrl(item) {
  if (!item.slug) return "";
  return `https://${item.site}.craigslist.org/reo/d/${item.slug}/${item.id}.html`;
}

function listingFromPost(item, page) {
  const body = page?.text?.match(/id="postingbody"[\s\S]*?<\/section>/i);
  const bodyText = body ? htmlToText(body[0]) : "";
  const signal = findFinancingSignal(`${item.title}\n${bodyText}`);
  const located = parseStreetAddress(bodyText) || {};
  const latMatch = page?.text?.match(/data-latitude="(-?\d+(?:\.\d+)?)"/);
  const lonMatch = page?.text?.match(/data-longitude="(-?\d+(?:\.\d+)?)"/);
  const priceMatch = page?.text?.match(/class="price"[^>]*>\s*\$?([\d,]+)/i);
  const price = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : item.price;
  return {
    source: "craigslist",
    sourceId: item.id,
    title: item.title,
    price: Number.isFinite(price) ? price : item.price,
    acres: parseAcres(`${item.title} ${bodyText}`),
    financingSignal: signal || "",
    financingTerms: extractTerms(bodyText),
    address: located.address || "",
    city: located.city || "",
    county: "",
    state: normalizeState(located.state || ""),
    zip: located.zip || "",
    latitude: latMatch ? Number(latMatch[1]) : item.latitude,
    longitude: lonMatch ? Number(lonMatch[1]) : item.longitude,
    propertyType: "real estate",
    url: page?.url || postingUrl(item),
    listedAt: item.listedAt,
    kept: Boolean(signal),
  };
}

export async function searchCraigslist({ http, log, inside, radiusMiles }) {
  const byId = new Map();
  let requests = 0;
  for (const query of CRAIGSLIST_QUERIES) {
    const url = searchUrl(query, radiusMiles);
    const result = await http.getJson(url);
    requests += 1;
    if (!result.data) {
      log(`craigslist query "${query}" returned HTTP ${result.status}`);
      continue;
    }
    const items = decodeItems(result.data).filter(
      (item) => item.latitude != null && inside(item.latitude, item.longitude)
    );
    log(`craigslist "${query}": ${items.length} inside the radius`);
    for (const item of items) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  }

  const listings = [];
  for (const item of byId.values()) {
    const url = postingUrl(item);
    let page = null;
    if (url) {
      page = await http.getText(url);
      requests += 1;
    }
    const listing = listingFromPost(item, page);
    if (listing.kept) listings.push(listing);
  }
  return {
    id: "craigslist",
    status: "ok",
    requests,
    scanned: byId.size,
    listings,
    notes: "Fort Smith board search on sapi.craigslist.org, postal 72901, 40 miles. Post bodies confirm the financing phrase.",
  };
}
