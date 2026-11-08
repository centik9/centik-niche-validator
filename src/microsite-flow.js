import { HttpError } from "./errors.js";
import { screenCandidates } from "./screen.js";

export const FLOW_MODEL_ID = "centik-microsite-flow-v1";

const PLUMBING_SUBNICHES = [
  {
    id: "emergency-plumbing",
    label: "Emergency plumbing",
    example_rank: 1,
    note: "Example suggestion 1. This order is a teaching fixture, not a measured best niche."
  },
  {
    id: "drain-cleaning",
    label: "Drain cleaning",
    example_rank: 2,
    note: "Example suggestion 2. This order is a teaching fixture, not a measured best niche."
  },
  {
    id: "water-heater-repair",
    label: "Water heater repair",
    example_rank: 3,
    note: "Example suggestion 3. This order is a teaching fixture, not a measured best niche."
  }
];

const LOCATIONS = [
  { id: "austin-tx", geography_type: "city", name: "Austin", state: "Texas", base: 84, example_deep_check: true },
  { id: "new-york-ny", geography_type: "city", name: "New York", state: "New York", base: 90, example_deep_check: true },
  { id: "houston-tx", geography_type: "city", name: "Houston", state: "Texas", base: 80, example_deep_check: false },
  { id: "dallas-tx", geography_type: "city", name: "Dallas", state: "Texas", base: 76, example_deep_check: false },
  { id: "portland-or", geography_type: "city", name: "Portland", state: "Oregon", base: 73, example_deep_check: true },
  { id: "saint-louis-mo", geography_type: "city", name: "Saint Louis", state: "Missouri", base: 69, example_deep_check: true },
  { id: "kansas-city-mo", geography_type: "city", name: "Kansas City", state: "Missouri", base: 64, example_deep_check: true },
  { id: "springfield-il", geography_type: "city", name: "Springfield", state: "Illinois", base: 58, example_deep_check: true },
  { id: "springfield-mo", geography_type: "city", name: "Springfield", state: "Missouri", base: 55, example_deep_check: true },
  { id: "portland-me", geography_type: "city", name: "Portland", state: "Maine", base: 48, example_deep_check: true },
  { id: "austin-metro-tx", geography_type: "metro", name: "Austin-Round Rock-San Marcos", state: "Texas", base: 86, example_deep_check: false },
  { id: "travis-county-tx", geography_type: "county", name: "Travis County", state: "Texas", base: 71, example_deep_check: false },
  { id: "hunt-county-tx", geography_type: "county", name: "Hunt County", state: "Texas", base: 42, example_deep_check: false },
  { id: "fulton-county-ga", geography_type: "county", name: "Fulton County", state: "Georgia", base: 67, example_deep_check: false }
];

const SHIFTS = {
  "emergency-plumbing": { "austin-tx": 8, "new-york-ny": -6, "portland-me": -4 },
  "drain-cleaning": { "springfield-il": 28, "austin-tx": -18, "houston-tx": 6 },
  "water-heater-repair": { "saint-louis-mo": 20, "new-york-ny": -14, "dallas-tx": 8 }
};

function clampDemand(value) {
  return Math.max(8, Math.min(96, value));
}

function demandFor(location, subnicheId, rankingKind) {
  const shift = rankingKind === "example_suggestion" ? (SHIFTS[subnicheId] || {})[location.id] || 0 : 0;
  const exampleRelativeDemand = clampDemand(location.base + shift);
  return {
    example_relative_demand: exampleRelativeDemand,
    example_monthly_searches: exampleRelativeDemand * 12,
    example_competitor_count: Math.max(3, Math.round(28 - exampleRelativeDemand / 4)),
    formula: "Example searches = example relative demand × 12. Example competitor count = max(3, round(28 − demand / 4)). Both are fixture formulas, not Google volume and not a Maps count."
  };
}

export function suggestSubniches(keyword) {
  const text = String(keyword || "").trim();
  const known = text.toLowerCase().includes("plumb");
  if (!text || text.length < 2) {
    throw new HttpError(400, "invalid_input", "Enter a service keyword of at least 2 characters.");
  }
  if (known) {
    return {
      known_profile: true,
      profile_id: "plumbing",
      ranking_kind: "example_suggestion",
      ranking_note: "Suggested order for the plumbing example only. It is not a measured ranking of the best niche.",
      subniches: PLUMBING_SUBNICHES,
      unranked_option: null
    };
  }
  return {
    known_profile: false,
    profile_id: null,
    ranking_kind: "unranked_placeholder",
    ranking_note: "No example sub-niche list exists for this keyword. The words you typed can be used as an unranked label. That is not a researched specialty.",
    subniches: [],
    unranked_option: {
      id: "unranked-keyword",
      label: text,
      example_rank: null,
      note: "Unranked example label. Not a suggested best niche."
    }
  };
}

export function createFlowState() {
  return {
    step: "context",
    context: null,
    subniche: null,
    location: null,
    proposal_decision: null,
    deep_check: null
  };
}

export function reduceFlow(state, event) {
  const current = state || createFlowState();
  if (event.type === "set_context") {
    return {
      step: "subniches",
      context: event.context,
      subniche: null,
      location: null,
      proposal_decision: null,
      deep_check: null,
      invalidated: ["subniche", "location", "proposal", "deep_check"]
    };
  }
  if (event.type === "pick_subniche") {
    if (!current.context) throw new HttpError(400, "flow_order", "Choose a service context before a sub-niche.");
    return {
      ...current,
      step: "locations",
      subniche: event.subniche,
      location: null,
      proposal_decision: null,
      deep_check: null,
      invalidated: ["location", "proposal", "deep_check"]
    };
  }
  if (event.type === "pick_location") {
    if (!current.subniche) throw new HttpError(400, "flow_order", "Choose a sub-niche before a location.");
    return {
      ...current,
      step: "proposal",
      location: event.location,
      proposal_decision: null,
      deep_check: null,
      invalidated: ["proposal", "deep_check"]
    };
  }
  if (event.type === "decide_proposal") {
    if (!current.location) throw new HttpError(400, "flow_order", "Choose a location before the microsite decision.");
    if (event.choice === "no") {
      return { ...current, step: "proposal", proposal_decision: "no", deep_check: null, invalidated: ["deep_check"] };
    }
    if (event.choice !== "yes") throw new HttpError(400, "invalid_input", "The microsite decision must be yes or no.");
    return {
      ...current,
      step: "deep_check",
      proposal_decision: "yes",
      deep_check: {
        status: "gated",
        paid_calls_allowed: false,
        prototype_only: true,
        note: "Yes records a prototype choice in this session. It does not buy a domain, create a site, or authorize a paid data request."
      },
      invalidated: []
    };
  }
  throw new HttpError(400, "invalid_input", "Unknown flow event.");
}

function requireContext(body) {
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim() : "";
  const country = typeof body.country === "string" ? body.country.trim() : "";
  if (keyword.length < 2 || keyword.length > 80) throw new HttpError(400, "invalid_input", "Enter a service keyword of 2-80 characters.");
  if (city.length < 2 || state.length < 2 || country.length < 2) {
    throw new HttpError(400, "invalid_input", "City, state, and country are the starting context.");
  }
  return { keyword, city, state, country };
}

function selectedSubniche(keyword, subnicheId) {
  const suggestion = suggestSubniches(keyword);
  if (subnicheId === "unranked-keyword" && suggestion.unranked_option) return { suggestion, subniche: suggestion.unranked_option };
  const subniche = suggestion.subniches.find((item) => item.id === subnicheId);
  if (!subniche) {
    throw new HttpError(400, "inconsistent_choice", "That sub-niche does not belong to this keyword. Nothing was selected.");
  }
  return { suggestion, subniche };
}

function samePlace(candidate, location) {
  return candidate.geography_type === location.geography_type
    && candidate.name.toLowerCase() === location.name.toLowerCase()
    && candidate.state.toLowerCase() === location.state.toLowerCase();
}

export async function buildShortlist(body) {
  const context = requireContext(body);
  const { suggestion, subniche } = selectedSubniche(context.keyword, body.subniche_id);
  const screen = await screenCandidates({
    mode: "sample",
    niche: subniche.label,
    candidates: LOCATIONS.filter((location) => location.geography_type).map((location) => ({
      geography_type: location.geography_type,
      name: location.name,
      state: location.state
    }))
  });
  const cards = LOCATIONS.map((location) => {
    const demand = demandFor(location, subniche.id, suggestion.ranking_kind);
    const proxy = screen.candidates.find((candidate) => samePlace(candidate.input, location));
    const proxyKnown = proxy && proxy.geography.outcome === "matched";
    return {
      id: location.id,
      geography_type: location.geography_type,
      name: location.name,
      state: location.state,
      country: "United States",
      subniche_label: subniche.label,
      starting_context: location.geography_type === "city"
        && location.name.toLowerCase() === context.city.toLowerCase()
        && location.state.toLowerCase() === context.state.toLowerCase(),
      example_relative_demand: demand.example_relative_demand,
      example_evidence: {
        label: "EXAMPLE",
        monthly_searches: demand.example_monthly_searches,
        competitor_count: demand.example_competitor_count,
        formula: demand.formula,
        not_keyword_volume: true,
        not_census: true
      },
      housing_proxy: proxyKnown
        ? {
          status: proxy.signals.housing_units.status,
          housing_units: proxy.signals.housing_units.value,
          owner_occupancy_rate: proxy.signals.owner_occupancy_rate,
          older_housing_share: proxy.signals.older_housing_share,
          median_household_income: proxy.signals.median_household_income,
          soil: proxy.signals.high_shrink_swell_share,
          drought: proxy.signals.drought_pdsi,
          freeze_thaw_cycles: proxy.signals.freeze_thaw_cycles,
          screen_index: proxy.screen_index,
          note: "Housing, soil, and drought figures are proxies from the labeled sample screen. They are not keyword search volume."
        }
        : {
          status: "not_in_sample",
          housing_units: null,
          note: "This example card has no housing-proxy row in the sample fixture. Missing coverage is not zero demand and is not a search-volume measurement."
        },
      example_deep_check: location.example_deep_check && location.geography_type === "city",
      deep_check_block: location.geography_type === "city"
        ? (location.example_deep_check ? null : "The example deep-check gazetteer does not include this city. A score will not be invented.")
        : "The example deep check accepts a city place only. This county or metro is not treated as a city."
    };
  });
  cards.sort((a, b) => b.example_relative_demand - a.example_relative_demand || a.name.localeCompare(b.name));
  cards.forEach((card, index) => {
    card.position = index + 1;
  });
  return {
    model_id: FLOW_MODEL_ID,
    data_origin: "example",
    example_data: true,
    example_banner: "Example shortlist. The bars and the search-volume line are fixture numbers, not Census demand and not DataForSEO measurements.",
    ranking_kind: suggestion.ranking_kind,
    ranking_note: suggestion.ranking_kind === "example_suggestion"
      ? "Cards are ordered by the example demand fixture for this sub-niche. The top card is not selected for you."
      : "No sub-niche profile exists, so this order is an unranked placeholder. It is not a suggested best market.",
    paid_dataforseo_called: false,
    context_note: "The city you typed is starting context. It is not a demand measurement. A matching card is badged, and its example bar is not increased because of that.",
    context,
    subniche,
    cards
  };
}

export function buildProposal(body) {
  const context = requireContext(body);
  const { subniche } = selectedSubniche(context.keyword, body.subniche_id);
  const location = LOCATIONS.find((item) => item.id === body.location_id);
  if (!location) throw new HttpError(400, "inconsistent_choice", "That location is not in the example shortlist.");
  const slug = `${location.name}-${subniche.label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    model_id: FLOW_MODEL_ID,
    data_origin: "example",
    example_data: true,
    paid_dataforseo_called: false,
    prototype_only: true,
    microsite_name: `${location.name} ${subniche.label}`,
    suggested_domain: `${slug}.example`,
    domain_availability: "not_checked",
    domain_note: "The .example domain is a suggestion shape. Availability was not checked. Nothing is registered or purchased.",
    pages: [
      { name: "Home", purpose: "State the service and the city in one sentence." },
      { name: "Services", purpose: `List ${subniche.label.toLowerCase()} as the focus, with room for neighboring tasks.` },
      { name: "Service area", purpose: `Name ${location.name}, ${location.state} and say the area is an example, not a verified territory.` },
      { name: "Contact", purpose: "Leave a placeholder for a phone number and a form. No number is supplied here." }
    ],
    headline: `Example angle: ${subniche.label} for homes around ${location.name}.`,
    claims_not_made: [
      "No claim that a person is licensed, insured, or available.",
      "No price, guarantee, or emergency-response promise.",
      "No website is created and no domain is bought."
    ],
    yes_means: "Yes stores a prototype choice in this session only. It does not authorize spending, publishing, or a paid data call.",
    location: { id: location.id, name: location.name, state: location.state, geography_type: location.geography_type },
    subniche: { id: subniche.id, label: subniche.label },
    keyword: context.keyword,
    deep_check_gate: {
      paid_calls_allowed: false,
      example_check_available: location.example_deep_check && location.geography_type === "city",
      reason: location.geography_type === "city"
        ? (location.example_deep_check
          ? "The paid DataForSEO check is off in this preview. An example deep check can run for this city."
          : "The paid check is off, and the example gazetteer has no city row here, so no score is invented.")
        : "The paid check is off. A county or metro is not sent through the city deep check."
    }
  };
}

export async function micrositeAction(body) {
  if (!body || typeof body !== "object") throw new HttpError(400, "invalid_input", "JSON object expected.");
  if (body.action === "subniches") {
    const context = requireContext(body);
    return {
      model_id: FLOW_MODEL_ID,
      data_origin: "example",
      example_data: true,
      paid_dataforseo_called: false,
      context,
      context_note: "This city, state, and country are starting context, not a search-demand measurement.",
      ...suggestSubniches(context.keyword)
    };
  }
  if (body.action === "shortlist") return buildShortlist(body);
  if (body.action === "proposal") return buildProposal(body);
  throw new HttpError(400, "invalid_input", "Action must be subniches, shortlist, or proposal.");
}
