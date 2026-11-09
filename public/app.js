const FIXTURES = [
  "missing volume",
  "zero volume",
  "zero volume saturated",
  "missing cpc",
  "maps empty",
  "maps failed",
  "maps duplicates",
  "demand failed",
  "spellcheck test",
  "uneven months"
];

const STATUS_LABELS = {
  measured: "Measured",
  measured_zero: "Measured zero",
  missing: "Missing (not zero)",
  unsupported: "Unsupported",
  failed: "Failed",
  unusable: "Unusable",
  inconsistent: "Inconsistent",
  not_requested: "Not requested",
  partial: "Partial",
  none: "None",
  corrected: "Spell-corrected"
};

const state = {
  health: null,
  resolution: null,
  report: null,
  error: "",
  confirmed: false,
  busy: false
};

const $ = (id) => document.getElementById(id);

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (key === "checked") node.checked = Boolean(value);
    else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  });
  (children || []).forEach((child) => {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

function statusText(status) {
  return STATUS_LABELS[status] || String(status || "Unknown");
}

function statusNode(status) {
  return el("strong", { class: `status-${status || "unknown"}` }, [statusText(status)]);
}

function clearOutput() {
  state.resolution = null;
  state.report = null;
  state.confirmed = false;
  state.error = "";
  render();
}

async function post(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.message || "Request failed.");
    error.body = body;
    error.status = response.status;
    throw error;
  }
  return body;
}

function queryFields() {
  return {
    niche: $("niche").value.trim(),
    city: $("city").value.trim(),
    state: $("state").value.trim(),
    country: $("country").value.trim()
  };
}

function sidePayload(match) {
  if (!match) return null;
  return {
    location_code: match.location_code,
    location_name: match.location_name,
    location_type: match.location_type
  };
}

async function resolve(mode) {
  state.busy = true;
  state.error = "";
  state.report = null;
  state.confirmed = false;
  render();
  try {
    const fields = queryFields();
    state.resolution = await post("/api/resolve", {
      mode,
      city: fields.city,
      state: fields.state,
      country: fields.country
    });
  } catch (error) {
    state.resolution = null;
    state.error = error.message || "Resolve failed.";
  } finally {
    state.busy = false;
    render();
  }
}

async function validate(mode) {
  if (!state.resolution || !state.confirmed) return;
  state.busy = true;
  state.error = "";
  render();
  try {
    const fields = queryFields();
    state.report = await post("/api/validate", {
      mode,
      niche: fields.niche,
      city: fields.city,
      state: fields.state,
      country: fields.country,
      confirmed: {
        google_ads: sidePayload(state.resolution.google_ads && state.resolution.google_ads.match),
        google_maps: sidePayload(state.resolution.google_maps && state.resolution.google_maps.match)
      }
    });
  } catch (error) {
    state.report = null;
    state.error = error.message || "Validation failed.";
    if (error.body && error.body.resolution) state.resolution = error.body.resolution;
  } finally {
    state.busy = false;
    render();
  }
}

function renderProduct(title, product) {
  const block = el("div", {}, [el("h3", {}, [title])]);
  if (!product) return block;
  block.append(el("p", {}, ["Outcome: ", statusText(product.outcome)]));
  if (product.match) {
    const codeNote = product.match.code_source === "example_gazetteer"
      ? "Example location code, not a DataForSEO code."
      : "Location code from the DataForSEO locations list.";
    block.append(el("dl", {}, [
      el("dt", {}, ["Location"]),
      el("dd", {}, [product.match.location_name]),
      el("dt", {}, ["Type"]),
      el("dd", {}, [product.match.location_type]),
      el("dt", {}, ["Parent"]),
      el("dd", {}, [product.match.parent ? `${product.match.parent.location_name} (${product.match.parent.location_type})` : "None"]),
      el("dt", {}, ["Code"]),
      el("dd", {}, [String(product.match.location_code), " — ", codeNote])
    ]));
  }
  if (product.same_city_other_regions && product.same_city_other_regions.length) {
    block.append(el("p", {}, [`Same city name in another region was not selected: ${product.same_city_other_regions.join(", ")}.`]));
  }
  if (product.same_name_other_countries && product.same_name_other_countries.length) {
    block.append(el("p", {}, [`Same place name in another country was not selected: ${product.same_name_other_countries.join(", ")}.`]));
  }
  if (product.error && product.error.message) block.append(el("p", { class: "error" }, [product.error.message]));
  return block;
}

function renderResolution() {
  const root = $("resolution");
  root.replaceChildren();
  root.append(el("h2", { id: "resolution-heading" }, ["Resolved location"]));
  if (!state.resolution) {
    root.append(el("p", { class: "muted" }, ["Resolve a city before validation. Nothing is scored from an unconfirmed name."]));
    return;
  }
  const resolution = state.resolution;
  if (resolution.example_banner) root.append(el("p", { class: "banner" }, [resolution.example_banner]));
  if (resolution.live_banner) root.append(el("p", { class: "banner banner-live" }, [resolution.live_banner]));
  if (resolution.note) root.append(el("p", {}, [resolution.note]));
  const query = resolution.normalized_query;
  if (query) {
    root.append(el("p", {}, [
      `Normalized as city “${query.city_normalized}”, state “${query.state_normalized}”, country ISO ${query.country_iso}.`
    ]));
  }
  root.append(renderProduct("Google Ads location", resolution.google_ads));
  root.append(renderProduct("Google Maps location", resolution.google_maps));
  if (resolution.can_validate) {
    const box = el("input", { type: "checkbox", id: "confirm-location" });
    box.checked = state.confirmed;
    box.addEventListener("change", () => {
      state.confirmed = box.checked;
      renderReport();
      renderActions();
    });
    root.append(el("label", { class: "check" }, [
      box,
      "I confirm this resolved city, state, and country are the market I want to check."
    ]));
    const actions = el("div", { class: "choice-actions" });
    const example = el("button", { type: "button", id: "validate-example" }, ["Run example validation"]);
    const live = el("button", { type: "button", class: "secondary", id: "validate-live" }, ["Run live validation"]);
    example.disabled = state.busy || !state.confirmed;
    live.disabled = state.busy || !state.confirmed || !state.health || !state.health.live_mode;
    example.addEventListener("click", () => validate("example"));
    live.addEventListener("click", () => validate("live"));
    actions.append(example, live);
    root.append(actions);
    if (!state.health || !state.health.live_mode) {
      root.append(el("p", { class: "muted" }, ["Live validation is off on this server, so the live button does not send a billable request."]));
    }
  } else {
    root.append(el("p", { class: "banner" }, ["Validation is unavailable until one unambiguous confirmed row exists. No score was produced."]));
  }
}

function metric(label, field) {
  const value = field && field.value !== null && field.value !== undefined ? String(field.value) : "—";
  const unit = field && field.unit ? ` ${field.unit}` : "";
  const row = el("div", {}, [
    el("h3", {}, [label]),
    el("p", {}, [statusNode(field && field.status), " ", value, unit])
  ]);
  if (field && field.source) row.append(el("p", { class: "muted" }, [field.source]));
  if (field && field.note) row.append(el("p", { class: "muted" }, [field.note]));
  if (field && field.period && field.period.request) row.append(el("p", { class: "muted" }, [field.period.request]));
  if (field && field.period && field.period.observed_start) {
    row.append(el("p", {}, [`Observed months: ${field.period.observed_start} to ${field.period.observed_end}.`]));
  }
  return row;
}

function renderReport() {
  const root = $("report");
  root.replaceChildren();
  root.append(el("h2", { id: "report-heading" }, ["Validation"]));
  if (state.error) root.append(el("p", { class: "error" }, [state.error]));
  if (!state.report) {
    root.append(el("p", { class: "muted" }, ["Run a validation after confirming the location. A withheld index is shown as withheld, never as zero."]));
    return;
  }
  const report = state.report;
  if (report.example_banner) root.append(el("p", { class: "banner" }, [report.example_banner]));
  if (report.live_banner) root.append(el("p", { class: "banner banner-live" }, [report.live_banner]));
  root.append(el("p", {}, [
    `${report.niche} in ${report.normalized_query.city}, ${report.normalized_query.state}, ${report.normalized_query.country}.`
  ]));
  const measurement = report.market_measurement || {};
  root.append(el("p", {}, [
    `Live provider response: ${measurement.live_provider_response ? "yes" : "no"}. Exhaustive market: no. Buyers verified: no. Economic value estimated: no.`
  ]));

  const score = report.score;
  const scoreBlock = el("div", {}, [el("h3", {}, ["Combined heuristic index"])]);
  if (!score || score.overall_status !== "calculated" || score.overall_display === null) {
    scoreBlock.append(el("p", { class: "score-withheld" }, ["Withheld"]));
    scoreBlock.append(el("p", {}, [score && score.withheld_reason ? score.withheld_reason : "No combined index."]));
  } else {
    scoreBlock.append(el("p", { class: "score-number" }, [score.overall_display]));
    scoreBlock.append(el("p", {}, ["Calculated heuristic index. Not a recommendation."]));
  }
  if (score) {
    (score.flags || []).forEach((flag) => scoreBlock.append(el("span", { class: "flag" }, [flag])));
    (score.interpretation || []).forEach((line) => scoreBlock.append(el("p", {}, [line])));
    scoreBlock.append(el("p", {}, [
      `Weights: demand ${score.weights.demand_index}, sample openness ${score.weights.sample_openness}.`
    ]));
    scoreBlock.append(el("p", {}, [score.formula.overall]));
    scoreBlock.append(el("p", {}, [score.formula.demand_index]));
    scoreBlock.append(el("p", {}, [score.formula.sample_openness]));
    if (score.matched_band) {
      scoreBlock.append(el("p", {}, [`Matched demand band: ${score.matched_band.label} (index ${score.matched_band.index}).`]));
    }
    scoreBlock.append(el("p", {}, [score.completeness.label]));
    if (score.confidence) {
      scoreBlock.append(el("p", {}, [`Confidence ${score.confidence.display} (cap ${score.confidence_model.cap_hundredths / 100}). ${score.confidence.note}`]));
      const list = el("ul");
      score.confidence.adjustments.forEach((item) => {
        list.append(el("li", {}, [`${item.applied ? "Applied" : "Not applied"} ${item.hundredths}: ${item.reason}`]));
      });
      scoreBlock.append(list);
    } else {
      scoreBlock.append(el("p", {}, [score.confidence_model.note]));
    }
  }
  root.append(scoreBlock);

  root.append(metric("Search volume", report.demand.search_volume));
  root.append(metric("CPC (excluded from the index)", report.demand.cpc));
  root.append(metric("Paid-search competition (excluded)", report.demand.paid_search_competition));
  if (report.demand.spell && report.demand.spell.status === "corrected") {
    root.append(el("p", {}, [`Google Ads spell value: ${report.demand.spell.value}. The volume describes that spelling.`]));
  }
  if (report.demand.monthly_crosscheck && report.demand.monthly_crosscheck.differs_from_search_volume) {
    root.append(el("p", {}, [`Monthly arithmetic mean ${report.demand.monthly_crosscheck.arithmetic_mean} differs from search_volume. The index still uses search_volume.`]));
  }
  if (report.demand.error && report.demand.error.message) root.append(el("p", { class: "error" }, [report.demand.error.message]));
  if (report.demand.clustered_coverage_volume) {
    root.append(metric("Clustered coverage volume (demand index input)", report.demand.clustered_coverage_volume));
    root.append(el("p", { class: "muted" }, [report.demand.clustered_coverage_volume.note || "The demand index uses clustered coverage volume. The core term above is separate."]));
  }
  if (report.demand.keyword_rows && report.demand.keyword_rows.length) {
    const phraseTable = el("table", {}, [
      el("thead", {}, [el("tr", {}, ["Phrase", "Monthly volume", "CPC", "Competition"].map((heading) => el("th", {}, [heading])))])
    ]);
    const phraseBody = el("tbody");
    report.demand.keyword_rows.forEach((row) => {
      const volumeText = row.search_volume && row.search_volume.value != null ? String(row.search_volume.value) : "Missing";
      const cpcText = row.cpc && row.cpc.value != null ? String(row.cpc.value) : "Missing";
      const competitionText = row.paid_search_competition && row.paid_search_competition.value != null ? String(row.paid_search_competition.value) : "Missing";
      phraseBody.append(el("tr", {}, [
        el("td", {}, [row.keyword || "—"]),
        el("td", {}, [volumeText]),
        el("td", {}, [cpcText]),
        el("td", {}, [competitionText])
      ]));
    });
    phraseTable.append(phraseBody);
    root.append(el("h3", {}, ["Packed search phrases"]));
    root.append(el("div", { class: "scroll" }, [phraseTable]));
  }

  const organic = report.organic;
  if (organic) {
    root.append(el("h3", {}, ["Regular Google results"]));
    const counts = organic.directory_counts || {};
    const top5 = counts.top5_directory_count == null ? "missing" : `${counts.top5_directory_count} of ${counts.top5_results}`;
    const top10 = counts.top10_directory_count == null ? "missing" : `${counts.top10_directory_count} of ${counts.top10_results}`;
    root.append(el("p", {}, [`Directories in top 5: ${top5}. Directories in top 10: ${top10}. This does not change the Maps competition score.`]));
    if (organic.error && organic.error.message) root.append(el("p", { class: "error" }, [organic.error.message]));
    (organic.results || []).forEach((result) => {
      root.append(el("p", {}, [`${result.rank}. ${result.title || "Untitled"} — ${result.domain || "unknown"}${result.directory ? " (directory)" : ""}`]));
    });
  }

  const trends = report.trends;
  if (trends) {
    const season = trends.seasonality || {};
    const geo = trends.geo || {};
    root.append(el("h3", {}, ["Seasonality"]));
    root.append(el("p", {}, [
      `Level ${season.level || "missing"}. Geo ${geo.level || "unknown"}. ${geo.note || ""} Trends interest is not search volume and does not change the demand index.`
    ]));
    if (season.peak_months && season.peak_months.length) root.append(el("p", {}, [`Peak months: ${season.peak_months.join(", ")}.`]));
    if (trends.error && trends.error.message && season.status !== "measured") root.append(el("p", { class: "error" }, [trends.error.message]));
    (season.series || []).forEach((month) => {
      root.append(el("p", {}, [`${month.label}: ${month.value == null ? "missing" : month.value}`]));
    });
  }

  const maps = report.maps;
  const unique = maps.deduplication.unique_organic_listings;
  root.append(metric("Unique organic Maps listings", unique));
  root.append(el("p", { class: "muted" }, [maps.depth_note]));
  root.append(el("p", {}, [
    `Duplicates removed: ${maps.deduplication.duplicates_removed}. Paid items excluded: ${maps.deduplication.paid_items}. Directory items excluded: ${maps.deduplication.directory_items_excluded}. Paid overlap with organic: ${maps.deduplication.paid_overlap_with_organic}.`
  ]));
  root.append(metric("Source-reported SERP count", maps.se_results_count));
  root.append(el("p", {}, [maps.claimed.note, ` Claimed ${maps.claimed.claimed}, not claimed ${maps.claimed.not_claimed}, unknown ${maps.claimed.unknown}.`]));
  root.append(el("p", { class: "muted" }, [maps.address_flags.note]));
  if (maps.address_flags.listings_with_different_address_city) {
    root.append(el("p", {}, [`Listings whose address city differs from the query: ${maps.address_flags.listings_with_different_address_city}. They remain in the sample.`]));
  }
  if (maps.error && maps.error.message) root.append(el("p", { class: "error" }, [maps.error.message]));
  if (maps.listings && maps.listings.length) {
    const table = el("table", {}, [
      el("thead", {}, [el("tr", {}, ["Rank", "Name", "Category", "Address city", "Rating", "Claimed"].map((heading) => el("th", {}, [heading])))])
    ]);
    const body = el("tbody");
    maps.listings.forEach((listing) => {
      body.append(el("tr", {}, [
        el("td", {}, [listing.rank_absolute === null ? "—" : String(listing.rank_absolute)]),
        el("td", {}, [listing.title || "—"]),
        el("td", {}, [listing.category || "—"]),
        el("td", {}, [listing.address_city || "—"]),
        el("td", {}, [listing.rating_value === null ? "—" : String(listing.rating_value)]),
        el("td", {}, [listing.is_claimed === null ? "Unknown" : listing.is_claimed ? "Claimed" : "Not claimed"])
      ]));
    });
    table.append(body);
    root.append(el("div", { class: "scroll" }, [table]));
  }

  const limits = el("div", {}, [el("h3", {}, ["Limitations"])]);
  const list = el("ul");
  (report.limitations || []).forEach((line) => list.append(el("li", {}, [line])));
  limits.append(list);
  root.append(limits);
}

function renderActions() {
  const example = $("validate-example");
  const live = $("validate-live");
  if (example) example.disabled = state.busy || !state.confirmed;
  if (live) live.disabled = state.busy || !state.confirmed || !state.health || !state.health.live_mode;
  $("resolve-example").disabled = state.busy;
  $("resolve-live").disabled = state.busy || !state.health || !state.health.live_mode;
}

function render() {
  renderResolution();
  renderReport();
  renderActions();
}

function renderFixtures() {
  const root = $("fixture-buttons");
  FIXTURES.forEach((name) => {
    const button = el("button", { type: "button", class: "chip" }, [name]);
    button.addEventListener("click", () => {
      $("niche").value = name;
      clearOutput();
    });
    root.append(button);
  });
}

async function loadHealth() {
  try {
    const response = await fetch("/health");
    state.health = await response.json();
    const live = state.health.live_mode ? "on" : "off";
    const credentials = state.health.credentials_configured ? "set" : "not set";
    $("server-status").textContent = `Server ${state.health.version}. Live mode ${live}. Credentials ${credentials}. Credentials are never shown.`;
  } catch {
    $("server-status").textContent = "Health check failed.";
  }
  renderActions();
}

const SAMPLE_LINES = [
  "city | Austin | Texas",
  "city | Houston | Texas",
  "city | Dallas | Texas",
  "city | Springfield | Illinois",
  "city | Springfield | Missouri",
  "county | Travis County | Texas",
  "county | Harris County | Texas",
  "county | Hunt County | Texas",
  "county | Dallas County | Texas",
  "county | Fulton County | Georgia",
  "metro | Austin-Round Rock-San Marcos | Texas",
  "metro | Houston-Pasadena-The Woodlands | Texas"
].join("\n");

function parseScreenLines(text) {
  return text.split(/\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const parts = line.split("|").map((part) => part.trim());
    const candidate = { geography_type: parts[0], name: parts[1], state: parts[2] };
    if (parts[3]) candidate.user_reported_competitor_count = Number(parts[3]);
    return candidate;
  });
}

function formatShare(signal) {
  if (!signal || signal.value === null || signal.value === undefined) return statusText(signal && signal.status);
  if (signal.unit && signal.unit.startsWith("share")) return `${statusText(signal.status)} ${(signal.value * 100).toFixed(1)}%`;
  return `${statusText(signal.status)} ${signal.value}`;
}

function renderScreen(report, error) {
  const root = $("screen-result");
  root.replaceChildren();
  if (error) root.append(el("p", { class: "error" }, [error]));
  if (!report) return;
  if (report.example_banner) root.append(el("p", { class: "banner" }, [report.example_banner]));
  if (report.free_banner) root.append(el("p", { class: "banner banner-live" }, [report.free_banner]));
  root.append(el("p", {}, [
    `${report.profile.label}. ${report.profile.note} Paid DataForSEO called: no. This is not a probability or a revenue prediction.`
  ]));
  root.append(el("p", {}, [report.cross_type_rank_reason]));
  for (const type of ["city", "county", "metro"]) {
    const rows = report.candidates.filter((item) => item.input.geography_type === type);
    if (!rows.length) continue;
    root.append(el("h3", {}, [type === "city" ? "Cities" : type === "county" ? "Counties" : "Metros"]));
    const table = el("table");
    table.append(el("thead", {}, [el("tr", {}, ["Place", "Screen index", "Housing units", "Owner occupancy", "Older stock", "Shrink-swell", "Drought PDSI", "Deep check"].map((heading) => el("th", {}, [heading])))]));
    const body = el("tbody");
    rows.forEach((item) => {
      const indexText = item.screen_index.status === "calculated"
        ? `${item.screen_index.value} (#${item.screen_index.position_in_group} in group)`
        : "Withheld";
      const button = el("button", { type: "button", class: "secondary" }, [item.deep_check.allowed ? "Copy city into deep check" : "City check blocked"]);
      button.disabled = !item.deep_check.allowed;
      button.addEventListener("click", () => {
        $("niche").value = item.deep_check.niche;
        $("city").value = item.deep_check.city;
        $("state").value = item.deep_check.state;
        $("country").value = item.deep_check.country;
        clearOutput();
        $("query-heading").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      body.append(el("tr", {}, [
        el("td", {}, [item.geography.census_name || item.input.name, item.geography.outcome === "matched" ? "" : ` (${item.geography.outcome})`]),
        el("td", {}, [indexText]),
        el("td", {}, [item.signals.housing_units.value === null ? statusText(item.signals.housing_units.status) : String(item.signals.housing_units.value)]),
        el("td", {}, [formatShare(item.signals.owner_occupancy_rate)]),
        el("td", {}, [formatShare(item.signals.older_housing_share)]),
        el("td", {}, [formatShare(item.signals.high_shrink_swell_share)]),
        el("td", {}, [item.signals.drought_pdsi.value === null || item.signals.drought_pdsi.value === undefined ? statusText(item.signals.drought_pdsi.status) : String(item.signals.drought_pdsi.value)]),
        el("td", {}, [button])
      ]));
    });
    table.append(body);
    root.append(el("div", { class: "scroll" }, [table]));
  }
  const limits = el("ul");
  (report.limitations || []).forEach((line) => limits.append(el("li", {}, [line])));
  root.append(el("h3", {}, ["Screen limitations"]), limits);
}

async function runScreen(mode) {
  $("screen-sample").disabled = true;
  $("screen-free").disabled = true;
  renderScreen(null, "");
  try {
    const report = await post("/api/screen", {
      mode,
      niche: $("screen-niche").value.trim(),
      candidates: parseScreenLines($("screen-lines").value)
    });
    renderScreen(report, "");
  } catch (error) {
    renderScreen(null, error.message || "Screen failed.");
  } finally {
    $("screen-sample").disabled = false;
    $("screen-free").disabled = false;
  }
}

$("screen-fill").addEventListener("click", () => {
  $("screen-lines").value = SAMPLE_LINES;
  $("screen-niche").value = "foundation repair";
});
$("screen-sample").addEventListener("click", () => runScreen("sample"));
$("screen-free").addEventListener("click", () => runScreen("free"));
$("screen-lines").value = SAMPLE_LINES;

["niche", "city", "state", "country"].forEach((id) => {
  $(id).addEventListener("input", clearOutput);
});
$("resolve-example").addEventListener("click", () => resolve("example"));
$("resolve-live").addEventListener("click", () => resolve("live"));
renderFixtures();
render();
loadHealth();
