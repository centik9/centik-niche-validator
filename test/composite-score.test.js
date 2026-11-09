import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPETITION_WEIGHT,
  DEMAND_WEIGHT,
  GREEN_MIN,
  MARGIN_WEIGHT,
  YELLOW_MIN,
  bandForComposite,
  compareScoredRows,
  competitionIndex,
  marginIndex,
  scoreExampleMarket
} from "../src/composite-score.js";
import { priceFor } from "../src/job-prices.js";

test("weights and band boundaries stay explicit", () => {
  assert.equal(DEMAND_WEIGHT + COMPETITION_WEIGHT + MARGIN_WEIGHT, 100);
  assert.equal(GREEN_MIN, 60);
  assert.equal(YELLOW_MIN, 30);
  assert.equal(bandForComposite(60), "green");
  assert.equal(bandForComposite(59.9), "yellow");
  assert.equal(bandForComposite(30), "yellow");
  assert.equal(bandForComposite(29.9), "red");
  assert.equal(bandForComposite(0), "red");
  assert.equal(bandForComposite(null), "missing");
});

test("less competition scores higher, and the margin window is logarithmic", () => {
  assert.ok(competitionIndex(3) > competitionIndex(20));
  assert.equal(competitionIndex(0), 100);
  assert.equal(competitionIndex(30), 0);
  assert.equal(competitionIndex(40), 0);
  assert.equal(marginIndex(100, 100), 0);
  assert.equal(marginIndex(5000, 5000), 100);
  assert.equal(marginIndex(147, 352), 23);
});

test("a missing price withholds the composite instead of using zero", () => {
  const priced = scoreExampleMarket({
    exampleRelativeDemand: 100,
    exampleMonthlySearches: 1200,
    exampleCompetitorCount: 0,
    price: { status: "published", low_dollars: 100, high_dollars: 100, sentence: "Example runs $100–$100 per job.", accessed: "2026-11-08" }
  });
  const missing = scoreExampleMarket({
    exampleRelativeDemand: 100,
    exampleMonthlySearches: 1200,
    exampleCompetitorCount: 0,
    price: priceFor("not-a-priced-job")
  });
  assert.equal(priced.status, "calculated");
  assert.equal(priced.composite_display, "70.0");
  assert.equal(missing.status, "withheld");
  assert.equal(missing.composite_display, null);
  assert.equal(missing.band, "missing");
  assert.equal(missing.clears_green_label, "not calculated");
  assert.equal(missing.margin.index, null);
  assert.notEqual(missing.composite_tenths, 0);
});

test("rows sort green, then yellow, then red, then missing", () => {
  const row = (label, band, tenths) => ({ label, composite: { band, composite_tenths: tenths } });
  const rows = [
    row("Red high", "red", 200),
    row("Missing b", "missing", null),
    row("Green low", "green", 600),
    row("Yellow high", "yellow", 500),
    row("Green high", "green", 800),
    row("Missing a", "missing", null),
    row("Yellow low", "yellow", 300)
  ].sort(compareScoredRows);
  assert.deepEqual(rows.map((item) => item.label), [
    "Green high",
    "Green low",
    "Yellow high",
    "Yellow low",
    "Red high",
    "Missing a",
    "Missing b"
  ]);
});

test("exact boundary composites use the weighted tenths", () => {
  const price = (dollars) => ({ status: "published", low_dollars: dollars, high_dollars: dollars, sentence: "x", accessed: "2026-11-08" });
  const greenEdge = scoreExampleMarket({
    exampleRelativeDemand: 75,
    exampleMonthlySearches: 900,
    exampleCompetitorCount: 0,
    price: price(100)
  });
  assert.equal(greenEdge.composite_tenths, 600);
  assert.equal(greenEdge.composite_display, "60.0");
  assert.equal(greenEdge.band, "green");
  assert.equal(greenEdge.clears_green, true);
  const yellowEdge = scoreExampleMarket({
    exampleRelativeDemand: 75,
    exampleMonthlySearches: 900,
    exampleCompetitorCount: 30,
    price: price(100)
  });
  assert.equal(yellowEdge.composite_display, "30.0");
  assert.equal(yellowEdge.band, "yellow");
  assert.equal(yellowEdge.clears_green_label, "no");
  const justUnderGreen = scoreExampleMarket({
    exampleRelativeDemand: 74,
    exampleMonthlySearches: 888,
    exampleCompetitorCount: 0,
    price: price(100)
  });
  assert.equal(justUnderGreen.composite_display, "59.6");
  assert.equal(justUnderGreen.band, "yellow");
  const justUnderYellow = scoreExampleMarket({
    exampleRelativeDemand: 74,
    exampleMonthlySearches: 888,
    exampleCompetitorCount: 30,
    price: price(100)
  });
  assert.equal(justUnderYellow.composite_display, "29.6");
  assert.equal(justUnderYellow.band, "red");
});
