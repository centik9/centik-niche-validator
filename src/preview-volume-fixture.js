import { assertSafeRequest } from "./dataforseo.js";
import { createExampleTransport } from "./example-transport.js";

export const PREVIEW_NICHE = "crawl space encapsulation";

// Example gazetteer codes. They are not DataForSEO location codes.
const STATE = 9000026;
const CITY = 9001022;
const DMA = 9002022;
const BING_STATE = 9003026;
const COUNTRY = 9000001;

export const PREVIEW_RAW_VOLUMES = {
  metro: 1800,
  state: 20000,
  bing: 9000
};

const ADS_EXTRA = [
  {
    location_code: STATE,
    location_name: "North Carolina,United States",
    location_code_parent: COUNTRY,
    country_iso_code: "US",
    location_type: "State"
  },
  {
    location_code: CITY,
    location_name: "Leland,North Carolina,United States",
    location_code_parent: STATE,
    country_iso_code: "US",
    location_type: "City"
  },
  {
    location_code: DMA,
    location_name: "Leland,North Carolina,United States",
    location_code_parent: COUNTRY,
    country_iso_code: "US",
    location_type: "DMA Region"
  }
];

function shift(rows, amount) {
  const map = new Map(rows.map((row) => [row.location_code, row.location_code + amount]));
  return rows.map((row) => ({
    ...row,
    location_code: map.get(row.location_code),
    location_code_parent: row.location_code_parent == null ? null : map.get(row.location_code_parent)
  }));
}

export function previewNiche(keyword) {
  return String(keyword || "").trim().toLowerCase() === PREVIEW_NICHE;
}

function taskOf(body) {
  return Array.isArray(body) ? body[0] : body || {};
}

function appendRows(payload, rows) {
  const copy = structuredClone(payload);
  const task = copy.tasks && copy.tasks[0];
  if (!task || !Array.isArray(task.result)) return copy;
  task.result.push(...rows);
  task.result_count = task.result.length;
  return copy;
}

function volumeEnvelope(keywords, locationCode, volume) {
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
        cost: 0,
        result_count: keywords.length,
        result: keywords.map((keyword, index) => ({
          keyword,
          spell: null,
          location_code: locationCode,
          language_code: "en",
          search_partners: false,
          competition: index === 0 && volume != null ? "LOW" : null,
          competition_index: index === 0 && volume != null ? 10 : null,
          search_volume: index === 0 ? volume : null,
          low_top_of_page_bid: null,
          high_top_of_page_bid: null,
          cpc: index === 0 && volume != null ? 4.5 : null,
          monthly_searches: null
        }))
      }
    ]
  };
}

function volumeFor(path, locationCode) {
  if (String(path).includes("/bing/")) {
    return locationCode === BING_STATE ? PREVIEW_RAW_VOLUMES.bing : null;
  }
  if (locationCode === DMA) return PREVIEW_RAW_VOLUMES.metro;
  if (locationCode === STATE) return PREVIEW_RAW_VOLUMES.state;
  return null;
}

function extraRows(path) {
  if (path.includes("/bing/locations/")) {
    return [{
      location_code: BING_STATE,
      location_name: "North Carolina,United States",
      location_code_parent: null,
      country_iso_code: "US",
      location_type: "State"
    }];
  }
  if (path.includes("/google_ads/locations/")) return structuredClone(ADS_EXTRA);
  if (path.includes("/serp/google/locations/")) return shift(ADS_EXTRA, 100000);
  if (path.includes("/google_trends/locations/")) return shift(ADS_EXTRA, 200000);
  return null;
}

// Example transport plus one labelled fixture: Leland, NC crawl space encapsulation.
// City Google Ads volume is blank. Metro, state, and Bing return raw example numbers.
// Nothing in this transport contacts DataForSEO.
export function createPreviewExampleTransport() {
  const base = createExampleTransport();
  return {
    async request(args) {
      assertSafeRequest(args);
      const path = args.path || "";
      if (args.method === "GET") {
        const extra = extraRows(path);
        if (!extra) return base.request(args);
        return appendRows(await base.request(args), extra);
      }
      const task = taskOf(args.body);
      const keywords = Array.isArray(task.keywords) ? task.keywords : [];
      const volumePost = args.method === "POST" && /search_volume\/live$/.test(path);
      if (volumePost && previewNiche(keywords[0])) {
        return volumeEnvelope(keywords, task.location_code, volumeFor(path, task.location_code));
      }
      return base.request(args);
    }
  };
}
