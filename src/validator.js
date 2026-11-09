import {
  EXAMPLE_BANNER,
  LANGUAGE_CODE,
  LIVE_BANNER,
  MAPS_DEPTH,
  MAPS_DEVICE,
  MAPS_OS,
  MAPS_PATH,
  SEARCH_VOLUME_PATH,
  adsLocationsPath,
  mapsLocationsPath
} from "./config.js";
import { demandFromError, demandNotSent, parseDemandPayload } from "./demand.js";
import { HttpError } from "./errors.js";
import { parseResolveInput, parseValidateInput } from "./input.js";
import { STANDING_LIMITATIONS } from "./limitations.js";
import { combineLocationOutcomes, matchCity } from "./locations.js";
import { mapsFromError, mapsNotSent, parseMapsPayload } from "./maps.js";
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
    return { report: demandNotSent({ status, keyword: prepared.niche, message, code: status }), audit };
  }
  const task = {
    keywords: [prepared.niche],
    location_code: match.location_code,
    language_code: LANGUAGE_CODE,
    search_partners: false
  };
  try {
    const payload = await deps.transport.request({ method: "POST", path: SEARCH_VOLUME_PATH, body: [task] });
    const report = parseDemandPayload(payload, {
      keyword: prepared.niche,
      location: match,
      sentToDataForSeo: deps.origin === "live",
      redact: deps.redact
    });
    audit.invoked = true;
    audit.sent_to_dataforseo = deps.origin === "live";
    return { report, audit };
  } catch (error) {
    const report = demandFromError(error, {
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

export async function resolveLocation(input, deps) {
  const prepared = input && input.cityNorm ? input : parseResolveInput(input);
  return resolvePrepared(prepared, deps);
}

export async function validateNiche(input, deps) {
  const prepared = input && input.cityNorm && input.confirmed ? input : parseValidateInput(input);
  const resolution = await resolvePrepared(prepared, deps);
  assertConfirmation(resolution, prepared.confirmed);
  const [demand, maps] = await Promise.all([
    loadDemand(prepared, resolution, deps),
    loadMaps(prepared, resolution, deps)
  ]);
  const score = buildScore({ demand: demand.report, maps: maps.report, origin: deps.origin });
  const cityMarket = cityMarketFromReports(demand.report, maps.report, deps.origin);
  const marginIndex = Number.isInteger(prepared.margin_index) ? prepared.margin_index : null;
  const liveComposite = deps.origin === "live" && marginIndex !== null && cityMarket.demand_index !== null && cityMarket.competition_index !== null
    ? scoreFromIndexes({
      demandIndex: cityMarket.demand_index,
      competitionIndex: cityMarket.competition_index,
      marginIndex,
      estimated: prepared.margin_estimated === true
    })
    : null;
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
    city_market: cityMarket,
    live_composite: liveComposite,
    score,
    requests: [...resolution.requests, demand.audit, maps.audit],
    limitations: STANDING_LIMITATIONS
  };
}
