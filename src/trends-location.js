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

// City match only. A row whose region is a different state is not this market.
// Metro, state, and country rows are not a city match.
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

function matchDmaForMembership(rows, query, membership) {
  const wanted = new Set([membership.primary_city_norm, membership.title_norm].filter(Boolean));
  const allowed = new Set(membership.state_names || []);
  const hits = [];
  const seen = new Set();
  for (const row of rows) {
    if (!usable(row, query)) continue;
    if (!METRO_TYPES.has(String(row.location_type || "").toLowerCase())) continue;
    if (seen.has(row.location_code)) continue;
    const parts = splitLocationName(row.location_name);
    if (!wanted.has(normalizePlace(parts.place))) continue;
    const regionNorms = parts.regions.map((region) => normalizeState(region, query.countryIso));
    if (!regionNorms.some((region) => allowed.has(region))) continue;
    seen.add(row.location_code);
    hits.push(row);
  }
  if (hits.length === 1) return { outcome: "matched", match: present(hits[0]) };
  if (hits.length > 1) {
    return {
      outcome: "ambiguous",
      reason: `More than one Google Ads DMA row matches ${membership.census_name || "this Census metro"}. None was selected.`
    };
  }
  const city = membership.primary_city || "the Census metro's primary city";
  const states = (membership.state_names || []).join(" or ") || "the metro's state";
  return {
    outcome: "none",
    reason: `This place is in ${membership.census_name || "a Census metro"} (CBSA ${membership.cbsa || "unknown"}), but no single Google Ads DMA Region is named ${city} in ${states}.`
  };
}

function membershipSummary(info, dmaBasis, dmaSkipReason) {
  return {
    status: info.status,
    reason: info.reason || null,
    place_geoid: info.place_geoid || null,
    counties: Array.isArray(info.counties) ? info.counties.slice() : [],
    cbsa: info.cbsa || null,
    census_name: info.census_name || null,
    primary_city: info.primary_city || null,
    dma_basis: dmaBasis,
    dma_skip_reason: dmaSkipReason
  };
}

// Namesake DMA: exactly one DMA Region named for this city in this state.
// Containing DMA: the Google Ads DMA named for the Census CBSA the city's counties belong to.
// An ambiguous or non-metro membership does not fall through to a namesake row.
export function selectVolumeLocations(rows, query, membership) {
  const list = Array.isArray(rows) ? rows : [];
  const state = matchAdmin(list, query);
  const namesake = matchMetro(list, query);
  const info = membership || {
    status: "missing",
    reason: "Metro membership was not provided.",
    primary_city_norm: null,
    state_names: []
  };
  let dma = null;
  let dmaBasis = null;
  let dmaSkipReason = null;
  if (info.status === "matched") {
    const containing = matchDmaForMembership(list, query, info);
    if (containing.outcome === "matched") {
      if (namesake && namesake.location_code !== containing.match.location_code) {
        dmaSkipReason = `The DMA named for this city (${namesake.location_name}) is not the DMA for ${info.census_name} (${containing.match.location_name}). Neither DMA was used.`;
      } else {
        dma = containing.match;
        dmaBasis = namesake ? "namesake_and_census_cbsa" : "census_cbsa";
      }
    } else if (containing.outcome === "ambiguous") {
      dmaSkipReason = containing.reason;
    } else if (namesake && info.primary_city_norm === query.cityNorm) {
      dma = namesake;
      dmaBasis = "namesake";
    } else {
      dmaSkipReason = containing.reason;
    }
  } else if (info.status === "ambiguous" || info.status === "not_in_cbsa") {
    dmaSkipReason = info.reason;
  } else if (namesake) {
    dma = namesake;
    dmaBasis = "namesake";
  } else {
    dmaSkipReason = `No single DMA Region row is named for this city in this state. ${info.reason || "A containing metro was not assigned."}`;
  }
  return {
    dma,
    state,
    dma_basis: dmaBasis,
    dma_skip_reason: dmaSkipReason,
    membership: membershipSummary(info, dmaBasis, dmaSkipReason)
  };
}

// Bing has its own location list. Prefer the city, then one namesake metro, then the state.
// A national Bing row is not used: a country volume is not scaled down to a city.
export function selectBingVolumeLocation(rows, query) {
  const list = Array.isArray(rows) ? rows : [];
  const city = matchCityInState(list, query);
  if (city.outcome === "matched" && city.match) {
    return { level: "city", match: city.match, broader_than_city: false };
  }
  const metro = matchMetro(list, query);
  if (metro) return { level: "metro", match: metro, broader_than_city: true };
  const state = matchAdmin(list, query);
  if (state) return { level: "state", match: state, broader_than_city: true };
  return { level: "unavailable", match: null, broader_than_city: true };
}

export function selectTrendsLocation(rows, query) {
  const list = Array.isArray(rows) ? rows : [];
  const metro = matchMetro(list, query);
  if (metro) {
    return {
      level: "metro",
      match: metro,
      fallback_from_city: true,
      note: "Google Trends starts at the DMA or metro, not the city. The series is relative interest for that broader area."
    };
  }
  const state = matchAdmin(list, query);
  if (state) {
    return {
      level: "state",
      match: state,
      fallback_from_city: true,
      note: "Google Trends starts at the DMA or state. No single DMA or metro row matched this city and state, so the series uses the state."
    };
  }
  const country = matchCountry(list, query);
  if (country) {
    return {
      level: "national",
      match: country,
      fallback_from_city: true,
      note: "Google Trends starts at the DMA or state. No DMA, metro, or state row matched, so the series uses the national location."
    };
  }
  return {
    level: "unavailable",
    match: null,
    fallback_from_city: true,
    note: "Google Trends has no DMA, metro, state, or national row for this market. Trends was not requested."
  };
}
