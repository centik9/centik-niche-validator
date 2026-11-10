import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { discoverShortlist, rankDiscovery } from "../src/discovery.js";
import { DISCOVERY_FIXTURES } from "../src/discovery-fixtures.js";
import { evaluateLenses, evaluateService } from "../src/lenses.js";
import { diffRuns } from "../src/run-diff.js";
import { createFileRunHistory, snapshotFromDiscovery } from "../src/run-history.js";
import { postJson, sessionCookie, withServer, TEST_AUTH } from "./helpers.js";

test("classroom floor and four-yes stay separate", () => {
  const split = evaluateLenses({
    service: "emergency pest control",
    price: { status: "published", low_dollars: 600, high_dollars: 900, unit: "per_job", note: "National range, not city adjusted." }
  });
  assert.equal(split.classroom.verdict, "pass");
  assert.equal(split.four_yes.verdict, "fail");
  assert.equal(split.disagree, true);
  assert.equal(split.blended, undefined);
  assert.equal(split.combined, undefined);
  assert.equal(split.average, undefined);
  assert.match(split.classroom.rows[1].note, /not a second hard fail/);
  assert.equal(split.classroom.label, "Classroom floor");
  assert.equal(split.four_yes.label, "Jesse's four-yes test");

  const locksmith = evaluateLenses({
    service: "emergency locksmith",
    price: { status: "published", low_dollars: 150, high_dollars: 250, unit: "per_job", note: "National range, not city adjusted." }
  });
  assert.equal(locksmith.classroom.rows[0].mark, "yes");
  assert.equal(locksmith.classroom.verdict, "hard_stop");
  assert.equal(locksmith.four_yes.verdict, "hard_stop");
  assert.notEqual(locksmith.classroom.verdict, "pass");
  assert.match(locksmith.classroom.note, /Hard stop/);
  assert.equal(locksmith.classroom.rows[1].mark, "no");
  assert.equal(locksmith.classroom.rows.find((row) => row.id === "locksmith_fail"), undefined);

  const directory = evaluateLenses({
    service: "emergency pest control",
    price: { status: "published", low_dollars: 6000, high_dollars: 9000, unit: "per_job" },
    state_operator_count: { status: "measured", value: 40 },
    best_query: { status: "weak", note: "The best query was checked and looked thin." },
    sponsored_ads: { status: "present", note: "Sponsored ads were on the page." }
  });
  const operator = directory.four_yes.rows.find((row) => row.id === "directory");
  assert.equal(operator.mark, "no");
  assert.equal(operator.gates, false);
  assert.match(operator.note, /Directory test/);
  assert.equal(directory.four_yes.verdict, "pass");

  const missing = evaluateLenses({
    service: "emergency pest control",
    price: { status: "published", low_dollars: 6000, high_dollars: 9000, unit: "per_job" }
  });
  const ads = missing.four_yes.rows.find((row) => row.id === "ads");
  assert.equal(ads.mark, "not_enough_evidence");
  assert.equal(missing.four_yes.verdict, "not_enough_evidence");
  assert.notEqual(ads.mark, "no");

  const wall = evaluateService({ service: "Retaining wall replacement", city: "Bella Vista", state: "Arkansas" });
  assert.equal(wall.classroom.verdict, "caution");
  assert.equal(wall.four_yes.rows[0].mark, "not_enough_evidence");
  assert.equal(wall.paid_dataforseo_called, false);
  assert.equal(wall.four_yes.verdict, "not_enough_evidence");
  const sample = evaluateService({ service: "Water heater repair", city: "Austin", state: "Texas" });
  assert.equal(sample.sample_data, true);
  assert.equal(sample.classroom.verdict, "pass");
  assert.equal(sample.four_yes.verdict, "fail");
  assert.equal(sample.disagree, true);
});

test("discovery ranks the worked example without inventing figures or calling DataForSEO", () => {
  const source = fs.readFileSync(new URL("../src/discovery.js", import.meta.url), "utf8");
  assert.equal(/from ["'].*dataforseo/.test(source), false);
  const ranked = rankDiscovery(DISCOVERY_FIXTURES, { lens: "four_yes" });
  assert.deepEqual(ranked.rows.slice(0, 3).map((row) => row.id), [
    "bella-vista-ar-retaining-wall",
    "lancaster-oh-septic",
    "grass-valley-ca-septic"
  ]);
  assert.equal(ranked.rows[3].role, "hold");
  assert.equal(ranked.rows[4].role, "hold");
  assert.equal(ranked.fallback_surfaced, false);
  assert.equal(ranked.paid_dataforseo_called, false);
  const bella = ranked.rows[0];
  assert.equal(bella.census.owner_occupancy_rate.value, 0.88);
  assert.equal(bella.census.population.value, 34518);
  assert.equal(bella.census.housing_age.status, "not_fetched");
  assert.equal(bella.census.housing_age.value, null);
  assert.equal(bella.competition.strongest_in_town_ratings, 46);
  assert.equal(bella.competition.map_pack, "not_ordered");
  assert.equal(bella.lens_chip.verdict, "not_enough_evidence");
  assert.notEqual(bella.lens_chip.verdict, bella.lens_chip.other_verdict);

  const dense = structuredClone(DISCOVERY_FIXTURES);
  dense[0].competition.map_pack = "dense";
  const fallback = rankDiscovery(dense, { lens: "classroom" });
  assert.equal(fallback.rows[0].city, "Lancaster");
  assert.equal(fallback.rows[0].surfaced_as, "fallback");
  assert.match(fallback.rows[0].fallback_reason, /Bella Vista/);
  assert.match(fallback.rows[0].fallback_reason, /pack density/);

  const extra = {
    id: "high-owner-edge",
    service: "Retaining wall replacement",
    service_family: "retaining-wall",
    city: "Edgeville",
    state: "Arkansas",
    population_edge: { status: "edge", nearby_center: "A larger city", note: "Supplied edge." },
    census: {
      owner_occupancy_rate: { status: "measured", value: 0.91, note: "Supplied." },
      housing_age: { status: "unavailable", value: null, note: "Not measured." },
      population: { status: "unavailable", value: null, note: "Not measured." }
    },
    price: { status: "published", low_dollars: 3000, high_dollars: 10000, unit: "per_job", estimated: true, city_adjusted: false, note: "National range, not city adjusted." },
    competition: { map_pack: "not_ordered", strongest_in_town_ratings: 12, places: [{ name: "Edge Co", ratings_count: 12, city: "Edgeville" }] },
    best_query: { status: "not_enough_evidence", note: "Not checked." },
    sponsored_ads: { status: "not_enough_evidence", note: "Not checked." },
    state_operator_count: { status: "unavailable" },
    explicit_hold: null
  };
  const withExtra = rankDiscovery([...DISCOVERY_FIXTURES, extra], { lens: "four_yes" });
  assert.equal(withExtra.rows[0].id, "high-owner-edge");

  const ignored = discoverShortlist({
    service: "septic installation",
    mode: "example",
    candidates: [{
      city: "Sampletown",
      state: "Ohio",
      service: "septic installation",
      census: { owner_occupancy_rate: { status: "measured", value: 0.99 } },
      competition: { strongest_in_town_ratings: 1 }
    }]
  });
  const sample = ignored.rows.find((row) => row.city === "Sampletown");
  assert.ok(sample);
  assert.notEqual(sample.census.owner_occupancy_rate.value, 0.99);
  assert.equal(sample.census.owner_occupancy_rate.status === "measured", false);
  assert.equal(sample.competition.strongest_in_town_ratings, null);
  assert.equal(sample.price.low_dollars, 3500);
  assert.equal(sample.price.high_dollars, 8500);
  assert.equal(ignored.paid_dataforseo_called, false);

  const empty = discoverShortlist({ service: "quilt restoration", mode: "example" });
  assert.equal(empty.rows.length, 0);
  assert.match(empty.message, /Nothing was invented/);

  const extract = {
    places: {
      "4805000": { n: "Austin city", st: "TX", hu: 100, occ: 80, own: 40, ytot: 100, old: 30, inc: 80000 }
    }
  };
  const free = discoverShortlist({
    service: "septic installation",
    mode: "free",
    candidates: [{ city: "Austin", state: "Texas", service: "septic installation" }]
  }, { extract, fixtures: [] });
  const austin = free.rows.find((row) => row.city === "Austin");
  assert.ok(austin);
  assert.equal(austin.census.owner_occupancy_rate.value, 0.5);
  assert.equal(austin.census.housing_age.status, "not_fetched");
  assert.equal(austin.census.housing_age.value, null);
  assert.equal(austin.census.population.status, "unavailable");
  assert.equal(austin.census.population.value, null);
  assert.equal(free.paid_dataforseo_called, false);
});

test("run history diffs a repeat niche and city without storing secrets", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "centik-history-"));
  const file = path.join(dir, "run-history.json");
  const store = createFileRunHistory(file);
  const checked = "2026-11-10T18:00:00.000Z";
  const first = snapshotFromDiscovery({
    service: "Retaining wall replacement",
    city: "Bella Vista",
    state: "Arkansas",
    price: { status: "published", low_dollars: 3000, high_dollars: 10000, estimated: true, note: "National range, not city adjusted." },
    competition: { map_pack: "not_ordered", strongest_in_town_ratings: 46, note: "Not an ordered pack." }
  }, { email: "team@centik.ai", lens: "classroom", checkedAt: checked });
  first.volume = { kind: "number", status: "measured", value: 10, estimated: false, note: "From last check search volume" };
  first.market_score = { kind: "number", status: "measured", value: 40, estimated: false, note: "From last check" };
  first.spend_token = "should-not-persist";
  first.password = "should-not-persist";
  const saved = await store.record(first);
  assert.equal(saved.prior, null);
  const second = structuredClone(saved.record);
  delete second.id;
  second.checked_at = "2026-11-10T20:00:00.000Z";
  second.volume = { kind: "number", status: "measured", value: 16, estimated: false, note: "From last check search volume" };
  second.market_score = { kind: "number", status: "measured", value: 46, estimated: false, note: "From last check" };
  second.lens = "four_yes";
  second.lens_label = "Jesse's four-yes test";
  const again = await store.record(second);
  const volume = again.diff.rows.find((row) => row.id === "volume");
  const score = again.diff.rows.find((row) => row.id === "market_score");
  const verdict = again.diff.rows.find((row) => row.id === "lens_verdict");
  const job = again.diff.rows.find((row) => row.id === "average_job");
  assert.equal(volume.delta_text, "up 6");
  assert.equal(score.delta_text, "up 6");
  assert.equal(again.diff.lens_note, "Classroom floor vs Jesse's four-yes test");
  assert.equal(verdict.delta_text, "not comparable");
  assert.equal(job.delta_text, "not comparable");
  assert.match(job.newer_display, /to/);
  const raw = fs.readFileSync(file, "utf8");
  assert.equal(raw.includes("spend_token"), false);
  assert.equal(raw.includes("should-not-persist"), false);
  assert.equal(raw.includes("password"), false);

  const mixed = diffRuns(
    { ...again.record, volume: { kind: "number", status: "measured", value: 16, estimated: true } },
    { ...saved.record, volume: { kind: "number", status: "measured", value: 10, estimated: false } }
  );
  assert.equal(mixed.rows.find((row) => row.id === "volume").delta_text, "not comparable");
  const gap = diffRuns(
    { ...again.record, volume: { kind: "number", status: "unavailable", value: null, estimated: false } },
    saved.record
  );
  assert.equal(gap.rows.find((row) => row.id === "volume").delta_text, "not comparable");
});

test("discover and history routes do not call DataForSEO", async () => {
  let fetches = 0;
  const app = createApp({
    env: { ...TEST_AUTH, DATAFORSEO_LIVE: "false" },
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("network");
    }
  });
  await withServer(app, async (port) => {
    const discovered = await postJson(port, "/api/discover", {
      service: "retaining wall replacement",
      lens: "four_yes",
      mode: "example"
    });
    const body = await discovered.json();
    assert.equal(discovered.status, 200);
    assert.equal(body.paid_dataforseo_called, false);
    assert.equal(body.rows[0].city, "Bella Vista");
    assert.equal(body.rows[0].census.housing_age.value, null);
    assert.equal(fetches, 0);
    const saved = await postJson(port, "/api/runs", {
      service: "Retaining wall replacement",
      city: "Bella Vista",
      state: "Arkansas",
      lens: "classroom"
    });
    assert.equal(saved.status, 200);
    const again = await postJson(port, "/api/runs", {
      service: "Retaining wall replacement",
      city: "Bella Vista",
      state: "Arkansas",
      lens: "four_yes"
    });
    const second = await again.json();
    assert.equal(second.paid_dataforseo_called, false);
    assert.equal(second.diff.lens_note, "Classroom floor vs Jesse's four-yes test");
    assert.equal(fetches, 0);
    const page = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie: await sessionCookie(port) } });
    const html = await page.text();
    assert.match(html, /Generate shortlist/);
    assert.match(html, /This is free\. It does not run a paid check\./);
    assert.match(html, /Classroom floor/);
    assert.match(html, /Jesse's four-yes test/);
    assert.match(html, /Okay, run paid check/);
    assert.equal(/votel/i.test(html), false);
    const css = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
    assert.match(css, /#FFB627/);
    assert.match(css, /#C98A12/);
    assert.match(css, /#171B20/);
    assert.match(css, /abwOrbSpeckA/);
    assert.match(css, /abwOrbHalo/);
    assert.equal(/votel/i.test(css), false);
  });
});
