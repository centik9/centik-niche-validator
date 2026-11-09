import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "./errors.js";
import { fetchCountyDrought, fetchSoilShares, FREEZE_THAW, droughtPressureIndex } from "./free-sources.js";
import { createGeoIndex, matchCandidate } from "./geo-match.js";
import { FOUNDATION_WEIGHTS, NEUTRAL_WEIGHTS, nicheProfile } from "./niche-profile.js";
import { normalizePlace } from "./normalize.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let sampleCache = null;
let extractCache = null;

export const SCREEN_MODEL_ID = "centik-free-screen-v1";

const CENSUS_SOURCE = {
  product: "American Community Survey 5-year detailed tables, 2023 release",
  vintage: "2019-2023",
  urls: [
    "https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData/acsdt5y2023-b25001.dat",
    "https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData/acsdt5y2023-b25003.dat",
    "https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData/acsdt5y2023-b25034.dat",
    "https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData/acsdt5y2023-b19013.dat"
  ],
  names: "2024 Census Gazetteer national county, place, and CBSA files",
  geography_note: "A place, a county, and a metro are different summary levels. Their estimates are not ranked against each other."
};

const SOIL_NOTE = "Share of rated component acres whose highest representative linear extensibility (lep_r) in horizons starting above 100 cm is at least 6 percent. Acres are map-unit acres times component percent. Unrated acres are excluded, so this is not a share of the whole county. NRCS uses 6 percent as the start of the high shrink-swell class. This is not a site diagnosis.";
const DROUGHT_NOTE = "December Palmer Drought Severity Index for 2023 and 2024 from NOAA Climate at a Glance, county series. The latest returned December is used. The pressure index is round(50 - 10 x PDSI), clamped to 0-100, so a drier negative PDSI scores higher. It is not measured demand and not a foundation failure count.";

export function loadSampleCatalog() {
  if (!sampleCache) sampleCache = JSON.parse(readFileSync(path.join(root, "data", "screen-sample.json"), "utf8"));
  return sampleCache;
}

export function loadExtractCatalog() {
  if (!extractCache) extractCache = JSON.parse(readFileSync(path.join(root, "data", "acs-2023-5yr-extract.json"), "utf8"));
  return extractCache;
}

function parseCandidates(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 20) {
    throw new HttpError(400, "invalid_input", "Provide 1 to 20 candidates.");
  }
  return raw.map((item, index) => {
    if (!item || typeof item !== "object") throw new HttpError(400, "invalid_input", "Each candidate must be an object.");
    const geographyType = item.geography_type;
    if (!["city", "county", "metro"].includes(geographyType)) {
      throw new HttpError(400, "invalid_input", "Each candidate geography_type must be city, county, or metro.");
    }
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const state = typeof item.state === "string" ? item.state.trim() : "";
    if (name.length < 2 || name.length > 80 || state.length < 2 || state.length > 40) {
      throw new HttpError(400, "invalid_input", "Each candidate needs a name and a state.");
    }
    let competitors = null;
    if (item.user_reported_competitor_count !== undefined && item.user_reported_competitor_count !== null && item.user_reported_competitor_count !== "") {
      if (!Number.isInteger(item.user_reported_competitor_count) || item.user_reported_competitor_count < 0 || item.user_reported_competitor_count > 500) {
        throw new HttpError(400, "invalid_input", "user_reported_competitor_count must be an integer from 0 to 500.");
      }
      competitors = item.user_reported_competitor_count;
    }
    return { id: `c${index + 1}`, geography_type: geographyType, name, state, user_reported_competitor_count: competitors };
  });
}

function parseScreenMode(value) {
  if (value === "sample" || value === "free") return value;
  throw new HttpError(400, "invalid_mode", "Free screening mode must be sample or free. It does not call DataForSEO.");
}

function numberField(value, unit, source) {
  if (value === null || value === undefined) return { status: "missing", value: null, unit, source, note: "No estimate was present. Missing is not zero." };
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return { status: "unusable", value: null, unit, source };
  if (value === 0) return { status: "measured_zero", value: 0, unit, source };
  return { status: "measured", value, unit, source };
}

function rateField(numerator, denominator, unit, source) {
  if (!numerator || !denominator) return { status: "missing", value: null, unit, source, note: "A rate was not computed because an input estimate was missing. Missing is not zero." };
  if (numerator.status !== "measured" && numerator.status !== "measured_zero") return { status: numerator.status, value: null, unit, source };
  if (denominator.status !== "measured") {
    return { status: "unusable", value: null, unit, source, note: "The denominator was not a positive measured count, so the rate was not treated as zero." };
  }
  const value = numerator.value / denominator.value;
  return { status: value === 0 ? "measured_zero" : "measured", value, unit, source };
}

function censusSignals(row, geographyType) {
  const source = { ...CENSUS_SOURCE, spatial_granularity: geographyType };
  if (!row) {
    const missing = numberField(null, "housing units", source);
    return { housing_units: missing, owner_occupancy_rate: { ...missing, unit: "share of occupied units" }, older_housing_share: { ...missing, unit: "share of housing units" }, median_household_income: { ...missing, unit: "USD, ACS median" } };
  }
  const housing = numberField(row.hu, "housing units", source);
  const occupied = numberField(row.occ, "occupied housing units", source);
  const owned = numberField(row.own, "owner-occupied housing units", source);
  const yearTotal = numberField(row.ytot, "housing units with a year-built estimate", source);
  const older = row.old_partial
    ? { status: "missing", value: null, unit: "housing units built 1979 or earlier", source, note: "At least one pre-1980 year-built bucket was null, so the older-stock count was not filled with zero." }
    : numberField(row.old, "housing units built 1979 or earlier", source);
  return {
    housing_units: housing,
    occupied_housing_units: occupied,
    owner_occupied_housing_units: owned,
    owner_occupancy_rate: rateField(owned, occupied, "share of occupied housing units", source),
    older_housing_share: rateField(older, yearTotal, "share of housing units built 1979 or earlier", source),
    median_household_income: {
      ...numberField(row.inc, "USD, 2023 ACS 5-year median household income", source),
      excluded_from_rank: true,
      note: "Shown as context. Weight is 0. Income is not treated as ability to pay or as revenue."
    }
  };
}

function soilSignal(geographyType, snapshot, mode) {
  const source = {
    url: "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest",
    product: "USDA NRCS SSURGO via Soil Data Access",
    retrieved_on: mode === "sample" ? "2026-11-08 snapshot" : "queried for this request",
    spatial_granularity: "county soil survey area (state abbreviation plus county FIPS)",
    methodology: SOIL_NOTE
  };
  if (geographyType !== "county") {
    return { status: "unsupported", value: null, unit: "share of rated component acres with linear extensibility >= 6%", source, note: "Soil was not copied from a surrounding county onto a city or metro." };
  }
  if (!snapshot) return { status: "unavailable", value: null, unit: "share of rated component acres with linear extensibility >= 6%", source, note: "Soil Data Access returned no rated row for this survey area. Unavailable is not zero shrink-swell." };
  if (!Number.isFinite(snapshot.rated_acres) || snapshot.rated_acres <= 0) {
    return { status: "unavailable", value: null, unit: "share of rated component acres with linear extensibility >= 6%", source, areasymbol: snapshot.areasymbol, note: "Rated acres were missing, so a zero share was not assumed." };
  }
  const share = snapshot.high_acres / snapshot.rated_acres;
  return {
    status: share === 0 ? "measured_zero" : "measured",
    value: share,
    high_acres: snapshot.high_acres,
    rated_acres: snapshot.rated_acres,
    areasymbol: snapshot.areasymbol,
    unit: "share of rated component acres with linear extensibility >= 6%",
    source
  };
}

function droughtSignal(geographyType, row, mode) {
  const source = {
    product: "NOAA NCEI Climate at a Glance, county Palmer Drought Severity Index",
    window: "December 2023 and December 2024",
    spatial_granularity: "county",
    methodology: DROUGHT_NOTE,
    url: row && row.url
  };
  if (geographyType !== "county") {
    return { status: "unsupported", value: null, unit: "PDSI", source, note: "Palmer drought indices are not used for a city or metro in this screen. NOAA does not offer PDSI for cities, and a county value was not borrowed." };
  }
  if (!row || row.status === "failed") return { status: "failed", value: null, unit: "PDSI", source, note: "The county drought request failed. Failure is not a neutral or wet climate." };
  if (!row || row.status === "missing" || row.value === undefined || row.value === null) {
    return { status: "missing", value: null, unit: "PDSI", source, note: "No December PDSI value was returned. Missing is not zero." };
  }
  return {
    status: "measured",
    value: row.value,
    period: row.period,
    title: row.title,
    pressure_index: droughtPressureIndex(row.value),
    unit: "Palmer Drought Severity Index",
    source: { ...source, retrieved_on: mode === "sample" ? "2026-11-08 snapshot" : "queried for this request" }
  };
}

function relativeIndex(value, peers) {
  if (peers.length < 2) {
    return { status: "not_compared", value: null, note: "A within-shortlist position needs at least two measured values in this geography group. It was not filled with 50 or 100." };
  }
  const min = Math.min(...peers);
  const max = Math.max(...peers);
  if (max === min) return { status: "measured", value: 50, note: "Every measured value in this geography group is equal." };
  return { status: "measured", value: Math.round(((value - min) * 100) / (max - min)), note: "Position inside this submitted group only. Not a national percentile." };
}

function nominalWeights(profile, geographyType) {
  const base = profile.id === "foundation_soil" ? { ...FOUNDATION_WEIGHTS } : { ...NEUTRAL_WEIGHTS };
  if (geographyType !== "county") {
    delete base.high_shrink_swell_share;
    delete base.drought_pressure;
  }
  if (profile.id !== "foundation_soil") {
    delete base.high_shrink_swell_share;
    delete base.drought_pressure;
    delete base.older_housing_share;
  }
  return base;
}

function combine(components) {
  const used = components.filter((item) => item.applicable && item.index_status === "measured");
  const applicable = components.filter((item) => item.applicable);
  if (!used.length) {
    return {
      status: "withheld",
      value: null,
      reason: "No applicable measured component was available. Missing and unsupported inputs were not scored as zero.",
      weights_used: [],
      completeness: { measured: 0, applicable: applicable.length }
    };
  }
  const weightSum = used.reduce((sum, item) => sum + item.nominal_weight, 0);
  const value = Math.round(used.reduce((sum, item) => sum + item.nominal_weight * item.index, 0) / weightSum);
  return {
    status: "calculated",
    value,
    reason: null,
    weights_used: used.map((item) => ({
      id: item.id,
      nominal_weight: item.nominal_weight,
      weight_used: Math.round((item.nominal_weight * 1000) / weightSum) / 1000,
      index: item.index
    })),
    completeness: { measured: used.length, applicable: applicable.length },
    renormalized: used.length !== applicable.length
  };
}

function component(id, applicable, nominalWeight, indexResult) {
  return {
    id,
    applicable,
    nominal_weight: applicable ? nominalWeight : 0,
    index_status: !applicable ? "not_applicable" : indexResult.status,
    index: indexResult && indexResult.status === "measured" ? indexResult.value : null,
    note: indexResult && indexResult.note
  };
}

export async function screenCandidates(raw, deps = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "invalid_input", "JSON object expected.");
  const mode = parseScreenMode(raw.mode);
  const niche = typeof raw.niche === "string" ? raw.niche.trim() : "";
  if (niche.length < 2 || niche.length > 80) throw new HttpError(400, "invalid_input", "Niche must be 2-80 characters.");
  const candidates = parseCandidates(raw.candidates);
  const profile = nicheProfile(niche);
  const catalog = mode === "sample" ? (deps.sampleCatalog || loadSampleCatalog()) : (deps.extract || loadExtractCatalog());
  const index = createGeoIndex(catalog);
  const resolved = candidates.map((candidate) => ({ candidate, match: matchCandidate(index, candidate) }));
  const counties = resolved.filter((item) => item.match.outcome === "matched" && item.match.geography_type === "county").map((item) => item.match);

  let soilRows = {};
  let droughtRows = {};
  let soilError = null;
  const calls = [];
  if (mode === "sample") {
    soilRows = catalog.soil_snapshot || {};
    droughtRows = {};
    for (const [geoid, row] of Object.entries(catalog.drought_snapshot || {})) {
      droughtRows[geoid] = { status: "measured", ...row, url: "snapshot:NOAA Climate at a Glance county PDSI December 2023-2024" };
    }
  } else if (counties.length) {
    const fetchImpl = deps.fetchImpl || globalThis.fetch;
    try {
      const soil = await fetchSoilShares(counties, fetchImpl);
      soilRows = soil.rows;
      if (soil.requested) calls.push({ endpoint: soil.url, sent_to_dataforseo: false, billable: false });
    } catch (error) {
      soilError = error.message || "Soil Data Access failed.";
    }
    droughtRows = await fetchCountyDrought(counties, fetchImpl);
    for (const row of Object.values(droughtRows)) {
      if (row.url) calls.push({ endpoint: row.url, sent_to_dataforseo: false, billable: false });
    }
  }

  const drafted = resolved.map((item) => {
    const matched = item.match.outcome === "matched";
    const row = matched ? item.match.row : null;
    const geographyType = item.candidate.geography_type;
    const signals = censusSignals(matched ? row : null, geographyType);
    if (!matched) {
      for (const signal of Object.values(signals)) {
        signal.status = item.match.outcome === "ambiguous" ? "ambiguous" : "unsupported";
        signal.value = null;
        signal.note = item.match.reason;
      }
    }
    const soil = soilError && geographyType === "county"
      ? { status: "failed", value: null, unit: "share of rated component acres with linear extensibility >= 6%", note: soilError }
      : soilSignal(geographyType, matched ? soilRows[item.match.geoid] : null, mode);
    const drought = droughtSignal(geographyType, matched ? droughtRows[item.match.geoid] : null, mode);
    return { ...item, signals, soil, drought, matched };
  });

  const groups = { city: [], county: [], metro: [] };
  for (const item of drafted) {
    if (item.matched) groups[item.candidate.geography_type].push(item);
  }
  const peerValues = (list, read) => list.map(read).filter((value) => typeof value === "number");

  const candidatesOut = drafted.map((item) => {
    const group = groups[item.candidate.geography_type];
    const weights = nominalWeights(profile, item.candidate.geography_type);
    const housingPeers = peerValues(group, (peer) => peer.signals.housing_units.status === "measured" || peer.signals.housing_units.status === "measured_zero" ? peer.signals.housing_units.value : null);
    const ownerPeers = peerValues(group, (peer) => peer.signals.owner_occupancy_rate.status === "measured" ? peer.signals.owner_occupancy_rate.value : null);
    const olderPeers = peerValues(group, (peer) => peer.signals.older_housing_share.status === "measured" ? peer.signals.older_housing_share.value : null);
    const housingValue = item.signals.housing_units.value;
    const housingIndex = item.signals.housing_units.status === "measured" || item.signals.housing_units.status === "measured_zero"
      ? relativeIndex(housingValue, housingPeers)
      : { status: item.signals.housing_units.status, value: null };
    const ownerIndex = item.signals.owner_occupancy_rate.status === "measured"
      ? relativeIndex(item.signals.owner_occupancy_rate.value, ownerPeers)
      : { status: item.signals.owner_occupancy_rate.status, value: null };
    const olderIndex = item.signals.older_housing_share.status === "measured"
      ? relativeIndex(item.signals.older_housing_share.value, olderPeers)
      : { status: item.signals.older_housing_share.status, value: null };
    const soilIndex = item.soil.status === "measured" || item.soil.status === "measured_zero"
      ? { status: "measured", value: Math.round(item.soil.value * 100) }
      : { status: item.soil.status, value: null };
    const droughtIndex = item.drought.status === "measured"
      ? { status: "measured", value: item.drought.pressure_index }
      : { status: item.drought.status, value: null };
    const parts = [
      component("housing_units", weights.housing_units !== undefined, weights.housing_units || 0, housingIndex),
      component("owner_occupancy_rate", weights.owner_occupancy_rate !== undefined, weights.owner_occupancy_rate || 0, ownerIndex),
      component("older_housing_share", weights.older_housing_share !== undefined, weights.older_housing_share || 0, olderIndex),
      component("high_shrink_swell_share", weights.high_shrink_swell_share !== undefined, weights.high_shrink_swell_share || 0, soilIndex),
      component("drought_pressure", weights.drought_pressure !== undefined, weights.drought_pressure || 0, droughtIndex)
    ];
    const rank = item.matched ? combine(parts) : {
      status: "withheld",
      value: null,
      reason: item.match.reason,
      weights_used: [],
      completeness: { measured: 0, applicable: parts.filter((part) => part.applicable).length },
      renormalized: false
    };
    const deepAllowed = item.matched && item.candidate.geography_type === "city";
    return {
      id: item.candidate.id,
      input: item.candidate,
      geography: {
        geography_type: item.candidate.geography_type,
        outcome: item.match.outcome,
        geoid: item.match.geoid || null,
        census_name: item.match.census_name || null,
        state_fips: item.match.state_fips || null,
        state_usps: item.match.state_usps || null,
        matches: item.match.matches || [],
        reason: item.match.reason || null
      },
      signals: {
        ...item.signals,
        high_shrink_swell_share: item.soil,
        drought_pdsi: item.drought,
        freeze_thaw_cycles: FREEZE_THAW,
        user_reported_competitors: item.candidate.user_reported_competitor_count === null
          ? { status: "not_provided", value: null, excluded_from_rank: true, note: "No manual competitor count was entered. Maps was not queried." }
          : { status: item.candidate.user_reported_competitor_count === 0 ? "user_reported_zero" : "user_reported", value: item.candidate.user_reported_competitor_count, excluded_from_rank: true, note: "A person typed this count. It is not a Google Maps census and it is not part of the screen index." }
      },
      components: parts,
      screen_index: rank,
      deep_check: deepAllowed
        ? {
          allowed: true,
          geography_type: "city",
          city: item.candidate.name,
          state: item.candidate.state,
          country: "United States",
          niche,
          note: "This only copies the city into the deep-check form. It does not resolve a DataForSEO location and it does not send a paid request. Census place names and DataForSEO city names are different directories."
        }
        : {
          allowed: false,
          geography_type: item.candidate.geography_type,
          reason: item.candidate.geography_type === "city"
            ? "This city was not uniquely matched, so it was not copied into the deep check."
            : "The existing deep check resolves a city place only. This county or metro was not converted into a city and no DataForSEO request was sent."
        }
    };
  });

  for (const type of ["city", "county", "metro"]) {
    const ranked = candidatesOut.filter((item) => item.input.geography_type === type && item.screen_index.status === "calculated");
    ranked.sort((a, b) => b.screen_index.value - a.screen_index.value || a.input.name.localeCompare(b.input.name));
    ranked.forEach((item, position) => {
      item.screen_index.position_in_group = position + 1;
      item.screen_index.group = type;
    });
  }

  return {
    model_id: SCREEN_MODEL_ID,
    data_origin: mode === "sample" ? "sample" : "free_public",
    example_data: mode === "sample",
    example_banner: mode === "sample"
      ? "Sample screen. These rows are a frozen copy of named public sources for this short list only. They are not a live query and not a national ranking."
      : null,
    free_banner: mode === "free"
      ? "Free public-data screen. Census figures are the bundled 2023 ACS 5-year extract. County soil and December PDSI are requested from USDA and NOAA for this screen. DataForSEO is not called."
      : null,
    score_is_recommendation: false,
    score_is_probability: false,
    score_is_revenue_prediction: false,
    distinct_from_paid_heuristic_index: true,
    paid_dataforseo_called: false,
    cross_type_rank: null,
    cross_type_rank_reason: "Place, county, and metro estimates cover different areas. A single rank across those types is withheld.",
    niche,
    profile,
    formula: {
      within_group: "For each geography type, comparable measured inputs are scaled and combined with the profile weights. Relative inputs use only the submitted group. Missing inputs are dropped and the remaining weights are renormalized. They are not entered as zero.",
      housing_and_rates: "Housing units, owner-occupancy, and older-stock share are positions inside this submitted geography group, from 0 at the group minimum to 100 at the group maximum.",
      soil: "County high shrink-swell share times 100. Not used for cities or metros. Weight 0 unless the niche is on the foundation profile.",
      drought: "County December PDSI transformed by round(50 - 10 x PDSI). Not used for cities or metros. Weight 0 unless the niche is on the foundation profile.",
      income: "Median household income is displayed and has weight 0."
    },
    sources: {
      census: mode === "sample"
        ? { status: "sample_fixture", live_request: false, note: "Sample mode does not open the national extract and does not call the Census API." }
        : { status: "bundled_extract", live_request: false, note: "The Census Data API required a key at the time of this build, and this server has no key. The extract is the public 2023 ACS 5-year table-based summary file for summary levels 050, 160, and 310, named with the 2024 Gazetteer. Name vintage and estimate vintage are not the same.", ...CENSUS_SOURCE },
      soil: mode === "sample"
        ? { status: "snapshot", live_request: false, note: SOIL_NOTE }
        : { status: counties.length ? (soilError ? "failed" : "queried") : "not_requested", live_request: Boolean(counties.length), note: SOIL_NOTE },
      drought: { status: mode === "sample" ? "snapshot" : (counties.length ? "queried" : "not_requested"), live_request: mode === "free" && counties.length > 0, note: DROUGHT_NOTE },
      freeze_thaw_cycles: FREEZE_THAW
    },
    candidates: candidatesOut,
    requests: calls,
    limitations: [
      "This screen index is not the paid DataForSEO heuristic index, not a probability, and not a revenue or customer forecast.",
      "Census place, county, and metro figures are ranked only inside their own geography type.",
      "A missing, suppressed, failed, or unavailable Census, soil, or climate value is not treated as zero and is not treated as a safe or mild condition.",
      "Soil shrink-swell and drought are county survey or county climate proxies. They are not a foundation diagnosis and they do not measure search demand.",
      "Freeze-thaw cycle counts are not in this screen. They are unavailable, not zero.",
      "The foundation profile is an explicit keyword list. Other niches use the neutral profile, which gives soil and drought weight 0.",
      "Median income and a manually typed competitor count are context only.",
      "Choosing a city copies it into the deep-check form. The deep check still requires its own city confirmation and never starts from this screen by itself.",
      mode === "sample"
        ? "Sample rows are a frozen short list. A name outside that list is unsupported here, not a measured zero."
        : "The ACS extract is county, place, and metro/micro summary levels, not every tract or address. Nine 2023 GEOIDs without a 2024 Gazetteer name were omitted."
    ]
  };
}

export function normalizeScreenName(value) {
  return normalizePlace(value);
}
