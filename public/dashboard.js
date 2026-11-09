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
        el("div", { class: "nm" }, [
          row.label,
          estimated ? el("span", { class: "est-tag" }, ["EST."]) : ""
        ]),
        (() => {
          const track = el("div", { class: `bar${estimated ? " dashed" : ""}` });
          const span = el("span");
          span.style.width = `${score || 0}%`;
          span.style.background = estimated
            ? "repeating-linear-gradient(90deg,#fbbf24 0 7px,transparent 7px 11px)"
            : zoneColor(zone);
          track.append(span);
          return track;
        })(),
        estimated ? el("span", { class: "note" }, [row.price && row.price.pending_review ? "Pending review. This cannot turn the row green." : "Estimate. Capped below a green row."]) : ""
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

const ZONE_HEX = { No: "#f87171", Low: "#fb923c", Medium: "#fbbf24", High: "#a3e635", Max: "#34d399" };

function zoneColor(zone) {
  return zone ? ZONE_HEX[zone.name] : "#94a3b8";
}

function cityPool() {
  return [...state.cards, ...(state.nearbyCards || [])];
}

function shownCities() {
  const cities = cityPool().filter((card) => card.geography_type === "city");
  if (!state.location) return state.cards.filter((card) => card.geography_type === "city").slice(0, 5);
  const ids = state.location.nearby_ids && state.location.nearby_ids.length ? state.location.nearby_ids : [state.location.id];
  return ids
    .map((id) => cities.find((card) => card.id === id))
    .filter(Boolean)
    .sort((a, b) => b.example_relative_demand - a.example_relative_demand);
}

function renderMap() {
  const cities = shownCities();
  const wrap = $("mapwrap");
  wrap.replaceChildren();
  const map = svg("svg", { viewBox: "0 0 360 210", class: "map", role: "img", "aria-label": "Stylized map of the example cities. Not a real map." });
  svg("path", { d: "M40 60 C 90 40, 150 45, 210 52 S 310 70, 330 110 S 300 180, 230 186 S 90 190, 50 160 S 10 90, 40 60 Z", fill: "rgba(167,139,250,.05)", stroke: "#a78bfa", "stroke-opacity": ".45", "stroke-dasharray": "4 5" }, map);
  const spots = [[70, 92], [150, 104], [214, 96], [226, 150], [158, 156]];
  cities.forEach((card, index) => {
    const [x, y] = spots[index] || [40 + (index % 5) * 60, 40 + Math.floor(index / 5) * 70];
    const selected = state.location && state.location.id === card.id;
    const group = svg("g", { transform: `translate(${x} ${y})` }, map);
    svg("circle", { r: selected ? 6 : 4.5, fill: selected ? "#f4f8fc" : "#22d3ee" }, group);
    const label = svg("text", {
      x: index % 2 === 0 ? 12 : -12,
      y: index % 2 === 0 ? -12 : 18,
      "text-anchor": index % 2 === 0 ? "start" : "end",
      "font-size": selected ? 14 : 12.5,
      "font-weight": selected ? 700 : 600,
      fill: selected ? "#f1f5f9" : "#cbd5e1",
      stroke: "#07090d",
      "stroke-width": 3.5,
      "paint-order": "stroke"
    }, group);
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

function renderGauge(composite, title, note) {
  $("score-title").textContent = title;
  const score = composite && composite.status === "calculated" ? Number(composite.composite_display) : null;
  const zone = score == null ? null : zoneOf(score);
  const display = score == null ? "—" : (composite.composite_display || String(Math.round(score)));
  const G = { cx: 180, cy: 168, R: 112 };
  const point = (value, radius) => {
    const angle = Math.PI * (1 - value / 100);
    return [G.cx + radius * Math.cos(angle), G.cy - radius * Math.sin(angle)];
  };
  const arcPath = (start, end, radius) => {
    const [x1, y1] = point(start, radius);
    const [x2, y2] = point(end, radius);
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };
  const dial = svg("svg", {
    viewBox: "0 0 360 210",
    class: "dial",
    role: "img",
    "aria-label": score == null ? "No market score yet." : `Market score ${display} out of 100. Zone ${zone.name}.`
  });
  const defs = svg("defs", {}, dial);
  const filter = svg("filter", { id: "zoneglow", x: "-30%", y: "-30%", width: "160%", height: "160%" }, defs);
  svg("feGaussianBlur", { stdDeviation: "2.4", result: "blur" }, filter);
  svg("feMerge", {}, filter).append(svg("feMergeNode", { in: "blur" }), svg("feMergeNode", { in: "SourceGraphic" }));
  svg("path", { d: arcPath(0, 100, G.R), fill: "none", stroke: "#0c111a", "stroke-width": 16 }, dial);
  const glow = svg("g", { filter: "url(#zoneglow)", opacity: "0.7" }, dial);
  ZONES.forEach((item) => {
    const d = arcPath(item.from + (item.from ? 0.7 : 0.4), item.to - (item.to < 100 ? 0.7 : 0.4), G.R);
    svg("path", { d, fill: "none", stroke: `var(${item.c})`, "stroke-width": 16 }, glow);
    svg("path", { d, fill: "none", stroke: `var(${item.c})`, "stroke-width": 16 }, dial);
  });
  [0, 25, 50, 75, 100].forEach((mark) => {
    const [x, y] = point(mark, 146);
    const label = svg("text", { x: x.toFixed(1), y: (y + 4).toFixed(1), "text-anchor": "middle", fill: "#cbd5e1", "font-size": 12, "font-family": "IBM Plex Mono, monospace" }, dial);
    label.textContent = String(mark);
  });
  const needle = svg("g", { id: "needle" }, dial);
  needle.setAttribute("transform", `rotate(-90 ${G.cx} ${G.cy})`);
  svg("path", { d: `M${G.cx - 3} ${G.cy} L${G.cx} ${G.cy - 96} L${G.cx + 3} ${G.cy} Z`, fill: "#f8fafc" }, needle);
  svg("circle", { cx: G.cx, cy: G.cy, r: 11, fill: "#041016", stroke: "#22d3ee", "stroke-width": 3 }, dial);
  svg("circle", { cx: G.cx, cy: G.cy, r: 4, fill: "#22d3ee" }, dial);
  $("dialwrap").replaceChildren(dial);
  document.querySelectorAll("#zone-legend li").forEach((item) => {
    item.classList.toggle("on", zone && item.dataset.zone === zone.name);
  });
  $("num").style.opacity = "1";
  $("num").textContent = display;
  $("chipwrap").replaceChildren(zone ? el("span", { class: "chip", style: `color:${zoneColor(zone)}` }, [zone.name]) : "");
  $("verdict").textContent = zone ? zone.line : "The score appears after you pick a city.";
  $("demand-note").textContent = note || "";
  const factors = composite && composite.demand ? [
    ["Demand", composite.demand.index, "40%", "--cyan", composite.demand.contribution_display],
    ["Competition", composite.competition.index, "30%", "--violet", composite.competition.contribution_display],
    ["Margin", composite.margin.index, "30%", "--pink", composite.margin.contribution_display]
  ] : [];
  const board = $("bd");
  board.replaceChildren();
  factors.forEach(([name, value, weight, color, points]) => {
    board.append(el("div", { class: "bd-row" }, [
      el("div", { class: "bd-top" }, [
        el("span", { class: "n" }, [name]),
        el("span", { class: "w" }, [`× ${weight}`]),
        el("span", { class: "p num" }, [points == null ? "—" : `${points} pts`])
      ]),
      (() => {
          const track = el("span", { class: "track" });
          const span = el("span");
          span.style.width = `${value == null ? 0 : value}%`;
          span.style.background = `var(${color})`;
          track.append(span);
          return track;
        })()
    ]));
  });
  if (composite && composite.composite_display) {
    board.append(el("div", { class: "bd-row tot" }, [
      el("div", { class: "bd-top" }, [
        el("span", { class: "n" }, ["Total"]),
        el("span", { class: "p num" }, [composite.composite_display])
      ])
    ]));
  }
  if (score != null) playReveal(score, display);
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
  state.nearbyCards = shortlist.nearby_cards || [];
  state.location = null;
  renderMap();
  paintStepper();
}

async function chooseLocation(card) {
  if (card.geography_type !== "city") return;
  state.location = card;
  renderMap();
  state.proposal = await post("/api/microsite", {
    action: "proposal",
    keyword: state.keyword,
    subniche_id: state.subniche.id,
    location_id: card.id
  });
  renderGauge(
    state.proposal.composite,
    `${state.proposal.subniche.label} in ${card.name}, ${card.state}`,
    state.proposal.deep_check_gate && state.proposal.deep_check_gate.demand_basis_note
  );
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

function easeOutQuad(progress) {
  return 1 - (1 - progress) ** 2;
}

function playReveal(score, display) {
  const needle = document.getElementById("needle");
  const number = $("num");
  number.style.opacity = "1";
  const target = -90 + score * 1.8;
  const hub = "180 168";
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!needle || reduce) {
    if (needle) needle.setAttribute("transform", `rotate(${target} ${hub})`);
    number.textContent = display;
    $("live").textContent = `Market score ${display} out of 100, zone ${zoneOf(score).name}.`;
    return;
  }
  const overshoot = target + 3.5;
  const started = performance.now();
  const tick = (now) => {
    const t = (now - started) / 1000;
    let angle = target;
    if (t < 0.75) angle = -90 + (overshoot + 90) * easeOutQuad(t / 0.75);
    else if (t < 1.05) angle = overshoot + (target - overshoot) * easeOutQuad((t - 0.75) / 0.3);
    needle.setAttribute("transform", `rotate(${angle} ${hub})`);
    const counted = score * easeOutQuad(Math.min(1, t / 1));
    number.textContent = t >= 1 ? display : counted.toFixed(1);
    number.style.opacity = "1";
    if (t < 1.05) requestAnimationFrame(tick);
    else {
      needle.setAttribute("transform", `rotate(${target} ${hub})`);
      number.textContent = display;
      $("live").textContent = `Market score ${display} out of 100, zone ${zoneOf(score).name}.`;
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
  renderMap();
  $("paid-note").textContent = "Canceled. Nothing was sent.";
  paintStepper();
});

fetch("/health").then((response) => response.json()).then((health) => {
  const on = Boolean(health.live_mode);
  $("server-status").classList.toggle("on", on);
  $("server-status").querySelector("span").textContent = on ? "LIVE MODE ON" : "LIVE MODE OFF";
}).catch(() => {
  $("server-status").querySelector("span").textContent = "LIVE MODE OFF";
});

paintStepper();
renderQuote(null, null);
renderSketch(null);
renderResults("");
