import assert from "node:assert/strict";
import test from "node:test";
import { exampleRows } from "../src/gazetteer.js";
import { matchCity } from "../src/locations.js";
import { normalizePlace } from "../src/normalize.js";
import { createMemoryRunHistory, pairKey, snapshotFromValidation } from "../src/run-history.js";
import { bindSpendRequest, createSpendGate, resultCacheKey } from "../src/spend.js";
import { normalizeState } from "../src/states.js";
import { selectTrendsLocation } from "../src/trends-location.js";
import { exampleDeps, confirmedFrom } from "./helpers.js";
import { resolveLocation, validateNiche } from "../src/validator.js";

function query(city, state, countryIso = "us") {
  return {
    cityNorm: normalizePlace(city),
    stateNorm: normalizeState(state, countryIso),
    countryIso,
    codeSource: "example_gazetteer"
  };
}

const PAIRS = [
  ["Omaha", "Texas", "Nebraska"],
  ["Springfield", "Illinois", "Missouri"],
  ["Springfield", "Massachusetts", "Illinois"],
  ["Portland", "Oregon", "Maine"],
  ["Bella Vista", "Arkansas", "California"],
  ["Lancaster", "Ohio", "Pennsylvania"],
  ["Lancaster", "California", "Ohio"],
  ["Lancaster", "Pennsylvania", "California"]
];

test("same-name cities resolve to the chosen state and a different location code", async () => {
  const deps = exampleDeps();
  for (const [city, state, other] of PAIRS) {
    const chosen = await resolveLocation({ city, state, country: "United States" }, deps);
    const elsewhere = await resolveLocation({ city, state: other, country: "United States" }, deps);
    assert.equal(chosen.outcome, "matched", `${city}, ${state}`);
    assert.equal(elsewhere.outcome, "matched", `${city}, ${other}`);
    assert.match(chosen.google_ads.match.location_name, new RegExp(state.replace(" ", "\\s*"), "i"));
    assert.match(chosen.google_ads.match.parent.location_name, new RegExp(state.replace(" ", "\\s*"), "i"));
    assert.match(chosen.google_maps.match.location_name, new RegExp(state.replace(" ", "\\s*"), "i"));
    assert.match(elsewhere.google_ads.match.location_name, new RegExp(other.replace(" ", "\\s*"), "i"));
    assert.notEqual(chosen.google_ads.match.location_code, elsewhere.google_ads.match.location_code);
    assert.notEqual(chosen.google_maps.match.location_code, elsewhere.google_maps.match.location_code);
    assert.notEqual(chosen.google_ads.match.location_code, chosen.google_maps.match.location_code);
    assert.equal(chosen.normalized_query.state_normalized, normalizeState(state, "us"));
    assert.equal(elsewhere.normalized_query.state_normalized, normalizeState(other, "us"));
  }
});

test("a warm location cache still does not reuse another state's Omaha", async () => {
  const deps = exampleDeps();
  const texas = await resolveLocation({ city: "Omaha", state: "TX", country: "United States" }, deps);
  const nebraska = await resolveLocation({ city: "Omaha", state: "NE", country: "United States" }, deps);
  assert.equal(texas.requests.every((item) => item.cache === "miss"), true);
  assert.equal(nebraska.requests.every((item) => item.cache === "hit"), true);
  assert.match(texas.google_ads.match.location_name, /Texas/);
  assert.match(nebraska.google_ads.match.location_name, /Nebraska/);
  assert.notEqual(texas.google_ads.match.location_code, nebraska.google_ads.match.location_code);
});

test("a city missing from the chosen state is an error, not the other state's row", () => {
  const rows = exampleRows("google_ads").filter((row) => row.location_name !== "Omaha,Texas,United States");
  const result = matchCity(rows, query("Omaha", "Texas"));
  assert.equal(result.outcome, "unsupported");
  assert.equal(result.match, null);
  assert.equal(result.same_city_other_regions.includes("Nebraska"), true);
  assert.equal(result.matches.length, 0);

  const ambiguousState = { location_code: 1, location_name: "Arkansas,United States", location_code_parent: null, country_iso_code: "US", location_type: "State" };
  const first = { location_code: 2, location_name: "Bella Vista,Arkansas,United States", location_code_parent: 1, country_iso_code: "US", location_type: "City" };
  const second = { location_code: 3, location_name: "Bella Vista,Arkansas,United States", location_code_parent: 1, country_iso_code: "US", location_type: "Municipality" };
  const ambiguous = matchCity([ambiguousState, first, second], query("Bella Vista", "Arkansas"));
  assert.equal(ambiguous.outcome, "ambiguous");
  assert.equal(ambiguous.match, null);
  assert.equal(ambiguous.matches.length, 2);
});

test("confirming another state's code does not validate the chosen state", async () => {
  const deps = exampleDeps();
  const nebraska = await resolveLocation({ city: "Omaha", state: "Nebraska", country: "United States" }, deps);
  await assert.rejects(
    () => validateNiche({
      niche: "plumber",
      city: "Omaha",
      state: "Texas",
      country: "United States",
      confirmed: confirmedFrom(nebraska)
    }, deps),
    (error) => error.status === 409 && /does not match|not confirmed|No confirmed/i.test(error.message)
  );
});

test("Trends does not borrow a metro from another state or from a state-less name", () => {
  const country = { location_code: 1, location_name: "United States", location_code_parent: null, country_iso_code: "US", location_type: "Country" };
  const texas = { location_code: 2, location_name: "Texas,United States", location_code_parent: 1, country_iso_code: "US", location_type: "State" };
  const nebraskaMetro = { location_code: 50, location_name: "Omaha,Nebraska,United States", location_code_parent: 2, country_iso_code: "US", location_type: "DMA Region" };
  const nameless = { location_code: 9, location_name: "Omaha,United States", location_code_parent: 1, country_iso_code: "US", location_type: "DMA Region" };
  const picked = selectTrendsLocation([country, texas, nebraskaMetro, nameless], query("Omaha", "Texas"));
  assert.equal(picked.level, "state");
  assert.match(picked.match.location_name, /Texas/);
  assert.equal(/Nebraska/.test(picked.match.location_name), false);

  const austinState = { location_code: 3, location_name: "Texas,United States", location_code_parent: 1, country_iso_code: "US", location_type: "State" };
  const one = { location_code: 8, location_name: "Austin,Texas,United States", location_code_parent: 3, country_iso_code: "US", location_type: "DMA Region" };
  const two = { location_code: 11, location_name: "Austin,Texas,United States", location_code_parent: 3, country_iso_code: "US", location_type: "Metro" };
  const ambiguous = selectTrendsLocation([country, austinState, one, two], query("Austin", "Texas"));
  assert.equal(ambiguous.level, "state");
  assert.equal(ambiguous.match.location_code, austinState.location_code);
});

test("result cache and history keys keep the state, not only the city name", async () => {
  const texas = bindSpendRequest("team@centik.ai", {
    niche: "plumber",
    city: "Omaha",
    state: "Texas",
    country: "United States",
    confirmed: {
      google_ads: { location_code: 9001016 },
      google_maps: { location_code: 9101016 }
    }
  });
  const nebraska = bindSpendRequest("team@centik.ai", {
    niche: "plumber",
    city: "Omaha",
    state: "Nebraska",
    country: "United States",
    confirmed: {
      google_ads: { location_code: 9001015 },
      google_maps: { location_code: 9101015 }
    }
  });
  assert.notEqual(resultCacheKey(texas), resultCacheKey(nebraska));
  assert.match(resultCacheKey(texas), /texas/);
  assert.match(resultCacheKey(nebraska), /nebraska/);
  assert.match(resultCacheKey(texas), /9001016/);
  assert.match(resultCacheKey(nebraska), /9001015/);
  assert.notEqual(pairKey({ niche: "plumber", city: "Omaha", state: "Texas" }), pairKey({ niche: "plumber", city: "Omaha", state: "Nebraska" }));

  const gate = createSpendGate({
    tokenSecret: "x".repeat(32),
    now: () => 1_700_000_000_000,
    baselineUsd: 0,
    readAccountSpent: async () => 0
  });
  await gate.remember(nebraska, { marker: "nebraska", maps: { requested_depth: 100 } });
  assert.equal((await gate.freshResult(nebraska)).marker, "nebraska");
  assert.equal(await gate.freshResult(texas), null);
  await gate.remember(texas, { marker: "texas", maps: { requested_depth: 100 } });
  assert.equal((await gate.freshResult(texas)).marker, "texas");
  assert.equal((await gate.freshResult(nebraska)).marker, "nebraska");

  const history = createMemoryRunHistory();
  const snapshot = (state, checkedAt) => snapshotFromValidation({
    example_data: true,
    niche: "plumber",
    score: { overall_status: "withheld", overall: null },
    city_market: {},
    maps: { requested_depth: 100 }
  }, {
    email: "team@centik.ai",
    lens: "classroom",
    checkedAt,
    city: "Omaha",
    state
  });
  const first = await history.record(snapshot("Texas", "2026-01-01T00:00:00.000Z"));
  const second = await history.record(snapshot("Nebraska", "2026-02-01T00:00:00.000Z"));
  assert.equal(second.prior, null);
  assert.notEqual(pairKey(first.record), pairKey(second.record));
  assert.equal(first.record.state, "Texas");
  assert.equal(second.record.state, "Nebraska");
});
