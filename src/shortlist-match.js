import { nationalGuide } from "./discovery-fixtures.js";
import { HttpError } from "./errors.js";
import { priceFor } from "./job-prices.js";
import { priceForServiceNiche } from "./niche-prices.js";
import { resolveTypedCity } from "./city-pick.js";
import { stateIdentity } from "./state-fips.js";
import { US_STATE_ABBREVIATIONS, US_STATE_NAMES } from "./us-states.js";

const NATIONWIDE = new Set([
  "any",
  "any state",
  "any us state",
  "any us states",
  "any united states",
  "any united state",
  "nationwide",
  "national",
  "united states",
  "us",
  "usa",
  "all",
  "all states",
  "all us states",
  "all us state"
]);

const SKIP_CITIES = new Set(["murfreesboro", "midlothian", "coral gables"]);
const GENERIC = new Set([
  "a", "an", "and", "the", "or", "of", "for", "to", "in", "on", "near", "me",
  "service", "services", "repair", "repairs", "repairing", "install", "installation",
  "installing", "replacement", "replace", "replacing", "company", "contractor",
  "contractors", "pro", "local", "residential", "commercial", "emergency", "mobile",
  "job", "jobs", "work", "specialist", "specialists", "near", "my"
]);

const DESIGNATOR = /^(city|town|village|cdp|borough|municipality)$/i;
const POOL_SIZE = 30;
const ROW_CAP = 12;

const STATE_BY_USPS = new Map();
for (const [abbr, name] of US_STATE_ABBREVIATIONS) {
  const identity = stateIdentity(name);
  STATE_BY_USPS.set(abbr.toUpperCase(), {
    usps: abbr.toUpperCase(),
    name,
    title: titleState(name),
    fips: identity ? identity.fips : ""
  });
}

function titleState(name) {
  return String(name || "").split(" ").map((word) => (word === "of" ? "of" : word.charAt(0).toUpperCase() + word.slice(1))).join(" ");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(left, right) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index]);
  for (let col = 1; col <= right.length; col += 1) rows[0][col] = col;
  for (let row = 1; row <= left.length; row += 1) {
    for (let col = 1; col <= right.length; col += 1) {
      const cost = left[row - 1] === right[col - 1] ? 0 : 1;
      rows[row][col] = Math.min(rows[row - 1][col] + 1, rows[row][col - 1] + 1, rows[row - 1][col - 1] + cost);
    }
  }
  return rows[left.length][right.length];
}

function tokenMatches(token, stem) {
  const root = String(stem || "").replace(/ /g, "");
  if (!token || !root) return false;
  if (token === root) return true;
  if (root.length >= 4 && token.startsWith(root) && token.length - root.length <= 4) return true;
  if (token.length < 5 || root.length < 5) return false;
  const limit = Math.min(token.length, root.length) >= 8 ? 2 : 1;
  if (Math.abs(token.length - root.length) > limit) return false;
  return editDistance(token, root) <= limit;
}

function entryMatchesToken(entry, token) {
  if (entry.stems.some((stem) => tokenMatches(token, stem))) return true;
  return entry.phrases.some((phrase) => tokenMatches(token, phrase));
}

function distinctiveTokens(text) {
  return normalizeText(text).split(" ").filter((token) => token.length >= 3 && !GENERIC.has(token));
}

function phraseHit(text, entry) {
  let best = 0;
  let length = 0;
  const compactText = text.replace(/ /g, "");
  for (const phrase of entry.phrases) {
    if (!phrase) continue;
    const score = text === phrase ? 140 : (` ${text} `.includes(` ${phrase} `) ? 100 + phrase.length : 0);
    const compactScore = score === 0 && phrase.length >= 6 && compactText.includes(phrase.replace(/ /g, ""))
      ? 90 + phrase.length
      : 0;
    const chosen = Math.max(score, compactScore);
    if (chosen > best) {
      best = chosen;
      length = phrase.length;
    }
  }
  return { score: best, length };
}

// preference: lower sorts first when two niches match equally. Values under 20 are specific subniches.
const CATALOG = [
  { id: "mobile-welding", label: "Mobile welding", family: "welding", profile: "neutral", preference: 1, phrases: ["mobile welding", "mobile welder", "on site welding", "onsite welding", "field welding"], stems: ["weld", "welder", "welding"] },
  { id: "structural-welding", label: "Structural welding", family: "welding", profile: "neutral", preference: 2, phrases: ["structural welding", "steel welding", "structural steel"], stems: ["weld", "welder", "welding"] },
  { id: "pipe-welding", label: "Pipe welding", family: "welding", profile: "neutral", preference: 3, phrases: ["pipe welding", "pipeline welding"], stems: ["weld", "welder", "welding"] },
  { id: "foundation-repair", label: "Foundation repair", family: "foundation", profile: "foundation", preference: 1, phrases: ["foundation repair", "foundation", "pier and beam", "basement waterproofing", "waterproofing", "french drain", "slab repair"], stems: ["foundation", "waterproofing", "settlement"] },
  { id: "crawl-space", label: "Crawl space encapsulation", family: "crawl-space", profile: "foundation", preference: 1, phrases: ["crawl space encapsulation", "crawl space", "crawlspace", "encapsulation"], stems: ["crawl", "crawlspace", "encapsulation"] },
  { id: "septic", label: "Septic installation", family: "septic", profile: "neutral", preference: 1, phrases: ["septic installation", "septic system", "septic tank", "septic", "drain field"], stems: ["septic"] },
  { id: "driveway", label: "Concrete driveway replacement", family: "driveway", profile: "neutral", preference: 1, phrases: ["concrete driveway", "driveway", "driveways"], stems: ["driveway"] },
  { id: "retaining-wall", label: "Retaining wall replacement", family: "retaining-wall", profile: "neutral", preference: 1, phrases: ["retaining wall", "retaining walls", "retaining"], stems: ["retaining"] },
  { id: "roofing", label: "Roofing", family: "roofing", profile: "neutral", preference: 1, phrases: ["roof replacement", "roof repair", "roofing", "shingles", "shingle"], stems: ["roof", "roofing", "roofer", "shingle"] },
  { id: "locksmith", label: "Locksmith", family: "locksmith", profile: "neutral", preference: 1, phrases: ["locksmith", "lockout", "rekey", "re key"], stems: ["locksmith", "lockout", "rekey"] },
  { id: "plumbing", label: "Plumbing", family: "plumbing", profile: "neutral", preference: 30, phrases: ["plumbing", "plumber", "plumbers"], stems: ["plumb", "plumber", "plumbing"] },
  { id: "emergency-plumbing", label: "Emergency plumbing", family: "plumbing", profile: "neutral", preference: 1, phrases: ["emergency plumbing", "emergency plumber"], stems: ["plumb"] },
  { id: "drain-cleaning", label: "Drain cleaning", family: "plumbing", profile: "neutral", preference: 2, phrases: ["drain cleaning", "drain cleaner", "clogged drain"], stems: ["drain", "clog"] },
  { id: "water-heater-repair", label: "Water heater repair", family: "plumbing", profile: "neutral", preference: 3, phrases: ["water heater", "hot water heater", "tankless"], stems: ["heater"] },
  { id: "sewer-line", label: "Sewer line service", family: "plumbing", profile: "neutral", preference: 4, phrases: ["sewer line", "sewer"], stems: ["sewer"] },
  { id: "hvac", label: "HVAC repair", family: "hvac", profile: "neutral", preference: 1, phrases: ["heating and cooling", "air conditioning", "air conditioner", "heat pump", "hvac", "furnace"], stems: ["hvac", "furnace", "heating"] },
  { id: "electrician", label: "Electrician", family: "electrician", profile: "neutral", preference: 1, phrases: ["electrician", "electrical"], stems: ["electric", "electrician"] },
  { id: "garage-door", label: "Garage door repair", family: "garage-door", profile: "neutral", preference: 1, phrases: ["garage door"], stems: ["garage"] },
  { id: "concrete", label: "Concrete", family: "concrete", profile: "neutral", preference: 1, phrases: ["concrete"], stems: ["concrete"] },
  { id: "painting", label: "Painting", family: "painting", profile: "neutral", preference: 1, phrases: ["painting", "painter"], stems: ["paint", "painter"] },
  { id: "pest-control", label: "Pest control", family: "pest", profile: "neutral", preference: 1, phrases: ["pest control", "exterminator", "termite"], stems: ["pest", "termite", "rodent"] },
  { id: "gutter", label: "Gutter service", family: "gutter", profile: "neutral", preference: 1, phrases: ["gutter"], stems: ["gutter"] },
  { id: "siding", label: "Siding", family: "siding", profile: "neutral", preference: 1, phrases: ["siding"], stems: ["siding"] },
  { id: "landscaping", label: "Landscaping", family: "landscaping", profile: "neutral", preference: 1, phrases: ["landscaping", "landscaper", "lawn care"], stems: ["landscape", "landscaper", "lawn"] },
  { id: "handyman", label: "Handyman", family: "handyman", profile: "neutral", preference: 1, phrases: ["handyman"], stems: ["handyman"] },
  { id: "appliance-repair", label: "Appliance repair", family: "appliance", profile: "neutral", preference: 1, phrases: ["appliance repair", "appliance"], stems: ["appliance"] },
  { id: "flooring", label: "Flooring", family: "flooring", profile: "neutral", preference: 1, phrases: ["flooring"], stems: ["flooring", "floor"] }
];

function takeMatches(hits) {
  const ranked = hits.slice().sort((left, right) => right.score - left.score || left.entry.preference - right.entry.preference || left.entry.label.localeCompare(right.entry.label));
  const seen = new Set();
  const out = [];
  for (const hit of ranked) {
    if (seen.has(hit.entry.id)) continue;
    seen.add(hit.entry.id);
    out.push(hit.entry);
    if (out.length >= 4) break;
  }
  return out;
}

function expandBroadParent(matches, text) {
  if (matches.length !== 1) return matches;
  const parent = matches[0];
  if (parent.preference < 20) return matches;
  const tokens = distinctiveTokens(text);
  const broad = tokens.length === 1 && parent.stems.some((stem) => tokenMatches(tokens[0], stem));
  if (!broad) return matches;
  const childSpecific = CATALOG.some((entry) => entry.id !== parent.id && entry.family === parent.family && phraseHit(text, entry).score >= 100);
  if (childSpecific) return matches;
  const children = CATALOG.filter((entry) => entry.family === parent.family && entry.id !== parent.id && entry.preference < 20)
    .sort((left, right) => left.preference - right.preference || left.label.localeCompare(right.label))
    .slice(0, 3);
  return [parent, ...children];
}

function matchOne(text) {
  const normalized = normalizeText(text);
  if (normalized.length < 2) return [];
  const phraseHits = [];
  for (const entry of CATALOG) {
    const hit = phraseHit(normalized, entry);
    if (hit.score >= 90) phraseHits.push({ entry, score: hit.score, length: hit.length });
  }
  if (phraseHits.length) {
    const longest = Math.max(...phraseHits.map((hit) => hit.length));
    const specific = phraseHits.filter((hit) => hit.length === longest || hit.score >= 140);
    return expandBroadParent(takeMatches(specific), normalized);
  }
  const tokens = distinctiveTokens(normalized);
  if (!tokens.length) return [];
  const full = CATALOG.filter((entry) => tokens.every((token) => entryMatchesToken(entry, token))).map((entry) => ({ entry, score: 80 }));
  if (full.length) return takeMatches(full);
  const partial = CATALOG.filter((entry) => tokens.some((token) => entry.stems.some((stem) => tokenMatches(token, stem)))).map((entry) => ({ entry, score: 60 }));
  if (!partial.length) return [];
  return expandBroadParent(takeMatches(partial), normalized);
}

function splitParts(service) {
  const full = normalizeText(service);
  const keepsAnd = CATALOG.some((entry) => entry.phrases.some((phrase) => phrase.includes(" and ") && (full === phrase || ` ${full} `.includes(` ${phrase} `))));
  if (keepsAnd) return [full];
  const parts = String(service || "").split(/[,;/]|\band\b/i).map((part) => normalizeText(part)).filter((part) => part.length >= 2);
  return parts.length > 1 ? parts : [full];
}

export function matchShortlistServices(service) {
  const parts = splitParts(service);
  if (parts.length > 1) {
    const found = [];
    for (const part of parts) {
      for (const entry of matchOne(part)) {
        if (!found.some((item) => item.id === entry.id)) found.push(entry);
      }
    }
    return found.slice(0, 6);
  }
  return matchOne(parts[0] || "").slice(0, 4);
}

export function parseDiscoveryRegion(raw) {
  if (typeof raw !== "string") {
    throw new HttpError(400, "invalid_region", "Enter a US state name, a 2-letter code, or any U.S. state.");
  }
  const trimmed = raw.trim();
  if (trimmed.length > 80) {
    throw new HttpError(400, "invalid_region", "Enter a region of 80 characters or fewer.");
  }
  let text = normalizeText(trimmed);
  if (NATIONWIDE.has(text) || text === "") {
    return { scope: "nationwide", label: "any U.S. state", state: null, input: trimmed };
  }
  text = text.replace(/ (us|usa|united states)$/, "").trim();
  if (text === "washington dc" || text === "washington d c") text = "district of columbia";
  if (!text || NATIONWIDE.has(text)) {
    return { scope: "nationwide", label: "any U.S. state", state: null, input: trimmed };
  }
  const compact = text.replace(/ /g, "");
  if (compact.length === 2) {
    const name = US_STATE_ABBREVIATIONS.get(compact);
    if (!name) {
      throw new HttpError(400, "invalid_region", `Enter a US state name, a 2-letter code, or any U.S. state. "${trimmed.slice(0, 40)}" is not a state.`);
    }
    return regionState(name, trimmed);
  }
  if (US_STATE_NAMES.has(text)) return regionState(text, trimmed);
  throw new HttpError(400, "invalid_region", `Enter a US state name, a 2-letter code, or any U.S. state. "${trimmed.slice(0, 40)}" is not a state.`);
}

function regionState(name, input) {
  const identity = stateIdentity(name);
  const meta = identity ? STATE_BY_USPS.get(identity.usps) : null;
  if (!meta) {
    throw new HttpError(400, "invalid_region", "Enter a US state name, a 2-letter code, or any U.S. state.");
  }
  return { scope: "state", label: meta.title, state: meta, input };
}

function stripDesignator(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && DESIGNATOR.test(parts[parts.length - 1])) return parts.slice(0, -1).join(" ");
  return parts.join(" ");
}

function labelCandidates(censusName) {
  const raw = String(censusName || "").trim();
  const labels = [];
  const push = (value) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length >= 2 && text.length <= 48 && !labels.includes(text)) labels.push(text);
  };
  if (/balance|metropolitan government|metro government|unified government|consolidated government|urban county/i.test(raw)) {
    const head = raw
      .replace(/\s*\([^)]*balance[^)]*\)/ig, " ")
      .replace(/\b(metropolitan|metro|unified|consolidated)\s+government\b/ig, " ")
      .replace(/\burban county\b/ig, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(/[-/]/)[0]
      .trim();
    push(head);
  }
  push(stripDesignator(raw));
  push(raw);
  return labels;
}

function olderShare(row) {
  if (!row || row.old_partial) return null;
  if (!Number.isFinite(row.old) || !Number.isFinite(row.ytot) || row.ytot <= 0 || row.old < 0) return null;
  return row.old / row.ytot;
}

function relative(value, peers) {
  const nums = peers.filter((item) => typeof item === "number" && Number.isFinite(item));
  if (nums.length < 2) return 50;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (max === min) return 50;
  return ((value - min) * 100) / (max - min);
}

function measuredPlaces(extract, usps) {
  const places = [];
  for (const [geoid, row] of Object.entries((extract && extract.places) || {})) {
    if (!row || (usps && row.st !== usps)) continue;
    if (!Number.isFinite(row.hu) || row.hu <= 0 || !Number.isFinite(row.occ) || row.occ <= 0) continue;
    if (!Number.isFinite(row.own) || row.own < 0) continue;
    const meta = STATE_BY_USPS.get(row.st);
    if (!meta) continue;
    const owner = row.own / row.occ;
    if (!Number.isFinite(owner)) continue;
    places.push({
      geoid,
      n: row.n,
      st: row.st,
      hu: row.hu,
      occ: row.occ,
      own: row.own,
      owner,
      older: olderShare(row),
      inc: Number.isFinite(row.inc) ? row.inc : null,
      stateTitle: meta.title,
      usps: meta.usps
    });
  }
  return places;
}

function preferMunicipal(pool) {
  const municipal = pool.filter((place) => /\s(city|town|village|borough)$/i.test(place.n) && !/\b(cdp|balance)\b/i.test(place.n));
  return municipal.length >= 8 ? municipal : pool;
}

function scorePool(places, profile) {
  const sized = places.slice().sort((left, right) => right.hu - left.hu || left.n.localeCompare(right.n)).slice(0, POOL_SIZE);
  const pool = preferMunicipal(sized);
  const housing = pool.map((place) => place.hu);
  const owners = pool.map((place) => place.owner);
  const olders = pool.map((place) => place.older).filter((value) => value != null);
  for (const place of pool) {
    const housingIndex = relative(place.hu, housing);
    const ownerIndex = relative(place.owner, owners);
    const olderIndex = place.older == null ? null : relative(place.older, olders);
    if (profile === "foundation") {
      const parts = [[olderIndex, 35], [ownerIndex, 20], [housingIndex, 15]].filter((part) => part[0] != null);
      const weight = parts.reduce((sum, part) => sum + part[1], 0);
      place.score = parts.reduce((sum, part) => sum + part[0] * part[1], 0) / weight;
    } else {
      place.score = (housingIndex + ownerIndex) / 2;
    }
  }
  pool.sort((left, right) => right.score - left.score || right.hu - left.hu || left.n.localeCompare(right.n));
  return pool;
}

function resolvableLabel(place, requireResolvable) {
  const labels = labelCandidates(place.n);
  for (const label of labels) {
    if (SKIP_CITIES.has(normalizeText(label))) return null;
  }
  if (!requireResolvable) {
    const label = labels.find((item) => !SKIP_CITIES.has(normalizeText(item)));
    return label ? { ...place, label } : null;
  }
  for (const label of labels) {
    if (SKIP_CITIES.has(normalizeText(label))) continue;
    const resolved = resolveTypedCity(`${label}, ${place.stateTitle}`);
    if (resolved.selected && resolved.place && resolved.place.geoid === place.geoid) {
      return { ...place, label: resolved.place.name || label };
    }
  }
  return null;
}

function acceptedCities(pool, requireResolvable, limit) {
  const out = [];
  for (const place of pool) {
    const city = resolvableLabel(place, requireResolvable);
    if (!city) continue;
    if (SKIP_CITIES.has(normalizeText(city.label))) continue;
    out.push(city);
    if (out.length >= limit) break;
  }
  return out;
}

function citiesForProfile(extract, region, profile, options) {
  const requireResolvable = options.requireResolvable !== false;
  if (region.scope === "nationwide") {
    const winners = [];
    for (const meta of STATE_BY_USPS.values()) {
      const pool = scorePool(measuredPlaces(extract, meta.usps), profile);
      const city = acceptedCities(pool, requireResolvable, 1)[0];
      if (city) winners.push(city);
    }
    winners.sort((left, right) => {
      if (profile === "foundation" && left.older != null && right.older != null && left.older !== right.older) return right.older - left.older;
      if (left.owner !== right.owner) return right.owner - left.owner;
      return right.hu - left.hu || left.label.localeCompare(right.label);
    });
    return winners.slice(0, 8);
  }
  const pool = scorePool(measuredPlaces(extract, region.state.usps), profile);
  return acceptedCities(pool, requireResolvable, 24);
}

function notMeasured(note) {
  return { status: "unavailable", value: null, note };
}

function notFetched(note) {
  return { status: "not_fetched", value: null, note };
}

function measured(value, note) {
  return { status: "measured", value, note };
}

function publishedPrice(price, note) {
  if (!price || price.status !== "published" || price.pending_review === true) return null;
  if (!Number.isInteger(price.low_dollars) || !Number.isInteger(price.high_dollars)) return null;
  const unit = price.unit === "hour" || price.unit === "per_hour" ? "hour" : "per_job";
  return {
    status: "published",
    estimated: price.estimated === true,
    low_dollars: price.low_dollars,
    high_dollars: price.high_dollars,
    unit,
    city_adjusted: false,
    source_name: price.source_name || null,
    source_url: price.source_url || price.url || null,
    note: note || price.note || "National range on file. Not a city average."
  };
}

function priceForEntry(entry) {
  const specific = publishedPrice(priceFor(entry.id), "National range on file. Not adjusted for this city.");
  if (specific) return specific;
  if (entry.family === "septic" || entry.family === "driveway" || entry.family === "retaining-wall") {
    const guide = publishedPrice(nationalGuide(entry.family));
    if (guide) return guide;
  }
  const parent = publishedPrice(priceForServiceNiche(entry.id), "National range on file. Not adjusted for this city.");
  if (parent) return parent;
  return {
    status: "unavailable",
    low_dollars: null,
    high_dollars: null,
    city_adjusted: false,
    note: "Not measured. No published price guide was on file. A price was not invented."
  };
}

function whyLine(entry, city) {
  const parts = ["Measured owner-occupied share and housing units from the 2023 ACS place extract."];
  if (entry.profile === "foundation" && city.older != null) {
    parts.push("Older housing is included because this is foundation or crawl-space work.");
  }
  parts.push("Search volume, CPC, and competitor counts were not measured.");
  return parts.join(" ");
}

function candidateRow(entry, city) {
  const price = priceForEntry(entry);
  return {
    id: `census-${city.geoid}-${entry.id}`,
    service: entry.label,
    service_family: entry.family,
    service_id: entry.id,
    city: city.label,
    state: city.stateTitle,
    state_usps: city.usps,
    geoid: city.geoid,
    rank_score: city.score,
    profile: entry.profile,
    fallback_id: null,
    population_edge: {
      status: "not_enough_evidence",
      nearby_center: null,
      note: "Not measured. A population edge was not invented."
    },
    census: {
      source_name: "American Community Survey 5-year, 2023 release, bundled extract",
      source_url: "https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData/",
      note: "Bundled public extract. Not a live Census API call.",
      population: notMeasured("Not measured. This extract has housing counts, not a population estimate. Population was not invented."),
      households: measured(city.occ, "Occupied housing units in the 2023 ACS extract. Not a population count."),
      owner_occupancy_rate: measured(city.owner, "Owner-occupied units divided by occupied units in the 2023 ACS extract."),
      median_home_value: notMeasured("Not measured. Median home value is not in this extract."),
      median_household_income: city.inc == null
        ? notMeasured("Not measured. Median household income was not in the extract for this place.")
        : { ...measured(city.inc, "Median household income in the 2023 ACS extract. Shown as context. It is not used to rank."), excluded_from_rank: true },
      housing_age: city.older == null
        ? notFetched("Not fetched. A pre-1980 year-built count was missing, so housing age was not filled in.")
        : measured(city.older, "Share of housing units built in 1979 or earlier in the 2023 ACS extract."),
      keep_measured_housing_age: true
    },
    price,
    competition: {
      map_pack: "not_fetched",
      ordered_pack: false,
      strongest_in_town_ratings: null,
      places: [],
      note: "Not fetched. A competitor count was not invented."
    },
    best_query: notFetched("Not fetched. A best-query check was not run."),
    sponsored_ads: notFetched("Not fetched. Ads were not checked."),
    state_operator_count: notFetched("Not measured. An operator count was not invented."),
    search_volume: notMeasured("Not measured. Search volume was not fetched and was not invented."),
    cpc: notMeasured("Not measured. CPC was not fetched and was not invented."),
    named_label: "Not measured",
    explicit_hold: null,
    why: whyLine(entry, city)
  };
}

export function buildRegionCandidates(services, region, extract, options = {}) {
  const perService = Math.max(1, Math.min(8, Math.ceil(8 / Math.max(services.length, 1))));
  const pools = new Map();
  const used = new Map();
  const rows = [];
  for (const entry of services) {
    if (!pools.has(entry.profile)) pools.set(entry.profile, citiesForProfile(extract, region, entry.profile, options));
    const pool = pools.get(entry.profile);
    const seen = used.get(entry.profile) || new Set();
    let count = 0;
    for (const city of pool) {
      if (seen.has(city.geoid)) continue;
      seen.add(city.geoid);
      rows.push(candidateRow(entry, city));
      count += 1;
      if (count >= perService || rows.length >= ROW_CAP) break;
    }
    used.set(entry.profile, seen);
    if (rows.length >= ROW_CAP) break;
  }
  rows.forEach((row, index) => {
    row.rank_score = rows.length - index;
  });
  return rows;
}

export const SHORTLIST_CENSUS_SOURCE = "American Community Survey 5-year, 2023 release, bundled place extract";
