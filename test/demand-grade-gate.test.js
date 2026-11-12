import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { MAPS_DEPTH } from "../src/config.js";
import { scoreFromIndexes } from "../src/composite-score.js";
import { parseDemandPayload } from "../src/demand.js";
import { createExampleTransport } from "../src/example-transport.js";
import { liveCompetitionIndex } from "../src/live-market.js";
import { labelDemand } from "../src/measurement.js";
import { CLEAR_FAIL_TENTHS } from "../src/scoring.js";
import { buildScore } from "../src/scoring.js";
import { exampleDeps, confirmedFrom } from "./helpers.js";
import { resolveLocation, validateNiche } from "../src/validator.js";

function mapsOf(unique) {
  return {
    requested_depth: 100,
    deduplication: {
      unique_organic_listings: {
        status: unique === 0 ? "measured_zero" : "measured",
        value: unique
      }
    },
    se_results_count: { status: "missing" },
    address_flags: { listings_with_different_address_city: 0 },
    location: { location_type: "City" }
  };
}

function envelope(result) {
  return {
    status_code: 20000,
    status_message: "Ok.",
    tasks: [{ status_code: 20000, status_message: "Ok.", cost: 0, result }]
  };
}

function gradeOf(demand) {
  return buildScore({ demand, maps: mapsOf(12), origin: "live" });
}

test("a measured zero cannot clear the fail line, and missing data is not that zero", () => {
  assert.equal(labelDemand({ status: "missing", value: null }), "Insufficient data");
  assert.equal(labelDemand({ status: "failed", value: null }), "Failed");
  assert.equal(labelDemand({ status: "measured_zero", value: 0 }), "0 (measured)");
  assert.equal(labelDemand(null), "Insufficient data");
  assert.notEqual(labelDemand({ status: "missing", value: null }), labelDemand({ status: "measured_zero", value: 0 }));

  const favorable = scoreFromIndexes({ demandIndex: 0, competitionIndex: 100, marginIndex: 100 });
  assert.equal(favorable.grade_cap.uncapped_display, "60.0");
  assert.equal(favorable.composite_display, "14.9");
  assert.equal(favorable.composite_tenths, CLEAR_FAIL_TENTHS);
  assert.equal(favorable.band, "red");
  assert.equal(favorable.grade_state, "capped_fail");
  assert.equal(favorable.clears_green, false);
  assert.equal(favorable.clears_green_label, "no");
  assert.ok(Number(favorable.composite_display) < 15);

  const alreadyFail = scoreFromIndexes({ demandIndex: 0, competitionIndex: 0, marginIndex: 0 });
  assert.equal(alreadyFail.grade_cap.applied, false);
  assert.equal(alreadyFail.composite_display, "0.0");
  assert.equal(alreadyFail.band, "red");
  assert.equal(alreadyFail.clears_green, false);

  const realDemand = scoreFromIndexes({ demandIndex: 75, competitionIndex: 40, marginIndex: 50 });
  assert.equal(realDemand.grade_cap.applied, false);
  assert.equal(realDemand.grade_state, "calculated");
  assert.ok(Number(realDemand.composite_display) > 15);
});

test("the competition formula and Maps depth stay in place under the grade cap", () => {
  assert.equal(MAPS_DEPTH, 100);
  assert.equal(liveCompetitionIndex({ listings: 40, withoutWebsite: 10, averageReviews: 20 }), 54);
  assert.equal(liveCompetitionIndex({ listings: 90, withoutWebsite: 9, averageReviews: 50 }), 18);
});

test("empty keywords, a null payload, a failed task, and a zero partial do not grade as demand", () => {
  const context = {
    keyword: "plumber",
    keywords: ["plumber", "emergency plumber"],
    location: { location_code: 1, location_name: "Austin,Texas,United States", location_type: "City" },
    sentToDataForSeo: false,
    redact: (value) => String(value ?? "")
  };
  const empty = parseDemandPayload(envelope([]), context);
  assert.equal(empty.status, "missing");
  assert.equal(empty.search_volume.value, null);
  assert.equal(empty.keyword_rows.length, 2);
  assert.equal(empty.keyword_rows.every((row) => row.search_volume.status === "missing"), true);
  const emptyScore = gradeOf(empty);
  assert.equal(emptyScore.grade_state, "insufficient_data");
  assert.equal(emptyScore.overall, null);
  assert.equal(emptyScore.overall_display, null);

  const missingBody = parseDemandPayload(null, context);
  assert.equal(missingBody.status, "failed");
  assert.notEqual(missingBody.search_volume.status, "measured_zero");
  assert.equal(gradeOf(missingBody).grade_state, "insufficient_data");

  const failedTask = parseDemandPayload({
    status_code: 20000,
    tasks: [{ status_code: 50000, status_message: "Example failure.", cost: 0, result: null }]
  }, context);
  assert.equal(failedTask.status, "failed");
  assert.equal(gradeOf(failedTask).overall, null);
  assert.equal(gradeOf(failedTask).grade_state, "insufficient_data");

  const partialZero = parseDemandPayload(envelope([
    { keyword: "plumber", search_volume: 0, cpc: null, monthly_searches: null },
    { keyword: "emergency plumber", search_volume: null, cpc: null, monthly_searches: null }
  ]), context);
  assert.equal(partialZero.clustered_coverage_volume.status, "partial");
  assert.equal(partialZero.clustered_coverage_volume.value, 0);
  assert.equal(partialZero.keyword_rows[0].search_volume.status, "measured_zero");
  assert.equal(partialZero.keyword_rows[1].search_volume.status, "missing");
  assert.equal(labelDemand(partialZero.keyword_rows[0].search_volume), "0 (measured)");
  assert.equal(labelDemand(partialZero.keyword_rows[1].search_volume), "Insufficient data");
  assert.equal(labelDemand(partialZero.cpc), "Insufficient data");
  const partialScore = gradeOf(partialZero);
  assert.equal(partialScore.overall, null);
  assert.equal(partialScore.grade_state, "insufficient_data");
  assert.notEqual(partialScore.grade_state, "capped_fail");
});

test("a partial response with real volume still scores, and a null CPC does not become zero", () => {
  const context = {
    keyword: "plumber",
    keywords: ["plumber", "emergency plumber"],
    location: { location_code: 1, location_name: "Austin,Texas,United States", location_type: "City" },
    sentToDataForSeo: false,
    redact: (value) => String(value ?? "")
  };
  const partial = parseDemandPayload(envelope([
    { keyword: "plumber", search_volume: 120, cpc: null, competition: "LOW", monthly_searches: [{ year: 2024, month: 1, search_volume: 120 }] }
  ]), context);
  assert.equal(partial.search_volume.status, "measured");
  assert.equal(partial.search_volume.value, 120);
  assert.equal(partial.cpc.status, "missing");
  assert.equal(partial.cpc.value, null);
  assert.equal(partial.clustered_coverage_volume.status, "partial");
  assert.equal(partial.clustered_coverage_volume.value, 120);
  const score = gradeOf(partial);
  assert.equal(score.grade_state, "calculated");
  assert.equal(score.grade_cap.applied, false);
  assert.equal(score.inputs.demand_index, 55);
  assert.ok(score.overall >= 15);
});

async function liveCheck(niche, marginIndex, transport = createExampleTransport()) {
  const deps = { ...exampleDeps(transport), origin: "live" };
  const resolution = await resolveLocation({ city: "Austin", state: "Texas", country: "United States" }, deps);
  return validateNiche({
    niche,
    city: "Austin",
    state: "Texas",
    country: "United States",
    margin_index: marginIndex,
    confirmed: confirmedFrom(resolution)
  }, deps);
}

test("a live check with zero volume caps the composite and keeps Maps depth 100", async () => {
  const report = await liveCheck("zero volume", 100);
  assert.equal(report.maps.requested_depth, 100);
  assert.equal(report.demand.search_volume.status, "measured_zero");
  assert.equal(report.demand.cpc.status, "measured_zero");
  assert.equal(report.city_market.demand_index, 0);
  assert.match(report.city_market.formula, /0\.5 × listing room \+ 0\.3 × share with no website \+ 0\.2 × \(100 − review pressure\)/);
  assert.equal(report.score.grade_state, "capped_fail");
  assert.equal(report.score.overall_display, "14.9");
  assert.equal(report.live_composite.status, "calculated");
  assert.equal(report.live_composite.grade_cap.applied, true);
  assert.equal(report.live_composite.composite_display, "14.9");
  assert.equal(report.live_composite.band, "red");
  assert.equal(report.live_composite.clears_green, false);
  assert.ok(Number(report.live_composite.grade_cap.uncapped_display) >= 15);
  assert.equal(report.live_composite.competition.index, report.city_market.competition_index);

  const noMargin = await liveCheck("zero volume", null);
  assert.equal(noMargin.live_composite.clears_green, false);
  assert.equal(noMargin.live_composite.band, "red");
  assert.ok(Number(noMargin.live_composite.composite_display) < 15);
  assert.notEqual(noMargin.live_composite.status, "insufficient_data");
});

test("a live check with missing volume, an empty keyword list, or a null CPC does not pass", async () => {
  const missing = await liveCheck("missing volume", 100);
  assert.equal(missing.demand.search_volume.status, "missing");
  assert.equal(missing.demand.search_volume.value, null);
  assert.notEqual(missing.demand.search_volume.status, "measured_zero");
  assert.equal(missing.score.grade_state, "insufficient_data");
  assert.equal(missing.score.overall, null);
  assert.equal(missing.live_composite.status, "insufficient_data");
  assert.equal(missing.live_composite.composite_display, null);
  assert.equal(missing.live_composite.band, "missing");
  assert.equal(missing.live_composite.clears_green, null);
  assert.equal(missing.maps.requested_depth, 100);

  const failed = await liveCheck("demand failed", 100);
  assert.equal(failed.demand.status, "failed");
  assert.equal(failed.score.grade_state, "insufficient_data");
  assert.equal(failed.live_composite.status, "insufficient_data");

  const base = createExampleTransport();
  const scripted = {
    async request(args) {
      if (args.method === "POST" && String(args.path).endsWith("/search_volume/live")) {
        const keywords = args.body[0].keywords;
        return envelope(keywords.map((keyword, index) => ({
          keyword,
          search_volume: index === 0 ? 80 : null,
          cpc: null,
          monthly_searches: index === 0 ? [{ year: 2024, month: 1, search_volume: 80 }] : null
        })));
      }
      return base.request(args);
    }
  };
  const partial = await liveCheck("plumber", 80, scripted);
  assert.equal(partial.demand.cpc.status, "missing");
  assert.equal(partial.demand.cpc.value, null);
  assert.equal(partial.demand.clustered_coverage_volume.status, "partial");
  assert.ok(partial.demand.clustered_coverage_volume.value > 0);
  assert.equal(partial.score.grade_cap.applied, false);
  assert.equal(partial.score.grade_state, "calculated");
  assert.equal(partial.live_composite.grade_cap.applied, false);
  assert.notEqual(partial.live_composite.status, "insufficient_data");

  const emptyTransport = {
    async request(args) {
      if (args.method === "POST" && String(args.path).endsWith("/search_volume/live")) return envelope([]);
      return base.request(args);
    }
  };
  const empty = await liveCheck("plumber", 100, emptyTransport);
  assert.equal(empty.demand.status, "missing");
  assert.equal(empty.demand.keyword_rows.length > 0, true);
  assert.equal(empty.demand.keyword_rows.every((row) => row.search_volume.status === "missing"), true);
  assert.equal(empty.score.grade_state, "insufficient_data");
  assert.equal(empty.live_composite.status, "insufficient_data");
  assert.equal(empty.maps.requested_depth, 100);
});

test("the results screen labels missing demand instead of a scored zero", () => {
  const dashboard = fs.readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(dashboard, /Insufficient data/);
  assert.match(dashboard, /0 \(measured\)/);
  assert.match(dashboard, /Source returned nothing/);
  assert.match(dashboard, /Measured zero, not missing/);
  assert.match(app, /Insufficient data/);
  assert.match(app, /0 \(measured\)/);
  assert.match(app, /Withheld/);
});
