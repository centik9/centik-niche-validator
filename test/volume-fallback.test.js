import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { BING_SEARCH_VOLUME_PATH, SEARCH_VOLUME_PATH } from "../src/config.js";
import { createExampleTransport } from "../src/example-transport.js";
import { createLocationDirectory } from "../src/locations.js";
import {
  ADS_COST_USD,
  BING_VOLUME_COST_USD,
  QUERY_COST_USD,
  WORST_CASE_QUERY_COST_USD,
  createSpendGate,
  quotedPaidCalls
} from "../src/spend.js";
import { resolveMetroMembership } from "../src/metro-membership.js";
import { selectVolumeLocations } from "../src/trends-location.js";
import {
  BING_BROADER_ESTIMATE_LABEL,
  BING_CITY_ESTIMATE_LABEL,
  BING_CORROBORATION_NOTE,
  CITY_CORE_VOLUME_THRESHOLD,
  FALLBACK_ESTIMATE_LABEL,
  buildVolumeEstimate,
  housingShareFor,
  scaleVolume
} from "../src/volume-fallback.js";
import { validateNiche, resolveLocation } from "../src/validator.js";
import { confirmedFrom, exampleDeps, postJson, TEST_AUTH, withServer } from "./helpers.js";

const NOW = Date.parse("2026-11-16T12:00:00.000Z");

function shift(rows, amount) {
  const map = new Map(rows.map((row) => [row.location_code, row.location_code + amount]));
  return rows.map((row) => ({
    ...row,
    location_code: map.get(row.location_code),
    location_code_parent: row.location_code_parent == null ? null : map.get(row.location_code_parent)
  }));
}

function adsRows({ dma = true } = {}) {
  const rows = [
    { location_code: 2840, location_name: "United States", location_code_parent: null, country_iso_code: "US", location_type: "Country" },
    { location_code: 21176, location_name: "Texas,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "State" },
    { location_code: 101, location_name: "Austin,Texas,United States", location_code_parent: 21176, country_iso_code: "US", location_type: "City" }
  ];
  if (dma) {
    rows.push({ location_code: 202, location_name: "Austin,Texas,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "DMA Region" });
  }
  return rows;
}

function directoryFor(ads, bing) {
  return {
    async list(product) {
      if (product === "google_ads") return { rows: ads, cache: "miss" };
      if (product === "google_maps") return { rows: shift(ads, 100000), cache: "miss" };
      if (product === "google_trends") return { rows: shift(ads, 200000), cache: "miss" };
      if (product === "bing") return { rows: bing, cache: "miss" };
      return { rows: [], cache: "miss" };
    }
  };
}

function volumeEnvelope(keywords, volume) {
  return {
    status_code: 20000,
    status_message: "Ok.",
    tasks: [{
      status_code: 20000,
      status_message: "Ok.",
      cost: 0.09,
      result: keywords.map((keyword, index) => ({
        keyword,
        search_volume: volume === null ? null : (index === 0 ? volume : null),
        cpc: null,
        competition: null,
        monthly_searches: null
      }))
    }]
  };
}

function scriptedTransport(googleVolumes, bingVolumes) {
  const base = createExampleTransport();
  const posts = [];
  return {
    posts,
    async request(args) {
      if (args.method === "POST" && (args.path === SEARCH_VOLUME_PATH || args.path === BING_SEARCH_VOLUME_PATH)) {
        posts.push({ path: args.path, location_code: args.body[0].location_code });
        const keywords = args.body[0].keywords;
        const table = args.path === BING_SEARCH_VOLUME_PATH ? bingVolumes : googleVolumes;
        const volume = Object.prototype.hasOwnProperty.call(table, args.body[0].location_code)
          ? table[args.body[0].location_code]
          : null;
        return volumeEnvelope(keywords, volume);
      }
      return base.request(args);
    }
  };
}

async function runCheck({ googleVolumes, bingVolumes, bingRows, dma = true, margin = 40 }) {
  const ads = adsRows({ dma });
  const transport = scriptedTransport(googleVolumes, bingVolumes);
  const deps = {
    ...exampleDeps(transport),
    directory: directoryFor(ads, bingRows),
    origin: "live",
    housingShare: () => ({
      status: "measured",
      basis: "occupied_housing_units",
      geography: "test",
      city_occupied: 1000,
      broader_occupied: 10000
    })
  };
  const resolution = await resolveLocation({ city: "Austin", state: "Texas", country: "United States" }, deps);
  const report = await validateNiche({
    niche: "septic installation",
    city: "Austin",
    state: "Texas",
    country: "United States",
    margin_index: margin,
    confirmed: confirmedFrom(resolution)
  }, deps);
  return { report, posts: transport.posts, cityCode: 101, dmaCode: 202, stateCode: 21176 };
}

test("occupied-housing share scales a broader volume and does not invent population", () => {
  assert.equal(scaleVolume(1200, 1000, 10000), 120);
  assert.equal(scaleVolume(1, 1, 2), 1);
  assert.equal(scaleVolume(0, 1000, 10000), null);
  assert.equal(CITY_CORE_VOLUME_THRESHOLD, 10);
  const bella = housingShareFor({ city: "Bella Vista", state: "Arkansas", level: "state" });
  assert.equal(bella.city_occupied, 12894);
  assert.equal(bella.broader_occupied, 1189160);
  assert.equal(bella.basis, "occupied_housing_units");
  const austin = housingShareFor({ city: "Austin", state: "Texas", level: "metro" });
  assert.equal(austin.city_occupied, 440294);
  assert.equal(austin.broader_occupied, 948649);
  assert.equal(austin.geography, "census_metro");
  assert.equal(austin.membership, "census_cbsa");
  assert.equal(austin.cbsa, "12420");
  const leland = housingShareFor({ city: "Leland", state: "North Carolina", level: "metro" });
  assert.equal(leland.city_occupied, 11258);
  assert.equal(leland.broader_occupied, 190964);
  assert.equal(leland.census_name, "Wilmington, NC Metro Area");
  assert.equal(leland.cbsa, "48900");
  assert.equal(leland.membership, "census_cbsa");
  assert.equal(scaleVolume(100000, leland.city_occupied, leland.broader_occupied), 5895);
});

test("all-null city volume falls back to a DMA hit and does not call the state", async () => {
  const { report, posts, dmaCode, stateCode } = await runCheck({
    googleVolumes: { 101: null, 202: 1200, 21176: 9000 },
    bingVolumes: {},
    bingRows: []
  });
  assert.equal(report.demand.search_volume.status, "missing");
  assert.equal(report.demand.search_volume.value, null);
  assert.equal(report.demand.volume_fallback.estimate.status, "estimated");
  assert.equal(report.demand.volume_fallback.estimate.value, 120);
  assert.equal(report.demand.volume_fallback.estimate.measured_city_data, false);
  assert.equal(report.demand.volume_fallback.estimate.label, FALLBACK_ESTIMATE_LABEL);
  assert.equal(report.demand.volume_fallback.estimate.value_source, "google_ads_metro");
  assert.equal(report.demand.volume_fallback.estimate.bing_note, null);
  assert.equal(report.demand.volume_fallback.metro_membership.dma_basis, "namesake_and_census_cbsa");
  assert.equal(report.demand.volume_fallback.metro_membership.cbsa, "12420");
  const dmaRaw = report.demand.volume_fallback.estimate.raw_broader_volumes.find((row) => row.level === "metro");
  assert.equal(dmaRaw.clustered_volume, 1200);
  assert.equal(dmaRaw.scaled_city_volume, 120);
  assert.equal(report.score.grade_state, "estimated");
  assert.equal(report.score.inputs.demand_index, 55);
  assert.equal(report.score.inputs.estimated_city_volume, 120);
  assert.equal(report.score.inputs.search_volume, null);
  assert.equal(report.live_composite.grade_state, "estimated");
  assert.equal(report.live_composite.demand_estimated, true);
  assert.equal(report.live_composite.demand.label, FALLBACK_ESTIMATE_LABEL);
  assert.equal(report.city_market.demand_label, FALLBACK_ESTIMATE_LABEL);
  assert.equal(posts.some((call) => call.location_code === dmaCode), true);
  assert.equal(posts.some((call) => call.location_code === stateCode), false);
  assert.equal(posts.some((call) => call.path === BING_SEARCH_VOLUME_PATH), false);
});

test("a null DMA falls through to the state volume", async () => {
  const { report, posts, dmaCode, stateCode } = await runCheck({
    googleVolumes: { 101: null, 202: null, 21176: 5000 },
    bingVolumes: {},
    bingRows: []
  });
  assert.equal(report.demand.search_volume.value, null);
  assert.equal(report.demand.volume_fallback.estimate.value, 500);
  assert.equal(report.demand.volume_fallback.estimate.value_source, "google_ads_state");
  assert.equal(report.demand.volume_fallback.estimate.label, FALLBACK_ESTIMATE_LABEL);
  assert.equal(report.demand.volume_fallback.estimate.measured_city_data, false);
  const stateRaw = report.demand.volume_fallback.estimate.raw_broader_volumes.find((row) => row.level === "state");
  assert.equal(stateRaw.clustered_volume, 5000);
  assert.equal(stateRaw.scaled_city_volume, 500);
  assert.equal(report.score.grade_state, "estimated");
  assert.equal(report.score.inputs.demand_index, 75);
  assert.equal(posts.some((call) => call.location_code === dmaCode), true);
  assert.equal(posts.some((call) => call.location_code === stateCode), true);
});

test("Bing does not lower a positive Google Ads estimate", async () => {
  const bingRows = [
    { location_code: 2840, location_name: "United States", location_code_parent: null, country_iso_code: "US", location_type: "Country" },
    { location_code: 400, location_name: "Texas,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "State" }
  ];
  const { report, posts } = await runCheck({
    googleVolumes: { 101: null, 202: null, 21176: 2000 },
    bingVolumes: { 400: 500 },
    bingRows
  });
  assert.equal(report.demand.volume_fallback.estimate.value, 200);
  assert.equal(report.demand.volume_fallback.estimate.value_source, "google_ads_state");
  assert.equal(report.demand.volume_fallback.estimate.bing_used_for_value, false);
  assert.equal(report.demand.volume_fallback.estimate.bing_note, BING_CORROBORATION_NOTE);
  assert.equal(report.demand.volume_fallback.estimate.label, FALLBACK_ESTIMATE_LABEL);
  assert.equal(report.demand.volume_fallback.estimate.measured_city_data, false);
  assert.match(report.demand.volume_fallback.estimate.note, /Bing also shows demand/);
  const raw = report.demand.volume_fallback.estimate.raw_broader_volumes;
  assert.equal(raw.find((row) => row.source === "google_ads" && row.level === "state").clustered_volume, 2000);
  assert.equal(raw.find((row) => row.source === "google_ads" && row.level === "state").scaled_city_volume, 200);
  assert.equal(raw.find((row) => row.source === "bing").clustered_volume, 500);
  assert.equal(raw.find((row) => row.source === "bing").scaled_city_volume, 50);
  assert.equal(report.score.inputs.estimated_city_volume, 200);
  assert.equal(report.score.grade_state, "estimated");
  assert.notEqual(report.demand.search_volume.status, "measured");
  assert.equal(posts.some((call) => call.path === BING_SEARCH_VOLUME_PATH && call.location_code === 400), true);
});

test("Bing sets the estimate only when Google Ads has no positive scaled estimate", async () => {
  const bingRows = [
    { location_code: 2840, location_name: "United States", location_code_parent: null, country_iso_code: "US", location_type: "Country" },
    { location_code: 400, location_name: "Texas,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "State" }
  ];
  const { report } = await runCheck({
    googleVolumes: { 101: null, 202: null, 21176: null },
    bingVolumes: { 400: 500 },
    bingRows
  });
  assert.equal(report.demand.search_volume.value, null);
  assert.equal(report.demand.volume_fallback.estimate.value, 50);
  assert.equal(report.demand.volume_fallback.estimate.value_source, "bing_backup");
  assert.equal(report.demand.volume_fallback.estimate.bing_used_for_value, true);
  assert.equal(report.demand.volume_fallback.estimate.bing_note, null);
  assert.equal(report.demand.volume_fallback.estimate.label, BING_BROADER_ESTIMATE_LABEL);
  assert.equal(report.demand.volume_fallback.estimate.measured_city_data, false);
  assert.equal(report.score.grade_state, "estimated");
  assert.equal(report.score.inputs.estimated_city_volume, 50);

  const cityOnly = buildVolumeEstimate([
    { source: "google_ads", level: "metro", broader_than_city: true, queried: true, clustered_volume: null, clustered_status: "missing" },
    { source: "google_ads", level: "state", broader_than_city: true, queried: true, clustered_volume: null, clustered_status: "missing" },
    { source: "bing", level: "city", broader_than_city: false, queried: true, clustered_volume: 40, clustered_status: "measured", numeric_month_count: 12 }
  ], () => null);
  assert.equal(cityOnly.estimate.value, 40);
  assert.equal(cityOnly.estimate.value_source, "bing_backup");
  assert.equal(cityOnly.estimate.label, BING_CITY_ESTIMATE_LABEL);
  assert.equal(cityOnly.estimate.measured_city_data, false);
});

test("a positive Google metro estimate stands when the state and Bing estimates are smaller", () => {
  const built = buildVolumeEstimate([
    { source: "google_ads", level: "metro", broader_than_city: true, queried: true, clustered_volume: 5000, clustered_status: "measured", numeric_month_count: 12, location_name: "Austin,Texas,United States" },
    { source: "google_ads", level: "state", broader_than_city: true, queried: true, clustered_volume: 1000, clustered_status: "measured", numeric_month_count: 12, location_name: "Texas,United States" },
    { source: "bing", level: "state", broader_than_city: true, queried: true, clustered_volume: 100, clustered_status: "measured", numeric_month_count: 12, location_name: "Texas,United States" }
  ], () => ({ status: "measured", basis: "occupied_housing_units", city_occupied: 1000, broader_occupied: 10000 }));
  assert.equal(built.estimate.value, 500);
  assert.equal(built.estimate.value_source, "google_ads_metro");
  assert.equal(built.estimate.label, FALLBACK_ESTIMATE_LABEL);
  assert.equal(built.estimate.bing_used_for_value, false);
  assert.equal(built.estimate.bing_note, BING_CORROBORATION_NOTE);
  assert.equal(built.estimate.measured_city_data, false);
  assert.equal(built.estimate.winning_sources.length, 1);
  assert.equal(built.estimate.winning_sources[0].source, "google_ads");
  assert.equal(built.estimate.winning_sources[0].level, "metro");
});

test("Leland uses the Wilmington DMA and Wilmington metro housing, and does not call the state", async () => {
  const stateCode = 21160;
  const dmaCode = 200550;
  const cityCode = 3737680;
  const ads = [
    { location_code: 2840, location_name: "United States", location_code_parent: null, country_iso_code: "US", location_type: "Country" },
    { location_code: stateCode, location_name: "North Carolina,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "State" },
    { location_code: cityCode, location_name: "Leland,North Carolina,United States", location_code_parent: stateCode, country_iso_code: "US", location_type: "City" },
    { location_code: dmaCode, location_name: "Wilmington,North Carolina,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "DMA Region" },
    { location_code: 200517, location_name: "Charlotte,North Carolina,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "DMA Region" }
  ];
  const transport = scriptedTransport({ [cityCode]: null, [dmaCode]: 100000, [stateCode]: 900000, 200517: 900000 }, {});
  const deps = {
    ...exampleDeps(transport),
    directory: directoryFor(ads, []),
    origin: "live"
  };
  const resolution = await resolveLocation({ city: "Leland", state: "North Carolina", country: "United States" }, deps);
  assert.equal(resolution.google_ads.match.location_code, cityCode);
  const report = await validateNiche({
    niche: "septic installation",
    city: "Leland",
    state: "North Carolina",
    country: "United States",
    margin_index: 40,
    confirmed: confirmedFrom(resolution)
  }, deps);
  const share = housingShareFor({ city: "Leland", state: "North Carolina", level: "metro" });
  const expected = scaleVolume(100000, share.city_occupied, share.broader_occupied);
  assert.equal(share.city_occupied, 11258);
  assert.equal(share.broader_occupied, 190964);
  assert.equal(expected, 5895);
  assert.equal(report.demand.search_volume.value, null);
  assert.equal(report.demand.volume_fallback.estimate.status, "estimated");
  assert.equal(report.demand.volume_fallback.estimate.value, expected);
  assert.equal(report.demand.volume_fallback.estimate.value_source, "google_ads_metro");
  assert.equal(report.demand.volume_fallback.estimate.measured_city_data, false);
  assert.equal(report.demand.volume_fallback.estimate.label, FALLBACK_ESTIMATE_LABEL);
  assert.equal(report.demand.volume_fallback.metro_membership.status, "matched");
  assert.equal(report.demand.volume_fallback.metro_membership.cbsa, "48900");
  assert.deepEqual(report.demand.volume_fallback.metro_membership.counties, ["37019"]);
  assert.equal(report.demand.volume_fallback.metro_membership.census_name, "Wilmington, NC Metro Area");
  assert.equal(report.demand.volume_fallback.metro_membership.dma_basis, "census_cbsa");
  assert.equal(report.demand.volume_fallback.metro_membership.dma_skip_reason, null);
  const dmaAttempt = report.demand.volume_fallback.attempts.find((row) => row.source === "google_ads" && row.level === "metro");
  assert.equal(dmaAttempt.queried, true);
  assert.equal(dmaAttempt.location_code, dmaCode);
  assert.equal(dmaAttempt.location_name, "Wilmington,North Carolina,United States");
  assert.equal(dmaAttempt.share.city_occupied, 11258);
  assert.equal(dmaAttempt.share.broader_occupied, 190964);
  assert.equal(dmaAttempt.share.census_name, "Wilmington, NC Metro Area");
  assert.equal(dmaAttempt.scaled_city_volume, expected);
  const stateAttempt = report.demand.volume_fallback.attempts.find((row) => row.source === "google_ads" && row.level === "state");
  assert.equal(stateAttempt.queried, false);
  assert.equal(transport.posts.some((call) => call.location_code === dmaCode && call.path === SEARCH_VOLUME_PATH), true);
  assert.equal(transport.posts.some((call) => call.location_code === stateCode), false);
  assert.equal(transport.posts.some((call) => call.location_code === 200517), false);
  assert.equal(transport.posts.some((call) => call.path === BING_SEARCH_VOLUME_PATH), false);
  assert.equal(report.score.grade_state, "estimated");
  assert.equal(report.score.inputs.search_volume, null);
  assert.equal(report.score.inputs.estimated_city_volume, expected);
});

test("county membership picks the containing DMA and does not guess when it is ambiguous", () => {
  const leland = resolveMetroMembership({ city: "Leland", state: "North Carolina" });
  assert.equal(leland.status, "matched");
  assert.equal(leland.cbsa, "48900");
  assert.deepEqual(leland.counties, ["37019"]);
  assert.equal(leland.primary_city_norm, "wilmington");
  const roundRock = resolveMetroMembership({ city: "Round Rock", state: "Texas" });
  assert.equal(roundRock.status, "matched");
  assert.equal(roundRock.cbsa, "12420");
  assert.equal(roundRock.primary_city_norm, "austin");
  const austin = resolveMetroMembership({ city: "Austin", state: "Texas" });
  assert.equal(austin.status, "matched");
  assert.equal(austin.cbsa, "12420");
  assert.equal(austin.primary_city_norm, "austin");

  const query = { cityNorm: "austin", stateNorm: "texas", countryIso: "us", codeSource: "test" };
  const namesake = selectVolumeLocations(adsRows(), query, {
    status: "missing",
    reason: "The bundled Census place-county file has no county for this place, so no containing metro was assigned.",
    primary_city_norm: null,
    state_names: []
  });
  assert.equal(namesake.dma.location_code, 202);
  assert.equal(namesake.dma_basis, "namesake");

  const ambiguous = selectVolumeLocations(adsRows(), query, {
    status: "ambiguous",
    reason: "The Census counties for this place do not all belong to one CBSA. No DMA was selected.",
    primary_city_norm: "austin",
    state_names: ["texas"]
  });
  assert.equal(ambiguous.dma, null);
  assert.equal(ambiguous.dma_basis, null);
  assert.match(ambiguous.dma_skip_reason, /do not all belong to one CBSA/);

  const outside = selectVolumeLocations(adsRows(), query, {
    status: "not_in_cbsa",
    reason: "Every Census county for this place is outside a CBSA, so no metro DMA was assigned."
  });
  assert.equal(outside.dma, null);
  assert.match(outside.dma_skip_reason, /outside a CBSA/);

  const conflictRows = [
    { location_code: 21160, location_name: "North Carolina,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "State" },
    { location_code: 200550, location_name: "Wilmington,North Carolina,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "DMA Region" },
    { location_code: 200517, location_name: "Charlotte,North Carolina,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "DMA Region" }
  ];
  const conflict = selectVolumeLocations(conflictRows, {
    cityNorm: "wilmington",
    stateNorm: "north carolina",
    countryIso: "us"
  }, {
    status: "matched",
    census_name: "Charlotte-Concord-Gastonia, NC-SC Metro Area",
    cbsa: "16740",
    primary_city: "Charlotte",
    primary_city_norm: "charlotte",
    title_norm: "charlotte concord gastonia",
    state_names: ["north carolina", "south carolina"]
  });
  assert.equal(conflict.dma, null);
  assert.match(conflict.dma_skip_reason, /Neither DMA was used/);
});

test("blank city, DMA, state, and Bing volumes stay withheld", async () => {
  const bingRows = [
    { location_code: 2840, location_name: "United States", location_code_parent: null, country_iso_code: "US", location_type: "Country" },
    { location_code: 400, location_name: "Texas,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "State" }
  ];
  const { report } = await runCheck({
    googleVolumes: { 101: null, 202: null, 21176: null },
    bingVolumes: { 400: null },
    bingRows,
    margin: 100
  });
  assert.equal(report.demand.search_volume.status, "missing");
  assert.equal(report.demand.search_volume.value, null);
  assert.notEqual(report.demand.search_volume.status, "measured_zero");
  assert.equal(report.demand.volume_fallback.estimate.status, "withheld");
  assert.equal(report.demand.volume_fallback.estimate.value, null);
  assert.equal(report.score.grade_state, "insufficient_data");
  assert.equal(report.score.overall, null);
  assert.equal(report.score.overall_display, null);
  assert.equal(report.live_composite.status, "insufficient_data");
  assert.equal(report.live_composite.composite_display, null);
});

test("a city volume above the threshold does not spend on fallback calls", async () => {
  const { report, posts } = await runCheck({
    googleVolumes: { 101: 400, 202: 9000, 21176: 9000 },
    bingVolumes: { 400: 9000 },
    bingRows: [
      { location_code: 400, location_name: "Texas,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "State" }
    ]
  });
  assert.equal(report.demand.volume_fallback, undefined);
  assert.equal(report.score.grade_state, "calculated");
  assert.equal(report.demand.search_volume.value, 400);
  assert.equal(posts.filter((call) => call.path === SEARCH_VOLUME_PATH).length, 1);
  assert.equal(posts.some((call) => call.path === BING_SEARCH_VOLUME_PATH), false);
});

test("the quote includes fallback costs and the cap blocks a worst case over the remaining budget", async () => {
  assert.equal(QUERY_COST_USD, 0.109);
  assert.equal(WORST_CASE_QUERY_COST_USD, 0.381);
  const calls = quotedPaidCalls();
  assert.equal(calls.length, 10);
  assert.equal(calls.filter((call) => call.conditional).length, 4);
  assert.equal(calls.reduce((sum, call) => sum + Math.round(call.estimated_cost_usd * 1000), 0), 381);
  assert.ok(calls.some((call) => /DMA fallback/.test(call.purpose) && call.estimated_cost_usd === ADS_COST_USD));
  assert.ok(calls.some((call) => /state fallback/.test(call.purpose) && call.estimated_cost_usd === ADS_COST_USD));
  assert.ok(calls.some((call) => /Bing Ads/.test(call.purpose) && call.estimated_cost_usd === BING_VOLUME_COST_USD));

  const prepared = {
    niche: "septic installation",
    city: "Austin",
    state: "Texas",
    countryCanonical: "United States",
    confirmed: { google_ads: { location_code: 101 }, google_maps: { location_code: 102 } }
  };
  const open = createSpendGate({
    capUsd: 10,
    tokenSecret: "x".repeat(32),
    baselineUsd: 100,
    now: () => NOW,
    readAccountSpent: async () => 100
  });
  const quoted = await open.quote("team@centik.ai", prepared, { requireAccount: true });
  assert.equal(quoted.estimated_cost_usd, 0.381);
  assert.equal(quoted.worst_case_cost_usd, 0.381);
  assert.equal(quoted.base_estimated_cost_usd, 0.109);
  assert.equal(quoted.calls.length, 10);

  const tight = createSpendGate({
    capUsd: 10,
    tokenSecret: "x".repeat(32),
    baselineUsd: 100,
    now: () => NOW,
    readAccountSpent: async () => 109.8
  });
  const remaining = 0.2;
  assert.ok(remaining > QUERY_COST_USD);
  assert.ok(remaining < WORST_CASE_QUERY_COST_USD);
  await assert.rejects(() => tight.quote("team@centik.ai", prepared, { requireAccount: true }), /spend cap/);

  const app = createApp({
    env: {
      ...TEST_AUTH,
      DATAFORSEO_LIVE: "true",
      DATAFORSEO_LOGIN: "login-user",
      DATAFORSEO_PASSWORD: "test-password-value",
      DATAFORSEO_SPENT_BASELINE_USD: "100",
      SPEND_CAP_USD: "10"
    },
    now: () => NOW,
    fetchImpl: async () => {
      throw new Error("live fetch");
    },
    liveDirectory: createLocationDirectory(createExampleTransport()),
    readAccountSpent: async () => 109.8
  });
  await withServer(app, async (port) => {
    const resolved = await (await postJson(port, "/api/resolve", {
      mode: "live",
      city: "Austin",
      state: "Texas",
      country: "United States"
    })).json();
    const denied = await postJson(port, "/api/quote", {
      mode: "live",
      niche: "septic installation",
      city: "Austin",
      state: "Texas",
      country: "United States",
      confirmed: confirmedFrom(resolved)
    });
    const body = await denied.json();
    assert.equal(denied.status, 403);
    assert.equal(body.error, "spend_cap_exceeded");
  });
});
