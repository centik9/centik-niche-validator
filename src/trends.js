import { LANGUAGE_CODE, TRENDS_PATH } from "./config.js";
import { field } from "./measurement.js";
import { readTask } from "./provider.js";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COST_NOTE = "DataForSEO task cost for this API call, in USD. Not revenue and not a market size.";
const INTEREST_NOTE = "Relative Google Trends interest from 0 to 100, not search volume. A missing point is missing, not zero. This series is only a seasonality label. It does not replace Google Ads volume and it does not penalize a seasonal niche.";

function costField(status, value) {
  return field(status, value, { unit: "USD", excluded_from_score: true, note: COST_NOTE });
}

function clip(redact, message) {
  const text = String(message || "Trends request failed.");
  return (redact ? redact(text) : text).replace(/[\u0000-\u001f]/g, " ").slice(0, 300);
}

export function trendsShell({ status, keyword, geo, sentToDataForSeo, message, code }) {
  return {
    status,
    endpoint: `POST ${TRENDS_PATH}`,
    keyword_sent: keyword || null,
    keywords_sent: keyword ? [keyword] : [],
    comparison_terms_sent: 0,
    time_range: "past_12_months",
    type: "web",
    geo: geo || {
      level: "unavailable",
      match: null,
      fallback_from_city: false,
      note: "Trends location was not selected."
    },
    interest_unit: "relative Google Trends interest, 0-100",
    used_as_search_volume: false,
    penalizes_seasonal_niches: false,
    seasonality: {
      status: "missing",
      level: null,
      swing: null,
      peak_months: [],
      trough_months: [],
      series: [],
      numeric_month_count: 0,
      note: INTEREST_NOTE
    },
    sent_to_dataforseo: Boolean(sentToDataForSeo),
    provider_reported_cost_usd: costField(sentToDataForSeo ? "missing" : "not_requested", null),
    error: message ? { code: code || status, message } : null
  };
}

export function trendsNotSent({ status, keyword, geo, message, code }) {
  return trendsShell({ status, keyword, geo, sentToDataForSeo: false, message, code });
}

function monthOf(dateFrom) {
  const match = /^(\d{4})-(\d{2})/.exec(String(dateFrom || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function pointValue(point) {
  if (!point || typeof point !== "object" || point.missing_data === true) return { status: "missing", value: null };
  const values = Array.isArray(point.values) ? point.values : null;
  const value = values ? values[0] : null;
  if (value === null || value === undefined) return { status: "missing", value: null };
  if (!Number.isInteger(value) || value < 0 || value > 100) return { status: "unusable", value: null };
  return { status: value === 0 ? "measured_zero" : "measured", value };
}

export function monthlySeries(points) {
  const buckets = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    const month = monthOf(point && point.date_from);
    if (!month) continue;
    const key = `${month.year}-${String(month.month).padStart(2, "0")}`;
    if (!buckets.has(key)) buckets.set(key, { ...month, values: [] });
    const classified = pointValue(point);
    if (classified.status === "measured" || classified.status === "measured_zero") buckets.get(key).values.push(classified.value);
  }
  return [...buckets.values()]
    .sort((a, b) => a.year - b.year || a.month - b.month)
    .map((bucket) => {
      if (!bucket.values.length) {
        return {
          year: bucket.year,
          month: bucket.month,
          label: `${MONTHS[bucket.month - 1]} ${bucket.year}`,
          status: "missing",
          value: null
        };
      }
      const mean = bucket.values.reduce((sum, value) => sum + value, 0) / bucket.values.length;
      const rounded = Math.round(mean);
      return {
        year: bucket.year,
        month: bucket.month,
        label: `${MONTHS[bucket.month - 1]} ${bucket.year}`,
        status: rounded === 0 ? "measured_zero" : "measured",
        value: rounded
      };
    });
}

function namedMonths(series, pick) {
  const numeric = series.filter((month) => month.status === "measured" || month.status === "measured_zero");
  if (!numeric.length) return [];
  const extreme = pick === "trough"
    ? Math.min(...numeric.map((month) => month.value))
    : Math.max(...numeric.map((month) => month.value));
  const strict = numeric.filter((month) => month.value === extreme);
  if (pick === "trough") return strict.map((month) => month.label);
  const band = numeric.filter((month) => extreme - month.value <= Math.max(8, extreme * 0.1));
  const chosen = band.length > numeric.length / 2 ? strict : band;
  return chosen.map((month) => month.label);
}

export function classifySeasonality(series) {
  const numeric = series.filter((month) => month.status === "measured" || month.status === "measured_zero");
  if (numeric.length < 8) {
    return {
      status: "missing",
      level: null,
      swing: null,
      peak_months: [],
      trough_months: [],
      series,
      numeric_month_count: numeric.length,
      note: `${INTEREST_NOTE} Fewer than 8 months had numeric interest, so seasonality was not labeled.`
    };
  }
  const peak = Math.max(...numeric.map((month) => month.value));
  const trough = Math.min(...numeric.map((month) => month.value));
  const swing = peak - trough;
  let level = "low";
  if (swing >= 50) level = "high";
  else if (swing >= 25) level = "medium";
  return {
    status: "measured",
    level,
    swing,
    peak_months: namedMonths(series, "peak"),
    trough_months: namedMonths(series, "trough"),
    series,
    numeric_month_count: numeric.length,
    note: `${INTEREST_NOTE} Level is low when the peak-to-trough swing is under 25, medium from 25 up to 50, and high at 50 or more. High seasonality is a label, not a score penalty.`
  };
}

export function parseTrendsPayload(payload, context) {
  const read = readTask(payload);
  if (!read.ok) {
    return trendsShell({
      status: "failed",
      keyword: context.keyword,
      geo: context.geo,
      sentToDataForSeo: context.sentToDataForSeo,
      message: clip(context.redact, read.message),
      code: read.code
    });
  }
  const result = Array.isArray(read.result) ? read.result[0] : null;
  const items = result && Array.isArray(result.items) ? result.items : null;
  const graph = items && items.find((item) => item && item.type === "google_trends_graph" && Array.isArray(item.data));
  if (!graph) {
    const missing = trendsShell({
      status: "missing",
      keyword: context.keyword,
      geo: context.geo,
      sentToDataForSeo: context.sentToDataForSeo,
      message: "DataForSEO returned no Google Trends graph. That is not a measured zero.",
      code: "missing_result"
    });
    missing.provider_reported_cost_usd = costField(read.cost === null ? "missing" : read.cost === 0 ? "measured_zero" : "measured", read.cost);
    return missing;
  }
  const series = monthlySeries(graph.data);
  const seasonality = classifySeasonality(series);
  const report = trendsShell({
    status: seasonality.status === "measured" ? "measured" : "missing",
    keyword: context.keyword,
    geo: context.geo,
    sentToDataForSeo: context.sentToDataForSeo
  });
  report.seasonality = seasonality;
  if (seasonality.status !== "measured") {
    report.error = {
      code: "missing_series",
      message: "Trends interest was not complete enough to label seasonality. Missing interest is not zero demand."
    };
  }
  report.provider_reported_cost_usd = costField(read.cost === null ? "missing" : read.cost === 0 ? "measured_zero" : "measured", read.cost);
  return report;
}

export function trendsFromError(error, context) {
  const sent = Boolean(context.sentToDataForSeo) && !["refused", "credentials_missing", "credentials_invalid", "budget_exceeded"].includes(error && error.code);
  return trendsShell({
    status: "failed",
    keyword: context.keyword,
    geo: context.geo,
    sentToDataForSeo: sent,
    message: clip(context.redact, error && error.message),
    code: (error && error.code) || "failed"
  });
}
