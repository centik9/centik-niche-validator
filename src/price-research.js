import { independentKey, sourceStatus } from "./price-model.js";

export function dedupeFindings(findings) {
  const seen = new Set();
  const kept = [];
  for (const finding of findings) {
    const key = `${finding.niche_id}|${finding.role || "standard"}|${independentKey(finding)}|${finding.low_dollars}-${finding.high_dollars}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(finding);
  }
  return {
    findings: kept,
    independent_sources: [...new Set(kept.map((finding) => independentKey(finding)))]
  };
}

export function toCandidate(finding) {
  const status = sourceStatus(finding.source_url);
  if (status === "broken") return { accepted: false, reason: "broken_source" };
  return {
    accepted: true,
    candidate: {
      niche_id: finding.niche_id,
      role: finding.role || "standard",
      kind: "sourced",
      low_dollars: finding.low_dollars,
      high_dollars: finding.high_dollars,
      source_name: finding.source_name,
      source_url: finding.source_url,
      quote: finding.quote,
      read_date: finding.read_date,
      borrowed_from: [],
      reviewed: false,
      promoted: false,
      source_status: status,
      needs_human_review: true,
      independent_source: independentKey(finding),
      fixture: finding.fixture === true
    }
  };
}

export function buildReviewDocument(findings) {
  const rejected = [];
  const usable = [];
  for (const finding of findings) {
    const result = toCandidate(finding);
    if (!result.accepted) rejected.push({ finding, reason: result.reason });
    else usable.push(finding);
  }
  const deduped = dedupeFindings(usable);
  return {
    generated_for_review: true,
    live_prices_unchanged: true,
    independent_sources: deduped.independent_sources,
    candidates: deduped.findings.map((finding) => toCandidate(finding).candidate),
    rejected
  };
}
