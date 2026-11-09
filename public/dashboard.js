const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const kid of kids) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return node;
}

function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (parent) parent.append(node);
  return node;
}

function money(amount) {
  return `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const ZONES = [
  { name: "No", from: 0, to: 15, c: "--z-no", line: "Weak market here. Not worth a site yet." },
  { name: "Low", from: 15, to: 30, c: "--z-low", line: "Thin market. Only worth it with a sharp angle." },
  { name: "Medium", from: 30, to: 60, c: "--z-med", line: "Workable. Check the city and the price before you build." },
  { name: "High", from: 60, to: 80, c: "--z-high", line: "Strong fit. Worth a microsite." },
  { name: "Max", from: 80, to: 100, c: "--z-max", line: "Top tier. Build this one first." }
];

function zoneOf(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return ZONES[0];
  return ZONES.find((zone, index) => score < zone.to || index === ZONES.length - 1);
}

const state = {
  keyword: "",
  rows: [],
  subniche: null,
  cards: [],
  location: null,
  proposal: null,
  quote: null,
  busy: false
};

let suggestTimer = 0;
let revealed = false;

async function post(pathname, body) {
  const response = await fetch(pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || "Request failed.");
    error.code = payload.error;
    throw error;
  }
  return payload;
}

function paintStepper() {
  const steps = [
    ["1. Service", state.subniche ? state.subniche.label : "Keyword"],
    ["2. Locations", state.location ? `${state.location.name}, ${state.location.state}` : "Pick a city"],
    ["3. Microsite", state.proposal ? "Sketch ready" : "After a city"],
    ["4. Check", state.quote ? "Waiting for your okay" : "Not quoted"]
  ];
  const current = state.quote ? 3 : state.proposal ? 2 : state.cards.length ? 1 : 0;
  $("stepper").replaceChildren(...steps.map(([label, detail], index) => el("li", {
    class: index < current ? "done" : index === current ? "now" : ""
  }, [
    el("span", { class: "dot", "aria-hidden": "true" }, [index < current ? "✓" : String(index + 1)]),
    el("span", {}, [label, el("small", {}, [detail])])
  ])));
}

function renderRows() {
  const list = $("lb");
  list.replaceChildren();
  state.rows.forEach((row, index) => {
    const score = row.composite && row.composite.composite_display ? Number(row.composite.composite_display) : null;
    const zone = score == null ? null : zoneOf(score);
    const estimated = Boolean(row.composite && (row.composite.estimated || row.composite.pending_review || (row.price && row.price.pending_review)));
    const item = el("li", { class: state.subniche && state.subniche.id === row.id ? "sel" : "" });
    item.append(
      el("span", { class: "rk" }, [String(index + 1)]),
      el("div", {}, [
        el("div", { class: "nm" }, [row.label, estimated ? el("span", { class: "est-tag", title: row.price && row.price.pending_review ? "Pending review" : "Price is estimated" }, ["EST."]) : ""]),
        el("div", { class: `bar${estimated ? " dashed" : ""}`, style: zone ? `color:var(${zone.c})` : "" }, [
          el("span", { "data-w": score == null ? "0" : String(score), style: `width:${score || 0}%;background:${zone ? `var(${zone.c})` : "var(--text3)"}` })
        ])
      ]),
      el("div", {}, [
        el("span", { class: "sc num" }, [score == null ? "—" : String(Math.round(score))]),
        el("span", { class: "zn" }, [zone ? zone.name : "Not scored"])
      ])
    );
    item.addEventListener("click", () => chooseSubniche(row));
    list.append(item);
  });
}

function renderMap(cards) {
  const cities = cards.filter((card) => card.geography_type === "city").slice(0, 5);
  const wrap = $("mapwrap");
  wrap.replaceChildren();
  const map = svg("svg", { viewBox: "0 0 360 210", class: "map", role: "img", "aria-label": "Stylized map of the example cities. Not a real map." });
  svg("path", { d: "M40 60 C 90 40, 150 45, 210 52 S 310 70, 330 110 S 300 180, 230 186 S 90 190, 50 160 S 10 90, 40 60 Z", fill: "rgba(167,139,250,.05)", stroke: "#a78bfa", "stroke-opacity": ".45", "stroke-dasharray": "4 5" }, map);
  const spots = [[70, 92], [150, 104], [214, 96], [226, 150], [158, 156]];
  cities.forEach((card, index) => {
    const [x, y] = spots[index];
    const selected = state.location && state.location.id === card.id;
    const group = svg("g", { transform: `translate(${x} ${y})` }, map);
    svg("circle", { r: selected ? 6 : 4.5, fill: selected ? "#f4f8fc" : "#22d3ee" }, group);
    const label = svg("text", { x: 10, y: -8, "font-size": selected ? 14 : 12.5, "font-weight": selected ? 800 : 600, fill: selected ? "#eef2f7" : "#a9b4c6", stroke: "#0a0e15", "stroke-width": 3.5, "paint-order": "stroke" }, group);
    label.textContent = card.name;
  });
  wrap.append(map);
  const list = $("locs");
  list.replaceChildren();
  cities.forEach((card, index) => {
    const item = el("li", { class: state.location && state.location.id === card.id ? "sel" : "" }, [
      el("b", {}, [`${index + 1}. ${card.name}, ${card.state}`]),
      el("span", { class: "d num" }, [String(card.example_relative_demand)]),
      el("small", {}, [`Sample demand ${card.example_relative_demand}. Not a live search count.`])
    ]);
    item.addEventListener("click", () => chooseLocation(card));
    list.append(item);
  });
}

function renderGauge(composite, title) {
  $("score-title").textContent = title;
  const score = composite && composite.status === "calculated" ? Number(composite.composite_display) : null;
  const zone = score == null ? null : zoneOf(score);
  const wrap = $("dialwrap");
  wrap.replaceChildren();
  const G = { cx: 200, cy: 214, R: 158, SW: 20 };
  const point = (value, radius) => {
    const angle = Math.PI * (1 - value / 100);
    return [G.cx + radius * Math.cos(angle), G.cy - radius * Math.sin(angle)];
  };
  const arc = (start, end, radius) => {
    const [x1, y1] = point(start, radius);
    const [x2, y2] = point(end, radius);
    return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${radius} ${radius} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const dial = svg("svg", { viewBox: "0 0 400 240", class: "dial", role: "img", "aria-label": score == null ? "No market score yet." : `Market score ${composite.composite_display} out of 100. Zone ${zone.name}.` });
  svg("path", { d: arc(0, 100, G.R), fill: "none", stroke: "#1c2432", "stroke-width": G.SW }, dial);
  ZONES.forEach((item) => {
    svg("path", { d: arc(item.from + (item.from ? 0.7 : 0), item.to - (item.to < 100 ? 0.7 : 0), G.R), fill: "none", stroke: `var(${item.c})`, "stroke-width": G.SW, opacity: zone && item.name === zone.name ? "1" : "0.65" }, dial);
  });
  const needle = svg("g", {}, dial);
  const angle = score == null ? -90 : (score - 50) * 1.8;
  needle.setAttribute("transform", `rotate(${angle} ${G.cx} ${G.cy})`);
  svg("path", { d: `M${G.cx - 3} ${G.cy} L${G.cx} ${G.cy - 132} L${G.cx + 3} ${G.cy} Z`, fill: "#f4f8fc" }, needle);
  svg("circle", { cx: G.cx, cy: G.cy, r: 13, fill: "#0b1018", stroke: "#22d3ee", "stroke-width": 2 }, dial);
  svg("circle", { cx: G.cx, cy: G.cy, r: 4, fill: "#f4f8fc" }, dial);
  wrap.append(dial);
  $("num").textContent = score == null ? "—" : (composite.composite_display || String(Math.round(score)));
  $("chipwrap").replaceChildren(zone ? el("span", { class: "chip", style: `color:var(${zone.c})` }, [el("span", { class: "w" }, [zone.name])]) : "");
  $("verdict").textContent = zone ? zone.line : "The score appears after you pick a city.";
  const factors = composite && composite.demand ? [
    ["Demand", composite.demand.index, 40, "--cyan", composite.demand.contribution_display],
    ["Competition", composite.competition.index, 30, "--violet", composite.competition.contribution_display],
    ["Margin", composite.margin.index, 30, "--pink", composite.margin.contribution_display]
  ] : [];
  const board = $("bd");
  board.replaceChildren();
  factors.forEach(([name, value, weight, color, points]) => {
    board.append(el("div", { class: "bd-row" }, [
      el("span", { class: "n" }, [name]),
      el("span", { class: "track", style: `color:var(${color})` }, [el("span", { style: `width:${value == null ? 0 : value}%;background:var(${color})` })]),
      el("span", { class: "w num" }, [value == null ? "—" : `${value} × ${weight}%`]),
      el("span", { class: "p num" }, [points == null ? "—" : `${points} pts`])
    ]));
  });
  if (composite && composite.composite_display) {
    board.append(el("div", { class: "bd-row tot" }, [
      el("span", { class: "n" }, ["Total"]),
      el("span", {}, []),
      el("span", { class: "w" }, []),
      el("span", { class: "p num" }, [composite.composite_display])
    ]));
  }
  if (!revealed && score != null) playReveal(score);
}

function renderEstimates(proposal) {
  const card = $("est-card");
  const kpis = $("kpis");
  kpis.replaceChildren();
  const searches = proposal && proposal.composite && proposal.composite.demand && proposal.composite.demand.monthly_searches;
  const price = proposal && proposal.price;
  const hasPrice = price && price.status === "published" && Number.isInteger(price.low_dollars);
  if (!searches && !hasPrice) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  $("est-pill").textContent = proposal.example_data ? "Sample data" : "Live Google data";
  if (Number.isFinite(searches)) {
    kpis.append(el("div", { class: "kpi" }, [
      el("div", { class: "l" }, ["Leads a month ", el("span", { class: "est-tag" }, ["EST."])]),
      el("div", { class: "v num" }, [String(searches)]),
      el("div", { class: "s" }, ["Example monthly searches from the fixture. Not live volume."])
    ]));
  }
  if (hasPrice) {
    kpis.append(el("div", { class: "kpi" }, [
      el("div", { class: "l" }, [price.pending_review || price.estimated ? "Job range " : "Job range", price.pending_review || price.estimated ? el("span", { class: "est-tag" }, ["EST."]) : ""]),
      el("div", { class: "v num" }, [`$${price.low_dollars.toLocaleString("en-US")} to $${price.high_dollars.toLocaleString("en-US")}`]),
      el("div", { class: "s" }, [price.pending_review ? "Pending review. This cannot make the row green." : (price.sentence || "National range.")])
    ]));
  }
}

function renderSketch(proposal) {
  const slot = $("site");
  slot.replaceChildren();
  if (!proposal) {
    slot.append(el("p", { class: "help" }, ["The sketch appears after you keep a city."]));
    return;
  }
  const mini = el("div", { class: "mini" }, [
    el("div", { class: "url" }, [proposal.suggested_domain]),
    el("div", { class: "hl" }),
    el("div", { class: "ln", style: "width:92%" }),
    el("div", { class: "ln", style: "width:70%" })
  ]);
  const pages = el("ul", { class: "pages" });
  (proposal.pages || []).forEach((page) => pages.append(el("li", {}, [el("b", {}, [page.name]), el("span", {}, [page.purpose])])));
  slot.append(mini, pages);
}

function renderQuote(quote, proposal) {
  const kv = $("paid-kv");
  kv.replaceChildren();
  const rows = quote ? [
    ["Niche", quote.niche],
    ["Market", quote.market],
    ["Calls", String(quote.calls.length)],
    ["Cost", `$${Number(quote.estimated_cost_usd).toFixed(3)}`],
    ["Budget left", `${money(quote.remaining_usd)} of ${money(quote.cap_usd)}`]
  ] : [
    ["Niche", proposal ? proposal.subniche.label : "—"],
    ["Market", proposal ? `${proposal.location.name}, ${proposal.location.state}` : "—"],
    ["Calls", "—"],
    ["Cost", "—"],
    ["Budget left", "—"]
  ];
  rows.forEach(([name, value]) => {
    kv.append(el("dt", {}, [name]), el("dd", { class: "num" }, [value]));
  });
  const cap = quote ? quote.cap_usd : 0;
  const used = quote ? quote.spent_usd : 0;
  $("spent-label").textContent = quote ? `${money(used)} of ${money(cap)}` : "$0.00";
  $("budget-bar").style.width = cap ? `${Math.min(100, (used / cap) * 100)}%` : "0";
  $("pay-go").disabled = !quote || state.busy;
  $("pay-cancel").disabled = !quote || state.busy;
  $("paid-note").textContent = quote && quote.cache_hit
    ? "A saved result from the last 24 hours will be shown. It will not be billed again."
    : "Google Ads search volume and Maps top 20. Location lists are free and are not in this cost.";
  $("paid-pill").textContent = quote && !quote.live_mode ? "Live off" : "Quote";
}

function renderResults(message, report) {
  const slot = $("results");
  slot.replaceChildren();
  if (!report) {
    $("res-pill").textContent = "No check yet";
    slot.append(el("p", { class: message && message.toLowerCase().includes("not") ? "error" : "help" }, [message || "No paid check has run."]));
    return;
  }
  const live = Boolean(report.city_market && report.city_market.live);
  $("res-pill").textContent = live ? "Live Google data" : "Example data";
  const volume = report.demand && report.demand.search_volume;
  const listings = report.city_market && report.city_market.unique_listings;
  const cpc = report.demand && report.demand.cpc;
  const tiles = [
    ["Monthly searches", volume && volume.value != null ? String(volume.value) : "—", live ? "Live Google data" : "Example data"],
    ["Map pack rivals", listings == null ? "—" : String(listings), live ? "Live Google data" : "Example data"],
    ["Top ad bid", cpc && cpc.value != null ? money(cpc.value) : "—", live ? "Live Google data" : "Example data"]
  ];
  tiles.forEach(([label, value, note]) => {
    slot.append(el("div", { class: "res" }, [
      el("div", { class: "l" }, [label]),
      el("div", { class: "v num" }, [value]),
      el("div", { class: "s" }, [note])
    ]));
  });
  if (report.live_banner) slot.append(el("p", { class: "help" }, [report.live_banner]));
  if (report.example_banner) slot.append(el("p", { class: "help" }, [report.example_banner]));
  if (report.live_composite) slot.append(el("p", { class: "help" }, [`Live composite ${report.live_composite.composite_display}. Competition uses the map pack, not demand.`]));
}

async function chooseSubniche(row) {
  state.subniche = row;
  state.location = null;
  state.proposal = null;
  state.quote = null;
  renderRows();
  const shortlist = await post("/api/microsite", { action: "shortlist", keyword: state.keyword, subniche_id: row.id });
  state.cards = shortlist.cards || [];
  renderMap(state.cards);
  paintStepper();
}

async function chooseLocation(card) {
  if (card.geography_type !== "city") return;
  state.location = card;
  renderMap(state.cards);
  state.proposal = await post("/api/microsite", {
    action: "proposal",
    keyword: state.keyword,
    subniche_id: state.subniche.id,
    location_id: card.id
  });
  renderGauge(state.proposal.composite, `${state.proposal.subniche.label} in ${card.name}, ${card.state}`);
  renderEstimates(state.proposal);
  renderSketch(state.proposal);
  $("score-pill").textContent = "Sample data";
  try {
    const resolved = await post("/api/resolve", { mode: "example", city: card.name, state: card.state, country: "United States" });
    const side = (match) => match ? { location_code: match.location_code, location_name: match.location_name, location_type: match.location_type } : null;
    state.quote = await post("/api/quote", {
      niche: state.subniche.label,
      city: card.name,
      state: card.state,
      country: "United States",
      geography_type: "city",
      confirmed: { google_ads: side(resolved.google_ads.match), google_maps: side(resolved.google_maps.match) }
    });
    state.confirmed = { google_ads: side(resolved.google_ads.match), google_maps: side(resolved.google_maps.match) };
  } catch (error) {
    state.quote = null;
    $("paid-note").textContent = error.message;
  }
  renderQuote(state.quote, state.proposal);
  paintStepper();
}

async function runPaid() {
  if (!state.quote || !state.location || state.busy) return;
  state.busy = true;
  $("pay-go").disabled = true;
  $("paid-note").textContent = "Confirming the paid check…";
  try {
    const quoted = await post("/api/quote", {
      niche: state.subniche.label,
      city: state.location.name,
      state: state.location.state,
      country: "United States",
      geography_type: "city",
      confirmed: state.confirmed
    });
    state.quote = quoted;
    renderQuote(quoted, state.proposal);
    const report = await post("/api/validate", {
      mode: "live",
      spend_token: quoted.spend_token,
      margin_index: state.proposal.composite && state.proposal.composite.margin ? state.proposal.composite.margin.index : undefined,
      margin_estimated: Boolean(state.proposal.composite && state.proposal.composite.estimated),
      niche: state.subniche.label,
      city: state.location.name,
      state: state.location.state,
      country: "United States",
      geography_type: "city",
      confirmed: state.confirmed
    });
    renderResults("", report);
    if (report.live_composite) {
      renderGauge(report.live_composite, `${state.subniche.label} in ${state.location.name}, ${state.location.state}`);
      $("score-pill").textContent = "Live Google data";
    }
    $("paid-note").textContent = "The paid check finished. A repeat of this niche and market within 24 hours is not billed again.";
  } catch (error) {
    renderResults(error.message);
    $("paid-note").textContent = error.message;
  } finally {
    state.busy = false;
    $("pay-go").disabled = !state.quote;
  }
}

function playReveal(score) {
  revealed = true;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const grid = $("grid");
  if (reduce) {
    grid.style.opacity = "0";
    requestAnimationFrame(() => {
      grid.style.transition = "opacity 200ms linear";
      grid.style.opacity = "1";
    });
    $("live").textContent = `Market score ${Math.round(score)} out of 100, zone ${zoneOf(score).name}.`;
    return;
  }
  const cards = [...document.querySelectorAll(".card")];
  const started = performance.now();
  const tick = (now) => {
    const t = now - started;
    cards.forEach((card, index) => {
      const p = Math.min(1, Math.max(0, (t - index * 70) / 460));
      const eased = 1 - Math.pow(1 - p, 3);
      card.style.opacity = String(eased);
      card.style.transform = `translateY(${(1 - eased) * 18}px)`;
    });
    const sweep = Math.min(1, Math.max(0, (t - 600) / 1150));
    const shown = Math.min(score, score * (1 + 1.25 * Math.pow(sweep - 1, 3) + 1.25 * Math.pow(sweep - 1, 2) + 1));
    $("num").textContent = String(Math.round(Math.max(0, Math.min(score, shown))));
    if (t < 2700) requestAnimationFrame(tick);
    else {
      $("num").textContent = Number.isInteger(score) ? String(score) : score.toFixed(1);
      $("live").textContent = `Market score ${Math.round(score)} out of 100, zone ${zoneOf(score).name}.`;
    }
  };
  requestAnimationFrame(tick);
}

$("keyword").addEventListener("input", () => {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(async () => {
    state.keyword = $("keyword").value.trim();
    if (state.keyword.length < 2) {
      state.rows = [];
      renderRows();
      return;
    }
    const suggestion = await post("/api/microsite", { action: "subniches", keyword: state.keyword });
    state.rows = suggestion.subniches || [];
    renderRows();
    paintStepper();
  }, 250);
});

$("pay-go").addEventListener("click", runPaid);
$("pay-cancel").addEventListener("click", () => {
  state.quote = null;
  state.location = null;
  state.proposal = null;
  renderQuote(null, null);
  renderSketch(null);
  renderMap(state.cards);
  $("paid-note").textContent = "Canceled. Nothing was sent.";
  paintStepper();
});

fetch("/health").then((response) => response.json()).then((health) => {
  const live = health.live_mode ? "on" : "off";
  $("server-status").querySelector("span").textContent = health.credentials_configured
    ? `Live mode ${live}`
    : `Sample mode, live checks ${live}`;
}).catch(() => {
  $("server-status").querySelector("span").textContent = "Health check failed";
});

paintStepper();
renderQuote(null, null);
renderSketch(null);
renderResults("");
