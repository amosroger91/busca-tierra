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
const outDir = path.dirname(path.resolve(root, option("--out", OUTPUT_CSV)));
console.log(`${result.listings.length} properties with financing terms written to ${option("--out", OUTPUT_CSV)}`);
if (result.report.counts.withoutTerms) {
  console.log(`${result.report.counts.withoutTerms} offers left out because they published no down payment, monthly amount, or rate`);
}
console.log(`${result.candidates.length} catalog leads written to ${path.join(outDir, "candidates.csv")}`);
console.log(`${result.review.length} review rows written to ${path.join(outDir, "review-queue.csv")}`);
console.log(`Source report written to ${option("--report", OUTPUT_REPORT)}`);
for (const source of result.report.sources) {
  console.log(`  ${source.id}: ${source.status}, matched ${source.matched ?? 0}`);
}
