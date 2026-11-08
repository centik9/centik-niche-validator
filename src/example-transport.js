import { MAPS_PATH, SEARCH_VOLUME_PATH } from "./config.js";
import { assertSafeRequest } from "./dataforseo.js";
import { DataForSeoError } from "./errors.js";
import { exampleRows } from "./gazetteer.js";

const FIXTURES = {
  "missing volume": { volume: "missing", maps: "default" },
  "zero volume": { volume: "zero", maps: "default" },
  "zero volume saturated": { volume: "zero", maps: "saturated" },
  "missing cpc": { volume: "missing_cpc", maps: "default" },
  "maps failed": { volume: "default", maps: "failed" },
  "maps empty": { volume: "default", maps: "empty" },
  "maps duplicates": { volume: "default", maps: "duplicates" },
  "demand failed": { volume: "failed", maps: "default" },
  "spellcheck test": { volume: "spell", maps: "default" },
  "uneven months": { volume: "uneven", maps: "default" },
  "maps timeout": { volume: "default", maps: "timeout" }
};

function envelope(result, cost = 0) {
  return {
    version: "example",
    status_code: 20000,
    status_message: "Ok.",
    tasks_count: 1,
    tasks_error: 0,
    tasks: [
      {
        status_code: 20000,
        status_message: "Ok.",
        cost,
        result_count: Array.isArray(result) ? result.length : 0,
        result
      }
    ]
  };
}

function failureEnvelope() {
  return {
    version: "example",
    status_code: 20000,
    status_message: "Ok.",
    tasks_count: 1,
    tasks_error: 1,
    tasks: [
      {
        status_code: 50000,
        status_message: "Example fixture failure.",
        cost: 0,
        result: null
      }
    ]
  };
}

function months(value) {
  const rows = [];
  for (let month = 1; month <= 12; month += 1) {
    rows.push({ year: 2024, month, search_volume: value });
  }
  return rows;
}

function keywordRow(keyword, locationCode, kind) {
  if (kind === "missing") {
    return {
      keyword,
      spell: null,
      location_code: locationCode,
      language_code: "en",
      search_partners: false,
      competition: null,
      competition_index: null,
      search_volume: null,
      low_top_of_page_bid: null,
      high_top_of_page_bid: null,
      cpc: null,
      monthly_searches: null
    };
  }
  const row = {
    keyword,
    spell: kind === "spell" ? "emergency plumber" : null,
    location_code: locationCode,
    language_code: "en",
    search_partners: false,
    competition: "MEDIUM",
    competition_index: 42,
    search_volume: 320,
    low_top_of_page_bid: 3.25,
    high_top_of_page_bid: 11.5,
    cpc: 8.5,
    monthly_searches: months(320)
  };
  if (kind === "zero") {
    return {
      ...row,
      competition: "LOW",
      competition_index: 0,
      search_volume: 0,
      low_top_of_page_bid: null,
      high_top_of_page_bid: null,
      cpc: 0,
      monthly_searches: months(0)
    };
  }
  if (kind === "missing_cpc") {
    return { ...row, cpc: null, low_top_of_page_bid: null, high_top_of_page_bid: null };
  }
  if (kind === "uneven") {
    return { ...row, search_volume: 80, monthly_searches: months(100) };
  }
  return row;
}

function organic(n, city) {
  return {
    type: "maps_search",
    rank_absolute: n,
    title: `Example Business ${n}`,
    address: `${n} Example Street`,
    address_info: { city, region: "Texas", country_code: "US" },
    place_id: `example-place-${n}`,
    cid: `example-cid-${n}`,
    rating: { rating_type: "Max5", value: 4.5, votes_count: 10 + n, rating_max: 5 },
    is_claimed: n === 1,
    is_directory_item: false,
    category: "Example category"
  };
}

function mapsResult(kind, keyword, locationCode) {
  if (kind === "empty") {
    return [{
      keyword,
      type: "maps",
      location_code: locationCode,
      language_code: "en",
      se_results_count: 0,
      items_count: 0,
      items: []
    }];
  }
  if (kind === "saturated") {
    const items = [];
    for (let n = 1; n <= 20; n += 1) items.push(organic(n, "Austin"));
    return [{
      keyword,
      type: "maps",
      location_code: locationCode,
      language_code: "en",
      se_results_count: 1000,
      items_count: 20,
      items
    }];
  }
  if (kind === "duplicates") {
    return [{
      keyword,
      type: "maps",
      location_code: locationCode,
      language_code: "en",
      se_results_count: 0,
      items_count: 8,
      items: [
        organic(1, "Austin"),
        { ...organic(1, "Austin"), rank_absolute: 2, title: "Example Business 1 duplicate" },
        { ...organic(2, "Austin"), rank_absolute: 3, title: "Beta Plumbing", place_id: "place-beta", cid: "cid-beta" },
        { ...organic(3, "Austin"), rank_absolute: 4, title: "Gamma Plumbing", address: "3 Main St", place_id: null, cid: null },
        { ...organic(3, "Austin"), rank_absolute: 5, title: "Gamma Plumbing", address: "3 Main St", place_id: null, cid: null },
        { ...organic(4, "Austin"), rank_absolute: 6, title: "Directory Co", place_id: "place-dir", is_directory_item: true },
        { ...organic(5, "Austin"), type: "maps_paid_item", rank_absolute: 7, title: "Paid Only", place_id: "place-paid" },
        { ...organic(2, "Austin"), type: "maps_paid_item", rank_absolute: 8, title: "Beta Ad", place_id: "place-beta" }
      ]
    }];
  }
  const items = [];
  for (let n = 1; n <= 12; n += 1) items.push(organic(n, n === 12 ? "Round Rock" : "Austin"));
  return [{
    keyword,
    type: "maps",
    location_code: locationCode,
    language_code: "en",
    se_results_count: 0,
    items_count: 12,
    items
  }];
}

function fixtureFor(keyword) {
  return FIXTURES[String(keyword || "").trim().toLowerCase()] || { volume: "default", maps: "default" };
}

function taskOf(body) {
  return Array.isArray(body) ? body[0] : body || {};
}

export function createExampleTransport() {
  return {
    async request({ method, path, body }) {
      assertSafeRequest({ method, path, body });
      if (method === "GET" && /^\/v3\/(?:keywords_data\/google_ads|serp\/google)\/locations\/[a-z]{2}$/.test(path)) {
        const iso = path.slice(-2);
        const product = path.includes("google_ads") ? "google_ads" : "google_maps";
        const rows = exampleRows(product).filter((row) => String(row.country_iso_code).toLowerCase() === iso);
        return envelope(rows, 0);
      }
      const task = taskOf(body);
      if (method === "POST" && path === SEARCH_VOLUME_PATH) {
        const keyword = task.keywords && task.keywords[0];
        const spec = fixtureFor(keyword);
        if (spec.volume === "failed") return failureEnvelope();
        return envelope([keywordRow(keyword, task.location_code, spec.volume)], 0);
      }
      if (method === "POST" && path === MAPS_PATH) {
        const spec = fixtureFor(task.keyword);
        if (spec.maps === "timeout") {
          throw new DataForSeoError("timeout", "Example fixture timeout. No network call was made.");
        }
        if (spec.maps === "failed") return failureEnvelope();
        return envelope(mapsResult(spec.maps, task.keyword, task.location_code), 0);
      }
      throw new DataForSeoError("refused", "Example transport has no fixture for that request.");
    }
  };
}

export const EXAMPLE_FIXTURE_NICHES = Object.keys(FIXTURES);
