import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const STATE_NAMES = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

export function normalizeState(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^[A-Za-z]{2}$/.test(text)) return text.toUpperCase();
  return STATE_NAMES[text.toLowerCase()] || text;
}

export function createGeocoder({ http, cacheDir }) {
  const memory = new Map();
  const file = path.join(cacheDir, "geocode.json");
  let loaded = false;

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const saved = JSON.parse(await readFile(file, "utf8"));
      for (const [key, value] of Object.entries(saved)) memory.set(key, value);
    } catch {
      // First run has no cache file.
    }
  }

  async function save() {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, JSON.stringify(Object.fromEntries(memory), null, 2));
  }

  async function census(query) {
    const url =
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=" +
      encodeURIComponent(query) +
      "&benchmark=Public_AR_Current&format=json";
    const { data, status } = await http.getJson(url);
    if (status !== 200 || !data) return null;
    const match = data.result?.addressMatches?.[0];
    if (!match?.coordinates) return null;
    return {
      latitude: Number(match.coordinates.y),
      longitude: Number(match.coordinates.x),
      label: match.matchedAddress || query,
    };
  }

  async function nominatim(query) {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=" +
      encodeURIComponent(query);
    const { data, status } = await http.getJson(url);
    if (status !== 200 || !Array.isArray(data) || !data[0]) return null;
    return {
      latitude: Number(data[0].lat),
      longitude: Number(data[0].lon),
      label: data[0].display_name || query,
    };
  }

  async function geocode(parts) {
    await load();
    const query = [parts.address, parts.city, parts.county, normalizeState(parts.state), parts.zip]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(", ");
    if (!query) return null;
    const key = query.toLowerCase();
    if (memory.has(key)) return memory.get(key);
    let hit = await census(query);
    if (!hit) {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      hit = await nominatim(query);
    }
    memory.set(key, hit);
    await save();
    return hit;
  }

  return { geocode, flush: save };
}
