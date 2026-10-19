/**
 * Public listing sites that were checked for a machine-readable search.
 * A blocked or empty response is recorded and does not invent listings.
 */
const PROBES = [
  {
    id: "land.com",
    url: "https://www.land.com/Arkansas/all-land/",
  },
  {
    id: "landsofamerica",
    url: "https://www.landsofamerica.com/Arkansas/",
  },
  {
    id: "zillow",
    url: "https://www.zillow.com/fort-smith-ar/",
  },
  {
    id: "loopnet",
    url: "https://www.loopnet.com/search/commercial-real-estate/fort-smith-ar/for-sale/",
  },
  {
    id: "homes.com",
    url: "https://www.homes.com/fort-smith-ar/",
  },
  {
    id: "realtor.com",
    url: "https://www.realtor.com/realestateandhomes-search/Fort-Smith_AR",
  },
  {
    id: "redfin",
    url: "https://www.redfin.com/stingray/do/location-autocomplete?location=Fort%20Smith%2C%20AR&v=2",
  },
  {
    id: "point2homes",
    url: "https://www.point2homes.com/US/Land-For-Sale/AR/Fort-Smith.html",
  },
  {
    id: "united-country",
    url: "https://www.unitedcountry.com/property-search?state=AR",
  },
  {
    id: "byowner",
    url: "https://www.byowner.com/property-for-sale/arkansas/fort-smith",
  },
  {
    id: "rehold",
    url: "https://www.rehold.com/Fort+Smith+AR/for-sale",
  },
];

function classify(result) {
  if (result.status === 403 || result.status === 401) return "blocked";
  if (result.status === 429) return "rate-limited";
  if (result.status >= 400) return "error";
  const text = result.text || "";
  const hasListingMarkup = /application\/ld\+json|__NEXT_DATA__|property-card|listing-card/i.test(text);
  const mentions = (text.match(/owner financ/gi) || []).length;
  if (mentions > 0 && hasListingMarkup) return "reachable";
  if (text.length < 20000 && mentions === 0) return "empty";
  return "no-adapter";
}

export async function probeSources({ http, log }) {
  const results = [];
  for (const probe of PROBES) {
    try {
      const result = await http.getText(probe.url);
      const status = classify(result);
      log(`${probe.id}: HTTP ${result.status} (${status})`);
      results.push({
        id: probe.id,
        status,
        requests: 1,
        scanned: 0,
        listings: [],
        httpStatus: result.status,
        notes: `${probe.url} responded HTTP ${result.status}. ${
          status === "blocked"
            ? "The site refused a non-browser client, so it contributed no rows."
            : status === "rate-limited"
              ? "The site rate-limited the request, so it contributed no rows."
              : status === "empty"
                ? "The response had no listing payload."
                : "The page loaded, and this build has no parser for that markup."
        }`,
      });
    } catch (error) {
      results.push({
        id: probe.id,
        status: "error",
        requests: 1,
        scanned: 0,
        listings: [],
        notes: error.message,
      });
    }
  }
  return results;
}
