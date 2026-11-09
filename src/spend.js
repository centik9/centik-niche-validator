import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { MAPS_PATH, SEARCH_VOLUME_PATH } from "./config.js";

export const ADS_COST_USD = 0.09;
export const MAPS_COST_USD = 0.002;
export const QUERY_COST_USD = 0.092;
export const MAPS_LIVE_DEPTH = 20;
export const TOKEN_MS = 5 * 60 * 1000;
export const RESULT_CACHE_MS = 24 * 60 * 60 * 1000;
const SCALE = 1000;

function milli(dollars) {
  return Math.round(Number(dollars) * SCALE);
}

function dollars(units) {
  return Math.round(units) / SCALE;
}

export function paidCalls() {
  return [
    {
      method: "POST",
      path: SEARCH_VOLUME_PATH,
      purpose: "Google Ads search volume and CPC",
      estimated_cost_usd: ADS_COST_USD
    },
    {
      method: "POST",
      path: MAPS_PATH,
      purpose: "Maps live advanced, top 20 organic competitors",
      depth: MAPS_LIVE_DEPTH,
      estimated_cost_usd: MAPS_COST_USD
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

function cacheKey(bind) {
  return `${bind.niche}|${bind.google_ads}|${bind.google_maps}`;
}

export function createSpendGate(options = {}) {
  const now = options.now || Date.now;
  const capUnits = milli(options.capUsd ?? 10);
  const ledgerPath = options.ledgerPath || "";
  const tokenSecret = options.tokenSecret || "";
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
      entries: entries.map((entry) => ({ ...entry }))
    };
  }

  function roomFor(costUsd) {
    return spentUnits() + milli(costUsd) <= capUnits;
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

  async function quote(email, prepared) {
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
    if (!roomFor(cost)) {
      const error = new Error("This check would pass the spend cap. No DataForSEO request was sent.");
      error.code = "spend_cap_exceeded";
      error.status = 403;
      throw error;
    }
    const signed = signToken(bind);
    const state = totals();
    return {
      calls: hit ? [] : paidCalls(),
      cache_hit: Boolean(hit),
      estimated_cost_usd: cost,
      spent_usd: state.spent_usd,
      remaining_usd: state.remaining_usd,
      cap_usd: state.cap_usd,
      spend_token: signed.token,
      expires_at: new Date(signed.exp).toISOString(),
      niche: prepared.niche,
      market: `${prepared.city}, ${prepared.state}`
    };
  }

  function accept(token, email, prepared) {
    const parsed = readToken(token);
    if (!parsed.ok) return parsed;
    const bind = bindSpendRequest(email, prepared);
    if (!sameBind(parsed.body.bind, bind)) return { ok: false, reason: "mismatched" };
    const hit = freshResult(bind);
    const cost = hit ? 0 : QUERY_COST_USD;
    if (!roomFor(cost)) return { ok: false, reason: "spend_cap_exceeded", status: 403 };
    used.add(parsed.body.nonce);
    return { ok: true, bind, cache_hit: Boolean(hit), estimated_cost_usd: cost };
  }

  function freshResult(bind) {
    const hit = results.get(cacheKey(bind));
    if (!hit || hit.expires <= now()) return null;
    return hit.value;
  }

  function remember(bind, value) {
    results.set(cacheKey(bind), { expires: now() + RESULT_CACHE_MS, value });
  }

  function reportedCost(field, fallback) {
    if (field && (field.status === "measured" || field.status === "measured_zero") && typeof field.value === "number") {
      return field.value;
    }
    return fallback;
  }

  async function record(report, email, prepared) {
    const calls = [
      {
        endpoint: `POST ${SEARCH_VOLUME_PATH}`,
        cost_usd: reportedCost(report.demand && report.demand.provider_reported_cost_usd, ADS_COST_USD),
        cost_source: report.demand && report.demand.provider_reported_cost_usd && report.demand.provider_reported_cost_usd.status === "measured" ? "provider" : "estimate_fallback"
      },
      {
        endpoint: `POST ${MAPS_PATH}`,
        cost_usd: reportedCost(report.maps && report.maps.provider_reported_cost_usd, MAPS_COST_USD),
        cost_source: report.maps && report.maps.provider_reported_cost_usd && report.maps.provider_reported_cost_usd.status === "measured" ? "provider" : "estimate_fallback"
      }
    ];
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

  return { load, ready: load(), totals, quote, accept, freshResult, remember, record, roomFor };
}
