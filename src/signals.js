/**
 * Phrases that mean the seller, not a bank, is offering financing.
 * Longer phrases are listed first so the reported label is the specific one.
 */
const PATTERNS = [
  ["owner will finance", /\bowner will finance\b/i],
  ["seller will finance", /\bseller will finance\b/i],
  ["owner will carry", /\bowner will carry\b/i],
  ["seller will carry", /\bseller will carry\b/i],
  ["owner financing", /\bowner[\s-]?financ(?:e|ed|ing|es)\b/i],
  ["seller financing", /\bseller[\s-]?financ(?:e|ed|ing|es)\b/i],
  ["owner carry", /\bowner[\s-]?carry\b/i],
  ["will carry the note", /\bwill carry(?: the)? (?:note|mortgage|contract|balance|financing|paper)\b/i],
  ["carry back", /\bcarry[\s-]?back\b/i],
  ["contract for deed", /\bcontract for deed\b/i],
  ["land contract", /\bland contract\b/i],
  ["bond for deed", /\bbond for deed\b/i],
  ["owner terms", /\bowner terms\b/i],
  ["seller terms", /\bseller terms\b/i],
];

const DENIALS = [
  /\bno owner financ/i,
  /\bnot owner financ/i,
  /\bwithout (?:owner|seller) financ/i,
  /\bnever (?:owner|seller) financ/i,
  /\b(?:owner|seller)[\s-]?financ\w* (?:is |are )?(?:not|no longer) (?:available|offered)\b/i,
  /\bfinancing is not available\b/i,
];

function negated(text, index) {
  const before = text.slice(Math.max(0, index - 28), index)
    .toLowerCase()
    .replace(/\bno credit(?: check)?\b/g, "");
  return /\b(no|not|without|never)\b[^.]{0,12}$/.test(before);
}

export function classifyFinancing(text) {
  const haystack = String(text || "");
  if (!haystack.trim()) return { assertion: "unknown", label: "", evidence: "" };
  for (const pattern of DENIALS) {
    const match = pattern.exec(haystack);
    if (match) {
      return { assertion: "explicit_denial", label: "", evidence: match[0] };
    }
  }
  for (const [label, pattern] of PATTERNS) {
    const match = pattern.exec(haystack);
    if (!match || negated(haystack, match.index)) continue;
    return { assertion: "explicit_offer", label, evidence: match[0] };
  }
  return { assertion: "unknown", label: "", evidence: "" };
}

export function findFinancingSignal(text) {
  const result = classifyFinancing(text);
  return result.assertion === "explicit_offer" ? result.label : null;
}

export function extractTerms(text) {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  const parts = [];
  const down = flat.match(/\$\s?[\d,]+(?:\.\d{2})?\s*(?:down payment|down)\b/i);
  const monthly = flat.match(
    /\$\s?[\d,]+(?:\.\d{2})?\s*(?:\/\s*mo\b|\/mo\b|per month|a month|\/month|monthly)\b/i
  );
  const months = flat.match(/\b\d{1,3}\s*(?:months|mos)\b/i);
  const years = flat.match(/\b\d{1,2}\s*(?:years|yrs)\b/i);
  const downPercent = flat.match(/\b(\d{1,2}(?:\.\d+)?)\s*%\s*down\b/i);
  const rate = flat.match(/\b(\d{1,2}(?:\.\d+)?)\s*%\s*(?:interest|apr)\b/i)
    || flat.match(/\b(?:interest(?: rate)?|apr)\s*(?:of|at|is|:)?\s*(\d{1,2}(?:\.\d+)?)\s*%/i);
  if (down) parts.push(down[0].replace(/\s+/g, " "));
  else if (downPercent) parts.push(`${downPercent[1]}% down`);
  if (monthly) parts.push(monthly[0].replace(/\s+/g, " "));
  if (months) parts.push(months[0]);
  else if (years) parts.push(years[0]);
  if (rate) parts.push(`${rate[1]}% interest`);
  return parts.join("; ");
}

export function hasFinancingTerms(listing) {
  return String(listing?.financingTerms || "").trim().length > 0;
}

const ACRE_NUMBER = "(\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?)";

function acreNumber(value) {
  const acres = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(acres) ? acres : null;
}

export function parseAcreage(text) {
  const flat = String(text || "");
  const range = flat.match(new RegExp(`${ACRE_NUMBER}\\s*(?:to|through|-)\\s*${ACRE_NUMBER}\\s*acres?\\b`, "i"));
  if (range) {
    const min = acreNumber(range[1]);
    const max = acreNumber(range[2]);
    if (min == null || max == null) return null;
    return { min, max, label: `${range[1]} to ${range[2]} acres`, ranged: true };
  }
  const match = flat.match(new RegExp(`${ACRE_NUMBER}\\s*(?:\\+\\/-|plus\\/minus)?\\s*-?\\s*acres?\\b`, "i"));
  if (!match) return null;
  const acres = acreNumber(match[1]);
  if (acres == null) return null;
  return { min: acres, max: acres, label: `${match[1]} acres`, ranged: false };
}

export function parseAcres(text) {
  const parsed = parseAcreage(text);
  if (!parsed || parsed.ranged) return null;
  return parsed.max;
}

const STREET = /(?:^|[^.\d])(\d{1,6}\s+[^,\n]{2,80}?)\s*,\s*([A-Za-z .'-]{2,40}?)\s*,\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?/g;

export function parseStreetAddress(text) {
  const matches = [...String(text || "").matchAll(STREET)];
  const match = matches.at(-1);
  if (!match) return null;
  let address = match[1].replace(/\s+/g, " ").trim();
  const tail = address.match(/(\d{1,6}\s+(?:\d+(?:st|nd|rd|th)\b\s+)?[^0-9][^0-9,]{0,50})$/i);
  if (tail) address = tail[1].trim();
  return {
    address,
    city: match[2].replace(/\s+/g, " ").trim(),
    state: match[3],
    zip: match[4],
  };
}
