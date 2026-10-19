import { extractTerms, findFinancingSignal, parseAcres } from "../signals.js";
import { normalizeState } from "../geocode.js";

const CATALOGS = [
  {
    id: "landwatch",
    origin: "https://www.landwatch.com",
    paths: [
      "/arkansas-land-for-sale/owner-financing",
      "/oklahoma-land-for-sale/owner-financing",
    ],
  },
  {
    id: "landandfarm",
    origin: "https://www.landandfarm.com",
    paths: [
      "/search/arkansas-land-for-sale/owner-financing",
      "/search/oklahoma-land-for-sale/owner-financing",
    ],
  },
];

export function parseMarketplacePage(html, origin) {
  const match = String(html || "").match(
    /<script id="__SERVER_STATE__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  let state;
  try {
    state = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const search = state.searchPage?.searchResults;
  if (!search) return null;
  const ownerFinancing = Boolean(state.searchCriteria?.ownerFinancing);
  const listings = (search.propertyResults || []).map((property) => {
    const summary = String(property.executiveSummary || "");
    const title = String(property.title || "").trim();
    const signal = ownerFinancing
      ? "owner financing"
      : findFinancingSignal(`${title}\n${summary}`);
    return {
      source: origin.includes("landandfarm") ? "landandfarm" : "landwatch",
      sourceId: String(property.id || property.siteListingId || ""),
      title,
      price: Number(property.price) > 0 ? Number(property.price) : null,
      acres: Number(property.acres) > 0 ? Number(property.acres) : parseAcres(title),
      financingSignal: signal || "",
      financingTerms: extractTerms(summary),
      address: String(property.address || "").trim(),
      city: String(property.city || "").trim(),
      county: String(property.county || "").replace(/\s+County$/i, "").trim(),
      state: normalizeState(property.stateAbbreviation || property.state),
      zip: String(property.zip || "").trim(),
      latitude: Number.isFinite(Number(property.latitude)) ? Number(property.latitude) : null,
      longitude: Number.isFinite(Number(property.longitude)) ? Number(property.longitude) : null,
      propertyType: Array.isArray(property.propertyTypes) ? property.propertyTypes.join(", ") : "land",
      url: property.canonicalUrl ? `${origin}${property.canonicalUrl}` : origin,
      listedAt: property.lastUpdated || "",
    };
  });
  return {
    ownerFinancing,
    total: Number(search.totalCount) || listings.length,
    pageIndex: Number.isFinite(Number(state.searchCriteria?.pageIndex))
      ? Number(state.searchCriteria.pageIndex)
      : null,
    listings,
  };
}

function pageUrl(origin, basePath, page) {
  const path = basePath.replace(/\/$/, "");
  return page === 1 ? `${origin}${path}` : `${origin}${path}/page-${page}`;
}

async function searchCatalog(catalog, { http, log, inside }) {
  const listings = [];
  const seen = new Set();
  let requests = 0;
  let scanned = 0;
  let blocked = 0;
  const notes = [];

  for (const basePath of catalog.paths) {
    const firstUrl = pageUrl(catalog.origin, basePath, 1);
    const first = await http.getText(firstUrl);
    requests += 1;
    const parsed = first.status === 200 ? parseMarketplacePage(first.text, catalog.origin) : null;
    if (!parsed) {
      blocked += 1;
      notes.push(`${basePath} HTTP ${first.status}`);
      continue;
    }
    const pageCount = Math.min(80, Math.max(1, Math.ceil(parsed.total / Math.max(parsed.listings.length, 1))));
    const take = (page) => {
      let fresh = 0;
      let kept = 0;
      for (const listing of page.listings) {
        if (!listing.sourceId || seen.has(listing.sourceId)) continue;
        seen.add(listing.sourceId);
        fresh += 1;
        scanned += 1;
        if (!listing.financingSignal) continue;
        if (listing.latitude == null || !inside(listing.latitude, listing.longitude)) continue;
        listings.push({ ...listing, source: catalog.id });
        kept += 1;
      }
      return { fresh, kept };
    };
    let kept = take(parsed).kept;
    for (let page = 2; page <= pageCount; page += 1) {
      const result = await http.getText(pageUrl(catalog.origin, basePath, page));
      requests += 1;
      const next = result.status === 200 ? parseMarketplacePage(result.text, catalog.origin) : null;
      if (!next?.listings.length) break;
      const batch = take(next);
      kept += batch.kept;
      if (next.pageIndex != null && next.pageIndex < page - 1) break;
    }
    log(`${catalog.id} ${basePath}: ${parsed.total} listed, ${kept} inside the radius`);
  }

  const status = listings.length || scanned ? "ok" : blocked === catalog.paths.length ? "blocked" : "empty";
  return {
    id: catalog.id,
    status,
    requests,
    scanned,
    listings,
    notes: notes.join("; ") || `${catalog.origin} owner-financing search for Arkansas and Oklahoma.`,
  };
}

export async function searchLandWatch(context) {
  return searchCatalog(CATALOGS[0], context);
}

export async function searchLandAndFarm(context) {
  return searchCatalog(CATALOGS[1], context);
}
