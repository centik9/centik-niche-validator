import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync(new URL("../data/job-prices.json", import.meta.url), "utf8"));

function assertRange(id, row) {
  if (!row || typeof row !== "object") throw new Error(`Job price ${id} is not an object.`);
  for (const key of ["job_label", "source_name", "source_title", "url", "quote", "unit", "range_basis"]) {
    if (typeof row[key] !== "string" || !row[key].trim()) throw new Error(`Job price ${id} is missing ${key}.`);
  }
  if (!Number.isInteger(row.low_dollars) || !Number.isInteger(row.high_dollars) || row.low_dollars < 0 || row.high_dollars < row.low_dollars) {
    throw new Error(`Job price ${id} needs a whole-dollar low and high.`);
  }
  if (!row.url.startsWith("https://")) throw new Error(`Job price ${id} needs an https source URL.`);
}

if (raw.accessed !== "2026-11-08") throw new Error("Job price access date must stay explicit.");
if (raw.city_adjusted !== false || raw.scope !== "national_united_states") {
  throw new Error("Job prices are national and are not city-adjusted.");
}
for (const [id, row] of Object.entries(raw.ranges)) assertRange(id, row);

export const PRICE_ACCESS_DATE = raw.accessed;
export const PRICE_SCOPE = raw.scope;

const UNIT_WORD = { per_job: "per job", per_device: "per device" };

export function formatDollars(amount) {
  const text = String(amount);
  return `$${text.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function priceFor(subnicheId) {
  const row = raw.ranges[subnicheId];
  if (!row) {
    return {
      status: "missing",
      low_dollars: null,
      high_dollars: null,
      city_adjusted: false,
      scope: PRICE_SCOPE,
      accessed: PRICE_ACCESS_DATE,
      sentence: "Price range missing",
      source_line: "No published national per-job range is on file. A range was not invented.",
      note: "Margin is missing because no published range is on file. Missing is not zero."
    };
  }
  const unit = UNIT_WORD[row.unit] || row.unit;
  return {
    status: "published",
    ...row,
    city_adjusted: false,
    scope: PRICE_SCOPE,
    accessed: PRICE_ACCESS_DATE,
    sentence: `${row.job_label} runs ${formatDollars(row.low_dollars)}–${formatDollars(row.high_dollars)} ${unit}.`,
    source_line: `${row.source_name}. Accessed November 8, 2026. ${row.url}`,
    note: "National United States range from the cited page. Not adjusted for a city."
  };
}

export function priceCoverage(ids) {
  const missing = ids.filter((id) => priceFor(id).status === "missing");
  const published = ids.filter((id) => priceFor(id).status === "published");
  return {
    published_count: published.length,
    missing_count: missing.length,
    missing_ids: missing,
    city_adjusted: false,
    scope: PRICE_SCOPE,
    accessed: PRICE_ACCESS_DATE,
    note: missing.length
      ? `Published national ranges are on file for ${published.length} sub-niches. ${missing.length} have no published per-job range on file, so their margin is missing: ${missing.join(", ")}. Missing is not scored as zero. Ranges are not adjusted for a city.`
      : "Every listed sub-niche has a published national range. Ranges are not adjusted for a city."
  };
}
