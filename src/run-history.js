import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { zoneFor } from "./gauge-zone.js";
import { LENS_LABELS, evaluateService, normalizeLens, verdictWord } from "./lenses.js";
import { diffRuns } from "./run-diff.js";
import { RESULT_CACHE_VERSION } from "./spend.js";

const MAX_PER_USER = 200;

function numberField(status, value, estimated, note) {
  const numeric = typeof value === "number" && Number.isFinite(value);
  return {
    kind: "number",
    status: numeric ? status : "unavailable",
    value: numeric ? value : null,
    estimated: Boolean(estimated),
    note: note || ""
  };
}

function rangeField(status, low, high, estimated, note) {
  const ok = Number.isInteger(low) && Number.isInteger(high) && high >= low;
  return {
    kind: "range",
    status: ok ? status : "unavailable",
    low: ok ? low : null,
    high: ok ? high : null,
    estimated: Boolean(estimated),
    note: note || ""
  };
}

function wordsField(value, note) {
  return {
    kind: "words",
    status: value ? "measured" : "unavailable",
    value: value || null,
    estimated: false,
    note: note || ""
  };
}

export function pairKey(run) {
  return [run.niche, run.city, run.state].map((part) => String(part || "").trim().toLowerCase().replace(/\s+/g, " ")).join("|");
}

function lensFields(service, city, state, lens) {
  const activeId = normalizeLens(lens);
  const evaluated = evaluateService({ service, city, state });
  const active = activeId === "four_yes" ? evaluated.four_yes : evaluated.classroom;
  const other = activeId === "four_yes" ? evaluated.classroom : evaluated.four_yes;
  return {
    lens: activeId,
    lens_label: LENS_LABELS[activeId],
    lens_verdict: active.verdict,
    lens_verdict_label: verdictWord(active.verdict),
    other_lens: other.id,
    other_lens_label: other.label,
    other_lens_verdict: other.verdict,
    lenses_disagree: evaluated.disagree
  };
}

function shell({ email, service, city, state, lens, origin, checkedAt, mapsDepth, checkVersion }) {
  return {
    id: `run_${crypto.randomBytes(8).toString("hex")}`,
    user: String(email || "").trim().toLowerCase(),
    checked_at: checkedAt,
    niche: service,
    city,
    state,
    origin,
    maps_depth: Number.isInteger(mapsDepth) ? mapsDepth : null,
    check_version: checkVersion || (origin === "discovery" ? "discovery" : RESULT_CACHE_VERSION),
    ...lensFields(service, city, state, lens)
  };
}

function metric(report, pathName) {
  const parts = pathName.split(".");
  let cursor = report;
  for (const part of parts) {
    cursor = cursor && cursor[part];
  }
  return cursor;
}

function measuredInteger(field) {
  if (!field || (field.status !== "measured" && field.status !== "measured_zero")) return null;
  return Number.isInteger(field.value) ? field.value : null;
}

export function snapshotFromValidation(report, extras) {
  const { email, lens, checkedAt } = extras;
  const example = report.example_data === true || report.data_origin === "example";
  const score = report.score || {};
  const calculated = score.overall_status === "calculated" && typeof score.overall === "number";
  const zone = calculated ? zoneFor(score.overall) : null;
  const market = report.city_market || {};
  const composite = report.live_composite;
  const volume = measuredInteger(metric(report, "demand.search_volume"));
  const listings = measuredInteger(metric(report, "maps.deduplication.unique_organic_listings"));
  const location = report.location && report.location.google_ads;
  const parts = location && location.location_name ? location.location_name.split(",") : [];
  const base = shell({
    email,
    service: report.niche,
    city: extras.city || parts[0],
    state: extras.state || parts[1],
    lens,
    origin: example ? "example" : "live",
    checkedAt,
    mapsDepth: Number.isInteger(report.maps_depth) ? report.maps_depth : (report.maps && report.maps.requested_depth)
  });
  return {
    ...base,
    market_score: numberField(calculated ? (example ? "example" : "measured") : "unavailable", calculated ? score.overall : null, example, example ? "Sample, not live" : "From last check"),
    zone: wordsField(zone, "Market score zone. Not a lens verdict."),
    demand: numberField(Number.isFinite(market.demand_index) ? "measured" : "unavailable", market.demand_index, example, example ? "Sample, not live" : "From last check"),
    competition: numberField(Number.isFinite(market.competition_index) ? "measured" : "unavailable", market.competition_index, false, "Maps competition index when it was measured."),
    margin: numberField(composite && Number.isFinite(composite.margin && composite.margin.index) ? "measured" : "unavailable", composite && composite.margin ? composite.margin.index : null, Boolean(composite && composite.estimated), "Margin index when a published price was on the check."),
    leads: rangeField("unavailable", null, null, true, "Lead range was not stored on the check."),
    revenue: rangeField("unavailable", null, null, true, "Revenue range was not stored on the check."),
    average_job: rangeField("unavailable", null, null, true, "Job price range was not stored on the check."),
    volume: numberField(volume === null ? "unavailable" : (example ? "example" : "measured"), volume, example, example ? "Sample, not live" : "From last check search volume"),
    map_pack: numberField(listings === null ? "unavailable" : (example ? "example" : "measured"), listings, example, example ? "Sample, not live" : "Maps sample listings. Not an exhaustive pack."),
    grade: numberField(calculated ? (example ? "example" : "measured") : "unavailable", calculated ? score.overall : null, example, "Market score. Not a classroom or four-yes grade.")
  };
}

export function snapshotFromProposal(proposal, { email, lens, checkedAt }) {
  const composite = proposal.composite || {};
  const calculated = composite.status === "calculated" && composite.composite_tenths !== null && composite.composite_tenths !== undefined;
  const score = calculated ? composite.composite_tenths / 10 : null;
  const price = proposal.price || {};
  const base = shell({
    email,
    service: proposal.subniche.label,
    city: proposal.location.name,
    state: proposal.location.state,
    lens,
    origin: "example",
    checkedAt
  });
  return {
    ...base,
    market_score: numberField(calculated ? "example" : "unavailable", score, true, "Sample, not live"),
    zone: wordsField(calculated ? zoneFor(score) : null, "Market score zone. Not a lens verdict."),
    demand: numberField(Number.isFinite(composite.demand && composite.demand.index) ? "example" : "unavailable", composite.demand && composite.demand.index, true, "From sample search volume"),
    competition: numberField(Number.isFinite(composite.competition && composite.competition.index) ? "example" : "unavailable", composite.competition && composite.competition.index, true, "Sample, not live"),
    margin: numberField(Number.isFinite(composite.margin && composite.margin.index) ? "example" : "unavailable", composite.margin && composite.margin.index, true, "National range, not city adjusted"),
    leads: rangeField("unavailable", null, null, true, "Lead range is shown on the page and is not copied into history as a measured count."),
    revenue: rangeField("unavailable", null, null, true, "Revenue range is an estimate on the page. It is not stored as a measured total."),
    average_job: rangeField(price.status === "published" ? "example" : "unavailable", price.low_dollars, price.high_dollars, true, "National range, not city adjusted"),
    volume: numberField(Number.isFinite(composite.demand && composite.demand.monthly_searches) ? "example" : "unavailable", composite.demand && composite.demand.monthly_searches, true, "From sample search volume"),
    map_pack: numberField("unavailable", null, false, "The example competitor count is not a map pack. A pack size was not invented."),
    grade: numberField(calculated ? "example" : "unavailable", score, true, "Market score. Not a classroom or four-yes grade.")
  };
}

export function snapshotFromDiscovery(row, { email, lens, checkedAt }) {
  const base = shell({
    email,
    service: row.service,
    city: row.city,
    state: row.state,
    lens,
    origin: "discovery",
    checkedAt
  });
  const ratings = row.competition && Number.isInteger(row.competition.strongest_in_town_ratings)
    ? row.competition.strongest_in_town_ratings
    : null;
  const price = row.price || {};
  return {
    ...base,
    market_score: numberField("unavailable", null, false, "Discovery does not produce the market score. A score was not invented."),
    zone: wordsField(null, "No market score, so no zone."),
    demand: numberField("unavailable", null, false, "Demand was not measured."),
    competition: numberField("unavailable", null, false, "The competition index was not measured. Review counts are not that index."),
    margin: numberField("unavailable", null, false, "Margin was not scored on the shortlist."),
    leads: rangeField("unavailable", null, null, true, "Leads were not estimated on the shortlist."),
    revenue: rangeField("unavailable", null, null, true, "Revenue was not estimated on the shortlist."),
    average_job: rangeField(price.status === "published" ? "published" : "unavailable", price.low_dollars, price.high_dollars, price.estimated === true, price.note || "National range, not city adjusted"),
    volume: numberField("unavailable", null, false, "Search volume was not measured. It was not invented."),
    map_pack: wordsField(row.competition && row.competition.map_pack === "dense" ? "dense" : (row.competition && row.competition.map_pack === "not_ordered" ? "not an ordered pack" : null), row.competition && row.competition.note),
    incumbent_ratings: numberField(ratings === null ? "unavailable" : "places_lookup", ratings, false, "Strongest in-town ratings count from a Places lookup. Not an ordered map pack."),
    grade: numberField("unavailable", null, false, "No market score on a discovery row. A grade was not invented.")
  };
}

const PUBLIC_FIELDS = [
  "id", "user", "checked_at", "niche", "city", "state", "origin",
  "lens", "lens_label", "lens_verdict", "lens_verdict_label",
  "other_lens", "other_lens_label", "other_lens_verdict", "lenses_disagree",
  "market_score", "zone", "demand", "competition", "margin",
    "leads", "revenue", "average_job", "volume", "map_pack", "incumbent_ratings", "grade",
    "maps_depth", "check_version"
];

function allow(record) {
  const copy = {};
  for (const field of PUBLIC_FIELDS) {
    if (record[field] !== undefined) copy[field] = record[field];
  }
  return copy;
}

function latestBefore(records, run) {
  const key = pairKey(run);
  const hits = records.filter((row) => row.id !== run.id && row.user === run.user && pairKey(row) === key);
  hits.sort((left, right) => String(right.checked_at).localeCompare(String(left.checked_at)));
  return hits[0] || null;
}

function listFor(records, user) {
  const email = String(user || "").trim().toLowerCase();
  return records
    .filter((row) => row.user === email)
    .sort((left, right) => String(right.checked_at).localeCompare(String(left.checked_at)))
    .map((row) => {
      const prior = latestBefore(records, row);
      return { ...row, prior_id: prior ? prior.id : null };
    });
}

function trimUser(records, user) {
  const mine = records.filter((row) => row.user === user);
  if (mine.length <= MAX_PER_USER) return;
  mine.sort((left, right) => String(left.checked_at).localeCompare(String(right.checked_at)));
  const drop = new Set(mine.slice(0, mine.length - MAX_PER_USER).map((row) => row.id));
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (drop.has(records[index].id)) records.splice(index, 1);
  }
}

function finish(records, record) {
  const clean = allow(record);
  if (!clean.user || !clean.niche || !clean.city || !clean.state || !clean.checked_at) {
    const error = new Error("A history row needs a user, service, city, state, and time.");
    error.code = "invalid_history";
    throw error;
  }
  const prior = latestBefore(records, clean);
  records.push(clean);
  trimUser(records, clean.user);
  return { record: clean, prior, diff: prior ? diffRuns(clean, prior) : null };
}

export function createMemoryRunHistory(initial = []) {
  const records = [];
  for (const row of Array.isArray(initial) ? initial : []) {
    if (row && typeof row === "object") records.push(allow(row));
  }
  return {
    async load() {},
    list(user) {
      return listFor(records, user);
    },
    find(id, user) {
      const email = String(user || "").trim().toLowerCase();
      return records.find((row) => row.id === id && row.user === email) || null;
    },
    async record(snapshot) {
      return finish(records, snapshot);
    }
  };
}

export function createFileRunHistory(filePath) {
  const records = [];
  let ready = null;
  let broken = false;
  let tail = Promise.resolve();

  function load() {
    if (!ready) {
      ready = (async () => {
        try {
          const saved = JSON.parse(await fs.readFile(filePath, "utf8"));
          const rows = saved && Array.isArray(saved.records) ? saved.records : null;
          if (!rows) {
            broken = true;
            return;
          }
          records.push(...rows.filter((row) => row && typeof row === "object").map(allow));
        } catch (error) {
          if (!error || error.code !== "ENOENT") broken = true;
        }
      })();
    }
    return ready;
  }

  async function writeOnce() {
    if (broken) {
      const error = new Error("The run history file could not be read. It was left in place.");
      error.code = "history_unreadable";
      throw error;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ records }));
    await fs.rename(temp, filePath);
  }

  function persist() {
    const run = tail.then(() => writeOnce());
    tail = run.catch(() => {});
    return run;
  }

  return {
    load,
    list(user) {
      return listFor(records, user);
    },
    async record(snapshot) {
      await load();
      const saved = finish(records, snapshot);
      await persist();
      return saved;
    },
    find(id, user) {
      const email = String(user || "").toLowerCase();
      return records.find((row) => row.id === id && row.user === email) || null;
    }
  };
}

export function openRunHistory(options = {}) {
  if (options.store) return options.store;
  if (options.filePath) return createFileRunHistory(options.filePath);
  return createMemoryRunHistory();
}

export function listRuns(store, user) {
  const rows = store.list(user);
  return rows.map((row) => {
    const prior = rows.find((item) => item.id !== row.id && pairKey(item) === pairKey(row) && item.checked_at < row.checked_at);
    return { ...row, prior_id: row.prior_id || (prior ? prior.id : null) };
  });
}
