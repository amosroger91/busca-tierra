import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const CSV_COLUMNS = [
  "sources",
  "title",
  "price",
  "acres",
  "financing_signal",
  "financing_terms",
  "address",
  "city",
  "county",
  "state",
  "zip",
  "latitude",
  "longitude",
  "miles_from_fort_smith",
  "property_type",
  "url",
  "other_urls",
  "listed_at",
];

function cell(value) {
  if (value == null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(listings) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const listing of listings) {
    const row = {
      sources: (listing.sources || [listing.source]).filter(Boolean).join("; "),
      title: listing.title,
      price: listing.price ?? "",
      acres: listing.acres ?? "",
      financing_signal: listing.financingSignal,
      financing_terms: listing.financingTerms,
      address: listing.address,
      city: listing.city,
      county: listing.county,
      state: listing.state,
      zip: listing.zip,
      latitude: listing.latitude ?? "",
      longitude: listing.longitude ?? "",
      miles_from_fort_smith: listing.miles ?? "",
      property_type: listing.propertyType,
      url: listing.url,
      other_urls: (listing.otherUrls || []).join(" | "),
      listed_at: listing.listedAt,
    };
    lines.push(CSV_COLUMNS.map((column) => cell(row[column])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export const V2_COLUMNS = [
  ...CSV_COLUMNS,
  "financing_assertion",
  "financing_evidence",
  "price_state",
  "previous_price",
  "acres_label",
  "location_method",
  "apn",
  "conflicts",
];

export const REVIEW_COLUMNS = ["reason", "title", "city", "state", "miles_from_fort_smith", "url", "detail"];

function project(listing, columns) {
  const row = {
    sources: (listing.sources || [listing.source]).filter(Boolean).join("; "),
    title: listing.title,
    price: listing.price ?? "",
    acres: listing.acres ?? "",
    financing_signal: listing.financingSignal,
    financing_terms: listing.financingTerms,
    address: listing.address,
    city: listing.city,
    county: listing.county,
    state: listing.state,
    zip: listing.zip,
    latitude: listing.latitude ?? "",
    longitude: listing.longitude ?? "",
    miles_from_fort_smith: listing.miles ?? "",
    property_type: listing.propertyType,
    url: listing.url,
    other_urls: (listing.otherUrls || []).join(" | "),
    listed_at: listing.listedAt,
    financing_assertion: listing.financingAssertion,
    financing_evidence: listing.financingEvidence,
    price_state: listing.priceState,
    previous_price: listing.previousPrice ?? "",
    acres_label: listing.acresLabel,
    location_method: listing.locationMethod,
    apn: listing.apn,
    conflicts: listing.conflicts,
    reason: listing.reason,
    detail: listing.detail,
  };
  return columns.map((column) => cell(row[column])).join(",");
}

export function toCsvView(listings, columns) {
  const lines = [columns.join(",")];
  for (const listing of listings) lines.push(project(listing, columns));
  return `${lines.join("\n")}\n`;
}

export async function writeCsv(file, listings, columns = CSV_COLUMNS) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, columns === CSV_COLUMNS ? toCsv(listings) : toCsvView(listings, columns), "utf8");
}
