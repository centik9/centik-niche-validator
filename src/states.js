import { normalizePlace } from "./normalize.js";
import { US_STATE_ABBREVIATIONS, US_STATE_NAMES } from "./us-states.js";

export function normalizeState(value, countryIso) {
  const spaced = normalizePlace(value);
  if (!spaced) return "";
  if (countryIso === "us") {
    if (US_STATE_NAMES.has(spaced)) return spaced;
    const compact = spaced.replace(/ /g, "");
    const expanded = US_STATE_ABBREVIATIONS.get(compact);
    if (expanded) return expanded;
  }
  return spaced;
}
