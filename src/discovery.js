import { HttpError } from "./errors.js";
import { createGeoIndex, matchCandidate } from "./geo-match.js";
import { evaluateLenses, normalizeLens } from "./lenses.js";
import {
  DISCOVERY_FIXTURES,
  WORKED_EXAMPLE_SOURCE,
  familyOf,
  nationalGuide
} from "./discovery-fixtures.js";

export const DISCOVERY_MODEL_ID = "centik-discovery-v1";

const UNAVAILABLE_NOTE = "Not measured. Missing is not zero.";

function unavailable(note = UNAVAILABLE_NOTE) {
  return { status: "unavailable", value: null, note };
}

function missing(note = UNAVAILABLE_NOTE) {
  return { status: "missing", value: null, note };
}

function openForFill(field) {
  return !field || field.status === "missing";
}

function measured(value, note) {
  return { status: "measured", value, note: note || "" };
}

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function samePlace(row, city, state) {
  return norm(row.city) === norm(city) && norm(row.state) === norm(state);
}

function ownerRate(row) {
  const field = row.census && row.census.owner_occupancy_rate;
  if (!field || field.status !== "measured" || typeof field.value !== "number" || !Number.isFinite(field.value)) return null;
  return field.value;
}

function incumbentRatings(row) {
  const value = row.competition && row.competition.strongest_in_town_ratings;
  return Number.isInteger(value) ? value : null;
}

function hasMeasurement(row) {
  if (ownerRate(row) !== null) return true;
  const edge = row.population_edge && row.population_edge.status;
  if (edge === "edge" || edge === "saturated_center") return true;
  if (row.price && row.price.status === "published" && Number.isInteger(row.price.low_dollars) && Number.isInteger(row.price.high_dollars)) return true;
  if (row.competition && Array.isArray(row.competition.places) && row.competition.places.length) return true;
  return false;
}

const RESEARCH_DISPLAY = {
  "bella-vista-ar-retaining-wall": {
    research_position: 1,
    status_tag: "Validate first",
    named_label: "5+ first-party pages",
    why: "Strongest owner base, hillside walls need approval and engineering, lightest Maps incumbent seen, 5+ named buyers."
  },
  "lancaster-oh-septic": {
    research_position: 2,
    status_tag: "Fallback for #1",
    named_label: "3 first-party pages",
    why: "Strong ticket and county permit trail. Weaker since Nov 6: a second heavy incumbent is in town.",
    fallback_note: "Shown because #1 can fail on pack density: if Bella Vista's local pack is dense with ads and specialist pages above the fold, validate this next. Re-check Pipeworks and Josh's first."
  },
  "grass-valley-ca-septic": {
    research_position: 3,
    status_tag: "No change",
    named_label: "3 Places results",
    why: "Low city owner-occupancy and one heavy incumbent."
  },
  "battle-ground-wa-driveway": {
    research_position: 4,
    status_tag: "Hold",
    named_label: "4 first-party pages",
    why: "Smallest town, and the ticket clears $5,000 only on full tear-out scope."
  },
  "leland-nc-crawl-space": {
    research_position: 5,
    status_tag: "Hold",
    named_label: "0 Leland-addressed",
    why: "No Leland-addressed operator returned, and national brands have Leland pages."
  }
};

function presentRow(row) {
  const display = RESEARCH_DISPLAY[row.id];
  if (display) Object.assign(row, display);
  if (row.census) {
    row.census.housing_age = { status: "not_fetched", value: null, note: "Not in source method" };
  }
  return row;
}

function holdReason(row) {
  if (row.explicit_hold && typeof row.explicit_hold.reason === "string" && row.explicit_hold.reason.trim()) {
    return row.explicit_hold.reason.trim();
  }
  const places = (row.competition && row.competition.places) || [];
  if (!places.length) return null;
  const inTown = places.filter((place) => norm(place.city) === norm(row.city));
  if (inTown.length === 0) {
    return "No operator with this city's address was in the lookup. Nearby towns are not counted as local coverage.";
  }
  return null;
}

function byMeasuredKeys(left, right) {
  const leftOwner = ownerRate(left);
  const rightOwner = ownerRate(right);
  if (leftOwner === null && rightOwner !== null) return 1;
  if (rightOwner === null && leftOwner !== null) return -1;
  if (leftOwner !== null && rightOwner !== null && leftOwner !== rightOwner) return rightOwner - leftOwner;
  const leftRatings = incumbentRatings(left);
  const rightRatings = incumbentRatings(right);
  if (leftRatings === null && rightRatings !== null) return 1;
  if (rightRatings === null && leftRatings !== null) return -1;
  if (leftRatings !== null && rightRatings !== null && leftRatings !== rightRatings) return leftRatings - rightRatings;
  return String(left.city).localeCompare(String(right.city));
}

function attachLenses(row, lens) {
  const lenses = evaluateLenses({
    service: row.service,
    price: row.price && row.price.status === "published" ? row.price : null,
    state_operator_count: row.state_operator_count,
    best_query: row.best_query,
    sponsored_ads: row.sponsored_ads
  });
  const active = lens === "four_yes" ? lenses.four_yes : lenses.classroom;
  const other = lens === "four_yes" ? lenses.classroom : lenses.four_yes;
  row.lenses = lenses;
  row.lens_chip = {
    lens,
    label: active.label,
    verdict: active.verdict,
    other_label: other.label,
    other_verdict: other.verdict,
    disagree: lenses.disagree
  };
  return row;
}

export function rankDiscovery(candidates, options = {}) {
  const lens = normalizeLens(options.lens);
  const rows = (Array.isArray(candidates) ? candidates : []).map((row) => attachLenses(presentRow(structuredClone(row)), lens));
  const free = rows.filter((row) => !Number.isInteger(row.research_position));
  const fixed = rows.filter((row) => Number.isInteger(row.research_position));
  free.sort(byMeasuredKeys);
  fixed.sort((left, right) => left.research_position - right.research_position);
  for (const row of rows) {
    const reason = holdReason(row);
    if (row.population_edge && row.population_edge.status === "saturated_center") row.role = "saturated";
    else if (reason && !row.status_tag) {
      row.role = "hold";
      row.hold_reason = reason;
    } else if (reason) {
      row.role = "hold";
      row.hold_reason = reason;
    } else row.role = "lead";
  }
  let ordered = [...free, ...fixed];
  let fallback = null;
  const leader = ordered.find((row) => row.fallback_id);
  if (leader && leader.competition && leader.competition.map_pack === "dense") {
    const alt = ordered.find((row) => row.id === leader.fallback_id);
    if (alt && alt !== ordered[0]) {
      alt.surfaced_as = "fallback";
      alt.role = "fallback";
      ordered = [alt, ...ordered.filter((row) => row !== alt)];
      fallback = alt;
    }
  }
  ordered.forEach((row, index) => {
    row.position = index + 1;
    row.paid_dataforseo_called = false;
    if (row.fallback_note) row.fallback_reason = row.fallback_note;
  });
  return {
    rows: ordered,
    fallback_surfaced: Boolean(fallback),
    fallback_id: fallback ? fallback.id : null,
    paid_dataforseo_called: false
  };
}

function blankCandidate({ city, state, service }) {
  const family = familyOf(service);
  return {
    id: `named-${norm(city)}-${norm(state)}-${family || "service"}`.replace(/[^a-z0-9]+/g, "-"),
    service,
    service_family: family,
    city,
    state,
    fallback_id: null,
    population_edge: {
      status: "not_enough_evidence",
      nearby_center: null,
      note: "Population edge was not measured for this pair."
    },
    census: {
      source_name: null,
      source_url: null,
      population: missing("Population was not measured."),
      households: missing("Households were not measured."),
      owner_occupancy_rate: missing("Owner occupancy was not measured."),
      median_home_value: missing("Median home value was not measured."),
      median_household_income: missing("Median income was not measured."),
      housing_age: missing("Housing age was not measured.")
    },
    price: {
      status: "unavailable",
      low_dollars: null,
      high_dollars: null,
      city_adjusted: false,
      note: "No price guide was on file. A price was not invented."
    },
    competition: {
      map_pack: "unavailable",
      ordered_pack: false,
      strongest_in_town_ratings: null,
      places: [],
      note: "No contractor-site or Places check was on file. A review count was not invented."
    },
    best_query: { status: "not_enough_evidence", note: "A localized best-query check was not on file." },
    sponsored_ads: { status: "not_enough_evidence", note: "Ads were not observed." },
    state_operator_count: { status: "unavailable", note: "No state operator count was on file." },
    explicit_hold: null
  };
}

function closeMissing(census, note) {
  for (const key of ["population", "households", "owner_occupancy_rate", "median_home_value", "median_household_income", "housing_age"]) {
    if (openForFill(census[key])) census[key] = unavailable(note);
  }
}

function fillFromExtract(row, extract) {
  const census = row.census;
  if (!census) return;
  if (!extract || !extract.places) {
    closeMissing(census, "Census was not opened for this request. The field was not invented.");
    return;
  }
  const index = createGeoIndex(extract);
  const match = matchCandidate(index, { geography_type: "city", name: row.city, state: row.state });
  const place = match.outcome === "matched" ? extract.places[match.geoid] : null;
  if (!place) {
    closeMissing(census, "No Census place in the bundled extract matched this city and state. The field was not invented.");
    return;
  }
  if (!census.source_name) {
    census.source_name = "American Community Survey 5-year, 2023 release, bundled extract";
    census.source_url = "https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData/";
    census.note = "Bundled public extract. Not a live Census API call and not a 2025 QuickFacts figure.";
  }
  if (openForFill(census.population)) {
    census.population = unavailable("This extract has housing counts, not a population estimate. Population was not invented.");
  }
  if (openForFill(census.owner_occupancy_rate)) {
    if (Number.isFinite(place.own) && Number.isFinite(place.occ) && place.occ > 0) {
      census.owner_occupancy_rate = measured(place.own / place.occ, "Owner-occupied units divided by occupied units in the 2023 ACS extract.");
    } else {
      census.owner_occupancy_rate = unavailable("Owner occupancy could not be computed from the extract. It was not set to zero.");
    }
  }
  if (openForFill(census.housing_age)) {
    if (place.old_partial) {
      census.housing_age = unavailable("A pre-1980 year-built bucket was missing, so housing age was not filled with zero.");
    } else if (Number.isFinite(place.old) && Number.isFinite(place.ytot) && place.ytot > 0) {
      census.housing_age = measured(place.old / place.ytot, "Share of housing units built in 1979 or earlier in the 2023 ACS extract.");
    } else {
      census.housing_age = unavailable("Housing age was not in the extract for this place. It was not invented.");
    }
  }
  if (openForFill(census.households) && Number.isFinite(place.occ)) {
    census.households = measured(place.occ, "Occupied housing units in the 2023 ACS extract. Not a population count.");
  }
  closeMissing(census, "This Census field was not in the extract. It was not invented.");
}

function cleanCandidate(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const city = typeof item.city === "string" ? item.city.trim() : "";
  const state = typeof item.state === "string" ? item.state.trim() : "";
  const service = typeof item.service === "string" ? item.service.trim() : "";
  if (city.length < 2 || city.length > 80 || state.length < 2 || state.length > 40) return null;
  if (service && (service.length < 2 || service.length > 80)) return null;
  return { city, state, service };
}

export function discoverShortlist(input = {}, options = {}) {
  const mode = input.mode === undefined || input.mode === "" ? "example" : input.mode;
  if (mode !== "example" && mode !== "free") {
    throw new HttpError(400, "invalid_mode", "Discovery mode must be example or free. It does not call DataForSEO.");
  }
  const service = typeof input.service === "string" ? input.service.trim() : "";
  if (service.length < 2 || service.length > 80) {
    throw new HttpError(400, "invalid_input", "Enter a service of 2 to 80 characters.");
  }
  const lens = normalizeLens(input.lens);
  const named = (Array.isArray(input.candidates) ? input.candidates : []).map(cleanCandidate).filter(Boolean).slice(0, 20);
  const fixtures = (options.fixtures || DISCOVERY_FIXTURES).map((row) => structuredClone(row));
  const wanted = new Set();
  for (const part of service.split(/[,;/]| and /)) {
    const family = familyOf(part);
    if (family) wanted.add(family);
  }
  if (!wanted.size) {
    const primary = familyOf(service);
    if (primary) wanted.add(primary);
  }
  for (const item of named) {
    const family = familyOf(item.service || service);
    if (family) wanted.add(family);
  }
  const pool = fixtures.filter((row) => wanted.has(row.service_family));
  const ids = new Set(pool.map((row) => row.id));
  for (const row of [...pool]) {
    if (!row.fallback_id || ids.has(row.fallback_id)) continue;
    const extra = fixtures.find((item) => item.id === row.fallback_id);
    if (!extra) continue;
    pool.push(structuredClone(extra));
    ids.add(extra.id);
  }
  for (const item of named) {
    const serviceName = item.service || service;
    const family = familyOf(serviceName);
    const exists = pool.some((row) => samePlace(row, item.city, item.state) && row.service_family === family);
    if (exists) continue;
    pool.push(blankCandidate({ city: item.city, state: item.state, service: serviceName }));
  }
  for (const row of pool) {
    if (!row.price || row.price.status !== "published") {
      const guide = nationalGuide(row.service_family || row.service);
      if (guide) row.price = guide;
    }
    if (mode === "free") fillFromExtract(row, options.extract || null);
  }
  const measuredRows = pool.filter(hasMeasurement);
  const ranked = rankDiscovery(measuredRows, { lens });
  const message = ranked.rows.length
    ? null
    : "No shortlist. Census, a price guide, and contractor checks were not available for this service. Nothing was invented.";
  return {
    model_id: DISCOVERY_MODEL_ID,
    paid_dataforseo_called: false,
    dataforseo_called: false,
    mode,
    service,
    lens,
    worked_example: WORKED_EXAMPLE_SOURCE,
    rows: ranked.rows,
    omitted_unmeasured: pool.length - measuredRows.length,
    fallback_surfaced: ranked.fallback_surfaced,
    fallback_id: ranked.fallback_id,
    message,
    excluded: [
      { label: "Hard stop", detail: "Locksmith, any city. Rank Expand flags it don't-do-first. This holds in both lenses." },
      { label: "Skipped", detail: "Murfreesboro, Midlothian, Coral Gables, and A&BW: already built or in progress." }
    ],
    limits: [
      "This shortlist does not call DataForSEO.",
      "A blank or unavailable field was not measured. It is not zero and it is not a no.",
      "Price guides are national or provider ranges unless the note says otherwise. They are not a city average.",
      "Places lookups are not an ordered map pack.",
      "The five research markets are a worked example. Other pairs are ranked with the same rules when a measurement is on file."
    ]
  };
}
