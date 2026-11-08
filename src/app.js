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
  VERSION
} from "./config.js";
import { createLiveTransport } from "./dataforseo.js";
import { HttpError } from "./errors.js";
import { createExampleTransport } from "./example-transport.js";
import { parseResolveInput, parseValidateInput } from "./input.js";
import { createLocationDirectory } from "./locations.js";
import { createRateLimiter } from "./rate-limit.js";
import { createRedactor } from "./redact.js";
import { resolveLocation, validateNiche } from "./validator.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const PUBLIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }]
]);

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
    if (req.method === "GET" && pathname === "/favicon.ico") {
      res.writeHead(204, { "Cache-Control": "no-store" });
      res.end();
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
    if (pathname !== "/api/resolve" && pathname !== "/api/validate") {
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
    const prepared = pathname === "/api/resolve" ? parseResolveInput(json) : parseValidateInput(json);
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
