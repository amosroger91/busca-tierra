import { decodeEntities, htmlToText } from "../html.js";
import { extractTerms, parseAcres } from "../signals.js";
import { normalizeState } from "../geocode.js";

const STATES = [
  ["arkansas", "AR"],
  ["oklahoma", "OK"],
];

export function parseLandmodoPage(html) {
  const pins = new Map();
  for (const match of String(html || "").matchAll(
    /data-lat="(-?\d+(?:\.\d+)?)"\s+data-lng="(-?\d+(?:\.\d+)?)"\s+data-name="([^"]*)"\s+data-filename="([^"]+)"/g
  )) {
    pins.set(match[4].replace(/^\//, ""), {
      latitude: Number(match[1]),
      longitude: Number(match[2]),
      name: decodeEntities(match[3]),
    });
  }

  const listings = [];
  const blocks = String(html || "").split('class="search_result row-fluid');
  for (const block of blocks.slice(1)) {
    const href = block.match(/href="(\/properties\/\d+\/[^"]+)"/)?.[1];
    if (!href) continue;
    const id = href.match(/\/properties\/(\d+)/)?.[1];
    const title = decodeEntities(
      block.match(/<a class="h3[^"]*"[^>]*>\s*([^<]+)/)?.[1] || ""
    ).replace(/\s+/g, " ").trim();
    const price = block.match(/\$\s?([\d,]+\.\d{2})/)?.[1];
    const place = decodeEntities(
      block.match(/post-location-snippet[\s\S]*?<\/i>\s*([^<]+)/)?.[1] || ""
    ).replace(/\s+/g, " ").trim();
    const placeMatch = place.match(/^(.*?),\s*([A-Z]{2})\s+(\d{5})?/);
    const excerpt = htmlToText(block.match(/<p class="bpad[\s\S]*?<\/p>/)?.[0] || "");
    const pin = pins.get(href.replace(/^\//, ""));
    listings.push({
      source: "landmodo",
      sourceId: id || href,
      title: title || pin?.name || "",
      price: price ? Number(price.replace(/,/g, "")) : null,
      acres: parseAcres(`${title} ${excerpt}`),
      financingSignal: "owner financing",
      financingTerms: extractTerms(excerpt),
      address: "",
      city: placeMatch?.[1]?.trim() || "",
      county: "",
      state: normalizeState(placeMatch?.[2] || ""),
      zip: placeMatch?.[3] || "",
      latitude: pin?.latitude ?? null,
      longitude: pin?.longitude ?? null,
      propertyType: "land",
      url: `https://www.landmodo.com${href}`,
      listedAt: "",
      excerpt,
    });
  }
  const pageNumbers = [...String(html).matchAll(/[?&]page=(\d+)/g)].map((match) => Number(match[1]));
  return { listings, maxPage: Math.max(1, ...pageNumbers, 1) };
}

export async function searchLandmodo({ http, log, inside }) {
  const listings = [];
  const seen = new Set();
  let requests = 0;
  let scanned = 0;
  const notes = [];

  for (const [state, abbreviation] of STATES) {
    const base = `https://www.landmodo.com/properties/${state}`;
    const first = await http.getText(base);
    requests += 1;
    if (first.status !== 200) {
      notes.push(`${abbreviation} HTTP ${first.status}`);
      continue;
    }
    const parsed = parseLandmodoPage(first.text);
    const maxPage = Math.min(parsed.maxPage, 30);
    const take = (pageListings) => {
      let fresh = 0;
      let kept = 0;
      for (const listing of pageListings) {
        if (seen.has(listing.sourceId)) continue;
        seen.add(listing.sourceId);
        fresh += 1;
        scanned += 1;
        if (listing.latitude == null || !inside(listing.latitude, listing.longitude)) continue;
        if (!listing.state) listing.state = abbreviation;
        listings.push(listing);
        kept += 1;
      }
      return { fresh, kept };
    };
    let kept = take(parsed.listings).kept;
    for (let page = 2; page <= maxPage; page += 1) {
      const result = await http.getText(`${base}?page=${page}`);
      requests += 1;
      if (result.status !== 200) break;
      const next = parseLandmodoPage(result.text);
      if (!next.listings.length) break;
      const batch = take(next.listings);
      kept += batch.kept;
      if (!batch.fresh) break;
    }
    log(`landmodo ${abbreviation}: ${scanned} scanned so far, ${kept} inside the radius on this state`);
  }

  return {
    id: "landmodo",
    status: scanned ? "ok" : "blocked",
    requests,
    scanned,
    listings,
    notes: notes.join("; ") || "Landmodo is an owner-financed land catalog. Arkansas and Oklahoma pages were filtered to the radius.",
  };
}
