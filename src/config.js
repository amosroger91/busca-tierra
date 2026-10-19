/** Geographic center of Fort Smith, Arkansas. */
export const FORT_SMITH = {
  name: "Fort Smith, Arkansas",
  latitude: 35.38592,
  longitude: -94.39855,
};

export const DEFAULT_RADIUS_MILES = 40;

export const OUTPUT_CSV = "output/properties.csv";
export const OUTPUT_REPORT = "output/run-report.json";
export const CACHE_DIR = "output/cache";

/**
 * Craigslist queries. Each phrase is specific to seller-held financing.
 * Separate queries are used because combined OR queries on this API have
 * returned no local hits.
 */
export const CRAIGSLIST_QUERIES = [
  "owner finance",
  "owner financing",
  "owner financed",
  "seller finance",
  "seller financing",
  "seller financed",
  "owner will carry",
  "seller will carry",
  "will carry",
  "contract for deed",
  "land contract",
  "carry back",
  "owner carry",
  "owner terms",
  "seller terms",
];

/**
 * Counties whose territory reaches the search circle. Listings are still
 * kept only when the property pin, or a geocoded city, falls inside the radius.
 */
export const LANDFLIP_COUNTIES = [
  ["arkansas", "sebastian-county"],
  ["arkansas", "crawford-county"],
  ["arkansas", "franklin-county"],
  ["arkansas", "logan-county"],
  ["arkansas", "scott-county"],
  ["oklahoma", "le-flore-county"],
  ["oklahoma", "leflore-county"],
  ["oklahoma", "sequoyah-county"],
  ["oklahoma", "haskell-county"],
  ["oklahoma", "adair-county"],
  ["oklahoma", "muskogee-county"],
];

export const LANDHUB_SEARCHES = [
  "https://www.landhub.com/property-for-sale/arkansas-land-for-sale",
  "https://www.landhub.com/property-for-sale/oklahoma-land-for-sale",
];

export const USER_AGENT =
  "busca-tierra/1.0 (owner-finance property research; Fort Smith AR)";
