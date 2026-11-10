import { verdictWord } from "./lenses.js";

const FIELDS = [
  ["market_score", "Market score"],
  ["zone", "Zone"],
  ["demand", "Demand"],
  ["competition", "Competition"],
  ["margin", "Margin"],
  ["leads", "Leads a month"],
  ["revenue", "Revenue a month"],
  ["average_job", "Average job"],
  ["volume", "Volume"],
  ["map_pack", "Map pack"],
  ["lens_verdict", "Lens verdict"]
];

function money(amount) {
  const text = String(Math.round(amount));
  return `$${text.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function formatNum(value) {
  if (!Number.isFinite(value)) return "Unavailable";
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1);
}

export function displayValue(side) {
  if (!side) return "Unavailable";
  if (side.kind === "range") {
    if (!Number.isFinite(side.low) || !Number.isFinite(side.high)) return "Unavailable";
    return `${money(side.low)} to ${money(side.high)}`;
  }
  if (side.kind === "words") {
    if (!side.value) return "Unavailable";
    if (side.value === "pass" || side.value === "fail" || side.value === "caution" || side.value === "hard_stop" || side.value === "not_enough_evidence") return verdictWord(side.value);
    return String(side.value);
  }
  if (side.value === null || side.value === undefined || side.status === "unavailable") return "Unavailable";
  return formatNum(side.value);
}

function header(run) {
  return {
    id: run.id,
    checked_at: run.checked_at,
    niche: run.niche,
    city: run.city,
    state: run.state,
    lens: run.lens,
    lens_label: run.lens_label,
    origin: run.origin
  };
}

function compareSides(id, next, prev) {
  const olderDisplay = displayValue(prev);
  const newerDisplay = displayValue(next);
  const base = { id, older_display: olderDisplay, newer_display: newerDisplay, estimated: Boolean(next && next.estimated) || Boolean(prev && prev.estimated) };
  if (!next || !prev) return { ...base, delta: null, delta_text: "not comparable" };
  if (next.kind !== prev.kind) return { ...base, delta: null, delta_text: "not comparable" };
  if (Boolean(next.estimated) !== Boolean(prev.estimated)) return { ...base, delta: null, delta_text: "not comparable" };
  if (next.kind === "range") return { ...base, delta: null, delta_text: "not comparable" };
  if (id === "lens_verdict") {
    if (next.value && prev.value && next.value === prev.value) return { ...base, delta: null, delta_text: "unchanged" };
    return { ...base, delta: null, delta_text: "not comparable" };
  }
  if (next.kind === "words") {
    if (next.value && prev.value && next.value === prev.value) return { ...base, delta: null, delta_text: "unchanged" };
    return { ...base, delta: null, delta_text: "not comparable" };
  }
  if (next.status === "unavailable" || prev.status === "unavailable" || !Number.isFinite(next.value) || !Number.isFinite(prev.value)) {
    return { ...base, delta: null, delta_text: "not comparable" };
  }
  const delta = Math.round((next.value - prev.value) * 10) / 10;
  if (delta === 0) return { ...base, delta: 0, delta_text: "unchanged" };
  if (delta > 0) return { ...base, delta, delta_text: `up ${formatNum(delta)}` };
  return { ...base, delta, delta_text: `down ${formatNum(Math.abs(delta))}` };
}

export function diffRuns(newer, older) {
  if (!newer || !older) return null;
  const lensDiffers = newer.lens !== older.lens;
  const rows = FIELDS.map(([id, label]) => {
    const compared = compareSides(id, newer[id], older[id]);
    if (id === "lens_verdict" && lensDiffers) compared.delta_text = "not comparable";
    return { label, ...compared };
  });
  const changes = [];
  if (lensDiffers) {
    changes.push(`${older.lens_label} vs ${newer.lens_label}. The verdicts are not a numeric delta.`);
  } else if (newer.lens_verdict && older.lens_verdict && newer.lens_verdict !== older.lens_verdict) {
    changes.push(`The ${newer.lens_label} verdict changed from ${verdictWord(older.lens_verdict)} to ${verdictWord(newer.lens_verdict)}.`);
  }
  for (const row of rows) {
    if (row.id === "lens_verdict" || row.id === "zone") continue;
    if (row.delta_text === "unchanged" || row.delta_text === "not comparable") continue;
    changes.push(`${row.label} ${row.delta_text}`);
  }
  return {
    lens_note: lensDiffers ? `${older.lens_label} vs ${newer.lens_label}` : null,
    newer: header(newer),
    older: header(older),
    rows,
    changes
  };
}
