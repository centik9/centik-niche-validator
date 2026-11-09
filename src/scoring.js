import { isMeasuredStatus } from "./measurement.js";

export const MODEL_ID = "centik-heuristic-v1";
export const DEMAND_WEIGHT_PERCENT = 65;
export const OPENNESS_WEIGHT_PERCENT = 35;
export const CONFIDENCE_CAP_HUNDREDTHS = 75;
export const CONFIDENCE_FLOOR_HUNDREDTHS = 20;

export const DEMAND_BANDS = [
  { min: 0, max: 0, index: 0, label: "Measured zero" },
  { min: 1, max: 9, index: 15, label: "Very low monthly average" },
  { min: 10, max: 49, index: 35, label: "Low monthly average" },
  { min: 50, max: 199, index: 55, label: "Moderate monthly average" },
  { min: 200, max: 999, index: 75, label: "High monthly average" },
  { min: 1000, max: null, index: 90, label: "Very high monthly average" }
];

export const FORMULA = {
  demand_index: "Select the inclusive band containing search_volume. The highest band index is 90, not 100.",
  sample_openness: "100 - (100 * min(unique_organic_listings, requested_depth) / requested_depth). requested_depth is 100.",
  overall: "round_half_up((65 * demand_index + 35 * sample_openness) / 10) / 10. Calculated only when both inputs are measured numbers and unique organic listings is greater than zero.",
  rounding: "The tenth is rounded half away from zero with integer arithmetic, so binary floating point does not decide it.",
  confidence: "Start at 35 hundredths. Add 15 when at least 6 monthly values are numeric, plus 5 more when at least 12 are numeric, plus 10 when both products resolved to City or Municipality. Subtract 10 when the organic sample fills the depth cap, and 5 when Google Ads spell-corrects the keyword. Clamp between 20 and 75 hundredths. Withheld when the combined index is withheld."
};

export function bandFor(searchVolume) {
  for (const band of DEMAND_BANDS) {
    if (searchVolume < band.min) continue;
    if (band.max === null || searchVolume <= band.max) return band;
  }
  return null;
}

export function sampleOpenness(unique, depth) {
  const used = Math.min(Math.max(unique, 0), depth);
  return 100 - (100 * used) / depth;
}

export function overallFromParts(demandIndex, openness) {
  const numerator = DEMAND_WEIGHT_PERCENT * demandIndex + OPENNESS_WEIGHT_PERCENT * openness;
  const tenths = Math.round(numerator / 10);
  return {
    tenths,
    value: tenths / 10,
    display: formatTenths(tenths)
  };
}

export function formatTenths(tenths) {
  const sign = tenths < 0 ? "-" : "";
  const abs = Math.abs(tenths);
  return `${sign}${Math.trunc(abs / 10)}.${abs % 10}`;
}

function formatHundredths(hundredths) {
  const sign = hundredths < 0 ? "-" : "";
  const abs = Math.abs(hundredths);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function confidenceAdjustments(input) {
  return [
    {
      id: "base",
      hundredths: 35,
      applied: true,
      reason: "One keyword, approximate Google Ads volumes, and a Maps sample capped at 20."
    },
    {
      id: "six_monthly_values",
      hundredths: 15,
      applied: input.numericMonths >= 6,
      reason: "At least 6 monthly search values in the payload are numeric."
    },
    {
      id: "twelve_monthly_values",
      hundredths: 5,
      applied: input.numericMonths >= 12,
      reason: "At least 12 monthly search values in the payload are numeric. This is added on top of the six-month adjustment."
    },
    {
      id: "city_locations",
      hundredths: 10,
      applied: input.bothCityLike,
      reason: "Both the Google Ads location and the Google Maps location resolved to City or Municipality."
    },
    {
      id: "sample_saturated",
      hundredths: -10,
      applied: input.saturated,
      reason: "Unique organic listings filled the requested depth, so the sample is only a lower bound."
    },
    {
      id: "spell_corrected",
      hundredths: -5,
      applied: input.spellCorrected,
      reason: "Google Ads returned a spell value that differs from the keyword sent."
    }
  ];
}

export function buildScore({ demand, maps, origin }) {
  const volume = demand.search_volume;
  const unique = maps.deduplication.unique_organic_listings;
  const depth = maps.requested_depth;
  const volumeMeasured = isMeasuredStatus(volume.status) && Number.isInteger(volume.value);
  const uniqueMeasured = isMeasuredStatus(unique.status) && Number.isInteger(unique.value) && unique.value >= 0;

  let matchedBand = null;
  let demandIndex = null;
  if (volumeMeasured) {
    matchedBand = bandFor(volume.value);
    demandIndex = matchedBand ? matchedBand.index : null;
  }

  let openness = null;
  if (uniqueMeasured && Number.isInteger(depth) && depth > 0) {
    openness = sampleOpenness(unique.value, depth);
  }

  const flags = [];
  if (origin === "example") flags.push("example_data");
  if (volume.status === "measured_zero") flags.push("measured_zero_demand");
  if (uniqueMeasured && unique.value === 0) flags.push("maps_sample_empty");
  if (uniqueMeasured && unique.value > 0 && unique.value < depth / 2) flags.push("maps_sample_sparse");
  if (uniqueMeasured && unique.value >= depth) flags.push("maps_sample_saturated");
  if (demand.spell && demand.spell.status === "corrected") flags.push("spell_corrected");
  if (maps.se_results_count && maps.se_results_count.status === "inconsistent") flags.push("se_results_count_inconsistent");
  if (maps.address_flags && maps.address_flags.listings_with_different_address_city > 0) {
    flags.push("listings_outside_named_city");
  }

  let overallStatus = "withheld";
  let withheldReason = null;
  let overall = null;

  if (!volumeMeasured || demandIndex === null) {
    withheldReason = "Demand was not measured, so there is no combined index. Missing, unsupported, failed, and unusable demand are not scored as zero.";
  } else if (!uniqueMeasured || openness === null) {
    withheldReason = "The Maps organic sample was not measured, so there is no combined index.";
  } else if (unique.value === 0) {
    withheldReason = "The Maps sample was measured as zero organic listings. The combined index is withheld because sample openness would otherwise be 100 and could be read as an open market. Zero listings is not an opportunity grade. The demand index is still reported.";
  } else {
    overallStatus = "calculated";
    overall = overallFromParts(demandIndex, openness);
  }

  if (overallStatus === "withheld") flags.push("combined_index_withheld");

  const required = [
    { id: "demand.search_volume", measured: volumeMeasured },
    { id: "maps.unique_organic_listings", measured: uniqueMeasured }
  ];
  const measuredCount = required.filter((item) => item.measured).length;

  const cityLike = (location) => {
    const type = String(location && location.location_type || "").toLowerCase();
    return type === "city" || type === "municipality";
  };
  const adjustments = confidenceAdjustments({
    numericMonths: demand.monthly_searches ? demand.monthly_searches.numeric_month_count : 0,
    bothCityLike: cityLike(demand.location) && cityLike(maps.location),
    saturated: uniqueMeasured && unique.value >= depth,
    spellCorrected: Boolean(demand.spell && demand.spell.status === "corrected")
  });

  let confidence = null;
  if (overallStatus === "calculated") {
    let hundredths = adjustments.reduce((sum, item) => sum + (item.applied ? item.hundredths : 0), 0);
    hundredths = Math.min(CONFIDENCE_CAP_HUNDREDTHS, Math.max(CONFIDENCE_FLOOR_HUNDREDTHS, hundredths));
    confidence = {
      hundredths,
      display: formatHundredths(hundredths),
      cap_hundredths: CONFIDENCE_CAP_HUNDREDTHS,
      floor_hundredths: CONFIDENCE_FLOOR_HUNDREDTHS,
      adjustments,
      note: "Heuristic completeness confidence with a hard cap of 0.75. Not a probability that the niche will succeed."
    };
  }

  const interpretation = [];
  if (origin === "example") {
    interpretation.push("These figures are example fixture data, not a measurement of this market.");
  }
  if (overallStatus === "withheld") {
    interpretation.push("No combined index was produced.");
    interpretation.push(withheldReason);
  } else {
    interpretation.push(`The combined index is ${overall.display}. It is not a recommendation to enter a market.`);
    interpretation.push(`Demand band "${matchedBand.label}" from search volume ${volume.value} contributes weight 0.65 as demand index ${demandIndex}.`);
    interpretation.push(`The Maps sample has ${unique.value} unique organic listings out of ${depth} requested, so sample openness is ${openness} at weight 0.35.`);
    if (volume.status === "measured_zero") {
      interpretation.push("Average monthly searches were measured as 0. That is a measured zero, not missing data. The demand index is 0.");
    }
    if (flags.includes("maps_sample_sparse")) {
      interpretation.push(`The organic sample is under half of the ${depth} listings requested. A sparse sample can be a thin result, a query Maps did not treat as a local business search, or simply the first page of a larger set. It is not proof of an open market.`);
    }
    if (flags.includes("maps_sample_saturated")) {
      interpretation.push(`The sample cap was filled. The unique listing count is a lower bound, and sample openness is 0. This does not say the market has only ${depth} businesses.`);
    }
  }
  if (flags.includes("listings_outside_named_city")) {
    interpretation.push("Some kept listings have an address city that does not match the city you named. They stay in the sample and are not treated as a verified in-city census.");
  }

  return {
    model_id: MODEL_ID,
    score_is_recommendation: false,
    scale: { name: "heuristic index", min: 0, max: 100 },
    weights: { demand_index: "0.65", sample_openness: "0.35" },
    formula: FORMULA,
    bands: DEMAND_BANDS,
    matched_band: matchedBand,
    inputs: {
      search_volume: volumeMeasured ? volume.value : null,
      search_volume_status: volume.status,
      unique_organic_listings: uniqueMeasured ? unique.value : null,
      unique_organic_listings_status: unique.status,
      requested_depth: depth,
      demand_index: demandIndex,
      sample_openness: openness
    },
    overall_status: overallStatus,
    overall: overall ? overall.value : null,
    overall_tenths: overall ? overall.tenths : null,
    overall_display: overall ? overall.display : null,
    withheld_reason: withheldReason,
    completeness: {
      required,
      measured_count: measuredCount,
      required_count: required.length,
      label: `${measuredCount} of ${required.length} required inputs measured`
    },
    confidence,
    confidence_model: {
      cap_hundredths: CONFIDENCE_CAP_HUNDREDTHS,
      floor_hundredths: CONFIDENCE_FLOOR_HUNDREDTHS,
      note: "Numeric confidence is present only when the combined index is calculated. It is withheld with the index so missing demand cannot look confident."
    },
    flags,
    interpretation
  };
}
