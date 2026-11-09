import { normalizePlace } from "./normalize.js";

const FOUNDATION_TERMS = [
  "foundation",
  "basement waterproof",
  "waterproofing",
  "crawl space",
  "crawlspace",
  "pier and beam",
  "slab leak",
  "expansive soil",
  "settlement",
  "french drain",
  "sump pump"
];

export function nicheProfile(niche) {
  const text = normalizePlace(niche);
  const matched = FOUNDATION_TERMS.find((term) => text.includes(term));
  if (matched) {
    return {
      id: "foundation_soil",
      label: "Foundation and soil-moisture profile",
      matched_term: matched,
      note: "Soil shrink-swell and county drought are eligible rank inputs only for this profile, and only when they were measured for a county. They are not a diagnosis and they are not demand."
    };
  }
  return {
    id: "neutral",
    label: "Neutral local-services profile",
    matched_term: null,
    note: "This niche is not on the foundation profile. Soil and drought are shown when measured and are given weight 0. They are not treated as evidence for an unrelated service."
  };
}

export const NEUTRAL_WEIGHTS = {
  housing_units: 50,
  owner_occupancy_rate: 50
};

export const FOUNDATION_WEIGHTS = {
  older_housing_share: 35,
  owner_occupancy_rate: 20,
  housing_units: 15,
  high_shrink_swell_share: 20,
  drought_pressure: 10
};
