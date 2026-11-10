import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { accessGranted, hashAccessCode, readSession, safeEqual, signSession, verifyAccessCode } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { competitionIndex } from "../src/composite-score.js";
import { createExampleTransport } from "../src/example-transport.js";
import { LISTING_ROOM_CAP, liveCompetitionIndex } from "../src/live-market.js";
import { nearbyPlaces } from "../src/nearby.js";
import { createLocationDirectory } from "../src/locations.js";
import { accountSpentUsd, createSpendGate, QUERY_COST_USD } from "../src/spend.js";
import { confirmedFrom, postJson, sessionCookie, TEST_AUTH, TEST_CODE, withServer } from "./helpers.js";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");

test("the access-code script prints a scrypt hash and does not echo the code", async () => {
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, ["scripts/hash-access-code.mjs"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (chunk) => { out += chunk; });
  child.stdin.end("preview-check\n");
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(code, 0);
  assert.match(out, /^scrypt\$16384\$8\$1\$[0-9a-f]+\$[0-9a-f]+\n$/);
  assert.equal(out.includes("preview-check"), false);
  assert.equal(verifyAccessCode("preview-check", out.trim()), true);
});

test("access checks are constant-time and the session expires", () => {
  assert.equal(safeEqual("same-code", "same-code"), true);
  assert.equal(safeEqual("short", "a much longer access code"), false);
  const env = { ...TEST_AUTH };
  assert.equal(verifyAccessCode(TEST_CODE, hashAccessCode(TEST_CODE)), true);
  assert.equal(verifyAccessCode("wrong-code", env.TEAM_ACCESS_CODE_HASH), false);
  assert.equal(accessGranted(env, "Team@Centik.ai", TEST_CODE), true);
  assert.equal(accessGranted(env, "other@centik.ai", TEST_CODE), false);
  assert.equal(accessGranted(env, "team@centik.ai", "wrong-code"), false);
  assert.equal(accessGranted({ ALLOWED_EMAILS: "team@centik.ai" }, "team@centik.ai", TEST_CODE), false);
  const token = signSession("team@centik.ai", TEST_AUTH.SESSION_SECRET, NOW);
  assert.equal(readSession(token, TEST_AUTH.SESSION_SECRET, NOW).email, "team@centik.ai");
  assert.equal(readSession(token, TEST_AUTH.SESSION_SECRET, NOW + (12 * 60 * 60 * 1000)), null);
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
      body: JSON.stringify({ email: "team@centik.ai", access_code: TEST_CODE })
    });
    assert.equal(limited.status, 429);
  });

  const open = createApp({ env: { ...TEST_AUTH }, now: () => NOW });
  await withServer(open, async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "team@centik.ai", access_code: TEST_CODE })
    });
    const cookie = response.headers.get("set-cookie") || "";
    assert.match(cookie, /centik_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    const spend = await fetch(`http://127.0.0.1:${port}/api/spend`, { headers: { cookie: cookie.split(";")[0] } });
    const totals = await spend.json();
    assert.equal(spend.status, 200);
    assert.equal(totals.cap_usd, 10);
    assert.equal(totals.remaining_usd, 10);
    assert.equal(totals.query_cost_usd, QUERY_COST_USD);
  });

  const client = await Promise.all(["login.html", "login.js", "flow.js", "index.html"].map((name) => fs.readFile(path.join("public", name), "utf8")));
  const bundle = client.join("\n");
  assert.equal(bundle.includes("SESSION_SECRET"), false);
  assert.equal(bundle.includes("TEAM_ACCESS_CODE"), false);
  assert.equal(bundle.includes("DATAFORSEO_PASSWORD"), false);
  assert.equal(bundle.includes(TEST_CODE), false);
});

test("a signed-in session can load the heat map and cannot load a preview seed", async () => {
  const app = createApp({ env: { ...TEST_AUTH }, now: () => NOW });
  await withServer(app, async (port) => {
    const locked = await fetch(`http://127.0.0.1:${port}/us-heat-map.js`, { redirect: "manual" });
    assert.equal(locked.status, 302);
    assert.equal(locked.headers.get("location"), "/login");
    const cookie = await sessionCookie(port);
    const map = await fetch(`http://127.0.0.1:${port}/us-heat-map.js`, { headers: { cookie } });
    assert.equal(map.status, 200);
    assert.match(map.headers.get("content-type") || "", /javascript/);
    const body = await map.text();
    assert.match(body, /window\.US_HEAT_MAP/);
    assert.equal(body.includes("preview-seed"), false);
    const seed = await fetch(`http://127.0.0.1:${port}/preview-seed.json`, { headers: { cookie } });
    assert.equal(seed.status, 404);
    const dashboard = await fetch(`http://127.0.0.1:${port}/dashboard.js`);
    assert.equal(dashboard.status, 200);
    const script = await dashboard.text();
    assert.equal(script.includes("preview-seed"), false);
    assert.equal(script.includes("est-rate-note"), true);
    assert.equal(script.includes("\u2014"), false);
    assert.equal(script.includes("\u2013"), false);
  });
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
      SPEND_CAP_USD: "10",
      DATAFORSEO_SPENT_BASELINE_USD: "0"
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
    const quoted = await (await postJson(port, "/api/quote", payload)).json();
    assert.equal(quoted.estimated_cost_usd, QUERY_COST_USD);
    assert.equal(quoted.calls.length, 4);
    assert.equal(quoted.calls.reduce((sum, call) => sum + Math.round(call.estimated_cost_usd * 1000), 0), 105);
    const firstResponse = await postJson(port, "/api/validate", { ...payload, spend_token: quoted.spend_token });
    const first = await firstResponse.json();
    assert.equal(firstResponse.status, 200);
    assert.equal(first.maps.requested_depth, 100);
    assert.equal(quoted.estimated_cost_usd, 0.105);
    assert.equal(quoted.calls.find((call) => call.path.endsWith("/maps/live/advanced")).depth, 100);
    assert.equal(quoted.calls.find((call) => call.path.endsWith("/maps/live/advanced")).estimated_cost_usd, 0.002);
    assert.equal(first.city_market.live, true);
    assert.equal(first.city_market.demand_label, "Live Google data");
    assert.equal(first.city_market.competition_label, "Live Google data");
    const mapsCall = calls.find((call) => call.path.endsWith("/maps/live/advanced"));
    const volumeCall = calls.find((call) => call.path.endsWith("/search_volume/live"));
    assert.equal(mapsCall.body[0].depth, 100);
    assert.ok(volumeCall);
    assert.ok(volumeCall.body[0].keywords.length > 1);
    assert.equal(volumeCall.body[0].keywords[0], "emergency plumber");
    const organicCall = calls.find((call) => call.path.endsWith("/organic/live/advanced"));
    const trendsCall = calls.find((call) => call.path.endsWith("/google_trends/explore/live"));
    assert.equal(organicCall.body[0].depth, 10);
    assert.equal(organicCall.body[0].keyword, "emergency plumber");
    assert.equal(Object.hasOwn(organicCall.body[0], "load_async_ai_overview"), false);
    assert.deepEqual(trendsCall.body[0].keywords, ["emergency plumber"]);
    assert.equal(trendsCall.body[0].time_range, "past_12_months");
    const derivedCount = Math.max(3, Math.round(28 - first.city_market.demand_index / 4));
    assert.notEqual(first.city_market.competition_index, competitionIndex(derivedCount));
    assert.notEqual(first.city_market.competition_index, competitionIndex(first.city_market.unique_listings));
    assert.equal(first.city_market.listings_without_website, first.city_market.unique_listings);
    assert.equal(first.live_composite.status, "calculated");
    assert.match(first.city_market.formula, /does not use|instead of/);
    const sent = calls.filter((call) => call.method === "POST").length;
    const again = await (await postJson(port, "/api/quote", payload)).json();
    assert.equal(again.cache_hit, true);
    assert.equal(again.estimated_cost_usd, 0);
    const second = await (await postJson(port, "/api/validate", { ...payload, spend_token: again.spend_token })).json();
    assert.equal(calls.filter((call) => call.method === "POST").length, sent);
    assert.equal(second.live_composite.composite_display, first.live_composite.composite_display);
    const reused = await postJson(port, "/api/validate", { ...payload, spend_token: quoted.spend_token });
    assert.equal(reused.status, 403);
    assert.equal((await reused.json()).error, "spend_not_confirmed");
    assert.equal(calls.filter((call) => call.method === "POST").length, sent);
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
      DATAFORSEO_SPENT_BASELINE_USD: "0",
      SPEND_CAP_USD: "0"
    },
    now: () => NOW,
    readAccountSpent: async () => 0,
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
    const bare = await postJson(port, "/api/validate", {
      mode: "live",
      niche: "emergency plumber",
      city: "Austin",
      state: "Texas",
      country: "United States",
      confirmed: confirmedFrom(resolved)
    });
    assert.equal(bare.status, 403);
    assert.equal((await bare.json()).error, "spend_not_confirmed");
    const quoted = await postJson(port, "/api/quote", {
      mode: "live",
      niche: "emergency plumber",
      city: "Austin",
      state: "Texas",
      country: "United States",
      confirmed: confirmedFrom(resolved)
    });
    assert.equal(quoted.status, 403);
    assert.equal((await quoted.json()).error, "spend_cap_exceeded");
    assert.equal(fetches, 0);
  });
});

test("a spend token is rejected when it is signed badly, expired, or for another request", async () => {
  const example = createExampleTransport();
  let fetches = 0;
  const app = createApp({
    env: {
      ...TEST_AUTH,
      DATAFORSEO_LIVE: "true",
      DATAFORSEO_LOGIN: "login-user",
      DATAFORSEO_PASSWORD: "test-password-value",
      DATAFORSEO_SPENT_BASELINE_USD: "0"
    },
    now: () => NOW,
    readAccountSpent: async () => 0,
    fetchImpl: async () => { fetches += 1; throw new Error("fetch should not run"); },
    liveDirectory: createLocationDirectory(example),
    ledgerPath: path.join(os.tmpdir(), `centik-spend-${Date.now()}.json`)
  });
  await withServer(app, async (port) => {
    const resolved = await (await postJson(port, "/api/resolve", {
      mode: "live", city: "Austin", state: "Texas", country: "United States"
    })).json();
    const payload = {
      mode: "live",
      niche: "emergency plumber",
      city: "Austin",
      state: "Texas",
      country: "United States",
      confirmed: confirmedFrom(resolved)
    };
    const bad = await postJson(port, "/api/validate", { ...payload, spend_token: "not-a-token" });
    assert.equal(bad.status, 403);
    const quoted = await (await postJson(port, "/api/quote", payload)).json();
    const other = await postJson(port, "/api/validate", { ...payload, niche: "drain cleaning", spend_token: quoted.spend_token });
    assert.equal(other.status, 403);
    assert.equal((await other.json()).error, "spend_not_confirmed");
    const later = createApp({
      env: app.env || {
        ...TEST_AUTH,
        DATAFORSEO_LIVE: "true",
        DATAFORSEO_LOGIN: "login-user",
        DATAFORSEO_PASSWORD: "test-password-value",
        DATAFORSEO_SPENT_BASELINE_USD: "0"
      },
      readAccountSpent: async () => 0,
      now: () => NOW + 6 * 60 * 1000,
      fetchImpl: async () => { fetches += 1; throw new Error("fetch should not run"); },
      liveDirectory: createLocationDirectory(example)
    });
    await withServer(later, async (laterPort) => {
      const expired = await postJson(laterPort, "/api/validate", { ...payload, spend_token: quoted.spend_token });
      assert.equal(expired.status, 403);
      assert.equal((await expired.json()).error, "spend_not_confirmed");
    });
    assert.equal(fetches, 0);
  });
});

test("account spend uses total minus balance when total_spent is absent", async () => {
  const onlyBalance = { tasks: [{ result: [{ money: { total: 10, balance: 8.82855 } }] }] };
  assert.equal(accountSpentUsd(onlyBalance), 1.17145);
  assert.equal(accountSpentUsd({ tasks: [{ result: [{ money: { total_spent: 1.171449 } }] }] }), 1.17145);
  assert.equal(accountSpentUsd({ tasks: [{ result: [{ money: { total: 10 } }] }] }), null);
  assert.equal(accountSpentUsd({ tasks: [{ result: [{ money: { balance: 1 } }] }] }), null);
  assert.equal(accountSpentUsd({ tasks: [{ result: [{ money: { total: "10", balance: 1 } }] }] }), null);
  const prepared = {
    niche: "emergency plumber",
    city: "Austin",
    state: "Texas",
    countryCanonical: "United States",
    confirmed: { google_ads: { location_code: 1 }, google_maps: { location_code: 2 } }
  };
  const derived = createSpendGate({
    capUsd: 10,
    tokenSecret: "secret",
    baselineUsd: 1.17145,
    now: () => NOW,
    readAccountSpent: async () => onlyBalance
  });
  const quoted = await derived.quote("team@centik.ai", prepared, { requireAccount: true });
  assert.equal(quoted.account_total_spent_usd, 1.17145);
  assert.equal(quoted.spent_usd, 0);
  const missingFields = createSpendGate({
    capUsd: 10,
    tokenSecret: "secret",
    baselineUsd: 1.17145,
    now: () => NOW,
    readAccountSpent: async () => ({ tasks: [{ result: [{ money: { total: 2 } }] }] })
  });
  await assert.rejects(() => missingFields.quote("team@centik.ai", prepared, { requireAccount: true }), /missing or below/);
});

test("the account baseline caps live spend and fails closed", async () => {
  const prepared = {
    niche: "emergency plumber",
    city: "Austin",
    state: "Texas",
    countryCanonical: "United States",
    confirmed: { google_ads: { location_code: 1 }, google_maps: { location_code: 2 } }
  };
  const missing = createSpendGate({ capUsd: 10, tokenSecret: "secret", baselineUsd: null, now: () => NOW });
  await assert.rejects(() => missing.quote("team@centik.ai", prepared, { requireAccount: true }), /BASELINE/);
  let reads = 0;
  const broken = createSpendGate({
    capUsd: 10,
    tokenSecret: "secret",
    baselineUsd: 4,
    now: () => NOW,
    readAccountSpent: async () => { reads += 1; throw new Error("down"); }
  });
  await assert.rejects(() => broken.quote("team@centik.ai", prepared, { requireAccount: true }), /could not be read/);
  assert.equal(reads, 1);
  const tight = createSpendGate({
    capUsd: 10,
    tokenSecret: "secret",
    baselineUsd: 100,
    now: () => NOW,
    readAccountSpent: async () => 109.95
  });
  await assert.rejects(() => tight.quote("team@centik.ai", prepared, { requireAccount: true }), /spend cap/);
  const open = createSpendGate({
    capUsd: 10,
    tokenSecret: "secret",
    baselineUsd: 100,
    now: () => NOW,
    readAccountSpent: async () => 100.5
  });
  const quoted = await open.quote("team@centik.ai", prepared, { requireAccount: true });
  assert.equal(quoted.spent_usd, 0.5);
  assert.equal(quoted.remaining_usd, 9.5);
  assert.equal(quoted.account_total_spent_usd, 100.5);
  const accepted = await open.accept(quoted.spend_token, "team@centik.ai", prepared, { requireAccount: true });
  assert.equal(accepted.ok, true);
});

test("Austin's map uses nearby Texas cities, not the national list", () => {
  const names = nearbyPlaces("austin-tx").map((place) => place.name);
  assert.deepEqual(names, ["Austin", "Cedar Park", "Round Rock", "Georgetown", "San Marcos"]);
  assert.equal(names.includes("Houston"), false);
  assert.equal(names.includes("New York"), false);
});

test("the ledger stores the provider cost and reloads from disk", async () => {
  const ledgerPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "centik-spend-")), "spend-ledger.json");
  const gate = createSpendGate({ capUsd: 10, ledgerPath, tokenSecret: "secret", now: () => NOW });
  const prepared = {
    niche: "emergency plumber",
    city: "Austin",
    state: "Texas",
    countryCanonical: "United States",
    confirmed: { google_ads: { location_code: 1 }, google_maps: { location_code: 2 } }
  };
  await gate.record({
    demand: { provider_reported_cost_usd: { status: "measured", value: 0.075 } },
    maps: { provider_reported_cost_usd: { status: "measured", value: 0.002 } }
  }, "team@centik.ai", prepared);
  const next = createSpendGate({ capUsd: 10, ledgerPath, tokenSecret: "secret", now: () => NOW });
  await next.ready;
  assert.equal(next.totals().spent_usd, 0.077);
  assert.equal(next.totals().entries[0].user, "team@centik.ai");
  assert.equal(next.totals().entries[0].market, "Austin, Texas");
});

test("live competition index uses listings, missing websites, and reviews", () => {
  const open = liveCompetitionIndex({ listings: 4, withoutWebsite: 3, averageReviews: 2 });
  const crowded = liveCompetitionIndex({ listings: 30, withoutWebsite: 0, averageReviews: 100 });
  assert.ok(open > crowded);
  assert.equal(liveCompetitionIndex({ listings: null, withoutWebsite: 0, averageReviews: 0 }), null);
  const derived = competitionIndex(Math.max(3, Math.round(28 - 80 / 4)));
  assert.notEqual(open, derived);
  assert.equal(LISTING_ROOM_CAP, 100);
  const forty = liveCompetitionIndex({ listings: 40, withoutWebsite: 0, averageReviews: 0 });
  const ninety = liveCompetitionIndex({ listings: 90, withoutWebsite: 0, averageReviews: 0 });
  assert.ok(forty > ninety);
});
