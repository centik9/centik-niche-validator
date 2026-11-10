export const SERVICE_NAME = "centik-niche-validator";
export const VERSION = "0.1.0";
export const HOST = "0.0.0.0";

export const MAPS_DEPTH = 100;
export const ORGANIC_DEPTH = 10;
export const LANGUAGE_CODE = "en";
export const MAPS_DEVICE = "desktop";
export const MAPS_OS = "windows";

export const MAX_BODY_BYTES = 8 * 1024;
export const BODY_TIMEOUT_MS = 10_000;
export const UPSTREAM_TIMEOUT_MS = 45_000;
export const TRENDS_UPSTREAM_TIMEOUT_MS = 55_000;
export const MAX_UPSTREAM_BYTES = 25 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 120_000;
export const LOCATION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export const DEFAULT_RATE_LIMITS = {
  api: { windowMs: 60_000, max: 30 },
  live: { windowMs: 10 * 60_000, max: 4 },
  globalLive: { windowMs: 60_000, max: 6 }
};

export const VOLUME_UNIT = "approximate average monthly searches";
export const VOLUME_SOURCE = "Google Ads via DataForSEO Keywords Data, POST /v3/keywords_data/google_ads/search_volume/live";
export const CPC_UNIT = "USD per click";
export const MAPS_SOURCE = "Google Maps via DataForSEO SERP, POST /v3/serp/google/maps/live/advanced";
export const ORGANIC_SOURCE = "Google organic SERP via DataForSEO, POST /v3/serp/google/organic/live/advanced";
export const TRENDS_SOURCE = "Google Trends explore via DataForSEO, POST /v3/keywords_data/google_trends/explore/live";

export const EXAMPLE_BANNER = "Example data. Not a real market measurement. Numbers come from a built-in fixture, not DataForSEO.";
export const LIVE_BANNER = "Live DataForSEO response. Maps results are a capped sample, not a census. Buyers are not verified. The index is a heuristic, not a valuation.";

export const SEARCH_VOLUME_PATH = "/v3/keywords_data/google_ads/search_volume/live";
export const MAPS_PATH = "/v3/serp/google/maps/live/advanced";
export const ORGANIC_PATH = "/v3/serp/google/organic/live/advanced";
export const TRENDS_PATH = "/v3/keywords_data/google_trends/explore/live";
export const USER_DATA_PATH = "/v3/appendix/user_data";
export const KEYWORD_IDEAS_PATH = "/v3/dataforseo_labs/google/keyword_ideas/live";
export const KEYWORD_IDEAS_LIMIT = 40;
export const US_LOCATION_CODE = 2840;
export const KEYWORD_IDEAS_SOURCE = "Google keyword ideas via DataForSEO Labs, POST /v3/dataforseo_labs/google/keyword_ideas/live";

export function adsLocationsPath(iso) {
  return `/v3/keywords_data/google_ads/locations/${iso}`;
}

export function mapsLocationsPath(iso) {
  return `/v3/serp/google/locations/${iso}`;
}

export function trendsLocationsPath(iso) {
  return `/v3/keywords_data/google_trends/locations/${iso}`;
}
