export const STALE_AFTER_DAYS = 365;
export const DEFAULT_LABOR_SHARE = 0.5;

export const ALLOWED_HOSTS = [
  "homeguide.com",
  "angi.com",
  "homeadvisor.com",
  "fixr.com",
  "thumbtack.com",
  "thisoldhouse.com"
];

export const AGGREGATOR_HOSTS = ["fixr.com", "elocal.com", "fixerlane.com"];

const CITED_SOURCES = [
  ["Angi", /\bangi\b/i],
  ["HomeGuide", /\bhomeguide\b/i],
  ["Thumbtack", /\bthumbtack\b/i],
  ["HomeAdvisor", /\bhomeadvisor\b/i],
  ["This Old House", /\bthis old house\b/i]
];

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function sourceStatus(url) {
  if (typeof url !== "string" || !url.startsWith("https://")) return "broken";
  const host = hostOf(url);
  if (!host) return "broken";
  return ALLOWED_HOSTS.includes(host) ? "allowed" : "needs_review";
}

export function daysBetween(start, end) {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86400000) : null;
}

export function isStale(readDate, today, limit = STALE_AFTER_DAYS) {
  const days = daysBetween(readDate, today);
  if (days === null) return false;
  return days > limit;
}

export function independentKey(finding) {
  const host = hostOf(finding.source_url);
  const text = `${finding.quote || ""} ${finding.note || ""} ${finding.source_name || ""}`;
  if (AGGREGATOR_HOSTS.includes(host)) {
    const cited = CITED_SOURCES.find(([, pattern]) => pattern.test(text));
    if (cited) return `source:${cited[0]}`;
  }
  const own = CITED_SOURCES.find(([, pattern]) => pattern.test(finding.source_name || "") || pattern.test(host));
  return own ? `source:${own[0]}` : `host:${host || "missing"}`;
}

export function entryProblem(entry) {
  if (!entry || entry.reviewed !== true) return "not_reviewed";
  if (!["sourced", "derived", "borrowed"].includes(entry.kind)) return "bad_kind";
  if (!Number.isInteger(entry.low_dollars) || !Number.isInteger(entry.high_dollars) || entry.low_dollars < 0 || entry.high_dollars < entry.low_dollars) {
    return "bad_range";
  }
  if (sourceStatus(entry.source_url || entry.url) === "broken") return "broken_source";
  if (!entry.quote || !entry.source_name) return "broken_source";
  if (entry.kind === "borrowed" && (!Array.isArray(entry.borrowed_from) || entry.borrowed_from.length === 0)) return "missing_chain";
  return null;
}
