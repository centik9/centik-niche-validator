import { matchCityInState } from "./trends-location.js";
import { loadExtractCatalog } from "./screen.js";
import { normalizePlace } from "./normalize.js";
import { normalizeState } from "./states.js";
import { stateIdentity } from "./state-fips.js";
import { US_STATE_NAMES } from "./us-states.js";

const DESIGNATOR = /^(city|town|village|cdp|borough|municipality)$/i;
const COUNTRY_TAIL = new Set(["united states", "usa", "us", "u s"]);

let directoryCache = null;

function titleState(name) {
  return String(name || "").split(" ").map((word) => (word === "of" ? "of" : word.charAt(0).toUpperCase() + word.slice(1))).join(" ");
}

function stateCatalog() {
  const byUsps = new Map();
  const byNorm = new Map();
  for (const name of US_STATE_NAMES) {
    const identity = stateIdentity(name);
    if (!identity) continue;
    const meta = { ...identity, title: titleState(identity.name), norm: identity.name };
    byUsps.set(identity.usps, meta);
    byNorm.set(identity.name, meta);
  }
  return { byUsps, byNorm };
}

function stripTrailingDesignator(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && DESIGNATOR.test(parts[parts.length - 1])) return parts.slice(0, -1).join(" ");
  return parts.join(" ");
}

function stripAllDesignators(name) {
  const parts = String(name || "").trim().split(/\s+/).filter((part) => part && !DESIGNATOR.test(part));
  return parts.join(" ");
}

function slug(name) {
  return normalizePlace(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function locationRow(code, placeName, meta, parentCode) {
  return {
    location_code: code,
    location_name: `${placeName},${meta.title},United States`,
    location_type: parentCode ? "City" : (meta.usps === "DC" ? "Territory" : "State"),
    country_iso_code: "US",
    location_code_parent: parentCode
  };
}

function placeDirectory() {
  if (directoryCache) return directoryCache;
  const { byUsps } = stateCatalog();
  const extract = loadExtractCatalog();
  const stateRows = [];
  const parentCode = new Map();
  for (const meta of byUsps.values()) {
    const code = 8000000 + Number(meta.fips);
    parentCode.set(meta.usps, code);
    stateRows.push(locationRow(code, meta.title, meta, null));
  }
  const primaryCities = [];
  const looseCities = [];
  const byNorm = new Map();
  const byLoose = new Map();
  const byCode = new Map();
  for (const [geoid, row] of Object.entries(extract.places || {})) {
    const meta = byUsps.get(row.st);
    if (!meta) continue;
    const code = Number(geoid);
    if (!Number.isInteger(code) || byCode.has(code)) continue;
    const display = stripTrailingDesignator(row.n);
    const loose = stripAllDesignators(row.n);
    if (!display || !normalizePlace(display)) continue;
    const entry = {
      geoid,
      code,
      census_name: row.n,
      name: display,
      nameNorm: normalizePlace(display),
      looseNorm: normalizePlace(loose),
      state: meta.title,
      stateNorm: meta.norm,
      usps: meta.usps
    };
    byCode.set(code, entry);
    primaryCities.push(locationRow(code, display, meta, parentCode.get(meta.usps)));
    pushGroup(byNorm, entry.nameNorm, entry);
    if (entry.looseNorm && entry.looseNorm !== entry.nameNorm) {
      looseCities.push(locationRow(code, loose, meta, parentCode.get(meta.usps)));
      pushGroup(byLoose, entry.looseNorm, entry);
    }
  }
  directoryCache = {
    primaryRows: stateRows.concat(primaryCities),
    looseRows: stateRows.concat(looseCities),
    byNorm,
    byLoose,
    byCode
  };
  return directoryCache;
}

function pushGroup(map, key, entry) {
  const list = map.get(key) || [];
  list.push(entry);
  map.set(key, list);
}

function placesNamed(dir, cityNorm) {
  const primary = dir.byNorm.get(cityNorm) || [];
  if (primary.length) return primary;
  return dir.byLoose.get(cityNorm) || [];
}

function toPlace(entry) {
  return {
    id: `${slug(entry.name)}-${entry.usps.toLowerCase()}`,
    geoid: entry.geoid,
    name: entry.name,
    state: entry.state,
    state_usps: entry.usps,
    census_name: entry.census_name,
    geography_type: "city"
  };
}

function toSuggestion(entry) {
  const place = toPlace(entry);
  return {
    name: place.name,
    state: place.state,
    state_usps: place.state_usps,
    census_name: place.census_name,
    geoid: place.geoid,
    label: `${place.name}, ${place.state}`
  };
}

function uniquePlaces(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (seen.has(entry.geoid)) continue;
    seen.add(entry.geoid);
    out.push(entry);
  }
  return out;
}

function joinOr(labels) {
  if (labels.length <= 1) return labels[0] || "";
  if (labels.length === 2) return `${labels[0]} or ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}

function failed(message, suggestions = []) {
  return {
    selected: false,
    place: null,
    message,
    suggestions: suggestions.slice(0, 8)
  };
}

function selected(entry) {
  const place = toPlace(entry);
  return {
    selected: true,
    place,
    message: "",
    suggestions: [toSuggestion(entry)]
  };
}

export function parseCityQuery(text) {
  const raw = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!raw) {
    return { ok: false, reason: "empty", city: "", message: "Enter a city and a state, such as Bella Vista, AR." };
  }
  let parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    return {
      ok: false,
      reason: "missing_state",
      city: parts[0] || raw,
      message: "Add a state. Use City, ST, such as Bella Vista, AR."
    };
  }
  const tail = normalizePlace(parts[parts.length - 1]);
  if (COUNTRY_TAIL.has(tail) && parts.length >= 3) parts = parts.slice(0, -1);
  const stateRaw = parts[parts.length - 1];
  const city = parts.slice(0, -1).join(", ").trim();
  if (!city || city.length < 2) {
    return { ok: false, reason: "city", city, message: "Enter the city name before the state." };
  }
  const stateNorm = normalizeState(stateRaw, "us");
  const identity = stateIdentity(stateNorm);
  if (!identity) {
    return {
      ok: false,
      reason: "unknown_state",
      city,
      state: stateRaw,
      message: `No US state matches "${stateRaw}". Use a state name or a two-letter abbreviation, such as Bella Vista, AR.`
    };
  }
  return {
    ok: true,
    city,
    stateRaw,
    stateNorm: identity.name,
    stateTitle: titleState(identity.name),
    usps: identity.usps
  };
}

function prefixEntries(dir, cityNorm, stateNorm) {
  if (cityNorm.length < 2) return [];
  const hits = [];
  for (const list of dir.byNorm.values()) {
    for (const entry of list) {
      if (entry.stateNorm !== stateNorm) continue;
      const nameIsPrefix = cityNorm.startsWith(entry.nameNorm) && entry.nameNorm.length >= 4 && entry.nameNorm !== cityNorm;
      const queryIsPrefix = entry.nameNorm.startsWith(cityNorm);
      if (nameIsPrefix || queryIsPrefix) hits.push(entry);
    }
  }
  hits.sort((a, b) => a.name.localeCompare(b.name) || a.geoid.localeCompare(b.geoid));
  return uniquePlaces(hits).slice(0, 8);
}

function otherStateEntries(entries, stateNorm) {
  const hits = uniquePlaces(entries.filter((entry) => entry.stateNorm !== stateNorm));
  hits.sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  return hits.slice(0, 8);
}

function entryFromMatch(dir, match) {
  return dir.byCode.get(match.location_code) || null;
}

export function resolveTypedCity(text, options = {}) {
  const dir = placeDirectory();
  const parsed = parseCityQuery(text);
  if (!parsed.ok) {
    const named = parsed.city ? placesNamed(dir, normalizePlace(parsed.city)) : [];
    const suggestions = uniquePlaces(named).slice(0, 8).map(toSuggestion);
    if (parsed.reason === "missing_state" && suggestions.length) {
      const labels = suggestions.map((item) => item.label);
      return failed(`Add a state. Did you mean ${joinOr(labels)}? Nothing was selected.`, suggestions);
    }
    return failed(parsed.message, suggestions);
  }
  const query = {
    cityNorm: normalizePlace(parsed.city),
    stateNorm: parsed.stateNorm,
    countryIso: "us",
    codeSource: "census_places"
  };
  let match = matchCityInState(dir.primaryRows, query);
  if (match.outcome !== "matched" && match.outcome !== "ambiguous") {
    const loose = matchCityInState(dir.looseRows, query);
    if (loose.outcome === "matched" || loose.outcome === "ambiguous" || (loose.same_city_other_regions || []).length) {
      match = loose;
    }
  }
  if (match.outcome === "matched" && match.match) {
    const entry = entryFromMatch(dir, match.match);
    if (!entry || entry.stateNorm !== parsed.stateNorm) {
      return failed(`No US city named ${parsed.city} in ${parsed.stateTitle}.`);
    }
    return selected(entry);
  }
  if (match.outcome === "ambiguous") {
    const entries = uniquePlaces((match.matches || []).map((item) => entryFromMatch(dir, item)).filter(Boolean))
      .filter((entry) => entry.stateNorm === parsed.stateNorm);
    if (entries.length === 1) return selected(entries[0]);
    const suggestions = entries.map(toSuggestion);
    const names = entries.map((entry) => entry.census_name);
    return failed(`Did you mean ${joinOr(names)} in ${parsed.stateTitle}? None was selected.`, suggestions);
  }
  const named = placesNamed(dir, query.cityNorm);
  if (options.allowUniqueOtherState) {
    const elsewhere = otherStateEntries(named, parsed.stateNorm);
    const states = new Set(elsewhere.map((entry) => entry.stateNorm));
    if (!named.some((entry) => entry.stateNorm === parsed.stateNorm) && states.size === 1 && elsewhere.length >= 1) {
      const only = elsewhere.filter((entry) => entry.stateNorm === elsewhere[0].stateNorm);
      if (only.length === 1) return selected(only[0]);
    }
  }
  const others = otherStateEntries(named, parsed.stateNorm);
  const suggestions = (others.length ? others : prefixEntries(dir, query.cityNorm, parsed.stateNorm)).map(toSuggestion);
  if (suggestions.length) {
    return failed(`No US city named ${parsed.city} in ${parsed.stateTitle}. Did you mean ${joinOr(suggestions.map((item) => item.label))}?`, suggestions);
  }
  return failed(`No US city named ${parsed.city} in ${parsed.stateTitle}.`);
}

export function resolveCityAction(body = {}) {
  const query = typeof body.query === "string" && body.query.trim()
    ? body.query.trim()
    : [body.city, body.state].filter((value) => typeof value === "string" && value.trim()).join(", ");
  const result = resolveTypedCity(query, { allowUniqueOtherState: body.allow_unique_other_state === true });
  return {
    paid_dataforseo_called: false,
    data_origin: "census_places",
    example_data: false,
    ...result
  };
}
