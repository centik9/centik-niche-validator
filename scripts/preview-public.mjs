import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { hashAccessCode, sessionCookie, signSession } from "../src/auth.js";
import { createApp } from "../src/app.js";
import { createLocationDirectory } from "../src/locations.js";
import { createPreviewExampleTransport, previewNiche } from "../src/preview-volume-fixture.js";
import { validateNiche } from "../src/validator.js";

// Temporary public preview. Live mode stays off and no DataForSEO credentials are kept.
delete process.env.DATAFORSEO_LOGIN;
delete process.env.DATAFORSEO_PASSWORD;
process.env.DATAFORSEO_LIVE = "false";

if (!process.env.TEAM_ACCESS_CODE_HASH) {
  process.env.TEAM_ACCESS_CODE_HASH = hashAccessCode(randomBytes(24).toString("base64url"));
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = randomBytes(32).toString("base64url");
}
if (!process.env.SPEND_TOKEN_SECRET) {
  process.env.SPEND_TOKEN_SECRET = randomBytes(32).toString("base64url");
}
process.env.ALLOWED_EMAILS = process.env.ALLOWED_EMAILS || "team@centik.ai";
process.env.SPEND_CAP_USD = process.env.SPEND_CAP_USD || "10";

const dataDir = process.env.PREVIEW_DATA_DIR || "/tmp/centik-preview-data";
await fs.mkdir(dataDir, { recursive: true });

const transport = createPreviewExampleTransport();
const app = createApp({
  resultStorePath: path.join(dataDir, "result-cache.json"),
  historyStorePath: path.join(dataDir, "run-history.json"),
  discoveryCachePath: path.join(dataDir, "subniche-cache.json"),
  ledgerPath: path.join(dataDir, "spend-ledger.json"),
  exampleTransport: transport,
  exampleDirectory: createLocationDirectory(transport),
  validateImpl(prepared, deps) {
    const next = deps.origin === "example" && previewNiche(prepared.niche)
      ? { ...deps, previewFallback: true }
      : deps;
    return validateNiche(prepared, next);
  }
});

const appPort = Number(process.env.PREVIEW_APP_PORT || 4317);
const proxyPort = Number(process.env.PORT || 8787);
await new Promise((resolve) => app.listen(appPort, "127.0.0.1", resolve));

function sessionPair() {
  const header = sessionCookie(signSession("team@centik.ai", process.env.SESSION_SECRET, Date.now()));
  return {
    header,
    pair: header.split(";")[0]
  };
}

let session = sessionPair();

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function forward(req, res) {
  const body = await readBody(req);
  const headers = { ...req.headers, host: `127.0.0.1:${appPort}` };
  const existing = String(headers.cookie || "");
  if (!existing.includes("centik_session=")) {
    headers.cookie = existing ? `${existing}; ${session.pair}` : session.pair;
  }
  delete headers["content-length"];
  const upstream = await fetch(`http://127.0.0.1:${appPort}${req.url}`, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    redirect: "manual"
  });
  if (upstream.status === 401 || (upstream.status === 302 && String(upstream.headers.get("location") || "").startsWith("/login"))) {
    session = sessionPair();
  }
  const out = Buffer.from(await upstream.arrayBuffer());
  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    if (key === "transfer-encoding" || key === "content-encoding" || key === "set-cookie") return;
    responseHeaders[key] = value;
  });
  responseHeaders["set-cookie"] = session.header;
  responseHeaders["content-length"] = String(out.length);
  res.writeHead(upstream.status, responseHeaders);
  res.end(req.method === "HEAD" ? undefined : out);
}

const proxy = http.createServer((req, res) => {
  const pathname = (req.url || "/").split("?")[0];
  if (req.method === "GET" && pathname === "/login") {
    res.writeHead(302, {
      Location: "/",
      "Cache-Control": "no-store",
      "set-cookie": session.header
    });
    res.end();
    return;
  }
  forward(req, res).catch((error) => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Preview proxy failed.");
    console.error(error && error.message ? error.message : "preview proxy failed");
  });
});

await new Promise((resolve) => proxy.listen(proxyPort, "127.0.0.1", resolve));
console.log(`preview ready on 127.0.0.1:${proxyPort}`);
console.log("live mode off; DataForSEO credentials unset; example fixture on");
console.log("preview access code is set as TEAM_ACCESS_CODE_HASH in this process; the plain code is not stored");
