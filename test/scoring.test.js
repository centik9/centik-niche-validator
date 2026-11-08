import assert from "node:assert/strict";
import test from "node:test";
import { STANDING_LIMITATIONS } from "../src/limitations.js";
import { bandFor, buildScore, FORMULA, overallFromParts, sampleOpenness } from "../src/scoring.js";
import { exampleDeps, confirmedFrom } from "./helpers.js";
import { resolveLocation, validateNiche } from "../src/validator.js";

test("demand bands stop at 90 and boundaries are inclusive", () => {
  assert.equal(bandFor(0).index, 0);
  assert.equal(bandFor(1).index, 15);
  assert.equal(bandFor(9).index, 15);
  assert.equal(bandFor(10).index, 35);
  assert.equal(bandFor(49).index, 35);
  assert.equal(bandFor(50).index, 55);
  assert.equal(bandFor(199).index, 55);
  assert.equal(bandFor(200).index, 75);
  assert.equal(bandFor(999).index, 75);
  assert.equal(bandFor(1000).index, 90);
  assert.equal(bandFor(1000000).index, 90);
});

test("rounds the combined index with integer tenths", () => {
  assert.equal(sampleOpenness(12, 20), 40);
  assert.deepEqual(overallFromParts(75, 40), { tenths: 628, value: 62.8, display: "62.8" });
  assert.equal(overallFromParts(0, 40).display, "14.0");
  assert.equal(overallFromParts(0, 0).display, "0.0");
  assert.equal(FORMULA.overall.includes("unique organic listings is greater than zero"), true);
});

test("standing limitations keep the required cautions", () => {
  const text = STANDING_LIMITATIONS.join(" ");
  for (const phrase of ["not treated as zero", "not revenue", "not local business", "not a verified census", "Buyers are not verified", "not a grade", "Example mode"]) {
    assert.equal(text.includes(phrase), true, phrase);
  }
});

async function validateExample(niche, city = "Austin", state = "Texas", country = "United States") {
  const deps = exampleDeps();
  const resolution = await resolveLocation({ city, state, country }, deps);
  return validateNiche({ niche, city, state, country, confirmed: confirmedFrom(resolution) }, deps);
}

test("default example report calculates 62.8 and labels itself as fixture data", async () => {
  const report = await validateExample("emergency plumber");
  assert.equal(report.example_data, true);
  assert.match(report.example_banner, /Example data/);
  assert.equal(report.market_measurement.live_provider_response, false);
  assert.equal(report.market_measurement.exhaustive_market, false);
  assert.equal(report.market_measurement.buyers_verified, false);
  assert.equal(report.market_measurement.economic_value_estimated, false);
  assert.equal(report.score.overall_status, "calculated");
  assert.equal(report.score.overall_display, "62.8");
  assert.equal(report.score.score_is_recommendation, false);
  assert.equal(report.score.weights.demand_index, "0.65");
  assert.equal(report.score.confidence.display, "0.65");
  assert.equal(report.demand.search_volume.value, 320);
  assert.equal(report.demand.search_volume.unit, "approximate average monthly searches");
  assert.equal(report.demand.search_volume.period.observed_start, "2024-01");
  assert.equal(report.demand.search_volume.period.observed_end, "2024-12");
  assert.equal(report.demand.cpc.excluded_from_score, true);
  assert.equal(report.demand.cpc.unit, "USD per click");
  assert.equal(report.maps.requested_depth, 20);
  assert.equal(report.maps.deduplication.unique_organic_listings.value, 12);
  assert.equal(report.maps.se_results_count.status, "inconsistent");
  assert.equal(report.maps.se_results_count.used_in_score, false);
  assert.equal(report.maps.address_flags.listings_with_different_address_city, 1);
  assert.equal(report.requests.filter((item) => item.endpoint.startsWith("POST")).every((item) => item.sent_to_dataforseo === false), true);
  assert.notEqual(report.location.google_ads.location_code, report.location.google_maps.location_code);
});

test("missing demand does not become a zero score", async () => {
  const report = await validateExample("missing volume");
  assert.equal(report.demand.search_volume.status, "missing");
  assert.equal(report.demand.search_volume.value, null);
  assert.equal(report.score.overall, null);
  assert.equal(report.score.overall_display, null);
  assert.equal(report.score.overall_status, "withheld");
  assert.match(report.score.withheld_reason, /not scored as zero/);
  assert.equal(report.score.confidence, null);
  assert.equal(report.maps.deduplication.unique_organic_listings.status, "measured");
});

test("measured zero demand is scored and measured zero CPC stays zero", async () => {
  const report = await validateExample("zero volume");
  assert.equal(report.demand.search_volume.status, "measured_zero");
  assert.equal(report.demand.search_volume.value, 0);
  assert.equal(report.demand.cpc.status, "measured_zero");
  assert.equal(report.score.overall_status, "calculated");
  assert.equal(report.score.overall_display, "14.0");
  assert.equal(report.score.inputs.demand_index, 0);
});

test("an empty Maps sample does not raise the index", async () => {
  const report = await validateExample("maps empty");
  assert.equal(report.maps.deduplication.unique_organic_listings.status, "measured_zero");
  assert.equal(report.maps.deduplication.unique_organic_listings.value, 0);
  assert.equal(report.maps.se_results_count.status, "measured_zero");
  assert.equal(report.score.inputs.sample_openness, 100);
  assert.equal(report.score.overall, null);
  assert.match(report.score.withheld_reason, /not an opportunity grade/);
});

test("a calculated zero is distinct from a withheld index", async () => {
  const report = await validateExample("zero volume saturated");
  assert.equal(report.score.overall_status, "calculated");
  assert.equal(report.score.overall_display, "0.0");
  assert.equal(report.score.overall_tenths, 0);
  assert.equal(report.score.confidence.display, "0.55");
  assert.equal(report.maps.se_results_count.value, 1000);
  assert.equal(report.score.inputs.unique_organic_listings, 20);
});

test("dedupes Maps rows and excludes paid and directory items", async () => {
  const report = await validateExample("maps duplicates");
  assert.equal(report.maps.deduplication.unique_organic_listings.value, 3);
  assert.equal(report.maps.deduplication.duplicates_removed, 2);
  assert.equal(report.maps.deduplication.paid_items, 2);
  assert.equal(report.maps.deduplication.directory_items_excluded, 1);
  assert.equal(report.maps.deduplication.paid_overlap_with_organic, 1);
  assert.equal(report.score.overall_display, "78.5");
  assert.equal(report.maps.claimed.note.includes("Buyers are not verified."), true);
});

test("failed and missing optional fields do not invent measurements", async () => {
  const missingCpc = await validateExample("missing cpc");
  assert.equal(missingCpc.demand.cpc.status, "missing");
  assert.equal(missingCpc.score.overall_display, "62.8");
  const mapsFailed = await validateExample("maps failed");
  assert.equal(mapsFailed.maps.status, "failed");
  assert.equal(mapsFailed.score.overall, null);
  const demandFailed = await validateExample("demand failed");
  assert.equal(demandFailed.demand.status, "failed");
  assert.notEqual(demandFailed.demand.status, "measured_zero");
  assert.equal(demandFailed.score.overall, null);
  const timeout = await validateExample("maps timeout");
  assert.equal(timeout.maps.error.code, "timeout");
  assert.equal(timeout.maps.sent_to_dataforseo, false);
  const spell = await validateExample("spellcheck test");
  assert.equal(spell.demand.spell.status, "corrected");
  assert.equal(spell.demand.spell.value, "emergency plumber");
  assert.equal(spell.score.confidence.display, "0.60");
  const uneven = await validateExample("uneven months");
  assert.equal(uneven.demand.monthly_crosscheck.differs_from_search_volume, true);
  assert.equal(uneven.demand.search_volume.value, 80);
  assert.equal(uneven.score.inputs.demand_index, 55);
  assert.equal(uneven.score.overall_display, "49.8");
});

test("a near-match fixture phrase is not special-cased", async () => {
  const report = await validateExample("missing volume extra");
  assert.equal(report.demand.search_volume.status, "measured");
  assert.equal(report.score.overall_display, "62.8");
});

test("buildScore withholds non-integer volume", () => {
  const score = buildScore({
    demand: {
      search_volume: { status: "unusable", value: null },
      spell: { status: "none" },
      monthly_searches: { numeric_month_count: 0 },
      location: null
    },
    maps: {
      requested_depth: 20,
      deduplication: { unique_organic_listings: { status: "measured", value: 4 } },
      se_results_count: { status: "missing" },
      address_flags: { listings_with_different_address_city: 0 },
      location: null
    },
    origin: "live"
  });
  assert.equal(score.overall, null);
  assert.equal(score.flags.includes("example_data"), false);
});
