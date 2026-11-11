import { priceForServiceNiche } from "./niche-prices.js";

// Worked example from the Nov 6 and Nov 10, 2026 research notes.
// Every number below is one of those cited figures. Fields the notes did not measure stay unavailable.

function field(status, value, note) {
  return { status, value: value === undefined ? null : value, note: note || "" };
}

function measured(value, note) {
  return field("measured", value, note);
}

function unavailable(note) {
  return field("unavailable", null, note);
}

const HOUSING_AGE_GAP = "Housing age was not in the Nov 6 or Nov 10 research snapshot. It was not filled in.";
const NOT_A_PACK = "Places lookup, not an ordered map pack and not an exhaustive operator count.";
const NO_STATE_COUNT = "Named local pages are not a measured count of about 1,500 operators in the state.";
const ADS_GAP = "No ad observation was recorded. Absence was not assumed.";
const BEST_GAP = "A localized check of best [service] in [location] was not recorded. A weak result was not assumed.";

export const WORKED_EXAMPLE_SOURCE = "Nov 6 and Nov 10, 2026 research notes. Research only. Not a DataForSEO measurement.";

export const DISCOVERY_FIXTURES = [
  {
    id: "bella-vista-ar-retaining-wall",
    service: "Retaining wall replacement",
    service_family: "retaining-wall",
    city: "Bella Vista",
    state: "Arkansas",
    fallback_id: "lancaster-oh-septic",
    population_edge: {
      status: "edge",
      nearby_center: "Fayetteville and Bentonville",
      note: "Northern Northwest Arkansas population edge, not the Fayetteville or Bentonville head terms. This is a placement from the research notes, not a population subtraction."
    },
    census: {
      source_name: "Census QuickFacts",
      source_url: "https://www.census.gov/quickfacts/bellavistacityarkansas",
      retrieved_on: "2026-11-10",
      population: measured(34518, "July 1, 2025 population estimate."),
      households: measured(13435, "ACS 2020-2024 households."),
      owner_occupancy_rate: measured(0.88, "88.0% owner-occupied."),
      median_home_value: measured(296700, "Median owner-occupied home value."),
      median_household_income: measured(88055, "Median household income."),
      housing_age: unavailable(HOUSING_AGE_GAP)
    },
    price: {
      status: "published",
      conditional: true,
      estimated: true,
      low_dollars: 3000,
      high_dollars: 10000,
      typical_dollars: 6500,
      unit: "per_job",
      city_adjusted: false,
      source_name: "HomeGuide",
      source_url: "https://homeguide.com/costs/concrete-retaining-wall-cost",
      source_date: "2025-12-23",
      scope: "50 ft wall, 3 to 6 ft, national concrete guide",
      note: "National range, not city adjusted. HomeGuide lists $3,000 to $10,000 for a 50 ft, 3 to 6 ft concrete wall, with a $6,500 calculator average. $5,000 or more holds for structural or replacement walls, not small garden walls. No verified Bella Vista price."
    },
    competition: {
      map_pack: "not_ordered",
      ordered_pack: false,
      strongest_in_town_ratings: 46,
      places: [
        {
          name: "GNG Underground LLC",
          rating: 4.9,
          ratings_count: 46,
          city: "Bella Vista",
          observed_on: "2026-11-10",
          source: NOT_A_PACK
        }
      ],
      note: "Nov 10 Places lookup returned GNG Underground at 4.9 from 46 ratings. One returned business does not mean only one operator. The map pack itself was not checked as an ordered pack."
    },
    best_query: { status: "not_enough_evidence", note: BEST_GAP },
    sponsored_ads: { status: "not_enough_evidence", note: ADS_GAP },
    state_operator_count: { status: "unavailable", note: NO_STATE_COUNT },
    explicit_hold: null
  },
  {
    id: "lancaster-oh-septic",
    service: "Septic installation",
    service_family: "septic",
    city: "Lancaster",
    state: "Ohio",
    fallback_id: null,
    population_edge: {
      status: "edge",
      nearby_center: "Columbus",
      note: "Rural edge around Lancaster, not Columbus head terms. The city itself is mostly on sewer, so septic demand sits on rural lots. That sewer note is qualitative."
    },
    census: {
      source_name: "Census QuickFacts",
      source_url: "https://www.census.gov/quickfacts/lancastercityohio",
      retrieved_on: "2026-11-10",
      population: measured(41956, "July 1, 2025 population estimate, stated in the Nov 6 notes."),
      households: measured(16857, "ACS 2020-2024 households, stated in the Nov 6 notes."),
      owner_occupancy_rate: measured(0.591, "59.1% owner-occupied."),
      median_home_value: measured(193900, "Median home value stated Nov 10."),
      median_household_income: measured(59133, "Median household income stated Nov 10."),
      housing_age: unavailable(HOUSING_AGE_GAP)
    },
    price: {
      status: "published",
      conditional: false,
      estimated: true,
      low_dollars: 8000,
      high_dollars: 15000,
      open_high: true,
      unit: "per_job",
      city_adjusted: false,
      source_name: "Drain Bros",
      source_url: "https://drainbros.net/lancaster-oh/septic-services/",
      scope: "Provider estimate for new installation",
      note: "Drain Bros publishes $8,000 to $15,000 or more for a new installation. That is a provider estimate, not an audited city average. National range, not a measured Lancaster transaction average."
    },
    competition: {
      map_pack: "not_ordered",
      ordered_pack: false,
      strongest_in_town_ratings: 278,
      places: [
        { name: "Pipeworks", rating: 4.9, ratings_count: 278, city: "Lancaster", observed_on: "2026-11-10", source: NOT_A_PACK },
        { name: "Josh's Ground Effects", rating: 5.0, ratings_count: 209, city: "Lancaster", observed_on: "2026-11-10", source: NOT_A_PACK },
        { name: "Helber's Septic Service", rating: 4.8, ratings_count: 20, city: "Logan", observed_on: "2026-11-10", source: "Logan address. Not proof of Lancaster coverage." }
      ],
      note: "Nov 10 Places lookup. Pipeworks 4.9 from 278 ratings and Josh's Ground Effects 5.0 from 209 ratings are in Lancaster. Not an ordered map pack."
    },
    best_query: { status: "not_enough_evidence", note: BEST_GAP },
    sponsored_ads: { status: "not_enough_evidence", note: ADS_GAP },
    state_operator_count: { status: "unavailable", note: NO_STATE_COUNT },
    explicit_hold: null
  },
  {
    id: "grass-valley-ca-septic",
    service: "Septic installation",
    service_family: "septic",
    city: "Grass Valley",
    state: "California",
    fallback_id: null,
    population_edge: {
      status: "edge",
      nearby_center: "Nevada County rural edge",
      note: "Rural Nevada County edge around the city. The city owner-occupancy rate is low. County household counts from an unverified search were not copied in."
    },
    census: {
      source_name: "Census QuickFacts",
      source_url: "https://www.census.gov/quickfacts/grassvalleycitycalifornia",
      retrieved_on: "2026-11-06",
      population: measured(14035, "July 1, 2025 population estimate."),
      households: measured(6769, "ACS 2020-2024 households."),
      owner_occupancy_rate: measured(0.402, "40.2% owner-occupied."),
      median_home_value: unavailable("Median home value was not stated for Grass Valley in the notes used here."),
      median_household_income: unavailable("Median income was not stated for Grass Valley in the notes used here."),
      housing_age: unavailable(HOUSING_AGE_GAP)
    },
    price: {
      status: "published",
      conditional: true,
      estimated: true,
      low_dollars: 3500,
      high_dollars: 8500,
      unit: "per_job",
      city_adjusted: false,
      source_name: "HomeGuide",
      source_url: "https://homeguide.com/costs/septic-tank-system-cost",
      source_date: "2025-09-22",
      scope: "National conventional septic system",
      note: "National range, not city adjusted. HomeGuide conventional systems are $3,500 to $8,500. Alternatives are $4,000 to $15,000 and engineered systems $15,000 to $50,000 or more. Those other bands are not a Grass Valley average. $5,000 or more is conditional on scope."
    },
    competition: {
      map_pack: "not_ordered",
      ordered_pack: false,
      strongest_in_town_ratings: 259,
      places: [
        { name: "Navo & Sons", rating: 4.9, ratings_count: 259, city: "Grass Valley", observed_on: "2026-11-10", source: NOT_A_PACK },
        { name: "Anderson's Septic", rating: 4.7, ratings_count: 27, city: "Grass Valley", observed_on: "2026-11-10", source: NOT_A_PACK },
        { name: "Urke Septic Services", rating: 4.3, ratings_count: 21, city: "Grass Valley", observed_on: "2026-11-10", source: NOT_A_PACK }
      ],
      note: "Nov 10 Places lookup. Navo 4.9 from 259 ratings is in Grass Valley. Not an ordered map pack."
    },
    best_query: { status: "not_enough_evidence", note: BEST_GAP },
    sponsored_ads: { status: "not_enough_evidence", note: ADS_GAP },
    state_operator_count: { status: "unavailable", note: NO_STATE_COUNT },
    explicit_hold: null
  },
  {
    id: "battle-ground-wa-driveway",
    service: "Concrete driveway replacement",
    service_family: "driveway",
    city: "Battle Ground",
    state: "Washington",
    fallback_id: null,
    population_edge: {
      status: "edge",
      nearby_center: "Vancouver",
      note: "North Clark County edge, not Vancouver or Portland head terms."
    },
    census: {
      source_name: "Census QuickFacts",
      source_url: "https://www.census.gov/quickfacts/battlegroundcitywashington",
      retrieved_on: "2026-11-06",
      population: measured(23513, "July 1, 2025 population estimate."),
      households: measured(7444, "ACS 2020-2024 households."),
      owner_occupancy_rate: measured(0.729, "72.9% owner-occupied."),
      median_home_value: measured(485100, "Median home value."),
      median_household_income: unavailable("Median income was not stated for Battle Ground in the notes used here."),
      housing_age: unavailable(HOUSING_AGE_GAP)
    },
    price: {
      status: "published",
      conditional: true,
      estimated: true,
      low_dollars: 2400,
      high_dollars: 8600,
      unit: "per_job",
      city_adjusted: false,
      source_name: "HomeGuide",
      source_url: "https://homeguide.com/costs/concrete-driveway-cost",
      source_date: "2025-06-03",
      scope: "National 2-car concrete driveway",
      note: "National range, not city adjusted. HomeGuide lists a 2-car driveway at $2,400 to $8,600. A 3-car example is $5,200 to $13,000 before tear-out. $5,000 or more is conditional on a full replacement scope."
    },
    competition: {
      map_pack: "not_ordered",
      ordered_pack: false,
      strongest_in_town_ratings: 17,
      places: [
        { name: "Troy Pachl & Sons", rating: 4.6, ratings_count: 17, city: "Battle Ground", observed_on: "2026-11-10", source: NOT_A_PACK },
        { name: "MD-1 Concrete", rating: 5.0, ratings_count: 15, city: "Battle Ground", observed_on: "2026-11-10", source: NOT_A_PACK }
      ],
      note: "Nov 10 Places lookup. Modest review counts do not establish a weak map pack. Not an ordered map pack."
    },
    best_query: { status: "not_enough_evidence", note: BEST_GAP },
    sponsored_ads: { status: "not_enough_evidence", note: ADS_GAP },
    state_operator_count: { status: "unavailable", note: NO_STATE_COUNT },
    explicit_hold: {
      reason: "Nov 6 research hold: exact-town demand was not measured, and the $5,000 line needs a full tear-out or a 3-car scope."
    }
  },
  {
    id: "leland-nc-crawl-space",
    service: "Crawl space encapsulation",
    service_family: "crawl-space",
    city: "Leland",
    state: "North Carolina",
    fallback_id: null,
    population_edge: {
      status: "edge",
      nearby_center: "Wilmington",
      note: "Wilmington and Brunswick edge, not a Wilmington-wide head term."
    },
    census: {
      source_name: "Census QuickFacts",
      source_url: "https://www.census.gov/quickfacts/lelandtownnorthcarolina",
      retrieved_on: "2026-11-06",
      population: measured(35731, "July 1, 2025 population estimate."),
      households: measured(13219, "ACS 2020-2024 households."),
      owner_occupancy_rate: measured(0.806, "80.6% owner-occupied."),
      median_home_value: measured(398900, "Median home value."),
      median_household_income: unavailable("Median income was not stated for Leland in the notes used here."),
      housing_age: unavailable(HOUSING_AGE_GAP)
    },
    price: {
      status: "published",
      conditional: false,
      estimated: true,
      low_dollars: 5000,
      high_dollars: 10000,
      unit: "per_job",
      city_adjusted: false,
      source_name: "Carolina Duct and Crawl",
      source_url: "https://carolinaductandcrawl.com/wilmington-north-carolina/crawl-space-encapsulation",
      scope: "Regional provider typical range",
      note: "Regional provider estimate of $5,000 to $10,000 on a broad North Carolina page. Not a Leland average."
    },
    competition: {
      map_pack: "not_ordered",
      ordered_pack: false,
      strongest_in_town_ratings: null,
      places: [
        { name: "Cape Fear Crawl Spaces", rating: 5.0, ratings_count: 93, city: "Wilmington", observed_on: "2026-11-10", source: "Wilmington address. Not a Leland address." },
        { name: "Eastern Crawlspace Solutions", rating: 5.0, ratings_count: 81, city: "Southport", observed_on: "2026-11-10", source: "Southport address. Not a Leland address." }
      ],
      note: "Nov 10 Places lookup returned no Leland-addressed operator. Nearby towns are not counted as Leland coverage."
    },
    best_query: { status: "not_enough_evidence", note: BEST_GAP },
    sponsored_ads: { status: "not_enough_evidence", note: ADS_GAP },
    state_operator_count: { status: "unavailable", note: NO_STATE_COUNT },
    explicit_hold: {
      reason: "Nov 6 research hold: no Leland-addressed operator in the lookup, and national or regional specialists publish Leland pages."
    }
  }
];

const NATIONAL_GUIDES = {
  "retaining-wall": {
    status: "published",
    conditional: true,
    estimated: true,
    low_dollars: 3000,
    high_dollars: 10000,
    typical_dollars: 6500,
    unit: "per_job",
    city_adjusted: false,
    source_name: "HomeGuide",
    source_url: "https://homeguide.com/costs/concrete-retaining-wall-cost",
    source_date: "2025-12-23",
    note: "National range, not city adjusted. HomeGuide $3,000 to $10,000 for a 50 ft, 3 to 6 ft concrete wall. Not a local transaction average."
  },
  septic: {
    status: "published",
    conditional: true,
    estimated: true,
    low_dollars: 3500,
    high_dollars: 8500,
    unit: "per_job",
    city_adjusted: false,
    source_name: "HomeGuide",
    source_url: "https://homeguide.com/costs/septic-tank-system-cost",
    source_date: "2025-09-22",
    note: "National range, not city adjusted. HomeGuide conventional systems $3,500 to $8,500. A local provider price was not copied onto this city."
  },
  driveway: {
    status: "published",
    conditional: true,
    estimated: true,
    low_dollars: 2400,
    high_dollars: 8600,
    unit: "per_job",
    city_adjusted: false,
    source_name: "HomeGuide",
    source_url: "https://homeguide.com/costs/concrete-driveway-cost",
    source_date: "2025-06-03",
    note: "National range, not city adjusted. HomeGuide 2-car driveway $2,400 to $8,600."
  }
};

export function familyOf(service) {
  const text = String(service || "").toLowerCase();
  if (!text.trim()) return null;
  if (text.includes("retaining")) return "retaining-wall";
  if (text.includes("septic")) return "septic";
  if (text.includes("driveway")) return "driveway";
  if (text.includes("crawl")) return "crawl-space";
  if (/locksmith|lockout|rekey|re-key/.test(text)) return "locksmith";
  if (text.includes("plumb")) return "plumbing";
  return null;
}

export function nationalGuide(serviceOrFamily) {
  const family = NATIONAL_GUIDES[serviceOrFamily] ? serviceOrFamily : familyOf(serviceOrFamily);
  if (family && NATIONAL_GUIDES[family]) return structuredClone(NATIONAL_GUIDES[family]);
  if (family === "locksmith" || family === "plumbing") {
    const price = priceForServiceNiche(family === "plumbing" ? "plumbing" : "locksmith");
    if (!price || price.status !== "published" || !Number.isInteger(price.low_dollars) || !Number.isInteger(price.high_dollars)) return null;
    return {
      status: "published",
      estimated: price.estimated === true,
      low_dollars: price.low_dollars,
      high_dollars: price.high_dollars,
      unit: price.unit === "hour" ? "hour" : "per_job",
      city_adjusted: false,
      source_name: price.source_name,
      source_url: price.source_url || price.url,
      note: "National range, not city adjusted."
    };
  }
  return null;
}

function samePlace(row, city, state) {
  return String(row.city || "").toLowerCase() === String(city || "").toLowerCase()
    && String(row.state || "").toLowerCase() === String(state || "").toLowerCase();
}

export function findFixture(service, city, state) {
  if (!city || !state) return null;
  const family = familyOf(service);
  const hit = DISCOVERY_FIXTURES.find((row) => samePlace(row, city, state) && (!family || row.service_family === family || familyOf(row.service) === family));
  return hit ? structuredClone(hit) : null;
}
