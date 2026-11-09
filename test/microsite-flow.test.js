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
import { postJson, sessionCookie, TEST_AUTH, withServer } from "./helpers.js";

const context = { keyword: "plumbing" };

test("plumbing sub-niches are a 20-row composite leaderboard", () => {
  const result = suggestSubniches("plumbing");
  assert.equal(result.known_profile, true);
  assert.equal(result.subniches.length, 20);
  assert.equal(new Set(result.subniches.map((item) => item.id)).size, 20);
  const order = { green: 0, yellow: 1, red: 2, missing: 3 };
  result.subniches.forEach((item, index) => {
    assert.equal(item.example_rank, index + 1);
    if (index === 0) return;
    const previous = result.subniches[index - 1];
    assert.ok(order[item.composite.band] >= order[previous.composite.band]);
    if (item.composite.band === previous.composite.band && item.composite.composite_tenths !== null) {
      assert.ok(previous.composite.composite_tenths >= item.composite.composite_tenths);
    }
  });
  const drain = result.subniches.find((item) => item.id === "drain-cleaning");
  assert.equal(drain.price.low_dollars, 147);
  assert.equal(drain.price.high_dollars, 352);
  assert.equal(drain.price.city_adjusted, false);
  assert.equal(drain.price.source_name, "Angi");
  assert.equal(result.price_coverage.missing_ids.includes("emergency-plumbing"), false);
  assert.equal(result.price_coverage.missing_ids.includes("bath-remodel-plumbing"), true);
  assert.equal(result.price_coverage.missing_ids.includes("repipe"), true);
  const emergency = result.subniches.find((item) => item.id === "emergency-plumbing");
  assert.equal(emergency.price.low_dollars, 210);
  assert.equal(emergency.price.high_dollars, 620);
  assert.equal(emergency.price.source_name, "Thumbtack");
  assert.equal(emergency.composite.status, "calculated");
  assert.equal(emergency.composite.composite_display, "75.3");
  assert.equal(emergency.composite.band, "green");
  assert.equal(emergency.example_rank, 1);
  assert.match(result.ranking_note, /not adjusted for a city/);
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
  assert.equal(proposal.composite.status, "calculated");
  assert.equal(proposal.composite.composite_display, "72.5");
  assert.equal(proposal.deep_check_gate.clears_green, "yes");
  assert.equal(proposal.price.low_dollars, 210);
  assert.equal(proposal.price.high_dollars, 620);
  const nyc = buildProposal({ keyword: "plumbing", subniche_id: "drain-cleaning", location_id: "new-york-ny" });
  assert.equal(nyc.composite.demand.index, 90);
  assert.equal(nyc.composite.demand.monthly_searches, 1080);
  assert.equal(nyc.composite.demand.contribution_display, "36.0");
  assert.equal(nyc.composite.competition.competitor_count, 6);
  assert.equal(nyc.composite.competition.index, 80);
  assert.equal(nyc.composite.competition.contribution_display, "24.0");
  assert.equal(nyc.composite.margin.low_dollars, 147);
  assert.equal(nyc.composite.margin.high_dollars, 352);
  assert.equal(nyc.composite.margin.index, 23);
  assert.equal(nyc.composite.margin.contribution_display, "6.9");
  assert.equal(nyc.composite.margin.city_adjusted, false);
  assert.equal(nyc.composite.composite_display, "66.9");
  assert.equal(nyc.composite.band, "green");
  assert.equal(nyc.deep_check_gate.gate_line, "Clears green: yes. Yes does not authorize spending or publishing.");
  assert.equal(nyc.deep_check_gate.paid_calls_allowed, false);
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
    env: { ...TEST_AUTH, DATAFORSEO_LIVE: "false" },
    fetchImpl: async () => { fetches += 1; throw new Error("network"); }
  });
  await withServer(app, async (port) => {
    const page = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie: await sessionCookie(port) } });
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
