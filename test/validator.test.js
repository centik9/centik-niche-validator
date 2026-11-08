import assert from "node:assert/strict";
import test from "node:test";
import { DataForSeoError } from "../src/errors.js";
import { createExampleTransport } from "../src/example-transport.js";
import { HttpError } from "../src/errors.js";
import { parseDemandPayload } from "../src/demand.js";
import { resolveLocation, validateNiche } from "../src/validator.js";
import { confirmedFrom, exampleDeps } from "./helpers.js";

test("a stale or top-level location code cannot redirect the query", async () => {
  const calls = [];
  const base = createExampleTransport();
  const transport = {
    async request(args) {
      calls.push(`${args.method} ${args.path}`);
      return base.request(args);
    }
  };
  const deps = exampleDeps(transport);
  await assert.rejects(
    () => validateNiche({
      niche: "emergency plumber",
      city: "Austin",
      state: "Texas",
      country: "United States",
      location_code: 2840,
      confirmed: {
        google_ads: { location_code: 2840, location_name: "United States", location_type: "Country" },
        google_maps: { location_code: 2840, location_name: "United States", location_type: "Country" }
      }
    }, deps),
    (error) => error instanceof HttpError && error.status === 409
  );
  assert.equal(calls.some((call) => call.startsWith("POST")), false);
});

test("confirmation uses the product-specific code, ignoring a client country code", async () => {
  const calls = [];
  const base = createExampleTransport();
  const transport = {
    async request(args) {
      calls.push(args);
      return base.request(args);
    }
  };
  const deps = exampleDeps(transport);
  const resolution = await resolveLocation({ city: "Austin", state: "TX", country: "United States" }, deps);
  const report = await validateNiche({
    niche: "emergency plumber",
    city: "Austin",
    state: "TX",
    country: "United States",
    location_code: 2840,
    confirmed: confirmedFrom(resolution)
  }, deps);
  const volume = calls.find((call) => call.path.endsWith("/search_volume/live"));
  const maps = calls.find((call) => call.path.endsWith("/maps/live/advanced"));
  assert.equal(volume.body[0].location_code, resolution.google_ads.match.location_code);
  assert.equal(maps.body[0].location_code, resolution.google_maps.match.location_code);
  assert.notEqual(volume.body[0].location_code, maps.body[0].location_code);
  assert.equal(volume.body[0].search_partners, false);
  assert.equal(maps.body[0].depth, 20);
  assert.equal(maps.body[0].search_this_area, true);
  assert.equal(report.normalized_query.state_normalized, "texas");
  assert.equal(report.generated_at, "2026-01-15T00:00:00.000Z");
});

test("ambiguous and unconfirmed resolutions do not request volume or maps", async () => {
  const posts = [];
  const directory = {
    async list() {
      return {
        cache: "miss",
        rows: [
          { location_code: 1, location_name: "Texas,United States", location_code_parent: null, country_iso_code: "US", location_type: "State" },
          { location_code: 2, location_name: "Austin,Texas,United States", location_code_parent: 1, country_iso_code: "US", location_type: "City" },
          { location_code: 3, location_name: "Austin,Texas,United States", location_code_parent: 1, country_iso_code: "US", location_type: "City" }
        ]
      };
    }
  };
  const deps = {
    ...exampleDeps(),
    directory,
    transport: { async request(args) { posts.push(args.path); return {}; } }
  };
  const resolution = await resolveLocation({ city: "Austin", state: "Texas", country: "US" }, deps);
  assert.equal(resolution.outcome, "ambiguous");
  await assert.rejects(() => validateNiche({
    niche: "emergency plumber",
    city: "Austin",
    state: "Texas",
    country: "US",
    confirmed: { google_ads: null, google_maps: null }
  }, deps), (error) => error.code === "not_confirmed");
  assert.deepEqual(posts, []);
});

test("a failed maps location list does not send the maps query", async () => {
  const base = createExampleTransport();
  const paths = [];
  const transport = {
    async request(args) {
      paths.push(args.path);
      if (args.path.includes("/serp/google/locations/")) throw new DataForSeoError("timeout", "list down");
      return base.request(args);
    }
  };
  const deps = exampleDeps(transport);
  const resolution = await resolveLocation({ city: "Austin", state: "Texas", country: "United States" }, deps);
  assert.equal(resolution.outcome, "partial_failure");
  const report = await validateNiche({
    niche: "emergency plumber",
    city: "Austin",
    state: "Texas",
    country: "United States",
    confirmed: confirmedFrom(resolution)
  }, deps);
  assert.equal(report.maps.status, "failed");
  assert.equal(report.maps.sent_to_dataforseo, false);
  assert.equal(report.demand.search_volume.status, "measured");
  assert.equal(report.score.overall, null);
  assert.equal(paths.some((path) => path.includes("/maps/live/")), false);
});

test("non-integer search volume is unusable rather than banded", () => {
  const report = parseDemandPayload({
    status_code: 20000,
    tasks: [{
      status_code: 20000,
      cost: 0.05,
      result: [{
        keyword: "niche",
        spell: null,
        search_volume: 10.5,
        cpc: null,
        competition: null,
        competition_index: null,
        monthly_searches: null
      }]
    }]
  }, { keyword: "niche", location: null, sentToDataForSeo: true, redact: (value) => value });
  assert.equal(report.search_volume.status, "unusable");
  assert.equal(report.provider_reported_cost_usd.value, 0.05);
  assert.equal(report.provider_reported_cost_usd.note.includes("Not revenue"), true);
});
