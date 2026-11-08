import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import {
  buildProposal,
  buildShortlist,
  createFlowState,
  reduceFlow,
  suggestSubniches
} from "../src/microsite-flow.js";
import { postJson, withServer } from "./helpers.js";

const context = { keyword: "plumbing" };

test("plumbing sub-niches are a 20-row example leaderboard", () => {
  const result = suggestSubniches("Emergency plumber");
  assert.equal(result.known_profile, true);
  assert.equal(result.subniches.length, 20);
  assert.equal(result.subniches[0].label, "Emergency plumbing");
  assert.equal(result.subniches[0].example_rank, 1);
  assert.equal(result.subniches[0].example_strength, 96);
  assert.equal(result.subniches[19].label, "Tankless water heater service");
  assert.equal(result.subniches[19].example_strength, 16);
  const strengths = result.subniches.map((item) => item.example_strength);
  assert.deepEqual(strengths, [...strengths].sort((a, b) => b - a));
  assert.equal(new Set(result.subniches.map((item) => item.id)).size, 20);
  assert.match(result.ranking_note, /not researched demand/);
});

test("an unknown keyword is not given a fake specialty ranking", () => {
  const result = suggestSubniches("bakery delivery");
  assert.equal(result.known_profile, false);
  assert.equal(result.subniches.length, 0);
  assert.notEqual(result.subniches.length, 20);
  assert.equal(result.unranked_option.id, "unranked-keyword");
  assert.equal(result.unranked_option.example_rank, null);
  assert.match(result.ranking_note, /not a researched specialty/);
});

test("context and sub-niche changes invalidate later choices", () => {
  let flow = reduceFlow(createFlowState(), { type: "set_context", context });
  assert.deepEqual(flow.invalidated, ["subniche", "location", "proposal", "deep_check"]);
  flow = reduceFlow(flow, { type: "pick_subniche", subniche: { id: "emergency-plumbing" } });
  flow = reduceFlow(flow, { type: "pick_location", location: { id: "austin-tx" } });
  flow = reduceFlow(flow, { type: "decide_proposal", choice: "yes" });
  assert.equal(flow.deep_check.paid_calls_allowed, false);
  assert.equal(flow.deep_check.prototype_only, true);
  const reset = reduceFlow(flow, { type: "set_context", context: { keyword: "plumbing" } });
  assert.equal(reset.location, null);
  assert.equal(reset.proposal_decision, null);
  assert.equal(reset.deep_check, null);
  const afterSubniche = reduceFlow(flow, { type: "pick_subniche", subniche: { id: "drain-cleaning" } });
  assert.equal(afterSubniche.location, null);
  assert.equal(afterSubniche.deep_check, null);
});

test("example bars are not housing counts, and missing proxies are not zero", async () => {
  const emergency = await buildShortlist({ ...context, subniche_id: "emergency-plumbing" });
  const drains = await buildShortlist({ ...context, subniche_id: "drain-cleaning" });
  assert.equal(emergency.paid_dataforseo_called, false);
  assert.match(emergency.example_banner, /not Census demand/);
  const austin = emergency.cards.find((card) => card.id === "austin-tx");
  const portland = emergency.cards.find((card) => card.id === "portland-or");
  const hunt = emergency.cards.find((card) => card.id === "hunt-county-tx");
  assert.equal(austin.example_evidence.not_census, true);
  assert.notEqual(austin.example_evidence.monthly_searches, austin.housing_proxy.housing_units);
  assert.equal(austin.housing_proxy.housing_units, 466428);
  assert.equal(portland.housing_proxy.status, "not_in_sample");
  assert.equal(portland.housing_proxy.housing_units, null);
  assert.equal(hunt.example_deep_check, false);
  assert.match(hunt.deep_check_block, /not treated as a city/);
  assert.notEqual(
    emergency.cards[0].id,
    drains.cards[0].id
  );
  assert.equal(emergency.coverage.exhaustive, false);
  assert.equal(emergency.coverage.biased_by_user_location, false);
  assert.equal(emergency.cards.some((card) => card.starting_context), false);
  const withAustin = await buildShortlist({ keyword: "plumbing", subniche_id: "emergency-plumbing", city: "Austin", state: "Texas" });
  const withChicago = await buildShortlist({ keyword: "plumbing", subniche_id: "emergency-plumbing", city: "Chicago", state: "Illinois" });
  assert.deepEqual(withAustin.cards.map((card) => card.id), withChicago.cards.map((card) => card.id));
  assert.deepEqual(withAustin.cards.map((card) => card.example_relative_demand), emergency.cards.map((card) => card.example_relative_demand));
});

test("a proposal must match the keyword and does not authorize spending", () => {
  const proposal = buildProposal({
    ...context,
    subniche_id: "emergency-plumbing",
    location_id: "austin-tx"
  });
  assert.equal(proposal.microsite_name, "Austin Emergency plumbing");
  assert.match(proposal.suggested_domain, /\.example$/);
  assert.equal(proposal.domain_availability, "not_checked");
  assert.equal(proposal.deep_check_gate.paid_calls_allowed, false);
  assert.equal(proposal.deep_check_gate.example_check_available, true);
  assert.equal(proposal.claims_not_made.some((line) => /licensed/i.test(line)), true);
  assert.throws(() => buildProposal({
    keyword: "bakery delivery",
    city: "Austin",
    state: "Texas",
    country: "United States",
    subniche_id: "emergency-plumbing",
    location_id: "austin-tx"
  }), (error) => error.code === "inconsistent_choice");
  const county = buildProposal({ ...context, subniche_id: "drain-cleaning", location_id: "hunt-county-tx" });
  assert.equal(county.deep_check_gate.example_check_available, false);
});

test("the preview route stays on example data", async () => {
  let fetches = 0;
  const app = createApp({
    env: { DATAFORSEO_LIVE: "false" },
    fetchImpl: async () => { fetches += 1; throw new Error("network"); }
  });
  await withServer(app, async (port) => {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    const html = await page.text();
    assert.match(html, /id="keyword"/);
    assert.equal(html.includes('id="city"'), false);
    assert.equal(html.includes("Show example sub-niches"), false);
    assert.match(html, /Example data only/);
    assert.equal(html.includes("Run free public-data screen"), false);
    const response = await postJson(port, "/api/microsite", { action: "subniches", ...context });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.paid_dataforseo_called, false);
    assert.equal(body.known_profile, true);
    assert.equal(fetches, 0);
  });
});
