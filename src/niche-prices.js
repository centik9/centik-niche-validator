import { readFileSync } from "node:fs";
import { hostOf, sourceStatus } from "./price-model.js";

const findings = JSON.parse(readFileSync(new URL("../data/emergency-price-findings-2026-11-08.json", import.meta.url), "utf8"));

const NICHE_KEY = {
  plumbing: "plumbing",
  hvac: "hvac_repair",
  locksmith: "locksmith",
  "garage-door": "garage_door_repair",
  electrician: "electrician",
  "retaining-wall": "retaining_wall",
  "mobile-welding": "mobile_welding",
  "crawl-space": "crawl_space_encapsulation"
};

function usableNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalize(row) {
  const dollars = row.unit === "multiplier" || row.unit === "percent" || row.low === "" || row.low === null;
  return {
    niche_id: row.niche,
    variant: row.variant,
    kind: row.kind === "multiplier" ? "derived" : "sourced",
    low_dollars: dollars ? null : row.low,
    high_dollars: dollars ? null : row.high,
    multiplier_low: row.unit === "multiplier" && usableNumber(row.low) ? row.low : null,
    multiplier_high: row.unit === "multiplier" && usableNumber(row.high) ? row.high : null,
    percent_low: row.unit === "percent" && usableNumber(row.low) ? row.low : null,
    percent_high: row.unit === "percent" && usableNumber(row.high) ? row.high : null,
    unit: row.unit,
    source_name: row.source_name,
    source_url: row.source_url,
    quote: row.quote,
    read_date: row.read_date,
    borrowed_from: [],
    reviewed: true,
    snippet_only: row.snippet_only === true,
    derivative_of: row.derivative_of,
    notes: row.notes || ""
  };
}

export const REVIEWED_FINDINGS = findings.map(normalize);

function rowsFor(key) {
  return REVIEWED_FINDINGS.filter((row) => row.niche_id === key && row.reviewed === true && !row.derivative_of);
}

function broken(row) {
  if (!row) return "missing_source";
  if (!row.source_url || sourceStatus(row.source_url) === "broken") return "broken_source";
  if (!row.quote || row.quote === "not found" || !row.source_name || row.source_name === "not found") return "broken_source";
  return null;
}

function money(amount) {
  return `$${amount}`;
}

function sourcedPrice(row, unitWord) {
  const problem = broken(row);
  if (problem) return { status: "no_price", reason: problem, estimated: false };
  if (!Number.isInteger(row.low_dollars) || !Number.isInteger(row.high_dollars)) {
    return { status: "no_estimate", reason: "not_found", estimated: false };
  }
  return {
    status: "published",
    estimated: false,
    kind: "sourced",
    low_dollars: row.low_dollars,
    high_dollars: row.high_dollars,
    unit: row.unit,
    source_name: row.source_name,
    source_url: row.source_url,
    url: row.source_url,
    quote: row.quote,
    read_date: row.read_date,
    borrowed_from: [],
    reviewed: true,
    snippet_only: row.snippet_only,
    sentence: `${row.source_name} ${money(row.low_dollars)}–${money(row.high_dollars)} ${unitWord}.`,
    chain_text: row.snippet_only
      ? "Direct published range. Snippet only: the Thumbtack page returned HTTP 403, so this sentence was not re-read from the live page."
      : "Direct published range. No multiplier was applied.",
    city_adjusted: false
  };
}

function electricianEstimate(rows) {
  const standard = rows.find((row) => row.variant === "standard" && row.unit === "hour" && row.source_name === "HomeGuide");
  const multiplier = rows.find((row) => row.variant === "after_hours_multiplier" && row.source_name === "HomeGuide");
  const labor = rows.find((row) => row.variant === "labor_share" && row.unit === "percent");
  const fee = rows.find((row) => row.variant === "trip_fee" && row.unit === "fee" && row.source_name === "HomeGuide");
  for (const row of [standard, multiplier, labor, fee]) {
    const problem = broken(row);
    if (problem) return { status: "no_price", reason: problem, estimated: false };
  }
  const share = labor.percent_low / 100;
  const factor = multiplier.multiplier_low;
  const feeLow = fee.low_dollars;
  const nonLaborLow = Math.round(standard.low_dollars * (1 - share));
  const nonLaborHigh = Math.round(standard.high_dollars * (1 - share));
  const laborLow = Math.round(standard.low_dollars * share * factor);
  const laborHigh = Math.round(standard.high_dollars * share * factor);
  return {
    status: "published",
    estimated: true,
    kind: "derived",
    low_dollars: nonLaborLow + laborLow + feeLow,
    high_dollars: nonLaborHigh + laborHigh + feeLow,
    unit: "hour",
    source_name: "HomeGuide",
    source_url: standard.source_url,
    url: standard.source_url,
    quote: multiplier.quote,
    read_date: multiplier.read_date,
    borrowed_from: [],
    reviewed: true,
    snippet_only: false,
    sentence: `${money(nonLaborLow + laborLow + feeLow)}–${money(nonLaborHigh + laborHigh + feeLow)} per hour.`,
    chain_text: `Derived, not a published job range. Standard ${money(standard.low_dollars)}–${money(standard.high_dollars)} per hour from HomeGuide. Labor share ${labor.percent_low}% (stated for a GFCI outlet install, the only labor share on file). Multiplier low end ${factor}× from HomeGuide, applied to labor only. Trip fee ${money(feeLow)} from HomeGuide. A direct emergency job price was not used.`,
    city_adjusted: false
  };
}

export function priceForServiceNiche(nicheId) {
  const key = NICHE_KEY[nicheId];
  if (!key) return { status: "no_estimate", reason: "unknown_niche", estimated: false, sentence: "no estimate" };
  const rows = rowsFor(key);
  if (nicheId === "electrician") return electricianEstimate(rows);
  if (["retaining-wall", "mobile-welding", "crawl-space"].includes(nicheId)) {
    return { status: "no_estimate", reason: "not_found", estimated: false, sentence: "no estimate", chain_text: "No emergency or premium range was published for this niche, and it has no related trade with a usable premium. No estimate was made." };
  }
  if (nicheId === "plumbing") {
    const chosen = rows.find((row) => row.variant === "emergency" && row.unit === "job" && row.low_dollars === 210 && row.high_dollars === 620);
    return sourcedPrice(chosen, "per job");
  }
  if (nicheId === "hvac") {
    const chosen = rows.find((row) => row.variant === "emergency" && row.unit === "hour" && row.source_name === "HomeGuide");
    return sourcedPrice(chosen, "per hour");
  }
  if (nicheId === "locksmith") {
    const chosen = rows.find((row) => row.variant === "emergency" && row.unit === "job" && row.source_name === "HomeGuide");
    return sourcedPrice(chosen, "per job");
  }
  if (nicheId === "garage-door") {
    const chosen = rows.find((row) => row.variant === "standard" && row.unit === "job" && row.quote.startsWith("Garage door repair costs"));
    return sourcedPrice(chosen, "per job");
  }
  return { status: "no_estimate", reason: "unknown_niche", estimated: false, sentence: "no estimate" };
}

export function priceFromBrokenSource() {
  const brokenRow = { source_url: "", quote: "missing", source_name: "", low_dollars: 10, high_dollars: 20, unit: "job" };
  if (broken(brokenRow) || hostOf("https://www.angi.com") !== "angi.com") {
    return { status: "no_price", reason: "broken_source", estimated: false, sentence: "no estimate" };
  }
  return { status: "published" };
}
