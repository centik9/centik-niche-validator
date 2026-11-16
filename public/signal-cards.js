(function () {
  const ICONS = {
    phone: ["M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"],
    list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
    "map-pin": ["M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z", "M12 7a3 3 0 1 0 .001 0z"],
    clock: ["M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0", "M12 6v6l4 2"],
    users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
    quote: ["M17 6H3", "M21 12H8", "M21 18H8", "M3 12v6"],
    repeat: ["M17 1l4 4-4 4", "M3 11V9a4 4 0 0 1 4-4h14", "M7 23l-4-4 4-4", "M21 13v2a4 4 0 0 1-4 4H3"],
    calendar: ["M8 2v4", "M16 2v4", "M3 10h18", "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"],
    home: ["M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8", "M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
    globe: ["M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0-20 0", "M2 12h20", "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"],
    shield: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"],
    landmark: ["M3 22h18", "M6 18v-7", "M10 18v-7", "M14 18v-7", "M18 18v-7", "M12 2l8 5H4z"],
    star: ["M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"],
    message: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"]
  };
  const ZONE_VAR = { No: "--z-no", Low: "--z-low", Medium: "--z-med", High: "--z-high", Max: "--z-max" };
  const TITLES = [
    ["conversion_readiness", "Conversion readiness", "phone", "conversion-card", "Checking pages"],
    ["ads_market", "Ads market", "users", "ads-card", "Checking ads"],
    ["results_risk", "Results risk", "shield", "risk-card", "Checking complaints"]
  ];
  let marketScore = null;
  let pastScores = {};

  function el(tag, attrs, kids) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value == null) return;
      if (key === "class") node.className = value;
      else node.setAttribute(key, value);
    });
    (kids || []).forEach((kid) => node.append(kid && kid.nodeType ? kid : document.createTextNode(String(kid))));
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    (ICONS[name] || ICONS.list).forEach((d) => {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.append(path);
    });
    return svg;
  }

  function zoneName(score) {
    if (!Number.isFinite(score)) return null;
    if (score < 15) return "No";
    if (score < 30) return "Low";
    if (score < 60) return "Medium";
    if (score < 80) return "High";
    return "Max";
  }

  function chip(name, empty) {
    const node = el("span", { class: empty ? "zone-chip is-empty" : "zone-chip" }, [name]);
    if (!empty && ZONE_VAR[name]) node.style.color = `var(${ZONE_VAR[name]})`;
    return node;
  }

  function meter(score, label) {
    const enough = Number.isInteger(score);
    const node = el("div", {
      class: enough ? "zone-meter" : "zone-meter is-empty",
      role: "meter",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": enough ? String(score) : null,
      "aria-valuetext": enough ? `${label} ${score} out of 100` : "Not enough evidence",
      "aria-label": label
    });
    [15, 30, 60, 80].forEach((tick) => {
      const mark = el("i", { class: "tick" });
      mark.style.left = `${tick}%`;
      node.append(mark);
    });
    if (!enough) return node;
    const fill = el("span", { class: "zone-fill" });
    const marker = el("span", { class: "zone-marker" });
    const tone = ZONE_VAR[zoneName(score)];
    fill.style.background = `var(${tone})`;
    marker.style.background = `var(${tone})`;
    node.append(fill, marker);
    const apply = () => {
      fill.style.width = `${score}%`;
      marker.style.left = `${score}%`;
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) apply();
    else requestAnimationFrame(apply);
    return node;
  }

  function balanceBar(positive, negative) {
    const pos = positive && Number.isFinite(positive.count) ? positive.count : 0;
    const neg = negative && Number.isFinite(negative.count) ? negative.count : 0;
    const total = pos + neg;
    const bar = el("div", { class: "balance", role: "img", "aria-label": `Positive ${pos}, negative ${neg}` }, [
      el("span", { class: "pos" }),
      el("span", { class: "neg" })
    ]);
    const posWidth = total ? Math.round((pos / total) * 100) : 50;
    bar.firstChild.style.width = `${posWidth}%`;
    bar.lastChild.style.width = `${100 - posWidth}%`;
    return bar;
  }

  function signalRow(signal) {
    const missingRow = signal.status === "missing" || !Number.isInteger(signal.score);
    const estimated = signal.status === "estimated";
    const bar = el("span", { class: missingRow ? "mini-bar is-missing" : estimated ? "mini-bar is-est" : "mini-bar", role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": missingRow ? null : String(signal.score), "aria-valuetext": missingRow ? "Not measured" : `${signal.name} ${signal.score}`, "aria-label": signal.name });
    if (!missingRow) {
      const fill = el("i");
      fill.style.width = `${signal.score}%`;
      bar.append(fill);
    }
    const value = missingRow
      ? "Not measured"
      : String(signal.score);
    const row = el("div", { class: "sig-row" }, [
      icon(signal.icon),
      el("div", { class: "sig-copy" }, [
        el("div", { class: "sig-top" }, [
          el("span", { class: "sig-name" }, [signal.name]),
          estimated ? el("span", { class: "est-tag" }, ["EST."]) : "",
          el("span", { class: "num sig-val" }, [value])
        ]),
        bar,
        el("p", { class: "sig-fact" }, [missingRow ? (signal.reason || "Not measured") : signal.raw_fact])
      ])
    ]);
    if (signal.positive && signal.negative && !missingRow) {
      row.querySelector(".sig-copy").append(
        balanceBar(signal.positive, signal.negative),
        el("p", { class: "sig-fact" }, [`${signal.positive.fact}. ${signal.negative.fact}.`])
      );
    }
    return row;
  }

  function card(block, meta) {
    const enough = block && Number.isInteger(block.score);
    const zone = enough ? (block.zone || zoneName(block.score)) : null;
    const article = el("article", {
      class: enough ? "signal-card" : "signal-card is-muted",
      id: meta[3],
      tabindex: "-1",
      "data-zone": zone || ""
    });
    if (zone && ZONE_VAR[zone]) article.style.borderLeftColor = `var(${ZONE_VAR[zone]})`;
    const count = block && block.signals ? block.signals.length : 0;
    article.append(el("header", { class: "signal-head" }, [
      el("h3", {}, [icon(meta[2]), el("span", {}, [block.title || meta[1]])]),
      el("span", { class: "cov" }, [block.coverage ? block.coverage.label : "Based on 0 signals"])
    ]));
    article.append(el("p", { class: enough ? "signal-num num" : "signal-num is-empty" }, [
      enough ? String(block.score) : "Not enough evidence",
      enough ? el("small", {}, ["/100"]) : ""
    ]));
    if (zone) article.append(chip(zone, false));
    else article.append(chip("Not enough evidence", true));
    article.append(meter(enough ? block.score : null, block.title || meta[1]));
    article.append(el("p", { class: "higher" }, [block.higher_means || ""]));
    article.append(el("p", { class: "explain" }, [block.explanation || ""]));
    if (block.balance && block.balance.positive && block.balance.negative) {
      article.append(el("div", { class: "balance-block" }, [
        el("p", { class: "sig-fact" }, [`Positive ${block.balance.positive.count} (score ${block.balance.positive.score}). Negative ${block.balance.negative.count} (score ${block.balance.negative.score}).`]),
        balanceBar(block.balance.positive, block.balance.negative),
        el("p", { class: "sig-fact" }, [block.balance.note || ""])
      ]));
    }
    const details = el("details", { class: "signal-more" });
    const summary = el("summary", {}, [`Show ${count} signals`]);
    summary.setAttribute("aria-expanded", "false");
    details.append(summary);
    (block.signals || []).forEach((signal) => details.append(signalRow(signal)));
    const method = el("details", { class: "signal-method" });
    method.append(el("summary", {}, ["How this is scored"]));
    method.append(el("p", {}, [block.method || "This is an index, not a recommendation."]));
    const list = el("ul");
    (block.sources || []).forEach((source) => list.append(el("li", {}, [`${source.name}: ${source.detail}`])));
    method.append(list);
    details.append(method);
    if (!window.matchMedia("(max-width: 899px)").matches) {
      details.open = true;
      summary.textContent = `Hide ${count} signals`;
      summary.setAttribute("aria-expanded", "true");
    }
    details.addEventListener("toggle", () => {
      const open = details.open;
      summary.textContent = open ? `Hide ${count} signals` : `Show ${count} signals`;
      summary.setAttribute("aria-expanded", open ? "true" : "false");
    });
    article.append(details);
    const values = pastScores[block.id] || [];
    if (!block.example_data && Number.isInteger(block.score) && values.length >= 4) {
      const below = values.filter((value) => value < block.score).length;
      article.append(el("p", { class: "sig-fact" }, [`Higher than ${Math.round((100 * below) / values.length)} percent of your past checks`]));
    }
    article.append(el("p", { class: "signal-foot" }, [block.footer || ""]));
    return article;
  }

  function waiting(meta, text) {
    return el("article", { class: "signal-card is-muted", id: meta[3], tabindex: "-1" }, [
      el("h3", {}, [icon(meta[2]), el("span", {}, [meta[1]])]),
      el("p", { class: "higher" }, [text])
    ]);
  }

  function paintJumps(report) {
    const slot = document.getElementById("score-jumps");
    if (!slot) return;
    slot.hidden = false;
    slot.replaceChildren();
    const items = [
      ["Market index", Number.isFinite(marketScore) ? Math.round(marketScore) : null, "market-score"],
      ["Conversion", report && report.conversion_readiness, "conversion-card"],
      ["Ads", report && report.ads_market, "ads-card"],
      ["Risk", report && report.results_risk, "risk-card"]
    ];
    items.forEach(([label, block, target]) => {
      const score = typeof block === "number" ? block : block && Number.isInteger(block.score) ? block.score : null;
      const zone = score == null ? null : (typeof block === "object" && block.zone) || zoneName(score);
      const text = score == null ? `${label} · Not enough evidence` : `${label} ${score} · ${zone}`;
      const button = el("button", { type: "button", class: score == null ? "zone-chip jump is-empty" : "zone-chip jump" }, [text]);
      if (zone && ZONE_VAR[zone]) button.style.color = `var(${ZONE_VAR[zone]})`;
      button.addEventListener("click", () => {
        const node = document.getElementById(target);
        if (!node) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        node.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        node.focus({ preventScroll: true });
      });
      slot.append(button);
    });
  }

  function setPill(report) {
    const pill = document.getElementById("scores-pill");
    if (!pill) return;
    if (!report) {
      pill.textContent = "Sample, not live";
      return;
    }
    pill.textContent = report.example_data || report.data_origin === "example" ? "Sample, not live" : "From last check";
  }

  function render(report, options) {
    const grid = document.getElementById("scores-grid");
    if (!grid) return;
    const opts = options || {};
    grid.replaceChildren();
    if (opts.loading) {
      TITLES.forEach((meta) => grid.append(waiting(meta, meta[4])));
      setPill(null);
      paintJumps(null);
      return;
    }
    if (opts.error) {
      TITLES.forEach((meta) => grid.append(waiting(meta, opts.error)));
      paintJumps(null);
      return;
    }
    if (!report || !report.conversion_readiness) {
      const line = opts.live ? "This signal appears after a paid check." : "Pick a city to see this signal.";
      TITLES.forEach((meta) => grid.append(waiting(meta, line)));
      setPill(null);
      paintJumps(null);
      return;
    }
    TITLES.forEach((meta) => {
      const block = report[meta[0]];
      grid.append(block ? card(block, meta) : waiting(meta, "This signal was not on the check."));
    });
    setPill(report);
    paintJumps(report);
  }

  window.SignalCards = {
    render,
    setMarket(score) {
      marketScore = Number.isFinite(score) ? score : null;
      paintJumps(window.__signalReport || null);
    },
    show(report, options) {
      window.__signalReport = report || null;
      if (options && options.past) pastScores = options.past;
      render(report, options);
    }
  };
})();
