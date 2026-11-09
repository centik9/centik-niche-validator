import { MAPS_PATH, ORGANIC_PATH, SEARCH_VOLUME_PATH, TRENDS_PATH, USER_DATA_PATH } from "./config.js";
import { assertSafeRequest } from "./dataforseo.js";
import { DataForSeoError } from "./errors.js";
import { exampleRows } from "./gazetteer.js";
import { clusterKey } from "./keyword-clusters.js";

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

function phraseVolume(keyword, core, kind) {
  if (kind === "missing") return null;
  if (kind === "zero") return 0;
  const sameCluster = clusterKey(keyword) === clusterKey(core);
  if (kind === "uneven") return sameCluster ? 80 : 2;
  return sameCluster ? 320 : 10;
}

function keywordRow(keyword, core, locationCode, kind) {
  const volume = phraseVolume(keyword, core, kind);
  const coreRow = keyword.trim().toLowerCase() === String(core || "").trim().toLowerCase();
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
    spell: kind === "spell" && coreRow ? "emergency plumber" : null,
    location_code: locationCode,
    language_code: "en",
    search_partners: false,
    competition: volume === 0 ? "LOW" : "MEDIUM",
    competition_index: volume === 0 ? 0 : 42,
    search_volume: volume,
    low_top_of_page_bid: volume === 0 ? null : 3.25,
    high_top_of_page_bid: volume === 0 ? null : 11.5,
    cpc: volume === 0 ? 0 : (coreRow ? 8.5 : 4.25),
    monthly_searches: months(kind === "uneven" && coreRow ? 100 : volume)
  };
  if (kind === "missing_cpc" && coreRow) {
    return { ...row, cpc: null, low_top_of_page_bid: null, high_top_of_page_bid: null };
  }
  return row;
}

function organicResult(keyword, locationCode) {
  const pages = [
    ["https://www.yelp.com/search?find_desc=plumber", "www.yelp.com", "Yelp plumbers"],
    ["https://austinplumbing.example/emergency", "austinplumbing.example", "Austin Plumbing"],
    ["https://www.angi.com/plumbers", "www.angi.com", "Angi plumbers"],
    ["https://www.thumbtack.com/tx/austin/plumbers", "www.thumbtack.com", "Thumbtack plumbers"],
    ["https://local-plumber.example/", "local-plumber.example", "Local Plumber"],
    ["https://www.bbb.org/austin/plumbers", "www.bbb.org", "BBB plumbers"],
    ["https://www.yellowpages.com/austin-tx/plumbers", "www.yellowpages.com", "Yellow Pages"],
    ["https://roundrockplumbing.example/", "roundrockplumbing.example", "Round Rock Plumbing"],
    ["https://www.houzz.com/professionals/plumbers", "www.houzz.com", "Houzz plumbers"],
    ["https://www.homeadvisor.com/plumbers", "www.homeadvisor.com", "HomeAdvisor plumbers"]
  ];
  const items = [
    { type: "paid", rank_absolute: 1, title: "Paid ad", url: "https://ads.example/plumber", domain: "ads.example" },
    { type: "people_also_ask", rank_absolute: 2, title: "People also ask" }
  ];
  pages.forEach((page, index) => {
    items.push({
      type: "organic",
      rank_group: index + 1,
      rank_absolute: index + 3,
      title: page[2],
      url: page[0],
      domain: page[1]
    });
  });
  return [{
    keyword,
    type: "organic",
    location_code: locationCode,
    language_code: "en",
    items_count: items.length,
    items
  }];
}

function trendsGraph(keyword, locationCode) {
  const flat = [48, 50, 47, 51, 49, 52, 50, 48, 49, 51, 50, 47];
  const seasonal = /hvac|heating|cooling/i.test(keyword);
  const monthValues = seasonal ? [20, 22, 30, 45, 70, 95, 100, 92, 60, 35, 24, 20] : flat;
  const data = [];
  for (let month = 1; month <= 12; month += 1) {
    for (let week = 0; week < 4; week += 1) {
      const day = Math.min(1 + week * 7, 28);
      const date = `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      data.push({
        date_from: date,
        date_to: date,
        timestamp: Date.UTC(2025, month - 1, day) / 1000,
        missing_data: false,
        values: [monthValues[month - 1]]
      });
    }
  }
  return [{
    keywords: [keyword],
    type: "trends",
    location_code: locationCode,
    language_code: "en",
    items_count: 1,
    items: [{
      type: "google_trends_graph",
      title: "Interest over time",
      keywords: [keyword],
      data
    }]
  }];
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
    for (let n = 1; n <= 100; n += 1) items.push(organic(n, "Austin"));
    return [{
      keyword,
      type: "maps",
      location_code: locationCode,
      language_code: "en",
      se_results_count: 1000,
      items_count: 100,
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
      if (method === "GET" && path === USER_DATA_PATH) {
        return { tasks: [{ status_code: 20000, result: [{ money: { total: 0, balance: 0 } }] }] };
      }
      if (method === "GET" && /\/locations\/[a-z]{2}$/.test(path)) {
        const iso = path.slice(-2);
        let product = "google_maps";
        if (path.includes("google_ads")) product = "google_ads";
        else if (path.includes("google_trends")) product = "google_trends";
        const rows = exampleRows(product).filter((row) => String(row.country_iso_code).toLowerCase() === iso);
        return envelope(rows, 0);
      }
      const task = taskOf(body);
      if (method === "POST" && path === SEARCH_VOLUME_PATH) {
        const keywords = Array.isArray(task.keywords) ? task.keywords : [];
        const core = keywords[0];
        const spec = fixtureFor(core);
        if (spec.volume === "failed") return failureEnvelope();
        return envelope(keywords.map((keyword) => keywordRow(keyword, core, task.location_code, spec.volume)), 0);
      }
      if (method === "POST" && path === MAPS_PATH) {
        const spec = fixtureFor(task.keyword);
        if (spec.maps === "timeout") {
          throw new DataForSeoError("timeout", "Example fixture timeout. No network call was made.");
        }
        if (spec.maps === "failed") return failureEnvelope();
        return envelope(mapsResult(spec.maps, task.keyword, task.location_code), 0);
      }
      if (method === "POST" && path === ORGANIC_PATH) {
        return envelope(organicResult(task.keyword, task.location_code), 0);
      }
      if (method === "POST" && path === TRENDS_PATH) {
        const keyword = task.keywords && task.keywords[0];
        return envelope(trendsGraph(keyword, task.location_code), 0);
      }
      throw new DataForSeoError("refused", "Example transport has no fixture for that request.");
    }
  };
}

export const EXAMPLE_FIXTURE_NICHES = Object.keys(FIXTURES);
