import { CPC_UNIT, LANGUAGE_CODE, SEARCH_VOLUME_PATH, VOLUME_SOURCE, VOLUME_UNIT } from "./config.js";
import { clusterCoverage } from "./keyword-clusters.js";
import { classifyNumber, field } from "./measurement.js";
import { readTask } from "./provider.js";

const CLUSTER_NOTE = "Clustered coverage volume is the sum of one representative monthly search volume per cluster. Phrases that match after lowercasing, dropping stopwords (a, an, the, and, or, in, on, at, to, for, of, with, by, from), sorting the remaining words, and folding a trailing s on words of 6 or more letters that do not end in ss share a cluster. The representative is the maximum measured volume in that cluster, so word-order twins are not added twice. A cluster with no measured row is missing and is not added as zero. The demand index uses this sum. The core term stays on search_volume and is not the index input.";

const PAID_NOTE = "Google Ads paid-SERP advertiser competition. Not the number of local businesses, and not used in the score.";
const CPC_NOTE = "Average cost per click in USD reported by Google Ads. Not revenue, not customer value, and not used in the score. CPC is not multiplied by search volume.";
const BID_NOTE = "Google Ads top-of-page bid statistic in USD. Not a price this app calculated, and not used in the score.";
const COST_NOTE = "DataForSEO task cost for this API call, in USD. Not revenue and not a market size.";

function clipMessage(redact, message) {
  const text = String(message || "DataForSEO returned an error.");
  const cleaned = (redact ? redact(text) : text).replace(/[\u0000-\u001f]/g, " ");
  return cleaned.slice(0, 300);
}

function costField(status, value) {
  return field(status, value, { unit: "USD", excluded_from_score: true, note: COST_NOTE });
}

function blankMonthly(status) {
  return {
    status,
    months: [],
    numeric_month_count: 0,
    null_month_count: 0,
    observed_start: null,
    observed_end: null,
    numeric_sum: null,
    arithmetic_mean: null,
    request_note: "No date_from or date_to was sent. DataForSEO's default window is the past 12 months, and Google Ads does not return the current month. Observed months are whatever the payload contained. The score uses search_volume, not a recomputed average."
  };
}

function stamp(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseMonthly(monthly) {
  const base = blankMonthly("missing");
  if (monthly === null || monthly === undefined) return base;
  if (!Array.isArray(monthly)) return { ...base, status: "unusable" };
  const months = [];
  let numeric = 0;
  let nulls = 0;
  let sum = 0;
  for (const entry of monthly) {
    if (!entry || typeof entry !== "object") {
      months.push({ year: null, month: null, search_volume_status: "unusable", value: null });
      continue;
    }
    let classified = classifyNumber(entry.search_volume);
    if (classified.status === "measured" && !Number.isInteger(entry.search_volume)) {
      classified = { status: "unusable", value: null };
    }
    if (classified.status === "measured" || classified.status === "measured_zero") {
      numeric += 1;
      sum += classified.value;
    } else if (classified.status === "missing") nulls += 1;
    months.push({
      year: Number.isInteger(entry.year) ? entry.year : null,
      month: Number.isInteger(entry.month) ? entry.month : null,
      search_volume_status: classified.status,
      value: classified.value
    });
  }
  let status = "missing";
  if (months.length > 0 && numeric === months.length && sum === 0) status = "measured_zero";
  else if (months.length > 0 && numeric === months.length) status = "measured";
  else if (numeric > 0) status = "partial";
  const dated = months.filter((month) => month.year && month.month).map((month) => month.year * 100 + month.month);
  return {
    ...base,
    status,
    months,
    numeric_month_count: numeric,
    null_month_count: nulls,
    observed_start: dated.length ? stamp(Math.floor(Math.min(...dated) / 100), Math.min(...dated) % 100) : null,
    observed_end: dated.length ? stamp(Math.floor(Math.max(...dated) / 100), Math.max(...dated) % 100) : null,
    numeric_sum: numeric ? sum : null,
    arithmetic_mean: numeric ? Math.round((sum / numeric) * 100) / 100 : null
  };
}

function spellField(spell, keyword) {
  if (spell === null || spell === undefined || spell === "") return { status: "none", value: null };
  if (typeof spell !== "string") return { status: "unusable", value: null };
  const corrected = spell.trim().toLowerCase() !== String(keyword).trim().toLowerCase();
  return { status: corrected ? "corrected" : "none", value: spell };
}

function competitionField(value) {
  if (value === null || value === undefined) {
    return field("missing", null, { excluded_from_score: true, note: PAID_NOTE });
  }
  if (value === "LOW" || value === "MEDIUM" || value === "HIGH") {
    return field("measured", value, { excluded_from_score: true, note: PAID_NOTE });
  }
  return field("unusable", null, { excluded_from_score: true, note: PAID_NOTE });
}

function integerOrClassify(value) {
  const classified = classifyNumber(value);
  if ((classified.status === "measured" || classified.status === "measured_zero") && !Number.isInteger(value)) {
    return { status: "unusable", value: null };
  }
  return classified;
}

function volumeNumber(metric) {
  if (!metric) return null;
  if (metric.status === "measured" || metric.status === "measured_zero") return metric.value;
  return null;
}

function metricsFromItem(item, keyword) {
  const volume = integerOrClassify(item ? item.search_volume : undefined);
  const monthly = item ? parseMonthly(item.monthly_searches) : blankMonthly("missing");
  const cpc = item ? classifyNumber(item.cpc) : { status: "missing", value: null };
  const low = item ? classifyNumber(item.low_top_of_page_bid) : { status: "missing", value: null };
  const high = item ? classifyNumber(item.high_top_of_page_bid) : { status: "missing", value: null };
  const index = item ? integerOrClassify(item.competition_index) : { status: "missing", value: null };
  return {
    keyword,
    returned: Boolean(item),
    spell: item ? spellField(item.spell, keyword) : { status: "none", value: null },
    search_volume: field(item ? volume.status : "missing", item ? volume.value : null, { unit: VOLUME_UNIT, source: VOLUME_SOURCE }),
    cpc: field(cpc.status, cpc.value, { unit: CPC_UNIT, excluded_from_score: true, note: CPC_NOTE }),
    low_top_of_page_bid: field(low.status, low.value, { unit: "USD", excluded_from_score: true, note: BID_NOTE }),
    high_top_of_page_bid: field(high.status, high.value, { unit: "USD", excluded_from_score: true, note: BID_NOTE }),
    paid_search_competition: item ? competitionField(item.competition) : field("missing", null, { excluded_from_score: true, note: PAID_NOTE }),
    paid_search_competition_index: field(index.status, index.value, {
      unit: "Google Ads index 0-100",
      excluded_from_score: true,
      note: PAID_NOTE
    }),
    monthly_searches: monthly
  };
}

function coverageField(coverage) {
  const status = coverage && coverage.status ? coverage.status : "missing";
  const value = coverage && Number.isInteger(coverage.value) ? coverage.value : null;
  return field(status, value, {
    unit: VOLUME_UNIT,
    source: VOLUME_SOURCE,
    demand_index_input: true,
    partial: Boolean(coverage && coverage.partial),
    missing_cluster_count: coverage ? coverage.missing_cluster_count : 0,
    measured_cluster_count: coverage ? coverage.measured_cluster_count : 0,
    note: CLUSTER_NOTE
  });
}

function keywordRowsFrom(sent, resultRows) {
  const rows = Array.isArray(resultRows) ? resultRows : [];
  const byKeyword = new Map();
  for (const row of rows) {
    if (!row || typeof row.keyword !== "string") continue;
    byKeyword.set(row.keyword.trim().toLowerCase(), row);
  }
  const phrases = Array.isArray(sent) && sent.length ? sent : [];
  const keywordRows = phrases.map((keyword) => metricsFromItem(byKeyword.get(String(keyword).trim().toLowerCase()) || null, keyword));
  for (const row of rows) {
    if (!row || typeof row.keyword !== "string") continue;
    const key = row.keyword.trim().toLowerCase();
    if (phrases.some((keyword) => String(keyword).trim().toLowerCase() === key)) continue;
    keywordRows.push(metricsFromItem(row, row.keyword));
  }
  return keywordRows;
}

function attachCoverage(report, keywordRows) {
  const coverage = clusterCoverage(keywordRows.map((row) => ({ keyword: row.keyword, volume: volumeNumber(row.search_volume) })));
  report.keyword_rows = keywordRows;
  report.clusters = coverage.clusters;
  report.clustered_coverage_volume = coverageField(coverage);
  report.demand_index_uses = "clustered_coverage_volume";
  return report;
}

function shell({ status, keyword, keywords, location, sentToDataForSeo, message, code, monthlyStatus }) {
  const monthly = blankMonthly(monthlyStatus || status);
  const sent = Array.isArray(keywords) && keywords.length ? keywords : (keyword ? [keyword] : []);
  return {
    status,
    endpoint: `POST ${SEARCH_VOLUME_PATH}`,
    keyword_sent: keyword,
    keywords_sent: sent,
    keyword_returned: null,
    keyword_rows: [],
    clusters: [],
    clustered_coverage_volume: coverageField(null),
    demand_index_uses: "clustered_coverage_volume",
    spell: { status: "none", value: null },
    search_volume: field(status, null, { unit: VOLUME_UNIT, source: VOLUME_SOURCE, period: null }),
    cpc: field(status, null, { unit: CPC_UNIT, excluded_from_score: true, note: CPC_NOTE }),
    low_top_of_page_bid: field(status, null, { unit: "USD", excluded_from_score: true, note: BID_NOTE }),
    high_top_of_page_bid: field(status, null, { unit: "USD", excluded_from_score: true, note: BID_NOTE }),
    paid_search_competition: field(status, null, { excluded_from_score: true, note: PAID_NOTE }),
    paid_search_competition_index: field(status, null, {
      unit: "Google Ads index 0-100",
      excluded_from_score: true,
      note: PAID_NOTE
    }),
    monthly_searches: monthly,
    monthly_crosscheck: {
      arithmetic_mean: null,
      differs_from_search_volume: false,
      note: "The arithmetic mean of numeric monthly values is a cross-check only. The demand index uses search_volume."
    },
    search_partners: false,
    language_code: LANGUAGE_CODE,
    location,
    sent_to_dataforseo: Boolean(sentToDataForSeo),
    provider_reported_cost_usd: costField(sentToDataForSeo ? "missing" : "not_requested", null),
    error: message ? { code: code || status, message } : null
  };
}

export function demandNotSent({ status, keyword, message, code }) {
  return shell({
    status,
    keyword,
    location: null,
    sentToDataForSeo: false,
    message,
    code: code || status,
    monthlyStatus: status
  });
}

export function parseDemandPayload(payload, context) {
  const sentKeywords = Array.isArray(context.keywords) && context.keywords.length ? context.keywords : [context.keyword];
  const read = readTask(payload);
  if (!read.ok) {
    const failed = shell({
      status: "failed",
      keyword: context.keyword,
      keywords: sentKeywords,
      location: context.location,
      sentToDataForSeo: context.sentToDataForSeo,
      message: clipMessage(context.redact, read.message),
      code: read.code
    });
    failed.provider_reported_cost_usd = costField(context.sentToDataForSeo ? "missing" : "not_requested", null);
    return failed;
  }
  const rows = Array.isArray(read.result) ? read.result : [];
  const keywordRows = keywordRowsFrom(sentKeywords, rows);
  const item = rows.find((row) => row && typeof row.keyword === "string" && row.keyword.trim().toLowerCase() === context.keyword.trim().toLowerCase()) || null;
  if (!item) {
    const missing = shell({
      status: "missing",
      keyword: context.keyword,
      keywords: sentKeywords,
      location: context.location,
      sentToDataForSeo: context.sentToDataForSeo,
      message: "DataForSEO returned no core keyword row. That is not a measured zero.",
      code: "missing_result"
    });
    missing.provider_reported_cost_usd = costField(read.cost === null ? "missing" : read.cost === 0 ? "measured_zero" : "measured", read.cost);
    return attachCoverage(missing, keywordRows);
  }

  const volume = integerOrClassify(item.search_volume);
  const monthly = parseMonthly(item.monthly_searches);
  const report = shell({
    status: volume.status,
    keyword: context.keyword,
    keywords: sentKeywords,
    location: context.location,
    sentToDataForSeo: context.sentToDataForSeo,
    message: null
  });
  report.keyword_returned = typeof item.keyword === "string" ? item.keyword : null;
  report.spell = spellField(item.spell, context.keyword);
  report.search_volume = field(volume.status, volume.value, {
    unit: VOLUME_UNIT,
    source: VOLUME_SOURCE,
    period: {
      observed_start: monthly.observed_start,
      observed_end: monthly.observed_end,
      request: monthly.request_note
    }
  });
  const cpc = classifyNumber(item.cpc);
  report.cpc = field(cpc.status, cpc.value, { unit: CPC_UNIT, excluded_from_score: true, note: CPC_NOTE });
  const low = classifyNumber(item.low_top_of_page_bid);
  const high = classifyNumber(item.high_top_of_page_bid);
  report.low_top_of_page_bid = field(low.status, low.value, { unit: "USD", excluded_from_score: true, note: BID_NOTE });
  report.high_top_of_page_bid = field(high.status, high.value, { unit: "USD", excluded_from_score: true, note: BID_NOTE });
  report.paid_search_competition = competitionField(item.competition);
  const index = integerOrClassify(item.competition_index);
  report.paid_search_competition_index = field(index.status, index.value, {
    unit: "Google Ads index 0-100",
    excluded_from_score: true,
    note: PAID_NOTE
  });
  report.monthly_searches = monthly;
  report.monthly_crosscheck = {
    arithmetic_mean: monthly.arithmetic_mean,
    differs_from_search_volume: (volume.status === "measured" || volume.status === "measured_zero")
      && monthly.arithmetic_mean !== null
      && monthly.arithmetic_mean !== volume.value,
    note: "The arithmetic mean of numeric monthly values is a cross-check only. The demand index uses search_volume."
  };
  report.search_partners = item.search_partners === true;
  report.provider_reported_cost_usd = costField(
    read.cost === null ? "missing" : read.cost === 0 ? "measured_zero" : "measured",
    read.cost
  );
  if (item.search_partners === true) {
    report.error = {
      code: "search_partners",
      message: "The payload says search partners were included. This app requests search_partners false. Treat the volume as a different definition than a Google-only count."
    };
  }
  return attachCoverage(report, keywordRows);
}

export function demandFromError(error, context) {
  const sent = Boolean(context.sentToDataForSeo) && !["refused", "credentials_missing", "credentials_invalid", "budget_exceeded"].includes(error && error.code);
  return shell({
    status: "failed",
    keyword: context.keyword,
    keywords: context.keywords,
    location: context.location,
    sentToDataForSeo: sent,
    message: clipMessage(context.redact, error && error.message),
    code: (error && error.code) || "failed"
  });
}
