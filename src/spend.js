import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MAPS_PATH, ORGANIC_PATH, SEARCH_VOLUME_PATH, TRENDS_PATH } from "./config.js";
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
export const RESULT_CACHE_MS = 24 * 60 * 60 * 1000;
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

export function bindSpendRequest(email, prepared) {
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
    google_maps: maps ? maps.location_code : null
  };
}

function sameBind(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function resultCacheKey(bind) {
  return [
    RESULT_CACHE_VERSION,
    `maps${MAPS_LIVE_DEPTH}`,
    "organic10",
    "trends-explore-12m",
    VOLUME_KEYWORD_SET_ID,
    bind.niche,
    bind.city,
    bind.state,
    bind.google_ads,
    bind.google_maps
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
  const results = new Map();
  const used = new Set();

  let ready = null;
  function load() {
    if (!ready) {
      ready = (async () => {
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
    const bind = bindSpendRequest(email, prepared);
    const hit = freshResult(bind);
    const cost = hit ? 0 : QUERY_COST_USD;
    const account = flags.requireAccount ? await accountPosition(cost) : null;
    const signed = signToken(bind);
    const state = totals();
    return {
      calls: hit ? [] : paidCalls(),
      cache_hit: Boolean(hit),
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

  function inspect(token, email, prepared) {
    const parsed = readToken(token);
    if (!parsed.ok) return parsed;
    const bind = bindSpendRequest(email, prepared);
    if (!sameBind(parsed.body.bind, bind)) return { ok: false, reason: "mismatched" };
    const hit = freshResult(bind);
    return { ok: true, bind, nonce: parsed.body.nonce, cache_hit: Boolean(hit), estimated_cost_usd: hit ? 0 : QUERY_COST_USD };
  }

  async function accept(token, email, prepared, flags = {}) {
    const parsed = inspect(token, email, prepared);
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

  function freshResult(bind) {
    const hit = results.get(resultCacheKey(bind));
    if (!hit || hit.expires <= now()) return null;
    return hit.value;
  }

  function remember(bind, value) {
    results.set(resultCacheKey(bind), { expires: now() + RESULT_CACHE_MS, value });
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
