import assert from "node:assert/strict";
import test from "node:test";
import { suggestSubniches } from "../src/microsite-flow.js";
import { specificTerms } from "../src/query-match.js";

function ids(keyword) {
  return suggestSubniches(keyword).subniches.map((item) => item.id);
}

function row(keyword, id) {
  return suggestSubniches(keyword).subniches.find((item) => item.id === id);
}

test("generic plumbing words keep today's composite order", () => {
  const plain = suggestSubniches("plumbing");
  assert.deepEqual(ids("plumber"), ids("plumbing"));
  assert.deepEqual(ids("PLUMBERS"), ids("plumbing"));
  assert.deepEqual(ids("  plumbing  "), ids("plumbing"));
  assert.deepEqual(ids("plumbers near me"), ids("plumbing"));
  assert.equal(plain.subniches.every((item) => item.match.tier === "none" && item.match.label === null), true);
  assert.equal(plain.subniches[0].id, "emergency-plumbing");
  assert.equal(plain.subniches[0].match.tier, "none");
});

test("specific query words move the matching sub-niche up without changing its composite", () => {
  const emergency = suggestSubniches("emergency plumber");
  assert.equal(emergency.subniches[0].id, "emergency-plumbing");
  assert.equal(emergency.subniches[0].match.tier, "full");
  assert.equal(emergency.subniches[0].match.label, "matches your search");
  assert.equal(emergency.subniches[0].composite.composite_display, "75.3");
  assert.equal(row("EMERGENCY   Plumber!!", "emergency-plumbing").example_rank, 1);
  assert.equal(row("24/7 plumbing", "emergency-plumbing").match.tier, "full");

  assert.equal(suggestSubniches("drain").subniches[0].id, "drain-cleaning");
  assert.equal(row("clog", "drain-cleaning").match.tier, "full");
  assert.equal(suggestSubniches("leak").subniches[0].id, "leak-detection");
  assert.equal(suggestSubniches("water heater repair").subniches[0].id, "water-heater-repair");
  assert.equal(row("water heater repair", "water-heater-repair").match.tier, "full");
  assert.equal(row("water heater repair", "tankless-water-heater").match.tier, "partial");

  const plainDrain = row("plumbing", "drain-cleaning");
  const queriedDrain = row("drain", "drain-cleaning");
  assert.equal(queriedDrain.composite.composite_display, plainDrain.composite.composite_display);
  assert.ok(queriedDrain.example_rank < plainDrain.example_rank);
  assert.deepEqual(specificTerms("leak!"), ["leak"]);
});
