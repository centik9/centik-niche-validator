import assert from "node:assert/strict";
import test from "node:test";
import { zoneFor } from "../src/gauge-zone.js";
import { priceForServiceNiche, priceFromBrokenSource } from "../src/niche-prices.js";
import { buildProposal, suggestSubniches } from "../src/microsite-flow.js";

test("zone words keep the 15, 30, 60, and 80 cuts", () => {
  assert.equal(zoneFor(0), "No");
  assert.equal(zoneFor(14.9), "No");
  assert.equal(zoneFor(15), "Low");
  assert.equal(zoneFor(29.9), "Low");
  assert.equal(zoneFor(30), "Medium");
  assert.equal(zoneFor(59.9), "Medium");
  assert.equal(zoneFor(60), "High");
  assert.equal(zoneFor(79.9), "High");
  assert.equal(zoneFor(80), "Max");
  assert.equal(zoneFor(100), "Max");
});

test("direct prices stay sourced and estimates cannot rank as green", () => {
  for (const id of ["plumbing", "hvac", "locksmith", "garage-door"]) {
    const price = priceForServiceNiche(id);
    assert.equal(price.status, "published");
    assert.equal(price.kind, "sourced");
    assert.equal(price.estimated, false);
    assert.equal(price.reviewed, true);
    assert.ok(price.low_dollars < price.high_dollars);
  }
  assert.equal(priceForServiceNiche("plumbing").low_dollars, 210);
  assert.equal(priceForServiceNiche("plumbing").high_dollars, 620);
  assert.equal(priceForServiceNiche("plumbing").snippet_only, true);
  const electrician = priceForServiceNiche("electrician");
  assert.equal(electrician.kind, "derived");
  assert.equal(electrician.estimated, true);
  assert.match(electrician.chain_text, /labor only/);
  assert.match(electrician.chain_text, /Trip fee \$100/);
  for (const id of ["retaining-wall", "mobile-welding", "crawl-space"]) {
    assert.equal(priceForServiceNiche(id).status, "no_estimate");
  }
  assert.equal(priceForServiceNiche("not-a-real-trade").status, "no_estimate");
  assert.equal(priceFromBrokenSource().status, "no_price");

  const board = suggestSubniches("electrician");
  const row = board.subniches.find((item) => item.id === "electrician");
  assert.equal(row.example_rank, 1);
  assert.equal(row.composite.composite_display, "64.8");
  assert.equal(row.composite.score_band, "green");
  assert.equal(row.composite.band, "yellow");
  assert.equal(row.composite.clears_green_label, "on an estimated price");
  const proposal = buildProposal({ keyword: "electrician", subniche_id: "electrician", location_id: "austin-tx" });
  assert.equal(proposal.deep_check_gate.gate_line.startsWith("Clears green on an estimated price."), true);
  assert.match(proposal.deep_check_gate.demand_basis_note, /national example demand/);
  assert.equal(proposal.deep_check_gate.paid_calls_allowed, false);
});
