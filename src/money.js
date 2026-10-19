function roundDollars(value) {
  return Math.round(value * 100) / 100;
}

function termTotal(terms) {
  if (!terms) return null;
  const monthly = terms.monthly;
  const months = terms.months;
  if (monthly == null || months == null) return null;
  return (terms.down || 0) + monthly * months;
}

/**
 * Land Century stores some prices in cents and some in dollars.
 * When the financing terms imply a payoff, pick the unit that lands nearer that payoff.
 * With no terms, a small tract priced above $150,000 per acre is treated as cents.
 */
export function interpretPrice(amount, hints = {}) {
  if (amount == null || amount === "") return null;
  const numeric = Number(String(amount).replace(/[$,]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const asDollars = numeric;
  const asCents = numeric / 100;
  const expected = termTotal(hints);
  if (expected && expected > 0) {
    const dollarError = Math.abs(asDollars - expected) / expected;
    const centError = Math.abs(asCents - expected) / expected;
    if (centError + 0.05 < dollarError && centError < 0.55) return roundDollars(asCents);
    if (dollarError <= centError && dollarError < 0.55) return roundDollars(asDollars);
  }

  const acres = Number(hints.acres);
  if (Number.isFinite(acres) && acres > 0 && acres < 20) {
    if (asDollars / acres > 150000 && asCents / acres < 80000) return roundDollars(asCents);
  }
  return roundDollars(asDollars);
}

export function parseTermHints(text) {
  const flat = String(text || "").replace(/\s+/g, " ");
  const downMatch = flat.match(/\$\s?([\d,]+(?:\.\d{2})?)\s*(?:down payment|down)\b/i);
  const monthlyMatch = flat.match(
    /\$\s?([\d,]+(?:\.\d{2})?)\s*(?:\/\s*mo\b|\/mo\b|per month|a month|\/month|monthly)\b/i
  );
  const monthsMatch = flat.match(/\b(\d{1,3})\s*(?:months|mos)\b/i);
  const toNumber = (value) => (value ? Number(value.replace(/,/g, "")) : null);
  return {
    down: toNumber(downMatch?.[1]),
    monthly: toNumber(monthlyMatch?.[1]),
    months: monthsMatch ? Number(monthsMatch[1]) : null,
  };
}
