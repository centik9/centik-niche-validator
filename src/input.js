import { resolveCountry } from "./countries.js";
import { HttpError } from "./errors.js";
import { normalizePlace } from "./normalize.js";
import { normalizeState } from "./states.js";

const CONTROL = /[\u0000-\u001f\u007f]/u;
const NICHE = /^[\p{L}\p{N}][\p{L}\p{N}\s.'’&-]*$/u;
const PLACE = /^[\p{L}\p{N}][\p{L}\p{N}\s.'’-]*$/u;

function asObject(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "invalid_input", "JSON object expected.");
  }
  return raw;
}

function requiredText(value, label, min, max, pattern) {
  if (typeof value !== "string") throw new HttpError(400, "invalid_input", `${label} must be a string.`);
  const trimmed = value.trim();
  if (!trimmed) throw new HttpError(400, "invalid_input", `${label} is required.`);
  if (CONTROL.test(trimmed) || !pattern.test(trimmed)) {
    throw new HttpError(400, "invalid_input", `${label} contains unsupported characters.`);
  }
  if (trimmed.length < min || trimmed.length > max) {
    throw new HttpError(400, "invalid_input", `${label} must be ${min}-${max} characters.`);
  }
  return trimmed;
}

function parseMode(value) {
  if (value === undefined || value === null || value === "") return "example";
  if (value === "example" || value === "live") return value;
  throw new HttpError(400, "invalid_mode", "Mode must be example or live.");
}

function parseSide(side, label) {
  if (side === null) return null;
  if (!side || typeof side !== "object" || Array.isArray(side)) {
    throw new HttpError(400, "invalid_confirmation", `${label} confirmation must be an object or null.`);
  }
  if (!Number.isInteger(side.location_code) || side.location_code <= 0) {
    throw new HttpError(400, "invalid_confirmation", `${label} location_code must be the positive integer returned by resolve.`);
  }
  if (typeof side.location_name !== "string" || side.location_name.trim().length < 3 || side.location_name.length > 200) {
    throw new HttpError(400, "invalid_confirmation", `${label} location_name is missing.`);
  }
  if (typeof side.location_type !== "string" || side.location_type.trim().length < 2 || side.location_type.length > 40) {
    throw new HttpError(400, "invalid_confirmation", `${label} location_type is missing.`);
  }
  return {
    location_code: side.location_code,
    location_name: side.location_name,
    location_type: side.location_type
  };
}

function locationParts(raw) {
  const city = requiredText(raw.city, "City", 2, 80, PLACE);
  const state = requiredText(raw.state, "State", 2, 80, PLACE);
  const countryInput = requiredText(raw.country, "Country", 2, 80, PLACE);
  const country = resolveCountry(countryInput);
  if (!country.ok) throw new HttpError(400, "invalid_country", country.error);
  const cityNorm = normalizePlace(city);
  const stateNorm = normalizeState(state, country.iso);
  if (!cityNorm || !stateNorm) throw new HttpError(400, "invalid_location", "City and state could not be normalized.");
  return {
    city,
    state,
    country: countryInput,
    cityNorm,
    stateNorm,
    countryIso: country.iso,
    countryCanonical: country.canonicalName
  };
}

function rejectBroadGeography(body) {
  const type = body.geography_type;
  if (type === undefined || type === null || type === "" || type === "city") return;
  if (type === "county" || type === "metro") {
    throw new HttpError(
      400,
      "unsupported_geography",
      "The DataForSEO deep check accepts a city place only. A county or metro was not searched and was not treated as a city. No DataForSEO request was sent."
    );
  }
  throw new HttpError(400, "invalid_geography", "geography_type must be city, county, or metro.");
}

export function parseResolveInput(raw) {
  const body = asObject(raw);
  rejectBroadGeography(body);
  return {
    ...locationParts(body),
    mode: parseMode(body.mode)
  };
}

export function parseValidateInput(raw) {
  const body = asObject(raw);
  rejectBroadGeography(body);
  const niche = requiredText(body.niche, "Niche", 2, 80, NICHE);
  if (niche.split(/\s+/).length > 10) {
    throw new HttpError(400, "invalid_input", "Niche must be 10 words or fewer.");
  }
  if (!body.confirmed) {
    throw new HttpError(400, "confirmation_required", "Resolve the location and confirm that city, state, and country before validation.");
  }
  return {
    ...locationParts(body),
    niche,
    mode: parseMode(body.mode),
    geography_type: "city",
    margin_index: parseMarginIndex(body.margin_index),
    margin_estimated: body.margin_estimated === true,
    confirmed: {
      google_ads: parseSide(body.confirmed.google_ads, "google_ads"),
      google_maps: parseSide(body.confirmed.google_maps, "google_maps")
    }
  };
}

function parseMarginIndex(value) {
  if (value === undefined || value === null || value === "") return null;
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new HttpError(400, "invalid_input", "margin_index must be an integer from 0 to 100.");
  }
  return value;
}
