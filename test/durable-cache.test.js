import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { formatDataStamp } from "../src/data-stamp.js";
import { createExampleTransport } from "../src/example-transport.js";
import { createLocationDirectory } from "../src/locations.js";
import { createFileResultStore, selectStoredResult } from "../src/result-store.js";
import { bindSpendRequest, createSpendGate, QUERY_COST_USD, resultIdentity } from "../src/spend.js";
import { confirmedFrom, postJson, TEST_AUTH, withServer } from "./helpers.js";

const NOW = Date.parse("2026-11-07T20:00:00.000Z");
const EMAIL = "team@centik.ai";

function preparedFixture() {
  return {
    niche: "Emergency Plumber",
    city: "Austin",
    state: "Texas",
    country: "United States",
    confirmed: {
      google_ads: { location_code: 11 },
      google_maps: { location_code: 22 }
    }
  };
}

function record(bind, mapsDepth, capturedAt, marker) {
  return {
    ...resultIdentity(bind),
    maps_depth: mapsDepth,
    captured_at: capturedAt,
    report: { marker, maps: { requested_depth: mapsDepth } }
  };
}

test("the data stamp uses Los Angeles time and skips an unknown depth", () => {
  const afternoon = "2026-11-07T20:00:00.000Z";
  assert.equal(formatDataStamp(afternoon, 100), "Data from Nov 7, 2026 · 100 listings");
  assert.equal(formatDataStamp("2026-11-08T07:30:00.000Z", 100), "Data from Nov 7, 2026 · 100 listings");
  assert.equal(formatDataStamp("2026-11-07T07:30:00.000Z", 100), "Data from Nov 6, 2026 · 100 listings");
  assert.equal(formatDataStamp(afternoon, null), "Data from Nov 7, 2026");
  assert.equal(formatDataStamp(afternoon, undefined), "Data from Nov 7, 2026");
  assert.equal(formatDataStamp(afternoon, 100).includes("Nov 07"), false);
});

test("a shallower or older check version is not reused, and a deeper one can be", () => {
  const bind = bindSpendRequest(EMAIL, preparedFixture());
  const identity = resultIdentity(bind);
  const shallow = record(bind, 20, "2026-11-01T18:00:00.000Z", "shallow");
  const deep = record(bind, 200, "2026-11-03T18:00:00.000Z", "deep");
  const exact = record(bind, 100, "2026-11-04T18:00:00.000Z", "exact");
  const volumeOnly = {
    version: "volume-only",
    niche: bind.niche,
    city: bind.city,
    state: bind.state,
    google_ads: bind.google_ads,
    google_maps: bind.google_maps,
    maps_depth: 100,
    captured_at: "2026-11-02T18:00:00.000Z",
    report: { marker: "volume" }
  };
  assert.equal(selectStoredResult([shallow, volumeOnly], identity, 100), null);
  assert.equal(selectStoredResult([shallow, volumeOnly, deep], identity, 100).report.marker, "deep");
  assert.equal(selectStoredResult([deep, exact, shallow], identity, 100).report.marker, "exact");
  assert.equal(selectStoredResult([exact], identity, 20).maps_depth, 100);
  assert.equal(selectStoredResult([{ ...exact, city: "mesa" }], identity, 100), null);
});

test("a saved result survives a new gate and is not billed again after a day", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "centik-cache-"));
  const file = path.join(dir, "results.json");
  const prepared = preparedFixture();
  const bind = bindSpendRequest(EMAIL, prepared);
  const clock = { t: NOW };
  const gate = createSpendGate({
    resultStorePath: file,
    now: () => clock.t,
    tokenSecret: "x".repeat(32),
    baselineUsd: 0,
    readAccountSpent: async () => 0
  });
  const saved = await gate.remember(bind, { marker: "kept", maps: { requested_depth: 100 } });
  assert.equal(saved.captured_at, new Date(NOW).toISOString());
  assert.equal(saved.maps_depth, 100);
  clock.t += 3 * 24 * 60 * 60 * 1000;
  const still = await gate.freshResult(bind);
  assert.equal(still.marker, "kept");
  assert.equal(still.captured_at, saved.captured_at);
  const quoted = await gate.quote(EMAIL, prepared);
  assert.equal(quoted.cache_hit, true);
  assert.equal(quoted.estimated_cost_usd, 0);
  assert.equal(quoted.cached_report.captured_at, saved.captured_at);
  assert.equal(quoted.rerun_estimated_cost_usd, QUERY_COST_USD);

  const restarted = createSpendGate({
    resultStorePath: file,
    now: () => clock.t,
    tokenSecret: "x".repeat(32),
    baselineUsd: 0,
    readAccountSpent: async () => 0
  });
  const again = await restarted.freshResult(bind);
  assert.equal(again.marker, "kept");
  assert.equal(again.captured_at, saved.captured_at);
  const rerun = await restarted.quote(EMAIL, prepared, { rerun: true });
  assert.equal(rerun.cache_hit, false);
  assert.equal(rerun.estimated_cost_usd, QUERY_COST_USD);
  assert.equal(rerun.calls.length, 4);
  const accepted = await restarted.accept(rerun.spend_token, EMAIL, prepared, { rerun: true });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.cache_hit, false);
  assert.equal(accepted.estimated_cost_usd, QUERY_COST_USD);
  const normal = await restarted.quote(EMAIL, prepared);
  const mismatch = await restarted.accept(normal.spend_token, EMAIL, prepared, { rerun: true });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "mismatched");
});

test("the file store ignores a shallow result and serves a deeper one at $0", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "centik-depth-"));
  const file = path.join(dir, "results.json");
  const prepared = preparedFixture();
  const bind = bindSpendRequest(EMAIL, prepared);
  const store = createFileResultStore(file);
  await store.save(record(bind, 20, "2026-11-01T18:00:00.000Z", "shallow"));
  await store.save({
    version: "volume-only",
    organic_depth: 10,
    trends: "trends-explore-12m",
    volume_keyword_set_id: "packed-commercial-v1",
    niche: bind.niche,
    city: bind.city,
    state: bind.state,
    google_ads: bind.google_ads,
    google_maps: bind.google_maps,
    maps_depth: 100,
    captured_at: "2026-11-02T18:00:00.000Z",
    report: { marker: "volume" }
  });
  const shallowGate = createSpendGate({
    resultStore: store,
    now: () => NOW,
    tokenSecret: "x".repeat(32),
    baselineUsd: 0,
    readAccountSpent: async () => 0
  });
  assert.equal(await shallowGate.freshResult(bind), null);
  assert.equal((await shallowGate.quote(EMAIL, prepared)).estimated_cost_usd, QUERY_COST_USD);
  await store.save(record(bind, 200, "2026-11-03T18:00:00.000Z", "deep"));
  const deep = await shallowGate.freshResult(bind);
  assert.equal(deep.marker, "deep");
  assert.equal(deep.maps_depth, 200);
  assert.equal(deep.captured_at, "2026-11-03T18:00:00.000Z");
  const reloaded = createFileResultStore(file);
  await reloaded.load();
  assert.equal(reloaded.find(resultIdentity(bind), 100).report.marker, "deep");
  assert.equal(reloaded.find(resultIdentity(bind), 201), null);
});

test("a restarted server quotes a durable hit at $0 and a rerun is a new paid check", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "centik-restart-"));
  const resultStorePath = path.join(dir, "results.json");
  const ledgerPath = path.join(dir, "ledger.json");
  const example = createExampleTransport();
  const calls = [];
  const fetchImpl = async (url, init) => {
    const pathname = new URL(url).pathname;
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method: init.method, path: pathname });
    const payload = await example.request({ method: init.method, path: pathname, body });
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
  };
  const env = {
    ...TEST_AUTH,
    DATAFORSEO_LIVE: "true",
    DATAFORSEO_LOGIN: "login-user",
    DATAFORSEO_PASSWORD: "test-password-value",
    DATAFORSEO_SPENT_BASELINE_USD: "0"
  };
  const options = {
    env,
    fetchImpl,
    liveDirectory: createLocationDirectory(example),
    resultStorePath,
    ledgerPath,
    readAccountSpent: async () => 0
  };
  let payload;
  let firstCaptured;
  await withServer(createApp({ ...options, now: () => NOW }), async (port) => {
    const resolved = await (await postJson(port, "/api/resolve", {
      mode: "live",
      city: "Austin",
      state: "Texas",
      country: "United States"
    })).json();
    payload = {
      mode: "live",
      niche: "emergency plumber",
      city: "Austin",
      state: "Texas",
      country: "United States",
      confirmed: confirmedFrom(resolved)
    };
    const quoted = await (await postJson(port, "/api/quote", payload)).json();
    assert.equal(quoted.cache_hit, false);
    assert.equal(quoted.estimated_cost_usd, QUERY_COST_USD);
    const first = await (await postJson(port, "/api/validate", { ...payload, spend_token: quoted.spend_token })).json();
    firstCaptured = first.captured_at;
    assert.equal(firstCaptured, new Date(NOW).toISOString());
    assert.equal(first.maps_depth, 100);
    assert.equal(first.maps.requested_depth, 100);
  });
  const paidPosts = () => calls.filter((call) => call.method === "POST").length;
  const afterFirst = paidPosts();
  assert.ok(afterFirst >= 4);

  const later = NOW + 2 * 24 * 60 * 60 * 1000;
  await withServer(createApp({ ...options, now: () => later }), async (port) => {
    const again = await (await postJson(port, "/api/quote", payload)).json();
    assert.equal(again.cache_hit, true);
    assert.equal(again.estimated_cost_usd, 0);
    assert.equal(again.captured_at, firstCaptured);
    assert.equal(again.cached_report.captured_at, firstCaptured);
    assert.equal(again.maps_depth, 100);
    const before = paidPosts();
    const second = await (await postJson(port, "/api/validate", { ...payload, spend_token: again.spend_token })).json();
    assert.equal(second.captured_at, firstCaptured);
    assert.equal(paidPosts(), before);

    const cacheQuote = await (await postJson(port, "/api/quote", payload)).json();
    const mismatch = await postJson(port, "/api/validate", { ...payload, rerun: true, spend_token: cacheQuote.spend_token });
    assert.equal(mismatch.status, 403);
    assert.equal(paidPosts(), before);

    const rerunQuote = await (await postJson(port, "/api/quote", { ...payload, rerun: true })).json();
    assert.equal(rerunQuote.cache_hit, false);
    assert.equal(rerunQuote.estimated_cost_usd, QUERY_COST_USD);
    assert.equal(rerunQuote.calls.length, 4);
    const rerun = await (await postJson(port, "/api/validate", {
      ...payload,
      rerun: true,
      spend_token: rerunQuote.spend_token
    })).json();
    assert.equal(rerun.captured_at, new Date(later).toISOString());
    assert.ok(paidPosts() > before);
  });

  await withServer(createApp({ ...options, now: () => later + 24 * 60 * 60 * 1000 }), async (port) => {
    const quoted = await (await postJson(port, "/api/quote", payload)).json();
    assert.equal(quoted.cache_hit, true);
    assert.equal(quoted.estimated_cost_usd, 0);
    assert.equal(quoted.captured_at, new Date(later).toISOString());
    const before = paidPosts();
    await postJson(port, "/api/validate", { ...payload, spend_token: quoted.spend_token });
    assert.equal(paidPosts(), before);
  });
});

test("dashboard copy keeps the rerun label, stamp, and enlarge control", async () => {
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const dashboard = await fs.readFile(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const css = await fs.readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(dashboard, /Rerun paid check/);
  assert.match(dashboard, /Okay, run paid check/);
  assert.match(dashboard, /This starts a new paid DataForSEO run and will be charged\./);
  assert.match(html, /Showing saved results\. A rerun starts a new paid check\./);
  assert.match(dashboard, /America\/Los_Angeles/);
  assert.match(dashboard, /Enlarge \$\{name\}/);
  assert.match(dashboard, /document\.createTextNode\("Close"\)/);
  for (const title of ["Service", "Market score", "Locations", "Estimates", "Confirm paid check", "Microsite sketch", "Last check results"]) {
    assert.match(html, new RegExp(`<h2[^>]*>${title}</h2>`));
  }
  assert.match(html, /id="card-scrim"/);
  assert.match(css, /min\(1200px, 92vw\)/);
  assert.match(css, /#fbbf24/);
  assert.match(css, /#1c1404/);
  assert.equal(dashboard.includes("\u2014"), false);
  assert.equal(dashboard.includes("\u2013"), false);
  assert.equal(html.includes("\u2014"), false);
  assert.equal(html.includes("\u2013"), false);
  assert.equal(html.includes("Mesa"), false);
});
