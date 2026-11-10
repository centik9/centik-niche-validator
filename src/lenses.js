import { priceFor } from "./job-prices.js";
import { findFixture, nationalGuide } from "./discovery-fixtures.js";
import { slugForLabel } from "./subniche-discovery.js";

export const LENS_CLASSROOM = "classroom";
export const LENS_FOUR_YES = "four_yes";

export const LENS_LABELS = {
  classroom: "Classroom floor",
  four_yes: "Jesse's four-yes test"
};

// "About 1,500 operators in the state" is a directory test, not a city microsite hard fail.
// A measured count is yes only inside this published band. Counts outside it are no on this row only.
export const DIRECTORY_ABOUT_LOW = 1000;
export const DIRECTORY_ABOUT_HIGH = 2000;

const CLASSROOM_FLOOR = 500;
const FOUR_YES_FLOOR = 5000;

const URGENT = /\b(emergenc(?:y|ies)|urgent|after hours|after-hours|insurance|water damage|fire damage|smoke damage|damage control|restoration|pests?|termites?|rodents?|bed ?bugs?|exterminator|locksmiths?|lockouts?|re-?key|water heaters?|failed heaters?)\b/i;
const PLANNED = /\b(retaining walls?|septic|driveways?|crawl ?spaces?|encapsulation|pool remodels?|pool remodeling|resurfacing|repipes?|remodels?)\b/i;
const LOCKSMITH = /\b(locksmiths?|lockouts?|re-?key)\b/i;

export function normalizeLens(value) {
  if (value === LENS_FOUR_YES || value === "four-yes" || value === "jesse") return LENS_FOUR_YES;
  return LENS_CLASSROOM;
}

export function verdictWord(verdict) {
  if (verdict === "pass") return "Pass";
  if (verdict === "fail") return "Fail";
  if (verdict === "caution") return "Caution";
  if (verdict === "hard_stop") return "Hard stop";
  return "Not enough evidence";
}

export function markWord(mark) {
  if (mark === "yes") return "Yes";
  if (mark === "no") return "No";
  return "Not enough evidence";
}

function classroomVerdict(urgent, job, flagged) {
  if (flagged) return "hard_stop";
  if (job.mark === "no") return "fail";
  if (job.mark === "yes" && urgent.mark === "yes") return "pass";
  if (job.mark === "yes") return "caution";
  return "not_enough_evidence";
}

function fourYesVerdict(rows, flagged) {
  if (flagged) return "hard_stop";
  const gating = rows.filter((row) => row.gates !== false);
  if (!gating.length) return "not_enough_evidence";
  if (gating.some((row) => row.mark === "no")) return "fail";
  if (gating.every((row) => row.mark === "yes")) return "pass";
  return "not_enough_evidence";
}

function urgentRow(service) {
  const text = String(service || "");
  const locksmith = LOCKSMITH.test(text);
  let mark = "not_enough_evidence";
  let evidence = "The service name does not say whether people phone for a one-off emergency. That was not filled in as a no.";
  if (URGENT.test(text)) {
    mark = "yes";
    evidence = "The service name matches urgent one-off work (emergency, insurance, damage, pest, or locksmith).";
  } else if (PLANNED.test(text)) {
    mark = "no";
    evidence = "The service name reads as planned project work, not a one-off phone emergency.";
  }
  return {
    id: "urgent",
    label: "Urgent, one-off work people phone about",
    mark,
    gates: true,
    evidence,
    note: locksmith
      ? "Emergency locksmith is the course example of this floor. It is a note, not an extra fail."
      : "Looks for emergency, insurance, damage control, or pest work."
  };
}

export function priceMark(price, floor) {
  if (!price || (price.status !== "published" && price.status !== "conditional")) {
    return {
      mark: "not_enough_evidence",
      low: null,
      high: null,
      evidence: "No published job range was on file. A price was not invented."
    };
  }
  const unit = String(price.unit || "");
  const low = Number.isInteger(price.low_dollars) ? price.low_dollars : null;
  const high = Number.isInteger(price.high_dollars) ? price.high_dollars : null;
  if (unit === "hour" || unit === "per_hour") {
    return {
      mark: "not_enough_evidence",
      low,
      high,
      unit,
      evidence: "The published figure is an hourly rate, not a finished job total. The floor was not marked yes or no from an hour rate."
    };
  }
  if (low === null || high === null || high < low) {
    return {
      mark: "not_enough_evidence",
      low,
      high,
      evidence: "The published range was not a closed job total. A job value was not invented."
    };
  }
  if (low >= floor) {
    return {
      mark: "yes",
      low,
      high,
      evidence: `The published low end is $${low.toLocaleString("en-US")}, which clears $${floor.toLocaleString("en-US")}.`
    };
  }
  if (high < floor) {
    return {
      mark: "no",
      low,
      high,
      evidence: `The published high end is $${high.toLocaleString("en-US")}, which is below $${floor.toLocaleString("en-US")}.`
    };
  }
  return {
    mark: "not_enough_evidence",
    low,
    high,
    evidence: `The published range crosses $${floor.toLocaleString("en-US")}. A typical job inside that range was not measured, so this is not a yes or a no.`
  };
}

function directoryRow(count) {
  const base = {
    id: "directory",
    label: "About 1,500 operators in the state",
    gates: false,
    note: "Directory test. Shown for a microsite, not a silent fail."
  };
  if (!count || count.status !== "measured" || !Number.isInteger(count.value)) {
    return {
      ...base,
      mark: "not_enough_evidence",
      evidence: "No measured state operator count was on file. Named local contractors are not treated as about 1,500 operators."
    };
  }
  const about = count.value >= DIRECTORY_ABOUT_LOW && count.value <= DIRECTORY_ABOUT_HIGH;
  return {
    ...base,
    mark: about ? "yes" : "no",
    evidence: `${count.value.toLocaleString("en-US")} operators in the state. About 1,500 means ${DIRECTORY_ABOUT_LOW.toLocaleString("en-US")} to ${DIRECTORY_ABOUT_HIGH.toLocaleString("en-US")} on this directory test.`
  };
}

function observationRow({ id, label, value, yesStatus, noStatus, missing }) {
  const status = value && value.status;
  if (status === yesStatus) {
    return { id, label, mark: "yes", gates: true, evidence: value.note || "Observed.", note: value.note || "" };
  }
  if (status === noStatus) {
    return { id, label, mark: "no", gates: true, evidence: value.note || "Observed as not meeting this row.", note: value.note || "" };
  }
  return {
    id,
    label,
    mark: "not_enough_evidence",
    gates: true,
    evidence: (value && value.note) || missing,
    note: (value && value.note) || missing
  };
}

export function evaluateLenses(input = {}) {
  const service = String(input.service || "");
  const price = input.price || null;
  const job = priceMark(price, CLASSROOM_FLOOR);
  const ticket = priceMark(price, FOUR_YES_FLOOR);
  const urgent = urgentRow(service);
  const flagged = LOCKSMITH.test(service) || input.flagged === true;
  const classroomRows = [
    urgent,
    {
      id: "job_floor",
      label: "Job value $500 or more",
      mark: job.mark,
      gates: true,
      evidence: job.evidence,
      note: "Course guidance is ideally $1,000 to $2,000. That line is not a second hard fail. A fail on this lens is only a published job total under $500."
    }
  ];
  const fourRows = [
    {
      id: "ticket",
      label: "Ticket size of $5,000 or more per job",
      mark: ticket.mark,
      gates: true,
      evidence: ticket.evidence,
      note: price && price.note ? price.note : "Uses the published range only. A city price was not invented."
    },
    directoryRow(input.state_operator_count),
    observationRow({
      id: "best_query",
      label: 'Weak search results for "best [service] in [location]"',
      value: input.best_query,
      yesStatus: "weak",
      noStatus: "not_weak",
      missing: "Not enough evidence. A localized best-query check was not on file, so this is not a no."
    }),
    observationRow({
      id: "ads",
      label: "Sponsored ads on that search",
      value: input.sponsored_ads,
      yesStatus: "present",
      noStatus: "absent",
      missing: "Not enough evidence. Ads were not observed, so this is not a no."
    })
  ];
  const classroom = {
    id: LENS_CLASSROOM,
    label: LENS_LABELS.classroom,
    verdict: classroomVerdict(urgent, job, flagged),
    rows: classroomRows,
    note: flagged
      ? "Emergency locksmith is the course example of this floor. It is also a Rank Expand flagged niche, so the verdict is Hard stop, never Pass."
      : null
  };
  const fourYes = {
    id: LENS_FOUR_YES,
    label: LENS_LABELS.four_yes,
    verdict: fourYesVerdict(fourRows, flagged),
    rows: fourRows,
    note: "Directory test. Shown for a microsite, not a silent fail."
  };
  return {
    classroom,
    four_yes: fourYes,
    disagree: classroom.verdict !== fourYes.verdict,
    flagged,
    hard_stop: flagged
  };
}

export function sampleWaterHeaterRules() {
  const lenses = evaluateLenses({
    service: "water heater repair",
    price: {
      status: "published",
      estimated: true,
      low_dollars: 500,
      high_dollars: 1800,
      unit: "per_job",
      city_adjusted: false,
      note: "Sample data for the rules preview. Not the published HomeGuide repair range and not a live check."
    },
    best_query: { status: "not_enough_evidence", note: "Not checked" },
    sponsored_ads: { status: "present", note: "Sample data. 3 ads seen. Not a live check." },
    state_operator_count: { status: "unavailable", note: "Not on file" }
  });
  return {
    service: "Water heater repair",
    city: "Austin",
    state: "Texas",
    example_data: true,
    sample_data: true,
    paid_dataforseo_called: false,
    kind_of_job: "Failed heater, one-off",
    raw: {
      job_ticket: "$500 to $1,800",
      kind_of_job: "Failed heater, one-off",
      operators: "Not on file",
      best_query: "Not checked",
      ads: "3 seen",
      flagged: "No"
    },
    price: {
      status: "published",
      estimated: true,
      low_dollars: 500,
      high_dollars: 1800,
      unit: "per_job",
      city_adjusted: false,
      note: "Sample data. Not city adjusted and not a live check."
    },
    ...lenses
  };
}

function publishedFromCatalog(service) {
  const slug = slugForLabel(service);
  const row = priceFor(slug);
  if (row && row.status === "published" && Number.isInteger(row.low_dollars) && Number.isInteger(row.high_dollars)) {
    return {
      status: "published",
      low_dollars: row.low_dollars,
      high_dollars: row.high_dollars,
      unit: row.unit || "per_job",
      city_adjusted: false,
      estimated: false,
      source_name: row.source_name,
      source_url: row.url,
      note: "National range, not city adjusted."
    };
  }
  return null;
}

export function evaluateService({ service, city, state } = {}) {
  if (/water heater/i.test(String(service || "")) && !findFixture(service, city, state)) {
    const sample = sampleWaterHeaterRules();
    return { ...sample, city: city || sample.city, state: state || sample.state };
  }
  const fixture = findFixture(service, city, state);
  const familyGuide = nationalGuide(service);
  const price = (fixture && fixture.price && fixture.price.status === "published")
    ? fixture.price
    : (familyGuide || publishedFromCatalog(service));
  const lenses = evaluateLenses({
    service,
    price,
    state_operator_count: fixture ? fixture.state_operator_count : null,
    best_query: fixture ? fixture.best_query : null,
    sponsored_ads: fixture ? fixture.sponsored_ads : null
  });
  return {
    service: service || "",
    city: city || null,
    state: state || null,
    paid_dataforseo_called: false,
    price: price || { status: "unavailable", low_dollars: null, high_dollars: null, note: "No published job range was on file. A price was not invented." },
    ...lenses
  };
}
