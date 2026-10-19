import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FORT_SMITH } from "./config.js";
import { writeCsv } from "./csv.js";
import { dedupeListings } from "./dedupe.js";
import { createGeocoder, normalizeState } from "./geocode.js";
import { milesBetween, roundMiles } from "./geo.js";
import { createHttp } from "./http.js";
import { searchCraigslist } from "./sources/craigslist.js";
import { searchLandCentury } from "./sources/landcentury.js";
import { searchLandflip } from "./sources/landflip.js";
import { searchLandhub } from "./sources/landhub.js";
import { searchLandmodo } from "./sources/landmodo.js";
import { searchLandAndFarm, searchLandWatch } from "./sources/costar.js";
import { probeSources } from "./sources/probes.js";

const SEARCHES = {
  craigslist: searchCraigslist,
  landcentury: searchLandCentury,
  landflip: searchLandflip,
  landhub: searchLandhub,
  landwatch: searchLandWatch,
  landandfarm: searchLandAndFarm,
  landmodo: searchLandmodo,
};

export async function runSearch(options) {
  const radius = options.radiusMiles;
  const log = options.log || ((message) => console.log(message));
  const http = createHttp({
    cacheDir: options.cacheDir,
    refresh: options.refresh,
  });
  const geocode = createGeocoder({ http, cacheDir: options.cacheDir });
  const inside = (latitude, longitude, extra = 0) => {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
    return milesBetween(FORT_SMITH.latitude, FORT_SMITH.longitude, latitude, longitude) <= radius + extra;
  };
  const context = { http, geocode, log, inside, radiusMiles: radius };

  const reports = [];
  const collected = [];
  for (const name of options.sources) {
    const search = SEARCHES[name];
    if (!search) continue;
    log(`searching ${name}`);
    try {
      const report = await search(context);
      reports.push(report);
      collected.push(...report.listings);
      log(`${name}: ${report.listings.length} financing matches from ${report.scanned} scanned`);
    } catch (error) {
      reports.push({
        id: name,
        status: "error",
        requests: 0,
        scanned: 0,
        listings: [],
        notes: error.message,
      });
      log(`${name} failed: ${error.message}`);
    }
  }

  if (options.sources.includes("probes")) {
    log("checking other public listing sites");
    const probes = await probeSources(context);
    reports.push(...probes);
  }

  let outside = 0;
  let unlocated = 0;
  const insideRadius = [];
  for (const listing of collected) {
    if (listing.latitude == null || listing.longitude == null) {
      const hit = await geocode.geocode(listing);
      if (hit) {
        listing.latitude = hit.latitude;
        listing.longitude = hit.longitude;
      }
    }
    if (listing.latitude == null || listing.longitude == null) {
      unlocated += 1;
      continue;
    }
    const miles = milesBetween(FORT_SMITH.latitude, FORT_SMITH.longitude, listing.latitude, listing.longitude);
    if (miles > radius) {
      outside += 1;
      continue;
    }
    listing.miles = roundMiles(miles);
    listing.state = normalizeState(listing.state);
    listing.sources = listing.sources || [listing.source];
    insideRadius.push(listing);
  }

  const listings = dedupeListings(insideRadius).sort(
    (left, right) => left.miles - right.miles || (left.price ?? Number.MAX_SAFE_INTEGER) - (right.price ?? Number.MAX_SAFE_INTEGER)
  );

  await writeCsv(options.outFile, listings);
  const report = {
    generatedAt: new Date().toISOString(),
    center: FORT_SMITH,
    radiusMiles: radius,
    counts: {
      collected: collected.length,
      insideRadius: insideRadius.length,
      deduped: listings.length,
      outsideRadius: outside,
      unlocated,
    },
    sources: reports.map(({ listings: rows, ...rest }) => ({
      ...rest,
      matched: rows.length,
    })),
  };
  await mkdir(path.dirname(options.reportFile), { recursive: true });
  await writeFile(options.reportFile, JSON.stringify(report, null, 2));
  return { listings, report };
}
