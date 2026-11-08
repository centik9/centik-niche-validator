const state = {
  step: "context",
  context: null,
  subniche: null,
  locationId: null,
  proposal: null,
  decision: null,
  deep: null
};

const $ = (id) => document.getElementById(id);

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([key, value]) => {
    if (key === "class") node.className = value;
    else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  });
  (children || []).forEach((child) => node.append(child instanceof Node ? child : document.createTextNode(String(child))));
  return node;
}

function keywordFromForm() {
  return { keyword: $("keyword").value.trim() };
}

function invalidateDownstream() {
  state.subniche = null;
  state.locationId = null;
  state.proposal = null;
  state.decision = null;
  state.deep = null;
  state.step = "context";
  $("step-locations").hidden = true;
  $("step-proposal").hidden = true;
  $("step-deep").hidden = true;
  $("location-cards").replaceChildren();
  $("proposal-slot").replaceChildren();
  $("deep-slot").replaceChildren();
}

async function post(path, payload) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error("The preview could not be reached. Nothing was checked or purchased.");
  }
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`The preview returned an unreadable response (${response.status}). Nothing was checked or purchased.`);
  }
  if (!body || typeof body !== "object") {
    throw new Error("The preview returned an unexpected response. Nothing was checked or purchased.");
  }
  if (!response.ok) {
    const error = new Error(body.message || "Request failed.");
    error.body = body;
    throw error;
  }
  return body;
}

function paintStepper() {
  document.querySelectorAll(".stepper li").forEach((item) => {
    item.classList.toggle("current", item.getAttribute("data-step") === state.step);
  });
}

function strengthBar(score) {
  const bar = el("div", { class: "bar segments" });
  const filled = Math.max(0, Math.min(20, Math.round(Number(score) / 5)));
  for (let mark = 0; mark < 20; mark += 1) bar.append(el("i", { class: mark < filled ? "on" : "" }));
  return bar;
}

function showSubniches(report, error) {
  const slot = $("subniche-slot");
  const status = $("subniche-status");
  slot.replaceChildren();
  if (error) {
    status.textContent = error;
    slot.append(el("p", { class: "error" }, [error]));
    return;
  }
  status.textContent = report.ranking_note;
  if (!report.known_profile) {
    const choice = report.unranked_option;
    const row = el("button", {
      type: "button",
      class: "leader-row",
      "aria-label": `Unranked example, ${choice.label}. Not a researched list.`
    }, [
      el("span", { class: "rank" }, ["–"]),
      el("span", { class: "leader-body" }, [
        el("span", { class: "leader-label" }, [el("strong", {}, [choice.label]), el("span", { class: "leader-score" }, ["Unranked example"])]),
        el("p", { class: "leader-evidence" }, [choice.note])
      ])
    ]);
    row.addEventListener("click", () => chooseSubniche(choice));
    slot.append(row);
    return;
  }
  const list = el("ol", { class: "leaderboard" });
  report.subniches.forEach((choice) => {
    const item = el("li");
    const row = el("button", {
      type: "button",
      class: "leader-row",
      "aria-label": `Rank ${choice.example_rank}, ${choice.label}, illustrative example score ${choice.example_strength}`
    }, [
      el("span", { class: "rank" }, [String(choice.example_rank)]),
      el("span", { class: "leader-body" }, [
        el("span", { class: "leader-label" }, [
          el("strong", {}, [choice.label]),
          el("span", { class: "leader-score" }, [`Example ${choice.example_strength}`])
        ]),
        strengthBar(choice.example_strength),
        el("p", { class: "leader-evidence" }, [choice.evidence])
      ])
    ]);
    row.addEventListener("click", () => chooseSubniche(choice));
    item.append(row);
    list.append(item);
  });
  slot.append(list);
}

let suggestTimer = null;
let suggestRequest = 0;

function scheduleSuggestions() {
  invalidateDownstream();
  const keyword = $("keyword").value.trim();
  state.context = { keyword };
  window.clearTimeout(suggestTimer);
  const requestId = ++suggestRequest;
  const status = $("subniche-status");
  $("subniche-slot").replaceChildren();
  if (!keyword) {
    status.textContent = "Type a service keyword to see example suggestions.";
    return;
  }
  if (keyword.length < 2) {
    status.textContent = "Keep typing. Example suggestions start at 2 characters.";
    return;
  }
  status.textContent = "Preparing example suggestions. This is not a live market search.";
  suggestTimer = window.setTimeout(async () => {
    try {
      const report = await post("/api/microsite", { action: "subniches", keyword });
      if (requestId !== suggestRequest) return;
      state.step = "subniches";
      paintStepper();
      showSubniches(report, "");
    } catch (error) {
      if (requestId !== suggestRequest) return;
      showSubniches(null, error.message || "Example suggestions could not be loaded.");
    }
  }, 350);
}

async function chooseSubniche(choice) {
  try {
  state.subniche = choice;
  state.locationId = null;
  state.proposal = null;
  state.decision = null;
  state.deep = null;
  $("step-proposal").hidden = true;
  $("step-deep").hidden = true;
  const report = await post("/api/microsite", {
    action: "shortlist",
    subniche_id: choice.id,
    keyword: state.context.keyword
  });
  state.step = "locations";
  $("step-locations").hidden = false;
  paintStepper();
  renderCards(report);
  $("step-locations").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("subniche-status").textContent = error.message || "The shortlist could not be built.";
  }
}

function renderCards(report) {
  $("location-note").textContent = `${report.example_banner} ${report.coverage.note} ${report.ranking_note}`;
  const root = $("location-cards");
  root.replaceChildren();
  report.cards.forEach((card) => {
    const article = el("article", { class: state.locationId === card.id ? "location-card selected" : "location-card" });
    const title = el("div", { class: "card-top" }, [
      el("h3", {}, [`${card.position}. ${card.name}, ${card.state}`]),
      el("span", { class: "tag" }, [card.geography_type])
    ]);
    article.append(title);
    article.append(el("p", { class: "tag tag-example" }, [card.subniche_label]));
    article.append(el("p", {}, [`Example relative demand ${card.example_relative_demand}`]));
    const bar = el("div", { class: "bar segments" });
    const filled = Math.round(card.example_relative_demand / 5);
    for (let mark = 0; mark < 20; mark += 1) bar.append(el("i", { class: mark < filled ? "on" : "" }));
    article.append(bar);
    article.append(el("p", { class: "evidence" }, [
      `EXAMPLE evidence: ${card.example_evidence.monthly_searches} monthly searches · ${card.example_evidence.competitor_count} competitors`
    ]));
    const details = el("details");
    details.append(el("summary", {}, ["Why this card looks like this"]));
    details.append(el("p", {}, [card.example_evidence.formula]));
    details.append(el("p", {}, ["The bar is an example fixture. It is not Census housing and it is not keyword search volume."]));
    if (card.housing_proxy.status === "not_in_sample") {
      details.append(el("p", {}, [card.housing_proxy.note]));
    } else {
      const housing = card.housing_proxy.housing_units === null ? "missing" : String(card.housing_proxy.housing_units);
      details.append(el("p", {}, [`Sample housing proxy: ${housing} housing units. ${card.housing_proxy.note}`]));
      const soil = card.housing_proxy.soil;
      details.append(el("p", {}, [`Soil proxy: ${soil.status}. ${soil.note || ""}`]));
      const drought = card.housing_proxy.drought;
      details.append(el("p", {}, [`Drought proxy: ${drought.status}${drought.value === null || drought.value === undefined ? "" : ` ${drought.value}`}.`]));
      details.append(el("p", {}, [`Freeze-thaw cycles: ${card.housing_proxy.freeze_thaw_cycles.status}. ${card.housing_proxy.freeze_thaw_cycles.note}`]));
    }
    article.append(details);
    const button = el("button", { type: "button" }, [state.locationId === card.id ? "Selected" : "Choose this location"]);
    button.addEventListener("click", () => chooseLocation(card));
    article.append(button);
    root.append(article);
  });
}

async function chooseLocation(card) {
  try {
    state.locationId = card.id;
    state.decision = null;
    state.deep = null;
    $("step-deep").hidden = true;
    const proposal = await post("/api/microsite", {
      action: "proposal",
      subniche_id: state.subniche.id,
      location_id: card.id,
      keyword: state.context.keyword
    });
    state.proposal = proposal;
    state.step = "proposal";
    $("step-proposal").hidden = false;
    paintStepper();
    renderProposal(proposal);
    document.querySelectorAll(".location-card").forEach((node, index) => {
      node.classList.toggle("selected", index === card.position - 1);
    });
    $("step-proposal").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("location-note").textContent = error.message || "The microsite sketch could not be built.";
  }
}

function renderProposal(proposal) {
  const slot = $("proposal-slot");
  slot.replaceChildren();
  const card = el("article", { class: "proposal-card" });
  card.append(el("p", { class: "tag tag-example" }, ["Suggestion only"]));
  card.append(el("h3", {}, [proposal.microsite_name]));
  card.append(el("p", {}, [proposal.headline]));
  card.append(el("p", {}, [`Suggested domain ${proposal.suggested_domain}. ${proposal.domain_note}`]));
  const list = el("ul");
  proposal.pages.forEach((page) => list.append(el("li", {}, [`${page.name}: ${page.purpose}`])));
  card.append(list);
  proposal.claims_not_made.forEach((line) => card.append(el("p", {}, [line])));
  card.append(el("p", {}, [proposal.yes_means]));
  const actions = el("div", { class: "choice-actions actions" });
  const yes = el("button", { type: "button" }, ["Yes, keep this sketch"]);
  const no = el("button", { type: "button", class: "no" }, ["No, try another location"]);
  yes.addEventListener("click", () => decide("yes"));
  no.addEventListener("click", () => decide("no"));
  actions.append(yes, no);
  card.append(actions);
  slot.append(card);
}

function decide(choice) {
  state.decision = choice;
  state.deep = null;
  if (choice === "no") {
    state.step = "locations";
    $("step-deep").hidden = true;
    $("proposal-slot").append(el("p", {}, ["Sketch set aside. Choose another location above. Nothing was bought or checked."]));
    paintStepper();
    $("step-locations").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  state.step = "deep_check";
  $("step-deep").hidden = false;
  paintStepper();
  renderGate();
  $("step-deep").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderGate() {
  const gate = state.proposal.deep_check_gate;
  const slot = $("deep-slot");
  slot.replaceChildren();
  slot.append(el("p", { class: "notice" }, ["Paid DataForSEO check is off. Yes did not authorize spending."]));
  slot.append(el("p", {}, [gate.reason]));
  if (!gate.example_check_available) {
    slot.append(el("p", { class: "score-withheld" }, ["Example check withheld"]));
    return;
  }
  const button = el("button", { type: "button" }, ["Run example deep check"]);
  button.addEventListener("click", runExampleCheck);
  slot.append(button);
  slot.append(el("div", { id: "deep-result" }));
}

async function runExampleCheck() {
  const result = $("deep-result");
  result.replaceChildren(el("p", {}, ["Running the example check…"]));
  try {
    const location = state.proposal.location;
    const resolved = await post("/api/resolve", {
      mode: "example",
      city: location.name,
      state: location.state,
      country: "United States"
    });
    const side = (match) => match ? {
      location_code: match.location_code,
      location_name: match.location_name,
      location_type: match.location_type
    } : null;
    const report = await post("/api/validate", {
      mode: "example",
      niche: state.subniche.label,
      city: location.name,
      state: location.state,
      country: "United States",
      geography_type: "city",
      confirmed: {
        google_ads: side(resolved.google_ads.match),
        google_maps: side(resolved.google_maps.match)
      }
    });
    result.replaceChildren();
    if (report.example_banner) result.append(el("p", { class: "banner" }, [report.example_banner]));
    const score = report.score;
    if (!score || score.overall_status !== "calculated" || score.overall_display === null) {
      result.append(el("p", { class: "score-withheld" }, ["Withheld"]));
      result.append(el("p", {}, [score && score.withheld_reason ? score.withheld_reason : "No combined index."]));
    } else {
      result.append(el("p", { class: "score-number" }, [score.overall_display]));
      result.append(el("p", {}, ["Example heuristic index. Not a recommendation."]));
    }
    result.append(el("p", {}, [
      `Keyword sent: ${report.niche}. City: ${report.normalized_query.city}, ${report.normalized_query.state}.`
    ]));
  } catch (error) {
    result.replaceChildren(el("p", { class: "error" }, [error.message || "Example check failed."]));
  }
}

$("keyword").addEventListener("input", scheduleSuggestions);
paintStepper();

fetch("/health").then((response) => response.json()).then((health) => {
  const live = health.live_mode ? "on" : "off";
  $("server-status").textContent = `Server ${health.version}. Live mode ${live}. Example preview. Credentials are never shown.`;
}).catch(() => {
  $("server-status").textContent = "Health check failed.";
});
