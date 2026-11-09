import assert from "node:assert/strict";
import test from "node:test";
import { MAPS_PATH, SEARCH_VOLUME_PATH } from "../src/config.js";
import { assertSafeRequest, createLiveTransport } from "../src/dataforseo.js";
import { createRedactor } from "../src/redact.js";

const login = "login-user";
const password = "test-password-value";

function volumeBody(extra = {}) {
  return [{
    keywords: ["emergency plumber"],
    location_code: 9001007,
    language_code: "en",
    search_partners: false,
    ...extra
  }];
}

function mapsBody(extra = {}) {
  return [{
    keyword: "emergency plumber",
    location_code: 9101007,
    language_code: "en",
    depth: 20,
    device: "desktop",
    os: "windows",
    search_this_area: true,
    ...extra
  }];
}

test("refuses billable shapes that would widen or enlarge the query", () => {
  assert.doesNotThrow(() => assertSafeRequest({ method: "POST", path: SEARCH_VOLUME_PATH, body: volumeBody() }));
  assert.throws(() => assertSafeRequest({ method: "POST", path: MAPS_PATH, body: mapsBody({ depth: 100 }) }), /depth/);
  assert.throws(() => assertSafeRequest({ method: "POST", path: MAPS_PATH, body: mapsBody({ depth: undefined }) }), /depth/);
  assert.throws(() => assertSafeRequest({ method: "POST", path: SEARCH_VOLUME_PATH, body: volumeBody({ location_name: "United States" }) }), /location_name/);
  assert.throws(() => assertSafeRequest({ method: "POST", path: SEARCH_VOLUME_PATH, body: volumeBody({ location_coordinate: "30,-97" }) }), /coordinates/);
  assert.throws(() => assertSafeRequest({ method: "POST", path: SEARCH_VOLUME_PATH, body: [{ keywords: ["a", "b"], location_code: 1, language_code: "en", search_partners: false }] }), /one keyword/);
  assert.throws(() => assertSafeRequest({ method: "POST", path: "/v3/serp/google/organic/live/advanced", body: [] }), /not used/);
  assert.doesNotThrow(() => assertSafeRequest({ method: "GET", path: "/v3/appendix/user_data" }));
  assert.throws(() => assertSafeRequest({ method: "GET", path: "/v3/appendix/user_data", body: [{ money: 1 }] }), /body/);
  assert.throws(() => assertSafeRequest({ method: "GET", path: "/v3/appendix/status" }), /not used/);
});

test("live transport times out once and does not retry or echo credentials", async () => {
  let calls = 0;
  const fetchImpl = (_url, options) => new Promise((_resolve, reject) => {
    calls += 1;
    assert.equal(options.headers.Authorization.startsWith("Basic "), true);
    assert.equal(options.headers.Authorization.includes(password), false);
    options.signal.addEventListener("abort", () => {
      const error = new Error(`aborted ${password} ${options.headers.Authorization}`);
      error.name = "AbortError";
      reject(error);
    });
  });
  const transport = createLiveTransport({ login, password, fetchImpl, timeoutMs: 20 });
  await assert.rejects(
    () => transport.request({ method: "GET", path: "/v3/keywords_data/google_ads/locations/us" }),
    (error) => error.code === "timeout" && !error.message.includes(password) && !error.message.includes("Basic ")
  );
  assert.equal(calls, 1);
});

test("live transport blocks unsafe bodies before fetch and redacts provider errors", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ status_message: `nope ${password}` }), { status: 401 });
  };
  const transport = createLiveTransport({
    login,
    password,
    fetchImpl,
    redact: createRedactor([login, password])
  });
  await assert.rejects(() => transport.request({ method: "POST", path: MAPS_PATH, body: mapsBody({ depth: 700 }) }), (error) => {
    assert.equal(error.code, "refused");
    return true;
  });
  assert.equal(calls, 0);
  await assert.rejects(
    () => transport.request({ method: "POST", path: SEARCH_VOLUME_PATH, body: volumeBody() }),
    (error) => error.code === "http_error" && !String(error.message).includes(password)
  );
  assert.equal(calls, 1);
});

test("missing credentials never call fetch", async () => {
  let calls = 0;
  const transport = createLiveTransport({
    login: " ",
    password: "",
    fetchImpl: async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }
  });
  await assert.rejects(
    () => transport.request({ method: "GET", path: "/v3/serp/google/locations/us" }),
    (error) => error.code === "credentials_missing"
  );
  assert.equal(calls, 0);
});

test("redacts basic tokens and secret values", () => {
  const redact = createRedactor([login, password]);
  const text = redact(`Authorization: Basic dXNlcjpwYXNz and ${password} and ${login}`);
  assert.equal(text.includes(password), false);
  assert.equal(text.includes(login), false);
  assert.match(text, /Basic \[redacted\]/);
});
