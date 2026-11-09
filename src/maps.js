import { LANGUAGE_CODE, MAPS_DEPTH, MAPS_DEVICE, MAPS_OS, MAPS_PATH, MAPS_SOURCE } from "./config.js";
import { classifyNumber, field } from "./measurement.js";
import { normalizePlace } from "./normalize.js";
import { readTask } from "./provider.js";

const DEPTH_NOTE = "Example checks request depth 20. Live checks request depth 100, which is one billed Maps page. Depth above 100 is refused. A returned sample is not exhaustive.";
const SE_NOTE = "DataForSEO documents se_results_count as the total number of results in the SERP. It is not a verified census of businesses, and it is never used in the score.";
const REGION_NOTE = "DataForSEO documents address_info.region as the DMA region. Some responses put a state name there. This app does not use it as a verified state filter.";
const CLAIMED_NOTE = "is_claimed means the Google listing has a claimed owner. Buyers are not verified.";
const RATING_NOTE = "Mean of Max5 ratings inside the deduped organic sample only. Not a market quality score.";
const COST_NOTE = "DataForSEO task cost for this API call, in USD. Not revenue and not a market size.";

function clip(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function normKey(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function identityOf(item) {
  if (typeof item.place_id === "string" && item.place_id.trim()) return `place:${item.place_id.trim()}`;
  if (typeof item.cid === "string" && item.cid.trim()) return `cid:${item.cid.trim()}`;
  if (typeof item.cid === "number" && Number.isFinite(item.cid)) return `cid:${item.cid}`;
  const title = normKey(item.title);
  const address = normKey(item.address);
  if (!title && !address) return null;
  return `name:${title}|${address}`;
}

function seCount(value, itemsCount) {
  const classified = classifyNumber(value);
  if ((classified.status === "measured" || classified.status === "measured_zero") && !Number.isInteger(value)) {
    return field("unusable", null, { used_in_score: false, note: SE_NOTE });
  }
  if (classified.status === "measured_zero" && Number.isInteger(itemsCount) && itemsCount > 0) {
    return field("inconsistent", 0, {
      used_in_score: false,
      note: `${SE_NOTE} A zero alongside returned items is not a measured business count.`
    });
  }
  if (classified.status === "missing") return field("missing", null, { used_in_score: false, note: SE_NOTE });
  if (classified.status === "measured_zero") return field("measured_zero", 0, { used_in_score: false, note: SE_NOTE });
  if (classified.status === "measured") return field("measured", classified.value, { used_in_score: false, note: SE_NOTE });
  return field("unusable", null, { used_in_score: false, note: SE_NOTE });
}

function emptyDedup(status) {
  return {
    organic_rows: 0,
    unique_organic_listings: field(status, status === "measured_zero" ? 0 : null, { unit: "deduped organic Maps listings in the returned sample" }),
    duplicates_removed: 0,
    paid_items: 0,
    paid_overlap_with_organic: 0,
    directory_items_excluded: 0,
    ignored_unknown_type: 0,
    unidentified_listings: 0,
    identity_order: ["place_id", "cid", "normalized title + address"]
  };
}

export function mapsShell({ status, location, sentToDataForSeo, message, code, queryCity, requestedDepth }) {
  return {
    status,
    endpoint: `POST ${MAPS_PATH}`,
    source: MAPS_SOURCE,
    requested_depth: requestedDepth || MAPS_DEPTH,
    depth_note: DEPTH_NOTE,
    device: MAPS_DEVICE,
    os: MAPS_OS,
    search_this_area: true,
    language_code: LANGUAGE_CODE,
    location,
    sent_to_dataforseo: Boolean(sentToDataForSeo),
    items_returned: null,
    se_results_count: field(sentToDataForSeo ? "missing" : "not_requested", null, { used_in_score: false, note: SE_NOTE }),
    deduplication: emptyDedup(status),
    address_flags: {
      query_city: queryCity || null,
      listings_with_different_address_city: 0,
      distinct_region_values: [],
      note: REGION_NOTE
    },
    ratings: {
      listings_with_max5_rating: 0,
      max5_sum: 0,
      mean_max5: null,
      listings_with_other_rating_type: 0,
      sample_votes_sum: null,
      listings_with_votes: 0,
      listings_missing_votes: 0,
      note: RATING_NOTE
    },
    claimed: { claimed: 0, not_claimed: 0, unknown: 0, note: CLAIMED_NOTE },
    listings: [],
    provider_reported_cost_usd: field(sentToDataForSeo ? "missing" : "not_requested", null, {
      unit: "USD",
      excluded_from_score: true,
      note: COST_NOTE
    }),
    error: message ? { code: code || status, message } : null
  };
}

export function mapsNotSent({ status, message, code, queryCity }) {
  return mapsShell({ status, location: null, sentToDataForSeo: false, message, code, queryCity });
}

function listingView(item) {
  const rating = item.rating && typeof item.rating === "object" ? item.rating : null;
  return {
    title: clip(item.title, 200),
    category: clip(item.category, 120),
    address: clip(item.address, 240),
    address_city: item.address_info && typeof item.address_info.city === "string" ? clip(item.address_info.city, 80) : null,
    rating_value: rating && typeof rating.value === "number" && Number.isFinite(rating.value) ? rating.value : null,
    rating_type: rating && typeof rating.rating_type === "string" ? clip(rating.rating_type, 40) : null,
    votes_count: rating && typeof rating.votes_count === "number" && Number.isFinite(rating.votes_count) ? rating.votes_count : null,
    is_claimed: item.is_claimed === true ? true : item.is_claimed === false ? false : null,
    place_id: typeof item.place_id === "string" ? clip(item.place_id, 128) : null,
    rank_absolute: Number.isInteger(item.rank_absolute) ? item.rank_absolute : null
  };
}

function dedupe(items, queryCity) {
  const indexed = items.map((item, index) => ({ item, index }));
  indexed.sort((a, b) => {
    const left = a.item && Number.isInteger(a.item.rank_absolute) ? a.item.rank_absolute : 100000 + a.index;
    const right = b.item && Number.isInteger(b.item.rank_absolute) ? b.item.rank_absolute : 100000 + b.index;
    return left - right || a.index - b.index;
  });
  const organicIds = new Set();
  const paidIds = new Set();
  const kept = [];
  const dedup = emptyDedup("measured_zero");
  let differentCity = 0;
  const regions = [];
  let max5Sum = 0;
  let max5Count = 0;
  let otherRating = 0;
  let votesSum = 0;
  let votesKnown = 0;
  let votesUnknown = 0;
  let claimed = 0;
  let notClaimed = 0;
  let claimUnknown = 0;
  let withoutWebsite = 0;

  for (const { item } of indexed) {
    if (!item || typeof item !== "object") {
      dedup.ignored_unknown_type += 1;
      continue;
    }
    if (item.type === "maps_paid_item") {
      dedup.paid_items += 1;
      const paidId = identityOf(item);
      if (paidId) paidIds.add(paidId);
      continue;
    }
    if (item.type !== "maps_search") {
      dedup.ignored_unknown_type += 1;
      continue;
    }
    if (item.is_directory_item === true) {
      dedup.directory_items_excluded += 1;
      continue;
    }
    dedup.organic_rows += 1;
    const id = identityOf(item);
    if (!id) {
      dedup.unidentified_listings += 1;
      kept.push(item);
      continue;
    }
    if (organicIds.has(id)) {
      dedup.duplicates_removed += 1;
      continue;
    }
    organicIds.add(id);
    kept.push(item);
  }

  dedup.paid_overlap_with_organic = [...paidIds].filter((id) => organicIds.has(id)).length;
  dedup.unique_organic_listings = field(kept.length === 0 ? "measured_zero" : "measured", kept.length, {
    unit: "deduped organic Maps listings in the returned sample"
  });

  const queryNorm = normalizePlace(queryCity);
  for (const item of kept) {
    const rating = item.rating && typeof item.rating === "object" ? item.rating : null;
    if (rating && typeof rating.value === "number" && Number.isFinite(rating.value)) {
      const type = rating.rating_type;
      if ((type === "Max5" || type == null) && rating.value >= 0 && rating.value <= 5) {
        max5Sum += rating.value;
        max5Count += 1;
      } else otherRating += 1;
    }
    const votes = rating && rating.votes_count;
    if (typeof votes === "number" && Number.isFinite(votes) && votes >= 0) {
      votesSum += votes;
      votesKnown += 1;
    } else votesUnknown += 1;
    if (item.is_claimed === true) claimed += 1;
    else if (item.is_claimed === false) notClaimed += 1;
    else claimUnknown += 1;
    const city = item.address_info && item.address_info.city;
    if (typeof city === "string" && city.trim() && queryNorm && normalizePlace(city) !== queryNorm) differentCity += 1;
    const site = item.domain || item.url || (item.contact_info && item.contact_info.url);
    if (typeof site !== "string" || !site.trim()) withoutWebsite += 1;
    const region = item.address_info && item.address_info.region;
    if (typeof region === "string" && region.trim() && regions.length < 8 && !regions.includes(region.trim())) {
      regions.push(region.trim());
    }
  }

  return {
    dedup,
    listings: kept.map(listingView),
    differentCity,
    regions,
    ratings: {
      listings_with_max5_rating: max5Count,
      max5_sum: Math.round(max5Sum * 100) / 100,
      mean_max5: max5Count ? Math.round((max5Sum / max5Count) * 100) / 100 : null,
      listings_with_other_rating_type: otherRating,
      sample_votes_sum: votesKnown ? votesSum : null,
      listings_with_votes: votesKnown,
      listings_missing_votes: votesUnknown,
      note: RATING_NOTE
    },
    claimed: { claimed, not_claimed: notClaimed, unknown: claimUnknown, note: CLAIMED_NOTE },
    withoutWebsite
  };
}

export function parseMapsPayload(payload, context) {
  const read = readTask(payload);
  if (!read.ok) {
    const failed = mapsShell({
      status: "failed",
      location: context.location,
      sentToDataForSeo: context.sentToDataForSeo,
      message: context.redact ? context.redact(read.message).slice(0, 300) : String(read.message).slice(0, 300),
      code: read.code,
      queryCity: context.queryCity
    });
    return failed;
  }
  const serp = Array.isArray(read.result) ? read.result[0] : null;
  if (!serp || typeof serp !== "object") {
    const missing = mapsShell({
      status: "missing",
      location: context.location,
      sentToDataForSeo: context.sentToDataForSeo,
      message: "DataForSEO returned no Maps SERP object. That is not a measured zero.",
      code: "missing_result",
      queryCity: context.queryCity
    });
    missing.provider_reported_cost_usd = field(read.cost === null ? "missing" : read.cost === 0 ? "measured_zero" : "measured", read.cost, {
      unit: "USD",
      excluded_from_score: true,
      note: COST_NOTE
    });
    return missing;
  }

  let items = serp.items;
  if (!Array.isArray(items)) {
    if (items == null && serp.items_count === 0) items = [];
    else {
      const missing = mapsShell({
        status: "missing",
        location: context.location,
        sentToDataForSeo: context.sentToDataForSeo,
        message: "The Maps payload did not include an items array. Listings were not invented.",
        code: "missing_items",
        queryCity: context.queryCity
      });
      missing.se_results_count = seCount(serp.se_results_count, serp.items_count);
      return missing;
    }
  }

  const parsed = dedupe(items, context.queryCity);
  const report = mapsShell({
    status: parsed.dedup.unique_organic_listings.status,
    location: context.location,
    sentToDataForSeo: context.sentToDataForSeo,
    queryCity: context.queryCity,
    requestedDepth: context.requestedDepth
  });
  report.items_returned = items.length;
  report.se_results_count = seCount(serp.se_results_count, items.length);
  report.deduplication = parsed.dedup;
  report.listings = parsed.listings;
  report.address_flags = {
    query_city: context.queryCity || null,
    listings_with_different_address_city: parsed.differentCity,
    distinct_region_values: parsed.regions,
    note: REGION_NOTE
  };
  report.ratings = parsed.ratings;
  report.listings_without_website = parsed.withoutWebsite;
  report.claimed = parsed.claimed;
  report.provider_reported_cost_usd = field(read.cost === null ? "missing" : read.cost === 0 ? "measured_zero" : "measured", read.cost, {
    unit: "USD",
    excluded_from_score: true,
    note: COST_NOTE
  });
  return report;
}

export function mapsFromError(error, context) {
  const sent = Boolean(context.sentToDataForSeo) && !["refused", "credentials_missing", "credentials_invalid", "budget_exceeded"].includes(error && error.code);
  return mapsShell({
    status: "failed",
    location: context.location,
    sentToDataForSeo: sent,
    message: context.redact ? context.redact(error && error.message).slice(0, 300) : String(error && error.message || "Maps request failed.").slice(0, 300),
    code: (error && error.code) || "failed",
    queryCity: context.queryCity,
    requestedDepth: context.requestedDepth
  });
}
