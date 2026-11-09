import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BODY_TIMEOUT_MS,
  DEFAULT_RATE_LIMITS,
  MAX_BODY_BYTES,
  REQUEST_TIMEOUT_MS,
  SERVICE_NAME,
  USER_DATA_PATH,
  VERSION
} from "./config.js";
import { accessGranted, clearSessionCookie, readSession, sessionCookie, sessionTokenFromRequest, signSession } from "./auth.js";
import { createLiveTransport } from "./dataforseo.js";
import { HttpError } from "./errors.js";
import { accountSpentUsd, createSpendGate } from "./spend.js";
import { createExampleTransport } from "./example-transport.js";
import { parseResolveInput, parseValidateInput } from "./input.js";
import { createLocationDirectory } from "./locations.js";
import { createRateLimiter } from "./rate-limit.js";
import { createRedactor } from "./redact.js";
import { micrositeAction } from "./microsite-flow.js";
import { screenCandidates } from "./screen.js";
import { resolveLocation, validateNiche } from "./validator.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const PUBLIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/flow.js", { file: "flow.js", type: "text/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }]
]);

function spendRefusal(reason) {
  if (reason === "expired") return "That spend confirmation expired. No DataForSEO request was sent.";
  if (reason === "reused") return "That spend confirmation was already used. No DataForSEO request was sent.";
  if (reason === "mismatched") return "That spend confirmation does not match this niche and market. No DataForSEO request was sent.";
  if (reason === "bad_signature") return "That spend confirmation is not valid. No DataForSEO request was sent.";
  if (reason === "spend_cap_exceeded") return "This check would pass the spend cap. No DataForSEO request was sent.";
  if (reason === "spend_baseline_missing") return "DATAFORSEO_SPENT_BASELINE_USD is not set. Live checks are refused. No paid request was sent.";
  if (reason === "spend_account_unavailable") return "The DataForSEO account spend could not be read. Live checks are refused. No paid request was sent.";
  return "A paid check needs a fresh confirmation. No DataForSEO request was sent.";
}

function baselineUsd(env) {
  if (env.DATAFORSEO_SPENT_BASELINE_USD == null || String(env.DATAFORSEO_SPENT_BASELINE_USD).trim() === "") return null;
  const parsed = Number(env.DATAFORSEO_SPENT_BASELINE_USD);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

const SPEND_BLOCKS = new Set(["spend_cap_exceeded", "spend_baseline_missing", "spend_account_unavailable"]);

function numberEnv(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function credentialsReady(env) {
  return Boolean(env.DATAFORSEO_LOGIN && env.DATAFORSEO_LOGIN.trim() && env.DATAFORSEO_PASSWORD && env.DATAFORSEO_PASSWORD.trim());
}

function liveEnabled(env) {
  return env.DATAFORSEO_LIVE === "true";
}

async function readBody(req, maxBytes, timeoutMs) {
  const declared = Number(req.headers["content-length"] || NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new HttpError(413, "body_too_large", "The request body is too large.");
  }
  const chunks = [];
  let size = 0;
  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.destroy();
      reject(new HttpError(408, "timeout", "The request body timed out."));
    }, timeoutMs);
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        req.destroy();
        reject(new HttpError(413, "body_too_large", "The request body is too large."));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function clientIp(req) {
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

export function createApp(options = {}) {
  const env = options.env || process.env;
  const now = options.now || Date.now;
  const redact = createRedactor([env.DATAFORSEO_LOGIN, env.DATAFORSEO_PASSWORD]);
  const logger = options.logger || { error(message) { console.error(message); } };
  const limits = {
    api: { ...DEFAULT_RATE_LIMITS.api, ...(options.rateLimits && options.rateLimits.api) },
    live: { ...DEFAULT_RATE_LIMITS.live, ...(options.rateLimits && options.rateLimits.live) },
    globalLive: { ...DEFAULT_RATE_LIMITS.globalLive, ...(options.rateLimits && options.rateLimits.globalLive) }
  };
  const apiLimiter = createRateLimiter({ ...limits.api, clock: now });
  const liveLimiter = createRateLimiter({ ...limits.live, clock: now });
  const globalLiveLimiter = createRateLimiter({ ...limits.globalLive, clock: now });
  const spend = createSpendGate({
    capUsd: numberEnv(env.SPEND_CAP_USD, 10),
    ledgerPath: options.ledgerPath || env.SPEND_LEDGER_PATH || path.join(process.cwd(), "data", "spend-ledger.json"),
    tokenSecret: env.SPEND_TOKEN_SECRET || "",
    baselineUsd: options.baselineUsd !== undefined ? options.baselineUsd : baselineUsd(env),
    readAccountSpent: options.readAccountSpent || (async () => {
      const payload = await liveBundle().transport.request({ method: "GET", path: USER_DATA_PATH });
      const spent = accountSpentUsd(payload);
      if (spent == null) {
        const error = new Error("missing total_spent");
        error.code = "spend_account_unavailable";
        throw error;
      }
      return spent;
    }),
    now
  });
  const loginLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 8, clock: now });
  const exampleTransport = options.exampleTransport || createExampleTransport();
  const exampleDirectory = options.exampleDirectory || createLocationDirectory(exampleTransport, { clock: now });
  let liveCache = null;

  function liveBundle() {
    if (liveCache) return liveCache;
    const transport = options.liveTransport || createLiveTransport({
      login: env.DATAFORSEO_LOGIN,
      password: env.DATAFORSEO_PASSWORD,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.upstreamTimeoutMs,
      redact
    });
    liveCache = {
      transport,
      directory: options.liveDirectory || createLocationDirectory(transport, { clock: now })
    };
    return liveCache;
  }

  function depsFor(mode) {
    const shared = { now, redact };
    if (mode === "live") {
      const live = liveBundle();
      return {
        ...shared,
        origin: "live",
        directory: live.directory,
        transport: live.transport,
        codeSource: "dataforseo_locations_list"
      };
    }
    return {
      ...shared,
      origin: "example",
      directory: exampleDirectory,
      transport: exampleTransport,
      codeSource: "example_gazetteer"
    };
  }

  function send(res, status, payload, headers = {}) {
    let body;
    try {
      const redacted = redact(JSON.stringify(payload));
      JSON.parse(redacted);
      body = redacted;
    } catch {
      status = 500;
      body = JSON.stringify({ error: "internal_error", message: "The validator hit an unexpected error." });
    }
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    });
    res.end(body);
  }

  function rejectRate(res, decision) {
    const seconds = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    send(res, 429, {
      error: "rate_limited",
      message: "Too many requests. Wait and try again. No additional DataForSEO request was sent for this attempt."
    }, { "Retry-After": String(seconds) });
  }

  async function handle(req, res) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const pathname = url.pathname;
    if ((req.method === "GET" || req.method === "POST") && pathname === "/login") {
      if (req.method === "GET") {
        const page = await fs.readFile(path.join(PUBLIC_DIR, "login.html"));
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        });
        res.end(page);
        return;
      }
      const decision = loginLimiter.check(clientIp(req));
      if (!decision.allowed) {
        rejectRate(res, decision);
        return;
      }
      if (!env.TEAM_ACCESS_CODE_HASH || !env.SESSION_SECRET) {
        send(res, 503, { error: "auth_not_configured", message: "TEAM_ACCESS_CODE_HASH and SESSION_SECRET must be set before anyone can sign in." });
        return;
      }
      const text = await readBody(req, options.maxBodyBytes || MAX_BODY_BYTES, options.bodyTimeoutMs || BODY_TIMEOUT_MS);
      let json;
      try {
        json = JSON.parse(text || "{}");
      } catch {
        throw new HttpError(400, "invalid_json", "Request body must be JSON.");
      }
      if (!accessGranted(env, json.email, json.access_code)) {
        send(res, 401, { error: "unauthorized", message: "That email or access code was not accepted." });
        return;
      }
      const token = signSession(json.email, env.SESSION_SECRET, now());
      send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(token) });
      return;
    }
    if ((req.method === "POST" || req.method === "GET") && pathname === "/logout") {
      if (req.method === "GET") {
        res.writeHead(302, { Location: "/login", "Set-Cookie": clearSessionCookie(), "Cache-Control": "no-store" });
        res.end();
        return;
      }
      send(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
      return;
    }
    if (req.method === "GET" && pathname.startsWith("/fonts/")) {
      const fontName = pathname.slice("/fonts/".length);
      if (!/^[a-z0-9.-]+\.woff2$/.test(fontName)) {
        send(res, 404, { error: "not_found", message: "Not found." });
        return;
      }
      const data = await fs.readFile(path.join(PUBLIC_DIR, "fonts", fontName));
      res.writeHead(200, {
        "Content-Type": "font/woff2",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff"
      });
      res.end(data);
      return;
    }
    if (req.method === "GET" && (pathname === "/login.js" || pathname === "/styles.css" || pathname === "/dashboard.js")) {
      const name = pathname.slice(1);
      const data = await fs.readFile(path.join(PUBLIC_DIR, name));
      res.writeHead(200, {
        "Content-Type": pathname.endsWith(".css") ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff"
      });
      res.end(data);
      return;
    }
    if ((req.method === "GET" || req.method === "HEAD") && pathname === "/health") {
      const payload = {
        ok: true,
        service: SERVICE_NAME,
        version: VERSION,
        live_mode: liveEnabled(env),
        credentials_configured: credentialsReady(env),
        uptime_seconds: Math.round(process.uptime())
      };
      if (req.method === "HEAD") {
        res.writeHead(200, {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        });
        res.end();
        return;
      }
      send(res, 200, payload);
      return;
    }
    const session = readSession(sessionTokenFromRequest(req), env.SESSION_SECRET || "", now());
    if (!session && pathname !== "/favicon.ico") {
      if (pathname.startsWith("/api/")) {
        send(res, 401, { error: "unauthorized", message: "Sign in required." });
        return;
      }
      res.writeHead(302, { Location: "/login", "Cache-Control": "no-store" });
      res.end();
      return;
    }
    if (req.method === "GET" && pathname === "/favicon.ico") {
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
      return;
    }
    const file = req.method === "GET" ? PUBLIC_FILES.get(pathname) : null;
    if (file) {
      const full = path.join(PUBLIC_DIR, file.file);
      const data = await fs.readFile(full);
      res.writeHead(200, {
        "Content-Type": file.type,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'none'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
      });
      res.end(data);
      return;
    }
    if (req.method === "GET" && pathname === "/api/spend") {
      send(res, 200, spend.totals());
      return;
    }
    if (req.method === "POST" && pathname === "/api/quote") {
      const contentType = String(req.headers["content-type"] || "");
      if (!contentType.toLowerCase().startsWith("application/json")) {
        throw new HttpError(415, "unsupported_media", "Content-Type must be application/json.");
      }
      const text = await readBody(req, options.maxBodyBytes || MAX_BODY_BYTES, options.bodyTimeoutMs || BODY_TIMEOUT_MS);
      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new HttpError(400, "invalid_json", "Request body must be JSON.");
      }
      const prepared = parseValidateInput(json);
      try {
        const quoted = await spend.quote(session.email, prepared, { requireAccount: liveEnabled(env) });
        send(res, 200, { ...quoted, live_mode: liveEnabled(env), credentials_configured: credentialsReady(env) });
      } catch (error) {
        if (error && error.status) {
          send(res, error.status, { error: error.code, message: error.message });
          return;
        }
        throw error;
      }
      return;
    }
    if (!["/api/resolve", "/api/validate", "/api/screen", "/api/microsite"].includes(pathname)) {
      send(res, 404, { error: "not_found", message: "Not found." });
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "method_not_allowed", message: "Use POST." }, { Allow: "POST" });
      return;
    }
    const apiDecision = apiLimiter.check(clientIp(req));
    if (!apiDecision.allowed) {
      rejectRate(res, apiDecision);
      return;
    }
    const contentType = String(req.headers["content-type"] || "");
    if (!contentType.toLowerCase().startsWith("application/json")) {
      throw new HttpError(415, "unsupported_media", "Content-Type must be application/json.");
    }
    const text = await readBody(req, options.maxBodyBytes || MAX_BODY_BYTES, options.bodyTimeoutMs || BODY_TIMEOUT_MS);
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new HttpError(400, "invalid_json", "Request body must be JSON.");
    }
    if (pathname === "/api/microsite") {
      const report = await (options.micrositeImpl || micrositeAction)(json);
      send(res, 200, report);
      return;
    }
    if (pathname === "/api/screen") {
      const report = await (options.screenImpl || screenCandidates)(json, {
        fetchImpl: options.fetchImpl,
        sampleCatalog: options.sampleCatalog,
        extract: options.extract
      });
      send(res, 200, report);
      return;
    }
    const prepared = pathname === "/api/resolve" ? parseResolveInput(json) : parseValidateInput(json);
    if (pathname === "/api/validate" && prepared.mode === "live") {
      const decision = await spend.accept(json.spend_token, session.email, prepared, { requireAccount: liveEnabled(env) });
      if (!decision.ok) {
        send(res, 403, {
          error: SPEND_BLOCKS.has(decision.reason) ? decision.reason : "spend_not_confirmed",
          message: decision.message || spendRefusal(decision.reason)
        });
        return;
      }
      if (!liveEnabled(env)) {
        send(res, 403, {
          error: "live_mode_disabled",
          message: "Live DataForSEO calls are off. Set DATAFORSEO_LIVE=true on the server to opt in. Example data was not substituted."
        });
        return;
      }
      if (!credentialsReady(env)) {
        send(res, 503, {
          error: "credentials_missing",
          message: "Live mode is on but DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are not set. No DataForSEO request was sent."
        });
        return;
      }
      const perIp = liveLimiter.check(clientIp(req));
      if (!perIp.allowed) {
        rejectRate(res, perIp);
        return;
      }
      const globalDecision = globalLiveLimiter.check("global");
      if (!globalDecision.allowed) {
        rejectRate(res, globalDecision);
        return;
      }
      const cached = spend.freshResult(decision.bind);
      if (cached) {
        send(res, 200, cached);
        return;
      }
      const report = await (options.validateImpl || validateNiche)(prepared, depsFor("live"));
      const sent = Boolean(report.demand && report.demand.sent_to_dataforseo) || Boolean(report.maps && report.maps.sent_to_dataforseo);
      if (sent) await spend.record(report, session.email, prepared);
      if (report.demand && report.demand.status !== "failed" && report.maps && report.maps.status !== "failed") {
        spend.remember(decision.bind, report);
      }
      send(res, 200, report);
      return;
    }
    if (prepared.mode === "live") {
      if (!liveEnabled(env)) {
        send(res, 403, {
          error: "live_mode_disabled",
          message: "Live DataForSEO calls are off. Set DATAFORSEO_LIVE=true on the server to opt in. Example data was not substituted."
        });
        return;
      }
      if (!credentialsReady(env)) {
        send(res, 503, {
          error: "credentials_missing",
          message: "Live mode is on but DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are not set. No DataForSEO request was sent."
        });
        return;
      }
      const perIp = liveLimiter.check(clientIp(req));
      if (!perIp.allowed) {
        rejectRate(res, perIp);
        return;
      }
      const globalDecision = globalLiveLimiter.check("global");
      if (!globalDecision.allowed) {
        rejectRate(res, globalDecision);
        return;
      }
    }
    const run = options.validateImpl && pathname === "/api/validate"
      ? options.validateImpl
      : options.resolveImpl && pathname === "/api/resolve"
        ? options.resolveImpl
        : pathname === "/api/resolve"
          ? resolveLocation
          : validateNiche;
    const report = await run(prepared, depsFor(prepared.mode));
    send(res, 200, report);
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (error instanceof HttpError) {
        send(res, error.status, { error: error.code, message: error.message, ...(error.extra || {}) });
        return;
      }
      logger.error(redact(error && (error.stack || error.message) || "unknown error"));
      send(res, 500, { error: "internal_error", message: "The validator hit an unexpected error." });
    });
  });
  server.requestTimeout = options.requestTimeoutMs || REQUEST_TIMEOUT_MS;
  return server;
}
