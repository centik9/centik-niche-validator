import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { discoverShortlist } from "../src/discovery.js";
import { familyOf } from "../src/discovery-fixtures.js";
import { createApp } from "../src/app.js";
import { loadExtractCatalog } from "../src/screen.js";
import { matchShortlistServices, parseDiscoveryRegion } from "../src/shortlist-match.js";
import { TEST_AUTH, postJson, withServer } from "./helpers.js";

function citiesOf(report) {
  return report.rows.map((row) => `${row.city}, ${row.state}`);
}

function expectHttp(fn, status, code) {
  assert.throws(fn, (error) => {
    assert.equal(error.status, status);
    if (code) assert.equal(error.code, code);
    assert.match(error.message, /./);
    return true;
  });
}

test("nationwide shortlist finishes under the client timeout", () => {
  const started = performance.now();
  const report = discoverShortlist({ service: "welding", region: "Any US state", mode: "example" });
  const elapsed = performance.now() - started;
  const states = new Set(report.rows.map((row) => row.state));
  assert.ok(report.rows.length >= 2);
  assert.ok(states.size >= 2);
  assert.ok(report.rows.every((row) => /weld/i.test(row.service)));
  assert.equal(report.paid_dataforseo_called, false);
  assert.ok(elapsed < 2000, `nationwide took ${Math.round(elapsed)}ms`);
  const repeatStarted = performance.now();
  const repeat = discoverShortlist({ service: "welding", region: "any U.S. state", mode: "example" });
  const repeatElapsed = performance.now() - repeatStarted;
  assert.deepEqual(repeat.rows.map((row) => row.geoid), report.rows.map((row) => row.geoid));
  assert.ok(repeatElapsed < 500, `cached nationwide took ${Math.round(repeatElapsed)}ms`);
});

test("service wording resolves trades outside the old fixture families", () => {
  assert.equal(familyOf("mobile welding"), "welding");
  assert.equal(familyOf("foundation repair"), "foundation");
  assert.equal(familyOf("roofing"), "roofing");
  assert.equal(familyOf("septic installation"), "septic");
  const welding = matchShortlistServices("welding").map((entry) => entry.label);
  assert.ok(welding.length >= 2);
  assert.ok(welding.every((label) => /weld/i.test(label)));
  assert.deepEqual(matchShortlistServices("mobile welding").map((entry) => entry.id), ["mobile-welding"]);
  assert.equal(matchShortlistServices("foundation repair")[0].id, "foundation-repair");
  assert.equal(matchShortlistServices("crawl space")[0].family, "crawl-space");
  assert.equal(matchShortlistServices("quilt restoration").length, 0);
  assert.equal(matchShortlistServices("weldng")[0].family, "welding");
  assert.equal(matchShortlistServices("foundaton repair")[0].id, "foundation-repair");
});

test("region accepts a state name, a code, and a nationwide blank", () => {
  assert.equal(parseDiscoveryRegion("Nevada").state.usps, "NV");
  assert.equal(parseDiscoveryRegion("nv").label, "Nevada");
  assert.equal(parseDiscoveryRegion(" NEVADA ").label, "Nevada");
  assert.equal(parseDiscoveryRegion("tn").label, "Tennessee");
  assert.equal(parseDiscoveryRegion("district of columbia").state.usps, "DC");
  assert.equal(parseDiscoveryRegion("dc").state.usps, "DC");
  assert.equal(parseDiscoveryRegion("any U.S. state").scope, "nationwide");
  assert.equal(parseDiscoveryRegion("Any US state").scope, "nationwide");
  assert.equal(parseDiscoveryRegion("").scope, "nationwide");
  assert.equal(parseDiscoveryRegion("   ").scope, "nationwide");
  assert.equal(parseDiscoveryRegion("nationwide").scope, "nationwide");
  expectHttp(() => parseDiscoveryRegion("Narnia"), 400, "invalid_region");
  expectHttp(() => parseDiscoveryRegion("XX"), 400, "invalid_region");
  expectHttp(() => parseDiscoveryRegion("x".repeat(81)), 400, "invalid_region");
  expectHttp(() => parseDiscoveryRegion(12), 400, "invalid_region");
});

test("welding in Nevada returns only Nevada welding niches from Census, with nothing invented", () => {
  const report = discoverShortlist({ service: "welding", region: "Nevada", lens: "classroom", mode: "example" });
  assert.equal(report.paid_dataforseo_called, false);
  assert.equal(report.dataforseo_called, false);
  assert.equal(report.region, "Nevada");
  assert.equal(report.state_usps, "NV");
  assert.ok(report.rows.length >= 2);
  assert.ok(report.rows.every((row) => row.state === "Nevada" && row.state_usps === "NV"));
  assert.ok(report.rows.every((row) => /weld/i.test(row.service)));
  assert.equal(report.rows.some((row) => /septic|roof|plumb|foundation/i.test(row.service)), false);
  const coded = discoverShortlist({ service: "welding", region: "nv", mode: "example" });
  assert.deepEqual(citiesOf(coded), citiesOf(report));
  for (const row of report.rows) {
    assert.equal(row.census.owner_occupancy_rate.status, "measured");
    assert.ok(row.census.owner_occupancy_rate.value > 0 && row.census.owner_occupancy_rate.value <= 1);
    assert.equal(row.census.population.status, "unavailable");
    assert.equal(row.census.population.value, null);
    assert.equal(row.census.median_home_value.value, null);
    assert.equal(row.price.status, "unavailable");
    assert.equal(row.price.low_dollars, null);
    assert.equal(row.price.high_dollars, null);
    assert.equal(row.competition.strongest_in_town_ratings, null);
    assert.deepEqual(row.competition.places, []);
    assert.equal(row.search_volume.value, null);
    assert.equal(row.cpc.value, null);
    assert.equal(row.paid_dataforseo_called, false);
  }
  assert.ok(report.sources.every((source) => source.id !== "dataforseo" || source.used === false));
});

test("a nationwide welding shortlist is not limited to one state", () => {
  for (const region of ["any U.S. state", "Any US state", ""]) {
    const report = discoverShortlist({ service: "welding", region, mode: "example" });
    const states = new Set(report.rows.map((row) => row.state));
    assert.equal(report.region_scope, "nationwide");
    assert.ok(report.rows.length >= 2, region || "(blank)");
    assert.ok(states.size >= 2, [...states].join(", "));
    assert.ok(report.rows.every((row) => /weld/i.test(row.service)));
    assert.equal(report.paid_dataforseo_called, false);
  }
});

test("septic in Ohio is a different city list from septic in Arkansas", () => {
  const ohio = discoverShortlist({ service: "septic", region: "Ohio", mode: "example" });
  const arkansas = discoverShortlist({ service: "septic", region: "Arkansas", mode: "example" });
  assert.ok(ohio.rows.length >= 1);
  assert.ok(arkansas.rows.length >= 1);
  assert.ok(ohio.rows.every((row) => row.state === "Ohio" && /septic/i.test(row.service)));
  assert.ok(arkansas.rows.every((row) => row.state === "Arkansas" && /septic/i.test(row.service)));
  assert.notDeepEqual(citiesOf(ohio), citiesOf(arkansas));
  const overlap = ohio.rows.some((row) => arkansas.rows.some((other) => other.city === row.city && other.state === row.state));
  assert.equal(overlap, false);
  assert.equal(ohio.rows[0].price.status, "published");
  assert.equal(ohio.rows[0].price.low_dollars, 3500);
  assert.equal(ohio.rows[0].price.high_dollars, 8500);
  assert.equal(ohio.rows[0].price.city_adjusted, false);
});

test("foundation repair in Tennessee stays in Tennessee", () => {
  const report = discoverShortlist({ service: "foundation repair", region: "Tennessee", mode: "example" });
  assert.ok(report.rows.length >= 1);
  assert.ok(report.rows.every((row) => row.state === "Tennessee" && row.state_usps === "TN"));
  assert.ok(report.rows.every((row) => /foundation/i.test(row.service)));
  assert.equal(report.paid_dataforseo_called, false);
  assert.equal(report.rows[0].price.low_dollars, null);
});

test("empty, invalid, unknown, and oversized shortlist input does not throw a 500", () => {
  expectHttp(() => discoverShortlist({ service: "", region: "Nevada" }), 400, "invalid_input");
  expectHttp(() => discoverShortlist({ service: " ", region: "Ohio" }), 400, "invalid_input");
  expectHttp(() => discoverShortlist({ service: "x", region: "Ohio" }), 400, "invalid_input");
  expectHttp(() => discoverShortlist({ service: "welding", region: "Narnia" }), 400, "invalid_region");
  expectHttp(() => discoverShortlist({ service: "welding", region: "XX" }), 400, "invalid_region");
  expectHttp(() => discoverShortlist({ service: "y".repeat(81), region: "Nevada" }), 400, "invalid_input");
  expectHttp(() => discoverShortlist({ service: "welding", region: "z".repeat(81) }), 400, "invalid_region");
  expectHttp(() => discoverShortlist({ service: "welding", region: { state: "Nevada" } }), 400, "invalid_region");
  const unknown = discoverShortlist({ service: "quilt restoration", region: "Ohio", mode: "example" });
  assert.equal(unknown.rows.length, 0);
  assert.match(unknown.message, /Nothing was invented/);
  assert.equal(unknown.paid_dataforseo_called, false);
  const missingExtract = discoverShortlist({ service: "welding", region: "Nevada" }, { extract: { places: {} }, loadExtract: null });
  assert.equal(missingExtract.rows.length, 0);
  assert.match(missingExtract.message, /Nothing was invented/);
});

test("locksmith stays a hard stop and the old example shortlist still runs when region is omitted", () => {
  for (const lens of ["classroom", "four_yes"]) {
    const report = discoverShortlist({ service: "emergency locksmith", region: "Nevada", lens, mode: "example" });
    assert.ok(report.rows.length >= 1);
    assert.ok(report.rows.every((row) => row.state === "Nevada"));
    assert.ok(report.rows.every((row) => row.lens_chip.verdict === "hard_stop"));
    assert.equal(report.paid_dataforseo_called, false);
  }
  const example = discoverShortlist({ service: "retaining wall replacement", mode: "example" });
  assert.equal(example.rows[0].city, "Bella Vista");
  assert.equal(example.rows[0].state, "Arkansas");
  const empty = discoverShortlist({ service: "quilt restoration", mode: "example" });
  assert.equal(empty.rows.length, 0);
});

test("the discover route filters by region and does not call DataForSEO", async () => {
  let fetches = 0;
  const app = createApp({
    env: { ...TEST_AUTH, DATAFORSEO_LIVE: "false" },
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("network");
    }
  });
  await withServer(app, async (port) => {
    const nevada = await postJson(port, "/api/discover", { service: "welding", region: "Nevada", mode: "example" });
    const body = await nevada.json();
    assert.equal(nevada.status, 200);
    assert.equal(body.paid_dataforseo_called, false);
    assert.ok(body.rows.length >= 2);
    assert.ok(body.rows.every((row) => row.state === "Nevada" && /weld/i.test(row.service)));
    const bad = await postJson(port, "/api/discover", { service: "welding", region: "Narnia", mode: "example" });
    const error = await bad.json();
    assert.equal(bad.status, 400);
    assert.equal(error.error, "invalid_region");
    assert.match(error.message, /Narnia/);
    const blank = await postJson(port, "/api/discover", { service: "", region: "Ohio" });
    assert.equal(blank.status, 400);
    assert.equal(fetches, 0);
    const page = fs.readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
    assert.match(page, /region/);
    assert.match(page, /disc-region/);
    assert.match(page, /timeoutMs:\s*20000/);
    assert.match(page, /The request did not complete/);
    assert.match(page, /The request timed out/);
  });
});

test("the bundled extract used by the shortlist has places in Nevada, Ohio, Arkansas, and Tennessee", () => {
  const extract = loadExtractCatalog();
  for (const usps of ["NV", "OH", "AR", "TN"]) {
    const count = Object.values(extract.places).filter((row) => row.st === usps && row.occ > 0).length;
    assert.ok(count > 10, usps);
  }
});
