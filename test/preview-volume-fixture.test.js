import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { createLocationDirectory } from "../src/locations.js";
import { createPreviewExampleTransport, previewNiche, PREVIEW_RAW_VOLUMES } from "../src/preview-volume-fixture.js";
import { FALLBACK_ESTIMATE_LABEL } from "../src/volume-fallback.js";
import { validateNiche } from "../src/validator.js";
import { confirmedFrom, postJson, TEST_AUTH, withServer } from "./helpers.js";

function previewApp() {
  const transport = createPreviewExampleTransport();
  return createApp({
    env: { ...TEST_AUTH, DATAFORSEO_LIVE: "false" },
    exampleTransport: transport,
    exampleDirectory: createLocationDirectory(transport),
    validateImpl(prepared, deps) {
      const next = deps.origin === "example" && previewNiche(prepared.niche)
        ? { ...deps, previewFallback: true }
        : deps;
      return validateNiche(prepared, next);
    }
  });
}

test("the Leland crawl space example estimates a grade from metro, state, and Bing without a live call", async () => {
  const app = previewApp();
  await withServer(app, async (port) => {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.live_mode, false);
    assert.equal(health.credentials_configured, false);

    const resolution = await (await postJson(port, "/api/resolve", {
      mode: "example",
      city: "Leland",
      state: "NC",
      country: "United States"
    })).json();
    assert.equal(resolution.can_validate, true);
    assert.equal(resolution.example_data, true);

    const response = await postJson(port, "/api/validate", {
      mode: "example",
      niche: "Crawl space encapsulation",
      city: "Leland",
      state: "North Carolina",
      country: "United States",
      geography_type: "city",
      confirmed: confirmedFrom(resolution)
    });
    const report = await response.json();
    assert.equal(response.status, 200);
    assert.equal(report.example_data, true);
    assert.match(report.example_banner, /Example data/);
    assert.equal(report.live_banner, null);
    assert.equal(report.demand.sent_to_dataforseo, false);
    assert.equal(report.demand.search_volume.status, "missing");
    assert.equal(report.demand.search_volume.value, null);
    assert.equal(report.demand.volume_fallback.estimate.status, "estimated");
    assert.equal(report.demand.volume_fallback.estimate.measured_city_data, false);
    assert.equal(report.demand.volume_fallback.estimate.label, FALLBACK_ESTIMATE_LABEL);
    assert.equal(report.demand.volume_fallback.estimate.value, 24);
    const raw = report.demand.volume_fallback.estimate.raw_broader_volumes;
    const metro = raw.find((row) => row.source === "google_ads" && row.level === "metro");
    const state = raw.find((row) => row.source === "google_ads" && row.level === "state");
    const bing = raw.find((row) => row.source === "bing" && row.level === "state");
    assert.equal(metro.clustered_volume, PREVIEW_RAW_VOLUMES.metro);
    assert.equal(metro.scaled_city_volume, null);
    assert.equal(state.clustered_volume, PREVIEW_RAW_VOLUMES.state);
    assert.equal(state.scaled_city_volume, 54);
    assert.equal(bing.clustered_volume, PREVIEW_RAW_VOLUMES.bing);
    assert.equal(bing.scaled_city_volume, 24);
    assert.equal(report.score.grade_state, "estimated");
    assert.equal(report.score.overall_display, "53.6");
    assert.equal(report.demand.volume_fallback.attempts.every((attempt) => attempt.sent_to_dataforseo === false), true);
  });
});
