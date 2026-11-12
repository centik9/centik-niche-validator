import { matchCity } from "./locations.js";
import { normalizePlace, splitLocationName } from "./normalize.js";
import { normalizeState } from "./states.js";

const METRO_TYPES = new Set(["dma region", "dma", "metro", "metropolitan area", "tv region"]);
const ADMIN_TYPES = new Set([
  "state",
  "region",
  "province",
  "territory",
  "governorate",
  "prefecture",
  "canton",
  "union territory",
  "autonomous community",
  "department",
  "district",
  "oblast"
]);

function present(row) {
  return {
    location_code: row.location_code,
    location_name: row.location_name,
    location_type: row.location_type,
    country_iso_code: String(row.country_iso_code || "").toUpperCase()
  };
}

function usable(row, query) {
  return Boolean(row && typeof row.location_name === "string" && Number.isInteger(row.location_code) && String(row.country_iso_code || "").toLowerCase() === query.countryIso);
}

function pickLowest(rows) {
  if (!rows.length) return null;
  return rows.slice().sort((a, b) => a.location_code - b.location_code)[0];
}

function matchMetro(rows, query) {
  const hits = [];
  for (const row of rows) {
    if (!usable(row, query)) continue;
    if (!METRO_TYPES.has(String(row.location_type || "").toLowerCase())) continue;
    const parts = splitLocationName(row.location_name);
    if (normalizePlace(parts.place) !== query.cityNorm) continue;
    const regionNorms = parts.regions.map((region) => normalizeState(region, query.countryIso));
    if (!regionNorms.includes(query.stateNorm)) continue;
    hits.push(row);
  }
  if (hits.length !== 1) return null;
  return present(hits[0]);
}

function matchAdmin(rows, query) {
  const hits = [];
  for (const row of rows) {
    if (!usable(row, query)) continue;
    if (!ADMIN_TYPES.has(String(row.location_type || "").toLowerCase())) continue;
    const parts = splitLocationName(row.location_name);
    if (normalizeState(parts.place, query.countryIso) !== query.stateNorm) continue;
    hits.push(row);
  }
  const chosen = pickLowest(hits);
  return chosen ? present(chosen) : null;
}

function matchCountry(rows, query) {
  const hits = [];
  for (const row of rows) {
    if (!usable(row, query)) continue;
    if (String(row.location_type || "").toLowerCase() !== "country") continue;
    hits.push(row);
  }
  const chosen = pickLowest(hits);
  return chosen ? present(chosen) : null;
}

function stateRegionsInclude(locationName, query) {
  const parts = splitLocationName(locationName);
  const regionNorms = parts.regions.map((region) => normalizeState(region, query.countryIso));
  return regionNorms.includes(query.stateNorm);
}

// City match only. Same state rule as selectTrendsLocation's city and metro
// checks: a row whose region is a different state is not this market. Metro,
// state, and country fallbacks are intentionally not used here.
export function matchCityInState(rows, query) {
  const city = matchCity(Array.isArray(rows) ? rows : [], query);
  if (city.outcome === "matched" && city.match && !stateRegionsInclude(city.match.location_name, query)) {
    return {
      outcome: "unsupported",
      match: null,
      matches: [],
      same_city_other_regions: city.same_city_other_regions,
      same_name_other_countries: city.same_name_other_countries,
      rejected_summary: city.rejected_summary,
      code_source: city.code_source,
      state_rejected: true
    };
  }
  if (city.outcome === "ambiguous" && Array.isArray(city.matches)) {
    const matches = city.matches.filter((match) => stateRegionsInclude(match.location_name, query));
    if (matches.length !== city.matches.length) {
      return {
        ...city,
        outcome: matches.length === 1 ? "matched" : matches.length > 1 ? "ambiguous" : "unsupported",
        match: matches.length === 1 ? matches[0] : null,
        matches
      };
    }
  }
  return city;
}

export function selectTrendsLocation(rows, query) {
  const list = Array.isArray(rows) ? rows : [];
  const city = matchCity(list, query);
  if (city.outcome === "matched" && city.match) {
    return {
      level: "city",
      match: city.match,
      fallback_from_city: false,
      note: "Google Trends series uses the confirmed city location."
    };
  }
  const metro = matchMetro(list, query);
  if (metro) {
    return {
      level: "metro",
      match: metro,
      fallback_from_city: true,
      note: "No confirmed Google Trends city row. The series uses a metro or DMA location instead."
    };
  }
  const state = matchAdmin(list, query);
  if (state) {
    return {
      level: "state",
      match: state,
      fallback_from_city: true,
      note: "No confirmed Google Trends city or metro row. The series uses the state location instead."
    };
  }
  const country = matchCountry(list, query);
  if (country) {
    return {
      level: "national",
      match: country,
      fallback_from_city: true,
      note: "No confirmed Google Trends city, metro, or state row. The series uses the national location instead."
    };
  }
  return {
    level: "unavailable",
    match: null,
    fallback_from_city: true,
    note: "Google Trends has no city, metro, state, or national row for this market. Trends was not requested."
  };
}
