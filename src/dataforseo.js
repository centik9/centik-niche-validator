import {
  LANGUAGE_CODE,
  MAPS_DEPTH,
  MAPS_DEVICE,
  MAPS_OS,
  MAPS_PATH,
  MAX_UPSTREAM_BYTES,
  ORGANIC_DEPTH,
  ORGANIC_PATH,
  SEARCH_VOLUME_PATH,
  TRENDS_PATH,
  UPSTREAM_TIMEOUT_MS,
  USER_DATA_PATH
} from "./config.js";
import { MAX_PACKED_KEYWORDS } from "./volume-keywords.js";
import { DataForSeoError } from "./errors.js";

const LOCATION_GET = /^\/v3\/(?:keywords_data\/google_ads|keywords_data\/google_trends|serp\/google)\/locations\/[a-z]{2}$/;
const VOLUME_FIELDS = new Set(["keywords", "location_code", "language_code", "search_partners"]);
const MAPS_FIELDS = new Set(["keyword", "location_code", "language_code", "depth", "device", "os", "search_this_area"]);
const ORGANIC_FIELDS = new Set(["keyword", "location_code", "language_code", "depth", "device", "os"]);
const TRENDS_FIELDS = new Set(["keywords", "location_code", "language_code", "type", "time_range", "item_types"]);
const SEARCH_OPERATOR = /\b(?:allinanchor|allintext|allintitle|allinurl|inanchor|intext|intitle|inurl|filetype|define|definition|cache|site|link|info|id)\s*:/i;

function refused(message) {
  throw new DataForSeoError("refused", message);
}

function assertKeyword(keyword, label) {
  if (typeof keyword !== "string" || keyword.trim().length < 2 || keyword.length > 80) {
    refused(`${label} must be 2-80 characters.`);
  }
  if (keyword.trim().split(/\s+/).length > 10) refused(`${label} must be 10 words or fewer.`);
}

function assertLocationCode(task) {
  if (!Number.isInteger(task.location_code) || task.location_code <= 0) refused("A confirmed location_code is required.");
}

function assertNoLocationAlias(task) {
  if ("location_name" in task || "location_coordinate" in task) refused("location_name and coordinates are not sent.");
}

function assertOneTask(body, label) {
  if (!Array.isArray(body) || body.length !== 1) refused(`${label} requests must contain exactly one task.`);
  const task = body[0];
  if (!task || typeof task !== "object" || Array.isArray(task)) refused(`${label} task is missing.`);
  return task;
}

export function assertSafeRequest({ method, path, body }) {
  if (method === "GET" && (LOCATION_GET.test(path) || path === USER_DATA_PATH)) {
    if (body !== undefined && body !== null) refused("This GET does not take a body.");
    return;
  }
  if (method === "POST" && path === SEARCH_VOLUME_PATH) {
    const task = assertOneTask(body, "Search volume");
    if (!Array.isArray(task.keywords) || task.keywords.length < 1 || task.keywords.length > MAX_PACKED_KEYWORDS) {
      refused(`Search volume accepts 1 to ${MAX_PACKED_KEYWORDS} keywords in one task.`);
    }
    const seen = new Set();
    for (const keyword of task.keywords) {
      assertKeyword(keyword, "Keyword");
      const key = keyword.trim().toLowerCase();
      if (seen.has(key)) refused("Duplicate keywords are not allowed in one search volume task.");
      seen.add(key);
    }
    assertLocationCode(task);
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
    const task = assertOneTask(body, "Maps");
    assertKeyword(task.keyword, "Keyword");
    assertLocationCode(task);
    if (task.language_code !== LANGUAGE_CODE) refused("language_code must be en.");
    if (task.depth !== MAPS_DEPTH) refused("Maps depth must be exactly 100.");
    if (task.search_this_area !== true) refused("search_this_area must be true.");
    if (task.device !== MAPS_DEVICE || task.os !== MAPS_OS) refused("Maps device and os are fixed.");
    assertNoLocationAlias(task);
    const extra = Object.keys(task).filter((key) => !MAPS_FIELDS.has(key));
    if (extra.length) refused(`Unexpected Maps fields: ${extra.join(",")}.`);
    return;
  }
  if (method === "POST" && path === ORGANIC_PATH) {
    const task = assertOneTask(body, "Organic");
    assertKeyword(task.keyword, "Keyword");
    if (SEARCH_OPERATOR.test(task.keyword)) refused("Organic keywords must not include search operators.");
    assertLocationCode(task);
    if (task.language_code !== LANGUAGE_CODE) refused("language_code must be en.");
    if (task.depth !== ORGANIC_DEPTH) refused("Organic depth must be exactly 10.");
    if (task.device !== MAPS_DEVICE || task.os !== MAPS_OS) refused("Organic device and os are fixed.");
    assertNoLocationAlias(task);
    const extra = Object.keys(task).filter((key) => !ORGANIC_FIELDS.has(key));
    if (extra.length) refused(`Unexpected organic fields: ${extra.join(",")}.`);
    return;
  }
  if (method === "POST" && path === TRENDS_PATH) {
    const task = assertOneTask(body, "Trends");
    if (!Array.isArray(task.keywords) || task.keywords.length !== 1) {
      refused("Trends sends one keyword so the 0-100 series is not rescaled against a comparison term.");
    }
    assertKeyword(task.keywords[0], "Keyword");
    assertLocationCode(task);
    if (task.language_code !== LANGUAGE_CODE) refused("language_code must be en.");
    if (task.type !== "web") refused("Trends type must be web.");
    if (task.time_range !== "past_12_months") refused("Trends time_range must be past_12_months.");
    if (!Array.isArray(task.item_types) || task.item_types.length !== 1 || task.item_types[0] !== "google_trends_graph") {
      refused("Trends item_types must be exactly google_trends_graph.");
    }
    if ("location_name" in task || "date_from" in task || "date_to" in task || "category_code" in task) {
      refused("Trends location_name, custom dates, and category_code are not sent.");
    }
    const extra = Object.keys(task).filter((key) => !TRENDS_FIELDS.has(key));
    if (extra.length) refused(`Unexpected Trends fields: ${extra.join(",")}.`);
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
    async request({ method, path, body, timeoutMs: callTimeout }) {
      if (!login || !password) {
        throw new DataForSeoError("credentials_missing", "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required. No DataForSEO request was sent.");
      }
      if (/[\r\n]/.test(login) || /[\r\n]/.test(password)) {
        throw new DataForSeoError("credentials_invalid", "Credentials contain a line break. No DataForSEO request was sent.");
      }
      assertSafeRequest({ method, path, body });
      assertNoSecrets(body, login, password);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), callTimeout || timeoutMs);
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
