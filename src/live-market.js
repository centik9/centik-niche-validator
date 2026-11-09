import { bandFor } from "./scoring.js";

export const LIVE_LABEL = "Live Google data";
export const EXAMPLE_LABEL = "Example data";

function measured(metric) {
  return metric && (metric.status === "measured" || metric.status === "measured_zero") && Number.isInteger(metric.value);
}

function clusteredIndexVolume(demand) {
  const clustered = demand && demand.clustered_coverage_volume;
  if (!clustered || demand.demand_index_uses !== "clustered_coverage_volume" || !Number.isInteger(clustered.value)) return null;
  if (clustered.status === "measured" || clustered.status === "measured_zero") return clustered.value;
  if (clustered.status === "partial" && clustered.value > 0) return clustered.value;
  return null;
}

export const LISTING_ROOM_CAP = 100;

export function liveCompetitionIndex({ listings, withoutWebsite, averageReviews }) {
  if (!Number.isInteger(listings) || listings < 0) return null;
  const capped = Math.min(listings, LISTING_ROOM_CAP);
  const room = Math.round((100 * (LISTING_ROOM_CAP - capped)) / LISTING_ROOM_CAP);
  const noSite = listings === 0 ? 0 : Math.round((100 * Math.min(withoutWebsite || 0, listings)) / listings);
  const pressure = Math.round(Math.min(100, Math.max(0, averageReviews || 0)));
  return Math.max(0, Math.min(100, Math.round((0.5 * room) + (0.3 * noSite) + (0.2 * (100 - pressure)))));
}

export function cityMarketFromReports(demand, maps, origin) {
  if (origin !== "live") {
    return {
      live: false,
      demand_label: EXAMPLE_LABEL,
      competition_label: EXAMPLE_LABEL,
      demand_index: null,
      competition_index: null,
      search_volume: null,
      clustered_coverage_volume: null,
      demand_index_input: "clustered_coverage_volume",
      unique_listings: null,
      listings_without_website: null,
      average_reviews: null,
      formula: "Example competition count = max(3, round(28 − example demand / 4)). It is not a Maps count."
    };
  }
  const volume = demand && demand.search_volume;
  const clusteredVolume = clusteredIndexVolume(demand);
  const band = clusteredVolume === null ? null : bandFor(clusteredVolume);
  const listingsField = maps && maps.deduplication && maps.deduplication.unique_organic_listings;
  const listings = measured(listingsField) ? listingsField.value : null;
  const withoutWebsite = Number.isInteger(maps && maps.listings_without_website) ? maps.listings_without_website : 0;
  const votes = maps && maps.ratings && maps.ratings.listings_with_votes;
  const voteSum = maps && maps.ratings && maps.ratings.sample_votes_sum;
  const averageReviews = votes > 0 && typeof voteSum === "number" ? voteSum / votes : 0;
  return {
    live: true,
    demand_label: LIVE_LABEL,
    competition_label: LIVE_LABEL,
    demand_index: band ? band.index : null,
    competition_index: liveCompetitionIndex({ listings, withoutWebsite, averageReviews }),
    search_volume: measured(volume) ? volume.value : null,
    clustered_coverage_volume: clusteredVolume,
    demand_index_input: "clustered_coverage_volume",
    demand_index_note: "The demand index is the band of clustered coverage volume. The core term volume is search_volume and is not the index input. Missing keyword rows are omitted from the sum, not entered as zero.",
    unique_listings: listings,
    listings_without_website: listings === null ? null : withoutWebsite,
    average_reviews: listings === null ? null : Math.round(averageReviews),
    formula: "Live competition index = round(0.5 × listing room + 0.3 × share with no website + 0.2 × (100 − review pressure)). Listing room is round(100 × (100 − min(unique organic listings, 100)) / 100), so 40 listings scores differently from 90. It does not use max(3, round(28 − demand / 4)). Regular Google organic directory share is a supporting signal and is not an input to this index."
  };
}
