import {
  KEYWORD_IDEAS_LIMIT,
  KEYWORD_IDEAS_PATH,
  KEYWORD_IDEAS_SOURCE,
  LANGUAGE_CODE,
  US_LOCATION_CODE
} from "./config.js";
import { HttpError } from "./errors.js";
import { priceFor } from "./job-prices.js";

export const DISCOVERY_CACHE_VERSION = "keyword-ideas-v1";
export const SUBNICHE_RESULT_CAP = 12;

const GENERIC = new Set([
  "a", "an", "and", "the", "or", "of", "for", "to", "in", "on", "my", "me", "near", "nearby",
  "best", "top", "local", "pro", "professional", "service", "services", "company", "companies",
  "contractor", "contractors", "repair", "repairs", "repairing", "install", "installation",
  "installing", "installer", "installers", "replacement", "replace", "maintenance", "maintain",
  "emergency", "residential", "commercial", "cost", "costs", "price", "prices", "cheap",
  "affordable", "24", "7", "hour", "hours", "usa", "us", "united", "states", "national"
]);

const INFORMATIONAL = new Set([
  "job", "jobs", "salary", "salaries", "wage", "wages", "career", "careers", "hiring",
  "school", "schools", "training", "class", "classes", "course", "courses", "certification",
  "certificate", "how", "diy", "wikipedia", "definition", "what", "vs", "versus", "reddit",
  "youtube", "amazon", "apprenticeship", "degree", "resume"
]);

const SUFFIXES = new Set(["ers", "er", "ing", "es", "s"]);
const ACRONYMS = new Set(["hvac", "tig", "mig", "ac", "pvc"]);

// Acceptance and rejection only. These groups are never returned as a filler catalog.
const TRADE_GROUPS = [
  { id: "hvac", terms: ["hvac", "furnace", "heat pump", "air conditioning", "air conditioner", "heating and cooling", "ac"] },
  { id: "weld", terms: ["weld"] },
  { id: "plumb", terms: ["plumb"] },
  { id: "electric", terms: ["electric", "electrical", "electrician"] },
  { id: "locksmith", terms: ["locksmith", "lockout", "rekey"] },
  { id: "garage-door", terms: ["garage door"] },
  { id: "roof", terms: ["roof"] },
  { id: "pest", terms: ["pest"] },
  { id: "landscape", terms: ["landscaping", "landscaper", "lawn"] },
  { id: "paint", terms: ["paint"] },
  { id: "concrete", terms: ["concrete"] },
  { id: "flooring", terms: ["flooring"] },
  { id: "handyman", terms: ["handyman"] },
  { id: "gutter", terms: ["gutter"] },
  { id: "siding", terms: ["siding"] },
  { id: "appliance", terms: ["appliance"] },
  { id: "retaining-wall", terms: ["retaining wall"] },
  { id: "crawl-space", terms: ["crawl space"] }
];

export function normalizePhrase(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\ba c\b/g, "ac")
    .replace(/\s+/g, " ")
    .trim();
}

export function keywordIdeasSeed(keyword) {
  const raw = String(keyword || "").trim();
  if (raw.length < 2 || raw.length > 80) {
    throw new HttpError(400, "invalid_input", "Enter a service keyword of 2-80 characters.");
  }
  const seed = normalizePhrase(raw);
  if (seed.length < 2 || seed.length > 80) {
    throw new HttpError(400, "invalid_input", "Enter a service keyword of 2-80 characters.");
  }
  if (seed.split(" ").length > 10) {
    throw new HttpError(400, "invalid_input", "Use 10 words or fewer.");
  }
  return seed;
}

function tokensOf(value) {
  return normalizePhrase(value).split(" ").filter(Boolean);
}

function sameStem(token, root) {
  if (token === root) return true;
  if (root.length < 4 || !token.startsWith(root)) return false;
  return SUFFIXES.has(token.slice(root.length));
}

function matchesTerm(tokens, term) {
  const parts = term.split(" ");
  for (let index = 0; index <= tokens.length - parts.length; index += 1) {
    const hit = parts.every((part, offset) => sameStem(tokens[index + offset] || "", part));
    if (hit) return true;
  }
  return false;
}

function groupsFor(tokens) {
  return TRADE_GROUPS.filter((group) => group.terms.some((term) => matchesTerm(tokens, term))).map((group) => group.id);
}

export function inTradePhrase(seed, phrase) {
  const seedTokens = tokensOf(seed);
  const phraseTokens = tokensOf(phrase);
  if (!seedTokens.length || !phraseTokens.length) return false;
  if (phraseTokens.some((token) => INFORMATIONAL.has(token))) return false;
  const seedGroups = new Set(groupsFor(seedTokens));
  const phraseGroups = groupsFor(phraseTokens);
  if (phraseGroups.some((group) => !seedGroups.has(group))) return false;
  if (seedGroups.size) return phraseGroups.some((group) => seedGroups.has(group));
  const required = seedTokens.filter((token) => !GENERIC.has(token));
  const needed = required.length ? required : seedTokens;
  return needed.every((token) => phraseTokens.some((candidate) => sameStem(candidate, token) || sameStem(token, candidate)));
}

export function displayLabel(phrase) {
  return normalizePhrase(phrase).split(" ").map((word) => {
    if (ACRONYMS.has(word)) return word.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
}

export function slugForLabel(label) {
  return normalizePhrase(label).replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/^-|-$/g, "").slice(0, 64);
}

export function keywordIdeasTask(seed, locationCode = US_LOCATION_CODE) {
  return {
    keywords: [seed],
    location_code: locationCode,
    language_code: LANGUAGE_CODE,
    closely_variants: true,
    include_serp_info: false,
    include_clickstream_data: false,
    limit: KEYWORD_IDEAS_LIMIT,
    order_by: ["keyword_info.search_volume,desc"]
  };
}

export function keywordIdeasBody(seed, locationCode = US_LOCATION_CODE) {
  return [keywordIdeasTask(seed, locationCode)];
}

export function discoveryCacheKey(seed, locationCode = US_LOCATION_CODE) {
  return `${seed}|${locationCode}|${DISCOVERY_CACHE_VERSION}`;
}

function providerCost(payload) {
  const task = payload && Array.isArray(payload.tasks) ? payload.tasks[0] : null;
  if (task && typeof task.cost === "number" && Number.isFinite(task.cost)) return task.cost;
  if (payload && typeof payload.cost === "number" && Number.isFinite(payload.cost)) return payload.cost;
  return null;
}

export function parseKeywordIdeas(payload) {
  const task = payload && Array.isArray(payload.tasks) ? payload.tasks[0] : null;
  const status = task && task.status_code;
  if (!task || status !== 20000) {
    const detail = task && typeof task.status_message === "string" ? task.status_message : "Keyword ideas were not returned.";
    const error = new HttpError(502, "keyword_ideas_failed", `DataForSEO keyword ideas failed. Example specialties were not substituted. ${detail}`.slice(0, 320));
    error.provider_cost_usd = providerCost(payload);
    throw error;
  }
  const result = Array.isArray(task.result) ? task.result[0] : null;
  const items = result && Array.isArray(result.items) ? result.items : [];
  return {
    cost: providerCost(payload),
    items: items.map((item) => {
      const info = item && item.keyword_info;
      const volume = info && Number.isInteger(info.search_volume) ? info.search_volume : null;
      return {
        keyword: item && typeof item.keyword === "string" ? item.keyword : "",
        volume
      };
    })
  };
}

const CLUSTER_STOP = new Set([
  "a", "an", "and", "the", "or", "of", "for", "to", "in", "on", "my", "me", "near", "nearby",
  "best", "top", "local", "pro", "professional", "service", "services", "company", "companies",
  "contractor", "contractors"
]);

function ideaClusterToken(token) {
  if (token.length >= 6 && token.endsWith("ing")) return token.slice(0, -3);
  if (token.length >= 5 && token.endsWith("ers")) return token.slice(0, -3);
  if (token.length >= 4 && token.endsWith("er")) return token.slice(0, -2);
  if (token.length >= 4 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function ideaClusterKey(phrase) {
  const tokens = tokensOf(phrase).filter((token) => !CLUSTER_STOP.has(token));
  const used = (tokens.length ? tokens : tokensOf(phrase)).map(ideaClusterToken).filter(Boolean);
  return used.slice().sort().join(" ");
}

function clusterIdeas(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = ideaClusterKey(row.keyword) || row.keyword;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const clusters = [];
  for (const members of groups.values()) {
    members.sort((left, right) => right.volume - left.volume || left.keyword.localeCompare(right.keyword));
    const representative = members[0];
    clusters.push({
      keyword: representative.keyword,
      volume: representative.volume,
      phrases: members.map((member) => member.keyword)
    });
  }
  clusters.sort((left, right) => right.volume - left.volume || left.keyword.localeCompare(right.keyword));
  return clusters;
}

function rankingNote({ inTrade, unmeasured, returned }) {
  if (!inTrade && unmeasured > 0) {
    const noun = unmeasured === 1 ? "idea stays" : "ideas stay";
    return `${unmeasured} keyword ${noun} in this trade but had no measured search volume, so nothing was ranked. Other trades were not added, and the example trade list was not used.`;
  }
  if (!inTrade) {
    return "None of the keyword ideas stayed inside this trade. Other trades were not added, and the example trade list was not used.";
  }
  const sparse = inTrade < 3
    ? ` Only ${inTrade} in-trade idea${inTrade === 1 ? "" : "s"} had measured United States search volume.`
    : "";
  const cap = inTrade > returned ? ` Showing the ${returned} highest-volume ideas.` : "";
  return `Ranked by United States Google search volume from DataForSEO keyword ideas. Ideas from other trades were removed.${sparse}${cap} This is not a city score.`;
}

export function rankInTradeIdeas(seed, rawItems, displayKeyword = seed) {
  let filteredOut = 0;
  let unmeasured = 0;
  const kept = [];
  for (const item of Array.isArray(rawItems) ? rawItems : []) {
    const keyword = normalizePhrase(item && item.keyword);
    if (!keyword || !inTradePhrase(seed, keyword)) {
      filteredOut += 1;
      continue;
    }
    const volume = Number.isInteger(item.volume) ? item.volume : null;
    if (volume == null || volume < 1) {
      unmeasured += 1;
      continue;
    }
    kept.push({ keyword, volume });
  }
  const clusters = clusterIdeas(kept);
  const shown = clusters.slice(0, SUBNICHE_RESULT_CAP);
  const used = new Set();
  const subniches = shown.map((cluster, index) => {
    const label = displayLabel(cluster.keyword);
    let id = slugForLabel(label) || "specialty";
    let suffix = 2;
    while (used.has(id)) {
      id = `${slugForLabel(label) || "specialty"}-${suffix}`;
      suffix += 1;
    }
    used.add(id);
    const others = cluster.phrases.filter((phrase) => phrase !== cluster.keyword).map(displayLabel);
    return {
      id,
      label,
      search_volume: cluster.volume,
      search_volume_status: "measured",
      cluster_phrases: cluster.phrases.map(displayLabel),
      example_rank: index + 1,
      evidence: "United States Google keyword ideas via DataForSEO. Approximate average monthly searches. Not a city measurement.",
      note: others.length
        ? `United States keyword idea. Same cluster: ${others.join(", ")}.`
        : "United States keyword idea. Not a city score.",
      match: { tier: "none", specific_terms: [], matched_terms: [], label: null },
      price: priceFor(id)
    };
  });
  const known = subniches.length > 0;
  return {
    known_profile: known,
    profile_id: known ? "live-keyword-ideas" : null,
    ranking_kind: "live_keyword_ideas",
    ranking_note: rankingNote({ inTrade: clusters.length, unmeasured, returned: subniches.length }),
    row_count: subniches.length,
    raw_item_count: Array.isArray(rawItems) ? rawItems.length : 0,
    in_trade_count: clusters.length,
    filtered_out_count: filteredOut,
    unmeasured_in_trade_count: unmeasured,
    subniches,
    unranked_option: known ? null : {
      id: "unranked-keyword",
      label: String(displayKeyword || seed).trim() || displayLabel(seed),
      example_rank: null,
      note: "No in-trade specialty was returned. This is the keyword you typed, not a researched specialty and not an example trade."
    }
  };
}

export async function discoverSubniches(keyword, transport, locationCode = US_LOCATION_CODE) {
  const seed = keywordIdeasSeed(keyword);
  const payload = await transport.request({
    method: "POST",
    path: KEYWORD_IDEAS_PATH,
    body: keywordIdeasBody(seed, locationCode)
  });
  const parsed = parseKeywordIdeas(payload);
  const ranked = rankInTradeIdeas(seed, parsed.items, String(keyword || "").trim());
  return {
    ...ranked,
    seed,
    source: KEYWORD_IDEAS_SOURCE,
    provider_cost_usd: parsed.cost,
    cost_source: parsed.cost == null ? "estimate_fallback" : "provider",
    paid_dataforseo_called: true
  };
}
