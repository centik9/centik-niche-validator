import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { accessGranted, hashAccessCode, readSession, safeEqual, signSession, verifyAccessCode } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { competitionIndex } from "../src/composite-score.js";
import { createExampleTransport } from "../src/example-transport.js";
import { liveCompetitionIndex } from "../src/live-market.js";
import { createLocationDirectory } from "../src/locations.js";
import { createSpendGate, QUERY_COST_USD } from "../src/spend.js";
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

test("a live check uses Maps depth 20 and does not derive competition from demand", async () => {
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
      SPEND_CAP_USD: "10"
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
    assert.equal(quoted.calls.length, 2);
    const firstResponse = await postJson(port, "/api/validate", { ...payload, spend_token: quoted.spend_token });
    const first = await firstResponse.json();
    assert.equal(firstResponse.status, 200);
    assert.equal(first.maps.requested_depth, 20);
    assert.equal(first.city_market.live, true);
    assert.equal(first.city_market.demand_label, "Live Google data");
    assert.equal(first.city_market.competition_label, "Live Google data");
    const mapsCall = calls.find((call) => call.path.endsWith("/maps/live/advanced"));
    const volumeCall = calls.find((call) => call.path.endsWith("/search_volume/live"));
    assert.equal(mapsCall.body[0].depth, 20);
    assert.ok(volumeCall);
    const derivedCount = Math.max(3, Math.round(28 - first.city_market.demand_index / 4));
    assert.notEqual(first.city_market.competition_index, competitionIndex(derivedCount));
    assert.notEqual(first.city_market.competition_index, competitionIndex(first.city_market.unique_listings));
    assert.equal(first.city_market.listings_without_website, first.city_market.unique_listings);
    assert.equal(first.live_composite.status, "calculated");
    assert.match(first.city_market.formula, /does not use|instead of/);
    const sent = calls.length;
    const again = await (await postJson(port, "/api/quote", payload)).json();
    assert.equal(again.cache_hit, true);
    assert.equal(again.estimated_cost_usd, 0);
    const second = await (await postJson(port, "/api/validate", { ...payload, spend_token: again.spend_token })).json();
    assert.equal(calls.length, sent);
    assert.equal(second.live_composite.composite_display, first.live_composite.composite_display);
    const reused = await postJson(port, "/api/validate", { ...payload, spend_token: quoted.spend_token });
    assert.equal(reused.status, 403);
    assert.equal((await reused.json()).error, "spend_not_confirmed");
    assert.equal(calls.length, sent);
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
      SPEND_CAP_USD: "0"
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
      DATAFORSEO_PASSWORD: "test-password-value"
    },
    now: () => NOW,
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
        DATAFORSEO_PASSWORD: "test-password-value"
      },
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
});
