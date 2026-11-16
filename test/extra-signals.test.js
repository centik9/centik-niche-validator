import assert from "node:assert/strict";
import test from "node:test";
import { buildAdsMarket, loadAdsTransparency } from "../src/ads-market.js";
import { buildConversionReadiness, classifyFold, collectLeadPages, isPublicPageUrl } from "../src/conversion-readiness.js";
import { clusterThemes } from "../src/review-themes.js";
import { buildResultsRisk, sourceRisk } from "../src/results-risk.js";
import { assembleSignalCard } from "../src/signal-score.js";
import { resolveLocation, validateNiche } from "../src/validator.js";
import { confirmedFrom, exampleDeps } from "./helpers.js";

function plain(value) {
  assert.equal(/[—–-]/.test(String(value || "")), false, value);
  assert.ok(String(value || "").length <= 160, value);
}

test("page text classifies a call button ahead of a form, and private urls are refused", () => {
  assert.equal(classifyFold("<a href='tel:5125550100'>Call now</a><form></form>").lead, "phone");
  assert.equal(classifyFold("<form><input type='email'></form>").lead, "form");
  assert.equal(classifyFold("<p>Hours and a map</p>").lead, "neither");
  assert.equal(isPublicPageUrl("https://austinplumbing.example/emergency"), false);
  assert.equal(isPublicPageUrl("http://shop.example.com/a"), false);
  assert.equal(isPublicPageUrl("https://127.0.0.1/a"), false);
  assert.equal(isPublicPageUrl("https://192.168.1.9/a"), false);
  assert.equal(isPublicPageUrl("https://shop.example.com/a"), true);
});

test("a missing near me volume is not scored as zero", () => {
  const card = buildConversionReadiness({
    origin: "live",
    pages: { pages: [], reason: "No contractor sites were in the top results, so pages were not opened." },
    organic: { directory_counts: { status: "measured", top10_results: 4, top10_directory_count: 1, top10_directory_share: 0.25 } },
    demand: {
      clusters: [{ phrases: ["plumber near me"], status: "missing", representative_volume: null }],
      clustered_coverage_volume: { status: "measured", value: 100 }
    }
  });
  const near = card.signals.find((signal) => signal.id === "near_me");
  assert.equal(near.status, "missing");
  assert.equal(near.score, null);
  assert.match(near.reason, /not treated as zero/);
  assert.equal(card.score, null);
  assert.equal(card.status, "insufficient_evidence");
  plain(card.explanation);
});

test("measured proxies rescale and a real zero stays measured", () => {
  const card = buildConversionReadiness({
    origin: "live",
    pages: {
      pages: [
        { status: "measured", lead: "phone" },
        { status: "measured", lead: "form" }
      ]
    },
    organic: { directory_counts: { status: "measured", top10_results: 10, top10_directory_count: 7, top10_directory_share: 0.7 } },
    demand: {
      clusters: [
        { phrases: ["plumber"], status: "measured", representative_volume: 75 },
        { phrases: ["plumber near me"], status: "measured", representative_volume: 25 }
      ],
      clustered_coverage_volume: { status: "measured", value: 100 }
    }
  });
  assert.equal(card.coverage.measured, 3);
  assert.equal(card.coverage.label, "Based on 3 of 3 signals");
  assert.equal(card.signals.find((signal) => signal.id === "phone_vs_form").score, 83);
  assert.equal(card.signals.find((signal) => signal.id === "directory_ratio").score, 30);
  assert.equal(card.signals.find((signal) => signal.id === "near_me").score, 100);
  assert.equal(card.score, 69);
  assert.equal(card.changes_grade, false);
  plain(card.explanation);
  plain(card.higher_means);
});

test("fewer than half of the signals withholds the number", () => {
  const card = assembleSignalCard({
    id: "demo",
    title: "Demo",
    higherMeans: "Higher means more evidence.",
    signals: [
      { id: "a", name: "A", icon: "list", weight: 0.5, status: "measured", score: 80, raw_fact: "One fact" },
      { id: "b", name: "B", icon: "list", weight: 0.25, status: "missing", score: null, raw_fact: "Not measured", reason: "No source." },
      { id: "c", name: "C", icon: "list", weight: 0.25, status: "estimated", score: 10, raw_fact: "Derived" }
    ],
    exampleData: false,
    measuredAt: "2026-01-15T00:00:00.000Z",
    footerSource: "Test source",
    explanation: "Only one signal was measured."
  });
  assert.equal(card.coverage.measured, 1);
  assert.equal(card.score, null);
  assert.equal(card.status, "insufficient_evidence");
  assert.equal(card.signals[0].id, "a");
});

test("review themes repeat across businesses and risk uses both sides", () => {
  const themes = clusterThemes([
    { business: "Alpha", rating: 1, text: "Total no show." },
    { business: "Beta", rating: 2, text: "The tech never showed." },
    { business: "Alpha", rating: 5, text: "Great no show mention should not count." }
  ]);
  assert.equal(themes[0].theme, "no shows");
  assert.equal(themes[0].businesses, 2);
  assert.equal(sourceRisk(70, 15), 20);
  assert.equal(sourceRisk(null, 15), null);
});

test("example mode returns all three signals without changing the grade", async () => {
  let fetched = false;
  const deps = exampleDeps();
  deps.pageFetch = async () => {
    fetched = true;
    throw new Error("example mode fetched a page");
  };
  const resolution = await resolveLocation({ city: "Austin", state: "Texas", country: "United States" }, deps);
  const report = await validateNiche({
    niche: "emergency plumber",
    city: "Austin",
    state: "Texas",
    country: "United States",
    confirmed: confirmedFrom(resolution)
  }, deps);
  assert.equal(fetched, false);
  assert.equal(report.score.overall_display, "79.6");
  assert.equal(report.maps.requested_depth, 100);
  for (const card of [report.conversion_readiness, report.ads_market, report.results_risk]) {
    assert.equal(card.example_data, true);
    assert.equal(card.data_label, "Sample, not live");
    assert.equal(card.changes_grade, false);
    assert.equal(Number.isInteger(card.score), true);
    plain(card.explanation);
    plain(card.higher_means);
    assert.match(card.footer, /Sample, not live/);
  }
  assert.match(report.conversion_readiness.signals.find((signal) => signal.id === "directory_ratio").raw_fact, /7 of 10/);
  assert.match(report.conversion_readiness.signals.find((signal) => signal.id === "phone_vs_form").raw_fact, /Call button on 2 of 3/);
  assert.equal(report.ads_market.coverage.measured, 6);
  assert.match(report.ads_market.higher_means, /proven, steady channel/);
  const risk = report.results_risk;
  assert.equal(risk.score, 36);
  assert.equal(risk.balance.positive.count, 38);
  assert.equal(risk.balance.negative.count, 14);
  assert.match(risk.higher_means, /not a safer market/);
  const nextdoor = risk.signals.find((signal) => signal.id === "nextdoor");
  const board = risk.signals.find((signal) => signal.id === "state_board");
  assert.equal(nextdoor.status, "missing");
  assert.equal(nextdoor.score, null);
  assert.equal(board.score, null);
  assert.match(nextdoor.reason, /login/);
  assert.match(board.reason, /not guessed/);
});

test("live results risk does not invent a zero when sources are closed", () => {
  const card = buildResultsRisk({ state: "Texas", origin: "live", measuredAt: "2026-01-15T00:00:00.000Z" });
  assert.equal(card.score, null);
  assert.equal(card.balance, null);
  assert.equal(card.coverage.measured, 0);
  assert.equal(card.coverage.total, 6);
  for (const signal of card.signals) {
    assert.equal(signal.status, "missing");
    assert.equal(signal.score, null);
    assert.equal(signal.positive, null);
    assert.equal(signal.negative, null);
  }
  plain(card.explanation);
  assert.match(card.signals.find((signal) => signal.id === "bbb").reason, /outside their terms/);
  assert.match(card.signals.find((signal) => signal.id === "google").reason, /not sent/i);
});

test("a live page fetch is capped and a failed page is not a zero", async () => {
  const calls = [];
  const pages = await collectLeadPages({
    origin: "live",
    results: [
      { directory: true, url: "https://www.yelp.com/search" },
      { directory: false, url: "https://shop.example.com/one" },
      { directory: false, url: "http://shop.example.com/plain" },
      { directory: false, url: "https://shop.example.com/two" }
    ],
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith("/two")) throw new Error("down");
      return { ok: true, status: 200, text: async () => "<a href='tel:5125550100'>Call now</a>" };
    }
  });
  assert.deepEqual(calls, ["https://shop.example.com/one", "https://shop.example.com/two"]);
  const card = buildConversionReadiness({
    origin: "live",
    pages,
    organic: { directory_counts: { status: "missing" } },
    demand: { clusters: [] }
  });
  const phone = card.signals.find((signal) => signal.id === "phone_vs_form");
  assert.equal(phone.status, "measured");
  assert.equal(phone.evidence.phone, 1);
  assert.equal(phone.evidence.checked, 1);
});

test("ads history uses a location name and skips the paid call when no ids return", async () => {
  const calls = [];
  const deps = {
    origin: "live",
    transport: {
      async request(args) {
        calls.push(args);
        return {
          status_code: 20000,
          tasks: [{ status_code: 20000, cost: 0.002, result: [{ items: [] }] }]
        };
      }
    }
  };
  const ads = await loadAdsTransparency({
    niche: "plumber",
    city: "Austin",
    state: "Texas",
    countryCanonical: "United States"
  }, deps);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body[0].location_name, "Austin,Texas,United States");
  assert.equal(Object.hasOwn(calls[0].body[0], "location_code"), false);
  assert.equal(calls.some((call) => call.path.endsWith("/ads_search/live/advanced")), false);
  const card = buildAdsMarket({
    niche: "plumber",
    origin: "live",
    ads,
    organic: { paid_results: [] },
    trends: { seasonality: { status: "missing" } },
    measuredAt: "2026-01-15T00:00:00.000Z"
  });
  assert.equal(card.requests.filter((row) => row.sent_to_dataforseo).length, 2);
  assert.equal(card.signals.find((signal) => signal.id === "run_length").score, null);
  assert.equal(card.score, null);
  plain(card.explanation);
});
