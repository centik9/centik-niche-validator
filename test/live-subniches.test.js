import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { KEYWORD_IDEAS_PATH, US_LOCATION_CODE } from "../src/config.js";
import { createDiscoveryCache } from "../src/discovery-cache.js";
import { DataForSeoError } from "../src/errors.js";
import { createSpendGate, KEYWORD_IDEAS_COST_USD } from "../src/spend.js";
import { inTradePhrase, rankInTradeIdeas } from "../src/subniche-discovery.js";
import { createApp } from "../src/app.js";
import { postJson, sessionCookie, TEST_AUTH, withServer } from "./helpers.js";

const EIGHT_TRADE_LABELS = [
  "Plumbing",
  "HVAC Repair",
  "Locksmith",
  "Garage Door Repair",
  "Electrician",
  "Retaining Wall Repair",
  "Mobile Welding",
  "Crawl Space Encapsulation"
];

const WELDING_ITEMS = [
  { keyword: "plumbing", search_volume: 100000 },
  { keyword: "electrician", search_volume: 90000 },
  { keyword: "locksmith", search_volume: 80000 },
  { keyword: "garage door repair", search_volume: 70000 },
  { keyword: "crawl space encapsulation", search_volume: 60000 },
  { keyword: "hvac repair", search_volume: 50000 },
  { keyword: "retaining wall repair", search_volume: 40000 },
  { keyword: "welding jobs", search_volume: 5000 },
  { keyword: "mobile welding", search_volume: 2400 },
  { keyword: "pipe welding", search_volume: 1900 },
  { keyword: "structural welding", search_volume: 1600 },
  { keyword: "tig welding", search_volume: 1400 },
  { keyword: "mig welding", search_volume: 1300 },
  { keyword: "mobile welder", search_volume: 800 },
  { keyword: "electrode welding", search_volume: 600 }
];

const HVAC_ITEMS = [
  { keyword: "plumbing", search_volume: 90000 },
  { keyword: "electrician", search_volume: 80000 },
  { keyword: "locksmith", search_volume: 70000 },
  { keyword: "hvac repair", search_volume: 40000 },
  { keyword: "furnace repair", search_volume: 12000 },
  { keyword: "air conditioning installation", search_volume: 9000 },
  { keyword: "hvac maintenance", search_volume: 7000 },
  { keyword: "commercial hvac", search_volume: 5000 }
];

function ideasPayload(items, cost = 0.0168) {
  return {
    status_code: 20000,
    cost,
    tasks: [{
      status_code: 20000,
      status_message: "Ok.",
      cost,
      result: [{
        items_count: items.length,
        items: items.map((item) => ({
          keyword: item.keyword,
          keyword_info: { search_volume: item.search_volume }
        }))
      }]
    }]
  };
}

function labelsOf(items) {
  return rankInTradeIdeas("welding", items.map((item) => ({ keyword: item.keyword, volume: item.search_volume }))).subniches.map((row) => row.label);
}

test("welding ideas stay welding specialties and do not fall back to the eight trades", () => {
  const ranked = rankInTradeIdeas("welding", WELDING_ITEMS.map((item) => ({ keyword: item.keyword, volume: item.search_volume })));
  const labels = ranked.subniches.map((row) => row.label);
  assert.deepEqual(labels, [
    "Mobile Welding",
    "Pipe Welding",
    "Structural Welding",
    "TIG Welding",
    "MIG Welding",
    "Electrode Welding"
  ]);
  assert.equal(ranked.subniches[0].search_volume, 2400);
  assert.match(ranked.subniches[0].note, /Mobile Welder/);
  assert.equal(labels.some((label) => /plumb|electrician|locksmith|garage door|crawl space|retaining|hvac/i.test(label)), false);
  assert.notDeepEqual(labels, EIGHT_TRADE_LABELS);
  assert.match(ranked.ranking_note, /other trades were removed/i);
  assert.equal(inTradePhrase("welding", "plumbing"), false);
  assert.equal(inTradePhrase("welding", "pipe welding"), true);
});

test("HVAC ideas stay HVAC after the top match", () => {
  const ranked = rankInTradeIdeas("HVAC", HVAC_ITEMS.map((item) => ({ keyword: item.keyword, volume: item.search_volume })));
  const labels = ranked.subniches.map((row) => row.label);
  assert.equal(labels[0], "HVAC Repair");
  assert.deepEqual(labels, [
    "HVAC Repair",
    "Furnace Repair",
    "Air Conditioning Installation",
    "HVAC Maintenance",
    "Commercial HVAC"
  ]);
  assert.equal(labels.slice(1).every((label) => /hvac|furnace|air conditioning/i.test(label)), true);
  assert.equal(labels.some((label) => /plumb|electrician|locksmith/i.test(label)), false);
});

test("other trades are not substituted when nothing in the seed trade was returned", () => {
  const ranked = rankInTradeIdeas("welding", [
    { keyword: "plumbing", volume: 100000 },
    { keyword: "electrician", volume: 90000 },
    { keyword: "locksmith", volume: 80000 },
    { keyword: "garage door repair", volume: 70000 },
    { keyword: "crawl space encapsulation", volume: 40000 }
  ]);
  assert.equal(ranked.subniches.length, 0);
  assert.equal(ranked.known_profile, false);
  assert.match(ranked.ranking_note, /example trade list was not used/);
  assert.notDeepEqual(ranked.subniches.map((row) => row.label), EIGHT_TRADE_LABELS);
  assert.equal(labelsOf(WELDING_ITEMS).includes("Plumbing"), false);
});

test("the dashboard does not buy specialties from the keystroke timer", () => {
  const source = fs.readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const timerStart = source.indexOf("suggestTimer = setTimeout");
  const timerEnd = source.indexOf("}, 250);", timerStart);
  const timer = source.slice(timerStart, timerEnd);
  assert.match(timer, /loadExampleSubniches/);
  assert.equal(timer.includes("requestSpecialties"), false);
  assert.equal(timer.includes("spend_token"), false);
  const exampleFn = source.slice(source.indexOf("async function loadExampleSubniches"), source.indexOf("async function requestSpecialties"));
  assert.equal(exampleFn.includes("spend_token"), false);
  assert.match(source, /needs_confirmation/);
});

function liveEnv(extra = {}) {
  return {
    ...TEST_AUTH,
    DATAFORSEO_LIVE: "true",
    DATAFORSEO_LOGIN: "login-user",
    DATAFORSEO_PASSWORD: "test-password-value",
    DATAFORSEO_SPENT_BASELINE_USD: "0",
    SPEND_CAP_USD: "10",
    ...extra
  };
}

function userData() {
  return { tasks: [{ status_code: 20000, result: [{ money: { total: 0, balance: 0 } }] }] };
}

function itemsFor(seed) {
  if (seed === "hvac") return HVAC_ITEMS;
  if (seed === "welding") return WELDING_ITEMS;
  return [{ keyword: "plumbing", search_volume: 10 }];
}

async function withLiveApp(fn, { env = liveEnv(), rateLimits, transport } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subniche-"));
  const calls = [];
  const request = async (args) => {
    calls.push({ method: args.method, path: args.path, body: args.body });
    if (transport) return transport(args);
    if (args.method === "GET" && args.path === "/v3/appendix/user_data") return userData();
    if (args.method === "POST" && args.path === KEYWORD_IDEAS_PATH) {
      const seed = args.body[0].keywords[0];
      assert.equal(args.body[0].location_code, US_LOCATION_CODE);
      assert.equal(args.body[0].language_code, "en");
      assert.equal(args.body[0].limit, 40);
      assert.equal(args.body[0].closely_variants, true);
      assert.equal(args.body[0].include_clickstream_data, false);
      assert.equal(args.body.length, 1);
      return ideasPayload(itemsFor(seed));
    }
    throw new Error(`unexpected ${args.method} ${args.path}`);
  };
  const app = createApp({
    env,
    rateLimits,
    ledgerPath: path.join(dir, "ledger.json"),
    discoveryCache: createDiscoveryCache(),
    liveTransport: { request },
    fetchImpl: async () => { throw new Error("real fetch"); }
  });
  try {
    return await withServer(app, (port) => fn(port, calls));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function ideaPosts(calls) {
  return calls.filter((call) => call.method === "POST" && call.path === KEYWORD_IDEAS_PATH);
}

test("live Step 1 confirms once, caches the keyword, and records the keyword-ideas cost", async () => {
  await withLiveApp(async (port, calls) => {
    const quoted = await postJson(port, "/api/microsite", { action: "subniches", keyword: "welding" });
    const quote = await quoted.json();
    assert.equal(quoted.status, 200);
    assert.equal(quote.needs_confirmation, true);
    assert.equal(quote.paid_dataforseo_called, false);
    assert.equal(quote.example_data, false);
    assert.equal(quote.estimated_cost_usd, KEYWORD_IDEAS_COST_USD);
    assert.equal(quote.subniches.length, 0);
    assert.equal(ideaPosts(calls).length, 0);
    assert.match(quote.ranking_note, /No DataForSEO request was sent/);

    const paid = await postJson(port, "/api/microsite", {
      action: "subniches",
      keyword: "welding",
      spend_token: quote.spend_token
    });
    const body = await paid.json();
    assert.equal(paid.status, 200);
    assert.equal(body.data_origin, "live");
    assert.equal(body.example_data, false);
    assert.equal(body.paid_dataforseo_called, true);
    assert.equal(body.cache_hit, false);
    assert.equal(body.location_code, US_LOCATION_CODE);
    assert.deepEqual(body.subniches.map((row) => row.label), [
      "Mobile Welding",
      "Pipe Welding",
      "Structural Welding",
      "TIG Welding",
      "MIG Welding",
      "Electrode Welding"
    ]);
    assert.equal(body.subniches[0].search_volume, 2400);
    assert.equal(JSON.stringify(body).includes("Plumbing"), false);
    assert.equal(ideaPosts(calls).length, 1);
    assert.deepEqual(ideaPosts(calls)[0].body[0].keywords, ["welding"]);

    const reused = await postJson(port, "/api/microsite", {
      action: "subniches",
      keyword: "welding",
      spend_token: quote.spend_token,
      rerun: true
    });
    assert.equal(reused.status, 403);
    assert.equal((await reused.json()).error, "spend_not_confirmed");
    assert.equal(ideaPosts(calls).length, 1);

    const cached = await postJson(port, "/api/microsite", { action: "subniches", keyword: " Welding " });
    const cachedBody = await cached.json();
    assert.equal(cached.status, 200);
    assert.equal(cachedBody.cache_hit, true);
    assert.equal(cachedBody.paid_dataforseo_called, false);
    assert.equal(cachedBody.estimated_cost_usd, 0);
    assert.equal(cachedBody.subniches[0].label, "Mobile Welding");
    assert.equal(ideaPosts(calls).length, 1);

    const spend = await fetch(`http://127.0.0.1:${port}/api/spend`, { headers: { cookie: await sessionCookie(port) } });
    const totals = await spend.json();
    assert.equal(spend.status, 200);
    assert.equal(totals.entries.length, 1);
    assert.equal(totals.entries[0].niche, "welding");
    assert.equal(totals.entries[0].market, "United States");
    assert.equal(totals.entries[0].calls[0].endpoint, `POST ${KEYWORD_IDEAS_PATH}`);
    assert.equal(totals.entries[0].cost_usd, 0.017);
    assert.equal(JSON.stringify(totals).includes("test-password-value"), false);

    const hvacQuote = await (await postJson(port, "/api/microsite", { action: "subniches", keyword: "HVAC" })).json();
    assert.equal(hvacQuote.needs_confirmation, true);
    const hvacResponse = await postJson(port, "/api/microsite", {
      action: "subniches",
      keyword: "HVAC",
      spend_token: hvacQuote.spend_token
    });
    const hvac = await hvacResponse.json();
    assert.equal(hvacResponse.status, 200, JSON.stringify(hvac));
    assert.equal(hvac.subniches[0].label, "HVAC Repair");
    assert.equal(hvac.subniches.slice(1).every((row) => /hvac|furnace|air conditioning/i.test(row.label)), true);
    assert.equal(hvac.subniches.some((row) => /plumb|electrician|locksmith/i.test(row.label)), false);
    assert.equal(ideaPosts(calls).length, 2);
    assert.deepEqual(ideaPosts(calls)[1].body[0].keywords, ["hvac"]);

    const bakeryQuote = await (await postJson(port, "/api/microsite", { action: "subniches", keyword: "bakery" })).json();
    const bakery = await (await postJson(port, "/api/microsite", {
      action: "subniches",
      keyword: "bakery",
      spend_token: bakeryQuote.spend_token
    })).json();
    assert.equal(bakery.example_data, false);
    assert.equal(bakery.subniches.length, 0);
    assert.match(bakery.ranking_note, /example trade list was not used/);
    assert.equal(JSON.stringify(bakery).includes("Plumbing"), false);
  });
});

test("a failed keyword-ideas call does not substitute the example trade list", async () => {
  await withLiveApp(async (port, calls) => {
    const quote = await (await postJson(port, "/api/microsite", { action: "subniches", keyword: "welding" })).json();
    const response = await postJson(port, "/api/microsite", {
      action: "subniches",
      keyword: "welding",
      spend_token: quote.spend_token
    });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.match(body.message, /not substituted/);
    assert.equal(JSON.stringify(body).includes("Plumbing"), false);
    assert.equal(JSON.stringify(body).includes("test-password-value"), false);
    assert.equal(ideaPosts(calls).length, 1);
  }, {
    transport: async (args) => {
      if (args.method === "GET") return userData();
      throw new DataForSeoError("http_error", "provider down test-password-value");
    }
  });
});

test("specialty lookup is refused without a baseline, credentials, or room under the cap", async () => {
  await withLiveApp(async (port, calls) => {
    const missing = await postJson(port, "/api/microsite", { action: "subniches", keyword: "welding" });
    const body = await missing.json();
    assert.equal(missing.status, 403);
    assert.equal(body.error, "spend_baseline_missing");
    assert.equal(calls.length, 0);
  }, { env: liveEnv({ DATAFORSEO_SPENT_BASELINE_USD: "" }) });

  await withLiveApp(async (port, calls) => {
    const missing = await postJson(port, "/api/microsite", { action: "subniches", keyword: "welding" });
    assert.equal(missing.status, 503);
    assert.equal((await missing.json()).error, "credentials_missing");
    assert.equal(calls.length, 0);
  }, { env: { ...liveEnv(), DATAFORSEO_LOGIN: "", DATAFORSEO_PASSWORD: "" } });

  await withLiveApp(async (port, calls) => {
    const capped = await postJson(port, "/api/microsite", { action: "subniches", keyword: "welding" });
    const body = await capped.json();
    assert.equal(capped.status, 403);
    assert.equal(body.error, "spend_cap_exceeded");
    assert.equal(ideaPosts(calls).length, 0);
  }, { env: liveEnv({ SPEND_CAP_USD: "0.01" }) });
});

test("the live rate limit stops a second specialty purchase", async () => {
  await withLiveApp(async (port, calls) => {
    const first = await (await postJson(port, "/api/microsite", { action: "subniches", keyword: "welding" })).json();
    const paid = await postJson(port, "/api/microsite", {
      action: "subniches",
      keyword: "welding",
      spend_token: first.spend_token
    });
    assert.equal(paid.status, 200);
    const second = await (await postJson(port, "/api/microsite", { action: "subniches", keyword: "HVAC" })).json();
    const limited = await postJson(port, "/api/microsite", {
      action: "subniches",
      keyword: "HVAC",
      spend_token: second.spend_token
    });
    assert.equal(limited.status, 429);
    assert.equal(ideaPosts(calls).length, 1);
  }, {
    rateLimits: {
      api: { windowMs: 60_000, max: 30 },
      live: { windowMs: 60_000, max: 1 },
      globalLive: { windowMs: 60_000, max: 1 }
    }
  });
});

test("a city-check spend token cannot buy a specialty lookup", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subniche-spend-"));
  const spend = createSpendGate({
    tokenSecret: TEST_AUTH.SPEND_TOKEN_SECRET,
    baselineUsd: 0,
    capUsd: 10,
    ledgerPath: path.join(dir, "ledger.json"),
    readAccountSpent: async () => 0
  });
  try {
    const quoted = await spend.quote("team@centik.ai", {
      niche: "welding",
      city: "Austin",
      state: "Texas",
      country: "United States",
      countryCanonical: "United States",
      geography_type: "city",
      confirmed: { google_ads: { location_code: 1 }, google_maps: { location_code: 2 } }
    }, { requireAccount: true });
    const decision = await spend.acceptDiscovery(quoted.spend_token, "team@centik.ai", "welding", US_LOCATION_CODE, {
      requireAccount: true
    });
    assert.equal(decision.ok, false);
    assert.equal(decision.reason, "mismatched");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("example mode still labels the built-in trade list as an example", async () => {
  let fetches = 0;
  const app = createApp({
    env: { ...TEST_AUTH, DATAFORSEO_LIVE: "false" },
    fetchImpl: async () => { fetches += 1; throw new Error("network"); }
  });
  await withServer(app, async (port) => {
    const response = await postJson(port, "/api/microsite", { action: "subniches", keyword: "welding" });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.example_data, true);
    assert.equal(body.paid_dataforseo_called, false);
    assert.equal(body.data_origin, "example");
    assert.match(body.ranking_note, /example/);
    assert.equal(fetches, 0);
  });
});
