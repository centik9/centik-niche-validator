const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";

function el(tag, attrs = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "style") node.style.cssText = value;
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

function quoteMoney(amount) {
  return `$${Number(amount).toFixed(3)}`;
}

function formatCapturedDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric"
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month");
  const day = parts.find((part) => part.type === "day");
  const year = parts.find((part) => part.type === "year");
  if (!month || !day || !year) return "";
  return `${month.value} ${day.value}, ${year.value}`;
}

function formatDataStamp(iso, mapsDepth) {
  const date = formatCapturedDate(iso);
  if (!date) return "";
  const depth = Number(mapsDepth);
  if (Number.isInteger(depth) && depth > 0) return `Data from ${date} · ${depth} listings`;
  return `Data from ${date}`;
}

function stampDepth(report) {
  if (!report) return null;
  if (Number.isInteger(report.maps_depth)) return report.maps_depth;
  if (report.maps && Number.isInteger(report.maps.requested_depth)) return report.maps.requested_depth;
  return null;
}

function metricText(metric) {
  if (!metric || metric.status === "missing" || metric.status === "unsupported" || metric.status === "unusable" || metric.status === "not_requested" || metric.value == null) {
    return metric && metric.status === "failed" ? "Failed" : "Insufficient data";
  }
  if (metric.status === "failed") return "Failed";
  if (metric.status === "measured_zero") return "0 (measured)";
  if (metric.status === "partial") return `${metric.value} (partial)`;
  return String(metric.value);
}

function moneyText(metric) {
  if (!metric || metric.value == null || metric.status === "missing" || metric.status === "failed" || metric.status === "unusable" || metric.status === "unsupported") {
    return "Insufficient data";
  }
  if (metric.status === "measured_zero") return "$0.00 (measured)";
  return money(metric.value);
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
  storedReport: null,
  rerunArmed: false,
  busy: false,
  mapRegion: null,
  specialtyQuote: null,
  lens: "classroom",
  lensReport: null,
  runs: []
};

let suggestTimer = 0;
let specialtyRequest = 0;
let liveMode = false;

function resetSpecialtyConfirm() {
  state.specialtyQuote = null;
  const find = $("find-specialties");
  const cancel = $("find-cancel");
  if (find) {
    find.textContent = "Find specialties";
    find.disabled = state.keyword.length < 2;
  }
  if (cancel) cancel.hidden = true;
}

function applySubniches(suggestion) {
  resetSpecialtyConfirm();
  state.rows = suggestion.subniches || [];
  $("lb-help").textContent = suggestion.ranking_note || "";
  const pill = $("svc-pill");
  if (pill) {
    pill.textContent = suggestion.example_data === false ? (suggestion.cache_hit ? "Saved US search" : "Live US search") : "Sample data";
    pill.classList.toggle("cached", suggestion.cache_hit === true);
  }
  renderRows();
  paintStepper();
}

async function loadExampleSubniches() {
  const requestId = ++specialtyRequest;
  const keyword = state.keyword;
  try {
    const suggestion = await post("/api/microsite", { action: "subniches", keyword });
    if (requestId !== specialtyRequest || liveMode) return;
    applySubniches(suggestion);
  } catch (error) {
    if (requestId !== specialtyRequest || liveMode) return;
    state.rows = [];
    renderRows();
    $("lb-help").textContent = error.message || "Example suggestions could not be loaded.";
  }
}

async function requestSpecialties(confirming) {
  if (!liveMode || state.busy || state.keyword.length < 2) return;
  const requestId = ++specialtyRequest;
  const keyword = state.keyword;
  state.busy = true;
  $("find-specialties").disabled = true;
  try {
    const payload = { action: "subniches", keyword };
    if (confirming && state.specialtyQuote && state.specialtyQuote.keyword === keyword) {
      payload.spend_token = state.specialtyQuote.spend_token;
    }
    const suggestion = await post("/api/microsite", payload);
    if (requestId !== specialtyRequest) return;
    if (suggestion.needs_confirmation) {
      state.specialtyQuote = {
        keyword,
        spend_token: suggestion.spend_token,
        estimated_cost_usd: suggestion.estimated_cost_usd
      };
      state.rows = [];
      renderRows();
      $("find-specialties").textContent = `Okay, look up specialties (${quoteMoney(suggestion.estimated_cost_usd)})`;
      $("find-cancel").hidden = false;
      $("lb-help").textContent = suggestion.ranking_note;
      return;
    }
    applySubniches(suggestion);
  } catch (error) {
    if (requestId !== specialtyRequest) return;
    state.rows = [];
    state.specialtyQuote = null;
    renderRows();
    $("find-specialties").textContent = "Find specialties";
    $("find-cancel").hidden = true;
    $("lb-help").textContent = error.message || "The specialty lookup failed. Example trades were not substituted.";
  } finally {
    state.busy = false;
    if ($("find-specialties")) $("find-specialties").disabled = state.keyword.length < 2;
  }
}

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
    ["4. Check", state.lensReport && state.lensReport.hard_stop ? "Hard stop" : state.rerunArmed ? "Confirm the charge" : state.storedReport ? "Saved result" : state.quote ? "Waiting for your okay" : "Type a service"]
  ];
  const current = state.quote || state.storedReport ? 3 : state.proposal ? 2 : state.cards.length ? 1 : 0;
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
  const maxVolume = state.rows.reduce((max, row) => (
    Number.isInteger(row.search_volume) ? Math.max(max, row.search_volume) : max
  ), 0);
  state.rows.forEach((row, index) => {
    const liveVolume = Number.isInteger(row.search_volume);
    const score = !liveVolume && row.composite && row.composite.composite_display ? Number(row.composite.composite_display) : null;
    const zone = score == null ? null : zoneOf(score);
    const estimated = Boolean(row.composite && (row.composite.estimated || row.composite.pending_review || (row.price && row.price.pending_review)));
    const item = el("li", { class: state.subniche && state.subniche.id === row.id ? "sel" : "" });
    const width = liveVolume
      ? Math.max(4, Math.round((row.search_volume / Math.max(maxVolume, 1)) * 100))
      : (score || 0);
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
          span.style.width = `${width}%`;
          span.style.background = liveVolume
            ? "#22d3ee"
            : estimated
              ? "repeating-linear-gradient(90deg,#fbbf24 0 7px,transparent 7px 11px)"
              : zoneColor(zone);
          track.append(span);
          return track;
        })(),
        liveVolume && row.note
          ? el("span", { class: "note" }, [row.note])
          : estimated
            ? el("span", { class: "note" }, [row.price && row.price.pending_review ? "Pending review. This cannot turn the row green." : "Estimate. Capped below a green row."])
            : ""
      ]),
      el("div", {}, [
        el("span", { class: "sc num" }, [liveVolume ? row.search_volume.toLocaleString("en-US") : (score == null ? "-" : String(Math.round(score)))]),
        el("span", { class: "zn" }, [liveVolume ? "US searches/mo" : (zone ? zone.name : "Not scored")])
      ])
    );
    item.addEventListener("click", () => chooseSubniche(row));
    list.append(item);
  });
}

const ZONE_HEX = { No: "#ff6b6b", Low: "#ffa94d", Medium: "#ffd166", High: "#a3e635", Max: "#34d399" };

function zoneColor(zone) {
  return zone ? ZONE_HEX[zone.name] : "#94a3b8";
}

function cityPool() {
  return [...state.cards, ...(state.nearbyCards || [])];
}

// ---- Step 2 map: United States heat map with click-to-zoom regions. ----
// Shapes come from /us-heat-map.js (us-atlas + Census boundaries). Heat is
// sample demand: server example_relative_demand for cities the example set can
// score, and a fixture base tilted by the niche for heat-only areas.
const USMAP = window.US_HEAT_MAP || null;
const HEAT = [
  { min: 75, cls: 4, color: "#ff4d4f", word: "Hottest" },
  { min: 60, cls: 3, color: "#ff9f43", word: "Hot" },
  { min: 45, cls: 2, color: "#ffd43b", word: "Warm" },
  { min: -1, cls: 1, color: "#7b8494", word: "Coldest" }
];
const heatOf = (value) => HEAT.find((band) => Number(value) >= band.min);

function hashTilt(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 25) - 12;
}

function serverCard(id) {
  return id ? cityPool().find((card) => card.id === id && card.geography_type === "city") : null;
}

function cityHeat(region, city) {
  const card = serverCard(city.id);
  if (card) return card.example_relative_demand;
  const base = city.base != null ? city.base : region.base;
  if (!state.subniche) return base;
  return Math.max(8, Math.min(96, base + hashTilt(`${state.subniche.id}|${region.id}|${city.name}`)));
}

function regionHeat(region) {
  const values = region.cities.map((city) => serverCard(city.id) ? serverCard(city.id).example_relative_demand : null).filter((v) => v != null);
  if (values.length) return Math.max(...values);
  if (!state.subniche) return region.base;
  return Math.max(8, Math.min(96, region.base + hashTilt(`${state.subniche.id}|${region.id}`)));
}

function regionForCity(id) {
  if (!USMAP || !id) return null;
  return Object.values(USMAP.regions).find((region) => region.cities.some((city) => city.id === id)) || null;
}

function heatDefs(map) {
  const defs = svg("defs", {}, map);
  const glow = svg("filter", { id: "heatglow", x: "-80%", y: "-80%", width: "260%", height: "260%" }, defs);
  svg("feGaussianBlur", { stdDeviation: "3", result: "b" }, glow);
  svg("feMerge", {}, glow).append(svg("feMergeNode", { in: "b" }), svg("feMergeNode", { in: "SourceGraphic" }));
  const soft = svg("filter", { id: "heatsoft", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
  svg("feGaussianBlur", { stdDeviation: "8" }, soft);
  HEAT.forEach((band) => {
    const grad = svg("radialGradient", { id: `heatarea${band.cls}` }, defs);
    svg("stop", { offset: "0%", "stop-color": band.color, "stop-opacity": "0.7" }, grad);
    svg("stop", { offset: "55%", "stop-color": band.color, "stop-opacity": "0.28" }, grad);
    svg("stop", { offset: "100%", "stop-color": band.color, "stop-opacity": "0" }, grad);
  });
}

function haloText(parent, attrs, text) {
  const node = svg("text", Object.assign({
    fill: "#eef2f7", stroke: "#06080c", "stroke-width": 4, "stroke-linejoin": "round",
    "paint-order": "stroke", "font-family": "IBM Plex Sans, system-ui, sans-serif"
  }, attrs), parent);
  node.textContent = text;
  return node;
}

// Pick a label side so nearby labels do not stack on each other.
function labelSpot(placed, x, y) {
  const clash = (lx, ly) => placed.some((p) => Math.abs(p[0] - lx) < 130 && Math.abs(p[1] - ly) < 30);
  const options = [[x + 14, y - 12, "start"], [x - 14, y - 12, "end"], [x + 14, y + 26, "start"], [x - 14, y + 26, "end"]];
  const pick = options.find(([lx, ly, anchor]) => !clash(anchor === "end" ? lx - 110 : lx, ly)) || options[0];
  placed.push([pick[2] === "end" ? pick[0] - 110 : pick[0], pick[1]]);
  return pick;
}

function activate(node, fn) {
  node.addEventListener("click", fn);
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); fn(); }
  });
}

function nicheLabel() {
  return state.subniche ? state.subniche.label : "";
}

function renderMapBar() {
  const bar = $("map-bar");
  bar.replaceChildren();
  const region = state.mapRegion && USMAP ? USMAP.regions[state.mapRegion] : null;
  if (region) {
    const back = el("button", { class: "map-back", type: "button" }, ["← United States"]);
    back.addEventListener("click", () => { state.mapRegion = null; renderMap(); });
    bar.append(back, el("span", {}, [
      el("span", { class: "where" }, [`${region.title}, ${region.state}`]),
      el("span", { class: "sub" }, [` · ${nicheLabel() || "pick a sub-niche"} · city and county heat`])
    ]));
  } else {
    bar.append(el("span", {}, [
      el("span", { class: "where" }, ["United States"]),
      el("span", { class: "sub" }, [nicheLabel() ? ` · where ${nicheLabel().toLowerCase()} sample demand runs hottest` : " · pick a sub-niche to see its heat"])
    ]));
  }
}

function zoomTo(regionId) {
  const region = USMAP && USMAP.regions[regionId];
  if (!region) return;
  const map = $("mapwrap").querySelector("svg.map");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!map || reduce || state.mapRegion) {
    state.mapRegion = regionId;
    renderMap();
    return;
  }
  const [cx, cy] = region.national;
  const to = [cx - 60, cy - 37.5, 120, 75];
  const from = [0, 0, 960, 600];
  const started = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - started) / 380);
    const e = 1 - (1 - t) ** 3;
    map.setAttribute("viewBox", from.map((v, i) => (v + (to[i] - v) * e).toFixed(1)).join(" "));
    if (t < 1) requestAnimationFrame(step);
    else { state.mapRegion = regionId; renderMap(); }
  };
  requestAnimationFrame(step);
}

function renderNational(wrap) {
  const map = svg("svg", { viewBox: "0 0 960 600", class: "map", role: "group", "aria-label": `United States heat map with Alaska, Hawaii, and Puerto Rico shown up top. ${nicheLabel() ? `Sample demand for ${nicheLabel()}.` : "Pick a sub-niche to see its heat."} Stylized, not a street map.` });
  heatDefs(map);
  const base = svg("g", {}, map);
  USMAP.national.states.forEach((st) => {
    const p = svg("path", { d: st.d, fill: "#141b26", stroke: "rgba(255,255,255,.16)", "stroke-width": ".7" }, base);
    svg("title", {}, p).textContent = st.name;
  });
  USMAP.national.insets.forEach((box) => {
    svg("rect", { x: box.x, y: box.y, width: box.w, height: box.h, rx: 8, fill: "none", stroke: "rgba(255,255,255,.12)", "stroke-dasharray": "3 4" }, map);
    haloText(map, { x: box.x + 6, y: box.y + box.h - 6, "font-size": 11, fill: "#8c98ab", "stroke-width": 3 }, box.label);
  });
  const regions = Object.values(USMAP.regions).map((region) => ({ region, heat: regionHeat(region) }))
    .sort((a, b) => a.heat - b.heat);
  const areas = svg("g", { "pointer-events": "none" }, map);
  const dots = svg("g", {}, map);
  const labels = svg("g", { "pointer-events": "none" }, map);
  const top = new Set(regions.slice(-6).map((item) => item.region.id));
  const selRegion = state.location ? regionForCity(state.location.id) : null;
  const placedN = [];
  regions.slice().reverse().forEach(({ region, heat }) => {
    const band = heatOf(heat);
    const [x, y] = region.national;
    const active = Boolean(state.subniche);
    const r = active ? 10 + heat / 3.2 : 12;
    svg("circle", { cx: x, cy: y, r, fill: `url(#heatarea${active ? band.cls : 1})` }, areas);
    const hit = svg("g", { class: "hit", tabindex: "0", role: "button", "aria-label": `${region.title}, ${region.state}. ${active ? `${band.word} sample demand, ${heat}.` : "No niche picked yet."} Zoom in.` }, dots);
    svg("circle", { cx: x, cy: y, r: 14, fill: "transparent" }, hit);
    svg("circle", { class: "ring", cx: x, cy: y, r: 7, fill: "none", stroke: active ? band.color : "#7b8494", "stroke-opacity": ".55", "stroke-width": 1.5 }, hit);
    svg("circle", { cx: x, cy: y, r: active ? 4 : 3, fill: active ? band.color : "#7b8494", filter: "url(#heatglow)" }, hit);
    svg("title", {}, hit).textContent = `${region.title}, ${region.state}${active ? ` · sample heat ${heat}` : ""} · click to zoom`;
    activate(hit, () => zoomTo(region.id));
    if ((active && top.has(region.id)) || (selRegion && selRegion.id === region.id)) {
      const [lx, ly, anchor] = labelSpot(placedN, x, y);
      haloText(labels, { x: lx, y: ly + 4, "text-anchor": anchor, "font-size": 13, "font-weight": 650 }, region.title);
    }
  });
  wrap.append(map);
  const list = $("locs");
  list.replaceChildren();
  if (!state.subniche) {
    list.append(el("li", { class: "off" }, [el("span", {}, ["Pick a sub-niche in Step 1. The map then heats up where its sample demand runs hottest."])]));
    return;
  }
  regions.slice().reverse().slice(0, 6).forEach(({ region, heat }, index) => {
    const band = heatOf(heat);
    const item = el("li", { tabindex: "0" }, [
      el("b", {}, [el("i", { class: `hd h${band.cls}` }), `${index + 1}. ${region.title}, ${region.state}`, region.scored ? "" : el("span", { class: "tag" }, ["Heat only"])]),
      el("span", { class: "d num" }, [String(heat)]),
      el("small", {}, [`${band.word} sample demand. Click to zoom in.`])
    ]);
    activate(item, () => zoomTo(region.id));
    list.append(item);
  });
}

function renderRegion(wrap, region) {
  const map = svg("svg", { viewBox: "0 0 960 600", class: "map", role: "group", "aria-label": `${region.title}, ${region.state}. City and county sample heat for ${nicheLabel() || "no niche yet"}. Stylized, not a street map.` });
  heatDefs(map);
  const cities = region.cities.map((city) => ({ city, heat: cityHeat(region, city), card: serverCard(city.id) }));
  const heatByName = new Map(cities.map((item) => [item.city.name, item.heat]));
  const counties = svg("g", {}, map);
  region.counties.forEach((county) => {
    const hot = county.cities.map((name) => heatByName.get(name)).filter((v) => v != null);
    const band = hot.length ? heatOf(Math.max(...hot)) : null;
    const p = svg("path", { d: county.d, fill: band ? band.color : "#141b26", "fill-opacity": band ? ".12" : "1", stroke: "rgba(255,255,255,.18)", "stroke-width": "1" }, counties);
    svg("title", {}, p).textContent = `${county.name} County${band ? ` · ${band.word.toLowerCase()} sample heat` : ""}`;
  });
  if (region.stateLines) svg("path", { d: region.stateLines, fill: "none", stroke: "rgba(255,255,255,.4)", "stroke-width": "1.6", "stroke-dasharray": "6 4" }, map);
  const places = svg("g", {}, map);
  const placeLabels = [];
  region.places.filter((place) => !place.city).forEach((place) => {
    const p = svg("path", { d: place.d, fill: "rgba(255,255,255,.03)", stroke: "rgba(255,255,255,.12)", "stroke-width": ".8" }, places);
    svg("title", {}, p).textContent = `${place.name} · no sample heat`;
    if (place.big && place.cx > 40 && place.cx < 920 && place.cy > 30 && place.cy < 580) placeLabels.push(place);
  });
  const areas = svg("g", {}, map);
  const pins = svg("g", {}, map);
  const labels = svg("g", { "pointer-events": "none" }, map);
  region.counties.forEach((county) => {
    if (county.cx > 30 && county.cx < 930 && county.cy > 30 && county.cy < 570) {
      haloText(labels, { x: county.cx, y: county.cy, "text-anchor": "middle", "font-size": 12, fill: "#8c98ab", "stroke-width": 3 }, `${county.name} Co.`);
    }
  });
  const placed = cities.map(({ city }) => [city.x - 10, city.y]);
  const spots = new Map();
  cities.slice().sort((a, b) => b.heat - a.heat).forEach(({ city }) => {
    const others = placed.filter((p) => p[0] !== city.x - 10 || p[1] !== city.y);
    spots.set(city.name, labelSpot(others, city.x, city.y));
    placed.push(...others.slice(-1));
  });
  cities.slice().sort((a, b) => a.heat - b.heat).forEach(({ city, heat, card }) => {
    const band = heatOf(heat);
    const selected = state.location && state.location.id === city.id;
    region.places.filter((place) => place.city === city.name).forEach((place) => {
      const area = svg("path", { d: place.d, fill: band.color, "fill-opacity": selected ? ".6" : ".42", stroke: selected ? "#ffffff" : band.color, "stroke-width": selected ? "2" : "1.4", filter: "url(#heatglow)", class: card ? "hit" : "" }, areas);
      svg("title", {}, area).textContent = `${city.name} · sample heat ${heat}${card ? " · click to select" : ""}`;
      if (card) area.addEventListener("click", () => chooseLocation(card));
    });
    svg("circle", { cx: city.x, cy: city.y, r: 26 + heat / 4, fill: `url(#heatarea${band.cls})`, "pointer-events": "none" }, areas);
    const hit = svg("g", { class: card ? "hit" : "", tabindex: card ? "0" : "-1", role: card ? "button" : "img", "aria-label": `${city.name}. ${band.word} sample demand, ${heat}.${card ? (selected ? " Selected." : " Select this city.") : " Heat only, not in the example scoring set."}` }, pins);
    svg("circle", { cx: city.x, cy: city.y, r: 20, fill: "transparent" }, hit);
    svg("circle", { class: "ring", cx: city.x, cy: city.y, r: selected ? 13 : 10, fill: "none", stroke: selected ? "#ffffff" : band.color, "stroke-opacity": selected ? "1" : ".6", "stroke-width": selected ? 2.5 : 1.5 }, hit);
    svg("circle", { cx: city.x, cy: city.y, r: selected ? 7 : 6, fill: band.color, filter: "url(#heatglow)" }, hit);
    svg("title", {}, hit).textContent = `${city.name} · sample heat ${heat}${card ? " · click to select" : " · heat only"}`;
    if (card) activate(hit, () => chooseLocation(card));
    const [lx, ly, anchor] = spots.get(city.name) || [city.x + 14, city.y - 12, "start"];
    haloText(labels, { x: lx, y: ly, "text-anchor": anchor, "font-size": selected ? 19 : 17, "font-weight": selected ? 750 : 650 }, city.name);
    haloText(labels, { x: lx, y: ly + 18, "text-anchor": anchor, "font-size": 13, fill: band.color, "font-weight": 650, "stroke-width": 3.5 }, `${heat} · ${band.word.toLowerCase()}`);
  });
  placeLabels.forEach((place) => {
    haloText(labels, { x: place.cx, y: place.cy, "text-anchor": "middle", "font-size": 11, fill: "#8c98ab", "stroke-width": 3 }, place.name);
  });
  wrap.append(map);
  const list = $("locs");
  list.replaceChildren();
  cities.slice().sort((a, b) => b.heat - a.heat).forEach(({ city, heat, card }, index) => {
    const band = heatOf(heat);
    const selected = state.location && state.location.id === city.id;
    const item = el("li", { class: `${selected ? "sel" : ""}${card ? "" : " off"}`, tabindex: card ? "0" : "-1" }, [
      el("b", {}, [el("i", { class: `hd h${band.cls}` }), `${index + 1}. ${city.name}`, card ? "" : el("span", { class: "tag" }, ["Heat only"])]),
      el("span", { class: "d num" }, [String(heat)]),
      el("small", {}, [card
        ? `${band.word} sample demand. ${selected ? "Selected for Step 3." : "Click to pick this city."}`
        : `${band.word} sample heat. Not in the example scoring set, so no score.`])
    ]);
    if (card) activate(item, () => chooseLocation(card));
    list.append(item);
  });
  if (!state.subniche) list.prepend(el("li", { class: "off" }, [el("span", {}, ["Pick a sub-niche in Step 1 to score a city here."])]));
}

function renderMap() {
  const wrap = $("mapwrap");
  wrap.replaceChildren();
  renderMapBar();
  if (!USMAP) {
    wrap.append(el("p", { class: "help" }, ["The map file did not load. Refresh the page."]));
    return;
  }
  const region = state.mapRegion ? USMAP.regions[state.mapRegion] : null;
  if (region) renderRegion(wrap, region);
  else renderNational(wrap);
  $("map-cap").textContent = region
    ? "Stylized city and county heat map. Heat is sample demand, not a live street map. Click a city to pick it."
    : "Stylized United States heat map. Heat is sample demand, not a live street map. Click a hot area to zoom in.";
}

function renderGauge(composite, title, note) {
  $("score-title").textContent = title;
  const insufficient = Boolean(composite && composite.status === "insufficient_data");
  const score = composite && composite.status === "calculated" ? Number(composite.composite_display) : null;
  const zone = score == null ? null : zoneOf(score);
  const display = insufficient ? "Insufficient data" : (score == null ? "-" : (composite.composite_display || String(Math.round(score))));
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
    "aria-label": insufficient
      ? "Insufficient data. Demand was not measured, so there is no market score. Missing data is not a score of 0."
      : (score == null ? "No market score yet." : `Market score ${display} out of 100. Zone ${zone.name}.`)
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
  if (!insufficient) svg("path", { d: `M${G.cx - 3} ${G.cy} L${G.cx} ${G.cy - 96} L${G.cx + 3} ${G.cy} Z`, fill: "#f8fafc" }, needle);
  svg("circle", { cx: G.cx, cy: G.cy, r: 11, fill: "#041016", stroke: "#22d3ee", "stroke-width": 3 }, dial);
  svg("circle", { cx: G.cx, cy: G.cy, r: 4, fill: "#22d3ee" }, dial);
  $("dialwrap").replaceChildren(dial);
  document.querySelectorAll("#zone-legend li").forEach((item) => {
    item.classList.toggle("on", zone && item.dataset.zone === zone.name);
  });
  $("num").style.opacity = "1";
  $("num").textContent = insufficient ? "-" : display;
  $("chipwrap").replaceChildren(insufficient
    ? el("span", { class: "chip" }, ["Insufficient data"])
    : (zone ? el("span", { class: "chip", style: `color:${zoneColor(zone)}` }, [zone.name]) : ""));
  const capNote = composite && composite.grade_cap && composite.grade_cap.applied ? composite.grade_cap.note : "";
  $("verdict").textContent = insufficient
    ? "Search demand was not returned. This is not a score of 0."
    : (zone ? zone.line : "The score appears after you pick a city.");
  $("demand-note").textContent = [note || "", capNote].filter(Boolean).join(" ");
  const factors = composite && composite.demand && !insufficient ? [
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
        el("span", { class: "p num" }, [points == null ? "-" : `${points} pts`])
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

/* lead-conversion-rates-start */
const LeadConversion = (() => {
// Lead conversion rates for the Niche Validator estimates box (Phase 1).
// Seeded LocaliQ / WordStream 2025 figures are median ad click-to-lead CVRs.
// They are applied when a niche maps cleanly, and the UI must say so.
// They are not search-to-lead rates. Do not treat unmapped niches as 38-52 of 2,900.
//
// Phase 2 (deferred): on-demand research for niches with no studied rate.
// Do not invent a ballpark here.
// Phase 3 (deferred): usage-triggered refresh about once a month
// (REFRESH_INTERVAL_DAYS = 30) when a user opens the tool and the estimates
// box resolves that niche. No background timers, cron, intervals, or idle jobs.

const LOCALIQ_BLOG_URL = "https://localiq.com/blog/home-services-search-advertising-benchmarks/";
const LOCALIQ_PDF_URL = "https://www.wordstream.com/wp-content/uploads/2025/06/ws-guide-home-services-benchmarks-2025.pdf";
const LOCALIQ_YEAR = 2025;
const LOCALIQ_COVERAGE = "3,211 US campaigns, Apr 1 2024-Mar 21 2025";

// Documented historical reference from the estimates mock. Phase 1 does not
// apply this to any niche. Unmapped niches show a looking-up state instead.
const DEFAULT_LEAD_CONVERSION = {
  low: 38 / 2900,
  mid: 45 / 2900,
  high: 52 / 2900,
  status: "default",
  source: "Validator estimates reference: 38 to 52 leads from 2,900 monthly searches.",
  notes: "Phase 1 does not apply this default. Niches without a studied rate show a looking-up state instead of inventing a number."
};

const LOCALIQ_NOTE = "LocaliQ / WordStream 2025 Home Services Search Ads Benchmarks median click-to-lead CVR (share of ad clicks that become a lead or sale), not search-volume-to-lead. " + LOCALIQ_COVERAGE + ". Cite the LocaliQ blog table.";

const PLUMBING_SUBNICHE_IDS = [
  "emergency-plumbing",
  "drain-cleaning",
  "water-heater-repair",
  "leak-detection",
  "toilet-repair",
  "faucet-repair",
  "sewer-line",
  "garbage-disposal",
  "pipe-repair",
  "sump-pump",
  "bath-remodel-plumbing",
  "kitchen-sink",
  "water-filtration",
  "gas-line",
  "hydro-jetting",
  "repipe",
  "hose-bib",
  "water-softener",
  "backflow",
  "tankless-water-heater"
];

const PLUMBING_ALIASES = [
  "plumbing",
  ...PLUMBING_SUBNICHE_IDS,
  "emergency plumbing",
  "drain cleaning",
  "water heater repair",
  "leak detection",
  "toilet repair",
  "faucet and fixture repair",
  "faucet repair",
  "sewer line service",
  "sewer line",
  "garbage disposal service",
  "garbage disposal",
  "pipe repair",
  "sump pump service",
  "sump pump",
  "bathroom remodel plumbing",
  "bath remodel plumbing",
  "kitchen sink service",
  "kitchen sink",
  "water filtration install",
  "water filtration",
  "gas line plumbing",
  "gas line",
  "hydro jetting",
  "repipe consultation",
  "repipe",
  "outdoor faucet service",
  "hose bib",
  "water softener service",
  "water softener",
  "backflow testing",
  "backflow",
  "tankless water heater service",
  "tankless water heater"
];

function localiqRow({
  id,
  category_label,
  cvr_percent,
  aliases = [],
  applied = true,
  notes = LOCALIQ_NOTE
}) {
  return {
    id,
    category_label,
    aliases,
    metric_type: "click_to_lead",
    cvr_percent,
    low: cvr_percent / 100,
    mid: cvr_percent / 100,
    high: cvr_percent / 100,
    source: LOCALIQ_BLOG_URL,
    source_pdf: LOCALIQ_PDF_URL,
    year: LOCALIQ_YEAR,
    applied,
    notes
  };
}

const RESEARCHED_RATES = [
  localiqRow({
    id: "plumbing",
    category_label: "plumbing",
    cvr_percent: 7.63,
    aliases: PLUMBING_ALIASES,
    notes: LOCALIQ_NOTE + " Plumbing 7.63% is on the LocaliQ blog table. The PDF body only printed category highs and lows, not this mid-table value."
  }),
  localiqRow({
    id: "hvac",
    category_label: "HVAC",
    cvr_percent: 7.02,
    aliases: [
      "hvac",
      "hvac repair",
      "heating",
      "heating and furnaces",
      "furnace",
      "furnaces",
      "ac",
      "air conditioning",
      "air conditioning installation and repair",
      "heat pump"
    ],
    notes: LOCALIQ_NOTE + " Mixed HVAC uses the midpoint of Air Conditioning Installation & Repair 6.56% and Heating & Furnaces 7.48%, which is 7.02%."
  }),
  localiqRow({
    id: "electrician",
    category_label: "electricians",
    cvr_percent: 9.08,
    aliases: [
      "electrician",
      "electricians",
      "electrical",
      "electricians and electrical contractors",
      "electrical contractors"
    ]
  }),
  localiqRow({
    id: "cleaning",
    category_label: "cleaning",
    cvr_percent: 17.65,
    aliases: [
      "cleaning",
      "maid",
      "butler",
      "house cleaning",
      "maid service",
      "cleaning maid butler services"
    ]
  }),
  localiqRow({
    id: "roofing",
    category_label: "roofing",
    cvr_percent: 3.70,
    aliases: ["roofing", "roof", "gutters", "roofing and gutters", "gutter"]
  }),
  localiqRow({
    id: "handyman",
    category_label: "handyman services",
    cvr_percent: 13.45,
    aliases: ["handyman", "handyman services"]
  }),
  localiqRow({
    id: "painting",
    category_label: "painting",
    cvr_percent: 10.80,
    aliases: ["painting", "paint", "painter", "paint and painting"]
  }),
  localiqRow({
    id: "landscaping",
    category_label: "landscaping",
    cvr_percent: 6.42,
    aliases: ["landscaping", "landscape", "landscaper"]
  }),
  localiqRow({
    id: "window-cleaning",
    category_label: "window cleaning",
    cvr_percent: 13.58,
    aliases: ["window-cleaning", "window cleaning"]
  }),
  localiqRow({
    id: "pools",
    category_label: "pools and spas",
    cvr_percent: 10.89,
    aliases: ["pools", "spas", "pool", "spa", "pools and spas"]
  }),
  localiqRow({
    id: "doors-windows",
    category_label: "doors and windows",
    cvr_percent: 4.41,
    aliases: ["doors-windows", "doors and windows", "doors and windows sales", "window sales", "door sales"]
  }),
  localiqRow({
    id: "construction",
    category_label: "construction",
    cvr_percent: 2.61,
    aliases: [
      "construction",
      "contractor",
      "general contractor",
      "construction and contractors",
      "construction and contractors general"
    ]
  }),
  localiqRow({
    id: "blinds",
    category_label: "blinds and window treatments",
    cvr_percent: 6.00,
    aliases: ["blinds", "window treatments", "blinds and window treatments"]
  }),
  localiqRow({
    id: "storage",
    category_label: "storage",
    cvr_percent: 4.65,
    aliases: ["storage"]
  }),
  // Stored for documentation only. Do not map LocaliQ "Garages" 5.66% to garage-door repair.
  localiqRow({
    id: "garages",
    category_label: "garages",
    cvr_percent: 5.66,
    aliases: ["garages"],
    applied: false,
    notes: LOCALIQ_NOTE + " Not applied. Do not map this category to garage-door repair."
  }),
  localiqRow({
    id: "home-services-average",
    category_label: "home services",
    cvr_percent: 7.33,
    aliases: [],
    applied: false,
    notes: LOCALIQ_NOTE + " Home services average or median 7.33%. Not applied as a catch-all for unknown niches."
  })
];

function normalizeNicheKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rowKeys(row) {
  return new Set(
    [row.id, row.category_label, ...(row.aliases || [])]
      .map(normalizeNicheKey)
      .filter(Boolean)
  );
}

function findResearchedRate(nicheId, nicheLabel, rates = RESEARCHED_RATES) {
  const idKey = normalizeNicheKey(nicheId);
  const labelKey = normalizeNicheKey(nicheLabel);
  for (const row of rates) {
    const keys = rowKeys(row);
    if (idKey && keys.has(idKey)) return row;
    if (labelKey && keys.has(labelKey)) return row;
  }
  return null;
}

function lookingUp(nicheId, nicheLabel) {
  const label = String(nicheLabel || "").trim() || String(nicheId || "").trim().replace(/-/g, " ") || "this service";
  return {
    status: "looking_up",
    metric_type: null,
    cvr_percent: null,
    low: null,
    mid: null,
    high: null,
    source: null,
    year: null,
    category_id: null,
    category_label: null,
    niche_id: nicheId || null,
    niche_label: label,
    applied: false,
    notes: "No studied rate in the seeded table yet. Phase 2 will research a ballpark. Do not invent a number."
  };
}

function resolveLeadConversion(nicheId, nicheLabel, options = {}) {
  const table = options.rates || RESEARCHED_RATES;
  const row = findResearchedRate(nicheId, nicheLabel, table);
  if (!row || row.applied !== true) return lookingUp(nicheId, nicheLabel);
  return {
    status: "applied",
    metric_type: row.metric_type,
    cvr_percent: row.cvr_percent,
    low: row.low,
    mid: row.mid,
    high: row.high,
    source: row.source,
    year: row.year,
    category_id: row.id,
    category_label: row.category_label,
    niche_id: nicheId || row.id,
    niche_label: String(nicheLabel || "").trim() || row.category_label,
    applied: true,
    notes: row.notes
  };
}

function leadRangeFromConversion(searches, resolved) {
  if (!Number.isFinite(searches) || searches <= 0) return null;
  if (!resolved || resolved.status !== "applied") return null;
  if (!Number.isFinite(resolved.low) || !Number.isFinite(resolved.high) || !Number.isFinite(resolved.mid)) return null;
  const conv = (rate) => Math.max(1, Math.round(searches * rate));
  return {
    low: conv(resolved.low),
    high: conv(resolved.high),
    mid: conv(resolved.mid)
  };
}

function conversionFlagCopy(resolved) {
  if (resolved && resolved.status === "applied") {
    const label = resolved.category_label || resolved.niche_label || "this service";
    return `These leads use a published ad click-to-lead rate for ${label}. That is the share of ad clicks that become a lead, not the share of all Google searches.`;
  }
  const label = (resolved && resolved.niche_label) || "this service";
  return `Looking up a conversion rate for ${label}. We don't have a studied rate yet.`;
}

  return {
    DEFAULT_LEAD_CONVERSION,
    RESEARCHED_RATES,
    resolveLeadConversion,
    leadRangeFromConversion,
    conversionFlagCopy,
    findResearchedRate,
    normalizeNicheKey
  };
})();
/* lead-conversion-rates-end */

// Estimates box. Locked to the Ai Video Bootcamp abel-refs-v2 mock and
// direction.md item 9. Every figure here is derived, so it keeps EST.
// EST_REF_MID still scales the sample year chart. The 38-52 of 2,900
// default is not applied in Phase 1; mapped niches use seeded rates.
const EST_REF_SEARCHES = 2900;
const EST_REF_LOW = 38;
const EST_REF_HIGH = 52;
const EST_REF_MID = 45;
const SAMPLE_CLOSE_RATE = 1.0;
const EST_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const EST_MID = [36, 38, 41, 44, 48, 52, 55, 53, 49, 45, 42, 40];
const EST_SPAN = [6, 6, 7, 7, 8, 9, 9, 9, 8, 7, 7, 6];

function shortMoney(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value)) return "-";
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function realCheck(report) {
  return Boolean(report && report.example_data === false);
}

function checkVolume(report) {
  const volume = report && report.demand && report.demand.search_volume;
  return volume && Number.isFinite(volume.value) ? volume.value : null;
}


function averageJob(price) {
  if (!price || price.status !== "published") return null;
  if (price.pending_review || price.estimated) return null;
  if (!Number.isInteger(price.low_dollars) || !Number.isInteger(price.high_dollars)) return null;
  return Math.round((price.low_dollars + price.high_dollars) / 2);
}

function estKpi(label, value, caption, extraClass) {
  return el("div", { class: extraClass ? `kpi ${extraClass}` : "kpi" }, [
    el("div", { class: "l" }, [label, " ", el("span", { class: "est-tag" }, ["EST."])]),
    el("div", { class: "v num" }, [value]),
    el("div", { class: "s" }, [caption])
  ]);
}

function niceStep(range) {
  const rough = Math.max(1, range / 5);
  const mag = 10 ** Math.floor(Math.log10(rough));
  const unit = [1, 2, 5, 10].find((m) => m * mag >= rough) || 10;
  return Math.max(1, unit * mag);
}

function renderEstChart(leads) {
  const wrap = $("chartwrap");
  wrap.replaceChildren();
  $("est-legend").hidden = !leads;
  if (!leads) return;
  const factor = leads.mid / EST_REF_MID;
  const mids = EST_MID.map((v) => v * factor);
  const spans = EST_SPAN.map((v) => v * factor);
  const lowest = Math.min(...mids.map((v, i) => v - spans[i]));
  const highest = Math.max(...mids.map((v, i) => v + spans[i]));
  const step = niceStep(highest - lowest);
  const yMin = Math.max(0, Math.floor(lowest / step) * step);
  const yMax = Math.ceil((highest + (highest - lowest) * 0.35) / step) * step;
  const narrow = matchMedia("(max-width: 640px)").matches;
  const CH = narrow ? { w: 360, h: 200, l: 34, r: 8, t: 14, b: 26 } : { w: 640, h: 190, l: 40, r: 10, t: 14, b: 26 };
  const cx = (i) => CH.l + ((CH.w - CH.l - CH.r) * i) / 11;
  const cy = (v) => CH.t + (CH.h - CH.t - CH.b) * (1 - (v - yMin) / (yMax - yMin));
  const peakValue = Math.round(mids[6]);
  const chart = svg("svg", {
    viewBox: `0 0 ${CH.w} ${CH.h}`,
    class: "chart",
    role: "img",
    "aria-label": `Estimated leads a month over a sample year, from about ${Math.round(mids[0])} in January to a peak near ${peakValue} in July. Sample estimate only, not a forecast or live data.`
  });
  const defs = svg("defs", {}, chart);
  const grad = svg("linearGradient", { id: "est-chart-area", x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  svg("stop", { offset: "0", "stop-color": "#22d3ee", "stop-opacity": ".35" }, grad);
  svg("stop", { offset: "1", "stop-color": "#22d3ee", "stop-opacity": "0" }, grad);
  for (let v = yMin; v <= yMax + 1e-9; v += step) {
    svg("line", { x1: CH.l, x2: CH.w - CH.r, y1: cy(v), y2: cy(v), stroke: "#fff", "stroke-opacity": ".06" }, chart);
    svg("text", { x: CH.l - 8, y: cy(v) + 4, "text-anchor": "end", "font-size": 11, fill: "#a9b4c6" }, chart).textContent = String(Math.round(v));
  }
  EST_MONTHS.forEach((m, i) => {
    if (!narrow || i % 2 === 0) svg("text", { x: cx(i), y: CH.h - 6, "text-anchor": "middle", "font-size": 11, fill: "#a9b4c6" }, chart).textContent = m;
  });
  const smooth = (pts) => pts.map((p, i) => {
    if (!i) return `M${p[0]} ${p[1]}`;
    const q = pts[i - 1];
    const mx = (q[0] + p[0]) / 2;
    return `C${mx} ${q[1]} ${mx} ${p[1]} ${p[0]} ${p[1]}`;
  }).join(" ");
  const hi = mids.map((v, i) => [cx(i), cy(v + spans[i])]);
  const lo = mids.map((v, i) => [cx(i), cy(Math.max(yMin, v - spans[i]))]).reverse();
  const mid = mids.map((v, i) => [cx(i), cy(v)]);
  const group = svg("g", { class: "est-reveal" }, chart);
  svg("path", { d: `${smooth(mid)} L${cx(11)} ${cy(yMin)} L${cx(0)} ${cy(yMin)} Z`, fill: "url(#est-chart-area)" }, group);
  svg("path", { d: `${smooth(hi)} L${lo.map((p) => p.join(" ")).join(" L")} Z`, fill: "#a78bfa", "fill-opacity": ".16" }, group);
  svg("path", { d: smooth(mid), fill: "none", stroke: "#22d3ee", "stroke-width": 2.5, "stroke-dasharray": "7 5", "stroke-linecap": "round" }, group);
  const peak = svg("g", { class: "est-peak" }, chart);
  const label = `Jul, about ${peakValue}`;
  const boxW = Math.max(104, label.length * 7.6 + 16);
  svg("circle", { cx: cx(6), cy: cy(mids[6]), r: 5, fill: "#f4f8fc", stroke: "#22d3ee", "stroke-width": 2 }, peak);
  svg("rect", { x: cx(6) - boxW / 2, y: cy(mids[6]) - 40, width: boxW, height: 28, rx: 8, fill: "#0b1018", stroke: "rgba(255,255,255,.14)" }, peak);
  svg("text", { x: cx(6), y: cy(mids[6]) - 21, "text-anchor": "middle", "font-size": 12.5, "font-weight": 700, fill: "#eef2f7" }, peak).textContent = label;
  wrap.append(chart);
}

function renderEstimates(proposal, report = state.storedReport) {
  const kpis = $("kpis");
  kpis.replaceChildren();
  const pill = $("est-pill");
  const volumeMetric = report && report.demand && report.demand.search_volume;
  const measuredZeroVolume = Boolean(realCheck(report) && volumeMetric && volumeMetric.status === "measured_zero");
  const missingDemand = Boolean(realCheck(report) && (!volumeMetric || volumeMetric.value == null || volumeMetric.status === "missing" || volumeMetric.status === "failed" || volumeMetric.status === "unusable"));
  const fromCheck = realCheck(report) && checkVolume(report) != null && !measuredZeroVolume;
  const sampleSearches = proposal && proposal.composite && proposal.composite.demand && proposal.composite.demand.monthly_searches;
  const searches = fromCheck ? checkVolume(report) : (Number.isFinite(sampleSearches) ? sampleSearches : null);
  if (!proposal || !state.location) {
    pill.textContent = "Sample data";
    kpis.append(el("p", { class: "help est-empty" }, ["Estimates appear after you pick a city."]));
    const note = $("est-rate-note");
    if (note) {
      note.hidden = true;
      note.textContent = "";
    }
    renderEstChart(null);
    return;
  }
  pill.textContent = fromCheck ? "From last check" : "Sample data";
  const subniche = proposal.subniche || {};
  const resolved = LeadConversion.resolveLeadConversion(subniche.id, subniche.label);
  const leads = LeadConversion.leadRangeFromConversion(searches, resolved);
  const avg = averageJob(proposal.price);
  const hasVolume = Number.isFinite(searches) && searches > 0;
  const looking = resolved.status === "looking_up";
  const leadCaption = measuredZeroVolume
    ? "Measured zero searches"
    : missingDemand
      ? "Insufficient data"
      : leads
        ? (fromCheck ? "From last check search volume" : "From sample search volume")
        : (looking && hasVolume ? "No studied rate yet" : "Needs search volume");
  const leadValue = !leads ? "-" : (leads.low === leads.high ? String(leads.low) : `${leads.low} to ${leads.high}`);
  kpis.append(estKpi("Leads a month", leadValue, leadCaption));
  if (leads && avg != null) {
    const low = leads.low * SAMPLE_CLOSE_RATE * avg;
    const high = leads.high * SAMPLE_CLOSE_RATE * avg;
    kpis.append(estKpi("Revenue a month", `${shortMoney(low)} to ${shortMoney(high)}`, "Leads × close rate × job price", "rev"));
  } else {
    const revenueCaption = avg == null
      ? "Needs a published national job price"
      : measuredZeroVolume
        ? "Measured zero searches"
        : missingDemand
          ? "Insufficient data"
          : (looking && hasVolume ? "No studied rate yet" : "Needs search volume");
    kpis.append(estKpi("Revenue a month", "-", revenueCaption, "rev"));
  }
  kpis.append(estKpi("Average job", avg == null ? "-" : `$${avg.toLocaleString("en-US")}`, avg == null ? "Needs a published national job price" : "National range, not city adjusted"));
  const note = $("est-rate-note");
  if (note) {
    note.hidden = false;
    note.textContent = LeadConversion.conversionFlagCopy(resolved);
  }
  renderEstChart(leads);
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
  const stored = Boolean(state.storedReport);
  const chargeCalls = stored
    ? (state.rerunArmed && quote && quote.calls && quote.calls.length ? quote.calls : (quote && quote.rerun_calls) || [])
    : (quote && quote.calls) || [];
  const chargeCost = stored
    ? (state.rerunArmed && quote ? quote.estimated_cost_usd : quote && quote.rerun_estimated_cost_usd)
    : quote && quote.estimated_cost_usd;
  const rows = quote || stored ? [
    ["Niche", quote ? quote.niche : proposal ? proposal.subniche.label : "-"],
    ["Market", quote ? quote.market : proposal ? `${proposal.location.name}, ${proposal.location.state}` : "-"],
    ["Calls", chargeCalls.length ? String(chargeCalls.length) : "-"],
    ["Cost", chargeCost == null ? "-" : quoteMoney(chargeCost)],
    ["Budget left", quote ? `${money(quote.remaining_usd)} of ${money(quote.cap_usd)}` : "-"]
  ] : [
    ["Niche", proposal ? proposal.subniche.label : "-"],
    ["Market", proposal ? `${proposal.location.name}, ${proposal.location.state}` : "-"],
    ["Calls", "-"],
    ["Cost", "-"],
    ["Budget left", "-"]
  ];
  rows.forEach(([name, value]) => {
    const cost = name === "Cost" && chargeCost != null;
    kv.append(el("dt", {}, [name]), el("dd", { class: "num" }, cost
      ? [quoteMoney(chargeCost), " ", el("span", { class: "est-tag" }, ["EST."])]
      : [value]));
  });
  const calls = $("paid-calls");
  if (calls) {
    calls.replaceChildren();
    chargeCalls.forEach((call) => {
      calls.append(el("li", {}, [`${call.purpose}: ${quoteMoney(call.estimated_cost_usd)}`]));
    });
  }
  const cap = quote ? quote.cap_usd : 0;
  const used = quote ? quote.spent_usd : 0;
  $("spent-label").textContent = quote ? `${money(used)} of ${money(cap)}` : "$0.00";
  $("budget-bar").style.width = cap ? `${Math.min(100, (used / cap) * 100)}%` : "0";
  const go = $("pay-go");
  go.textContent = stored ? "Rerun paid check" : "Okay, run paid check";
  go.classList.toggle("money", stored);
  go.classList.toggle("pri", !stored);
  const locked = Boolean(state.lensReport && state.lensReport.hard_stop);
  const ready = !locked && (stored ? (!state.busy && (state.rerunArmed ? Boolean(quote) : Boolean(state.storedReport))) : Boolean(quote) && !state.busy && Boolean(state.lensReport));
  go.disabled = !ready;
  const showCancel = stored ? state.rerunArmed : Boolean(quote);
  $("pay-cancel").hidden = !showCancel;
  $("pay-cancel").disabled = !showCancel || state.busy;
  $("paid-warn").hidden = stored && !state.rerunArmed;
  const breakdown = chargeCalls.length
    ? `${chargeCalls.map((call) => `${call.purpose} ${quoteMoney(call.estimated_cost_usd)}`).join(". ")}. Total ${quoteMoney(chargeCost)}. Location lists are free and are not in this cost.`
    : "";
  $("paid-note").textContent = locked
    ? "Hard stop. Step 4 stays locked."
    : stored
      ? "This starts a new paid DataForSEO run and will be charged."
      : breakdown;
  const heading = $("h-paid");
  if (heading) heading.textContent = stored && !state.rerunArmed ? "Saved check" : "Confirm paid check";
  const pill = $("paid-pill");
  if (stored && state.rerunArmed) {
    pill.textContent = "Confirm";
    pill.classList.remove("cached");
  } else {
    pill.textContent = stored ? "Cached" : quote && !quote.live_mode ? "Live off" : quote ? "Quote" : "Sample data";
    pill.classList.toggle("cached", stored);
  }
  const warnText = $("paid-warn-text");
  if (warnText) {
    warnText.textContent = stored
      ? "This check costs money. Nothing runs until you press Rerun paid check."
      : "This check costs money. Nothing runs until you press Okay.";
  }
  paintStamp();
  paintStepper();
}

const RES_SPARKS = {
  searches: { stroke: "#22d3ee", points: "0,26 15,24 30,25 45,18 60,20 75,13 90,15 105,9 120,7" },
  rivals: { stroke: "#a78bfa", points: "0,12 15,14 30,13 45,16 60,15 75,18 90,17 105,20 120,19" },
  bid: { stroke: "#f472b6", dash: "5 4", points: "0,22 15,20 30,21 45,17 60,18 75,14 90,16 105,12 120,11" }
};

function resTile(label, value, caption, spark, est) {
  const line = svg("svg", { class: "spark", preserveAspectRatio: "none", viewBox: "0 0 120 34", "aria-hidden": "true" });
  const attrs = { fill: "none", stroke: spark.stroke, "stroke-width": 2, points: spark.points };
  if (spark.dash) attrs["stroke-dasharray"] = spark.dash;
  svg("polyline", attrs, line);
  return el("div", { class: "res" }, [
    el("div", { class: "l" }, est ? [label, " ", el("span", { class: "est-tag" }, ["EST."])] : [label]),
    el("div", { class: "v num" }, [value]),
    el("div", { class: "s" }, [caption]),
    line
  ]);
}

// Last check results: compact summary card, three tiles only (mock).
// Phrase table, organic results, and seasonality live in #check-details.
function renderResults(message, report) {
  const slot = $("results");
  slot.replaceChildren();
  const real = realCheck(report);
  let searches = "-";
  let rivals = "-";
  let bid = "-";
  let searchesCaption = real ? "From last check." : "Sample, not live";
  if (report) {
    const volume = report.demand && report.demand.search_volume;
    const listings = report.city_market && report.city_market.unique_listings;
    const cpc = report.demand && report.demand.cpc;
    searches = real || volume ? metricText(volume) : "-";
    if (Number.isFinite(listings)) rivals = listings === 0 ? "0 (measured)" : String(listings);
    else if (real) rivals = "Insufficient data";
    bid = real || cpc ? moneyText(cpc) : "-";
    $("res-pill").textContent = real ? "Live Google data" : "Sample data";
    if (real && volume && volume.status === "measured_zero") searchesCaption = "Measured zero, not missing.";
    else if (real && (!volume || volume.value == null || volume.status === "missing" || volume.status === "failed" || volume.status === "unusable")) searchesCaption = "Source returned nothing.";
  } else {
    const composite = state.location && state.proposal && state.proposal.composite;
    const sampleSearches = composite && composite.demand && composite.demand.monthly_searches;
    const sampleRivals = composite && composite.competition && composite.competition.competitor_count;
    if (Number.isFinite(sampleSearches)) searches = sampleSearches.toLocaleString("en-US");
    if (Number.isFinite(sampleRivals)) rivals = String(sampleRivals);
    $("res-pill").textContent = "Sample data";
  }
  const caption = real ? "From last check." : "Sample, not live";
  slot.append(resTile("Monthly searches", searches, searchesCaption, RES_SPARKS.searches, false));
  slot.append(resTile("Map pack rivals", rivals, caption, RES_SPARKS.rivals, false));
  slot.append(resTile("Top ad bid", bid, bid === "Insufficient data" || bid === "$0.00 (measured)" ? searchesCaption : caption, RES_SPARKS.bid, true));
  if (message) slot.append(el("p", { class: message.toLowerCase().includes("not") ? "error res-note" : "help res-note" }, [message]));
  renderDetails(report);
}

function renderDetails(report) {
  const section = $("check-details");
  const slot = $("details");
  slot.replaceChildren();
  const has = Boolean(report && (report.demand || report.organic || report.trends));
  section.hidden = !has;
  if (!has) return;
  $("details-pill").textContent = realCheck(report) ? "From last check" : "Sample data";
  const notes = [report.live_banner, report.example_banner].filter(Boolean);
  if (report.live_composite && report.live_composite.status === "insufficient_data") {
    notes.push("Insufficient data. Search demand was not returned, so there is no grade. That is not a measured zero.");
  } else if (report.live_composite && report.live_composite.grade_cap && report.live_composite.grade_cap.applied) {
    notes.push(`Grade capped at ${report.live_composite.composite_display} because demand was measured as zero. Uncapped formula ${report.live_composite.grade_cap.uncapped_display}. Competition uses the Maps sample.`);
  } else if (report.live_composite && report.live_composite.status === "calculated") {
    notes.push(`Live composite ${report.live_composite.composite_display}. Competition uses the Maps sample. Organic directory share does not change it.`);
  }
  if (notes.length) slot.append(el("div", { class: "res-wide full details-notes" }, notes.map((text) => el("p", { class: "help" }, [text]))));
  const phrases = renderPhrasePanel(report);
  phrases.classList.add("full");
  slot.append(phrases);
  slot.append(renderOrganicPanel(report));
  slot.append(renderSeasonality(report));
}

function renderPhrasePanel(report) {
  const demand = report.demand || {};
  const panel = el("section", { class: "res-wide" }, [
    el("h3", {}, ["Search phrases"]),
    el("p", { class: "help" }, [
      `Core term volume ${metricText(demand.search_volume)}. Clustered coverage ${metricText(demand.clustered_coverage_volume)}. The demand index uses clustered coverage volume. Word-order twins count once. Missing phrases stay missing.`
    ])
  ]);
  const rows = demand.keyword_rows || [];
  if (!rows.length) {
    panel.append(el("p", { class: "help" }, ["No phrase rows were returned. That is not a measured zero, and it is not a grade."]));
    return panel;
  }
  const table = el("table", { class: "phrase-table" });
  table.append(el("thead", {}, [el("tr", {}, ["Phrase", "Monthly volume", "CPC", "Competition", "Low bid", "High bid"].map((heading) => el("th", {}, [heading])))]));
  const body = el("tbody");
  rows.forEach((row) => {
    body.append(el("tr", {}, [
      el("td", {}, [row.keyword || "-"]),
      el("td", {}, [metricText(row.search_volume)]),
      el("td", {}, [moneyText(row.cpc)]),
      el("td", {}, [row.paid_search_competition && row.paid_search_competition.value != null && row.paid_search_competition.status !== "measured_zero" ? String(row.paid_search_competition.value) : metricText(row.paid_search_competition)]),
      el("td", {}, [moneyText(row.low_top_of_page_bid)]),
      el("td", {}, [moneyText(row.high_top_of_page_bid)])
    ]));
  });
  table.append(body);
  panel.append(el("div", { class: "scroll" }, [table]));
  return panel;
}

function renderOrganicPanel(report) {
  const organic = report.organic || {};
  const counts = organic.directory_counts || {};
  const panel = el("section", { class: "res-wide" }, [el("h3", {}, ["Regular Google results"])]);
  if (organic.status === "failed" || organic.status === "missing" || organic.status === "unsupported") {
    panel.append(el("p", { class: "help" }, [
      organic.error && organic.error.message
        ? organic.error.message
        : "Regular Google results are missing. That does not change the Maps competition score."
    ]));
    return panel;
  }
  const top5 = counts.top5_directory_count == null ? "Missing" : `${counts.top5_directory_count} of ${counts.top5_results}`;
  const top10 = counts.top10_directory_count == null ? "Missing" : `${counts.top10_directory_count} of ${counts.top10_results}`;
  panel.append(el("p", { class: "help" }, [
    `Directories in the top 5 organic results: ${top5}. Directories in the top 10: ${top10}. Maps listing room stays the competition score.`
  ]));
  const list = el("ol", { class: "organic-list" });
  (organic.results || []).forEach((result) => {
    const safeUrl = typeof result.url === "string" && /^https?:\/\//i.test(result.url) ? result.url : "";
    const title = safeUrl
      ? el("a", { href: safeUrl, rel: "noreferrer" }, [result.title || result.domain || safeUrl])
      : (result.title || "Untitled");
    list.append(el("li", {}, [
      title,
      el("span", { class: result.directory ? "dir" : "host" }, [
        `${result.domain || "unknown domain"}${result.directory ? " · directory" : ""}`
      ])
    ]));
  });
  if (!(organic.results || []).length) panel.append(el("p", { class: "help" }, ["No organic results were returned."]));
  else panel.append(list);
  return panel;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Seasonality in Check details. Prefers the measured monthly search volume
// from the check (solid bars). Google Trends stays a text note: it is relative
// interest, not volume. This is not the estimated-leads year chart.
function renderSeasonality(report) {
  const trends = report.trends || {};
  const season = trends.seasonality || {};
  const geo = trends.geo || {};
  const monthly = report.demand && report.demand.monthly_searches;
  const months = monthly && Array.isArray(monthly.months)
    ? monthly.months.slice().sort((a, b) => (a.year - b.year) || (a.month - b.month))
    : [];
  const measured = months.filter((m) => Number.isFinite(m.value));
  const panel = el("section", { class: "res-wide season-card" }, [
    el("h3", {}, [measured.length ? "Search volume by month, from the check" : "Seasonality, search interest from the check"])
  ]);
  const level = season.level ? season.level : "Missing";
  const geoLabel = geo.level ? geo.level : "unknown";
  panel.append(el("p", { class: "help" }, [
    measured.length
      ? `Measured Google Ads monthly searches for the core term. Trends seasonality ${level}, geo ${geoLabel}${geo.fallback_from_city ? " (broader than the city)" : ""}. Trends is relative interest, not search volume, and it does not change the demand index.`
      : `Seasonality ${level}. Geo ${geoLabel}${geo.fallback_from_city ? " (broader than the city)" : ""}. ${geo.note || "Trends is relative interest, not search volume, and it does not change the demand index."}`
  ]));
  if (season.peak_months && season.peak_months.length) {
    panel.append(el("p", {}, [`Trends peak months: ${season.peak_months.join(", ")}.`]));
  }
  const series = measured.length
    ? months.map((m) => ({ label: `${MONTH_ABBR[m.month - 1]} ${String(m.year).slice(2)}`, full: `${MONTH_ABBR[m.month - 1]} ${m.year}`, value: Number.isFinite(m.value) ? m.value : null }))
    : (season.series || []).map((m) => ({ label: m.label.slice(0, 3), full: m.label, value: Number.isInteger(m.value) ? m.value : null }));
  if (!series.length) {
    panel.append(el("p", { class: "help" }, [trends.error && trends.error.message ? trends.error.message : "No monthly series was returned. Missing interest is not zero demand."]));
    return panel;
  }
  const bars = el("div", { class: measured.length ? "season-bars vol" : "season-bars" });
  const max = Math.max(1, ...series.map((m) => (m.value == null ? 0 : m.value)));
  series.forEach((m) => {
    const missing = m.value == null;
    const bar = el("span", { title: `${m.full}: ${missing ? "missing" : m.value.toLocaleString("en-US")}` });
    bar.style.height = missing ? "0" : `${Math.max(4, Math.round((m.value / max) * 72))}px`;
    if (missing) bar.className = "miss";
    bars.append(el("i", {}, [bar, el("b", {}, [m.label])]));
  });
  panel.append(bars);
  return panel;
}

function setStamp(id, text) {
  const node = $(id);
  if (!node) return;
  node.hidden = !text;
  node.textContent = text || "";
}

function paintStamp() {
  const report = state.storedReport;
  const text = report ? formatDataStamp(report.captured_at, stampDepth(report)) : "";
  const onScore = Boolean(report && report.live_composite && text);
  setStamp("score-stamp", onScore ? text : "");
  setStamp("map-stamp", text);
  setStamp("paid-stamp", text);
  $("saved-note").hidden = !onScore;
}

function markCached(on, options = {}) {
  const score = $("score-pill");
  const map = $("map-pill");
  const results = $("res-pill");
  if (on) {
    if (options.score !== false && score) {
      score.textContent = "Cached";
      score.classList.add("cached");
    }
    if (map) {
      map.textContent = "Cached";
      map.classList.add("cached");
    }
    if (results) {
      results.textContent = "Cached";
      results.classList.add("cached");
    }
    return;
  }
  if (score) {
    score.textContent = "Sample data";
    score.classList.remove("cached");
  }
  if (map) {
    map.textContent = "Sample data";
    map.classList.remove("cached");
  }
  if (results) results.classList.remove("cached");
  const paid = $("paid-pill");
  if (paid) paid.classList.remove("cached");
}

function showStored(report) {
  state.storedReport = report;
  state.rerunArmed = false;
  const title = state.location && state.subniche
    ? `${state.subniche.label} in ${state.location.name}, ${state.location.state}`
    : "Saved result";
  renderResults("", report);
  renderEstimates(state.proposal, report);
  const gaugeNote = "Demand uses clustered coverage volume. Competition is the Maps sample. Organic directory share and Trends seasonality do not change those scores.";
  if (report.live_composite) {
    renderGauge(report.live_composite, title, gaugeNote);
  } else if (report.score && report.score.grade_state === "insufficient_data") {
    renderGauge({ status: "insufficient_data", withheld_reason: report.score.withheld_reason }, title, gaugeNote);
  } else if (report.score && report.score.grade_state === "capped_fail") {
    renderGauge({
      status: "calculated",
      composite_display: report.score.overall_display,
      grade_cap: report.score.grade_cap,
      demand: { index: 0, contribution_display: "0.0" },
      competition: { index: report.city_market && report.city_market.competition_index, contribution_display: null },
      margin: { index: null, contribution_display: null }
    }, title, gaugeNote);
  }
  markCached(true, { score: Boolean(report.live_composite) });
  paintStamp();
}

function clearStored() {
  const had = Boolean(state.storedReport);
  state.storedReport = null;
  state.rerunArmed = false;
  if (had) renderResults("", null);
  markCached(false);
  paintStamp();
}

async function chooseSubniche(row) {
  state.subniche = row;
  state.location = null;
  state.proposal = null;
  state.quote = null;
  clearStored();
  renderRows();
  const shortlist = await post("/api/microsite", {
    action: "shortlist",
    keyword: state.keyword,
    subniche_id: row.id,
    subniche_label: row.label
  });
  state.cards = shortlist.cards || [];
  state.nearbyCards = shortlist.nearby_cards || [];
  state.location = null;
  renderMap();
  const mapCard = document.querySelector(".area-map");
  if (mapCard) { mapCard.classList.remove("flash"); void mapCard.offsetWidth; mapCard.classList.add("flash"); }
  $("live").textContent = `Step 2 map updated for ${row.label}. Sample heat only.`;
  renderGauge(null, `${row.label}. Pick a city in Step 2.`, "");
  renderEstimates(null);
  renderResults("", null);
  renderSketch(null);
  renderQuote(null, null);
  paintStepper();
  loadRules(row.label);
}

async function chooseLocation(card) {
  if (card.geography_type !== "city") return;
  if (!state.subniche) return;
  state.location = card;
  const home = regionForCity(card.id);
  if (home) state.mapRegion = home.id;
  $("live").textContent = `${card.name} picked. Step 2 done. Scoring with sample data.`;
  clearStored();
  renderMap();
  state.proposal = await post("/api/microsite", {
    action: "proposal",
    keyword: state.keyword,
    subniche_id: state.subniche.id,
    subniche_label: state.subniche.label,
    location_id: card.id
  });
  renderGauge(
    state.proposal.composite,
    `${state.proposal.subniche.label} in ${card.name}, ${card.state}`,
    state.proposal.deep_check_gate && state.proposal.deep_check_gate.demand_basis_note
  );
  renderEstimates(state.proposal, null);
  renderResults("", null);
  renderSketch(state.proposal);
  $("score-pill").textContent = "Sample data";
  if (!state.lensReport && state.subniche) await loadRules(state.subniche.label, card.name, card.state);
  if (state.lensReport && state.lensReport.hard_stop) {
    state.quote = null;
    renderQuote(null, state.proposal);
    $("paid-note").textContent = "Hard stop. Step 4 stays locked.";
    paintStepper();
    return;
  }
  try {
    const resolved = await post("/api/resolve", { mode: "example", city: card.name, state: card.state, country: "United States" });
    const side = (match) => match ? { location_code: match.location_code, location_name: match.location_name, location_type: match.location_type } : null;
    state.confirmed = { google_ads: side(resolved.google_ads.match), google_maps: side(resolved.google_maps.match) };
    state.quote = await post("/api/quote", quoteBody());
    if (state.quote.cache_hit && state.quote.cached_report) showStored(state.quote.cached_report);
  } catch (error) {
    state.quote = null;
    state.quoteError = error.message;
  }
  renderQuote(state.quote, state.proposal);
  if (!state.quote && state.quoteError) $("paid-note").textContent = state.quoteError;
  paintStepper();
}

function quoteBody(rerun) {
  return {
    niche: state.subniche.label,
    city: state.location.name,
    state: state.location.state,
    country: "United States",
    geography_type: "city",
    confirmed: state.confirmed,
    rerun: rerun === true
  };
}

async function armRerun() {
  state.busy = true;
  $("pay-go").disabled = true;
  let failed = "";
  try {
    const quoted = await post("/api/quote", quoteBody(true));
    state.quote = quoted;
    state.rerunArmed = true;
    $("live").textContent = "Confirm the rerun. Nothing has been sent yet.";
  } catch (error) {
    state.rerunArmed = false;
    failed = error.message;
  } finally {
    state.busy = false;
    renderQuote(state.quote, state.proposal);
    if (failed) $("paid-note").textContent = failed;
  }
}

async function runPaid() {
  if (!state.location || state.busy) return;
  if (state.storedReport && !state.rerunArmed) {
    await armRerun();
    return;
  }
  if (!state.quote) return;
  const rerun = Boolean(state.storedReport);
  state.busy = true;
  $("pay-go").disabled = true;
  $("paid-note").textContent = rerun ? "Confirming the rerun…" : "Confirming the paid check…";
  let failed = "";
  try {
    const quoted = await post("/api/quote", quoteBody(rerun));
    state.quote = quoted;
    state.rerunArmed = rerun;
    renderQuote(quoted, state.proposal);
    const report = await post("/api/validate", {
      mode: "live",
      rerun,
      spend_token: quoted.spend_token,
      margin_index: state.proposal.composite && state.proposal.composite.margin ? state.proposal.composite.margin.index : undefined,
      margin_estimated: Boolean(state.proposal.composite && state.proposal.composite.estimated),
      niche: state.subniche.label,
      city: state.location.name,
      state: state.location.state,
      country: "United States",
      geography_type: "city",
      confirmed: state.confirmed,
      lens: state.lens
    });
    showStored(report);
    state.quote = await post("/api/quote", quoteBody(false));
  } catch (error) {
    failed = error.message;
    if (!state.storedReport) renderResults(error.message);
  } finally {
    state.busy = false;
    renderQuote(state.quote, state.proposal);
    if (failed) $("paid-note").textContent = failed;
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
  specialtyRequest += 1;
  state.keyword = $("keyword").value.trim();
  state.subniche = null;
  resetSpecialtyConfirm();
  if (state.keyword.length < 2) {
    state.rows = [];
    renderRows();
    $("lb-help").textContent = liveMode
      ? "Type a service of at least 2 characters. Nothing is sent until you confirm a lookup."
      : "Example data only until a confirmed live check. Type a service. Ranked sub-niches use example demand.";
    paintStepper();
    return;
  }
  if (liveMode) {
    state.rows = [];
    renderRows();
    $("lb-help").textContent = `Live mode is on. Finding specialties for "${state.keyword}" sends one paid United States lookup after you confirm. Typing does not send it.`;
    paintStepper();
    return;
  }
  $("lb-help").textContent = "Preparing example suggestions. This is not a live market search.";
  suggestTimer = setTimeout(() => { loadExampleSubniches(); }, 250);
});

const findButton = $("find-specialties");
if (findButton) {
  findButton.addEventListener("click", () => {
    const confirming = Boolean(state.specialtyQuote && state.specialtyQuote.keyword === state.keyword);
    requestSpecialties(confirming);
  });
}
const findCancel = $("find-cancel");
if (findCancel) {
  findCancel.addEventListener("click", () => {
    specialtyRequest += 1;
    resetSpecialtyConfirm();
    $("lb-help").textContent = "Canceled. No DataForSEO request was sent.";
  });
}

$("pay-go").addEventListener("click", runPaid);
$("pay-cancel").addEventListener("click", () => {
  if (state.rerunArmed) {
    state.rerunArmed = false;
    renderQuote(state.quote, state.proposal);
    $("live").textContent = "Canceled. Nothing was sent.";
    paintStepper();
    return;
  }
  state.quote = null;
  state.location = null;
  state.proposal = null;
  clearStored();
  renderQuote(null, null);
  renderSketch(null);
  renderMap();
  $("paid-note").textContent = "Canceled. Nothing was sent.";
  paintStepper();
});

fetch("/health").then((response) => response.json()).then((health) => {
  const on = Boolean(health.live_mode);
  liveMode = on;
  const actions = $("specialty-actions");
  if (actions) actions.hidden = !on;
  $("server-status").classList.toggle("on", on);
  $("server-status").querySelector("span").textContent = on ? "Live mode on" : "Sample mode, live checks off";
  if (on) {
    state.rows = [];
    state.subniche = null;
    resetSpecialtyConfirm();
    renderRows();
    $("lb-help").textContent = state.keyword.length >= 2
      ? `Live mode is on. Finding specialties for "${state.keyword}" sends one paid United States lookup after you confirm. Typing does not send it.`
      : "Live mode is on. Type a service, then press Find specialties. Nothing is sent until you confirm the price.";
  }
}).catch(() => {
  $("server-status").querySelector("span").textContent = "Sample mode, live checks off";
});

function enlargeIcon(path) {
  const node = svg("svg", { viewBox: "0 0 24 24", width: "16", height: "16", "aria-hidden": "true", focusable: "false" });
  svg("path", {
    d: path,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  }, node);
  return node;
}

let enlargedCard = null;
let enlargeTimer = 0;

function focusable(root) {
  return [...root.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])")]
    .filter((node) => !node.hidden && node.getAttribute("aria-hidden") !== "true");
}

let enlargeHome = null;

function closeEnlarged() {
  if (!enlargedCard) return;
  const card = enlargedCard;
  const open = card.querySelector(".enlarge");
  const close = card.querySelector(".enlarge-close");
  card.classList.remove("is-enlarged");
  card.removeAttribute("role");
  card.removeAttribute("aria-modal");
  if (close) close.hidden = true;
  if (open) {
    open.hidden = false;
    open.setAttribute("aria-expanded", "false");
  }
  if (enlargeHome && enlargeHome.parentNode) {
    enlargeHome.parentNode.insertBefore(card, enlargeHome);
    enlargeHome.remove();
  }
  enlargeHome = null;
  const scrim = $("card-scrim");
  scrim.classList.remove("open");
  document.body.classList.remove("card-focus");
  const orb = document.getElementById("centik-orb");
  const orbLabel = document.getElementById("centik-orb-lbl");
  if (orb && !$("history").classList.contains("open")) orb.inert = false;
  if (orbLabel && !$("history").classList.contains("open")) orbLabel.inert = false;
  enlargedCard = null;
  window.clearTimeout(enlargeTimer);
  enlargeTimer = window.setTimeout(() => {
    if (!enlargedCard) scrim.hidden = true;
  }, 200);
  if (open) {
    try {
      open.focus({ focusVisible: true });
    } catch {
      open.focus();
    }
  }
}

function openEnlarged(card) {
  if (enlargedCard && enlargedCard !== card) closeEnlarged();
  const scrim = $("card-scrim");
  const open = card.querySelector(".enlarge");
  const close = card.querySelector(".enlarge-close");
  window.clearTimeout(enlargeTimer);
  if (scrim.parentNode !== document.body) document.body.append(scrim);
  scrim.hidden = false;
  document.body.classList.add("card-focus");
  const orb = document.getElementById("centik-orb");
  const orbLabel = document.getElementById("centik-orb-lbl");
  if (orb) orb.inert = true;
  if (orbLabel) orbLabel.inert = true;
  if (!enlargeHome) {
    enlargeHome = document.createElement("div");
    enlargeHome.className = "enlarge-holder";
    enlargeHome.setAttribute("aria-hidden", "true");
    enlargeHome.style.width = `${card.offsetWidth}px`;
    enlargeHome.style.height = `${card.offsetHeight}px`;
    card.parentNode.insertBefore(enlargeHome, card);
    document.body.append(card);
  }
  card.classList.add("is-enlarged");
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  if (open) {
    open.hidden = true;
    open.setAttribute("aria-expanded", "true");
  }
  if (close) close.hidden = false;
  enlargedCard = card;
  requestAnimationFrame(() => {
    if (enlargedCard === card) scrim.classList.add("open");
  });
  if (close) close.focus();
}

function installEnlarge() {
  const scrim = $("card-scrim");
  if (!scrim) return;
  scrim.addEventListener("click", () => closeEnlarged());
  document.querySelectorAll("#grid .card").forEach((card) => {
    const head = card.querySelector(".card-h");
    const title = card.querySelector("h2");
    if (!head || !title || head.querySelector(".enlarge")) return;
    const name = title.textContent.trim();
    const open = el("button", {
      class: "enlarge",
      type: "button",
      "aria-label": `Enlarge ${name}`,
      "aria-expanded": "false"
    });
    open.append(enlargeIcon("M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"));
    const close = el("button", { class: "enlarge-close", type: "button", hidden: "" });
    close.append(enlargeIcon("M6 6l12 12M18 6L6 18"), document.createTextNode("Close"));
    open.addEventListener("click", () => openEnlarged(card));
    close.addEventListener("click", () => closeEnlarged());
    head.append(open, close);
  });
  document.addEventListener("keydown", (event) => {
    if (!enlargedCard) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeEnlarged();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = focusable(enlargedCard);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !enlargedCard.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !enlargedCard.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  });
}

installEnlarge();
renderMap();
renderGauge(null, "Pick a sub-niche and a city.", "");
renderEstimates(null);
paintStepper();
renderQuote(null, null);
renderSketch(null);
renderResults("");

function verdictWord(verdict) {
  if (verdict === "pass") return "Pass";
  if (verdict === "fail") return "Fail";
  if (verdict === "caution") return "Caution";
  if (verdict === "hard_stop") return "Hard stop";
  return "Not enough evidence";
}

function verdictDetail(verdict, lensId) {
  if (verdict === "pass") return "Meets this test.";
  if (verdict === "caution") return "Job value can clear $500. This is not urgent one-off work.";
  if (verdict === "hard_stop") return "Step 4 stays locked.";
  if (verdict === "fail") return "This test does not pass.";
  if (lensId === "four_yes") return "Ticket, page one, or ads were not measured. Missing is not a no.";
  return "A published job total was not on file. Missing is not a no.";
}

function markGlyph(mark) {
  if (mark === "yes") return { cls: "yes", glyph: "\u2713", word: "Yes" };
  if (mark === "no") return { cls: "no", glyph: "\u2715", word: "No" };
  return { cls: "unk", glyph: "?", word: "Not enough evidence" };
}

function moneyRange(price) {
  if (!price || !Number.isInteger(price.low_dollars) || !Number.isInteger(price.high_dollars)) return "Not on file";
  const fmt = (amount) => `$${amount.toLocaleString("en-US")}`;
  return `${fmt(price.low_dollars)} to ${fmt(price.high_dollars)}${price.open_high ? "+" : ""}`;
}

function setLens(lens) {
  state.lens = lens === "four_yes" ? "four_yes" : "classroom";
  for (const button of document.querySelectorAll(".seg button")) {
    const on = button.dataset.lens === state.lens;
    button.setAttribute("aria-checked", on ? "true" : "false");
    button.tabIndex = on ? 0 : -1;
  }
  renderRules();
  renderShortlist();
  $("live").textContent = `${state.lens === "four_yes" ? "Jesse's four-yes test" : "Classroom floor"} lens. Numbers unchanged.`;
}

async function loadRules(service, city, stateName) {
  if (!service) return;
  try {
    state.lensReport = await post("/api/lenses", { service, city: city || "", state: stateName || "" });
  } catch (error) {
    state.lensReport = null;
    $("lens-help").textContent = error.message || "The rules could not be loaded.";
  }
  renderRules();
  if (state.lensReport && state.lensReport.hard_stop) {
    state.quote = null;
    renderQuote(state.quote, state.proposal);
    $("paid-note").textContent = "Hard stop. Step 4 stays locked.";
  }
  paintStepper();
}

function renderRules() {
  const report = state.lensReport;
  const help = $("lens-help");
  const raw = $("rules-raw");
  const out = $("rules-out");
  if (!raw || !out) return;
  raw.replaceChildren();
  out.replaceChildren();
  if (!report) {
    if (help) help.textContent = "Pick a service to see this test. This test is separate from the market score.";
    return;
  }
  const active = state.lens === "four_yes" ? report.four_yes : report.classroom;
  const other = state.lens === "four_yes" ? report.classroom : report.four_yes;
  if (help) {
    help.textContent = state.lens === "four_yes"
      ? "Jesse's four-yes test. Ticket $5,000 or more, about 1,500 operators in the state, a weak page one for best X in Y, and sponsored ads. Row 2 is a directory test."
      : "Classroom floor. Urgent, one-off jobs people phone about. Job value $500 or more, ideally $1,000 to $2,000. The course uses emergency locksmith as its example.";
  }
  const rows = report.raw ? [
    ["Job ticket", report.raw.job_ticket],
    ["Kind of job", report.raw.kind_of_job],
    ["Operators in the state", report.raw.operators],
    ["Best query page one", report.raw.best_query],
    ["Sponsored ads on that search", report.raw.ads],
    ["Rank Expand flagged niche", report.raw.flagged]
  ] : [
    ["Job ticket", moneyRange(report.price)],
    ["Kind of job", report.service || ""],
    ["Operators in the state", "Not on file"],
    ["Best query page one", "Not checked"],
    ["Sponsored ads on that search", "Not checked"],
    ["Rank Expand flagged niche", report.hard_stop ? "Yes" : "No"]
  ];
  rows.forEach(([name, value]) => raw.append(el("dt", {}, [name]), el("dd", {}, [value])));
  const verdict = el("p", { class: "lens-readout" }, [
    el("span", { class: `verdict-chip v-${active.verdict === "pass" ? "pass" : active.verdict === "fail" || active.verdict === "hard_stop" ? "fail" : "unk"}` }, [verdictWord(active.verdict)]),
    el("span", { class: "lens-detail" }, [verdictDetail(active.verdict, active.id)])
  ]);
  if (other && other.verdict !== active.verdict) {
    verdict.append(el("span", { class: "help lens-other" }, [`${other.label}: ${verdictWord(other.verdict)}. These are two different tests.`]));
  }
  const list = el("ol", { class: "crit" });
  (active.rows || []).forEach((row) => {
    const mark = markGlyph(row.mark);
    list.append(el("li", {}, [
      el("span", { class: `mark ${mark.cls}`, "aria-hidden": "true" }, [mark.glyph]),
      el("span", { class: "crit-copy" }, [el("b", {}, [row.label]), " ", el("small", { class: "help" }, [row.note || row.evidence || ""])]),
      el("span", {}, [mark.word])
    ]));
  });
  const standing = el("p", { class: "help" }, [
    report.hard_stop
      ? "Standing rule, both lenses: Hard stop. A flagged niche keeps Step 4 locked."
      : "Standing rule, both lenses: not a Rank Expand flagged niche."
  ]);
  out.append(verdict, list, standing);
}

async function generateShortlist() {
  const ideas = ($("disc-ideas") && $("disc-ideas").value.trim()) || state.keyword;
  if (!ideas || ideas.length < 2) {
    $("shortlist-note").textContent = "Enter a service idea first. No rows were invented.";
    return;
  }
  const progress = $("shortlist-progress");
  progress.hidden = false;
  progress.value = 0;
  try {
    const report = await post("/api/discover", { service: ideas, lens: state.lens, mode: "example" });
    progress.value = 1;
    state.discovery = report;
    renderShortlist();
    $("live").textContent = report.rows && report.rows.length
      ? "Shortlist ready. This is free. It does not run a paid check."
      : (report.message || "No shortlist. Nothing was invented.");
  } catch (error) {
    state.discovery = { rows: [], message: error.message || "The shortlist failed. No rows were invented." };
    renderShortlist();
    $("shortlist-note").textContent = state.discovery.message;
  } finally {
    progress.hidden = true;
  }
}

function renderShortlist() {
  const list = $("shortlist");
  if (!list) return;
  const rows = (state.discovery && state.discovery.rows) || [];
  list.replaceChildren();
  if (!rows.length) {
    const message = state.discovery && state.discovery.message;
    if (message) list.append(el("li", { class: "help" }, [message]));
    return;
  }
  rows.forEach((row) => {
    const chip = row.lens_chip || {};
    const owner = row.census && row.census.owner_occupancy_rate;
    const ownerText = owner && owner.status === "measured" ? `${Math.round(owner.value * 1000) / 10}%` : "Not on file";
    const population = row.census && row.census.population;
    const popText = population && population.status === "measured" ? population.value.toLocaleString("en-US") : "Not on file";
    const home = row.census && row.census.median_home_value;
    const homeText = home && home.status === "measured" ? `$${home.value.toLocaleString("en-US")}` : "Not on file";
    const ratings = row.competition && Number.isInteger(row.competition.strongest_in_town_ratings)
      ? `${row.competition.strongest_in_town_ratings} ratings`
      : "Not on file";
    const item = el("li", { class: `sl-row${row.status_tag === "Fallback for #1" || row.surfaced_as === "fallback" ? " fallback" : ""}` }, [
      el("div", { class: "sl-rk num" }, [String(row.position)]),
      el("div", {}, [
        el("h3", {}, [`${row.service} · ${row.city}, ${row.state}`]),
        el("p", {}, [el("span", { class: "tag" }, [row.status_tag || "Ranked"])]),
        el("div", { class: "sigs" }, [
          el("div", { class: "sig" }, [el("span", { class: "l" }, ["Owner-occupied"]), el("span", { class: "v num" }, [ownerText])]),
          el("div", { class: "sig" }, [el("span", { class: "l" }, ["Population"]), el("span", { class: "v num" }, [popText])]),
          el("div", { class: "sig" }, [el("span", { class: "l" }, ["Median home value"]), el("span", { class: "v num" }, [homeText])]),
          el("div", { class: row.price && row.price.status === "published" ? "sig" : "sig miss" }, [
            el("span", { class: "l" }, ["Job ticket ", el("span", { class: "est-tag" }, ["EST."])]),
            el("span", { class: "v num est-val" }, [row.price && row.price.status === "published" ? moneyRange(row.price) : "Not on file"])
          ]),
          el("div", { class: "sig" }, [el("span", { class: "l" }, ["Top Maps incumbent seen"]), el("span", { class: "v num" }, [ratings])]),
          el("div", { class: "sig" }, [el("span", { class: "l" }, ["Named operators"]), el("span", { class: "v num" }, [row.named_label || "Not on file"])]),
          el("div", { class: "sig miss" }, [el("span", { class: "l" }, ["Housing age"]), el("span", { class: "v num" }, ["Not fetched"]), el("span", { class: "s" }, ["Not in source method"])])
        ]),
        el("p", { class: "why" }, [row.why ? `Why here: ${row.why}` : ""]),
        row.fallback_reason ? el("p", { class: "fb-note" }, [el("span", { class: "fb-k" }, ["Fallback reason: pack density "]), row.fallback_reason]) : ""
      ]),
      el("div", { class: "sl-side" }, [
        el("span", { class: "verdict-chip v-unk" }, [verdictWord(chip.verdict)]),
        chip.disagree ? el("small", { class: "help" }, [`${chip.other_label}: ${verdictWord(chip.other_verdict)}`]) : "",
        el("button", { class: "btn ghost cy sm", type: "button" }, ["Use this pair"]),
        el("small", { class: "help" }, ["Fills Service and City. Runs nothing."])
      ])
    ]);
    item.querySelector("button").addEventListener("click", () => usePair(row));
    list.append(item);
  });
}

function usePair(row) {
  $("keyword").value = row.service;
  state.keyword = row.service;
  const city = $("city-any");
  if (city) city.value = `${row.city}, ${row.state}`;
  const picked = $("picked-line");
  if (picked) {
    picked.hidden = false;
    picked.textContent = `Service: ${row.service}. City: ${row.city}, ${row.state}. Step 4 still needs Okay before any paid check.`;
  }
  $("live").textContent = `Filled ${row.service} in ${row.city}, ${row.state}. Fills Service and City. Runs nothing.`;
  loadRules(row.service, row.city, row.state);
}

function groupRuns(runs) {
  const groups = new Map();
  for (const run of runs) {
    const depth = Number.isInteger(run.maps_depth) ? run.maps_depth : "none";
    const version = run.check_version || "preview";
    const key = `${run.niche}|${run.city}|${run.state}|${depth}|${version}`;
    const list = groups.get(key) || [];
    list.push(run);
    groups.set(key, list);
  }
  return [...groups.values()];
}

function renderHistory(runs) {
  const slot = $("history-list");
  slot.hidden = false;
  $("diff").hidden = true;
  $("history-back").hidden = true;
  $("h-history").textContent = "History";
  slot.replaceChildren();
  if (!runs.length) {
    slot.append(el("p", { class: "help" }, ["No saved checks yet."]));
    return;
  }
  groupRuns(runs).forEach((group) => {
    const sample = group[0];
    const shallow = Number.isInteger(sample.maps_depth) && sample.maps_depth < 100;
    const head = el("div", { class: "hgroup" }, [
      el("h3", {}, [`${sample.niche} · ${sample.city}, ${sample.state}`]),
      el("p", { class: "help" }, [shallow
        ? "Shallower check. It is not reused for a depth 100 check and is not compared with one."
        : `Maps depth ${sample.maps_depth == null ? "not stored" : sample.maps_depth} · ${sample.check_version || "preview"}`])
    ]);
    const table = el("table", { class: "run-table" });
    table.append(el("tr", {}, ["Date", "Score", "Searches", "Map pack", "Grade", "Lens used", ""].map((label) => el("th", {}, [label]))));
    group.forEach((run) => {
      const zone = run.zone && run.zone.value ? run.zone.value : "Unavailable";
      const score = run.market_score && run.market_score.value != null ? String(run.market_score.value) : "Unavailable";
      const volume = run.volume && run.volume.value === 0 ? "0 (measured)" : (run.volume && run.volume.value != null ? String(run.volume.value) : "Insufficient data");
      const pack = run.map_pack ? (run.map_pack.value != null ? String(run.map_pack.value) : "Unavailable") : "Unavailable";
      const open = el("button", { class: "btn ghost sm", type: "button" }, ["Open"]);
      open.addEventListener("click", () => openSaved(run));
      table.append(el("tr", {}, [
        el("td", {}, [run.checked_at ? run.checked_at.replace("T", " ").slice(0, 16) : ""]),
        el("td", { class: "num" }, [score]),
        el("td", { class: "num" }, [volume]),
        el("td", {}, [pack]),
        el("td", {}, [el("span", { class: "zone-chip" }, [zone])]),
        el("td", {}, [run.lens_label || "Not stored"]),
        el("td", {}, [open])
      ]));
    });
    head.append(table);
    if (group.length >= 2 && !shallow) {
      const button = el("button", { class: "btn ghost sm", type: "button" }, ["Compare runs"]);
      button.addEventListener("click", () => openCompare(group[0], group[1]));
      head.append(button);
    } else if (!shallow) {
      head.append(el("p", { class: "help" }, ["Needs a second run"]));
    }
    slot.append(head);
  });
  slot.append(el("p", { class: "help" }, ["Open loads the saved check for $0. Nothing calls DataForSEO."]));
}

function openSaved(run) {
  $("keyword").value = run.niche || "";
  state.keyword = run.niche || "";
  const city = $("city-any");
  if (city) city.value = `${run.city}, ${run.state}`;
  setLens(run.lens === "four_yes" ? "four_yes" : "classroom");
  closeHistory();
  loadRules(run.niche, run.city, run.state);
  const score = run.market_score && Number.isFinite(run.market_score.value) ? run.market_score.value : null;
  const title = `${run.niche} in ${run.city}, ${run.state}`;
  if (score != null) {
    renderGauge({
      status: "calculated",
      composite_display: String(score),
      demand: { index: run.demand && run.demand.value, contribution_display: null },
      competition: { index: run.competition && run.competition.value, contribution_display: null },
      margin: { index: run.margin && run.margin.value, contribution_display: null }
    }, title, "Opened a saved check. Nothing calls DataForSEO.");
  } else {
    renderGauge({
      status: "insufficient_data",
      withheld_reason: "Insufficient data. This saved check has no measured grade."
    }, title, "Opened a saved check. Nothing calls DataForSEO.");
  }
  $("live").textContent = "Opened the saved check. Nothing calls DataForSEO.";
}

async function openCompare(newer, older) {
  if (newer.maps_depth !== older.maps_depth) return;
  if ((newer.check_version || "") !== (older.check_version || "")) return;
  const response = await fetch(`/api/runs/diff?id=${encodeURIComponent(newer.id)}&prior=${encodeURIComponent(older.id)}`);
  const payload = await response.json();
  if (!payload.diff) return;
  renderDiff(payload.diff);
}

function renderDiff(diff) {
  $("history-list").hidden = true;
  $("history-back").hidden = false;
  $("h-history").textContent = "Compare runs";
  const slot = $("diff");
  slot.hidden = false;
  slot.replaceChildren();
  if (diff.lens_note) slot.append(el("p", {}, [diff.lens_note]));
  const summary = diff.changes && diff.changes.length ? diff.changes.join(" ") : "No numeric change.";
  slot.append(el("p", {}, [`What changed: ${summary}`]));
  slot.append(el("p", { class: "help" }, ["Newer minus older"]));
  const table = el("div", { class: "diff-table" });
  table.append(el("div", { class: "diff-row" }, [
    el("span", {}, ["Field"]),
    el("span", {}, ["Earlier"]),
    el("span", {}, ["This run"]),
    el("span", {}, ["Change"])
  ]));
  const stack = el("div", { class: "diff-stack" });
  (diff.rows || []).forEach((row) => {
    if (row.id === "grade") return;
    table.append(el("div", { class: "diff-row" }, [
      el("span", {}, [row.label]),
      el("span", {}, [row.older_display]),
      el("span", {}, [row.newer_display]),
      el("span", { class: "diff-delta" }, [row.delta_text === "not comparable" ? "Not comparable" : row.delta_text === "unchanged" ? "no change" : row.delta_text])
    ]));
    stack.append(el("div", { class: "sig" }, [
      el("span", { class: "l" }, [row.label]),
      el("span", {}, [`${row.older_display} | ${row.newer_display}`]),
      el("span", { class: "help" }, [row.delta_text === "not comparable" ? "Not comparable" : row.delta_text])
    ]));
  });
  slot.append(table, stack);
  $("live").textContent = `What changed: ${summary}`;
}

function openHistory() {
  fetch("/api/runs").then((response) => response.json()).then((payload) => {
    state.runs = payload.runs || [];
    const count = state.runs.length;
    const label = $("history-count");
    if (label) label.textContent = `${count} ${count === 1 ? "run" : "runs"}`;
    renderHistory(state.runs);
    const dialog = $("history");
    dialog.hidden = false;
    dialog.classList.add("open");
    document.body.classList.add("card-focus");
    $("card-scrim").hidden = false;
    requestAnimationFrame(() => $("card-scrim").classList.add("open"));
    $("open-history").setAttribute("aria-expanded", "true");
    const orb = $("centik-orb");
    const orbLabel = $("centik-orb-lbl");
    if (orb) orb.inert = true;
    if (orbLabel) orbLabel.inert = true;
    $("close-history").focus();
  }).catch(() => {
    $("live").textContent = "Run history could not be loaded.";
  });
}

function closeHistory() {
  const dialog = $("history");
  dialog.classList.remove("open");
  dialog.hidden = true;
  $("open-history").setAttribute("aria-expanded", "false");
  if (!document.querySelector(".card.is-enlarged")) {
    document.body.classList.remove("card-focus");
    $("card-scrim").classList.remove("open");
    $("card-scrim").hidden = true;
    const orb = $("centik-orb");
    const orbLabel = $("centik-orb-lbl");
    if (orb) orb.inert = false;
    if (orbLabel) orbLabel.inert = false;
  }
  $("open-history").focus();
}

$("generate-shortlist").addEventListener("click", generateShortlist);
$("open-history").addEventListener("click", openHistory);
$("close-history").addEventListener("click", closeHistory);
$("history-back").addEventListener("click", () => renderHistory(state.runs));
$("card-scrim").addEventListener("click", () => {
  if ($("history").classList.contains("open")) closeHistory();
});
document.querySelectorAll(".seg button").forEach((button) => {
  button.addEventListener("click", () => setLens(button.dataset.lens));
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = button.dataset.lens === "classroom" ? "four_yes" : "classroom";
    setLens(next);
    document.querySelector(`.seg button[data-lens="${next}"]`).focus();
  });
});
const compareButton = $("compare-runs");
if (compareButton) {
  compareButton.addEventListener("click", () => {
    openHistory();
  });
}
const orbButton = $("centik-orb");
if (orbButton) {
  orbButton.addEventListener("click", () => {
    $("live").textContent = "Questions? Tap to talk. This preview does not place a call.";
  });
}
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  document.documentElement.style.setProperty("--abw-orb-play", "paused");
  $("live").textContent = "Motion is reduced. Scores and comparisons show their final values.";
}
fetch("/api/runs").then((response) => response.ok ? response.json() : { runs: [] }).then((payload) => {
  const count = (payload.runs || []).length;
  const label = $("history-count");
  if (label) label.textContent = `${count} ${count === 1 ? "run" : "runs"}`;
}).catch(() => {});

