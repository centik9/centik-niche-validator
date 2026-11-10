import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MAPS_PATH, ORGANIC_PATH, SEARCH_VOLUME_PATH, TRENDS_PATH } from "./config.js";
import { openResultStore } from "./result-store.js";
import { VOLUME_KEYWORD_SET_ID } from "./volume-keywords.js";

export const ADS_COST_USD = 0.09;
export const MAPS_COST_USD = 0.002;
export const ORGANIC_COST_USD = 0.002;
export const TRENDS_COST_USD = 0.011;
export const QUERY_COST_USD = 0.105;
export const MAPS_LIVE_DEPTH = 100;
export const ORGANIC_LIVE_DEPTH = 10;
export const RESULT_CACHE_VERSION = "microsite-v2";
export const TOKEN_MS = 5 * 60 * 1000;
const TRENDS_CACHE_ID = "trends-explore-12m";
const SCALE = 1000;

function milli(dollars) {
  return Math.round(Number(dollars) * SCALE);
}

function dollars(units) {
  return Math.round(units) / SCALE;
}

function roundSpent(value) {
  return Math.round(value * 1e5) / 1e5;
}

export function accountSpentUsd(payload) {
  const task = payload && Array.isArray(payload.tasks) ? payload.tasks[0] : null;
  const result = task && task.result;
  const row = Array.isArray(result) ? result[0] : result;
  const money = row && row.money;
  if (!money || typeof money !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(money, "total_spent") && money.total_spent != null) {
    return typeof money.total_spent === "number" && Number.isFinite(money.total_spent) ? roundSpent(money.total_spent) : null;
  }
  if (typeof money.total === "number" && Number.isFinite(money.total) && typeof money.balance === "number" && Number.isFinite(money.balance)) {
    return roundSpent(money.total - money.balance);
  }
  return null;
}

export function paidCalls() {
  return [
    {
      method: "POST",
      path: SEARCH_VOLUME_PATH,
      purpose: "Google Ads search volume live",
      estimated_cost_usd: ADS_COST_USD
    },
    {
      method: "POST",
      path: MAPS_PATH,
      purpose: "Maps live advanced, depth 100",
      depth: MAPS_LIVE_DEPTH,
      estimated_cost_usd: MAPS_COST_USD
    },
    {
      method: "POST",
      path: ORGANIC_PATH,
      purpose: "Google organic live, depth 10",
      depth: ORGANIC_LIVE_DEPTH,
      estimated_cost_usd: ORGANIC_COST_USD
    },
    {
      method: "POST",
      path: TRENDS_PATH,
      purpose: "Google Trends explore live",
      estimated_cost_usd: TRENDS_COST_USD
    }
  ];
}

export function bindSpendRequest(email, prepared, flags = {}) {
  const ads = prepared.confirmed && prepared.confirmed.google_ads;
  const maps = prepared.confirmed && prepared.confirmed.google_maps;
  return {
    email: String(email || "").trim().toLowerCase(),
    niche: String(prepared.niche || "").trim().toLowerCase(),
    city: String(prepared.city || "").trim().toLowerCase(),
    state: String(prepared.state || "").trim().toLowerCase(),
    country: String(prepared.countryCanonical || prepared.country || "").trim().toLowerCase(),
    geography_type: prepared.geography_type || "city",
    google_ads: ads ? ads.location_code : null,
    google_maps: maps ? maps.location_code : null,
    rerun: flags.rerun === true
  };
}

function sameBind(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function resultIdentity(bind) {
  return {
    version: RESULT_CACHE_VERSION,
    organic_depth: ORGANIC_LIVE_DEPTH,
    trends: TRENDS_CACHE_ID,
    volume_keyword_set_id: VOLUME_KEYWORD_SET_ID,
    niche: bind.niche,
    city: bind.city,
    state: bind.state,
    google_ads: bind.google_ads,
    google_maps: bind.google_maps
  };
}

export function resultCacheKey(bind) {
  const identity = resultIdentity(bind);
  return [
    identity.version,
    `maps${MAPS_LIVE_DEPTH}`,
    `organic${identity.organic_depth}`,
    identity.trends,
    identity.volume_keyword_set_id,
    identity.niche,
    identity.city,
    identity.state,
    identity.google_ads,
    identity.google_maps
  ].join("|");
}

export function createSpendGate(options = {}) {
  const now = options.now || Date.now;
  const capUnits = milli(options.capUsd ?? 10);
  const ledgerPath = options.ledgerPath || "";
  const tokenSecret = options.tokenSecret || "";
  const baselineUsd = Number.isFinite(options.baselineUsd) ? options.baselineUsd : null;
  const readAccountSpent = options.readAccountSpent || (async () => {
    const error = new Error("The DataForSEO account spend could not be read. Live checks are refused. No paid request was sent.");
    error.code = "spend_account_unavailable";
    throw error;
  });
  const entries = [];
  const used = new Set();
  const store = openResultStore({
    store: options.resultStore,
    filePath: options.resultStore ? "" : (options.resultStorePath || "")
  });

  let ready = null;
  function load() {
    if (!ready) {
      ready = (async () => {
        await store.load();
        if (!ledgerPath) return;
        try {
          const saved = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
          if (saved && Array.isArray(saved.entries)) entries.push(...saved.entries);
        } catch {
          // A new ledger file is created on the first paid call.
        }
      })();
    }
    return ready;
  }
  load();

  async function persist() {
    if (!ledgerPath) return;
    try {
      await fs.mkdir(path.dirname(ledgerPath), { recursive: true });
      await fs.writeFile(ledgerPath, JSON.stringify({ entries }));
    } catch {
      // The in-memory total still enforces the cap for this process.
    }
  }

  function spentUnits() {
    return entries.reduce((sum, entry) => sum + milli(entry.cost_usd || 0), 0);
  }

  function totals() {
    const spent = dollars(spentUnits());
    return {
      spent_usd: spent,
      cap_usd: dollars(capUnits),
      remaining_usd: dollars(Math.max(0, capUnits - spentUnits())),
      query_cost_usd: QUERY_COST_USD,
      ads_cost_usd: ADS_COST_USD,
      maps_cost_usd: MAPS_COST_USD,
      organic_cost_usd: ORGANIC_COST_USD,
      trends_cost_usd: TRENDS_COST_USD,
      entries: entries.map((entry) => ({ ...entry }))
    };
  }

  async function accountPosition(costUsd) {
    if (baselineUsd == null) {
      const error = new Error("DATAFORSEO_SPENT_BASELINE_USD is not set. Live checks are refused. No paid request was sent.");
      error.code = "spend_baseline_missing";
      error.status = 403;
      throw error;
    }
    let current;
    try {
      current = await readAccountSpent();
    } catch {
      const error = new Error("The DataForSEO account spend could not be read. Live checks are refused. No paid request was sent.");
      error.code = "spend_account_unavailable";
      error.status = 403;
      throw error;
    }
    const parsed = typeof current === "number" ? current : accountSpentUsd(current);
    if (parsed == null || parsed + 0.000001 < baselineUsd) {
      const error = new Error("DataForSEO account spend is missing or below the go-live baseline. Live checks are refused. No paid request was sent.");
      error.code = "spend_account_unavailable";
      error.status = 403;
      throw error;
    }
    const usedUnits = milli(parsed - baselineUsd);
    if (usedUnits + milli(costUsd) > capUnits) {
      const error = new Error("This check would pass the spend cap. No DataForSEO request was sent.");
      error.code = "spend_cap_exceeded";
      error.status = 403;
      throw error;
    }
    return {
      account_total_spent_usd: parsed,
      baseline_usd: baselineUsd,
      spent_usd: dollars(usedUnits),
      remaining_usd: dollars(capUnits - usedUnits)
    };
  }

  function signToken(bind) {
    const body = { bind, exp: now() + TOKEN_MS, nonce: crypto.randomBytes(16).toString("hex") };
    const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
    const mac = crypto.createHmac("sha256", tokenSecret).update(payload).digest("base64url");
    return { token: `${payload}.${mac}`, exp: body.exp };
  }

  function readToken(token) {
    if (!tokenSecret || typeof token !== "string" || !token.includes(".")) return { ok: false, reason: "missing" };
    const [payload, mac] = token.split(".");
    if (!payload || !mac) return { ok: false, reason: "missing" };
    const expected = crypto.createHmac("sha256", tokenSecret).update(payload).digest("base64url");
    const left = Buffer.from(mac);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return { ok: false, reason: "bad_signature" };
    let body;
    try {
      body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch {
      return { ok: false, reason: "bad_signature" };
    }
    if (!body || !body.bind || !body.nonce || !Number.isFinite(body.exp)) return { ok: false, reason: "bad_signature" };
    if (body.exp <= now()) return { ok: false, reason: "expired" };
    if (used.has(body.nonce)) return { ok: false, reason: "reused" };
    return { ok: true, body };
  }

  async function quote(email, prepared, flags = {}) {
    await load();
    if (!tokenSecret) {
      const error = new Error("SPEND_TOKEN_SECRET must be set before a paid check can be confirmed.");
      error.code = "spend_not_configured";
      error.status = 503;
      throw error;
    }
    const bind = bindSpendRequest(email, prepared, { rerun: flags.rerun === true });
    const hit = bind.rerun ? null : await freshResult(bind);
    const cost = hit ? 0 : QUERY_COST_USD;
    const account = flags.requireAccount ? await accountPosition(cost) : null;
    const signed = signToken(bind);
    const state = totals();
    return {
      calls: hit ? [] : paidCalls(),
      cache_hit: Boolean(hit),
      rerun: bind.rerun,
      captured_at: hit ? hit.captured_at : null,
      maps_depth: hit ? hit.maps_depth : null,
      cached_report: hit,
      rerun_estimated_cost_usd: QUERY_COST_USD,
      rerun_calls: paidCalls(),
      estimated_cost_usd: cost,
      spent_usd: account ? account.spent_usd : state.spent_usd,
      remaining_usd: account ? account.remaining_usd : state.remaining_usd,
      cap_usd: state.cap_usd,
      baseline_usd: account ? account.baseline_usd : baselineUsd,
      account_total_spent_usd: account ? account.account_total_spent_usd : null,
      account_checked: Boolean(account),
      spend_token: signed.token,
      expires_at: new Date(signed.exp).toISOString(),
      niche: prepared.niche,
      market: `${prepared.city}, ${prepared.state}`
    };
  }

  async function inspect(token, email, prepared, flags = {}) {
    const parsed = readToken(token);
    if (!parsed.ok) return parsed;
    const bind = bindSpendRequest(email, prepared, { rerun: flags.rerun === true });
    if (!sameBind(parsed.body.bind, bind)) return { ok: false, reason: "mismatched" };
    const hit = bind.rerun ? null : await freshResult(bind);
    return {
      ok: true,
      bind,
      nonce: parsed.body.nonce,
      cache_hit: Boolean(hit),
      rerun: bind.rerun,
      estimated_cost_usd: hit ? 0 : QUERY_COST_USD
    };
  }

  async function accept(token, email, prepared, flags = {}) {
    const parsed = await inspect(token, email, prepared, flags);
    if (!parsed.ok) return parsed;
    if (flags.requireAccount) {
      try {
        await accountPosition(parsed.estimated_cost_usd);
      } catch (error) {
        return { ok: false, reason: error.code || "spend_account_unavailable", message: error.message };
      }
    }
    if (used.has(parsed.nonce)) return { ok: false, reason: "reused" };
    used.add(parsed.nonce);
    return parsed;
  }

  function present(hit) {
    const report = structuredClone(hit.report);
    report.captured_at = hit.captured_at;
    report.maps_depth = hit.maps_depth;
    return report;
  }

  async function freshResult(bind) {
    await load();
    const hit = store.find(resultIdentity(bind), MAPS_LIVE_DEPTH);
    return hit ? present(hit) : null;
  }

  async function remember(bind, value) {
    await load();
    const captured_at = new Date(now()).toISOString();
    const reportedDepth = value && value.maps && Number.isInteger(value.maps.requested_depth) ? value.maps.requested_depth : null;
    const maps_depth = reportedDepth > 0 ? reportedDepth : MAPS_LIVE_DEPTH;
    const report = structuredClone(value);
    report.captured_at = captured_at;
    report.maps_depth = maps_depth;
    await store.save({
      ...resultIdentity(bind),
      maps_depth,
      captured_at,
      report
    });
    return structuredClone(report);
  }

  function reportedCost(field, fallback) {
    if (field && (field.status === "measured" || field.status === "measured_zero") && typeof field.value === "number") {
      return field.value;
    }
    return fallback;
  }

  async function record(report, email, prepared) {
    const callEntry = (endpoint, section, fallback) => ({
      endpoint,
      cost_usd: reportedCost(section && section.provider_reported_cost_usd, fallback),
      cost_source: section && section.provider_reported_cost_usd && section.provider_reported_cost_usd.status === "measured" ? "provider" : "estimate_fallback"
    });
    const calls = [
      callEntry(`POST ${SEARCH_VOLUME_PATH}`, report.demand, ADS_COST_USD),
      callEntry(`POST ${MAPS_PATH}`, report.maps, MAPS_COST_USD)
    ];
    if (report.organic && report.organic.sent_to_dataforseo) calls.push(callEntry(`POST ${ORGANIC_PATH}`, report.organic, ORGANIC_COST_USD));
    if (report.trends && report.trends.sent_to_dataforseo) calls.push(callEntry(`POST ${TRENDS_PATH}`, report.trends, TRENDS_COST_USD));
    const cost = dollars(calls.reduce((sum, call) => sum + milli(call.cost_usd), 0));
    entries.push({
      at: new Date(now()).toISOString(),
      user: String(email || "").trim().toLowerCase(),
      niche: prepared.niche,
      market: `${prepared.city}, ${prepared.state}`,
      calls,
      cost_usd: cost
    });
    await persist();
    return cost;
  }

  return { load, ready: load(), totals, quote, inspect, accept, freshResult, remember, record, accountPosition };
}
