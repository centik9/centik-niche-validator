import { ADS_ADVERTISERS_PATH, ADS_SEARCH_PATH } from "./config.js";
import { isDirectoryHost } from "./organic.js";
import { readTask } from "./provider.js";
import { ADS_ADVERTISERS_COST_USD, ADS_SEARCH_COST_USD } from "./spend.js";
import { assembleSignalCard } from "./signal-score.js";
import { buildVolumeKeywords } from "./volume-keywords.js";

const WEIGHTS = {
  run_length: 0.25,
  bidding_together: 0.2,
  copy_angles: 0.15,
  repeat_advertisers: 0.2,
  seasonality: 0.1,
  local_vs_national: 0.1
};

const LEAD_GEN_NAMES = [
  "angi",
  "angies list",
  "homeadvisor",
  "home advisor",
  "thumbtack",
  "yelp",
  "networx",
  "porch",
  "houzz",
  "bbb",
  "better business bureau",
  "yellow pages",
  "nextdoor",
  "bark",
  "taskrabbit"
];

const ANGLE = /\b(24\s*7|24 hour|emergency|free estimate|financing|same day|discount|coupon)\b/i;
const DAY = 86400000;

function clip(value, max = 200) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function missing(id, name, icon, weight, reason) {
  return { id, name, icon, weight, status: "missing", score: null, raw_fact: "Not measured", reason, evidence: null };
}

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function advertiserKey(row) {
  if (!row) return "";
  if (row.id) return `id:${row.id}`;
  if (row.domain) return `domain:${norm(row.domain)}`;
  if (row.name) return `name:${norm(row.name)}`;
  return "";
}

function viewAdvertiser(item, fallbackTitle) {
  const id = typeof item.advertiser_id === "string" && /^AR\d{5,32}$/.test(item.advertiser_id) ? item.advertiser_id : null;
  const name = clip(item.title || fallbackTitle, 200);
  const domain = clip(item.domain, 200);
  if (!id && !name && !domain) return null;
  return { id, name, domain };
}

function dedupe(rows) {
  const seen = new Set();
  const kept = [];
  for (const row of rows) {
    const key = advertiserKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept;
}

export function parseAdvertisersPayload(payload) {
  const read = readTask(payload);
  if (!read.ok) return { status: "failed", advertisers: [], cost: null, message: read.message };
  const serp = Array.isArray(read.result) ? read.result[0] : null;
  const items = serp && Array.isArray(serp.items) ? serp.items : null;
  if (!items) return { status: "missing", advertisers: [], cost: read.cost, message: "No advertiser list was returned." };
  const rows = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "ads_multi_account_advertiser" && Array.isArray(item.advertisers)) {
      for (const account of item.advertisers) {
        const view = viewAdvertiser(account || {}, item.title);
        if (view) rows.push(view);
      }
      continue;
    }
    const view = viewAdvertiser(item, item.title);
    if (view) rows.push(view);
  }
  const advertisers = dedupe(rows);
  return {
    status: advertisers.length ? "measured" : "measured_zero",
    advertisers,
    cost: read.cost,
    message: null
  };
}

export function parseCreativesPayload(payload) {
  const read = readTask(payload);
  if (!read.ok) return { status: "failed", creatives: [], cost: null, message: read.message };
  const serp = Array.isArray(read.result) ? read.result[0] : null;
  const items = serp && Array.isArray(serp.items) ? serp.items : null;
  if (!items) return { status: "missing", creatives: [], cost: read.cost, message: "No ad history was returned." };
  const creatives = [];
  for (const item of items) {
    if (!item || item.type !== "ads_search") continue;
    creatives.push({
      advertiser_id: typeof item.advertiser_id === "string" ? item.advertiser_id : null,
      title: clip(item.title, 200),
      first_shown: typeof item.first_shown === "string" ? item.first_shown : null,
      last_shown: typeof item.last_shown === "string" ? item.last_shown : null
    });
  }
  return { status: creatives.length ? "measured" : "measured_zero", creatives, cost: read.cost, message: null };
}

function costField(cost) {
  if (typeof cost !== "number" || !Number.isFinite(cost)) return { status: "missing", value: null };
  return { status: cost === 0 ? "measured_zero" : "measured", value: cost };
}

function auditShell(path, costUsd) {
  return {
    endpoint: `POST ${path}`,
    billable_when_live: true,
    sent_to_dataforseo: false,
    invoked: false,
    reason_not_sent: null,
    estimated_cost_usd: costUsd,
    provider_reported_cost_usd: null
  };
}

async function callJson(deps, path, body, costUsd, audits) {
  const audit = auditShell(path, costUsd);
  try {
    const payload = await deps.transport.request({ method: "POST", path, body });
    audit.invoked = true;
    audit.sent_to_dataforseo = deps.origin === "live";
    audits.push(audit);
    return { payload, audit };
  } catch (error) {
    const code = error && error.code;
    const sent = deps.origin === "live" && !["refused", "credentials_missing", "credentials_invalid", "budget_exceeded"].includes(code);
    audit.sent_to_dataforseo = sent;
    audit.invoked = sent;
    audit.reason_not_sent = String(error && error.message || "The ads request failed.").slice(0, 300);
    audits.push(audit);
    return { payload: null, audit, error };
  }
}

export async function loadAdsTransparency(prepared, deps) {
  const audits = [];
  if (!deps || deps.origin !== "live") return { audits, core: null, related: null, creatives: null };
  const locationName = [prepared.city, prepared.state, prepared.countryCanonical || prepared.country].filter(Boolean).join(",");
  const keywords = buildVolumeKeywords(prepared.niche, prepared.city);
  const relatedKeyword = keywords.find((phrase) => /\bnear me\b/i.test(phrase) && phrase.toLowerCase() !== String(prepared.niche || "").toLowerCase()) || null;
  const coreCall = await callJson(deps, ADS_ADVERTISERS_PATH, [{ keyword: prepared.niche, location_name: locationName }], ADS_ADVERTISERS_COST_USD, audits);
  const core = coreCall.payload ? parseAdvertisersPayload(coreCall.payload) : { status: "failed", advertisers: [], cost: null, message: coreCall.error && coreCall.error.message };
  if (coreCall.audit) coreCall.audit.provider_reported_cost_usd = costField(core.cost);
  let related = null;
  if (relatedKeyword) {
    const relatedCall = await callJson(deps, ADS_ADVERTISERS_PATH, [{ keyword: relatedKeyword, location_name: locationName }], ADS_ADVERTISERS_COST_USD, audits);
    related = relatedCall.payload ? parseAdvertisersPayload(relatedCall.payload) : { status: "failed", advertisers: [], cost: null, message: relatedCall.error && relatedCall.error.message };
    if (relatedCall.audit) relatedCall.audit.provider_reported_cost_usd = costField(related.cost);
  }
  const ids = [];
  for (const bundle of [core, related]) {
    for (const row of (bundle && bundle.advertisers) || []) {
      if (row.id && !ids.includes(row.id)) ids.push(row.id);
    }
  }
  let creatives = null;
  if (ids.length) {
    const creativeCall = await callJson(
      deps,
      ADS_SEARCH_PATH,
      [{ advertiser_ids: ids.slice(0, 25), location_name: locationName }],
      ADS_SEARCH_COST_USD,
      audits
    );
    creatives = creativeCall.payload ? parseCreativesPayload(creativeCall.payload) : { status: "failed", creatives: [], cost: null, message: creativeCall.error && creativeCall.error.message };
    if (creativeCall.audit) creativeCall.audit.provider_reported_cost_usd = costField(creatives.cost);
  } else {
    audits.push({
      ...auditShell(ADS_SEARCH_PATH, ADS_SEARCH_COST_USD),
      reason_not_sent: "No advertiser ids were returned, so ad history was not requested."
    });
  }
  return { audits, core, related, creatives, relatedKeyword };
}

function parseDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(time) ? time : null;
}

function durationSignal(creatives, nowMs) {
  const rows = [];
  for (const creative of (creatives && creatives.creatives) || []) {
    const start = parseDay(creative.first_shown);
    const end = parseDay(creative.last_shown);
    if (start == null || end == null || end < start) continue;
    const id = creative.advertiser_id || creative.title;
    if (!id) continue;
    rows.push({ id, start, end });
  }
  if (!rows.length) {
    return missing("run_length", "Ad run length", "clock", WEIGHTS.run_length, creatives && creatives.message
      ? creatives.message
      : "Ad first and last shown dates were not returned.");
  }
  const byId = new Map();
  for (const row of rows) {
    const prev = byId.get(row.id);
    if (!prev || row.end - row.start > prev.end - prev.start) byId.set(row.id, row);
  }
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  let sustained = 0;
  for (const row of byId.values()) {
    const days = (row.end - row.start) / DAY;
    const current = now - row.end <= 45 * DAY;
    if (days >= 90 && current) sustained += 1;
  }
  const total = byId.size;
  return {
    id: "run_length",
    name: "Ad run length",
    icon: "clock",
    weight: WEIGHTS.run_length,
    status: "measured",
    score: Math.round((100 * sustained) / total),
    raw_fact: `${sustained} of ${total} advertisers have run ads for 90 days or more`,
    reason: null,
    evidence: { advertisers: total, sustained, minimum_days: 90, current_within_days: 45 }
  };
}

function crowdScore(count) {
  if (count <= 0) return 0;
  if (count === 1) return 35;
  if (count === 2) return 55;
  if (count <= 4) return 75;
  return 100;
}

function biddingSignal(core, paid) {
  if (core && (core.status === "measured" || core.status === "measured_zero")) {
    const count = core.advertisers.length;
    return {
      id: "bidding_together",
      name: "Bidding together",
      icon: "users",
      weight: WEIGHTS.bidding_together,
      status: "measured",
      score: crowdScore(count),
      raw_fact: `${count} advertisers on this search`,
      reason: null,
      evidence: { advertisers: count, source: "ads_advertisers" }
    };
  }
  const ads = Array.isArray(paid) ? paid : [];
  if (core && core.status === "failed") {
    if (!ads.length) {
      return missing("bidding_together", "Bidding together", "users", WEIGHTS.bidding_together, "The advertiser list failed and no paid ads were in the regular results.");
    }
  }
  if (!core && ads.length) {
    return {
      id: "bidding_together",
      name: "Bidding together",
      icon: "users",
      weight: WEIGHTS.bidding_together,
      status: "measured",
      score: crowdScore(ads.length),
      raw_fact: `${ads.length} paid ads on this search`,
      reason: null,
      evidence: { advertisers: ads.length, source: "organic_paid" }
    };
  }
  return missing("bidding_together", "Bidding together", "users", WEIGHTS.bidding_together, "Advertisers were not returned, so a headcount was not invented from the competition index.");
}

function serviceWords(niche) {
  return String(niche || "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4);
}

function copySignal(paid, niche) {
  const ads = (Array.isArray(paid) ? paid : []).filter((row) => row && (row.title || row.description));
  if (!ads.length) {
    return missing("copy_angles", "Ad copy", "quote", WEIGHTS.copy_angles, "No paid ad copy was in the regular Google results.");
  }
  const words = serviceWords(niche);
  let same = 0;
  let other = 0;
  for (const ad of ads) {
    const text = `${ad.title || ""} ${ad.description || ""}`.toLowerCase();
    const named = words.some((word) => text.includes(word));
    if (named) same += 1;
    else if (ANGLE.test(text)) other += 1;
  }
  const classified = same + other;
  if (!classified) {
    return missing("copy_angles", "Ad copy", "quote", WEIGHTS.copy_angles, "Paid ads had no readable service or offer language.");
  }
  return {
    id: "copy_angles",
    name: "Ad copy",
    icon: "quote",
    weight: WEIGHTS.copy_angles,
    status: "measured",
    score: Math.round((100 * same) / classified),
    raw_fact: `${same} of ${classified} ads name this service`,
    reason: null,
    evidence: { same_service: same, other_angle: other, classified }
  };
}

function repeatSignal(core, related) {
  if (!related || (related.status !== "measured" && related.status !== "measured_zero")) {
    return missing("repeat_advertisers", "Repeat advertisers", "repeat", WEIGHTS.repeat_advertisers, "A second keyword was not checked, so repeat advertisers were not compared.");
  }
  if (!core || (core.status !== "measured" && core.status !== "measured_zero")) {
    return missing("repeat_advertisers", "Repeat advertisers", "repeat", WEIGHTS.repeat_advertisers, "The core advertiser list was not measured, so overlap was not computed.");
  }
  const left = new Set((core.advertisers || []).map(advertiserKey).filter(Boolean));
  const right = new Set((related.advertisers || []).map(advertiserKey).filter(Boolean));
  const union = new Set([...left, ...right]);
  if (!union.size) {
    return {
      id: "repeat_advertisers",
      name: "Repeat advertisers",
      icon: "repeat",
      weight: WEIGHTS.repeat_advertisers,
      status: "measured",
      score: 0,
      raw_fact: "No advertisers on either search",
      reason: null,
      evidence: { overlap: 0, union: 0 }
    };
  }
  let overlap = 0;
  for (const key of left) if (right.has(key)) overlap += 1;
  return {
    id: "repeat_advertisers",
    name: "Repeat advertisers",
    icon: "repeat",
    weight: WEIGHTS.repeat_advertisers,
    status: "measured",
    score: Math.round((100 * overlap) / union.size),
    raw_fact: `${overlap} of ${union.size} advertisers show on both searches`,
    reason: null,
    evidence: { overlap, union: union.size }
  };
}

function seasonSignal(trends) {
  const season = trends && trends.seasonality;
  if (!season || season.status !== "measured" || !season.level) {
    return missing("seasonality", "Seasonality", "calendar", WEIGHTS.seasonality, "Trends did not return enough months to see a seasonal pattern.");
  }
  const score = season.level === "high" ? 45 : season.level === "medium" ? 60 : 85;
  const fact = season.level === "high"
    ? "Search interest swings hard through the year"
    : season.level === "medium"
      ? "Search interest moves some through the year"
      : "Search interest stays steady through the year";
  return {
    id: "seasonality",
    name: "Seasonality",
    icon: "calendar",
    weight: WEIGHTS.seasonality,
    status: "measured",
    score,
    raw_fact: fact,
    reason: null,
    evidence: { level: season.level, swing: season.swing }
  };
}

function isLeadGen(row) {
  if (row.domain && isDirectoryHost(row.domain)) return true;
  const name = norm(row.name).replace(/[^a-z0-9 ]+/g, " ");
  return LEAD_GEN_NAMES.some((label) => name === label || name.includes(label));
}

function localSignal(core) {
  const rows = core && (core.status === "measured" || core.status === "measured_zero") ? core.advertisers : null;
  if (!rows) {
    return missing("local_vs_national", "Local or national", "home", WEIGHTS.local_vs_national, "Advertisers were not listed, so local and national were not split.");
  }
  let local = 0;
  let national = 0;
  for (const row of rows) {
    if (isLeadGen(row)) national += 1;
    else if (row.domain) local += 1;
  }
  const classified = local + national;
  if (!classified) {
    return missing("local_vs_national", "Local or national", "home", WEIGHTS.local_vs_national, "Advertiser names could not be split into local and national.");
  }
  return {
    id: "local_vs_national",
    name: "Local or national",
    icon: local >= national ? "home" : "globe",
    weight: WEIGHTS.local_vs_national,
    status: "measured",
    score: Math.round((100 * local) / classified),
    raw_fact: `${local} local contractors and ${national} national lead gen sites`,
    reason: null,
    evidence: { local, national }
  };
}

function exampleBundle(now) {
  const day = 86400000;
  const stamp = (offsetDays) => new Date(now + offsetDays * day).toISOString().slice(0, 10);
  return {
    core: {
      status: "measured",
      advertisers: [
        { id: "AR1001", name: "Austin Plumbing Co", domain: "austinplumbing.example" },
        { id: "AR1002", name: "Hill Country Drains", domain: "hillcountry.example" },
        { id: "AR1003", name: "Angi", domain: "angi.com" }
      ]
    },
    related: {
      status: "measured",
      advertisers: [
        { id: "AR1001", name: "Austin Plumbing Co", domain: "austinplumbing.example" },
        { id: "AR1003", name: "Angi", domain: "angi.com" },
        { id: "AR1004", name: "Thumbtack", domain: "thumbtack.com" }
      ]
    },
    creatives: {
      status: "measured",
      creatives: [
        { advertiser_id: "AR1001", first_shown: stamp(-420), last_shown: stamp(-4) },
        { advertiser_id: "AR1002", first_shown: stamp(-30), last_shown: stamp(-2) },
        { advertiser_id: "AR1003", first_shown: stamp(-800), last_shown: stamp(-1) }
      ]
    },
    paid: [
      { title: "Emergency plumber in Austin. Call now", description: "", domain: "austinplumbing.example" },
      { title: "24 hour drain crew", description: "", domain: "hillcountry.example" },
      { title: "Angi plumbers. Compare quotes", description: "", domain: "angi.com" }
    ]
  };
}

function nowMs(now, measuredAt) {
  if (typeof now === "function") return now();
  if (Number.isFinite(now)) return now;
  const parsed = Date.parse(measuredAt || "");
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function explanation(signals, exampleData) {
  const bidding = signals.find((signal) => signal.id === "bidding_together");
  const length = signals.find((signal) => signal.id === "run_length");
  const repeat = signals.find((signal) => signal.id === "repeat_advertisers");
  const bits = [];
  if (exampleData) bits.push("Sample ads.");
  if (bidding && bidding.status === "measured") bits.push(`${bidding.raw_fact}.`);
  if (length && length.status === "measured") bits.push(`${length.raw_fact}.`);
  if (repeat && repeat.status === "measured") bits.push(`${repeat.raw_fact}.`);
  const missingCount = signals.filter((signal) => signal.status === "missing").length;
  if (missingCount) bits.push(`${missingCount} of ${signals.length} ads signals were not measured.`);
  if (!bits.length) bits.push("Ads signals were not measured, so this is not a score of 0.");
  return bits.join(" ");
}

export function buildAdsMarket({ niche, organic, trends, ads, origin, measuredAt, now } = {}) {
  const sample = origin !== "live";
  const fixture = sample ? exampleBundle(nowMs(now, measuredAt)) : null;
  const core = sample ? fixture.core : ads && ads.core;
  const related = sample ? fixture.related : ads && ads.related;
  const creatives = sample ? fixture.creatives : ads && ads.creatives;
  const paid = sample ? fixture.paid : (organic && organic.paid_results) || [];
  const signals = [
    durationSignal(creatives, nowMs(now, measuredAt)),
    biddingSignal(core, paid),
    copySignal(paid, niche),
    repeatSignal(core, related),
    seasonSignal(trends),
    localSignal(core)
  ];
  if (sample) {
    for (const signal of signals) {
      if (signal.status === "measured" && signal.id !== "seasonality") {
        signal.reason = "Example advertisers and ad dates. Not a live Ads Transparency lookup.";
        signal.evidence = { ...(signal.evidence || {}), example_data: true };
      }
    }
  }
  return {
    ...assembleSignalCard({
      id: "ads_market",
      title: "Ads market",
      higherMeans: "Higher means ads are a proven, steady channel in this niche.",
      signals,
      exampleData: sample,
      measuredAt,
      sources: [
        { name: "Google Ads advertisers", detail: "One live call for the core keyword and one for the near me phrase. Each is $0.002. Location is sent as a name, not a Maps location code." },
        { name: "Google Ads search", detail: "One live call for up to 25 advertiser ids, default depth 40, $0.002, only when ids come back. It supplies first and last shown dates." },
        { name: "Regular Google paid results", detail: "Ad copy is read from paid rows already returned with the organic call. No extra charge." },
        { name: "Trends", detail: "Seasonality uses the Trends series already pulled. A seasonal niche is labeled, not punished as a zero." }
      ],
      method: "Run length is 25 percent, bidding together is 20 percent, repeat advertisers are 20 percent, ad copy is 15 percent, seasonality is 10 percent, and local versus national is 10 percent. An advertiser counts as sustained at 90 days or more and a last shown date within 45 days. Missing signals are left out and the rest are rescaled. This is an index, not a recommendation.",
      footerSource: "Search ads and seasonality",
      explanation: explanation(signals, sample),
      balance: null
    }),
    requests: (ads && ads.audits) || []
  };
}
