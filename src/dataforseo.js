import {
  LANGUAGE_CODE,
  MAPS_DEPTH,
  MAPS_DEVICE,
  MAPS_OS,
  MAPS_PATH,
  MAX_UPSTREAM_BYTES,
  SEARCH_VOLUME_PATH,
  UPSTREAM_TIMEOUT_MS,
  USER_DATA_PATH
} from "./config.js";
import { DataForSeoError } from "./errors.js";

const LOCATION_GET = /^\/v3\/(?:keywords_data\/google_ads|serp\/google)\/locations\/[a-z]{2}$/;
const VOLUME_FIELDS = new Set(["keywords", "location_code", "language_code", "search_partners"]);
const MAPS_FIELDS = new Set(["keyword", "location_code", "language_code", "depth", "device", "os", "search_this_area"]);

function refused(message) {
  throw new DataForSeoError("refused", message);
}

function assertKeyword(keyword, label) {
  if (typeof keyword !== "string" || keyword.trim().length < 2 || keyword.length > 80) {
    refused(`${label} must be 2-80 characters.`);
  }
  if (keyword.trim().split(/\s+/).length > 10) refused(`${label} must be 10 words or fewer.`);
}

export function assertSafeRequest({ method, path, body }) {
  if (method === "GET" && (LOCATION_GET.test(path) || path === USER_DATA_PATH)) {
    if (body !== undefined && body !== null) refused("This GET does not take a body.");
    return;
  }
  if (method === "POST" && path === SEARCH_VOLUME_PATH) {
    if (!Array.isArray(body) || body.length !== 1) refused("Search volume requests must contain exactly one task.");
    const task = body[0];
    if (!task || typeof task !== "object") refused("Search volume task is missing.");
    if (!Array.isArray(task.keywords) || task.keywords.length !== 1) refused("Exactly one keyword is allowed.");
    assertKeyword(task.keywords[0], "Keyword");
    if (!Number.isInteger(task.location_code) || task.location_code <= 0) refused("A confirmed location_code is required.");
    if (task.language_code !== LANGUAGE_CODE) refused("language_code must be en.");
    if (task.search_partners !== false) refused("search_partners must be false.");
    if ("location_name" in task || "location_coordinate" in task || "date_from" in task || "date_to" in task) {
      refused("location_name, coordinates, and custom dates are not sent.");
    }
    const extra = Object.keys(task).filter((key) => !VOLUME_FIELDS.has(key));
    if (extra.length) refused(`Unexpected search volume fields: ${extra.join(",")}.`);
    return;
  }
  if (method === "POST" && path === MAPS_PATH) {
    if (!Array.isArray(body) || body.length !== 1) refused("Maps requests must contain exactly one task.");
    const task = body[0];
    if (!task || typeof task !== "object") refused("Maps task is missing.");
    assertKeyword(task.keyword, "Keyword");
    if (!Number.isInteger(task.location_code) || task.location_code <= 0) refused("A confirmed location_code is required.");
    if (task.language_code !== LANGUAGE_CODE) refused("language_code must be en.");
    if (task.depth !== MAPS_DEPTH) refused("Maps depth must be exactly 100.");
    if (task.search_this_area !== true) refused("search_this_area must be true.");
    if (task.device !== MAPS_DEVICE || task.os !== MAPS_OS) refused("Maps device and os are fixed.");
    if ("location_name" in task || "location_coordinate" in task) refused("location_name and coordinates are not sent.");
    const extra = Object.keys(task).filter((key) => !MAPS_FIELDS.has(key));
    if (extra.length) refused(`Unexpected Maps fields: ${extra.join(",")}.`);
    return;
  }
  refused("That DataForSEO endpoint is not used by this app.");
}

function assertNoSecrets(body, login, password) {
  if (body === undefined || body === null) return;
  const raw = JSON.stringify(body);
  if (password && raw.includes(password)) refused("Refusing to send a body that contains the API password.");
  if (login && login.length >= 4 && raw.includes(login)) refused("Refusing to send a body that contains the API login.");
}

function isAbort(error) {
  return Boolean(error && (error.name === "AbortError" || error.code === "ABORT_ERR"));
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers && response.headers.get ? response.headers.get("content-length") : NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new DataForSeoError("response_too_large", "DataForSEO response exceeded the size cap.");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (text.length > maxBytes) throw new DataForSeoError("response_too_large", "DataForSEO response exceeded the size cap.");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    size += step.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new DataForSeoError("response_too_large", "DataForSEO response exceeded the size cap.");
    }
    chunks.push(Buffer.from(step.value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function providerMessage(parsed, redact, status) {
  const raw = parsed && ((parsed.tasks && parsed.tasks[0] && parsed.tasks[0].status_message) || parsed.status_message);
  if (typeof raw !== "string" || !raw.trim()) return `DataForSEO HTTP ${status}.`;
  return redact(raw.replace(/[\u0000-\u001f]/g, " ")).slice(0, 240);
}

export function createLiveTransport(options = {}) {
  const login = typeof options.login === "string" ? options.login.trim() : "";
  const password = typeof options.password === "string" ? options.password.trim() : "";
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || UPSTREAM_TIMEOUT_MS;
  const redact = options.redact || ((value) => value);
  const maxBytes = options.maxBytes || MAX_UPSTREAM_BYTES;

  return {
    async request({ method, path, body }) {
      if (!login || !password) {
        throw new DataForSeoError("credentials_missing", "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required. No DataForSEO request was sent.");
      }
      if (/[\r\n]/.test(login) || /[\r\n]/.test(password)) {
        throw new DataForSeoError("credentials_invalid", "Credentials contain a line break. No DataForSEO request was sent.");
      }
      assertSafeRequest({ method, path, body });
      assertNoSecrets(body, login, password);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const auth = Buffer.from(`${login}:${password}`, "utf8").toString("base64");
        const response = await fetchImpl(`https://api.dataforseo.com${path}`, {
          method,
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
            ...(body === undefined ? {} : { "Content-Type": "application/json" })
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });
        const text = await readLimited(response, maxBytes);
        let parsed = null;
        if (text) {
          try {
            parsed = JSON.parse(text);
          } catch {
            throw new DataForSeoError("invalid_json", "DataForSEO returned a non-JSON response.");
          }
        }
        if (!response.ok) {
          throw new DataForSeoError("http_error", providerMessage(parsed, redact, response.status));
        }
        return parsed;
      } catch (error) {
        if (isAbort(error)) throw new DataForSeoError("timeout", "DataForSEO request timed out. It was not retried.");
        if (error instanceof DataForSeoError) throw error;
        throw new DataForSeoError("network_error", "The DataForSEO request failed before a usable response arrived. It was not retried.");
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
