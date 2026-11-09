import { compareScoredRows } from "./composite-score.js";

const GENERIC = new Set(["plumbing", "plumber", "plumbers", "near", "me"]);
const STOP = new Set(["and", "the", "a", "an", "of", "for", "in", "to"]);

export const SYNONYMS = {
  "emergency-plumbing": ["24/7", "urgent", "after hours"],
  "drain-cleaning": ["clog", "clogged", "snake", "snaking", "unclog"],
  "water-heater-repair": ["hot water", "tank"],
  "leak-detection": ["leaking"],
  "pipe-repair": ["burst", "burst pipe"],
  "sewer-line": ["main line"],
  "tankless-water-heater": ["tankless"],
  "hose-bib": ["spigot", "hose bib"],
  "water-softener": ["softener"],
  "hydro-jetting": ["jetting"],
  "repipe": ["repiping"],
  "bath-remodel-plumbing": ["remodel"]
};

const TIER_ORDER = { full: 0, partial: 1, none: 2 };

export function normalizeQuery(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/24\s*\/\s*7/g, " 24/7 ")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentTokens(text) {
  return normalizeQuery(text).split(" ").filter((token) => token && !STOP.has(token) && !GENERIC.has(token));
}

function termsFor(subniche) {
  const tokens = contentTokens(subniche.label);
  const extras = (SYNONYMS[subniche.id] || []).flatMap((item) => contentTokens(item));
  return new Set([...tokens, ...extras]);
}

export function specificTerms(query) {
  return contentTokens(query);
}

export function matchFor(query, subniche) {
  const terms = specificTerms(query);
  if (!terms.length) return { tier: "none", specific_terms: [], matched_terms: [], label: null };
  const known = termsFor(subniche);
  const matched = terms.filter((term) => known.has(term));
  const tier = matched.length === terms.length ? "full" : matched.length ? "partial" : "none";
  return {
    tier,
    specific_terms: terms,
    matched_terms: matched,
    label: tier === "none" ? null : "matches your search"
  };
}

export function rankByQuery(query, rows) {
  const ranked = rows.map((row) => ({ ...row, match: matchFor(query, row) }));
  ranked.sort((a, b) => {
    const tierGap = TIER_ORDER[a.match.tier] - TIER_ORDER[b.match.tier];
    if (tierGap) return tierGap;
    return compareScoredRows(a, b);
  });
  return ranked;
}
