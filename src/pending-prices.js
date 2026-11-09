import { readFileSync } from "node:fs";

function formatDollars(amount) {
  return `$${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

const pending = JSON.parse(readFileSync(new URL("../data/pending-prices.json", import.meta.url), "utf8"));

export function pendingPriceFor(subnicheId) {
  const row = pending.ranges[subnicheId];
  if (!row || row.reviewed !== false || row.kind !== "sourced") return null;
  const unit = row.unit === "per_job" ? "per job" : row.unit === "per_hour" ? "per hour" : row.unit;
  return {
    status: "published",
    ...row,
    pending_review: true,
    estimated: false,
    city_adjusted: false,
    scope: "national_united_states",
    accessed: row.read_date,
    sentence: `${row.job_label} runs ${formatDollars(row.low_dollars)}–${formatDollars(row.high_dollars)} ${unit}. Pending Abel review.`,
    source_line: `${row.source_name}. Read ${row.read_date}. ${row.url} Pending review: this sourced range is not treated as accepted.`,
    note: row.note
  };
}

export function pendingFindings() {
  return pending.not_used_for_the_scored_row.map((row) => ({ ...row, pending_review: true }));
}
