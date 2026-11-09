import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimatePrice, median } from "../src/price-estimate.js";
import { daysBetween, entryProblem, independentKey, isStale, sourceStatus } from "../src/price-model.js";
import { buildReviewDocument } from "../src/price-research.js";
import { priceFor } from "../src/job-prices.js";

const catalog = JSON.parse(readFileSync(new URL("./fixtures/price-catalog.json", import.meta.url), "utf8"));
const related = {
  "drain-cleaning": ["plumbing", "hvac"],
  "lockout": ["locksmith"],
  "furnace": ["hvac"]
};

test("review state, staleness, and broken sources are explicit", () => {
  assert.equal(sourceStatus("https://www.angi.com/articles/example"), "allowed");
  assert.equal(sourceStatus("https://example.com/cost"), "needs_review");
  assert.equal(sourceStatus("notaurl"), "broken");
  assert.equal(isStale("2025-11-08", "2026-11-09"), true);
  assert.equal(isStale("2025-11-09", "2026-11-09"), false);
  assert.equal(daysBetween("2025-11-09", "2026-11-09"), 365);
  assert.equal(entryProblem({ reviewed: false, kind: "sourced", low_dollars: 1, high_dollars: 2, source_url: "https://www.angi.com/x", quote: "q", source_name: "Angi" }), "not_reviewed");
  assert.equal(entryProblem({ reviewed: true, kind: "sourced", low_dollars: 1, high_dollars: 2, source_url: "", quote: "q", source_name: "Angi" }), "broken_source");
  const emergency = priceFor("emergency-plumbing");
  assert.equal(emergency.reviewed, true);
  assert.equal(emergency.kind, "sourced");
  assert.equal(emergency.stale, false);
  assert.equal(emergency.low_dollars, 210);
});

test("aggregators that cite another guide do not count as a second source", () => {
  const angi = {
    niche_id: "drain-cleaning",
    low_dollars: 147,
    high_dollars: 352,
    source_name: "Angi",
    source_url: "https://www.angi.com/articles/how-much-does-drain-cleaning-cost.htm",
    quote: "Most homeowners pay between $147 and $352."
  };
  const fixr = {
    ...angi,
    source_name: "Fixr",
    source_url: "https://www.fixr.com/costs/drain-cleaning",
    quote: "Fixr cites Angi: most homeowners pay between $147 and $352."
  };
  assert.equal(independentKey(fixr), independentKey(angi));
  const review = buildReviewDocument([angi, fixr, { ...angi, source_url: "http://broken.example/x" }]);
  assert.equal(review.live_prices_unchanged, true);
  assert.equal(review.candidates.length, 1);
  assert.equal(review.candidates[0].reviewed, false);
  assert.equal(review.candidates[0].promoted, false);
  assert.deepEqual(review.independent_sources, ["source:Angi"]);
  assert.equal(review.rejected.length, 1);
  assert.equal(review.rejected[0].reason, "broken_source");
});

test("borrowing uses the median low end on labor only, and a direct price wins", () => {
  assert.equal(median([210, 400]), 305);
  assert.equal(median([210, 250, 400]), 250);
  const borrowed = estimatePrice({ nicheId: "drain-cleaning", catalog: catalog.ranges, related });
  assert.equal(borrowed.status, "estimated");
  assert.equal(borrowed.chain.premium_low_dollars, 305);
  assert.deepEqual(borrowed.chain.borrowed_from, ["plumbing", "hvac"]);
  assert.equal(borrowed.chain.labor_share, 0.5);
  assert.equal(borrowed.chain.labor_share_sourced, false);
  assert.equal(borrowed.chain.non_labor_low, 50);
  assert.equal(borrowed.chain.non_labor_high, 150);
  assert.equal(borrowed.chain.trip_fee_dollars, 75);
  assert.equal(borrowed.low_dollars, 50 + 305 + 75);
  assert.equal(borrowed.high_dollars, 150 + 305 + 75);
  assert.equal(borrowed.reviewed, false);

  const direct = estimatePrice({ nicheId: "lockout", catalog: catalog.ranges, related });
  assert.equal(direct.status, "direct");
  assert.equal(direct.low_dollars, 80);
  assert.equal(direct.high_dollars, 250);
  assert.deepEqual(direct.chain.borrowed_from, []);
  assert.equal(direct.stale, true);

  assert.equal(estimatePrice({ nicheId: "retaining-wall", catalog: catalog.ranges, related }).status, "no_estimate");
  assert.equal(estimatePrice({ nicheId: "made-up-trade", catalog: [], related }).reason, "no_related_trade");
  const broken = estimatePrice({
    nicheId: "furnace",
    catalog: [{
      niche_id: "furnace",
      role: "standard",
      kind: "sourced",
      reviewed: true,
      low_dollars: 100,
      high_dollars: 200,
      source_name: "Broken",
      source_url: "http://insecure.example/cost",
      quote: "Not usable."
    }],
    related
  });
  assert.equal(broken.status, "no_estimate");
  assert.equal(broken.reason, "broken_source");
});

test("the research script writes a review file and does not touch live prices", () => {
  const dir = mkdtempSync(join(tmpdir(), "price-review-"));
  const input = join(dir, "findings.json");
  const output = join(dir, "review.json");
  writeFileSync(input, JSON.stringify([{
    niche_id: "hvac",
    role: "standard",
    low_dollars: 150,
    high_dollars: 500,
    source_name: "HomeGuide",
    source_url: "https://homeguide.com/costs/hvac-fixture",
    quote: "Fixture only.",
    read_date: "2026-11-09",
    fixture: true
  }]));
  execFileSync(process.execPath, ["scripts/research-prices.mjs", input, output], {
    cwd: fileURLToPath(new URL("..", import.meta.url))
  });
  const review = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(review.candidates[0].reviewed, false);
  assert.equal(review.candidates[0].fixture, true);
  assert.equal(priceFor("hvac").status, "missing");
});
