import { COMPOSITE_MODEL_ID, scoreExampleMarket } from "./composite-score.js";
import { resolveCityAction, resolveTypedCity } from "./city-pick.js";
import { nearbyPlaces, PLACES } from "./nearby.js";
import { priceForServiceNiche } from "./niche-prices.js";
import { rankByQuery } from "./query-match.js";
import { HttpError } from "./errors.js";
import { priceCoverage, priceFor } from "./job-prices.js";
import { normalizePlace } from "./normalize.js";
import { screenCandidates } from "./screen.js";
import { normalizeState } from "./states.js";
import { inTradePhrase, normalizePhrase, slugForLabel } from "./subniche-discovery.js";

export const FLOW_MODEL_ID = "centik-microsite-flow-v1";

const PLUMBING_SUBNICHES = [
  ["emergency-plumbing", "Emergency plumbing", 96, "Urgent after-hours calls in this fixture."],
  ["drain-cleaning", "Drain cleaning", 92, "A frequent residential service call in this fixture."],
  ["water-heater-repair", "Water heater repair", 88, "Repair visits rather than full replacements."],
  ["leak-detection", "Leak detection", 84, "Finding hidden supply-line leaks."],
  ["toilet-repair", "Toilet repair", 80, "Running toilets, flappers, and fill valves."],
  ["faucet-repair", "Faucet and fixture repair", 76, "Kitchen and bath faucet service."],
  ["sewer-line", "Sewer line service", 72, "Main-line clogs and camera inspections."],
  ["garbage-disposal", "Garbage disposal service", 68, "Jams, replacements, and resets."],
  ["pipe-repair", "Pipe repair", 64, "Visible supply-pipe leaks and bursts."],
  ["sump-pump", "Sump pump service", 60, "Basement pump checks and swaps."],
  ["bath-remodel-plumbing", "Bathroom remodel plumbing", 56, "Rough-in and fixture moves for a remodel."],
  ["kitchen-sink", "Kitchen sink service", 52, "Drains, traps, and supply connections."],
  ["water-filtration", "Water filtration install", 48, "Under-sink and whole-home filter setup."],
  ["gas-line", "Gas line plumbing", 44, "Appliance gas connectors and line checks."],
  ["hydro-jetting", "Hydro jetting", 40, "High-pressure drain clearing."],
  ["repipe", "Repipe consultation", 36, "Planning a whole-home pipe replacement."],
  ["hose-bib", "Outdoor faucet service", 32, "Hose bibs and exterior spigots."],
  ["water-softener", "Water softener service", 28, "Softener install and salt-system checks."],
  ["backflow", "Backflow testing", 22, "Annual backflow device tests."],
  ["tankless-water-heater", "Tankless water heater service", 16, "Tankless descaling and error codes."]
].map(([id, label, example_strength, evidence]) => ({
  id,
  label,
  example_strength,
  evidence: `Example demand index ${example_strength}. ${evidence} Not a measured opportunity.`,
  note: "Demand and competition are example fixtures. The job-price range, when present, is a national published figure."
}));

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

const SATELLITES = PLACES.filter((place) => place.nearby_only).map((place) => ({
  id: place.id,
  geography_type: "city",
  name: place.name,
  state: place.state,
  base: place.base,
  example_deep_check: false
}));

const PROPOSAL_PLACES = LOCATIONS.concat(SATELLITES);

const SERVICE_NICHES = [
  ["plumbing", "Plumbing", 96],
  ["hvac", "HVAC repair", 80],
  ["locksmith", "Locksmith", 72],
  ["garage-door", "Garage door repair", 64],
  ["electrician", "Electrician", 90],
  ["retaining-wall", "Retaining wall repair", 48],
  ["mobile-welding", "Mobile welding", 40],
  ["crawl-space", "Crawl space encapsulation", 32]
];

const TRADE_PATTERN = /hvac|furnace|heat pump|air conditioning|\bac\b|locksmith|lockout|rekey|garage door|electrician|electrical|retaining|weld|crawl/;

function serviceRows(keyword) {
  const rows = SERVICE_NICHES.map(([id, label, exampleStrength]) => {
    const price = priceForServiceNiche(id);
    const scored = scoredSubniche({
      id,
      label,
      example_strength: exampleStrength,
      evidence: "Example demand index for this trade. Not a measured search volume.",
      note: "Demand and competition are example fixtures."
    }, exampleStrength);
    return { ...scored, price, composite: scoreExampleMarket({
      exampleRelativeDemand: exampleStrength,
      exampleMonthlySearches: exampleStrength * 12,
      exampleCompetitorCount: Math.max(3, Math.round(28 - exampleStrength / 4)),
      price
    }) };
  });
  return rankByQuery(keyword, rows).map((item, index) => ({ ...item, example_rank: index + 1 }));
}

const SHIFTS = {
  "emergency-plumbing": { "austin-tx": 8, "new-york-ny": -6, "portland-me": -4 },
  "drain-cleaning": { "springfield-il": 28, "austin-tx": -18, "houston-tx": 6 },
  "water-heater-repair": { "saint-louis-mo": 20, "new-york-ny": -14, "dallas-tx": 8 }
};

function clampDemand(value) {
  return Math.max(8, Math.min(96, value));
}

function exampleMarketInputs(relativeDemand) {
  const exampleRelativeDemand = clampDemand(relativeDemand);
  return {
    exampleRelativeDemand,
    exampleMonthlySearches: exampleRelativeDemand * 12,
    exampleCompetitorCount: Math.max(3, Math.round(28 - exampleRelativeDemand / 4)),
    formula: "Example searches = example relative demand × 12. Example competitor count = max(3, round(28 − demand / 4)). Both are fixture formulas, not Google volume and not a Maps count."
  };
}

function demandFor(location, subnicheId, rankingKind) {
  const shift = rankingKind === "example_suggestion" ? (SHIFTS[subnicheId] || {})[location.id] || 0 : 0;
  return exampleMarketInputs(location.base + shift);
}

function scoredSubniche(subniche, relativeDemand) {
  const inputs = exampleMarketInputs(relativeDemand);
  const price = priceFor(subniche.id);
  return {
    ...subniche,
    price,
    composite: scoreExampleMarket({ ...inputs, price })
  };
}

export function suggestSubniches(keyword) {
  const text = String(keyword || "").trim();
  if (!text || text.length < 2) {
    throw new HttpError(400, "invalid_input", "Enter a service keyword of at least 2 characters.");
  }
  const ranked = rankByQuery(text, PLUMBING_SUBNICHES.map((item) => scoredSubniche(item, item.example_strength)));
  const tradeQuery = TRADE_PATTERN.test(text.toLowerCase());
  const known = text.toLowerCase().includes("plumb") || (!tradeQuery && ranked.some((item) => item.match.tier !== "none"));
  if (!known && tradeQuery) {
    const subniches = serviceRows(text);
    return {
      known_profile: true,
      profile_id: "service-trades",
      ranking_kind: "example_suggestion",
      row_count: subniches.length,
      ranking_note: "These trades use reviewed national prices. An estimate is tagged est. and cannot be shown as a green row. Demand and competition are still example fixtures.",
      price_coverage: {
        published_count: subniches.filter((item) => item.price.status === "published").length,
        missing_count: subniches.filter((item) => item.price.status !== "published").length,
        missing_ids: subniches.filter((item) => item.price.status !== "published").map((item) => item.id),
        note: "Retaining wall repair, mobile welding, and crawl space encapsulation have no usable emergency price. No estimate was made for them."
      },
      subniches,
      unranked_option: null
    };
  }
  if (known) {
    return {
      known_profile: true,
      profile_id: "plumbing",
      ranking_kind: "example_suggestion",
      row_count: PLUMBING_SUBNICHES.length,
      ranking_note: "Rows sort by how specifically the query matches the sub-niche, then by composite band: green (60 or higher), then yellow, then red. Inside a band, the higher composite is first. Plumbing, plumber, and near me add no specificity. Demand and competition are example fixtures. Job prices are national published ranges and are not adjusted for a city. A missing price withholds that row's composite. Matching does not change the composite.",
      price_coverage: priceCoverage(PLUMBING_SUBNICHES.map((item) => item.id)),
      subniches: ranked.map((item, index) => ({ ...item, example_rank: index + 1 })),
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

function requireKeyword(body) {
  const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
  if (keyword.length < 2 || keyword.length > 80) throw new HttpError(400, "invalid_input", "Enter a service keyword of 2-80 characters.");
  return { keyword };
}

function liveSpecialty(keyword, subnicheId, label, suggestion) {
  return {
    suggestion: {
      ...suggestion,
      ranking_kind: "live_keyword_ideas",
      ranking_note: "The specialty name came from the United States keyword lookup. Location cards stay on the example shortlist."
    },
    subniche: {
      id: subnicheId,
      label,
      price: priceFor(subnicheId),
      note: "Specialty from the United States keyword-ideas lookup. City cards below are still the example shortlist."
    }
  };
}

function selectedSubniche(keyword, subnicheId, body = {}) {
  const suggestion = suggestSubniches(keyword);
  if (subnicheId === "unranked-keyword" && suggestion.unranked_option) return { suggestion, subniche: suggestion.unranked_option };
  const subniche = suggestion.subniches.find((item) => item.id === subnicheId);
  if (subniche) return { suggestion, subniche };
  const label = typeof body.subniche_label === "string" ? body.subniche_label.trim() : "";
  if (subnicheId === "unranked-keyword" && label && normalizePhrase(label) === normalizePhrase(keyword)) {
    return liveSpecialty(keyword, subnicheId, label, suggestion);
  }
  if (label && slugForLabel(label) === subnicheId && inTradePhrase(keyword, label)) {
    return liveSpecialty(keyword, subnicheId, label, suggestion);
  }
  throw new HttpError(400, "inconsistent_choice", "That sub-niche does not belong to this keyword. Nothing was selected.");
}

function samePlace(candidate, location) {
  return candidate.geography_type === location.geography_type
    && candidate.name.toLowerCase() === location.name.toLowerCase()
    && candidate.state.toLowerCase() === location.state.toLowerCase();
}

const SHORTLIST_COVERAGE = {
  scope: "illustrative_us_sample",
  exhaustive: false,
  biased_by_user_location: false,
  note: "A fixed example set of cities, counties, and metros in several states. It is not exhaustive United States coverage, and it is not ordered from a city or state you typed."
};

export async function buildShortlist(body) {
  const context = requireKeyword(body);
  const { suggestion, subniche } = selectedSubniche(context.keyword, body.subniche_id, body);
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
    const inputs = {
      exampleRelativeDemand: demand.exampleRelativeDemand,
      exampleMonthlySearches: demand.exampleMonthlySearches,
      exampleCompetitorCount: demand.exampleCompetitorCount
    };
    const proxy = screen.candidates.find((candidate) => samePlace(candidate.input, location));
    const proxyKnown = proxy && proxy.geography.outcome === "matched";
    return {
      id: location.id,
      geography_type: location.geography_type,
      name: location.name,
      state: location.state,
      country: "United States",
      subniche_label: subniche.label,
      example_relative_demand: inputs.exampleRelativeDemand,
      example_evidence: {
        label: "EXAMPLE",
        monthly_searches: inputs.exampleMonthlySearches,
        competitor_count: inputs.exampleCompetitorCount,
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
    card.nearby_ids = nearbyPlaces(card.id).map((place) => place.id);
  });
  const nearbyCards = SATELLITES.map((location) => {
    const demand = demandFor(location, subniche.id, suggestion.ranking_kind);
    return {
      id: location.id,
      geography_type: "city",
      name: location.name,
      state: location.state,
      country: "United States",
      subniche_label: subniche.label,
      example_relative_demand: demand.exampleRelativeDemand,
      nearby_ids: nearbyPlaces(location.id).map((place) => place.id),
      miles_note: "Example city inside about 45 miles of the selected market. Not a national shortlist row.",
      example_deep_check: false,
      deep_check_block: "This nearby example city is not in the deep-check gazetteer. No score is invented for a paid check."
    };
  });
  return {
    model_id: FLOW_MODEL_ID,
    data_origin: "example",
    example_data: true,
    example_banner: "Example shortlist across a small United States sample. The bars and the search-volume line are fixture numbers, not Census demand and not DataForSEO measurements.",
    coverage: SHORTLIST_COVERAGE,
    ranking_kind: suggestion.ranking_kind,
    ranking_note: suggestion.ranking_kind === "example_suggestion"
      ? "Cards are ordered by the example demand fixture for this sub-niche. The top card is not selected for you."
      : suggestion.ranking_kind === "live_keyword_ideas"
        ? "The specialty name came from the United States keyword lookup. These cards are still the example location set, not live city demand."
        : "No sub-niche profile exists, so this order is an unranked placeholder. It is not a suggested best market.",
    paid_dataforseo_called: false,
    context,
    subniche,
    cards,
    nearby_cards: nearbyCards
  };
}

function sameCityName(leftName, leftState, rightName, rightState) {
  return normalizePlace(leftName) === normalizePlace(rightName)
    && normalizeState(leftState, "us") === normalizeState(rightState, "us");
}

function locateProposalPlace(body) {
  const byId = PROPOSAL_PLACES.find((item) => item.id === body.location_id);
  if (byId) return { ok: true, location: byId, outside_sample: false };
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const state = typeof body.state === "string" ? body.state.trim() : "";
  if (!city || !state) {
    return { ok: false, message: "That location is not in the example shortlist." };
  }
  const resolved = resolveTypedCity(`${city}, ${state}`);
  if (!resolved.selected || !resolved.place) {
    return { ok: false, message: resolved.message || "That city and state were not selected." };
  }
  const sample = PROPOSAL_PLACES.find((item) => item.geography_type === "city" && sameCityName(item.name, item.state, resolved.place.name, resolved.place.state));
  if (sample) return { ok: true, location: sample, outside_sample: false };
  return {
    ok: true,
    outside_sample: true,
    location: {
      id: resolved.place.id,
      geography_type: "city",
      name: resolved.place.name,
      state: resolved.place.state,
      example_deep_check: false
    }
  };
}

function insufficientComposite(price) {
  const published = Boolean(price && price.status === "published");
  return {
    model_id: COMPOSITE_MODEL_ID,
    status: "insufficient",
    withheld_reason: "insufficient_data",
    composite_tenths: null,
    composite_display: null,
    band: "missing",
    clears_green: null,
    clears_green_label: "not calculated",
    message: "Insufficient data. A measured check is needed.",
    weights: { demand: 40, competition: 30, margin: 30 },
    demand: {
      label: "INSUFFICIENT",
      index: null,
      monthly_searches: null,
      contribution_display: null,
      note: "No example demand fixture covers this city. Example searches were not invented. A measured check is needed."
    },
    competition: {
      label: "INSUFFICIENT",
      competitor_count: null,
      index: null,
      contribution_display: null,
      note: "No example competitor count covers this city. A Maps count was not invented. A measured check is needed."
    },
    margin: {
      status: published ? "published" : "missing",
      index: null,
      contribution_display: null,
      low_dollars: published ? price.low_dollars : null,
      high_dollars: published ? price.high_dollars : null,
      sentence: price ? price.sentence : "Price range missing",
      source_name: price && price.source_name ? price.source_name : null,
      url: price && price.url ? price.url : null,
      accessed: price ? price.accessed : null,
      city_adjusted: false,
      scope: "national_united_states",
      note: "A national price, when one is published, is not a city score. Demand and competition are missing, so the composite was not calculated."
    }
  };
}

function insufficientProposal(context, subniche, location, price) {
  const slug = `${location.name}-${subniche.label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const composite = insufficientComposite(price);
  return {
    model_id: FLOW_MODEL_ID,
    data_origin: "insufficient",
    example_data: false,
    insufficient_data: true,
    paid_dataforseo_called: false,
    prototype_only: true,
    microsite_name: `${location.name} ${subniche.label}`,
    suggested_domain: `${slug}.example`,
    domain_availability: "not_checked",
    domain_note: "The .example domain is a suggestion shape. Availability was not checked. Nothing is registered or purchased.",
    pages: [
      { name: "Home", purpose: "State the service and the city in one sentence." },
      { name: "Services", purpose: `List ${subniche.label.toLowerCase()} as the focus, with room for neighboring tasks.` },
      { name: "Service area", purpose: `Name ${location.name}, ${location.state}. This sketch is not a verified territory.` },
      { name: "Contact", purpose: "Leave a placeholder for a phone number and a form. No number is supplied here." }
    ],
    headline: `Example angle: ${subniche.label} for homes around ${location.name}.`,
    claims_not_made: [
      "No claim that a person is licensed, insured, or available.",
      "No price, guarantee, or emergency-response promise.",
      "No website is created and no domain is bought.",
      "No example search volume or competitor count was invented for this city."
    ],
    yes_means: "Yes stores a prototype choice in this session only. It does not authorize spending, publishing, or a paid data call.",
    location: { id: location.id, name: location.name, state: location.state, geography_type: "city" },
    subniche: { id: subniche.id, label: subniche.label },
    keyword: context.keyword,
    price,
    composite,
    deep_check_gate: {
      paid_calls_allowed: false,
      clears_green: null,
      gate_line: "Insufficient data. A measured check is needed. Okay is still required before a paid check.",
      demand_basis_note: "Insufficient data. A measured check is needed. Example demand and competition were not invented for this city.",
      example_check_available: false,
      reason: "This city is outside the example scoring set. No sample score was invented. A paid check still waits for Okay."
    }
  };
}

export function buildProposal(body) {
  const context = requireKeyword(body);
  const { suggestion, subniche } = selectedSubniche(context.keyword, body.subniche_id, body);
  const located = locateProposalPlace(body);
  if (!located.ok) throw new HttpError(400, "inconsistent_choice", located.message);
  const location = located.location;
  const price = subniche.price || priceFor(subniche.id);
  if (located.outside_sample) return insufficientProposal(context, subniche, location, price);
  const demand = demandFor(location, subniche.id, suggestion.ranking_kind);
  const composite = scoreExampleMarket({
    exampleRelativeDemand: demand.exampleRelativeDemand,
    exampleMonthlySearches: demand.exampleMonthlySearches,
    exampleCompetitorCount: demand.exampleCompetitorCount,
    price
  });
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
    insufficient_data: false,
    price,
    composite,
    deep_check_gate: {
      paid_calls_allowed: false,
      clears_green: composite.clears_green_label,
      gate_line: `${composite.clears_green_label === "on an estimated price" ? "Clears green on an estimated price." : `Clears green: ${composite.clears_green_label}.`} Yes does not authorize spending or publishing.`,
      demand_basis_note: "The leaderboard uses a national example demand. This gauge uses the example demand for the city you picked. Those two numbers can differ, so the gauge can sit in a different band than the row.",
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
    const context = requireKeyword(body);
    return {
      model_id: FLOW_MODEL_ID,
      data_origin: "example",
      example_data: true,
      paid_dataforseo_called: false,
      context,
      context_note: "Only the service keyword is used. No city, state, or country is required or applied.",
      ...suggestSubniches(context.keyword)
    };
  }
  if (body.action === "shortlist") return buildShortlist(body);
  if (body.action === "proposal") return buildProposal(body);
  if (body.action === "resolve_city") {
    return { model_id: FLOW_MODEL_ID, ...resolveCityAction(body) };
  }
  throw new HttpError(400, "invalid_input", "Action must be subniches, shortlist, proposal, or resolve_city.");
}
