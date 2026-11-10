import {
  KEYWORD_IDEAS_PATH,
  KEYWORD_IDEAS_SOURCE,
  US_LOCATION_CODE
} from "./config.js";
import { DataForSeoError, HttpError } from "./errors.js";
import { FLOW_MODEL_ID } from "./microsite-flow.js";
import { KEYWORD_IDEAS_COST_USD } from "./spend.js";
import {
  discoverSubniches,
  discoveryCacheKey,
  keywordIdeasSeed
} from "./subniche-discovery.js";

const SPEND_BLOCKS = new Set(["spend_cap_exceeded", "spend_baseline_missing", "spend_account_unavailable"]);

function spendRefusal(reason) {
  if (reason === "expired") return "That spend confirmation expired. No DataForSEO request was sent.";
  if (reason === "reused") return "That spend confirmation was already used. No DataForSEO request was sent.";
  if (reason === "mismatched") return "That spend confirmation does not match this keyword. No DataForSEO request was sent.";
  if (reason === "bad_signature") return "That spend confirmation is not valid. No DataForSEO request was sent.";
  if (reason === "spend_cap_exceeded") return "This lookup would pass the spend cap. No DataForSEO request was sent.";
  if (reason === "spend_baseline_missing") return "DATAFORSEO_SPENT_BASELINE_USD is not set. Live checks are refused. No paid request was sent.";
  if (reason === "spend_account_unavailable") return "The DataForSEO account spend could not be read. Live checks are refused. No paid request was sent.";
  return "A paid lookup needs a fresh confirmation. No DataForSEO request was sent.";
}

function clientPayload(raw, ranked, meta) {
  return {
    model_id: FLOW_MODEL_ID,
    data_origin: "live",
    example_data: false,
    paid_dataforseo_called: meta.paid_dataforseo_called,
    cache_hit: false,
    needs_confirmation: false,
    context: { keyword: raw },
    context_note: "Specialties use United States keyword ideas (location_code 2840). No city is applied. The later paid check still measures the city you pick.",
    known_profile: ranked.known_profile,
    profile_id: ranked.profile_id,
    ranking_kind: "live_keyword_ideas",
    row_count: ranked.subniches.length,
    ranking_note: ranked.ranking_note,
    source: KEYWORD_IDEAS_SOURCE,
    location_code: US_LOCATION_CODE,
    location_name: "United States",
    endpoint: KEYWORD_IDEAS_PATH,
    raw_item_count: ranked.raw_item_count,
    in_trade_count: ranked.in_trade_count,
    filtered_out_count: ranked.filtered_out_count,
    unmeasured_in_trade_count: ranked.unmeasured_in_trade_count,
    provider_cost_usd: meta.provider_cost_usd,
    cost_source: meta.cost_source,
    estimated_cost_usd: meta.estimated_cost_usd,
    subniches: ranked.subniches,
    unranked_option: ranked.unranked_option
  };
}

function presentCached(hit) {
  return {
    ...hit.report,
    cache_hit: true,
    paid_dataforseo_called: false,
    needs_confirmation: false,
    estimated_cost_usd: 0,
    cached_at: hit.saved_at
  };
}

export async function handleLiveSubniches(ctx) {
  if (!ctx.credentialsReady) {
    return {
      status: 503,
      payload: {
        error: "credentials_missing",
        message: "Live mode is on but DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are not set. No DataForSEO request was sent."
      }
    };
  }
  const raw = ctx.body && typeof ctx.body.keyword === "string" ? ctx.body.keyword.trim() : "";
  const seed = keywordIdeasSeed(raw);
  const cacheKey = discoveryCacheKey(seed, US_LOCATION_CODE);
  const rerun = ctx.body && ctx.body.rerun === true;
  if (!rerun) {
    const cached = await ctx.cache.get(cacheKey);
    if (cached) return { status: 200, payload: presentCached(cached) };
  }
  if (!ctx.body || typeof ctx.body.spend_token !== "string" || !ctx.body.spend_token) {
    try {
      const quoted = await ctx.spend.quoteDiscovery(ctx.email, seed, US_LOCATION_CODE, { requireAccount: ctx.requireAccount });
      return {
        status: 200,
        payload: {
          model_id: FLOW_MODEL_ID,
          data_origin: "live",
          example_data: false,
          paid_dataforseo_called: false,
          cache_hit: false,
          needs_confirmation: true,
          context: { keyword: raw },
          context_note: "No city is used for this lookup. Confirm to request United States keyword ideas.",
          known_profile: false,
          ranking_kind: "confirmation_required",
          ranking_note: `No DataForSEO request was sent. United States keyword ideas for this service cost up to $${KEYWORD_IDEAS_COST_USD.toFixed(3)} ($0.012 plus $0.00012 for each of up to 40 ideas). Press Okay to send that one request.`,
          estimated_cost_usd: quoted.estimated_cost_usd,
          calls: quoted.calls,
          spend_token: quoted.spend_token,
          expires_at: quoted.expires_at,
          spent_usd: quoted.spent_usd,
          remaining_usd: quoted.remaining_usd,
          cap_usd: quoted.cap_usd,
          subniches: [],
          unranked_option: null
        }
      };
    } catch (error) {
      if (error && error.status) {
        return { status: error.status, payload: { error: error.code, message: error.message } };
      }
      throw error;
    }
  }
  const limit = ctx.checkRateLimit();
  if (!limit.allowed) {
    const seconds = Math.max(1, Math.ceil(limit.retryAfterMs / 1000));
    return {
      status: 429,
      headers: { "Retry-After": String(seconds) },
      payload: {
        error: "rate_limited",
        message: "Too many requests. Wait and try again. No additional DataForSEO request was sent for this attempt."
      }
    };
  }
  const decision = await ctx.spend.acceptDiscovery(ctx.body.spend_token, ctx.email, seed, US_LOCATION_CODE, {
    requireAccount: ctx.requireAccount
  });
  if (!decision.ok) {
    return {
      status: 403,
      payload: {
        error: SPEND_BLOCKS.has(decision.reason) ? decision.reason : "spend_not_confirmed",
        message: decision.message || spendRefusal(decision.reason)
      }
    };
  }
  if (!rerun) {
    const cached = await ctx.cache.get(cacheKey);
    if (cached) return { status: 200, payload: presentCached(cached) };
  }
  try {
    const discovered = await discoverSubniches(raw, ctx.transport, US_LOCATION_CODE);
    const recorded = await ctx.spend.recordDiscovery({
      email: ctx.email,
      keyword: seed,
      costUsd: discovered.provider_cost_usd,
      costSource: discovered.cost_source
    });
    const payload = clientPayload(raw, discovered, {
      paid_dataforseo_called: true,
      provider_cost_usd: discovered.provider_cost_usd,
      cost_source: discovered.cost_source,
      estimated_cost_usd: recorded
    });
    await ctx.cache.set(cacheKey, payload);
    return { status: 200, payload };
  } catch (error) {
    if (error && typeof error.provider_cost_usd === "number") {
      await ctx.spend.recordDiscovery({
        email: ctx.email,
        keyword: seed,
        costUsd: error.provider_cost_usd,
        costSource: "provider"
      });
    }
    if (error instanceof HttpError) {
      return { status: error.status, payload: { error: error.code, message: error.message } };
    }
    if (error instanceof DataForSeoError) {
      return {
        status: 502,
        payload: {
          error: error.code || "keyword_ideas_failed",
          message: `DataForSEO keyword ideas failed. Example specialties were not substituted. ${error.message}`.slice(0, 320)
        }
      };
    }
    throw error;
  }
}
