import { knownIsoFromSegment } from "./countries.js";
import { normalizePlace, splitLocationName } from "./normalize.js";
import { readTask } from "./provider.js";
import { normalizeState } from "./states.js";

const CITY_TYPES = new Set(["city", "municipality"]);
const ADMIN_TYPES = new Set([
  "state",
  "region",
  "province",
  "territory",
  "governorate",
  "prefecture",
  "canton",
  "union territory",
  "autonomous community",
  "department",
  "district",
  "oblast"
]);

function emptyRejected() {
  return {
    wrong_type: 0,
    wrong_state: 0,
    wrong_country: 0,
    parent_unconfirmed: 0,
    duplicate_code: 0,
    unusable_row: 0
  };
}

function present(row, parent, codeSource) {
  return {
    location_code: row.location_code,
    location_name: row.location_name,
    location_type: row.location_type,
    country_iso_code: String(row.country_iso_code || "").toUpperCase(),
    parent: parent
      ? {
          location_code: parent.location_code,
          location_name: parent.location_name,
          location_type: parent.location_type
        }
      : null,
    code_source: codeSource
  };
}

function confirmParent(row, byCode, stateNorm, countryIso) {
  let current = row;
  const seen = new Set([row.location_code]);
  for (let hop = 0; hop < 6; hop += 1) {
    const parentCode = current.location_code_parent;
    if (!Number.isInteger(parentCode) || seen.has(parentCode)) return null;
    seen.add(parentCode);
    const parent = byCode.get(parentCode);
    if (!parent) return null;
    const parentIso = String(parent.country_iso_code || "").toLowerCase();
    if (parentIso && parentIso !== countryIso) return null;
    const type = String(parent.location_type || "").toLowerCase();
    if (ADMIN_TYPES.has(type)) {
      const parentPlace = normalizeState(splitLocationName(parent.location_name).place, countryIso);
      if (parentPlace === stateNorm) return parent;
    }
    current = parent;
  }
  return null;
}

export function matchCity(rows, query) {
  const list = Array.isArray(rows) ? rows : [];
  const byCode = new Map();
  const duplicateCodes = new Set();
  for (const row of list) {
    if (!row || !Number.isInteger(row.location_code)) continue;
    if (byCode.has(row.location_code)) duplicateCodes.add(row.location_code);
    else byCode.set(row.location_code, row);
  }
  for (const code of duplicateCodes) byCode.delete(code);

  const rejected = emptyRejected();
  rejected.duplicate_code = duplicateCodes.size;
  const otherRegions = new Map();
  const otherCountries = new Set();
  const confirmed = [];
  let sawUnconfirmed = false;

  for (const row of list) {
    if (!row || typeof row.location_name !== "string" || !Number.isInteger(row.location_code)) {
      rejected.unusable_row += 1;
      continue;
    }
    if (duplicateCodes.has(row.location_code)) continue;

    const parts = splitLocationName(row.location_name);
    if (normalizePlace(parts.place) !== query.cityNorm) continue;

    const rowIso = String(row.country_iso_code || "").toLowerCase();
    if (rowIso !== query.countryIso) {
      if (rowIso) otherCountries.add(rowIso.toUpperCase());
      rejected.wrong_country += 1;
      continue;
    }

    const suffixIso = knownIsoFromSegment(parts.country);
    if (suffixIso && suffixIso !== query.countryIso) {
      rejected.wrong_country += 1;
      continue;
    }

    const type = String(row.location_type || "").toLowerCase();
    if (!CITY_TYPES.has(type)) {
      rejected.wrong_type += 1;
      continue;
    }

    const regionNorms = parts.regions.map((region) => normalizeState(region, query.countryIso));
    if (!regionNorms.includes(query.stateNorm)) {
      rejected.wrong_state += 1;
      parts.regions.forEach((region, index) => {
        const norm = regionNorms[index];
        if (norm && norm !== query.stateNorm && !otherRegions.has(norm)) {
          otherRegions.set(norm, region.trim());
        }
      });
      continue;
    }

    const parent = confirmParent(row, byCode, query.stateNorm, query.countryIso);
    if (!parent) {
      rejected.parent_unconfirmed += 1;
      sawUnconfirmed = true;
      continue;
    }
    confirmed.push(present(row, parent, query.codeSource));
  }

  confirmed.sort((a, b) => a.location_name.localeCompare(b.location_name) || a.location_code - b.location_code);

  let outcome = "unsupported";
  if (confirmed.length === 1) outcome = "matched";
  else if (confirmed.length > 1) outcome = "ambiguous";
  else if (sawUnconfirmed) outcome = "unconfirmed";

  return {
    outcome,
    match: confirmed.length === 1 ? confirmed[0] : null,
    matches: confirmed,
    same_city_other_regions: [...otherRegions.values()].sort((a, b) => a.localeCompare(b)),
    same_name_other_countries: [...otherCountries].sort(),
    rejected_summary: rejected,
    code_source: query.codeSource
  };
}

export function productPaths(product, iso) {
  if (product === "google_ads") return `/v3/keywords_data/google_ads/locations/${iso}`;
  if (product === "google_maps") return `/v3/serp/google/locations/${iso}`;
  throw new Error(`Unknown location product: ${product}`);
}

export function createLocationDirectory(transport, options = {}) {
  const ttlMs = options.ttlMs ?? 6 * 60 * 60 * 1000;
  const clock = options.clock || Date.now;
  const cache = new Map();

  return {
    async list(product, countryIso) {
      const key = `${product}:${countryIso}`;
      const now = clock();
      const hit = cache.get(key);
      if (hit && now - hit.at < ttlMs) {
        return { rows: hit.rows, cache: "hit" };
      }
      const payload = await transport.request({
        method: "GET",
        path: productPaths(product, countryIso)
      });
      const rows = extractLocationRows(payload);
      cache.set(key, { at: now, rows });
      return { rows, cache: "miss" };
    }
  };
}

export function extractLocationRows(payload) {
  const read = readTask(payload);
  if (!read.ok || !Array.isArray(read.result)) {
    const error = new Error(read.ok ? "Location list result was not an array." : read.message);
    error.code = "provider_error";
    error.providerStatus = read.status_code;
    throw error;
  }
  return read.result;
}

export function combineLocationOutcomes(adsOutcome, mapsOutcome) {
  const both = [adsOutcome, mapsOutcome];
  if (both.every((item) => item === "failed")) return "failed";
  if (both.some((item) => item === "ambiguous")) return "ambiguous";
  if (both.some((item) => item === "unconfirmed")) return "unconfirmed";
  if (both.some((item) => item === "failed")) return "partial_failure";
  if (both.every((item) => item === "matched")) return "matched";
  if (both.some((item) => item === "matched") && both.some((item) => item === "unsupported")) return "partial_match";
  if (both.every((item) => item === "unsupported")) return "unsupported";
  return "unsupported";
}
