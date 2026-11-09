import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { accessGranted, readSession, safeEqual, signSession } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { competitionIndex } from "../src/composite-score.js";
import { createExampleTransport } from "../src/example-transport.js";
import { liveCompetitionIndex } from "../src/live-market.js";
import { createLocationDirectory } from "../src/locations.js";
import { createSpendGuard, guardTransport, queryCostUsd } from "../src/spend.js";
import { confirmedFrom, postJson, sessionCookie, TEST_AUTH, withServer } from "./helpers.js";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");

test("access checks are constant-time and the session expires", () => {
  assert.equal(safeEqual("same-code", "same-code"), true);
  assert.equal(safeEqual("short", "a much longer access code"), false);
  const env = { ...TEST_AUTH };
  assert.equal(accessGranted(env, "Team@Centik.ai", TEST_AUTH.TEAM_ACCESS_CODE), true);
  assert.equal(accessGranted(env, "other@centik.ai", TEST_AUTH.TEAM_ACCESS_CODE), false);
  assert.equal(accessGranted(env, "team@centik.ai", "wrong-code"), false);
  assert.equal(accessGranted({ ALLOWED_EMAILS: "team@centik.ai" }, "team@centik.ai", ""), false);
  const token = signSession("team@centik.ai", TEST_AUTH.SESSION_SECRET, NOW);
  assert.equal(readSession(token, TEST_AUTH.SESSION_SECRET, NOW).email, "team@centik.ai");
  assert.equal(readSession(token, TEST_AUTH.SESSION_SECRET, NOW + (31 * 24 * 60 * 60 * 1000)), null);
  assert.equal(readSession(`${token}x`, TEST_AUTH.SESSION_SECRET, NOW), null);
});

test("login is required, rate limited, and does not put secrets in the client", async () => {
  const app = createApp({ env: { ...TEST_AUTH }, now: () => NOW });
  await withServer(app, async (port) => {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).live_mode, false);
    const home = await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual" });
    assert.equal(home.status, 302);
    assert.equal(home.headers.get("location"), "/login");
    const locked = await fetch(`http://127.0.0.1:${port}/api/spend`);
    assert.equal(locked.status, 401);
    const denied = await fetch(`http://127.0.0.1:${port}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "team@centik.ai", access_code: "nope" })
    });
    assert.equal(denied.status, 401);
    for (let attempt = 0; attempt < 7; attempt += 1) {
      await fetch(`http://127.0.0.1:${port}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "team@centik.ai", access_code: "nope" })
      });
    }
    const limited = await fetch(`http://127.0.0.1:${port}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "team@centik.ai", access_code: TEST_AUTH.TEAM_ACCESS_CODE })
    });
    assert.equal(limited.status, 429);
  });

  const open = createApp({ env: { ...TEST_AUTH }, now: () => NOW });
  await withServer(open, async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "team@centik.ai", access_code: TEST_AUTH.TEAM_ACCESS_CODE })
    });
    const cookie = response.headers.get("set-cookie") || "";
    assert.match(cookie, /centik_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    const spend = await fetch(`http://127.0.0.1:${port}/api/spend`, { headers: { cookie: cookie.split(";")[0] } });
    const totals = await spend.json();
    assert.equal(spend.status, 200);
    assert.equal(totals.budget_total_usd, 10);
    assert.equal(totals.budget_daily_usd, 5);
    assert.equal(totals.query_cost_usd, queryCostUsd());
  });

  const client = await Promise.all(["login.html", "login.js", "flow.js", "index.html"].map((name) => fs.readFile(path.join("public", name), "utf8")));
  const bundle = client.join("\n");
  assert.equal(bundle.includes("SESSION_SECRET"), false);
  assert.equal(bundle.includes("TEAM_ACCESS_CODE"), false);
  assert.equal(bundle.includes("DATAFORSEO_PASSWORD"), false);
  assert.equal(bundle.includes(TEST_AUTH.TEAM_ACCESS_CODE), false);
});

test("a live check uses Maps depth 100 and does not derive competition from demand", async () => {
  const example = createExampleTransport();
  const calls = [];
  const fetchImpl = async (url, init) => {
    const pathname = new URL(url).pathname;
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: pathname, body });
    const payload = await example.request({ method: init.method, path: pathname, body });
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
  };
  const app = createApp({
    env: {
      ...TEST_AUTH,
      DATAFORSEO_LIVE: "true",
      DATAFORSEO_LOGIN: "login-user",
      DATAFORSEO_PASSWORD: "test-password-value",
      BUDGET_USD_TOTAL: "10",
      BUDGET_USD_DAILY: "5"
    },
    now: () => NOW,
    fetchImpl,
    liveDirectory: createLocationDirectory(example)
  });
  await withServer(app, async (port) => {
    const resolved = await (await postJson(port, "/api/resolve", {
      mode: "live",
      city: "Austin",
      state: "Texas",
      country: "United States"
    })).json();
    const payload = {
      mode: "live",
      niche: "emergency plumber",
      city: "Austin",
      state: "Texas",
      country: "United States",
      margin_index: 36,
      confirmed: confirmedFrom(resolved)
    };
    const first = await (await postJson(port, "/api/validate", payload)).json();
    assert.equal(first.maps.requested_depth, 100);
    assert.equal(first.city_market.live, true);
    assert.equal(first.city_market.demand_label, "Live Google data");
    assert.equal(first.city_market.competition_label, "Live Google data");
    const mapsCall = calls.find((call) => call.path.endsWith("/maps/live/advanced"));
    const volumeCall = calls.find((call) => call.path.endsWith("/search_volume/live"));
    assert.equal(mapsCall.body[0].depth, 100);
    assert.ok(volumeCall);
    const derivedCount = Math.max(3, Math.round(28 - first.city_market.demand_index / 4));
    assert.notEqual(first.city_market.competition_index, competitionIndex(derivedCount));
    assert.notEqual(first.city_market.competition_index, competitionIndex(first.city_market.unique_listings));
    assert.equal(first.city_market.listings_without_website, first.city_market.unique_listings);
    assert.equal(first.live_composite.status, "calculated");
    assert.match(first.city_market.formula, /does not use|instead of/);
    const sent = calls.length;
    const second = await (await postJson(port, "/api/validate", payload)).json();
    assert.equal(calls.length, sent);
    assert.equal(second.live_composite.composite_display, first.live_composite.composite_display);
    const spend = await (await fetch(`http://127.0.0.1:${port}/api/spend`, { headers: { cookie: await sessionCookie(port) } })).json();
    assert.equal(spend.total_usd, 0.092);
    assert.equal(spend.calls.length, 2);
  });
});

test("the spend guard refuses a paid call at the budget and keeps location lists free", async () => {
  const example = createExampleTransport();
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    throw new Error("fetch should not run");
  };
  const app = createApp({
    env: {
      ...TEST_AUTH,
      DATAFORSEO_LIVE: "true",
      DATAFORSEO_LOGIN: "login-user",
      DATAFORSEO_PASSWORD: "test-password-value",
      BUDGET_USD_TOTAL: "0",
      BUDGET_USD_DAILY: "5"
    },
    now: () => NOW,
    fetchImpl,
    liveDirectory: createLocationDirectory(example)
  });
  await withServer(app, async (port) => {
    const resolved = await (await postJson(port, "/api/resolve", {
      mode: "live",
      city: "Austin",
      state: "Texas",
      country: "United States"
    })).json();
    const report = await (await postJson(port, "/api/validate", {
      mode: "live",
      niche: "emergency plumber",
      city: "Austin",
      state: "Texas",
      country: "United States",
      confirmed: confirmedFrom(resolved)
    })).json();
    assert.equal(fetches, 0);
    assert.equal(report.demand.sent_to_dataforseo, false);
    assert.equal(report.maps.sent_to_dataforseo, false);
    assert.equal(report.demand.error.code, "budget_exceeded");
  });

  const guard = createSpendGuard({ totalUsd: 10, dailyUsd: 5, now: () => NOW });
  let lookups = 0;
  const transport = guardTransport({
    request: async () => {
      lookups += 1;
      return { ok: true };
    }
  }, guard);
  await transport.request({ method: "GET", path: "/v3/serp/google/locations/us" });
  assert.equal(lookups, 1);
  assert.equal(guard.totals().calls.length, 0);
});

test("the ledger and the 7-day cache survive a new process when DATA_DIR is writable", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "centik-spend-"));
  const first = createSpendGuard({ dataDir, totalUsd: 10, dailyUsd: 5, now: () => NOW });
  const request = {
    method: "POST",
    path: "/v3/keywords_data/google_ads/search_volume/live",
    body: [{ keywords: ["emergency plumber"], location_code: 101 }]
  };
  let upstream = 0;
  const transport = guardTransport({
    request: async () => {
      upstream += 1;
      return { search_volume: 320 };
    }
  }, first);
  assert.deepEqual(await transport.request(request), { search_volume: 320 });
  assert.deepEqual(await transport.request(request), { search_volume: 320 });
  assert.equal(upstream, 1);
  const second = createSpendGuard({ dataDir, totalUsd: 10, dailyUsd: 5, now: () => NOW });
  await second.ready;
  assert.equal(second.totals().total_usd, 0.09);
  assert.deepEqual(await second.readCache(request), { search_volume: 320 });
});

test("the daily cap stops a second paid call", async () => {
  const guard = createSpendGuard({ totalUsd: 10, dailyUsd: 0.09, now: () => NOW });
  const transport = guardTransport({ request: async () => ({ ok: true }) }, guard);
  await transport.request({
    method: "POST",
    path: "/v3/keywords_data/google_ads/search_volume/live",
    body: [{ keywords: ["emergency plumber"], location_code: 1 }]
  });
  await assert.rejects(
    () => transport.request({
      method: "POST",
      path: "/v3/keywords_data/google_ads/search_volume/live",
      body: [{ keywords: ["drain cleaning"], location_code: 1 }]
    }),
    /budget/
  );
  assert.equal(guard.totals().daily_usd, 0.09);
  assert.equal(guard.totals().calls.length, 1);
});

test("live competition index uses listings, missing websites, and reviews", () => {
  const open = liveCompetitionIndex({ listings: 4, withoutWebsite: 3, averageReviews: 2 });
  const crowded = liveCompetitionIndex({ listings: 30, withoutWebsite: 0, averageReviews: 100 });
  assert.ok(open > crowded);
  assert.equal(liveCompetitionIndex({ listings: null, withoutWebsite: 0, averageReviews: 0 }), null);
  const derived = competitionIndex(Math.max(3, Math.round(28 - 80 / 4)));
  assert.notEqual(open, derived);
});
