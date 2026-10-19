import { LANDFLIP_COUNTIES } from "../config.js";
import { htmlToText, decodeEntities } from "../html.js";
import { classifyFinancing, extractTerms, findFinancingSignal, parseAcres, parseAcreage } from "../signals.js";
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
    const downInTitle = /\$\s?[\d,]+\s*down\b/i.test(`${title} ${priceText}`);
    const id = path.match(/\/land\/(\d+)/)?.[1] || path;
    listings.push({
      source: "landflip",
      sourceId: id,
      title: title || excerpt.slice(0, 120),
      price: priceMatch && !downInTitle ? Number(priceMatch[1].replace(/,/g, "")) : null,
      priceState: priceMatch && !downInTitle ? "observed" : "unknown",
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

function money(value) {
  return value ? Number(String(value).replace(/,/g, "")) : null;
}

export function parsePriceBlock(html) {
  const block = String(html || "").match(/<div class="price">([\s\S]*?)<\/div>/i)?.[1] || "";
  const text = htmlToText(block);
  if (/contact for price/i.test(text)) {
    return { price: null, priceState: "not_published", previousPrice: null, priceRaw: "Contact for Price" };
  }
  const current = text.match(/\$\s?([\d,]+(?:\.\d{2})?)/);
  const previousText = htmlToText(block.match(/class="[^"]*price-last[^"]*"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || "");
  const previous = previousText.match(/\$\s?([\d,]+(?:\.\d{2})?)/);
  return {
    price: money(current?.[1]),
    priceState: current ? "observed" : "not_parsed",
    previousPrice: money(previous?.[1]),
    priceRaw: text,
  };
}

export function parseDetail(html, card) {
  const page = String(html || "");
  const text = detailText(page);
  const financing = classifyFinancing(`${card.title}\n${card.excerpt}\n${text}`);
  const mapCoord = page.match(/new google\.maps\.LatLng\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
  const described = text.match(/Coordinates:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
  const addressBlock = htmlToText(page.match(/<address>([\s\S]*?)<\/address>/i)?.[1] || "");
  const street = addressBlock.match(/^([^:]+):\s*([^,]+),\s*([A-Z]{2})\s+(\d{5})/);
  const apn = text.match(/Parcel number\s+([A-Za-z0-9-]+)/i)?.[1] || page.match(/\(APN\)<\/div><div class="item">([^<]+)/i)?.[1] || "";
  const price = parsePriceBlock(page);
  const acresText = htmlToText(page.match(/<div class="acres">([\s\S]*?)<\/div>/i)?.[1] || "");
  const acreage = parseAcreage(acresText) || parseAcreage(`${card.title} ${card.excerpt}`);
  const latitude = described ? Number(described[1]) : mapCoord ? Number(mapCoord[1]) : null;
  const longitude = described ? Number(described[2]) : mapCoord ? Number(mapCoord[2]) : null;
  return {
    ...card,
    financingSignal: financing.assertion === "explicit_offer" ? financing.label : "",
    financingAssertion: financing.assertion === "explicit_offer" ? "explicit_offer" : financing.assertion === "explicit_denial" ? "explicit_denial" : "unknown",
    financingEvidence: financing.evidence,
    financingTerms: extractTerms(text) || card.financingTerms,
    acres: acreage && !acreage.ranged ? acreage.max : card.acres ?? null,
    acresLabel: acreage?.label || "",
    price: price.priceState === "not_parsed" ? card.price : price.price,
    priceState: price.priceState === "not_parsed" ? card.priceState || "unknown" : price.priceState,
    previousPrice: price.previousPrice,
    priceRaw: price.priceRaw,
    address: street ? street[1].trim() : card.address,
    city: street ? street[2].trim() : card.city,
    state: street ? street[3] : card.state,
    zip: street ? street[4] : card.zip,
    apn: apn.trim(),
    latitude,
    longitude,
    locationMethod: described ? "seller_provided_point" : mapCoord ? "listing_map_point" : card.locationMethod || "",
    mapLatitude: mapCoord ? Number(mapCoord[1]) : null,
    mapLongitude: mapCoord ? Number(mapCoord[2]) : null,
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
          listing.locationMethod = "locality_centroid";
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
    status: "complete",
    requests,
    scanned,
    listings,
    notes: `County pages that reach the search circle. ${notes.join("; ")}`.trim(),
  };
}
