import { LANDHUB_SEARCHES } from "../config.js";
import { htmlToText } from "../html.js";
import { extractTerms, findFinancingSignal, parseAcres } from "../signals.js";
import { normalizeState } from "../geocode.js";

function nextData(html) {
  const match = String(html || "").match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function parseSearchPage(html) {
  const data = nextData(html);
  const rows = data?.props?.pageProps?.dataFromServer;
  if (!Array.isArray(rows)) return { listings: [], maxPage: 1 };
  const links = new Map();
  for (const match of String(html).matchAll(/\/property\/([a-z0-9-]+)-(\d+)\b/gi)) {
    links.set(match[2], `/property/${match[1]}-${match[2]}`);
  }
  const pageNumbers = [...String(html).matchAll(/[?&]page=(\d+)/g)].map((match) => Number(match[1]));
  const listings = rows.map((row) => {
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    const id = String(row.id);
    return {
      source: "landhub",
      sourceId: id,
      title: String(row.title || "").replace(/\s+/g, " ").trim(),
      price: Number(row.price) > 0 ? Number(row.price) : null,
      acres: Number(row.acres) > 0 ? Number(row.acres) : parseAcres(row.title),
      financingSignal: "",
      financingTerms: "",
      address: String(row.street_address || row.address || "").trim(),
      city: String(row.city || "").trim(),
      county: String(row.county || "").replace(/\s+County$/i, "").trim(),
      state: normalizeState(row.state),
      zip: String(row.zipcode || "").trim(),
      latitude: Number.isFinite(latitude) ? latitude : null,
      longitude: Number.isFinite(longitude) ? longitude : null,
      propertyType: row.property_type || row.category || "land",
      url: links.has(id) ? `https://www.landhub.com${links.get(id)}` : "",
      listedAt: row.created_at || "",
    };
  });
  return {
    listings,
    maxPage: Math.max(1, ...pageNumbers, 1),
  };
}

export function parseDetailPage(html, card) {
  const data = nextData(html);
  const property = data?.props?.pageProps;
  const description = htmlToText(property?.description || "");
  const features = htmlToText(
    typeof property?.features === "string" ? property.features : JSON.stringify(property?.features || "")
  );
  const text = [card.title, description, features, property?.directions || ""].join("\n");
  const signal = findFinancingSignal(text);
  return {
    ...card,
    title: property?.title || card.title,
    price: Number(property?.price) > 0 ? Number(property.price) : card.price,
    acres: Number(property?.acres) > 0 ? Number(property.acres) : card.acres,
    address: property?.street_address || card.address,
    financingSignal: signal || "",
    financingTerms: extractTerms(description),
    url: card.url,
  };
}

export async function searchLandhub({ http, log, inside }) {
  const listings = [];
  const seen = new Set();
  let requests = 0;
  let scanned = 0;

  for (const base of LANDHUB_SEARCHES) {
    const first = await http.getText(base);
    requests += 1;
    if (first.status !== 200) {
      log(`landhub ${base} HTTP ${first.status}`);
      continue;
    }
    const parsed = parseSearchPage(first.text);
    const maxPage = Math.min(parsed.maxPage, 180);
    const seenIds = new Set(parsed.listings.map((row) => row.sourceId));
    const rows = [...parsed.listings];
    for (let page = 2; page <= maxPage; page += 1) {
      const result = await http.getText(`${base}?page=${page}`);
      requests += 1;
      if (result.status !== 200) break;
      const next = parseSearchPage(result.text);
      const fresh = next.listings.filter((row) => !seenIds.has(row.sourceId));
      if (!fresh.length) break;
      for (const row of fresh) seenIds.add(row.sourceId);
      rows.push(...fresh);
      if (page % 20 === 0) log(`landhub ${base} page ${page}/${maxPage}, ${rows.length} listings`);
    }
    scanned += rows.length;
    log(`landhub ${base}: ${rows.length} listings, ${maxPage} pages`);

    for (const card of rows) {
      if (seen.has(card.sourceId)) continue;
      seen.add(card.sourceId);
      if (card.latitude == null || !inside(card.latitude, card.longitude)) continue;
      if (!card.url) continue;
      const detail = await http.getText(card.url);
      requests += 1;
      if (detail.status !== 200) continue;
      const listing = parseDetailPage(detail.text, card);
      if (!listing.financingSignal) continue;
      listings.push(listing);
    }
  }

  return {
    id: "landhub",
    status: "ok",
    requests,
    scanned,
    listings,
    notes: "Arkansas and Oklahoma list pages, then detail pages for pins inside the radius. Financing has to be in the property description.",
  };
}
