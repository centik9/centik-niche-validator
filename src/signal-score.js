import { zoneFor } from "./gauge-zone.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function plain(text) {
  return String(text || "").replace(/[—–-]/g, " ").replace(/\s+/g, " ").trim();
}

export function clipPlain(text, max = 160) {
  const clean = plain(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const last = cut.lastIndexOf(" ");
  return (last > 80 ? cut.slice(0, last) : cut).trim();
}

export function shortDate(iso) {
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function footerLine(iso, source, example) {
  const label = plain(source);
  if (example) return `Sample, not live · ${label}`;
  const date = shortDate(iso);
  return date ? `Measured ${date} · ${label}` : `From last check · ${label}`;
}

export function assembleSignalCard({
  id,
  title,
  higherMeans,
  signals,
  exampleData,
  measuredAt,
  sources,
  method,
  footerSource,
  explanation,
  balance
}) {
  const list = (Array.isArray(signals) ? signals : []).map((signal) => ({ ...signal }));
  list.sort((left, right) => right.weight - left.weight || String(left.name).localeCompare(String(right.name)));
  const measured = list.filter((signal) => signal.status === "measured").length;
  const estimated = list.filter((signal) => signal.status === "estimated").length;
  const missing = list.filter((signal) => signal.status === "missing").length;
  const total = list.length;
  const enough = measured > 0 && measured * 2 >= total;
  const scored = list.filter((signal) => (
    (signal.status === "measured" || signal.status === "estimated") && Number.isInteger(signal.score)
  ));
  let score = null;
  if (enough && scored.length) {
    const weight = scored.reduce((sum, signal) => sum + signal.weight, 0);
    const value = scored.reduce((sum, signal) => sum + signal.score * signal.weight, 0) / weight;
    score = Math.max(0, Math.min(100, Math.round(value)));
  }
  let status = "missing";
  if (measured === 0 && estimated === 0) status = "missing";
  else if (!enough) status = "insufficient_evidence";
  else if (missing || estimated) status = "partial";
  else status = "measured";
  return {
    id,
    title,
    higher_means: plain(higherMeans),
    example_data: Boolean(exampleData),
    data_label: exampleData ? "Sample, not live" : "From last check",
    measured_at: measuredAt || null,
    status,
    score,
    zone: score == null ? null : zoneFor(score),
    explanation: clipPlain(explanation),
    coverage: {
      measured,
      estimated,
      missing,
      total,
      label: `Based on ${measured} of ${total} signals`
    },
    signals: list,
    weights: Object.fromEntries(list.map((signal) => [signal.id, Math.round(signal.weight * 100)])),
    sources: sources || [],
    method: plain(method),
    footer: footerLine(measuredAt, footerSource, exampleData),
    balance: balance || null,
    changes_grade: false
  };
}
