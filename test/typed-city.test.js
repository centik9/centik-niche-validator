import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { createApp } from "../src/app.js";
import { resolveTypedCity } from "../src/city-pick.js";
import { buildProposal } from "../src/microsite-flow.js";
import { normalizePlace } from "../src/normalize.js";
import { normalizeState } from "../src/states.js";
import { matchCityInState } from "../src/trends-location.js";
import { postJson, TEST_AUTH, withServer } from "./helpers.js";

function query(city, state) {
  return {
    cityNorm: normalizePlace(city),
    stateNorm: normalizeState(state, "us"),
    countryIso: "us",
    codeSource: "census_places"
  };
}

test("same-state city match never substitutes another state's row", () => {
  const rows = [
    { location_code: 1, location_name: "Nebraska,United States", location_type: "State", country_iso_code: "US", location_code_parent: null },
    { location_code: 2, location_name: "Texas,United States", location_type: "State", country_iso_code: "US", location_code_parent: null },
    { location_code: 3, location_name: "Omaha,Nebraska,United States", location_type: "City", country_iso_code: "US", location_code_parent: 1 },
    { location_code: 4, location_name: "Omaha,Texas,United States", location_type: "City", country_iso_code: "US", location_code_parent: 2 },
    { location_code: 5, location_name: "Omaha,United States", location_type: "DMA Region", country_iso_code: "US", location_code_parent: null }
  ];
  const texas = matchCityInState(rows, query("Omaha", "TX"));
  assert.equal(texas.outcome, "matched");
  assert.equal(texas.match.location_name, "Omaha,Texas,United States");
  assert.notEqual(texas.match.location_name, "Omaha,Nebraska,United States");
  const wyoming = matchCityInState(rows, query("Omaha", "WY"));
  assert.equal(wyoming.outcome, "unsupported");
  assert.equal(wyoming.match, null);
  assert.ok(wyoming.same_city_other_regions.includes("Nebraska"));
  assert.ok(wyoming.same_city_other_regions.includes("Texas"));
});

test("typed small towns resolve only inside the given state", () => {
  const expectPlace = (text, name, state, geoid) => {
    const hit = resolveTypedCity(text);
    assert.equal(hit.selected, true, text);
    assert.equal(hit.place.name, name);
    assert.equal(hit.place.state, state);
    assert.equal(hit.place.geography_type, "city");
    assert.equal(hit.place.geoid, geoid);
    assert.equal(hit.paid_dataforseo_called, undefined);
  };
  expectPlace("Bella Vista, Arkansas", "Bella Vista", "Arkansas", "0504840");
  expectPlace("Bella Vista, AR", "Bella Vista", "Arkansas", "0504840");
  expectPlace("Bella Vista, CA", "Bella Vista", "California", "0604926");
  expectPlace("Leland, NC", "Leland", "North Carolina", "3737680");
  expectPlace("Battle Ground, WA", "Battle Ground", "Washington", "5304475");
  expectPlace("Grass Valley, CA", "Grass Valley", "California", "0630798");

  const texasOmaha = resolveTypedCity("Omaha, TX");
  assert.equal(texasOmaha.selected, true);
  assert.equal(texasOmaha.place.name, "Omaha");
  assert.equal(texasOmaha.place.state, "Texas");
  assert.equal(texasOmaha.place.geoid, "4854024");
  assert.notEqual(texasOmaha.place.state, "Nebraska");

  const missingTown = resolveTypedCity("Bella Vista, TX");
  assert.equal(missingTown.selected, false);
  assert.equal(missingTown.place, null);
  assert.match(missingTown.message, /No US city named Bella Vista in Texas/);
  assert.match(missingTown.message, /Arkansas/);
  assert.equal(missingTown.suggestions.some((item) => item.state === "Nebraska"), false);

  const bare = resolveTypedCity("Bella Vista");
  assert.equal(bare.selected, false);
  assert.equal(bare.place, null);
  assert.match(bare.message, /Add a state/);
  assert.match(bare.message, /Nothing was selected/);

  const omahaBare = resolveTypedCity("Omaha");
  assert.equal(omahaBare.selected, false);
  assert.equal(omahaBare.place, null);
});

test("a heat-only map city resolves, and a non-sample proposal does not invent scores", () => {
  const omaha = resolveTypedCity("Omaha, Nebraska");
  assert.equal(omaha.selected, true);
  assert.equal(omaha.place.state, "Nebraska");
  assert.notEqual(omaha.place.geoid, "4854024");
  const phoenix = resolveTypedCity("Phoenix, Arizona");
  assert.equal(phoenix.selected, true);
  assert.equal(phoenix.place.name, "Phoenix");
  const jersey = resolveTypedCity("Jersey City, New York");
  assert.equal(jersey.selected, false);
  const jerseyClick = resolveTypedCity("Jersey City, New York", { allowUniqueOtherState: true });
  assert.equal(jerseyClick.selected, true);
  assert.equal(jerseyClick.place.state, "New Jersey");

  const proposal = buildProposal({
    keyword: "plumbing",
    subniche_id: "drain-cleaning",
    city: "Bella Vista",
    state: "AR"
  });
  assert.equal(proposal.insufficient_data, true);
  assert.equal(proposal.example_data, false);
  assert.equal(proposal.paid_dataforseo_called, false);
  assert.equal(proposal.deep_check_gate.paid_calls_allowed, false);
  assert.equal(proposal.composite.status, "insufficient");
  assert.equal(proposal.composite.composite_display, null);
  assert.equal(proposal.composite.demand.monthly_searches, null);
  assert.equal(proposal.composite.competition.competitor_count, null);
  assert.match(proposal.deep_check_gate.demand_basis_note, /Insufficient data/);
  assert.equal(proposal.location.name, "Bella Vista");
  assert.equal(proposal.location.state, "Arkansas");
  assert.equal(proposal.location.geography_type, "city");

  const austin = buildProposal({
    keyword: "plumbing",
    subniche_id: "drain-cleaning",
    city: "Austin",
    state: "TX"
  });
  assert.equal(austin.insufficient_data, false);
  assert.equal(austin.location.id, "austin-tx");
  assert.equal(austin.composite.status, "calculated");
  assert.throws(() => buildProposal({
    keyword: "plumbing",
    subniche_id: "drain-cleaning",
    city: "Bella Vista",
    state: "Texas"
  }), (error) => /Texas/.test(error.message));
});

test("resolving and quoting a typed city makes no DataForSEO call and still requires a spend token", async () => {
  const calls = [];
  const app = createApp({
    env: { ...TEST_AUTH, DATAFORSEO_LIVE: "false" },
    fetchImpl: async (url) => {
      calls.push(String(url));
      throw new Error(`unexpected network ${url}`);
    }
  });
  await withServer(app, async (port) => {
    const resolvedCity = await (await postJson(port, "/api/microsite", { action: "resolve_city", query: "Leland, NC" })).json();
    assert.equal(resolvedCity.selected, true);
    assert.equal(resolvedCity.paid_dataforseo_called, false);
    assert.equal(resolvedCity.place.state, "North Carolina");

    const proposal = await (await postJson(port, "/api/microsite", {
      action: "proposal",
      keyword: "plumbing",
      subniche_id: "drain-cleaning",
      subniche_label: "Drain cleaning",
      city: "Leland",
      state: "NC"
    })).json();
    assert.equal(proposal.insufficient_data, true);
    assert.equal(proposal.paid_dataforseo_called, false);

    const resolution = await (await postJson(port, "/api/resolve", {
      mode: "example",
      city: "Leland",
      state: "North Carolina",
      country: "United States",
      geography_type: "city"
    })).json();
    assert.equal(resolution.requests.every((item) => item.sent_to_dataforseo === false), true);

    const quotedResponse = await postJson(port, "/api/quote", {
      mode: "example",
      niche: "Drain cleaning",
      city: "Leland",
      state: "North Carolina",
      country: "United States",
      geography_type: "city",
      confirmed: {
        google_ads: resolution.google_ads.match,
        google_maps: resolution.google_maps.match
      }
    });
    const quoted = await quotedResponse.json();
    assert.equal(quotedResponse.status, 200);
    assert.equal(quoted.market, "Leland, North Carolina");
    assert.equal(typeof quoted.spend_token, "string");

    const denied = await postJson(port, "/api/validate", {
      mode: "live",
      niche: "Drain cleaning",
      city: "Leland",
      state: "North Carolina",
      country: "United States",
      geography_type: "city",
      confirmed: { google_ads: null, google_maps: null }
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).error, "spend_not_confirmed");

    const blocked = await postJson(port, "/api/validate", {
      mode: "live",
      niche: "Drain cleaning",
      city: "Leland",
      state: "North Carolina",
      country: "United States",
      geography_type: "city",
      spend_token: quoted.spend_token,
      confirmed: { google_ads: null, google_maps: null }
    });
    const blockedBody = await blocked.json();
    assert.equal(blocked.status, 403);
    assert.equal(blockedBody.error, "live_mode_disabled");
    assert.equal(calls.length, 0);
  });
});

function textOf(node) {
  if (!node) return "";
  if (node.nodeType === 3) return node.textContent || "";
  if (node.children && node.children.length) return node.children.map(textOf).join("");
  return node.textContent || "";
}

function makeNode(tag) {
  const node = {
    tag,
    nodeType: 1,
    children: [],
    listeners: {},
    attrs: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    dataset: {},
    hidden: false,
    disabled: false,
    value: "",
    textContent: "",
    className: "",
    append(...kids) { node.children.push(...kids); },
    replaceChildren(...kids) { node.children = kids; },
    addEventListener(type, fn) {
      node.listeners[type] = node.listeners[type] || [];
      node.listeners[type].push(fn);
    },
    setAttribute(key, value) { node.attrs[key] = String(value); },
    getAttribute(key) { return node.attrs[key]; },
    querySelector(selector) {
      if (selector === "span") {
        node.span = node.span || makeNode("span");
        return node.span;
      }
      return null;
    },
    querySelectorAll() { return []; },
    focus() {},
    remove() {}
  };
  return node;
}

function walk(node, visit) {
  if (!node || node.nodeType === 3) return;
  visit(node);
  for (const kid of node.children || []) walk(kid, visit);
}

test("use this pair and a heat-only city select through the city field without a paid call", async () => {
  const calls = [];
  const ids = new Map();
  const document = {
    body: makeNode("body"),
    documentElement: makeNode("html"),
    listeners: {},
    addEventListener(type, fn) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(fn);
    },
    removeEventListener() {},
    getElementById(id) {
      if (!ids.has(id)) ids.set(id, makeNode(id));
      return ids.get(id);
    },
    createElement() { return makeNode("div"); },
    createElementNS() { return makeNode("svg"); },
    createTextNode(text) { return { nodeType: 3, textContent: String(text), children: [] }; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const context = {
    document,
    window: {},
    console,
    fetch: async (url, options = {}) => {
      const path = String(url);
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push(path);
      if (/dataforseo|search_volume|maps\/live|google\/organic|trends/i.test(path)) {
        throw new Error(`paid call ${path}`);
      }
      if (path.endsWith("/health")) return { ok: true, json: async () => ({ live_mode: false }) };
      if (path.endsWith("/api/runs")) return { ok: true, json: async () => ({ runs: [] }) };
      if (path.endsWith("/api/microsite") && body.action === "subniches") {
        return { ok: true, json: async () => ({ subniches: [{ id: "retaining-wall", label: "Retaining wall repair" }], ranking_note: "Example." }) };
      }
      if (path.endsWith("/api/microsite") && body.action === "shortlist") {
        return { ok: true, json: async () => ({ cards: [], nearby_cards: [] }) };
      }
      if (path.endsWith("/api/microsite") && body.action === "resolve_city") {
        return { ok: true, json: async () => resolveTypedCity(body.query, { allowUniqueOtherState: body.allow_unique_other_state === true }) };
      }
      if (path.endsWith("/api/microsite") && body.action === "proposal") {
        return { ok: true, json: async () => buildProposal(body) };
      }
      if (path.endsWith("/api/lenses")) {
        return {
          ok: true,
          json: async () => ({
            hard_stop: false,
            service: body.service,
            classroom: { verdict: "caution", rows: [] },
            four_yes: { verdict: "fail", rows: [] }
          })
        };
      }
      if (path.endsWith("/api/resolve")) {
        return { ok: true, json: async () => ({ google_ads: { match: null }, google_maps: { match: null }, requests: [] }) };
      }
      if (path.endsWith("/api/quote")) {
        return {
          ok: true,
          json: async () => ({
            calls: [{ purpose: "Google Ads search volume live", estimated_cost_usd: 0.09 }],
            estimated_cost_usd: 0.105,
            rerun_estimated_cost_usd: 0.105,
            rerun_calls: [],
            spent_usd: 0,
            remaining_usd: 9.895,
            cap_usd: 10,
            spend_token: "test-token",
            niche: body.niche,
            market: `${body.city}, ${body.state}`,
            live_mode: false
          })
        };
      }
      if (path.endsWith("/api/validate")) throw new Error("paid validate was sent");
      return { ok: true, json: async () => ({}) };
    },
    matchMedia: () => ({ matches: true }),
    requestAnimationFrame: (fn) => fn(0),
    setTimeout,
    clearTimeout,
    US_HEAT_MAP: {
      national: { states: [], insets: [] },
      regions: {
        omaha: {
          id: "omaha",
          title: "Omaha",
          state: "Nebraska",
          scored: false,
          national: [120, 80],
          base: 40,
          cities: [{ id: null, name: "Omaha", x: 80, y: 80, base: 41 }],
          counties: [],
          places: [],
          stateLines: ""
        }
      }
    }
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8"), context, { filename: "dashboard.js" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const input = document.getElementById("city-any");
  assert.ok(input.listeners.keydown && input.listeners.keydown.length);
  assert.ok(input.listeners.change && input.listeners.change.length);
  assert.ok(input.listeners.blur && input.listeners.blur.length);

  await context.usePair({ service: "Retaining wall replacement", city: "Bella Vista", state: "Arkansas" });
  assert.equal(input.value, "Bella Vista, Arkansas");
  assert.match(textOf(document.getElementById("stepper")), /Bella Vista, Arkansas/);
  assert.match(document.getElementById("verdict").textContent, /Insufficient data/);
  assert.equal(document.getElementById("pay-go").disabled, false);
  assert.equal(document.getElementById("pay-go").textContent, "Okay, run paid check");
  assert.equal(calls.some((path) => path.endsWith("/api/validate")), false);

  input.value = "Bella Vista, TX";
  await context.confirmTypedCity();
  assert.equal(document.getElementById("pay-go").disabled, true);
  assert.match(document.getElementById("city-any-msg").textContent, /No US city named Bella Vista in Texas/);
  assert.match(textOf(document.getElementById("stepper")), /Pick a city/);

  const regionHit = [];
  walk(document.getElementById("mapwrap"), (node) => {
    if (String(node.attrs["aria-label"] || "").includes("Omaha") && String(node.attrs["aria-label"]).includes("Zoom")) regionHit.push(node);
  });
  assert.equal(regionHit.length > 0, true);
  await regionHit[0].listeners.click[0]();
  const cityHit = [];
  walk(document.getElementById("mapwrap"), (node) => {
    if (String(node.attrs["aria-label"] || "").startsWith("Omaha.")) cityHit.push(node);
  });
  assert.equal(cityHit.length > 0, true);
  await cityHit[0].listeners.click[0]();
  assert.equal(input.value, "Omaha, Nebraska");
  assert.match(textOf(document.getElementById("stepper")), /Omaha, Nebraska/);
  assert.equal(document.getElementById("pay-go").disabled, false);
  assert.doesNotMatch(input.value, /Texas/);
  assert.equal(calls.some((path) => /dataforseo|\/api\/validate/.test(path)), false);
});
