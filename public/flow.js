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

function strengthBar(score, band) {
  const bar = el("div", { class: `bar segments band-${band || "missing"}` });
  const filled = score === null || score === undefined ? 0 : Math.max(0, Math.min(20, Math.round(Number(score) / 5)));
  for (let mark = 0; mark < 20; mark += 1) bar.append(el("i", { class: mark < filled ? "on" : "" }));
  return bar;
}

function priceLine(choice) {
  const missing = !choice.price || (choice.price.status !== "published");
  if (missing) {
    return el("p", { class: "leader-evidence" }, [choice.price && choice.price.sentence ? choice.price.sentence : "Price range missing. Margin is missing, so this row is not scored."]);
  }
  const line = el("p", { class: "leader-evidence" }, []);
  if (choice.price.estimated) line.append(el("span", { class: "est-tag" }, ["est."]), " ");
  line.append(`${choice.price.sentence} National range, not adjusted for a city.`);
  return line;
}

function estimateBar(score, band) {
  const width = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, Number(score)));
  const track = el("div", { class: `estimate-bar band-${band || "missing"}` });
  track.append(el("span", { style: `width: ${width}%` }));
  return track;
}

function sourceLine(price) {
  if (!price || price.status !== "published") {
    return el("p", { class: "source-line" }, [price && price.source_line ? price.source_line : "Price range missing"]);
  }
  const line = el("p", { class: "source-line" }, [
    `${price.source_name}. Accessed November 8, 2026. National range, not adjusted for a city. `
  ]);
  const link = el("a", { href: price.url, rel: "noopener noreferrer" }, [price.url]);
  line.append(link);
  return line;
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
      "aria-label": choice.composite.status === "calculated"
        ? `Rank ${choice.example_rank}, ${choice.label}, composite ${choice.composite.composite_display}, ${choice.composite.band} band${choice.match && choice.match.label ? `, ${choice.match.label}` : ""}`
        : `Rank ${choice.example_rank}, ${choice.label}, price range missing${choice.match && choice.match.label ? `, ${choice.match.label}` : ""}`
    }, [
      el("span", { class: "rank" }, [String(choice.example_rank)]),
      el("span", { class: "leader-body" }, [
        el("span", { class: "leader-label" }, [
          el("strong", {}, [choice.label]),
          el("span", { class: `leader-score band-${choice.composite.band}` }, [
            choice.composite.status === "calculated" ? choice.composite.composite_display : "Price range missing"
          ])
        ]),
        choice.price && choice.price.estimated ? estimateBar(choice.composite.composite_display, choice.composite.band) : strengthBar(choice.composite.composite_display, choice.composite.band),
        ...(choice.match && choice.match.label ? [el("p", { class: "match-label" }, [choice.match.label])] : []),
        priceLine(choice),
        ...(choice.price && choice.price.chain_text ? [el("p", { class: "chain-line" }, [choice.price.chain_text])] : [])
      ])
    ]);
    row.addEventListener("click", () => chooseSubniche(choice));
    item.append(row, sourceLine(choice.price));
    list.append(item);
  });
  slot.append(list);
}

let liveReady = false;
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
      if (report.needs_confirmation) {
        status.textContent = report.ranking_note || "Confirm the lookup before a paid request is sent.";
        return;
      }
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

const GAUGE_CX = 200;
const GAUGE_CY = 176;

function zoneWord(score) {
  const value = Number(score);
  if (value < 15) return "No";
  if (value < 30) return "Low";
  if (value < 60) return "Medium";
  if (value < 80) return "High";
  return "Max";
}

function gaugePoint(score, radius) {
  const angle = Math.PI * (1 - score / 100);
  return [GAUGE_CX + radius * Math.cos(angle), GAUGE_CY - radius * Math.sin(angle)];
}

function annularWedge(start, end, outer, inner) {
  const [ox1, oy1] = gaugePoint(start, outer);
  const [ox2, oy2] = gaugePoint(end, outer);
  const [ix2, iy2] = gaugePoint(end, inner);
  const [ix1, iy1] = gaugePoint(start, inner);
  return `M ${ox1} ${oy1} A ${outer} ${outer} 0 0 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${inner} ${inner} 0 0 0 ${ix1} ${iy1} Z`;
}

function face(score, mood) {
  const [x, y] = gaugePoint(score, 90);
  const mouth = {
    sad: `M ${x - 7} ${y + 6} Q ${x} ${y - 1} ${x + 7} ${y + 6}`,
    frown: `M ${x - 6} ${y + 5} Q ${x} ${y + 1} ${x + 6} ${y + 5}`,
    flat: `M ${x - 6} ${y + 4} L ${x + 6} ${y + 4}`,
    smile: `M ${x - 7} ${y + 2} Q ${x} ${y + 9} ${x + 7} ${y + 2}`,
    big: `M ${x - 8} ${y + 1} Q ${x} ${y + 12} ${x + 8} ${y + 1}`
  }[mood];
  return [
    svgEl("circle", { cx: x, cy: y, r: 13, fill: "#fffdf8", stroke: "#1a1a1a", "stroke-width": "1.5" }),
    svgEl("circle", { cx: x - 4, cy: y - 3, r: 1.4, fill: "#1a1a1a" }),
    svgEl("circle", { cx: x + 4, cy: y - 3, r: 1.4, fill: "#1a1a1a" }),
    svgEl("path", { d: mouth, fill: "none", stroke: "#1a1a1a", "stroke-width": "1.6", "stroke-linecap": "round" })
  ];
}

function svgEl(tag, attrs, children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
  (children || []).forEach((child) => node.append(child instanceof Node ? child : document.createTextNode(String(child))));
  return node;
}

function renderGauge(composite) {
  const calculated = composite.status === "calculated";
  const score = calculated ? Number(composite.composite_display) : null;
  const zone = calculated ? zoneWord(score) : "Not calculated";
  const pillText = !calculated
    ? "Not scored"
    : composite.clears_green_label === "on an estimated price"
      ? "Clears green on an estimate"
      : composite.clears_green_label === "yes"
        ? "Clears green"
        : "Below green";
  const label = calculated
    ? `Composite ${composite.composite_display} out of 100. Zone ${zone}. ${pillText}.`
    : "Composite withheld. Price range missing. Not scored.";
  const svg = svgEl("svg", { viewBox: "0 0 400 268", role: "img", "aria-label": label });
  const wedges = [
    [0, 15, "#c0392b", "sad"],
    [15, 30, "#e07a2f", "frown"],
    [30, 60, "#e6c229", "flat"],
    [60, 80, "#8fb83a", "smile"],
    [80, 100, "#1e7a46", "big"]
  ];
  wedges.forEach(([start, end, color]) => {
    svg.append(svgEl("path", { d: annularWedge(start, end, 116, 62), fill: color, stroke: "none" }));
  });
  [0, 15, 30, 60, 80, 100].forEach((boundary) => {
    const [x1, y1] = gaugePoint(boundary, 62);
    const [x2, y2] = gaugePoint(boundary, 116);
    svg.append(svgEl("line", { x1, y1, x2, y2, stroke: "#fffdf8", "stroke-width": "3" }));
  });
  wedges.forEach(([start, end, , mood]) => face((start + end) / 2, mood).forEach((node) => svg.append(node)));
  const [ringX, ringY] = gaugePoint(0, 128);
  const [ringEndX, ringEndY] = gaugePoint(100, 128);
  svg.append(svgEl("path", {
    d: `M ${ringX} ${ringY} A 128 128 0 0 1 ${ringEndX} ${ringEndY}`,
    fill: "none",
    stroke: "#b7b1a8",
    "stroke-width": "12",
    "stroke-linecap": "butt"
  }));
  [["No", 7.5], ["Low", 22.5], ["Medium", 45], ["High", 70], ["Max", 90]].forEach(([name, at]) => {
    const [x, y] = gaugePoint(at, 150);
    svg.append(svgEl("text", { x, y, "text-anchor": "middle", "dominant-baseline": "middle", fill: "#4e483f", "font-size": "11" }, [name]));
  });
  for (let mark = 0; mark <= 100; mark += 5) {
    const [x1, y1] = gaugePoint(mark, 117);
    const [x2, y2] = gaugePoint(mark, 122);
    svg.append(svgEl("line", { x1, y1, x2, y2, stroke: "#1a1a1a", "stroke-width": mark % 50 === 0 ? "2" : "1" }));
    if (mark === 0 || mark === 50 || mark === 100) {
      const [tx, ty] = gaugePoint(mark, 119);
      svg.append(svgEl("text", { x: tx, y: ty, "text-anchor": "middle", "dominant-baseline": "middle", fill: "#1d1914", "font-size": "9" }, [String(mark)]));
    }
  }
  if (calculated) {
    const angle = Math.PI * (1 - score / 100);
    const [tipX, tipY] = gaugePoint(score, 108);
    const base = 8;
    svg.append(svgEl("polygon", {
      points: `${GAUGE_CX + base * Math.sin(angle)},${GAUGE_CY + base * Math.cos(angle)} ${GAUGE_CX - base * Math.sin(angle)},${GAUGE_CY - base * Math.cos(angle)} ${tipX},${tipY}`,
      fill: "#1a1a1a"
    }));
  }
  svg.append(svgEl("circle", { cx: GAUGE_CX, cy: GAUGE_CY, r: 18, fill: "#1a1a1a" }));
  svg.append(svgEl("circle", { cx: GAUGE_CX, cy: GAUGE_CY, r: 8, fill: "#fffdf8" }));
  svg.append(svgEl("text", {
    x: GAUGE_CX,
    y: GAUGE_CY + 58,
    "text-anchor": "middle",
    "font-family": "Segoe UI, system-ui, sans-serif",
    "font-size": "32",
    "font-weight": "700",
    fill: "#1d1914"
  }, [calculated ? composite.composite_display : "—"]));
  svg.append(svgEl("text", {
    x: GAUGE_CX,
    y: GAUGE_CY + 80,
    "text-anchor": "middle",
    "font-family": "Segoe UI, system-ui, sans-serif",
    "font-size": "16",
    "font-weight": "700",
    fill: "#1d1914"
  }, [zone]));
  const figure = el("figure", { class: "gauge" });
  figure.append(svg);
  const pillClass = !calculated ? "pill-no" : composite.clears_green_label === "yes" ? "pill-yes" : "pill-no";
  figure.append(el("p", { class: `pill ${pillClass}` }, [pillText]));
  figure.append(scoreTable(composite));
  return figure;
}

function scoreTable(composite) {
  const table = el("table", { class: "score-table" });
  const demand = composite.demand;
  const competition = composite.competition;
  const margin = composite.margin;
  const rows = [
    ["Demand", demand.index === null || demand.index === undefined ? "—" : `${demand.index} × 40%`, demand.contribution_display || "—"],
    ["Competition", competition.index === null || competition.index === undefined ? "—" : `${competition.index} × 30%`, competition.contribution_display || "—"],
    ["Margin", margin.index === null || margin.index === undefined ? "—" : `${margin.index} × 30%`, margin.contribution_display || "—"]
  ];
  rows.forEach(([name, weight, points]) => {
    table.append(el("tr", {}, [
      el("th", {}, [name]),
      el("td", {}, [weight]),
      el("td", {}, [points])
    ]));
  });
  return table;
}

function renderBreakdown(composite) {
  const block = el("div", { class: "breakdown" });
  block.append(el("h3", {}, ["Composite breakdown"]));
  block.append(el("p", { class: "help" }, [composite.normalization.composite]));
  const demand = composite.demand;
  block.append(el("p", {}, [
    demand.contribution_display === null
      ? "Demand missing."
      : `Demand ${demand.index} × 40% = ${demand.contribution_display}. ${demand.label || "EXAMPLE"} search volume ${demand.monthly_searches} monthly searches.`
  ]));
  const competition = composite.competition;
  block.append(el("p", {}, [
    competition.contribution_display === null
      ? "Competition missing."
      : `Competition ${competition.index} × 30% = ${competition.contribution_display}. ${competition.label || "EXAMPLE"} competitor count ${competition.competitor_count}. Less competition scores higher.`
  ]));
  const margin = composite.margin;
  block.append(el("p", {}, [
    margin.status === "published"
      ? `Margin ${margin.index} × 30% = ${margin.contribution_display}. ${margin.sentence} National range, not adjusted for a city.`
      : "Margin missing. Price range missing. Missing is not scored as zero."
  ]));
  if (margin.status === "published") block.append(sourceLine(margin));
  block.append(el("p", { class: "help" }, [composite.normalization.margin]));
  return block;
}

function renderProposal(proposal) {
  const slot = $("proposal-slot");
  slot.replaceChildren();
  const gauge = renderGauge(proposal.composite);
  if (proposal.deep_check_gate && proposal.deep_check_gate.demand_basis_note) {
    gauge.append(el("p", { class: "help demand-note" }, [proposal.deep_check_gate.demand_basis_note]));
  }
  slot.append(gauge);
  slot.append(renderBreakdown(proposal.composite));
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
  card.append(el("p", { class: "notice" }, [proposal.deep_check_gate.gate_line]));
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
    if (!$("proposal-slot").querySelector("[data-set-aside]")) {
      $("proposal-slot").append(el("p", { "data-set-aside": "true" }, ["Sketch set aside. Choose another location above. Nothing was bought or checked."]));
    }
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
  slot.append(el("p", { class: "notice" }, [liveReady
    ? "Live mode is on. This check is $0.105: $0.09 for Google Ads search volume, $0.002 for Maps depth 100, $0.002 for organic depth 10, and $0.011 for Google Trends. A saved result for the same niche and city is not charged again until you rerun the paid check."
    : "Paid DataForSEO check is off. Yes did not authorize spending."]));
  slot.append(el("p", {}, [gate.reason]));
  if (!gate.example_check_available) {
    slot.append(el("p", { class: "score-withheld" }, ["Example check withheld"]));
    return;
  }
  const button = el("button", { type: "button" }, [liveReady ? "Run live check" : "Run example deep check"]);
  button.addEventListener("click", runExampleCheck);
  slot.append(button);
  slot.append(el("div", { id: "deep-result" }));
}

async function runExampleCheck() {
  const result = $("deep-result");
  result.replaceChildren(el("p", {}, [liveReady ? "Running the live check…" : "Running the example check…"]));
  try {
    const location = state.proposal.location;
    const mode = liveReady ? "live" : "example";
    const resolved = await post("/api/resolve", {
      mode,
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
      mode,
      margin_index: state.proposal.composite && state.proposal.composite.margin ? state.proposal.composite.margin.index : undefined,
      margin_estimated: Boolean(state.proposal.composite && state.proposal.composite.estimated),
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
    if (report.city_market) result.append(el("p", {}, [`Demand: ${report.city_market.demand_label}. Competition: ${report.city_market.competition_label}.`]));
    if (report.live_composite && report.live_composite.status === "insufficient_data") {
      result.append(el("p", { class: "score-withheld" }, ["Insufficient data"]));
      result.append(el("p", {}, [report.live_composite.withheld_reason || "Demand was not measured. This is not a score of 0."]));
    } else if (report.live_composite) {
      result.append(el("p", { class: "score-number" }, [report.live_composite.composite_display]));
      if (report.live_composite.grade_cap && report.live_composite.grade_cap.applied) {
        result.append(el("p", {}, [report.live_composite.grade_cap.note]));
      }
      const slot = $("proposal-slot");
      const current = slot.querySelector("figure.gauge");
      if (current) {
        const next = renderGauge(report.live_composite);
        next.append(el("p", { class: "help demand-note" }, ["Live Google data for this city. Competition uses the map-pack count, review counts, and listings with no website."]));
        current.replaceWith(next);
      }
      const breakdown = slot.querySelector(".breakdown");
      if (breakdown) breakdown.replaceWith(renderBreakdown(report.live_composite));
    }
    if (report.example_banner) result.append(el("p", { class: "banner" }, [report.example_banner]));
    const score = report.score;
    if (score && score.grade_state === "insufficient_data") {
      result.append(el("p", { class: "score-withheld" }, ["Insufficient data"]));
      result.append(el("p", {}, [score.withheld_reason || "Demand was not measured. This is not a score of 0."]));
    } else if (!score || score.overall_status !== "calculated" || score.overall_display === null) {
      result.append(el("p", { class: "score-withheld" }, ["Withheld"]));
      result.append(el("p", {}, [score && score.withheld_reason ? score.withheld_reason : "No combined index."]));
    } else {
      result.append(el("p", { class: "score-number" }, [score.overall_display]));
      result.append(el("p", {}, [report.city_market && report.city_market.live ? "Live Google data. Not a recommendation." : "Example data. Not a recommendation."]));
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
  liveReady = Boolean(health.live_mode && health.credentials_configured);
  const live = health.live_mode ? "on" : "off";
  $("server-status").textContent = `Server ${health.version}. Live mode ${live}. ${liveReady ? "Live Google data is available after you run a check." : "Example data until live mode and credentials are set."} Credentials are never shown.`;
}).catch(() => {
  $("server-status").textContent = "Health check failed.";
});
