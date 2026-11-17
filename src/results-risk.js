import { disciplinaryLookup } from "./licensing-boards.js";
import { clusterThemes } from "./review-themes.js";
import { assembleSignalCard } from "./signal-score.js";

const WEIGHTS = {
  google: 0.25,
  yelp: 0.2,
  bbb: 0.15,
  angi: 0.15,
  state_board: 0.15,
  nextdoor: 0.1
};

const EXAMPLE_REVIEWS = [
  { business: "Austin Plumbing Co", rating: 1, text: "The plumber was a no show and never showed." },
  { business: "Hill Country Drains", rating: 2, text: "Total no show. We waited all day." },
  { business: "Austin Plumbing Co", rating: 5, text: "Showed up and fixed the leak." }
];

export function sourceRisk(positiveScore, negativeScore) {
  if (!Number.isInteger(positiveScore) || !Number.isInteger(negativeScore)) return null;
  const value = (negativeScore * 0.7) + ((100 - positiveScore) * 0.3);
  return Math.max(0, Math.min(100, Math.round(value)));
}

function share(count, total) {
  if (!Number.isInteger(count) || !Number.isInteger(total) || total <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((100 * count) / total)));
}

function missing(id, name, icon, weight, reason) {
  return {
    id,
    name,
    icon,
    weight,
    status: "missing",
    score: null,
    raw_fact: "Not measured",
    reason,
    positive: null,
    negative: null,
    evidence: null
  };
}

function measuredSource({ id, name, icon, weight, positive, negative, rawFact, evidence, reason }) {
  return {
    id,
    name,
    icon,
    weight,
    status: "measured",
    score: sourceRisk(positive.score, negative.score),
    raw_fact: rawFact,
    reason: reason || null,
    positive,
    negative,
    evidence
  };
}

function reviewSource({ id, name, icon, weight, rated, positiveCount, negativeCount, average, themes, exampleNote }) {
  const positiveScore = share(positiveCount, rated);
  const negativeScore = share(negativeCount, rated);
  const themeBit = themes && themes.length ? ` ${themes[0].theme} repeat across ${themes[0].businesses} businesses.` : "";
  return measuredSource({
    id,
    name,
    icon,
    weight,
    positive: { count: positiveCount, score: positiveScore, fact: `${positiveCount} of ${rated} are 4 or 5 star` },
    negative: { count: negativeCount, score: negativeScore, fact: `${negativeCount} of ${rated} are 1 or 2 star` },
    rawFact: `${positiveCount} of ${rated} are high star and ${negativeCount} are low star.${themeBit}`,
    evidence: { example_data: true, rated, average_rating: average, repeating_themes: (themes || []).map((theme) => theme.theme) },
    reason: exampleNote
  });
}

function complaintSource({ id, name, icon, weight, checked, clean, recent, rawFact, reason }) {
  return measuredSource({
    id,
    name,
    icon,
    weight,
    positive: { count: clean, score: share(clean, checked), fact: `${clean} of ${checked} have no recent complaint` },
    negative: { count: recent, score: share(recent, checked), fact: `${recent} complaints in the last 12 months` },
    rawFact,
    evidence: { example_data: true, checked, clean, recent_complaints: recent },
    reason
  });
}

function exampleSignals() {
  const themes = clusterThemes(EXAMPLE_REVIEWS);
  const note = "Example counts. Not a live lookup.";
  return [
    reviewSource({
      id: "google",
      name: "Google reviews",
      icon: "star",
      weight: WEIGHTS.google,
      rated: 40,
      positiveCount: 28,
      negativeCount: 6,
      average: 4.2,
      themes,
      exampleNote: note
    }),
    reviewSource({
      id: "yelp",
      name: "Yelp reviews",
      icon: "message",
      weight: WEIGHTS.yelp,
      rated: 12,
      positiveCount: 5,
      negativeCount: 4,
      average: 3.4,
      themes: [],
      exampleNote: note
    }),
    complaintSource({
      id: "bbb",
      name: "BBB complaints",
      icon: "shield",
      weight: WEIGHTS.bbb,
      checked: 4,
      clean: 3,
      recent: 3,
      rawFact: "3 complaints in 12 months across 4 businesses, and 3 have none.",
      reason: note
    }),
    complaintSource({
      id: "angi",
      name: "Angi and HomeAdvisor",
      icon: "home",
      weight: WEIGHTS.angi,
      checked: 3,
      clean: 2,
      recent: 1,
      rawFact: "1 complaint profile and 2 clean profiles out of 3 matched businesses.",
      reason: note
    }),
    missing("state_board", "State licensing", "landmark", WEIGHTS.state_board, "This state has no supported public disciplinary feed. A count was not guessed."),
    missing("nextdoor", "Nextdoor", "users", WEIGHTS.nextdoor, "Nextdoor does not offer a public thread search without a login. Nothing was collected.")
  ];
}

function liveSignals(state) {
  const board = disciplinaryLookup({ state });
  return [
    missing("google", "Google reviews", "star", WEIGHTS.google, "Star splits and review text are not in the Maps sample. The reviews feed is a queued task, not a live call, so it was not sent."),
    missing("yelp", "Yelp reviews", "message", WEIGHTS.yelp, "Yelp review text needs an official API key, and none is configured. Pages were not scraped."),
    missing("bbb", "BBB complaints", "shield", WEIGHTS.bbb, "BBB does not offer a public complaint API, and automated page collection is outside their terms. Nothing was collected."),
    missing("angi", "Angi and HomeAdvisor", "home", WEIGHTS.angi, "Angi and HomeAdvisor do not offer a public complaint API. Profiles were not scraped."),
    missing("state_board", "State licensing", "landmark", WEIGHTS.state_board, board.reason),
    missing("nextdoor", "Nextdoor", "users", WEIGHTS.nextdoor, "Nextdoor does not offer a public thread search without a login. Nothing was collected.")
  ];
}

function combinedBalance(signals) {
  const measured = signals.filter((signal) => signal.status === "measured" && signal.positive && signal.negative);
  if (!measured.length) return null;
  const weight = measured.reduce((sum, signal) => sum + signal.weight, 0);
  const positiveCount = measured.reduce((sum, signal) => sum + signal.positive.count, 0);
  const negativeCount = measured.reduce((sum, signal) => sum + signal.negative.count, 0);
  const positiveScore = Math.round(measured.reduce((sum, signal) => sum + signal.positive.score * signal.weight, 0) / weight);
  const negativeScore = Math.round(measured.reduce((sum, signal) => sum + signal.negative.score * signal.weight, 0) / weight);
  return {
    positive: { count: positiveCount, score: positiveScore, fact: `${positiveCount} positive marks` },
    negative: { count: negativeCount, score: negativeScore, fact: `${negativeCount} complaints or low star reviews` },
    note: "Counts add measured sources only. A missing source is not entered as zero."
  };
}

function explanation(signals, balance, exampleData) {
  if (!balance) return "None of the complaint sources were measured, so this is not a risk score of 0.";
  const google = signals.find((signal) => signal.id === "google");
  const bbb = signals.find((signal) => signal.id === "bbb");
  const missingNames = signals.filter((signal) => signal.status === "missing").map((signal) => signal.name);
  const lead = exampleData ? "Sample counts show" : "Measured counts show";
  const bits = [`${lead} ${balance.positive.count} positive marks and ${balance.negative.count} complaints.`];
  if (google && google.status === "measured" && google.positive.score >= google.negative.score) bits.push("Google leans positive.");
  if (bbb && bbb.status === "measured" && bbb.negative.count > 0) bits.push("BBB adds complaints.");
  if (missingNames.length) bits.push(`${missingNames.slice(0, 2).join(" and ")} were not measured.`);
  return bits.join(" ");
}

export function buildResultsRisk({ state, origin, measuredAt } = {}) {
  const sample = origin !== "live";
  const signals = sample ? exampleSignals() : liveSignals(state);
  const balance = combinedBalance(signals);
  return assembleSignalCard({
    id: "results_risk",
    title: "Results risk",
    higherMeans: "Higher means more complaints and repeated job failures, not a safer market.",
    signals,
    exampleData: sample,
    measuredAt,
    sources: [
      { name: "Google reviews", detail: "Not sent. Star splits are not in the Maps sample, and DataForSEO reviews are a queued task rather than a live call." },
      { name: "Yelp", detail: "Not sent. Review text needs an official API key. Pages are not scraped." },
      { name: "BBB", detail: "Not sent. There is no public complaint API, and automated collection is outside their terms." },
      { name: "Angi and HomeAdvisor", detail: "Not sent. There is no public complaint API." },
      { name: "State licensing", detail: "A state is measured only when a public feed is registered. Unsupported states stay not measured." },
      { name: "Nextdoor", detail: "Not sent. Public thread search requires a login." }
    ],
    method: "Each measured source turns a positive share and a negative share into one risk number: 70 percent of the weight is the negative share and 30 percent is the gap below a perfect positive share. The card score rescales those source risks by their weights. Missing sources are left out and are not zeros. This is an index, not a recommendation.",
    footerSource: "Review and complaint sources",
    explanation: explanation(signals, balance, sample),
    balance
  });
}
