import {
  EXAMPLE_BANNER,
  LANGUAGE_CODE,
  LIVE_BANNER,
  MAPS_DEPTH,
  MAPS_DEVICE,
  MAPS_OS,
  MAPS_PATH,
  ORGANIC_DEPTH,
  ORGANIC_PATH,
  BING_SEARCH_VOLUME_PATH,
  SEARCH_VOLUME_PATH,
  TRENDS_PATH,
  TRENDS_UPSTREAM_TIMEOUT_MS,
  adsLocationsPath,
  mapsLocationsPath
} from "./config.js";
import { demandFromError, demandNotSent, parseDemandPayload } from "./demand.js";
import { HttpError } from "./errors.js";
import { parseResolveInput, parseValidateInput } from "./input.js";
import { STANDING_LIMITATIONS } from "./limitations.js";
import { combineLocationOutcomes, matchCity } from "./locations.js";
import { mapsFromError, mapsNotSent, parseMapsPayload } from "./maps.js";
import { organicFromError, organicNotSent, parseOrganicPayload } from "./organic.js";
import { trendsFromError, trendsNotSent, parseTrendsPayload } from "./trends.js";
import { resolveMetroMembership } from "./metro-membership.js";
import { selectBingVolumeLocation, selectTrendsLocation, selectVolumeLocations } from "./trends-location.js";
import { ADS_COST_USD, BING_VOLUME_COST_USD } from "./spend.js";
import {
  CITY_CORE_VOLUME_THRESHOLD,
  broaderVolumeIsBlank,
  buildVolumeEstimate,
  cityVolumeNeedsFallback,
  housingShareFor
} from "./volume-fallback.js";
import { buildVolumeKeywords } from "./volume-keywords.js";
import { cityMarketFromReports } from "./live-market.js";
import { scoreFromIndexes } from "./composite-score.js";
import { buildScore } from "./scoring.js";

const BLOCK_MESSAGE = {
  ambiguous: "More than one city row matches this city, state, and country. No row was selected. Search volume and Maps were not requested.",
  unconfirmed: "A row matched the city name, but the parent admin region did not confirm the state. No row was selected. Search volume and Maps were not requested.",
  unsupported: "No confirmed city row matched this city, state, and country. Search volume and Maps were not requested.",
  failed: "A location list failed, so nothing was confirmed. Search volume and Maps were not requested."
};

function marketMeasurement(origin) {
  return {
    live_provider_response: origin === "live",
    exhaustive_market: false,
    buyers_verified: false,
    economic_value_estimated: false
  };
}

function sameIdentity(confirmed, match) {
  if (confirmed == null && match == null) return true;
  if (!confirmed || !match) return false;
  return confirmed.location_code === match.location_code
    && confirmed.location_name === match.location_name
    && confirmed.location_type === match.location_type;
}

async function settle(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error };
  }
}

function clipError(redact, error) {
  const text = String(error && error.message ? error.message : "Location list request failed.");
  return (redact ? redact(text) : text).replace(/[\u0000-\u001f]/g, " ").slice(0, 300);
}

function failedProduct(error, deps) {
  return {
    outcome: "failed",
    match: null,
    matches: [],
    same_city_other_regions: [],
    same_name_other_countries: [],
    rejected_summary: {
      wrong_type: 0,
      wrong_state: 0,
      wrong_country: 0,
      parent_unconfirmed: 0,
      duplicate_code: 0,
      unusable_row: 0
    },
    code_source: deps.codeSource,
    error: { code: (error && error.code) || "failed", message: clipError(deps.redact, error) }
  };
}

function locationAudit(product, iso, call, origin) {
  const path = product === "google_ads" ? adsLocationsPath(iso) : mapsLocationsPath(iso);
  const cache = call.ok ? call.value.cache : "none";
  const blocked = call.error && ["refused", "credentials_missing", "credentials_invalid"].includes(call.error.code);
  const sent = origin === "live" && !blocked && (cache === "miss" || !call.ok);
  return {
    endpoint: `GET ${path}`,
    billable_when_live: false,
    documented_as_uncharged: true,
    cache,
    sent_to_dataforseo: sent,
    invoked: call.ok ? cache === "miss" : !blocked,
    reason_not_sent: sent || (call.ok && cache === "miss") ? null : (cache === "hit" ? "In-memory location cache hit. The list was not requested again." : null)
  };
}

async function resolvePrepared(prepared, deps) {
  const query = {
    cityNorm: prepared.cityNorm,
    stateNorm: prepared.stateNorm,
    countryIso: prepared.countryIso,
    codeSource: deps.codeSource
  };
  const [adsCall, mapsCall] = await Promise.all([
    settle(() => deps.directory.list("google_ads", prepared.countryIso)),
    settle(() => deps.directory.list("google_maps", prepared.countryIso))
  ]);
  const googleAds = adsCall.ok ? matchCity(adsCall.value.rows, query) : failedProduct(adsCall.error, deps);
  const googleMaps = mapsCall.ok ? matchCity(mapsCall.value.rows, query) : failedProduct(mapsCall.error, deps);
  const outcome = combineLocationOutcomes(googleAds.outcome, googleMaps.outcome);
  const requests = [
    locationAudit("google_ads", prepared.countryIso, adsCall, deps.origin),
    locationAudit("google_maps", prepared.countryIso, mapsCall, deps.origin)
  ];
  return {
    data_origin: deps.origin,
    example_data: deps.origin === "example",
    example_banner: deps.origin === "example" ? EXAMPLE_BANNER : null,
    live_banner: deps.origin === "live"
      ? "Location lists came from DataForSEO. Those list endpoints are documented as not charged. Search volume and Maps were not requested."
      : null,
    note: deps.origin === "example"
      ? "Example gazetteer only. No DataForSEO request was sent. Example location codes are not DataForSEO location codes."
      : "Search volume and Maps were not requested during location resolution.",
    normalized_query: {
      city: prepared.city,
      state: prepared.state,
      country: prepared.country,
      city_normalized: prepared.cityNorm,
      state_normalized: prepared.stateNorm,
      country_iso: prepared.countryIso,
      country_canonical: prepared.countryCanonical
    },
    outcome,
    can_validate: outcome === "matched" || outcome === "partial_match" || outcome === "partial_failure",
    block_message: BLOCK_MESSAGE[outcome] || null,
    google_ads: googleAds,
    google_maps: googleMaps,
    requests,
    market_measurement: marketMeasurement(deps.origin),
    generated_at: new Date((deps.now || Date.now)()).toISOString()
  };
}

function assertConfirmation(resolution, confirmed) {
  if (BLOCK_MESSAGE[resolution.outcome]) {
    throw new HttpError(409, "not_confirmed", BLOCK_MESSAGE[resolution.outcome], { resolution });
  }
  if (!sameIdentity(confirmed.google_ads, resolution.google_ads.match) || !sameIdentity(confirmed.google_maps, resolution.google_maps.match)) {
    throw new HttpError(
      409,
      "confirmation_mismatch",
      "The confirmed location does not match a fresh resolution. Search volume and Maps were not requested.",
      { resolution }
    );
  }
}

async function loadDemand(prepared, resolution, deps) {
  const match = resolution.google_ads.match;
  const audit = {
    endpoint: `POST ${SEARCH_VOLUME_PATH}`,
    billable_when_live: true,
    sent_to_dataforseo: false,
    invoked: false,
    reason_not_sent: null
  };
  if (!match) {
    const status = resolution.google_ads.outcome === "failed" ? "failed" : "unsupported";
    const message = status === "failed"
      ? "Google Ads location list failed. Search volume was not requested."
      : "No confirmed Google Ads city location. Search volume was not requested.";
    audit.reason_not_sent = message;
    return { report: demandNotSent({ status, keyword: prepared.niche, message, code: status }), audit, extraAudits: [] };
  }
  const keywords = buildVolumeKeywords(prepared.niche, prepared.city);
  const task = {
    keywords,
    location_code: match.location_code,
    language_code: LANGUAGE_CODE,
    search_partners: false
  };
  try {
    const payload = await deps.transport.request({ method: "POST", path: SEARCH_VOLUME_PATH, body: [task] });
    const report = parseDemandPayload(payload, {
      keyword: prepared.niche,
      keywords,
      location: match,
      sentToDataForSeo: deps.origin === "live",
      redact: deps.redact
    });
    audit.invoked = true;
    audit.sent_to_dataforseo = deps.origin === "live";
    return broadenOrReport(report, audit, prepared, deps);
  } catch (error) {
    const report = demandFromError(error, {
      keyword: prepared.niche,
      keywords,
      location: match,
      sentToDataForSeo: deps.origin === "live",
      redact: deps.redact
    });
    audit.sent_to_dataforseo = report.sent_to_dataforseo;
    audit.invoked = report.sent_to_dataforseo;
    audit.reason_not_sent = report.sent_to_dataforseo ? null : report.error && report.error.message;
    return broadenOrReport(report, audit, prepared, deps);
  }
}

function volumeTask(keywords, location) {
  return {
    keywords,
    location_code: location.location_code,
    language_code: LANGUAGE_CODE,
    search_partners: false
  };
}

async function requestVolume(prepared, location, path, deps) {
  const keywords = buildVolumeKeywords(prepared.niche, prepared.city);
  const task = volumeTask(keywords, location);
  try {
    const payload = await deps.transport.request({ method: "POST", path, body: [task] });
    return parseDemandPayload(payload, {
      keyword: prepared.niche,
      keywords,
      location,
      sentToDataForSeo: deps.origin === "live",
      redact: deps.redact
    });
  } catch (error) {
    return demandFromError(error, {
      keyword: prepared.niche,
      keywords,
      location,
      sentToDataForSeo: deps.origin === "live",
      redact: deps.redact
    });
  }
}

function attemptFrom(source, level, location, broaderThanCity, report, queried, skipReason) {
  const path = source === "bing" ? BING_SEARCH_VOLUME_PATH : SEARCH_VOLUME_PATH;
  const clustered = report && report.clustered_coverage_volume;
  const core = report && report.search_volume;
  return {
    source,
    level,
    broader_than_city: broaderThanCity,
    queried,
    skip_reason: skipReason || null,
    location_code: location ? location.location_code : null,
    location_name: location ? location.location_name : null,
    location_type: location ? location.location_type : null,
    endpoint: `POST ${path}`,
    sent_to_dataforseo: Boolean(report && report.sent_to_dataforseo),
    status: report ? report.status : "not_requested",
    clustered_volume: clustered && Number.isInteger(clustered.value) ? clustered.value : null,
    clustered_status: clustered ? clustered.status : null,
    core_volume: core && Number.isInteger(core.value) ? core.value : null,
    core_status: core ? core.status : null,
    numeric_month_count: report && report.monthly_searches ? report.monthly_searches.numeric_month_count : 0,
    keyword_volumes: report && Array.isArray(report.keyword_rows)
      ? report.keyword_rows.map((row) => ({
        keyword: row.keyword,
        status: row.search_volume ? row.search_volume.status : "missing",
        value: row.search_volume ? row.search_volume.value : null
      }))
      : [],
    provider_reported_cost_usd: report ? report.provider_reported_cost_usd : null,
    estimated_cost_usd: source === "bing" ? BING_VOLUME_COST_USD : ADS_COST_USD,
    error: report ? report.error : null
  };
}

function fallbackAudit(attempt) {
  return {
    endpoint: attempt.endpoint,
    billable_when_live: true,
    conditional: true,
    source: attempt.source,
    level: attempt.level,
    sent_to_dataforseo: attempt.sent_to_dataforseo,
    invoked: attempt.queried === true,
    reason_not_sent: attempt.queried ? (attempt.sent_to_dataforseo ? null : attempt.error && attempt.error.message) : attempt.skip_reason
  };
}

function finishBroaden(report, decision, built, metroMembership) {
  return {
    report: {
      ...report,
      volume_fallback: {
        triggered: true,
        reason: decision.reason,
        threshold: CITY_CORE_VOLUME_THRESHOLD,
        city_core_total: decision.core_total,
        metro_membership: metroMembership,
        estimate: built.estimate,
        attempts: built.attempts
      }
    },
    extraAudits: built.attempts.map(fallbackAudit)
  };
}

async function broadenDemand(report, prepared, deps) {
  const decision = cityVolumeNeedsFallback(report);
  if (!decision.needed || deps.origin !== "live") return { report, extraAudits: [] };
  const query = {
    cityNorm: prepared.cityNorm,
    stateNorm: prepared.stateNorm,
    countryIso: prepared.countryIso,
    codeSource: deps.codeSource
  };
  let adsRows = [];
  try {
    const listed = await deps.directory.list("google_ads", prepared.countryIso);
    adsRows = listed.rows;
  } catch {
    adsRows = [];
  }
  const membership = resolveMetroMembership({ city: prepared.city, state: prepared.state });
  const locations = selectVolumeLocations(adsRows, query, membership);
  const attempts = [];
  let dmaReport = null;
  if (locations.dma) {
    dmaReport = await requestVolume(prepared, locations.dma, SEARCH_VOLUME_PATH, deps);
    attempts.push(attemptFrom("google_ads", "metro", locations.dma, true, dmaReport, true));
  } else {
    attempts.push(attemptFrom("google_ads", "metro", null, true, null, false, locations.dma_skip_reason || "No Google Ads DMA was selected."));
  }
  const dmaUsable = Boolean(dmaReport) && !broaderVolumeIsBlank(dmaReport);
  if (!dmaUsable && locations.state) {
    const stateReport = await requestVolume(prepared, locations.state, SEARCH_VOLUME_PATH, deps);
    attempts.push(attemptFrom("google_ads", "state", locations.state, true, stateReport, true));
  } else if (dmaUsable) {
    attempts.push(attemptFrom("google_ads", "state", locations.state, true, null, false, "DMA volume was above the blank threshold, so the state volume was not requested."));
  } else {
    attempts.push(attemptFrom("google_ads", "state", null, true, null, false, "No state location row matched, so state volume was not requested."));
  }
  let bingPick = { level: "unavailable", match: null, broader_than_city: true };
  try {
    const listed = await deps.directory.list("bing", prepared.countryIso);
    bingPick = selectBingVolumeLocation(listed.rows, query);
  } catch {
    bingPick = { level: "unavailable", match: null, broader_than_city: true };
  }
  if (bingPick.match) {
    const bingReport = await requestVolume(prepared, bingPick.match, BING_SEARCH_VOLUME_PATH, deps);
    attempts.push(attemptFrom("bing", bingPick.level, bingPick.match, bingPick.broader_than_city, bingReport, true));
  } else {
    attempts.push(attemptFrom("bing", "unavailable", null, true, null, false, "Bing has no city, metro, or state location for this market. National Bing volume was not requested."));
  }
  const shareFor = (attempt) => {
    const fn = deps.housingShare || housingShareFor;
    return fn({
      city: prepared.city,
      state: prepared.state,
      level: attempt.level,
      locationName: attempt.location_name,
      source: attempt.source
    });
  };
  let built = buildVolumeEstimate(attempts, shareFor);
  const dmaScaled = built.attempts.find((attempt) => attempt.source === "google_ads" && attempt.level === "metro" && attempt.candidate);
  const stateQueried = built.attempts.some((attempt) => attempt.source === "google_ads" && attempt.level === "state" && attempt.queried);
  if (dmaReport && !dmaScaled && locations.state && !stateQueried) {
    const stateReport = await requestVolume(prepared, locations.state, SEARCH_VOLUME_PATH, deps);
    const stateAttempt = attemptFrom("google_ads", "state", locations.state, true, stateReport, true);
    const replaced = built.attempts.map((attempt) => (
      attempt.source === "google_ads" && attempt.level === "state" ? stateAttempt : attempt
    ));
    built = buildVolumeEstimate(replaced, shareFor);
  }
  return finishBroaden(report, decision, built, locations.membership);
}

async function broadenOrReport(report, audit, prepared, deps) {
  const broadened = await broadenDemand(report, prepared, deps);
  return { report: broadened.report, audit, extraAudits: broadened.extraAudits };
}

async function loadMaps(prepared, resolution, deps) {
  const match = resolution.google_maps.match;
  const audit = {
    endpoint: `POST ${MAPS_PATH}`,
    billable_when_live: true,
    sent_to_dataforseo: false,
    invoked: false,
    reason_not_sent: null
  };
  if (!match) {
    const status = resolution.google_maps.outcome === "failed" ? "failed" : "unsupported";
    const message = status === "failed"
      ? "Google Maps location list failed. Maps were not requested."
      : "No confirmed Google Maps city location. Maps were not requested.";
    audit.reason_not_sent = message;
    return {
      report: mapsNotSent({ status, message, code: status, queryCity: prepared.city }),
      audit
    };
  }
  const task = {
    keyword: prepared.niche,
    location_code: match.location_code,
    language_code: LANGUAGE_CODE,
    depth: MAPS_DEPTH,
    device: MAPS_DEVICE,
    os: MAPS_OS,
    search_this_area: true
  };
  try {
    const payload = await deps.transport.request({ method: "POST", path: MAPS_PATH, body: [task] });
    const report = parseMapsPayload(payload, {
      location: match,
      sentToDataForSeo: deps.origin === "live",
      redact: deps.redact,
      queryCity: prepared.city,
      requestedDepth: task.depth
    });
    audit.invoked = true;
    audit.sent_to_dataforseo = deps.origin === "live";
    return { report, audit };
  } catch (error) {
    const report = mapsFromError(error, {
      location: match,
      sentToDataForSeo: deps.origin === "live",
      redact: deps.redact,
      queryCity: prepared.city,
      requestedDepth: task.depth
    });
    audit.sent_to_dataforseo = report.sent_to_dataforseo;
    audit.invoked = report.sent_to_dataforseo;
    audit.reason_not_sent = report.sent_to_dataforseo ? null : report.error && report.error.message;
    return { report, audit };
  }
}

async function loadOrganic(prepared, resolution, deps) {
  const match = resolution.google_maps.match;
  const audit = {
    endpoint: `POST ${ORGANIC_PATH}`,
    billable_when_live: true,
    sent_to_dataforseo: false,
    invoked: false,
    reason_not_sent: null
  };
  if (!match) {
    const status = resolution.google_maps.outcome === "failed" ? "failed" : "unsupported";
    const message = "No confirmed Google Maps city location. Regular Google results were not requested.";
    audit.reason_not_sent = message;
    return { report: organicNotSent({ status, message, code: status, keyword: prepared.niche }), audit };
  }
  const task = {
    keyword: prepared.niche,
    location_code: match.location_code,
    language_code: LANGUAGE_CODE,
    depth: ORGANIC_DEPTH,
    device: MAPS_DEVICE,
    os: MAPS_OS
  };
  try {
    const payload = await deps.transport.request({ method: "POST", path: ORGANIC_PATH, body: [task] });
    const report = parseOrganicPayload(payload, {
      keyword: prepared.niche,
      location: match,
      sentToDataForSeo: deps.origin === "live",
      redact: deps.redact
    });
    audit.invoked = true;
    audit.sent_to_dataforseo = deps.origin === "live";
    return { report, audit };
  } catch (error) {
    const report = organicFromError(error, {
      keyword: prepared.niche,
      location: match,
      sentToDataForSeo: deps.origin === "live",
      redact: deps.redact
    });
    audit.sent_to_dataforseo = report.sent_to_dataforseo;
    audit.invoked = report.sent_to_dataforseo;
    audit.reason_not_sent = report.sent_to_dataforseo ? null : report.error && report.error.message;
    return { report, audit };
  }
}

async function loadTrends(prepared, deps) {
  const audit = {
    endpoint: `POST ${TRENDS_PATH}`,
    billable_when_live: true,
    sent_to_dataforseo: false,
    invoked: false,
    reason_not_sent: null
  };
  const query = {
    cityNorm: prepared.cityNorm,
    stateNorm: prepared.stateNorm,
    countryIso: prepared.countryIso,
    codeSource: deps.codeSource
  };
  let geo;
  try {
    const listed = await deps.directory.list("google_trends", prepared.countryIso);
    geo = selectTrendsLocation(listed.rows, query);
    audit.location_list_cache = listed.cache;
  } catch (error) {
    const report = trendsFromError(error, {
      keyword: prepared.niche,
      geo: null,
      sentToDataForSeo: false,
      redact: deps.redact
    });
    report.sent_to_dataforseo = false;
    audit.reason_not_sent = report.error && report.error.message;
    return { report, audit };
  }
  if (!geo.match) {
    const report = trendsNotSent({
      status: "missing",
      keyword: prepared.niche,
      geo,
      message: geo.note,
      code: "trends_location_unavailable"
    });
    audit.reason_not_sent = geo.note;
    return { report, audit };
  }
  const task = {
    keywords: [prepared.niche],
    location_code: geo.match.location_code,
    language_code: LANGUAGE_CODE,
    type: "web",
    time_range: "past_12_months",
    item_types: ["google_trends_graph"]
  };
  try {
    const payload = await deps.transport.request({
      method: "POST",
      path: TRENDS_PATH,
      body: [task],
      timeoutMs: TRENDS_UPSTREAM_TIMEOUT_MS
    });
    const report = parseTrendsPayload(payload, {
      keyword: prepared.niche,
      geo,
      sentToDataForSeo: deps.origin === "live",
      redact: deps.redact
    });
    audit.invoked = true;
    audit.sent_to_dataforseo = deps.origin === "live";
    return { report, audit };
  } catch (error) {
    const report = trendsFromError(error, {
      keyword: prepared.niche,
      geo,
      sentToDataForSeo: deps.origin === "live",
      redact: deps.redact
    });
    audit.sent_to_dataforseo = report.sent_to_dataforseo;
    audit.invoked = report.sent_to_dataforseo;
    audit.reason_not_sent = report.sent_to_dataforseo ? null : report.error && report.error.message;
    return { report, audit };
  }
}

function markEstimatedComposite(composite, cityMarket) {
  if (!composite || !cityMarket || !cityMarket.demand_estimated || composite.status !== "calculated") return composite;
  return {
    ...composite,
    grade_state: "estimated",
    demand_estimated: true,
    data_label: cityMarket.demand_label,
    demand: {
      ...composite.demand,
      label: cityMarket.demand_label,
      monthly_searches: cityMarket.estimated_city_volume
    }
  };
}

function liveCompositeFor({ origin, cityMarket, marginIndex, marginEstimated, score }) {
  if (origin !== "live") return null;
  if (marginIndex !== null && cityMarket.demand_index !== null && cityMarket.competition_index !== null) {
    return markEstimatedComposite(scoreFromIndexes({
      demandIndex: cityMarket.demand_index,
      competitionIndex: cityMarket.competition_index,
      marginIndex,
      estimated: marginEstimated === true
    }), cityMarket);
  }
  if (cityMarket.demand_index === 0) {
    const display = score.overall_display || "14.9";
    return {
      status: "calculated",
      grade_state: "capped_fail",
      model_id: "centik-composite-v1",
      composite_tenths: score.overall_tenths,
      composite_display: display,
      band: "red",
      score_band: "red",
      clears_green: false,
      clears_green_label: "no",
      withheld_reason: null,
      grade_cap: score.grade_cap || {
        applied: true,
        reason: "measured_zero_demand",
        uncapped_display: null,
        note: "Measured zero demand cannot produce a favorable grade. The displayed grade stays a clear fail."
      },
      demand: { index: 0, contribution_display: "0.0", label: "Measured zero", monthly_searches: 0 },
      competition: {
        index: cityMarket.competition_index,
        contribution_display: null,
        label: "Live Google data"
      },
      margin: { index: null, contribution_display: null, label: "Insufficient data" }
    };
  }
  if (cityMarket.demand_index !== null) return null;
  return {
    status: "insufficient_data",
    grade_state: "insufficient_data",
    model_id: "centik-composite-v1",
    composite_tenths: null,
    composite_display: null,
    band: "missing",
    score_band: "missing",
    clears_green: null,
    clears_green_label: "insufficient data",
    withheld_reason: score.withheld_reason || "Insufficient data. Demand was not measured, so there is no grade.",
    grade_cap: {
      applied: false,
      reason: "demand_not_measured",
      note: "A source that returned nothing, an empty keyword list, a failed call, or an unusable partial is not a measured zero and is not a grade."
    },
    demand: {
      index: null,
      contribution_display: null,
      label: "Insufficient data",
      monthly_searches: null
    },
    competition: {
      index: null,
      contribution_display: null,
      label: "Insufficient data"
    },
    margin: {
      index: null,
      contribution_display: null,
      label: "Insufficient data"
    }
  };
}

export async function resolveLocation(input, deps) {
  const prepared = input && input.cityNorm ? input : parseResolveInput(input);
  return resolvePrepared(prepared, deps);
}

export async function validateNiche(input, deps) {
  const prepared = input && input.cityNorm && input.confirmed ? input : parseValidateInput(input);
  const resolution = await resolvePrepared(prepared, deps);
  assertConfirmation(resolution, prepared.confirmed);
  const [demand, maps, organic, trends] = await Promise.all([
    loadDemand(prepared, resolution, deps),
    loadMaps(prepared, resolution, deps),
    loadOrganic(prepared, resolution, deps),
    loadTrends(prepared, deps)
  ]);
  const score = buildScore({ demand: demand.report, maps: maps.report, origin: deps.origin });
  const cityMarket = cityMarketFromReports(demand.report, maps.report, deps.origin);
  const marginIndex = Number.isInteger(prepared.margin_index) ? prepared.margin_index : null;
  const liveComposite = liveCompositeFor({
    origin: deps.origin,
    cityMarket,
    marginIndex,
    marginEstimated: prepared.margin_estimated === true,
    score
  });
  return {
    data_origin: deps.origin,
    example_data: deps.origin === "example",
    example_banner: deps.origin === "example" ? EXAMPLE_BANNER : null,
    live_banner: deps.origin === "live" ? LIVE_BANNER : null,
    market_measurement: marketMeasurement(deps.origin),
    generated_at: new Date((deps.now || Date.now)()).toISOString(),
    niche: prepared.niche,
    normalized_query: resolution.normalized_query,
    location: {
      outcome: resolution.outcome,
      google_ads: resolution.google_ads.match,
      google_maps: resolution.google_maps.match,
      same_city_other_regions: {
        google_ads: resolution.google_ads.same_city_other_regions,
        google_maps: resolution.google_maps.same_city_other_regions
      },
      same_name_other_countries: {
        google_ads: resolution.google_ads.same_name_other_countries,
        google_maps: resolution.google_maps.same_name_other_countries
      }
    },
    demand: demand.report,
    maps: maps.report,
    organic: organic.report,
    trends: trends.report,
    city_market: {
      ...cityMarket,
      organic_directory_share: organic.report.directory_counts,
      organic_used_in_competition_index: false,
      trends_seasonality: trends.report.seasonality && trends.report.seasonality.level,
      trends_geo_level: trends.report.geo && trends.report.geo.level,
      trends_used_as_search_volume: false
    },
    live_composite: liveComposite,
    score,
    requests: [...resolution.requests, demand.audit, ...(demand.extraAudits || []), maps.audit, organic.audit, trends.audit],
    limitations: STANDING_LIMITATIONS
  };
}
