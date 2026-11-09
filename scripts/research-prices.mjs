import { readFileSync, writeFileSync } from "node:fs";
import { buildReviewDocument } from "../src/price-research.js";

const input = process.argv[2];
const output = process.argv[3];
if (!input || !output) {
  console.error("Usage: node scripts/research-prices.mjs findings.json review.json");
  process.exit(1);
}

const parsed = JSON.parse(readFileSync(input, "utf8"));
const findings = Array.isArray(parsed) ? parsed : parsed.findings;
const review = buildReviewDocument(findings);
writeFileSync(output, `${JSON.stringify(review, null, 2)}\n`);
console.log(`Wrote ${review.candidates.length} candidate(s) for human review. Live prices were not changed.`);
