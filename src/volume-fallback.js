import { createGeoIndex, matchCandidate } from "./geo-match.js";
import { parseCensusMetroName, resolveMetroMembership } from "./metro-membership.js";
import { normalizePlace, splitLocationName } from "./normalize.js";
import { loadExtractCatalog } from "./screen.js";
import { stateIdentity } from "./state-fips.js";
import { normalizeState } from "./states.js";

export const CITY_CORE_VOLUME_THRESHOLD = 10;
export const FALLBACK_ESTIMATE_LABEL = "estimated from metro/state data, broader than the city";
export const BING_BROADER_ESTIMATE_LABEL = "estimated from Bing data, broader than the city";
export const BING_CITY_ESTIMATE_LABEL = "estimated from Bing data, not measured Google Ads city volume";
export const BING_CORROBORATION_NOTE = "Bing also shows demand.";

export const ESTIMATE_METHOD_NOTE = "City estimate = round(broader clustered coverage volume × city occupied housing units / broader occupied housing units). Rounding is half away from zero. Occupied housing is the bundled 2023 ACS 5-year count: the Census place for the city, the sum of that state's counties for a state volume, and the Census CBSA that contains the place's counties for a DMA volume. When that county-to-CBSA mapping is missing, a namesake DMA uses the Census metro whose title starts with the city. The extract has housing counts, not population, so this is an occupied-housing share, not a headcount. Google Ads sets the value. A positive scaled metro estimate is kept because it is the geography the city belongs to. A positive state estimate does not lower it, and the state estimate is used only when no Google Ads metro estimate is positive. Within that one Google level, the minimum is used. Bing sets the value only when no Google Ads source has a positive scaled estimate, and then the minimum of the positive Bing estimates is used. Bing volume at a Bing city location is not scaled. When Bing has a positive clustered volume and Google Ads sets the value, Bing is corroboration only. A fallback estimate is never written into the city search_volume field and is not a measured city volume.";

let housingCache = null;

function clusteredTotal(demand) {
  const clustered = demand && demand.clustered_coverage_volume;
  if (!clustered || !Number.isInteger(clustered.value)) return null;
  if (clustered.status === "measured" || clustered.status === "measured_zero" || clustered.status === "partial") {
    return clustered.value;
  }
  return null;
}

export function cityVolumeNeedsFallback(demand) {
  if (!demand) return { needed: false, reason: "missing_report", core_total: null };
  if (["failed", "unsupported", "not_requested", "unusable"].includes(demand.status)) {
    return { needed: false, reason: demand.status, core_total: null };
  }
  const total = clusteredTotal(demand);
  if (total === null) return { needed: true, reason: "all_core_null", core_total: null };
  if (total <= CITY_CORE_VOLUME_THRESHOLD) {
    return { needed: true, reason: "core_total_at_or_below_threshold", core_total: total };
  }
  return { needed: false, reason: null, core_total: total };
}

export function broaderVolumeIsBlank(demand) {
  const decision = cityVolumeNeedsFallback(demand);
  return decision.needed || decision.reason === "failed" || decision.reason === "missing_report";
}

export function scaleVolume(broaderVolume, cityOccupied, broaderOccupied) {
  if (!Number.isInteger(broaderVolume) || broaderVolume <= 0) return null;
  if (!Number.isInteger(cityOccupied) || !Number.isInteger(broaderOccupied)) return null;
  if (cityOccupied <= 0 || broaderOccupied <= 0 || cityOccupied > broaderOccupied) return null;
  return Math.round((broaderVolume * cityOccupied) / broaderOccupied);
}

function wholeCount(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

function housingBundle() {
  if (!housingCache) {
    const extract = loadExtractCatalog();
    housingCache = { extract, index: createGeoIndex(extract) };
  }
  return housingCache;
}

function stateOccupied(extract, usps) {
  let occupied = 0;
  let counties = 0;
  for (const row of Object.values(extract.counties || {})) {
    if (row.st !== usps) continue;
    const count = wholeCount(row.occ);
    if (count === null) continue;
    occupied += count;
    counties += 1;
  }
  if (!counties || occupied <= 0) return null;
  return occupied;
}

function metroOccupied(extract, city, state) {
  const identity = stateIdentity(normalizeState(state, "us"));
  if (!identity) return null;
  const cityNorm = normalizePlace(city);
  const hits = [];
  for (const [id, row] of Object.entries(extract.metros || {})) {
    const parsed = parseCensusMetroName(row.n);
    if (parsed.primary_norm !== cityNorm) continue;
    if (!parsed.states.includes(identity.usps)) continue;
    hits.push({ id, row });
  }
  if (hits.length !== 1) return null;
  const occupied = wholeCount(hits[0].row.occ);
  if (occupied === null) return null;
  return { occupied, census_name: hits[0].row.n, cbsa: hits[0].id };
}

function metroShare(cityOccupied, metro) {
  if (!metro || metro.occupied < cityOccupied) return null;
  return {
    status: "measured",
    basis: "occupied_housing_units",
    geography: "census_metro",
    membership: metro.membership,
    cbsa: metro.cbsa || null,
    city_occupied: cityOccupied,
    broader_occupied: metro.occupied,
    census_name: metro.census_name
  };
}

export function housingShareFor({ city, state, level, locationName, source }) {
  if (level !== "state" && level !== "metro") return null;
  const { extract, index } = housingBundle();
  const cityMatch = matchCandidate(index, { geography_type: "city", name: city, state });
  if (cityMatch.outcome !== "matched") return null;
  const place = extract.places[cityMatch.geoid];
  const cityOccupied = wholeCount(place && place.occ);
  if (cityOccupied === null) return null;
  if (level === "state") {
    const broader = stateOccupied(extract, cityMatch.state_usps);
    if (broader === null || broader < cityOccupied) return null;
    return {
      status: "measured",
      basis: "occupied_housing_units",
      geography: "state_counties",
      city_occupied: cityOccupied,
      broader_occupied: broader,
      census_name: place.n
    };
  }
  if (source === "bing") {
    const named = splitLocationName(locationName).place || city;
    const metro = metroOccupied(extract, named, state);
    return metroShare(cityOccupied, metro && { ...metro, membership: "bing_location_namesake" });
  }
  const resolved = resolveMetroMembership({ city, state });
  if (resolved.status === "matched") {
    const row = extract.metros[resolved.cbsa];
    const occupied = wholeCount(row && row.occ);
    if (occupied === null) return null;
    return metroShare(cityOccupied, {
      occupied,
      census_name: resolved.census_name,
      cbsa: resolved.cbsa,
      membership: "census_cbsa"
    });
  }
  if (resolved.status === "missing") {
    const metro = metroOccupied(extract, city, state);
    return metroShare(cityOccupied, metro && { ...metro, membership: "namesake" });
  }
  return null;
}

function rawVolumes(attempts) {
  return attempts.filter((attempt) => attempt.queried).map((attempt) => ({
    source: attempt.source,
    level: attempt.level,
    location_code: attempt.location_code,
    location_name: attempt.location_name,
    clustered_volume: attempt.clustered_volume,
    clustered_status: attempt.clustered_status,
    core_volume: attempt.core_volume,
    scaled_city_volume: attempt.scaled_city_volume,
    share: attempt.share,
    candidate: attempt.candidate === true
  }));
}

function withheldEstimate(attempts) {
  return {
    status: "withheld",
    value: null,
    measured_city_data: false,
    label: null,
    method: ESTIMATE_METHOD_NOTE,
    value_source: null,
    bing_used_for_value: false,
    bing_note: null,
    winning_sources: [],
    raw_broader_volumes: rawVolumes(attempts),
    numeric_month_count: 0,
    note: "No broader source returned a clustered volume above 10 that could be scaled to a positive city estimate. Raw broader numbers are listed when a call was made. The grade was not invented from a null."
  };
}

function bingShowsDemand(attempts) {
  return attempts.some((attempt) => (
    attempt.source === "bing"
    && attempt.queried
    && Number.isInteger(attempt.clustered_volume)
    && attempt.clustered_volume > 0
  ));
}

function lowestPositive(attempts) {
  const value = Math.min(...attempts.map((attempt) => attempt.scaled_city_volume));
  return {
    value,
    winners: attempts.filter((attempt) => attempt.scaled_city_volume === value)
  };
}

export function buildVolumeEstimate(attempts, shareFor) {
  const decorated = (Array.isArray(attempts) ? attempts : []).map((attempt) => {
    if (!attempt || !attempt.queried) {
      return { ...attempt, scaled_city_volume: null, share: null, candidate: false };
    }
    const raw = attempt.clustered_volume;
    const above = Number.isInteger(raw) && raw > CITY_CORE_VOLUME_THRESHOLD;
    if (!above) return { ...attempt, scaled_city_volume: null, share: null, candidate: false };
    if (!attempt.broader_than_city) {
      return { ...attempt, scaled_city_volume: raw, share: null, candidate: true, unscaled: true };
    }
    let share = null;
    try {
      share = shareFor ? shareFor(attempt) : null;
    } catch {
      share = null;
    }
    const scaled = share ? scaleVolume(raw, share.city_occupied, share.broader_occupied) : null;
    return {
      ...attempt,
      share: share || { status: "unavailable", basis: "occupied_housing_units" },
      scaled_city_volume: scaled,
      candidate: Number.isInteger(scaled) && scaled > 0
    };
  });
  const candidates = decorated.filter((attempt) => attempt.candidate);
  const googleMetro = candidates.filter((attempt) => attempt.source === "google_ads" && attempt.level === "metro");
  const googleState = candidates.filter((attempt) => attempt.source === "google_ads" && attempt.level === "state");
  const bing = candidates.filter((attempt) => attempt.source === "bing");
  let selection = null;
  let chosen = [];
  if (googleMetro.length) {
    selection = "google_ads_metro";
    chosen = googleMetro;
  } else if (googleState.length) {
    selection = "google_ads_state";
    chosen = googleState;
  } else if (bing.length) {
    selection = "bing_backup";
    chosen = bing;
  }
  if (!selection) return { attempts: decorated, estimate: withheldEstimate(decorated) };
  const { value, winners } = lowestPositive(chosen);
  const label = selection === "bing_backup"
    ? (winners.some((attempt) => attempt.broader_than_city) ? BING_BROADER_ESTIMATE_LABEL : BING_CITY_ESTIMATE_LABEL)
    : FALLBACK_ESTIMATE_LABEL;
  const bingNote = selection.startsWith("google_ads") && bingShowsDemand(decorated) ? BING_CORROBORATION_NOTE : null;
  return {
    attempts: decorated,
    estimate: {
      status: "estimated",
      value,
      measured_city_data: false,
      label,
      method: ESTIMATE_METHOD_NOTE,
      value_source: selection,
      bing_used_for_value: selection === "bing_backup",
      bing_note: bingNote,
      winning_sources: winners.map((attempt) => ({
        source: attempt.source,
        level: attempt.level,
        location_name: attempt.location_name,
        raw_clustered_volume: attempt.clustered_volume,
        scaled_city_volume: attempt.scaled_city_volume,
        broader_than_city: attempt.broader_than_city === true
      })),
      raw_broader_volumes: rawVolumes(decorated),
      numeric_month_count: Math.min(...winners.map((attempt) => attempt.numeric_month_count || 0)),
      note: [label, bingNote, ESTIMATE_METHOD_NOTE].filter(Boolean).join(" ")
    }
  };
}

export function usableFallbackEstimate(demand) {
  const estimate = demand && demand.volume_fallback && demand.volume_fallback.estimate;
  if (!estimate || estimate.status !== "estimated" || estimate.measured_city_data !== false) return null;
  if (!Number.isInteger(estimate.value) || estimate.value < 0) return null;
  return estimate;
}
