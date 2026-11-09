import { hashAccessCode } from "../src/auth.js";
import { createExampleTransport } from "../src/example-transport.js";
import { createLocationDirectory } from "../src/locations.js";

export const TEST_CODE = "test-code-not-a-secret";

export function exampleDeps(transport = createExampleTransport()) {
  return {
    transport,
    directory: createLocationDirectory(transport),
    origin: "example",
    codeSource: "example_gazetteer",
    now: () => Date.parse("2026-01-15T00:00:00.000Z"),
    redact: (value) => String(value ?? "")
  };
}

export function confirmedFrom(resolution) {
  const side = (match) => match ? {
    location_code: match.location_code,
    location_name: match.location_name,
    location_type: match.location_type
  } : null;
  return {
    google_ads: side(resolution.google_ads.match),
    google_maps: side(resolution.google_maps.match)
  };
}

export async function withServer(app, fn) {
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const port = app.address().port;
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
}

export const TEST_AUTH = {
  ALLOWED_EMAILS: "team@centik.ai",
  TEAM_ACCESS_CODE_HASH: hashAccessCode(TEST_CODE),
  SESSION_SECRET: "test-session-secret-32chars-minimum",
  SPEND_TOKEN_SECRET: "test-spend-token-secret-32chars-min",
  SPEND_CAP_USD: "10"
};

const sessionJar = new Map();

export async function sessionCookie(port) {
  if (sessionJar.has(port)) return sessionJar.get(port);
  const response = await fetch(`http://127.0.0.1:${port}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "team@centik.ai", access_code: TEST_CODE })
  });
  const raw = response.headers.get("set-cookie") || "";
  const cookie = raw.split(";")[0];
  sessionJar.set(port, cookie);
  return cookie;
}

export function postJson(port, pathname, payload) {
  return sessionCookie(port).then((cookie) => fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(payload)
  }));
}
