import fs from "node:fs/promises";
import path from "node:path";

export const ADS_COST_USD = 0.09;
export const MAPS_COST_USD = 0.002;
export const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const SCALE = 1000;

function milli(dollars) {
  return Math.round(dollars * SCALE);
}

function dollars(units) {
  return Math.round(units) / SCALE;
}

export function endpointCostUsd(pathname) {
  if (String(pathname).includes("search_volume")) return ADS_COST_USD;
  if (String(pathname).includes("maps")) return MAPS_COST_USD;
  return 0;
}

export function queryCostUsd() {
  return dollars(milli(ADS_COST_USD) + milli(MAPS_COST_USD));
}

function cacheKey(request) {
  const task = Array.isArray(request.body) ? request.body[0] : null;
  const niche = task && (task.keyword || (Array.isArray(task.keywords) ? task.keywords[0] : ""));
  return `${request.path}|${String(niche || "").trim().toLowerCase()}|${task && task.location_code || ""}`;
}

function dayKey(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function createSpendGuard(options = {}) {
  const now = options.now || Date.now;
  const totalUnits = milli(options.totalUsd ?? 10);
  const dailyUnits = milli(options.dailyUsd ?? 5);
  const ledger = [];
  const cache = new Map();
  const dataDir = options.dataDir || "";

  let ready = null;
  function load() {
    if (!ready) {
      ready = (async () => {
        if (!dataDir) return;
        try {
          const savedLedger = JSON.parse(await fs.readFile(path.join(dataDir, "spend-ledger.json"), "utf8"));
          if (Array.isArray(savedLedger)) ledger.push(...savedLedger);
        } catch {
          // A new directory has no ledger yet.
        }
        try {
          const savedCache = JSON.parse(await fs.readFile(path.join(dataDir, "result-cache.json"), "utf8"));
          if (Array.isArray(savedCache)) {
            for (const entry of savedCache) {
              if (entry && entry.key && entry.expires > now()) cache.set(entry.key, entry);
            }
          }
        } catch {
          // The cache file is optional.
        }
      })();
    }
    return ready;
  }

  load();
  let tail = Promise.resolve();

  async function persist() {
    if (!dataDir) return;
    try {
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(path.join(dataDir, "spend-ledger.json"), JSON.stringify(ledger));
      await fs.writeFile(path.join(dataDir, "result-cache.json"), JSON.stringify([...cache.values()]));
    } catch {
      // The in-memory ledger still stops this process from overspending.
    }
  }

  function spent(match) {
    return ledger.reduce((sum, entry) => sum + (match(entry) ? entry.units : 0), 0);
  }

  function totals() {
    const today = dayKey(now());
    return {
      total_usd: dollars(spent(() => true)),
      daily_usd: dollars(spent((entry) => entry.day === today)),
      budget_total_usd: dollars(totalUnits),
      budget_daily_usd: dollars(dailyUnits),
      query_cost_usd: queryCostUsd(),
      ads_cost_usd: ADS_COST_USD,
      maps_cost_usd: MAPS_COST_USD,
      calls: ledger.map((entry) => ({
        at: entry.at,
        endpoint: entry.endpoint,
        niche: entry.niche,
        location_code: entry.location_code,
        cost_usd: dollars(entry.units)
      }))
    };
  }

  async function readCache(request) {
    await ready;
    const hit = cache.get(cacheKey(request));
    if (!hit || hit.expires <= now() || hit.value == null) return null;
    return hit.value;
  }

  function reserve(request) {
    const run = tail.then(() => reserveNow(request));
    tail = run.then(() => {}, () => {});
    return run;
  }

  async function reserveNow(request) {
    await ready;
    const units = milli(endpointCostUsd(request.path));
    const today = dayKey(now());
    if (spent(() => true) + units > totalUnits || spent((entry) => entry.day === today) + units > dailyUnits) {
      const error = new Error("Paid calls are stopped because this query would pass the budget. No DataForSEO request was sent.");
      error.code = "budget_exceeded";
      throw error;
    }
    const task = Array.isArray(request.body) ? request.body[0] : {};
    ledger.push({
      at: new Date(now()).toISOString(),
      day: today,
      endpoint: request.path,
      niche: task.keyword || (Array.isArray(task.keywords) ? task.keywords[0] : ""),
      location_code: task.location_code || null,
      units
    });
    await persist();
  }

  async function store(request, value) {
    cache.set(cacheKey(request), { key: cacheKey(request), expires: now() + CACHE_MS, value });
    await persist();
  }

  return { load, ready, readCache, reserve, store, totals };
}

export function guardTransport(transport, guard) {
  return {
    async request(request) {
      if (request.method === "GET") return transport.request(request);
      const hit = await guard.readCache(request);
      if (hit) return hit;
      await guard.reserve(request);
      const value = await transport.request(request);
      await guard.store(request, value);
      return value;
    }
  };
}
