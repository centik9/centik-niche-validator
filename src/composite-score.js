export const COMPOSITE_MODEL_ID = "centik-composite-v1";
export const DEMAND_WEIGHT = 40;
export const COMPETITION_WEIGHT = 30;
export const MARGIN_WEIGHT = 30;
export const GREEN_MIN = 60;
export const YELLOW_MIN = 30;
export const COMPETITION_FULL_SCALE = 30;
export const MARGIN_FLOOR_CENTS = 10_000;
export const MARGIN_CEILING_CENTS = 500_000;

export const NORMALIZATION = {
  demand: "The demand component is the example relative-demand index, clamped to 0–100. It is not rescaled. Displayed example monthly searches equal that index times 12. Both figures are fixtures, not Google volume.",
  competition: "The competition component is round(100 × (30 − example competitor count) / 30), then clamped to 0–100. Fewer competitors score higher. The count is the example fixture max(3, round(28 − demand / 4)), not a Maps listing count.",
  margin: "Margin is not accounting profit. Cost is not in the price source. The component is the published national midpoint, in cents, placed on a fixed log window from $100 to $5,000: round(100 × ln(midpoint / 10000) / ln(500000 / 10000)), clamped to 0–100. A midpoint at $100 scores 0. A midpoint at or above $5,000 scores 100. The range is not adjusted for a city.",
  composite: "Composite tenths = 4 × demand index + 3 × competition index + 3 × margin index. Displayed score = tenths / 10. Weights are demand 40%, competition 30%, margin 30%.",
  bands: "Green is 60 or higher. Yellow is 30 up to but not including 60. Red is below 30. A missing price withholds the margin and the composite. It is not treated as zero and it is not placed in the red band.",
  sort: "Green rows first, then yellow, then red, then withheld rows. Inside a scored band, the higher composite is first."
};

function formatTenths(tenths) {
  const abs = Math.abs(tenths);
  return `${Math.trunc(abs / 10)}.${abs % 10}`;
}

function clampIndex(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function competitionIndex(competitorCount) {
  if (!Number.isInteger(competitorCount) || competitorCount < 0) return null;
  const raw = Math.round((100 * (COMPETITION_FULL_SCALE - competitorCount)) / COMPETITION_FULL_SCALE);
  return Math.max(0, Math.min(100, raw));
}

export function marginIndex(lowDollars, highDollars) {
  if (!Number.isInteger(lowDollars) || !Number.isInteger(highDollars) || lowDollars < 0 || highDollars < lowDollars) return null;
  const midpointCents = Math.round((lowDollars * 100 + highDollars * 100) / 2);
  if (midpointCents <= MARGIN_FLOOR_CENTS) return 0;
  if (midpointCents >= MARGIN_CEILING_CENTS) return 100;
  const raw = (100 * Math.log(midpointCents / MARGIN_FLOOR_CENTS)) / Math.log(MARGIN_CEILING_CENTS / MARGIN_FLOOR_CENTS);
  return clampIndex(raw);
}

export function bandForComposite(value) {
  if (value === null || value === undefined) return "missing";
  if (value >= GREEN_MIN) return "green";
  if (value >= YELLOW_MIN) return "yellow";
  return "red";
}

function contribution(index, weight) {
  const tenths = index * weight / 10;
  return { index, tenths, display: formatTenths(tenths) };
}

export function scoreExampleMarket({ exampleRelativeDemand, exampleMonthlySearches, exampleCompetitorCount, price }) {
  const demandIndex = clampIndex(exampleRelativeDemand);
  const competition = competitionIndex(exampleCompetitorCount);
  const margin = price && price.status === "published" ? marginIndex(price.low_dollars, price.high_dollars) : null;
  const base = {
    model_id: COMPOSITE_MODEL_ID,
    weights: { demand: DEMAND_WEIGHT, competition: COMPETITION_WEIGHT, margin: MARGIN_WEIGHT },
    normalization: NORMALIZATION,
    demand: {
      label: "EXAMPLE",
      index: demandIndex,
      monthly_searches: exampleMonthlySearches,
      contribution_display: demandIndex === null ? null : contribution(demandIndex, DEMAND_WEIGHT).display,
      note: NORMALIZATION.demand
    },
    competition: {
      label: "EXAMPLE",
      competitor_count: exampleCompetitorCount,
      index: competition,
      contribution_display: competition === null ? null : contribution(competition, COMPETITION_WEIGHT).display,
      note: NORMALIZATION.competition
    },
    margin: {
      status: margin === null ? "missing" : "published",
      index: margin,
      contribution_display: margin === null ? null : contribution(margin, MARGIN_WEIGHT).display,
      low_dollars: price && price.low_dollars !== undefined ? price.low_dollars : null,
      high_dollars: price && price.high_dollars !== undefined ? price.high_dollars : null,
      sentence: price ? price.sentence : "Price range missing",
      source_name: price && price.source_name ? price.source_name : null,
      url: price && price.url ? price.url : null,
      accessed: price ? price.accessed : null,
      city_adjusted: false,
      scope: "national_united_states",
      note: margin === null ? "Margin is missing. It is not scored as zero." : NORMALIZATION.margin
    }
  };
  if (demandIndex === null || competition === null || margin === null) {
    return {
      ...base,
      status: "withheld",
      withheld_reason: margin === null ? "margin_missing" : "input_missing",
      composite_tenths: null,
      composite_display: null,
      band: "missing",
      clears_green: null,
      clears_green_label: "not calculated"
    };
  }
  const tenths = demandIndex * 4 + competition * 3 + margin * 3;
  const value = tenths / 10;
  const band = bandForComposite(value);
  return {
    ...base,
    status: "calculated",
    withheld_reason: null,
    composite_tenths: tenths,
    composite_display: formatTenths(tenths),
    band,
    clears_green: value >= GREEN_MIN,
    clears_green_label: value >= GREEN_MIN ? "yes" : "no"
  };
}

const BAND_ORDER = { green: 0, yellow: 1, red: 2, missing: 3 };

export function compareScoredRows(a, b) {
  const bandGap = BAND_ORDER[a.composite.band] - BAND_ORDER[b.composite.band];
  if (bandGap) return bandGap;
  const aTenths = a.composite.composite_tenths;
  const bTenths = b.composite.composite_tenths;
  if (aTenths !== bTenths) return (bTenths ?? -1) - (aTenths ?? -1);
  return String(a.label).localeCompare(String(b.label));
}
