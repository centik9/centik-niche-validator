// Lead conversion rates for the Niche Validator estimates box (Phase 1).
// Seeded LocaliQ / WordStream 2025 figures are median ad click-to-lead CVRs.
// They are applied when a niche maps cleanly, and the UI must say so.
// They are not search-to-lead rates. Do not treat unmapped niches as 38-52 of 2,900.
//
// Phase 2 (deferred): on-demand research for niches with no studied rate.
// Do not invent a ballpark here.
// Phase 3 (deferred): usage-triggered refresh about once a month
// (REFRESH_INTERVAL_DAYS = 30) when a user opens the tool and the estimates
// box resolves that niche. No background timers, cron, intervals, or idle jobs.

export const LOCALIQ_BLOG_URL = "https://localiq.com/blog/home-services-search-advertising-benchmarks/";
export const LOCALIQ_PDF_URL = "https://www.wordstream.com/wp-content/uploads/2025/06/ws-guide-home-services-benchmarks-2025.pdf";
export const LOCALIQ_YEAR = 2025;
export const LOCALIQ_COVERAGE = "3,211 US campaigns, Apr 1 2024-Mar 21 2025";

// Documented historical reference from the estimates mock. Phase 1 does not
// apply this to any niche. Unmapped niches show a looking-up state instead.
export const DEFAULT_LEAD_CONVERSION = {
  low: 38 / 2900,
  mid: 45 / 2900,
  high: 52 / 2900,
  status: "default",
  source: "Validator estimates reference: 38 to 52 leads from 2,900 monthly searches.",
  notes: "Phase 1 does not apply this default. Niches without a studied rate show a looking-up state instead of inventing a number."
};

const LOCALIQ_NOTE = "LocaliQ / WordStream 2025 Home Services Search Ads Benchmarks median click-to-lead CVR (share of ad clicks that become a lead or sale), not search-volume-to-lead. " + LOCALIQ_COVERAGE + ". Cite the LocaliQ blog table.";

export const PLUMBING_SUBNICHE_IDS = [
  "emergency-plumbing",
  "drain-cleaning",
  "water-heater-repair",
  "leak-detection",
  "toilet-repair",
  "faucet-repair",
  "sewer-line",
  "garbage-disposal",
  "pipe-repair",
  "sump-pump",
  "bath-remodel-plumbing",
  "kitchen-sink",
  "water-filtration",
  "gas-line",
  "hydro-jetting",
  "repipe",
  "hose-bib",
  "water-softener",
  "backflow",
  "tankless-water-heater"
];

const PLUMBING_ALIASES = [
  "plumbing",
  ...PLUMBING_SUBNICHE_IDS,
  "emergency plumbing",
  "drain cleaning",
  "water heater repair",
  "leak detection",
  "toilet repair",
  "faucet and fixture repair",
  "faucet repair",
  "sewer line service",
  "sewer line",
  "garbage disposal service",
  "garbage disposal",
  "pipe repair",
  "sump pump service",
  "sump pump",
  "bathroom remodel plumbing",
  "bath remodel plumbing",
  "kitchen sink service",
  "kitchen sink",
  "water filtration install",
  "water filtration",
  "gas line plumbing",
  "gas line",
  "hydro jetting",
  "repipe consultation",
  "repipe",
  "outdoor faucet service",
  "hose bib",
  "water softener service",
  "water softener",
  "backflow testing",
  "backflow",
  "tankless water heater service",
  "tankless water heater"
];

function localiqRow({
  id,
  category_label,
  cvr_percent,
  aliases = [],
  applied = true,
  notes = LOCALIQ_NOTE
}) {
  return {
    id,
    category_label,
    aliases,
    metric_type: "click_to_lead",
    cvr_percent,
    low: cvr_percent / 100,
    mid: cvr_percent / 100,
    high: cvr_percent / 100,
    source: LOCALIQ_BLOG_URL,
    source_pdf: LOCALIQ_PDF_URL,
    year: LOCALIQ_YEAR,
    applied,
    notes
  };
}

export const RESEARCHED_RATES = [
  localiqRow({
    id: "plumbing",
    category_label: "plumbing",
    cvr_percent: 7.63,
    aliases: PLUMBING_ALIASES,
    notes: LOCALIQ_NOTE + " Plumbing 7.63% is on the LocaliQ blog table. The PDF body only printed category highs and lows, not this mid-table value."
  }),
  localiqRow({
    id: "hvac",
    category_label: "HVAC",
    cvr_percent: 7.02,
    aliases: [
      "hvac",
      "hvac repair",
      "heating",
      "heating and furnaces",
      "furnace",
      "furnaces",
      "ac",
      "air conditioning",
      "air conditioning installation and repair",
      "heat pump"
    ],
    notes: LOCALIQ_NOTE + " Mixed HVAC uses the midpoint of Air Conditioning Installation & Repair 6.56% and Heating & Furnaces 7.48%, which is 7.02%."
  }),
  localiqRow({
    id: "electrician",
    category_label: "electricians",
    cvr_percent: 9.08,
    aliases: [
      "electrician",
      "electricians",
      "electrical",
      "electricians and electrical contractors",
      "electrical contractors"
    ]
  }),
  localiqRow({
    id: "cleaning",
    category_label: "cleaning",
    cvr_percent: 17.65,
    aliases: [
      "cleaning",
      "maid",
      "butler",
      "house cleaning",
      "maid service",
      "cleaning maid butler services"
    ]
  }),
  localiqRow({
    id: "roofing",
    category_label: "roofing",
    cvr_percent: 3.70,
    aliases: ["roofing", "roof", "gutters", "roofing and gutters", "gutter"]
  }),
  localiqRow({
    id: "handyman",
    category_label: "handyman services",
    cvr_percent: 13.45,
    aliases: ["handyman", "handyman services"]
  }),
  localiqRow({
    id: "painting",
    category_label: "painting",
    cvr_percent: 10.80,
    aliases: ["painting", "paint", "painter", "paint and painting"]
  }),
  localiqRow({
    id: "landscaping",
    category_label: "landscaping",
    cvr_percent: 6.42,
    aliases: ["landscaping", "landscape", "landscaper"]
  }),
  localiqRow({
    id: "window-cleaning",
    category_label: "window cleaning",
    cvr_percent: 13.58,
    aliases: ["window-cleaning", "window cleaning"]
  }),
  localiqRow({
    id: "pools",
    category_label: "pools and spas",
    cvr_percent: 10.89,
    aliases: ["pools", "spas", "pool", "spa", "pools and spas"]
  }),
  localiqRow({
    id: "doors-windows",
    category_label: "doors and windows",
    cvr_percent: 4.41,
    aliases: ["doors-windows", "doors and windows", "doors and windows sales", "window sales", "door sales"]
  }),
  localiqRow({
    id: "construction",
    category_label: "construction",
    cvr_percent: 2.61,
    aliases: [
      "construction",
      "contractor",
      "general contractor",
      "construction and contractors",
      "construction and contractors general"
    ]
  }),
  localiqRow({
    id: "blinds",
    category_label: "blinds and window treatments",
    cvr_percent: 6.00,
    aliases: ["blinds", "window treatments", "blinds and window treatments"]
  }),
  localiqRow({
    id: "storage",
    category_label: "storage",
    cvr_percent: 4.65,
    aliases: ["storage"]
  }),
  // Stored for documentation only. Do not map LocaliQ "Garages" 5.66% to garage-door repair.
  localiqRow({
    id: "garages",
    category_label: "garages",
    cvr_percent: 5.66,
    aliases: ["garages"],
    applied: false,
    notes: LOCALIQ_NOTE + " Not applied. Do not map this category to garage-door repair."
  }),
  localiqRow({
    id: "home-services-average",
    category_label: "home services",
    cvr_percent: 7.33,
    aliases: [],
    applied: false,
    notes: LOCALIQ_NOTE + " Home services average or median 7.33%. Not applied as a catch-all for unknown niches."
  })
];

export function normalizeNicheKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rowKeys(row) {
  return new Set(
    [row.id, row.category_label, ...(row.aliases || [])]
      .map(normalizeNicheKey)
      .filter(Boolean)
  );
}

export function findResearchedRate(nicheId, nicheLabel, rates = RESEARCHED_RATES) {
  const idKey = normalizeNicheKey(nicheId);
  const labelKey = normalizeNicheKey(nicheLabel);
  for (const row of rates) {
    const keys = rowKeys(row);
    if (idKey && keys.has(idKey)) return row;
    if (labelKey && keys.has(labelKey)) return row;
  }
  return null;
}

function lookingUp(nicheId, nicheLabel) {
  const label = String(nicheLabel || "").trim() || String(nicheId || "").trim().replace(/-/g, " ") || "this service";
  return {
    status: "looking_up",
    metric_type: null,
    cvr_percent: null,
    low: null,
    mid: null,
    high: null,
    source: null,
    year: null,
    category_id: null,
    category_label: null,
    niche_id: nicheId || null,
    niche_label: label,
    applied: false,
    notes: "No studied rate in the seeded table yet. Phase 2 will research a ballpark. Do not invent a number."
  };
}

export function resolveLeadConversion(nicheId, nicheLabel, options = {}) {
  const table = options.rates || RESEARCHED_RATES;
  const row = findResearchedRate(nicheId, nicheLabel, table);
  if (!row || row.applied !== true) return lookingUp(nicheId, nicheLabel);
  return {
    status: "applied",
    metric_type: row.metric_type,
    cvr_percent: row.cvr_percent,
    low: row.low,
    mid: row.mid,
    high: row.high,
    source: row.source,
    year: row.year,
    category_id: row.id,
    category_label: row.category_label,
    niche_id: nicheId || row.id,
    niche_label: String(nicheLabel || "").trim() || row.category_label,
    applied: true,
    notes: row.notes
  };
}

export function leadRangeFromConversion(searches, resolved) {
  if (!Number.isFinite(searches) || searches <= 0) return null;
  if (!resolved || resolved.status !== "applied") return null;
  if (!Number.isFinite(resolved.low) || !Number.isFinite(resolved.high) || !Number.isFinite(resolved.mid)) return null;
  const conv = (rate) => Math.max(1, Math.round(searches * rate));
  return {
    low: conv(resolved.low),
    high: conv(resolved.high),
    mid: conv(resolved.mid)
  };
}

export function conversionFlagCopy(resolved) {
  if (resolved && resolved.status === "applied") {
    const label = resolved.category_label || resolved.niche_label || "this service";
    return `These leads use a published ad click-to-lead rate for ${label}. That is the share of ad clicks that become a lead, not the share of all Google searches.`;
  }
  const label = (resolved && resolved.niche_label) || "this service";
  return `Looking up a conversion rate for ${label}. We don't have a studied rate yet.`;
}
