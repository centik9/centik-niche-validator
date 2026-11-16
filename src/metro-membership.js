import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGeoIndex, matchCandidate } from "./geo-match.js";
import { normalizePlace } from "./normalize.js";
import { loadExtractCatalog } from "./screen.js";
import { stateByUsps } from "./state-fips.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let bundleCache = null;
let indexCache = null;

function loadBundle() {
  if (!bundleCache) {
    bundleCache = JSON.parse(readFileSync(path.join(root, "data", "metro-membership.json"), "utf8"));
  }
  return bundleCache;
}

function geoBundle() {
  if (!indexCache) {
    const extract = loadExtractCatalog();
    indexCache = { extract, index: createGeoIndex(extract) };
  }
  return indexCache;
}

export function parseCensusMetroName(name) {
  const cleaned = String(name || "").replace(/\s+(metro|micro)\s+area$/i, "").trim();
  const comma = cleaned.lastIndexOf(",");
  const title = comma < 0 ? cleaned : cleaned.slice(0, comma);
  const states = comma < 0 ? [] : cleaned.slice(comma + 1).toUpperCase().split(/[^A-Z]+/).filter((token) => token.length === 2);
  const primary = title.split("-")[0].trim();
  return {
    title,
    primary,
    primary_norm: normalizePlace(primary),
    title_norm: normalizePlace(title),
    states
  };
}

function membership(status, reason, extra = {}) {
  return {
    status,
    reason,
    place_geoid: extra.place_geoid || null,
    counties: extra.counties || [],
    cbsa: extra.cbsa || null,
    census_name: extra.census_name || null,
    primary_city: extra.primary_city || null,
    primary_city_norm: extra.primary_city_norm || null,
    title_norm: extra.title_norm || null,
    states: extra.states || [],
    state_names: extra.state_names || []
  };
}

// City to county from the bundled 2020 Census place-by-county file, then county to
// one July 2023 CBSA. A place in counties that disagree is unresolved. Nothing is guessed.
export function resolveMetroMembership({ city, state }) {
  const { extract, index } = geoBundle();
  const bundle = loadBundle();
  const cityMatch = matchCandidate(index, { geography_type: "city", name: city, state });
  if (cityMatch.outcome === "ambiguous") {
    return membership("ambiguous", "More than one Census place in that state has this name. No containing metro was assigned.");
  }
  if (cityMatch.outcome !== "matched") {
    return membership("missing", "No Census place in that state matched this city, so no containing metro was assigned.");
  }
  const counties = bundle.place_counties[cityMatch.geoid] || null;
  if (!counties || !counties.length) {
    return membership("missing", "The bundled Census place-county file has no county for this place, so no containing metro was assigned.", {
      place_geoid: cityMatch.geoid
    });
  }
  const unknown = counties.filter((fips) => !extract.counties[fips]);
  if (unknown.length) {
    return membership("missing", "A Census county code for this place is not in the bundled ACS county list, so no containing metro was assigned.", {
      place_geoid: cityMatch.geoid,
      counties
    });
  }
  const codes = counties.map((fips) => bundle.county_cbsa[fips] || null);
  const present = [...new Set(codes.filter(Boolean))];
  const outside = codes.filter((code) => !code).length;
  if (present.length === 1 && outside === 0) {
    const cbsa = present[0];
    const metro = extract.metros[cbsa];
    if (!metro) {
      return membership("missing", `CBSA ${cbsa} is not in the bundled ACS metro list, so no containing metro was assigned.`, {
        place_geoid: cityMatch.geoid,
        counties,
        cbsa
      });
    }
    const parsed = parseCensusMetroName(metro.n);
    if (!parsed.primary_norm || !parsed.states.includes(cityMatch.state_usps)) {
      return membership("ambiguous", `The Census metro ${metro.n} does not list this city's state, so no DMA was selected.`, {
        place_geoid: cityMatch.geoid,
        counties,
        cbsa,
        census_name: metro.n
      });
    }
    const stateNames = parsed.states.map((usps) => {
      const identity = stateByUsps(usps);
      return identity ? identity.name : null;
    }).filter(Boolean);
    if (!stateNames.length) {
      return membership("missing", `The Census metro ${metro.n} has no recognized state, so no DMA was selected.`, {
        place_geoid: cityMatch.geoid,
        counties,
        cbsa,
        census_name: metro.n
      });
    }
    return membership("matched", null, {
      place_geoid: cityMatch.geoid,
      counties,
      cbsa,
      census_name: metro.n,
      primary_city: parsed.primary,
      primary_city_norm: parsed.primary_norm,
      title_norm: parsed.title_norm,
      states: parsed.states,
      state_names: stateNames
    });
  }
  if (present.length === 0) {
    return membership("not_in_cbsa", "Every Census county for this place is outside a CBSA, so no metro DMA was assigned.", {
      place_geoid: cityMatch.geoid,
      counties
    });
  }
  return membership("ambiguous", "The Census counties for this place do not all belong to one CBSA. No DMA was selected.", {
    place_geoid: cityMatch.geoid,
    counties
  });
}
