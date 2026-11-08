import { stateIdentity } from "./state-fips.js";
import { normalizePlace } from "./normalize.js";
import { normalizeState } from "./states.js";

function words(value) {
  return normalizePlace(value).replace(/\b(city|town|village|cdp|borough|municipality)\b/g, " ").replace(/\s+/g, " ").trim();
}

function countyKey(value) {
  let text = normalizePlace(value);
  text = text.replace(/\bcity and borough\b/g, " ");
  text = text.replace(/\bcensus area\b/g, " ");
  text = text.replace(/\b(county|parish|borough|municipality)\b/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

function metroTitle(name) {
  const cleaned = String(name || "")
    .replace(/\s+(metro|micro)\s+area$/i, "")
    .trim();
  const comma = cleaned.lastIndexOf(",");
  if (comma < 0) return { title: words(cleaned), states: [] };
  const title = words(cleaned.slice(0, comma));
  const states = cleaned.slice(comma + 1).toUpperCase().split(/[^A-Z]+/).filter((token) => token.length === 2);
  return { title, states };
}

function indexBy(rows, keyFn) {
  const groups = new Map();
  for (const [id, row] of Object.entries(rows || {})) {
    const key = keyFn(row);
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push({ id, row });
    groups.set(key, list);
  }
  return groups;
}

export function createGeoIndex(catalog) {
  const places = indexBy(catalog.places, (row) => `${row.st}|${words(row.n)}`);
  const counties = indexBy(catalog.counties, (row) => `${row.st}|${countyKey(row.n)}`);
  const metros = [];
  for (const [id, row] of Object.entries(catalog.metros || {})) {
    metros.push({ id, row, ...metroTitle(row.n) });
  }
  return { places, counties, metros };
}

export function matchCandidate(index, candidate) {
  const state = stateIdentity(normalizeState(candidate.state, "us"));
  if (!state) {
    return { outcome: "unsupported", reason: "State was not recognized as a US state or the District of Columbia." };
  }
  if (candidate.geography_type === "city") {
    const hits = index.places.get(`${state.usps}|${words(candidate.name)}`) || [];
    return finish(hits, state, "city", "No Census place in that state matched this name after removing city/town/CDP/village. The name was not assigned to another place.");
  }
  if (candidate.geography_type === "county") {
    const hits = index.counties.get(`${state.usps}|${countyKey(candidate.name)}`) || [];
    return finish(hits, state, "county", "No Census county, parish, or borough in that state matched this name.");
  }
  if (candidate.geography_type === "metro") {
    const title = words(candidate.name);
    const hits = index.metros.filter((row) => row.title === title && row.states.includes(state.usps));
    return finish(hits, state, "metro", "No Census metro or micro area title matched. A single city name is not expanded into a metro. Use the Census title, such as Austin-Round Rock-San Marcos.");
  }
  return { outcome: "unsupported", reason: "Geography type must be city, county, or metro." };
}

function finish(hits, state, geographyType, missReason) {
  if (hits.length === 1) {
    const hit = hits[0];
    return {
      outcome: "matched",
      geography_type: geographyType,
      geoid: hit.id,
      census_name: hit.row.n,
      state_fips: state.fips,
      state_usps: state.usps,
      state_name: state.name,
      row: hit.row
    };
  }
  if (hits.length > 1) {
    return {
      outcome: "ambiguous",
      geography_type: geographyType,
      state_fips: state.fips,
      state_usps: state.usps,
      state_name: state.name,
      matches: hits.map((hit) => ({ geoid: hit.id, census_name: hit.row.n })),
      reason: "More than one Census area in that state has this name. None was selected."
    };
  }
  return {
    outcome: "unsupported",
    geography_type: geographyType,
    state_fips: state.fips,
    state_usps: state.usps,
    state_name: state.name,
    reason: missReason
  };
}
