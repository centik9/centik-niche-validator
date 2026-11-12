import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createExampleTransport } from "../src/example-transport.js";
import { postJson, sessionCookie, TEST_AUTH, withServer } from "./helpers.js";

const PLACE = { city: "Bella Vista", state: "Arkansas", country: "United States" };
const NICHE = "Retaining wall repair";

const LIVE_ADS = [
  { location_code: 2840, location_name: "United States", location_code_parent: null, country_iso_code: "US", location_type: "Country" },
  { location_code: 21167, location_name: "Arkansas,United States", location_code_parent: 2840, country_iso_code: "US", location_type: "State" },
  { location_code: 5012345, location_name: "Bella Vista,Arkansas,United States", location_code_parent: 21167, country_iso_code: "US", location_type: "City" }
];

function envelope(result) {
  return {
    version: "test",
    status_code: 20000,
    status_message: "Ok.",
    tasks_count: 1,
    tasks_error: 0,
    tasks: [{
      status_code: 20000,
      status_message: "Ok.",
      cost: 0,
      result_count: Array.isArray(result) ? result.length : 0,
      result
    }]
  };
}

function shiftRows(shift) {
  return LIVE_ADS.map((row) => ({
    ...row,
    location_code: row.location_code + shift,
    location_code_parent: row.location_code_parent == null ? null : row.location_code_parent + shift
  }));
}

function side(match) {
  return match ? {
    location_code: match.location_code,
    location_name: match.location_name,
    location_type: match.location_type
  } : null;
}

function paidPosts(calls) {
  return calls.filter((call) => call.method === "POST" && /search_volume|maps\/live|organic\/live|trends\/explore/.test(call.path));
}

test("the dashboard quotes the same location mode the paid check will confirm", () => {
  const source = fs.readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  assert.match(source, /mode: liveMode \? "live" : "example"/);
  assert.match(source, /if \(!resolved\.can_validate\)/);
  assert.match(source, /A paid check was not quoted/);
});

test("example location codes for a typed city 409 on live validate and do not spend", async () => {
  const calls = [];
  let fetches = 0;
  const example = createExampleTransport();
  const app = createApp({
    env: {
      ...TEST_AUTH,
      DATAFORSEO_LIVE: "true",
      DATAFORSEO_LOGIN: "login-user",
      DATAFORSEO_PASSWORD: "test-password-value",
      DATAFORSEO_SPENT_BASELINE_USD: "0"
    },
    liveTransport: {
      async request(args) {
        calls.push(args);
        if (args.method === "GET" && /\/locations\/[a-z]{2}$/.test(args.path)) {
          const shift = args.path.includes("google_ads") ? 0 : 100000;
          return envelope(shiftRows(shift));
        }
        return example.request(args);
      }
    },
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("real DataForSEO fetch");
    },
    rateLimits: {
      live: { windowMs: 60_000, max: 20 },
      globalLive: { windowMs: 60_000, max: 20 }
    }
  });
  await withServer(app, async (port) => {
    const exampleResolved = await (await postJson(port, "/api/resolve", { mode: "example", ...PLACE })).json();
    assert.equal(exampleResolved.can_validate, true);
    assert.equal(exampleResolved.google_ads.match.location_name, "Bella Vista,Arkansas,United States");
    const exampleConfirmed = {
      google_ads: side(exampleResolved.google_ads.match),
      google_maps: side(exampleResolved.google_maps.match)
    };
    assert.notEqual(exampleConfirmed.google_ads.location_code, 5012345);

    const quoted = await (await postJson(port, "/api/quote", {
      mode: "live",
      niche: NICHE,
      ...PLACE,
      geography_type: "city",
      confirmed: exampleConfirmed
    })).json();
    assert.equal(quoted.estimated_cost_usd, 0.105);
    const before = calls.length;
    const denied = await postJson(port, "/api/validate", {
      mode: "live",
      niche: NICHE,
      ...PLACE,
      geography_type: "city",
      spend_token: quoted.spend_token,
      confirmed: exampleConfirmed
    });
    const body = await denied.json();
    assert.equal(denied.status, 409);
    assert.equal(body.error, "confirmation_mismatch");
    assert.match(body.message, /Search volume and Maps were not requested/);
    assert.equal(paidPosts(calls.slice(before)).length, 0);

    const unresolved = await (await postJson(port, "/api/resolve", {
      mode: "live",
      city: "Grass Valley",
      state: "California",
      country: "United States"
    })).json();
    assert.equal(unresolved.can_validate, false);
    assert.match(unresolved.block_message, /No confirmed city row/);
    const emptyQuote = await (await postJson(port, "/api/quote", {
      mode: "live",
      niche: NICHE,
      city: "Grass Valley",
      state: "California",
      country: "United States",
      geography_type: "city",
      confirmed: { google_ads: null, google_maps: null }
    })).json();
    const emptyDenied = await postJson(port, "/api/validate", {
      mode: "live",
      niche: NICHE,
      city: "Grass Valley",
      state: "California",
      country: "United States",
      geography_type: "city",
      spend_token: emptyQuote.spend_token,
      confirmed: { google_ads: null, google_maps: null }
    });
    const emptyBody = await emptyDenied.json();
    assert.equal(emptyDenied.status, 409);
    assert.equal(emptyBody.error, "not_confirmed");
    assert.match(emptyBody.message, /No confirmed city row/);
    assert.equal(paidPosts(calls).length, 0);
    const spent = await (await fetch(`http://127.0.0.1:${port}/api/spend`, {
      headers: { cookie: await sessionCookie(port) }
    })).json();
    assert.equal(spent.spent_usd, 0);
    assert.equal(fetches, 0);
  });
});

test("a typed city confirmed with the live location list completes the paid check", async () => {
  const calls = [];
  let fetches = 0;
  const example = createExampleTransport();
  const app = createApp({
    env: {
      ...TEST_AUTH,
      DATAFORSEO_LIVE: "true",
      DATAFORSEO_LOGIN: "login-user",
      DATAFORSEO_PASSWORD: "test-password-value",
      DATAFORSEO_SPENT_BASELINE_USD: "0"
    },
    liveTransport: {
      async request(args) {
        calls.push(args);
        if (args.method === "GET" && /\/locations\/[a-z]{2}$/.test(args.path)) {
          const shift = args.path.includes("google_ads") ? 0 : 100000;
          return envelope(shiftRows(shift));
        }
        return example.request(args);
      }
    },
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("real DataForSEO fetch");
    },
    rateLimits: {
      live: { windowMs: 60_000, max: 20 },
      globalLive: { windowMs: 60_000, max: 20 }
    }
  });
  await withServer(app, async (port) => {
    const resolved = await (await postJson(port, "/api/resolve", { mode: "live", ...PLACE })).json();
    assert.equal(resolved.can_validate, true);
    assert.equal(resolved.outcome, "matched");
    assert.equal(resolved.block_message, null);
    assert.equal(resolved.google_ads.match.location_code, 5012345);
    assert.equal(resolved.google_maps.match.location_code, 5112345);
    assert.equal(resolved.requests.every((item) => item.billable_when_live === false), true);
    const confirmed = {
      google_ads: side(resolved.google_ads.match),
      google_maps: side(resolved.google_maps.match)
    };
    const quoted = await (await postJson(port, "/api/quote", {
      mode: "live",
      niche: NICHE,
      ...PLACE,
      geography_type: "city",
      confirmed
    })).json();
    assert.equal(quoted.market, "Bella Vista, Arkansas");
    assert.equal(quoted.estimated_cost_usd, 0.105);
    assert.equal(quoted.calls.find((call) => call.path.endsWith("/maps/live/advanced")).depth, 100);
    const validated = await postJson(port, "/api/validate", {
      mode: "live",
      niche: NICHE,
      ...PLACE,
      geography_type: "city",
      spend_token: quoted.spend_token,
      confirmed
    });
    const report = await validated.json();
    assert.equal(validated.status, 200, report.message || report.error);
    assert.equal(report.data_origin, "live");
    const posts = paidPosts(calls);
    assert.equal(posts.length, 4);
    const volume = posts.find((call) => call.path.endsWith("/search_volume/live"));
    const maps = posts.find((call) => call.path.endsWith("/maps/live/advanced"));
    assert.equal(volume.body[0].location_code, 5012345);
    assert.equal(maps.body[0].location_code, 5112345);
    assert.equal(maps.body[0].depth, 100);
    assert.equal(fetches, 0);
  });
});
