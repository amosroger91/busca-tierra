import path from "node:path";
import { CACHE_DIR, DEFAULT_RADIUS_MILES, OUTPUT_CSV, OUTPUT_REPORT } from "./config.js";
import { runSearch } from "./run.js";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) return fallback;
  return process.argv[index + 1];
}

const radiusMiles = Number(option("--radius", String(DEFAULT_RADIUS_MILES)));
if (!Number.isFinite(radiusMiles) || radiusMiles <= 0) {
  console.error("Radius must be a positive number of miles.");
  process.exit(1);
}

const root = process.cwd();
const sources = option(
  "--sources",
  "craigslist,landcentury,landflip,landhub,landwatch,landandfarm,landmodo,probes"
)
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);

const result = await runSearch({
  radiusMiles,
  sources,
  refresh: process.argv.includes("--refresh"),
  cacheDir: path.resolve(root, option("--cache", CACHE_DIR)),
  outFile: path.resolve(root, option("--out", OUTPUT_CSV)),
  reportFile: path.resolve(root, option("--report", OUTPUT_REPORT)),
});

console.log("");
console.log(`${result.listings.length} properties written to ${option("--out", OUTPUT_CSV)}`);
console.log(`Source report written to ${option("--report", OUTPUT_REPORT)}`);
for (const source of result.report.sources) {
  console.log(`  ${source.id}: ${source.status}, matched ${source.matched ?? 0}`);
}
