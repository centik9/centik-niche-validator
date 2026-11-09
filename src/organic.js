import { LANGUAGE_CODE, MAPS_DEVICE, MAPS_OS, ORGANIC_DEPTH, ORGANIC_PATH } from "./config.js";
import { field } from "./measurement.js";
import { readTask } from "./provider.js";

const COST_NOTE = "DataForSEO task cost for this API call, in USD. Not revenue and not a market size.";
const SHARE_NOTE = "Share of obvious directory and lead-gen domains among regular Google organic results (type organic). This does not change the Maps competition index. Missing results are missing, not zero directories.";

export const DIRECTORY_HOSTS = [
  "yelp.com",
  "angi.com",
  "angieslist.com",
  "thumbtack.com",
  "homeadvisor.com",
  "bbb.org",
  "yellowpages.com",
  "yellowpages.ca",
  "yp.com",
  "superpages.com",
  "porch.com",
  "houzz.com",
  "manta.com",
  "bark.com",
  "networx.com",
  "homeguide.com",
  "expertise.com",
  "threebestrated.com",
  "nextdoor.com",
  "citysearch.com",
  "merchantcircle.com",
  "dexknows.com",
  "buildzoom.com",
  "homestars.com",
  "taskrabbit.com",
  "checkatrade.com",
  "hotfrog.com",
  "brownbook.net",
  "whitepages.com",
  "foursquare.com",
  "mapquest.com",
  "chamberofcommerce.com",
  "insiderpages.com",
  "local.com",
  "yellowbook.com"
];

function clip(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function hostnameOf(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const raw = value.trim();
  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withProtocol).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return raw.toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0].split(":")[0].replace(/\.$/, "");
  }
}

export function isDirectoryHost(domainOrUrl) {
  const host = hostnameOf(domainOrUrl);
  if (!host) return false;
  return DIRECTORY_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function share(directories, results) {
  if (!results) return null;
  return Math.round((directories / results) * 1000) / 1000;
}

export function directoryCounts(results) {
  const list = Array.isArray(results) ? results : [];
  const top10 = list.slice(0, 10);
  const top5 = top10.slice(0, 5);
  const count = (rows) => rows.filter((row) => row && row.directory).length;
  const top5Directories = top5.length ? count(top5) : null;
  const top10Directories = top10.length ? count(top10) : null;
  return {
    top5_directory_count: top5Directories,
    top5_results: top5.length,
    top5_directory_share: share(top5Directories || 0, top5.length),
    top10_directory_count: top10Directories,
    top10_results: top10.length,
    top10_directory_share: share(top10Directories || 0, top10.length),
    status: top10.length ? "measured" : "missing",
    note: SHARE_NOTE
  };
}

function costField(status, value) {
  return field(status, value, { unit: "USD", excluded_from_score: true, note: COST_NOTE });
}

export function organicShell({ status, location, sentToDataForSeo, message, code, keyword }) {
  return {
    status,
    endpoint: `POST ${ORGANIC_PATH}`,
    keyword_sent: keyword || null,
    requested_depth: ORGANIC_DEPTH,
    device: MAPS_DEVICE,
    os: MAPS_OS,
    language_code: LANGUAGE_CODE,
    location,
    sent_to_dataforseo: Boolean(sentToDataForSeo),
    results: [],
    ignored_non_organic: 0,
    directory_counts: directoryCounts([]),
    used_in_competition_index: false,
    note: "Regular Google results for the core niche. The city is the Maps location_code, the same way Maps is queried. Directory share is a supporting microsite signal only. Maps listing room stays the competition score.",
    provider_reported_cost_usd: costField(sentToDataForSeo ? "missing" : "not_requested", null),
    error: message ? { code: code || status, message } : null
  };
}

export function organicNotSent({ status, message, code, keyword }) {
  return organicShell({ status, location: null, sentToDataForSeo: false, message, code, keyword });
}

function organicView(item, index) {
  const domain = clip(item.domain, 200) || hostnameOf(item.url) || null;
  const url = clip(item.url, 500);
  return {
    rank: Number.isInteger(item.rank_absolute) ? item.rank_absolute : index + 1,
    rank_group: Number.isInteger(item.rank_group) ? item.rank_group : null,
    type: clip(item.type, 40) || "organic",
    title: clip(item.title, 300),
    url,
    domain,
    directory: isDirectoryHost(domain || url || "")
  };
}

export function parseOrganicPayload(payload, context) {
  const read = readTask(payload);
  if (!read.ok) {
    const failed = organicShell({
      status: "failed",
      location: context.location,
      sentToDataForSeo: context.sentToDataForSeo,
      message: context.redact ? context.redact(read.message).slice(0, 300) : String(read.message).slice(0, 300),
      code: read.code,
      keyword: context.keyword
    });
    return failed;
  }
  const serp = Array.isArray(read.result) ? read.result[0] : null;
  if (!serp || typeof serp !== "object" || !Array.isArray(serp.items)) {
    const missing = organicShell({
      status: "missing",
      location: context.location,
      sentToDataForSeo: context.sentToDataForSeo,
      message: "DataForSEO returned no organic results array. That is not a measured zero.",
      code: "missing_result",
      keyword: context.keyword
    });
    missing.provider_reported_cost_usd = costField(read.cost === null ? "missing" : read.cost === 0 ? "measured_zero" : "measured", read.cost);
    return missing;
  }
  const organic = [];
  let ignored = 0;
  for (const item of serp.items) {
    if (!item || typeof item !== "object" || item.type !== "organic") {
      ignored += 1;
      continue;
    }
    organic.push(item);
  }
  organic.sort((a, b) => {
    const left = Number.isInteger(a.rank_absolute) ? a.rank_absolute : 100000;
    const right = Number.isInteger(b.rank_absolute) ? b.rank_absolute : 100000;
    return left - right;
  });
  const results = organic.slice(0, ORGANIC_DEPTH).map(organicView);
  const report = organicShell({
    status: results.length ? "measured" : "measured_zero",
    location: context.location,
    sentToDataForSeo: context.sentToDataForSeo,
    keyword: context.keyword
  });
  report.results = results;
  report.ignored_non_organic = ignored;
  report.directory_counts = directoryCounts(results);
  if (!results.length) report.directory_counts.status = "measured_zero";
  report.provider_reported_cost_usd = costField(read.cost === null ? "missing" : read.cost === 0 ? "measured_zero" : "measured", read.cost);
  return report;
}

export function organicFromError(error, context) {
  const sent = Boolean(context.sentToDataForSeo) && !["refused", "credentials_missing", "credentials_invalid", "budget_exceeded"].includes(error && error.code);
  return organicShell({
    status: "failed",
    location: context.location,
    sentToDataForSeo: sent,
    message: context.redact ? context.redact(error && error.message).slice(0, 300) : String(error && error.message || "Organic request failed.").slice(0, 300),
    code: (error && error.code) || "failed",
    keyword: context.keyword
  });
}
