import { DEFAULT_LABOR_SHARE, entryProblem, isStale } from "./price-model.js";

export const RELATED_TRADES = {
  "drain-cleaning": ["plumbing"],
  "sewer-line": ["plumbing"],
  "water-heater-repair": ["plumbing"],
  "leak-detection": ["plumbing"],
  "furnace": ["hvac"],
  "ac": ["hvac"],
  "heat-pump": ["hvac"],
  "lockout": ["locksmith"],
  "rekey": ["locksmith"],
  "garage-door-spring": ["garage-door"],
  "garage-door-opener": ["garage-door"]
};

export const LABOR_SHARE_NOTE = "Default labor share is 50% because no source stated the labor portion.";

export function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function problem(entry) {
  return entryProblem({
    ...entry,
    kind: entry.kind || "sourced",
    reviewed: entry.reviewed,
    source_url: entry.source_url || entry.url
  });
}

export function estimatePrice({ nicheId, catalog, related = RELATED_TRADES, today = "2026-11-09" }) {
  const rows = catalog.filter((row) => row && row.niche_id);
  const own = rows.find((row) => row.niche_id === nicheId && row.role === "emergency");
  if (own) {
    const reason = problem(own);
    if (reason) return { status: "no_estimate", reason, chain: null };
    return {
      status: "direct",
      kind: "sourced",
      low_dollars: own.low_dollars,
      high_dollars: own.high_dollars,
      stale: isStale(own.read_date, today),
      chain: {
        method: "direct",
        borrowed_from: [],
        premium_low_dollars: null,
        base: sourceOf(own),
        labor_share: null,
        labor_share_sourced: null,
        trip_fee_dollars: null,
        formula: "A reviewed direct emergency price is used as published. No multiplier and no borrowed premium is applied."
      }
    };
  }
  const standard = rows.find((row) => row.niche_id === nicheId && (row.role || "standard") === "standard");
  if (!standard) return { status: "no_estimate", reason: related[nicheId] ? "no_standard_price" : "no_related_trade", chain: null };
  const standardProblem = problem(standard);
  if (standardProblem) return { status: "no_estimate", reason: standardProblem, chain: null };
  const trades = related[nicheId];
  if (!trades || !trades.length) return { status: "no_estimate", reason: "no_related_trade", chain: null };
  const premiums = trades
    .map((trade) => rows.find((row) => row.niche_id === trade && row.role === "emergency"))
    .filter((row) => row && !problem(row));
  if (!premiums.length) return { status: "no_estimate", reason: "no_related_premium", chain: null };
  const premiumLow = median(premiums.map((row) => row.low_dollars));
  const laborSourced = typeof standard.labor_share === "number";
  const laborShare = laborSourced ? standard.labor_share : DEFAULT_LABOR_SHARE;
  const nonLaborLow = Math.round(standard.low_dollars * (1 - laborShare));
  const nonLaborHigh = Math.round(standard.high_dollars * (1 - laborShare));
  const feeRow = premiums.find((row) => Number.isInteger(row.trip_fee_dollars));
  const tripFee = feeRow ? feeRow.trip_fee_dollars : 0;
  return {
    status: "estimated",
    kind: "borrowed",
    reviewed: false,
    low_dollars: nonLaborLow + premiumLow + tripFee,
    high_dollars: nonLaborHigh + premiumLow + tripFee,
    stale: [standard, ...premiums].some((row) => isStale(row.read_date, today)),
    chain: {
      method: "borrowed_labor",
      borrowed_from: premiums.map((row) => row.niche_id),
      premium_low_dollars: premiumLow,
      premium_sources: premiums.map(sourceOf),
      base: sourceOf(standard),
      non_labor_low: nonLaborLow,
      non_labor_high: nonLaborHigh,
      labor_share: laborShare,
      labor_share_sourced: laborSourced,
      labor_share_note: laborSourced ? "The labor share comes from the standard-price source." : LABOR_SHARE_NOTE,
      trip_fee_dollars: feeRow ? feeRow.trip_fee_dollars : null,
      trip_fee_source: feeRow ? feeRow.niche_id : null,
      formula: "estimated = non-labor dollars + low end of the borrowed premium + a trip fee only when a source states one. Non-labor = standard price × (1 − labor share). Several premiums use the median of their low ends."
    }
  };
}

function sourceOf(row) {
  return {
    niche_id: row.niche_id,
    low_dollars: row.low_dollars,
    high_dollars: row.high_dollars,
    source_name: row.source_name,
    source_url: row.source_url || row.url,
    quote: row.quote
  };
}
