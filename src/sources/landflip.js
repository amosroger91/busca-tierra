import { LANDFLIP_COUNTIES } from "../config.js";
import { htmlToText, decodeEntities } from "../html.js";
import { extractTerms, findFinancingSignal, parseAcres } from "../signals.js";
import { normalizeState } from "../geocode.js";

const ARTICLE = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi;

function attr(tag, name) {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match ? decodeEntities(match[1]) : "";
}

export function parseListHtml(html) {
  const listings = [];
  for (const match of String(html || "").matchAll(ARTICLE)) {
    const [, tag, body] = match;
    const path = attr(tag, "data-url");
    if (!path.startsWith("/land/")) continue;
    const alt = attr(body, "alt");
    const parts = alt.split(/\s+:\s+/).map((part) => part.trim()).filter(Boolean);
    let title = alt;
    let city = "";
    let county = "";
    let state = "";
    if (parts.length >= 4) {
      state = parts[parts.length - 1];
      county = parts[parts.length - 2].replace(/\s+County$/i, "");
      city = parts[parts.length - 3];
      title = parts.slice(0, parts.length - 3).join(": ");
    }
    const excerpt = htmlToText(body.match(/<p class="excerpt">([\s\S]*?)<\/p>/i)?.[1] || "");
    const priceText = htmlToText(body.match(/class="tag price-ac"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
    const priceMatch = priceText.match(/\$\s?([\d,]+)/);
    const id = path.match(/\/land\/(\d+)/)?.[1] || path;
    listings.push({
      source: "landflip",
      sourceId: id,
      title: title || excerpt.slice(0, 120),
      price: priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null,
      acres: parseAcres(`${priceText} ${excerpt} ${title}`),
      financingSignal: findFinancingSignal(`${title} ${excerpt}`) || "",
      financingTerms: extractTerms(excerpt),
      address: "",
      city,
      county,
      state: normalizeState(state),
      zip: "",
      latitude: null,
      longitude: null,
      propertyType: "land",
      url: `https://www.landflip.com${path}`,
      listedAt: "",
      excerpt,
    });
  }
  return listings;
}

function detailText(html) {
  const cleaned = String(html || "")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<fieldset[\s\S]*?<\/fieldset>/gi, " ");
  return htmlToText(cleaned);
}

export function parseDetail(html, card) {
  const text = detailText(html);
  const signal = findFinancingSignal(`${card.title}\n${card.excerpt}\n${text}`);
  const coord = String(html || "").match(
    /new google\.maps\.LatLng\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/
  );
  const priceMatch = text.match(/\$\s?([\d,]{3,})/);
  return {
    ...card,
    financingSignal: signal || "",
    financingTerms: card.financingTerms || extractTerms(text),
    acres: card.acres ?? parseAcres(text),
    price: card.price ?? (priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : null),
    latitude: coord ? Number(coord[1]) : null,
    longitude: coord ? Number(coord[2]) : null,
  };
}

async function countyCards(http, base) {
  const cards = [];
  const seen = new Set();
  let requests = 0;
  for (let page = 1; page <= 20; page += 1) {
    const url = page === 1
      ? `https://www.landflip.com${base}`
      : `https://www.landflip.com${base}/${page}-p`;
    const result = await http.getText(url);
    requests += 1;
    if (result.status !== 200) break;
    const found = parseListHtml(result.text).filter((card) => !seen.has(card.sourceId));
    if (!found.length) break;
    for (const card of found) seen.add(card.sourceId);
    cards.push(...found);
  }
  return { cards, requests };
}

export async function searchLandflip({ http, geocode, log, inside }) {
  const listings = [];
  const seen = new Set();
  let requests = 0;
  let scanned = 0;
  const notes = [];

  for (const [state, county] of LANDFLIP_COUNTIES) {
    const base = `/land-for-sale/${state}/${county}`;
    try {
      const collected = await countyCards(http, base);
      requests += collected.requests;
      if (!collected.cards.length) {
        notes.push(`${county} had no listings`);
        continue;
      }
      scanned += collected.cards.length;
      log(`landflip ${county}: ${collected.cards.length} cards`);

      for (const card of collected.cards) {
        if (seen.has(card.sourceId)) continue;
        seen.add(card.sourceId);
        const place = await geocode.geocode({
          city: card.city,
          county: card.county,
          state: card.state,
        });
        if (place && !inside(place.latitude, place.longitude, 15)) continue;
        const detail = await http.getText(card.url);
        requests += 1;
        if (detail.status !== 200) continue;
        const listing = parseDetail(detail.text, card);
        if (!listing.financingSignal) continue;
        if (listing.latitude == null && place) {
          listing.latitude = place.latitude;
          listing.longitude = place.longitude;
        }
        if (listing.latitude == null || !inside(listing.latitude, listing.longitude)) continue;
        listings.push(listing);
      }
    } catch (error) {
      notes.push(`${county} failed: ${error.message}`);
    }
  }

  return {
    id: "landflip",
    status: "ok",
    requests,
    scanned,
    listings,
    notes: `County pages that reach the search circle. ${notes.join("; ")}`.trim(),
  };
}
