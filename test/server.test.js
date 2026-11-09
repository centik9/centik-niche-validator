import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { HOST, VERSION } from "../src/config.js";
import { createExampleTransport } from "../src/example-transport.js";
import { postJson, sessionCookie, TEST_AUTH, withServer } from "./helpers.js";

async function resolveAndValidate(port, niche, place = { city: "Austin", state: "Texas", country: "United States" }, mode = "example") {
  const resolved = await postJson(port, "/api/resolve", { ...place, mode });
  const resolution = await resolved.json();
  const side = (match) => match ? {
    location_code: match.location_code,
    location_name: match.location_name,
    location_type: match.location_type
  } : null;
  const confirmed = {
    google_ads: side(resolution.google_ads.match),
    google_maps: side(resolution.google_maps.match)
  };
  let spend_token;
  if (mode === "live") {
    const quoted = await postJson(port, "/api/quote", { mode, niche, ...place, confirmed });
    const quote = await quoted.json();
    spend_token = quote.spend_token;
  }
  const response = await postJson(port, "/api/validate", {
    mode,
    niche,
    ...place,
    spend_token,
    confirmed
  });
  return { status: response.status, body: await response.json(), resolution };
}

test("health, static page, and example validation stay local", async () => {
  assert.equal(HOST, "0.0.0.0");
  let fetches = 0;
  const app = createApp({
    env: { ...TEST_AUTH, },
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("network");
    }
  });
  await withServer(app, async (port) => {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    const healthBody = await health.json();
    assert.equal(health.status, 200);
    assert.equal(healthBody.ok, true);
    assert.equal(healthBody.service, "centik-niche-validator");
    assert.equal(healthBody.version, VERSION);
    assert.equal(healthBody.live_mode, false);
    assert.equal(healthBody.credentials_configured, false);
    const head = await fetch(`http://127.0.0.1:${port}/health`, { method: "HEAD" });
    assert.equal(head.status, 200);
    const page = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie: await sessionCookie(port) } });
    const html = await page.text();
    assert.match(html, /id="keyword"/);
    assert.equal(html.includes('id="city"'), false);
    assert.match(html, /Example data only/);
    const favicon = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    assert.equal(favicon.status, 204);
    const locked = await fetch(`http://127.0.0.1:${port}/nope`, { redirect: "manual" });
    assert.equal(locked.status, 302);
    const missing = await fetch(`http://127.0.0.1:${port}/nope`, { headers: { cookie: await sessionCookie(port) } });
    assert.equal(missing.status, 404);
    const report = await resolveAndValidate(port, "emergency plumber");
    assert.equal(report.status, 200);
    assert.equal(report.body.data_origin, "example");
    assert.equal(report.body.score.overall_display, "79.6");
    assert.match(report.body.example_banner, /Not a real market measurement/);
    assert.equal(fetches, 0);
  });
});

test("live mode is exact and does not substitute example data", async () => {
  let fetches = 0;
  const off = createApp({
    env: { ...TEST_AUTH,  DATAFORSEO_LIVE: "TRUE", DATAFORSEO_LOGIN: "login-user", DATAFORSEO_PASSWORD: "test-password-value" },
    fetchImpl: async () => { fetches += 1; throw new Error("network"); }
  });
  await withServer(off, async (port) => {
    const response = await postJson(port, "/api/resolve", { mode: "live", city: "Austin", state: "Texas", country: "United States" });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error, "live_mode_disabled");
    assert.match(body.message, /not substituted/);
    assert.equal(fetches, 0);
  });

  const missingCreds = createApp({
    env: { ...TEST_AUTH,  DATAFORSEO_LIVE: "true" },
    fetchImpl: async () => { fetches += 1; throw new Error("network"); }
  });
  await withServer(missingCreds, async (port) => {
    const response = await postJson(port, "/api/validate", {
      mode: "live",
      niche: "emergency plumber",
      city: "Austin",
      state: "Texas",
      country: "United States",
      confirmed: { google_ads: null, google_maps: null }
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "spend_not_confirmed");
    assert.equal(fetches, 0);
  });
});

test("opted-in example requests still do not touch the network", async () => {
  let fetches = 0;
  const app = createApp({
    env: { ...TEST_AUTH,  DATAFORSEO_LIVE: "true", DATAFORSEO_LOGIN: "login-user", DATAFORSEO_PASSWORD: "test-password-value" },
    fetchImpl: async () => { fetches += 1; throw new Error("network"); }
  });
  await withServer(app, async (port) => {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.live_mode, true);
    assert.equal(health.credentials_configured, true);
    assert.equal(JSON.stringify(health).includes("test-password-value"), false);
    const report = await resolveAndValidate(port, "missing volume");
    assert.equal(report.body.data_origin, "example");
    assert.equal(report.body.score.overall, null);
    assert.equal(fetches, 0);
  });
});

test("live opt-in uses the injected transport and product-specific codes", async () => {
  const calls = [];
  const base = createExampleTransport();
  const app = createApp({
    env: { ...TEST_AUTH,  DATAFORSEO_LIVE: "true", DATAFORSEO_LOGIN: "login-user", DATAFORSEO_PASSWORD: "test-password-value", DATAFORSEO_SPENT_BASELINE_USD: "0" },
    liveTransport: {
      async request(args) {
        calls.push(args);
        return base.request(args);
      }
    },
    fetchImpl: async () => { throw new Error("real fetch"); }
  });
  await withServer(app, async (port) => {
    const report = await resolveAndValidate(port, "emergency plumber", { city: "Austin", state: "Texas", country: "United States" }, "live");
    assert.equal(report.status, 200);
    assert.equal(report.body.data_origin, "live");
    assert.equal(report.body.example_banner, null);
    assert.equal(report.body.market_measurement.buyers_verified, false);
    assert.equal(report.body.market_measurement.exhaustive_market, false);
    const posts = calls.filter((call) => call.method === "POST");
    assert.equal(posts.length, 2);
    assert.equal(posts.every((call) => call.body[0].location_code > 9000000), true);
    assert.notEqual(posts[0].body[0].location_code, posts[1].body[0].location_code);
  });
});

test("validation, rate limit, and body size failures stay local", async () => {
  const app = createApp({
    env: { ...TEST_AUTH, },
    maxBodyBytes: 180,
    rateLimits: { api: { windowMs: 60_000, max: 3 }, live: { windowMs: 60_000, max: 1 }, globalLive: { windowMs: 60_000, max: 1 } },
    now: () => 1_700_000_000_000
  });
  await withServer(app, async (port) => {
    const bad = await postJson(port, "/api/validate", { niche: "ok", city: "Austin", state: "Texas", country: "England" });
    assert.equal(bad.status, 400);
    const huge = await fetch(`http://127.0.0.1:${port}/api/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie: await sessionCookie(port) },
      body: JSON.stringify({ city: "Austin", state: "Texas", country: "United States", padding: "x".repeat(400) })
    });
    assert.equal(huge.status, 413);
    const one = await postJson(port, "/api/resolve", { city: "Austin", state: "Texas", country: "United States" });
    assert.equal(one.status, 200);
    const two = await postJson(port, "/api/resolve", { city: "Austin", state: "Texas", country: "United States" });
    assert.equal(two.status, 429);
    const limited = await two.json();
    assert.equal(limited.error, "rate_limited");
    assert.ok(two.headers.get("retry-after"));
  });
});

test("unexpected errors are redacted", async () => {
  const logs = [];
  const app = createApp({
    env: { ...TEST_AUTH,  DATAFORSEO_PASSWORD: "test-password-value", DATAFORSEO_LOGIN: "login-user" },
    logger: { error(message) { logs.push(message); } },
    validateImpl: async () => {
      throw new Error("boom test-password-value Authorization: Basic dGVzdA==");
    }
  });
  await withServer(app, async (port) => {
    const response = await postJson(port, "/api/validate", {
      niche: "emergency plumber",
      city: "Austin",
      state: "Texas",
      country: "United States",
      confirmed: {
        google_ads: { location_code: 1, location_name: "Austin,Texas,United States", location_type: "City" },
        google_maps: { location_code: 2, location_name: "Austin,Texas,United States", location_type: "City" }
      }
    });
    const body = await response.json();
    assert.equal(response.status, 500);
    assert.equal(JSON.stringify(body).includes("test-password-value"), false);
    assert.equal(logs.join("\n").includes("test-password-value"), false);
    assert.match(logs.join("\n"), /Basic \[redacted\]/);
  });
});

test("Springfield and Portland stay in the states that were asked for", async () => {
  const app = createApp({ env: { ...TEST_AUTH, } });
  await withServer(app, async (port) => {
    const illinois = await (await postJson(port, "/api/resolve", { city: "Springfield", state: "Illinois", country: "United States" })).json();
    const missouri = await (await postJson(port, "/api/resolve", { city: "Springfield", state: "Missouri", country: "United States" })).json();
    assert.equal(illinois.google_ads.match.location_name, "Springfield,Illinois,United States");
    assert.equal(missouri.google_ads.match.location_name, "Springfield,Missouri,United States");
    assert.notEqual(illinois.google_ads.match.location_code, missouri.google_ads.match.location_code);
    const maine = await (await postJson(port, "/api/resolve", { city: "Portland", state: "Maine", country: "United States" })).json();
    assert.equal(maine.google_maps.match.location_name, "Portland,Maine,United States");
    assert.deepEqual(maine.google_maps.same_city_other_regions, ["Oregon"]);
  });
});
