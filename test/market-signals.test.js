import assert from "node:assert/strict";
import test from "node:test";
import { ORGANIC_PATH, TRENDS_PATH } from "../src/config.js";
import { clusterCoverage } from "../src/keyword-clusters.js";
import { parseDemandPayload } from "../src/demand.js";
import { directoryCounts, isDirectoryHost, parseOrganicPayload } from "../src/organic.js";
import { paidCalls, QUERY_COST_USD, resultCacheKey, bindSpendRequest, createSpendGate } from "../src/spend.js";
import { classifySeasonality, monthlySeries, parseTrendsPayload } from "../src/trends.js";
import { selectTrendsLocation } from "../src/trends-location.js";
import { buildVolumeKeywords } from "../src/volume-keywords.js";
import { createExampleTransport } from "../src/example-transport.js";
import { resolveLocation, validateNiche } from "../src/validator.js";
import { confirmedFrom, exampleDeps } from "./helpers.js";

test("packed phrases stay in one volume task and inside the keyword guard", () => {
  const phrases = buildVolumeKeywords("emergency plumber", "Austin");
  assert.ok(phrases.length >= 8 && phrases.length <= 20);
  assert.equal(phrases[0], "emergency plumber");
  for (const phrase of ["emergency plumber Austin", "Austin emergency plumber", "emergency plumber in Austin", "emergency plumber near Austin", "best emergency plumber Austin", "emergency plumber near me"]) {
    assert.equal(phrases.includes(phrase), true, phrase);
  }
  assert.equal(new Set(phrases.map((phrase) => phrase.toLowerCase())).size, phrases.length);
  for (const phrase of phrases) {
    assert.ok(phrase.length >= 2 && phrase.length <= 80);
    assert.ok(phrase.split(/\s+/).length <= 10);
  }
});

test("clustered coverage does not double-count word-order twins", () => {
  const coverage = clusterCoverage([
    { keyword: "emergency plumbing las vegas", volume: 140 },
    { keyword: "las vegas emergency plumbing", volume: 90 },
    { keyword: "emergency plumbing in las vegas", volume: 40 },
    { keyword: "emergency plumbing", volume: 50 },
    { keyword: "best emergency plumbing las vegas", volume: 20 }
  ]);
  assert.equal(coverage.value, 210);
  assert.notEqual(coverage.value, 140 + 90 + 40 + 50 + 20);
  const twins = coverage.clusters.find((cluster) => cluster.phrases.length === 3);
  assert.equal(twins.representative_volume, 140);
  assert.equal(coverage.status, "measured");
});

test("a missing twin is not filled in as zero", () => {
  const coverage = clusterCoverage([
    { keyword: "emergency plumbing las vegas", volume: 140 },
    { keyword: "las vegas emergency plumbing", volume: null },
    { keyword: "emergency plumbing", volume: null }
  ]);
  assert.equal(coverage.value, 140);
  assert.equal(coverage.status, "partial");
  assert.equal(coverage.missing_cluster_count, 1);
  const missing = coverage.clusters.find((cluster) => cluster.status === "missing");
  assert.equal(missing.representative_volume, null);
});

test("parseDemandPayload keeps every returned phrase and scores the clustered sum", () => {
  const report = parseDemandPayload({
    status_code: 20000,
    tasks: [{
      status_code: 20000,
      cost: 0.09,
      result: [
        { keyword: "emergency plumbing las vegas", search_volume: 140, cpc: 9, competition: "HIGH", competition_index: 70, monthly_searches: null },
        { keyword: "las vegas emergency plumbing", search_volume: 90, cpc: 8, competition: "HIGH", competition_index: 60, monthly_searches: null },
        { keyword: "emergency plumbing", search_volume: 50, cpc: 4, competition: "MEDIUM", competition_index: 20, monthly_searches: null }
      ]
    }]
  }, {
    keyword: "emergency plumbing",
    keywords: ["emergency plumbing", "emergency plumbing las vegas", "las vegas emergency plumbing"],
    location: null,
    sentToDataForSeo: true,
    redact: (value) => value
  });
  assert.equal(report.keyword_rows.length, 3);
  assert.equal(report.search_volume.value, 50);
  assert.equal(report.clustered_coverage_volume.value, 190);
  assert.equal(report.demand_index_uses, "clustered_coverage_volume");
  assert.equal(report.keyword_rows[2].cpc.value, 8);
});

test("directory share counts obvious lead-gen domains in the top organic results", () => {
  assert.equal(isDirectoryHost("www.yelp.com"), true);
  assert.equal(isDirectoryHost("https://m.bbb.org/austin"), true);
  assert.equal(isDirectoryHost("notyelp.com"), false);
  const report = parseOrganicPayload({
    status_code: 20000,
    tasks: [{
      status_code: 20000,
      cost: 0.002,
      result: [{
        items: [
          { type: "paid", rank_absolute: 1, url: "https://ads.example", domain: "ads.example", title: "Ad" },
          { type: "organic", rank_absolute: 3, url: "https://www.yelp.com/biz", domain: "www.yelp.com", title: "Yelp" },
          { type: "organic", rank_absolute: 4, url: "https://local.example", domain: "local.example", title: "Local" },
          { type: "people_also_ask", rank_absolute: 5, title: "Questions" },
          { type: "organic", rank_absolute: 6, url: "https://www.angi.com/x", domain: "www.angi.com", title: "Angi" },
          { type: "organic", rank_absolute: 7, url: "https://www.thumbtack.com/x", domain: "thumbtack.com", title: "Thumbtack" },
          { type: "organic", rank_absolute: 8, url: "https://shop.example", domain: "shop.example", title: "Shop" },
          { type: "organic", rank_absolute: 9, url: "https://www.bbb.org/x", domain: "www.bbb.org", title: "BBB" }
        ]
      }]
    }]
  }, { keyword: "plumber", location: null, sentToDataForSeo: true, redact: (value) => value });
  assert.equal(report.results.length, 6);
  assert.equal(report.ignored_non_organic, 2);
  assert.equal(report.directory_counts.top5_directory_count, 3);
  assert.equal(report.directory_counts.top5_results, 5);
  assert.equal(report.directory_counts.top10_directory_count, 4);
  assert.equal(report.directory_counts.top10_results, 6);
  assert.equal(report.used_in_competition_index, false);
  assert.equal(directoryCounts([]).status, "missing");
});

test("Trends seasonality is relative interest and missing data is not zero", () => {
  const points = [];
  const values = [20, 22, 30, 45, 70, 95, 100, 92, 60, 35, 24, 20];
  for (let month = 1; month <= 12; month += 1) {
    points.push({
      date_from: `2025-${String(month).padStart(2, "0")}-06`,
      missing_data: false,
      values: [values[month - 1]]
    });
  }
  points.push({ date_from: "2025-01-20", missing_data: true, values: [0] });
  const series = monthlySeries(points);
  const january = series.find((month) => month.month === 1);
  assert.equal(january.value, 20);
  assert.notEqual(january.value, 0);
  const season = classifySeasonality(series);
  assert.equal(season.level, "high");
  assert.ok(season.peak_months.some((label) => label.startsWith("July")));
  const missing = parseTrendsPayload({
    status_code: 20000,
    tasks: [{ status_code: 20000, cost: 0.011, result: [{ items: [] }] }]
  }, { keyword: "hvac", geo: { level: "state" }, sentToDataForSeo: true, redact: (value) => value });
  assert.equal(missing.status, "missing");
  assert.equal(missing.seasonality.level, null);
  assert.equal(missing.used_as_search_volume, false);
  assert.equal(missing.penalizes_seasonal_niches, false);
});

test("Trends location falls back from city to metro, state, then national", () => {
  const query = { cityNorm: "austin", stateNorm: "texas", countryIso: "us", codeSource: "test" };
  const state = { location_code: 2, location_name: "Texas,United States", location_code_parent: 1, country_iso_code: "US", location_type: "State" };
  const country = { location_code: 1, location_name: "United States", location_code_parent: null, country_iso_code: "US", location_type: "Country" };
  const metro = { location_code: 8, location_name: "Austin,Texas,United States", location_code_parent: 2, country_iso_code: "US", location_type: "DMA Region" };
  assert.equal(selectTrendsLocation([country, state, metro], query).level, "metro");
  assert.equal(selectTrendsLocation([country, state], query).level, "state");
  assert.equal(selectTrendsLocation([country], query).level, "national");
  assert.equal(selectTrendsLocation([], query).level, "unavailable");
});

test("the result cache key cannot replay a volume-only or depth-20 check", async () => {
  const bind = bindSpendRequest("Team@Centik.ai", {
    niche: "Emergency Plumber",
    city: "Austin",
    state: "Texas",
    country: "United States",
    confirmed: {
      google_ads: { location_code: 11 },
      google_maps: { location_code: 22 }
    }
  });
  const key = resultCacheKey(bind);
  assert.match(key, /microsite-v2/);
  assert.match(key, /maps100/);
  assert.match(key, /organic10/);
  assert.match(key, /trends-explore-12m/);
  assert.match(key, /packed-commercial-v1/);
  assert.notEqual(key, `${bind.niche}|${bind.google_ads}|${bind.google_maps}`);
  const gate = createSpendGate({ tokenSecret: "x".repeat(32), now: () => 1_700_000_000_000, baselineUsd: 0, readAccountSpent: async () => 0 });
  await gate.remember(bind, { marker: "new-check" });
  assert.equal((await gate.freshResult(bind)).marker, "new-check");
  assert.equal(await gate.freshResult({ ...bind, niche: "other" }), null);
});

test("the paid quote is exactly 0.105 across four calls", () => {
  const calls = paidCalls();
  assert.deepEqual(calls.map((call) => [call.purpose, call.estimated_cost_usd]), [
    ["Google Ads search volume live", 0.09],
    ["Maps live advanced, depth 100", 0.002],
    ["Google organic live, depth 10", 0.002],
    ["Google Trends explore live", 0.011]
  ]);
  assert.equal(calls.find((call) => call.path.endsWith("/maps/live/advanced")).depth, 100);
  assert.equal(QUERY_COST_USD, 0.105);
  assert.equal(calls.reduce((sum, call) => sum + Math.round(call.estimated_cost_usd * 1000), 0), 105);
});

test("an organic failure does not withhold a measured volume and Maps check", async () => {
  const base = createExampleTransport();
  const transport = {
    async request(args) {
      if (args.path === ORGANIC_PATH) throw Object.assign(new Error("organic down"), { code: "timeout" });
      return base.request(args);
    }
  };
  const deps = exampleDeps(transport);
  const resolution = await resolveLocation({ city: "Austin", state: "Texas", country: "United States" }, deps);
  const report = await validateNiche({
    niche: "emergency plumber",
    city: "Austin",
    state: "Texas",
    country: "United States",
    confirmed: confirmedFrom(resolution)
  }, deps);
  assert.equal(report.organic.status, "failed");
  assert.equal(report.score.overall_display, "79.6");
  assert.equal(report.maps.requested_depth, 100);
  assert.equal(report.trends.geo.level, "city");
  assert.equal(report.city_market.organic_used_in_competition_index, false);
  assert.notEqual(report.requests.some((item) => item.endpoint === `POST ${TRENDS_PATH}`), false);
});
