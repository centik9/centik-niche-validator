import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createExampleTransport } from "../src/example-transport.js";
import { SCREEN_MODEL_ID, loadExtractCatalog, screenCandidates } from "../src/screen.js";
import { exampleDeps, postJson, TEST_AUTH, withServer } from "./helpers.js";
import { validateNiche } from "../src/validator.js";

const sampleList = [
  { geography_type: "city", name: "Austin", state: "Texas" },
  { geography_type: "city", name: "Houston", state: "Texas" },
  { geography_type: "city", name: "Dallas", state: "Texas" },
  { geography_type: "city", name: "Springfield", state: "Illinois" },
  { geography_type: "city", name: "Springfield", state: "Missouri" },
  { geography_type: "county", name: "Travis County", state: "Texas" },
  { geography_type: "county", name: "Harris County", state: "Texas" },
  { geography_type: "county", name: "Hunt County", state: "Texas" },
  { geography_type: "county", name: "Dallas County", state: "Texas" },
  { geography_type: "county", name: "Fulton County", state: "Georgia" },
  { geography_type: "metro", name: "Austin-Round Rock-San Marcos", state: "Texas" },
  { geography_type: "metro", name: "Houston-Pasadena-The Woodlands", state: "Texas" }
];

function byName(report, name, type) {
  return report.candidates.find((item) => item.input.name === name && item.input.geography_type === type);
}

test("sample screen ranks inside geography types and stays off the paid index", async () => {
  let fetches = 0;
  const report = await screenCandidates({
    mode: "sample",
    niche: "foundation repair",
    candidates: sampleList
  }, { fetchImpl: async () => { fetches += 1; throw new Error("network"); } });
  assert.equal(fetches, 0);
  assert.equal(report.model_id, SCREEN_MODEL_ID);
  assert.notEqual(report.model_id, "centik-heuristic-v1");
  assert.equal(report.example_data, true);
  assert.match(report.example_banner, /not a live query/i);
  assert.equal(report.paid_dataforseo_called, false);
  assert.equal(report.score_is_probability, false);
  assert.equal(report.score_is_revenue_prediction, false);
  assert.equal(report.cross_type_rank, null);
  assert.equal(report.profile.id, "foundation_soil");
  const austin = byName(report, "Austin", "city");
  const houston = byName(report, "Houston", "city");
  assert.equal(austin.signals.housing_units.value, 466428);
  assert.equal(austin.signals.housing_units.status, "measured");
  assert.equal(austin.signals.median_household_income.excluded_from_rank, true);
  assert.equal(austin.signals.high_shrink_swell_share.status, "unsupported");
  assert.equal(austin.signals.freeze_thaw_cycles.status, "unavailable");
  assert.equal(austin.deep_check.allowed, true);
  assert.equal(houston.signals.housing_units.value, 1023112);
  assert.ok(houston.screen_index.value > austin.screen_index.value);
  const hunt = byName(report, "Hunt County", "county");
  const fulton = byName(report, "Fulton County", "county");
  assert.ok(hunt.signals.high_shrink_swell_share.value > 0.9);
  assert.ok(fulton.signals.high_shrink_swell_share.value < 0.01);
  assert.equal(hunt.deep_check.allowed, false);
  assert.match(hunt.deep_check.reason, /not converted into a city/);
  assert.ok(hunt.screen_index.weights_used.some((item) => item.id === "high_shrink_swell_share"));
  const metro = byName(report, "Austin-Round Rock-San Marcos", "metro");
  assert.equal(metro.geography.geoid, "12420");
  assert.equal(metro.deep_check.allowed, false);
  assert.equal(metro.signals.drought_pdsi.status, "unsupported");
});

test("neutral profile does not rank soil, and a missing sample name is not zero", async () => {
  const report = await screenCandidates({
    mode: "sample",
    niche: "emergency plumber",
    candidates: [
      { geography_type: "county", name: "Hunt County", state: "TX" },
      { geography_type: "county", name: "Fulton County", state: "Georgia" },
      { geography_type: "city", name: "Not A Real Place Zz", state: "Texas" }
    ]
  });
  assert.equal(report.profile.id, "neutral");
  const hunt = byName(report, "Hunt County", "county");
  assert.equal(hunt.screen_index.weights_used.some((item) => item.id === "high_shrink_swell_share"), false);
  assert.equal(hunt.signals.high_shrink_swell_share.status, "measured");
  const missing = byName(report, "Not A Real Place Zz", "city");
  assert.equal(missing.geography.outcome, "unsupported");
  assert.equal(missing.screen_index.status, "withheld");
  assert.equal(missing.signals.housing_units.value, null);
  assert.notEqual(missing.signals.housing_units.status, "measured_zero");
});

test("free public mode reads the ACS extract and does not call DataForSEO", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes("sdmdataaccess")) {
      return { ok: true, async json() { return { Table: [["TX453", "10", "100"]] }; } };
    }
    if (String(url).includes("ncei.noaa.gov")) {
      return { ok: true, async json() { return { description: { title: "Travis County PDSI" }, data: { "202412": { value: -2.53 } } }; } };
    }
    throw new Error(`unexpected ${url}`);
  };
  const report = await screenCandidates({
    mode: "free",
    niche: "foundation repair",
    candidates: [
      { geography_type: "city", name: "Austin", state: "Texas" },
      { geography_type: "county", name: "Travis", state: "Texas" },
      { geography_type: "metro", name: "Austin", state: "Texas" }
    ]
  }, { fetchImpl });
  assert.equal(report.data_origin, "free_public");
  assert.equal(report.sources.census.live_request, false);
  assert.equal(report.sources.census.status, "bundled_extract");
  assert.equal(byName(report, "Austin", "city").signals.housing_units.value, 466428);
  assert.equal(byName(report, "Travis", "county").signals.housing_units.value, 594638);
  assert.equal(byName(report, "Travis", "county").signals.high_shrink_swell_share.value, 0.1);
  assert.equal(byName(report, "Travis", "county").signals.drought_pdsi.value, -2.53);
  assert.equal(byName(report, "Austin", "metro").geography.outcome, "unsupported");
  assert.equal(calls.some((url) => url.includes("dataforseo")), false);
  assert.equal(calls.some((url) => url.includes("sdmdataaccess")), true);
  assert.equal(calls.filter((url) => url.includes("ncei.noaa.gov")).length, 1);
});

test("an ambiguous Census place is not chosen", async () => {
  const report = await screenCandidates({
    mode: "free",
    niche: "plumber",
    candidates: [{ geography_type: "city", name: "Lake Butler", state: "Florida" }]
  }, { fetchImpl: async () => { throw new Error("should not fetch"); } });
  const place = report.candidates[0];
  assert.equal(place.geography.outcome, "ambiguous");
  assert.ok(place.geography.matches.length >= 2);
  assert.equal(place.screen_index.status, "withheld");
  assert.equal(place.deep_check.allowed, false);
});

test("the bundled extract actually contains the sampled Austin row", () => {
  const extract = loadExtractCatalog();
  assert.equal(extract.places["4805000"].hu, 466428);
  assert.equal(extract.counties["48453"].n, "Travis County");
  assert.ok(Object.keys(extract.counties).length > 3000);
  assert.ok(Object.keys(extract.places).length > 30000);
});

test("a county or metro cannot enter the paid deep check", async () => {
  const calls = [];
  const base = createExampleTransport();
  const deps = exampleDeps({
    async request(args) {
      calls.push(args.path);
      return base.request(args);
    }
  });
  await assert.rejects(() => validateNiche({
    niche: "emergency plumber",
    city: "Travis County",
    state: "Texas",
    country: "United States",
    geography_type: "county",
    confirmed: { google_ads: null, google_maps: null }
  }, deps), (error) => error.code === "unsupported_geography");
  assert.equal(calls.length, 0);
});

test("HTTP sample screen and county rejection stay local", async () => {
  let fetches = 0;
  const app = createApp({
    env: { ...TEST_AUTH, DATAFORSEO_LIVE: "false" },
    fetchImpl: async () => { fetches += 1; throw new Error("network"); }
  });
  await withServer(app, async (port) => {
    const response = await postJson(port, "/api/screen", {
      mode: "sample",
      niche: "foundation repair",
      candidates: sampleList
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.example_data, true);
    assert.equal(body.paid_dataforseo_called, false);
    assert.equal(body.candidates.find((item) => item.input.name === "Austin" && item.input.geography_type === "city").signals.housing_units.value, 466428);
    const blocked = await postJson(port, "/api/validate", {
      mode: "live",
      niche: "emergency plumber",
      city: "Travis County",
      state: "Texas",
      country: "United States",
      geography_type: "metro",
      confirmed: { google_ads: null, google_maps: null }
    });
    assert.equal(blocked.status, 400);
    assert.equal((await blocked.json()).error, "unsupported_geography");
    assert.equal(fetches, 0);
  });
});
