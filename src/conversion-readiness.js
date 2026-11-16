import { isIP } from "node:net";
import { assembleSignalCard } from "./signal-score.js";

export const PHONE_PAGE_CAP = 5;
export const PAGE_TIMEOUT_MS = 8000;
export const PAGE_BYTE_CAP = 64 * 1024;
export const FOLD_CHARS = 12000;
export const NEAR_ME_SATURATION = 0.25;

const PAGE_POINTS = { phone: 100, form: 65, neither: 20 };
const WEIGHTS = { phone_vs_form: 0.4, directory_ratio: 0.35, near_me: 0.25 };

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
    evidence: null
  };
}

export function isPublicPageUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "example" || host.endsWith(".example")) return false;
  return !isBlockedAddress(host);
}

function isBlockedAddress(host) {
  const ipVersion = isIP(host);
  if (!ipVersion) return false;
  if (ipVersion === 6) {
    const lower = host.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
  }
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

export function classifyFold(html) {
  const raw = String(html || "").slice(0, FOLD_CHARS);
  const text = raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 4000);
  const phone = /tel:\s*\+?[\d().\s-]{7,}/i.test(raw)
    || /\b(call now|tap to call|click to call|call us)\b/i.test(text)
    || /\(\d{3}\)\s*\d{3}[.\s-]\d{4}/.test(text);
  const form = /<form\b/i.test(raw) || /type=["'](?:email|tel)["']/i.test(raw);
  let lead = "neither";
  if (phone) lead = "phone";
  else if (form) lead = "form";
  return { lead, phone, form };
}

function exampleLead(row) {
  const host = `${row.domain || ""} ${row.url || ""}`;
  const lead = /austinplumbing|roundrock/i.test(host) ? "phone" : "form";
  return {
    url: row.url,
    domain: row.domain || null,
    status: "measured",
    lead,
    phone: lead === "phone",
    form: lead === "form",
    example_data: true
  };
}

async function readText(response) {
  if (!response || typeof response.text !== "function") return "";
  if (!response.body || typeof response.body.getReader !== "function") {
    return String(await response.text()).slice(0, PAGE_BYTE_CAP);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < PAGE_BYTE_CAP) {
    const step = await reader.read();
    if (step.done) break;
    size += step.value.byteLength;
    chunks.push(Buffer.from(step.value));
    if (size >= PAGE_BYTE_CAP) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8").slice(0, PAGE_BYTE_CAP);
}

async function fetchOne(row, fetchImpl) {
  try {
    const response = await fetchImpl(row.url, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "text/html",
        "User-Agent": "CentikNicheValidator/0.1 (public page check)"
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS)
    });
    if (response.status >= 300 && response.status < 400) {
      return { url: row.url, domain: row.domain || null, status: "missing", reason: "The page redirected, so it was not read." };
    }
    if (!response.ok) {
      return { url: row.url, domain: row.domain || null, status: "missing", reason: `The page returned HTTP ${response.status}.` };
    }
    const html = await readText(response);
    return { url: row.url, domain: row.domain || null, status: "measured", ...classifyFold(html) };
  } catch {
    return { url: row.url, domain: row.domain || null, status: "missing", reason: "The page did not respond in time." };
  }
}

export async function collectLeadPages({ results, origin, fetchImpl } = {}) {
  const rows = (Array.isArray(results) ? results : [])
    .filter((row) => row && row.directory !== true && typeof row.url === "string" && /^https:\/\//i.test(row.url))
    .slice(0, PHONE_PAGE_CAP);
  if (!rows.length) {
    return {
      status: "missing",
      pages: [],
      example_data: origin !== "live",
      reason: "No contractor sites were in the top results, so pages were not opened."
    };
  }
  if (origin !== "live") {
    return { status: "measured", pages: rows.map(exampleLead), example_data: true, reason: null };
  }
  const liveRows = rows.filter((row) => isPublicPageUrl(row.url));
  if (!liveRows.length) {
    return {
      status: "missing",
      pages: [],
      example_data: false,
      reason: "Contractor links were not public https pages, so they were not opened."
    };
  }
  const fetchPage = fetchImpl || globalThis.fetch;
  const pages = await Promise.all(liveRows.map((row) => fetchOne(row, fetchPage)));
  return { status: "measured", pages, example_data: false, reason: null };
}

function phoneSignal(pages) {
  const classified = (pages && pages.pages || []).filter((page) => page && page.status === "measured" && PAGE_POINTS[page.lead] != null);
  if (!classified.length) {
    return missing("phone_vs_form", "Phone or form", "phone", WEIGHTS.phone_vs_form, (pages && pages.reason) || "Contractor pages were not read.");
  }
  const score = Math.round(classified.reduce((sum, page) => sum + PAGE_POINTS[page.lead], 0) / classified.length);
  const phoneCount = classified.filter((page) => page.lead === "phone").length;
  const formCount = classified.filter((page) => page.lead === "form").length;
  const total = classified.length;
  let raw = `No call button or form on ${total} contractor pages`;
  if (phoneCount >= formCount && phoneCount > 0) raw = `Call button on ${phoneCount} of ${total} contractor pages`;
  else if (formCount > 0) raw = `Quote form on ${formCount} of ${total} contractor pages`;
  return {
    id: "phone_vs_form",
    name: "Phone or form",
    icon: "phone",
    weight: WEIGHTS.phone_vs_form,
    status: "measured",
    score,
    raw_fact: raw,
    reason: pages && pages.example_data ? "Example page text. The live site was not fetched." : null,
    evidence: {
      example_data: Boolean(pages && pages.example_data),
      checked: total,
      phone: phoneCount,
      form: formCount,
      neither: classified.filter((page) => page.lead === "neither").length,
      cap: PHONE_PAGE_CAP,
      fold: "The first part of the html is treated as above the fold. The page is not rendered in a browser."
    }
  };
}

function directorySignal(organic) {
  const counts = organic && organic.directory_counts;
  const total = counts && counts.top10_results;
  const directories = counts && counts.top10_directory_count;
  if (!counts || counts.status === "missing" || !Number.isInteger(total) || total <= 0 || !Number.isInteger(directories)) {
    return missing("directory_ratio", "Directory ratio", "list", WEIGHTS.directory_ratio, "Top organic results were not returned, so the directory ratio was not computed.");
  }
  const contractors = total - directories;
  return {
    id: "directory_ratio",
    name: "Directory ratio",
    icon: "list",
    weight: WEIGHTS.directory_ratio,
    status: "measured",
    score: Math.round((100 * contractors) / total),
    raw_fact: `${directories} of ${total} top results are directories`,
    reason: null,
    evidence: {
      directories,
      contractors,
      results: total,
      share: counts.top10_directory_share
    }
  };
}

function nearMeSignal(demand) {
  const clusters = Array.isArray(demand && demand.clusters) ? demand.clusters : [];
  const near = clusters.filter((cluster) => (cluster.phrases || []).some((phrase) => /\bnear me\b/i.test(phrase)));
  if (!near.length) {
    return missing("near_me", "Near me phrasing", "map-pin", WEIGHTS.near_me, "No near me phrase was in the keyword list.");
  }
  if (near.some((cluster) => cluster.status === "missing" || !Number.isInteger(cluster.representative_volume))) {
    return missing("near_me", "Near me phrasing", "map-pin", WEIGHTS.near_me, "The near me phrase had no volume, so its share was not treated as zero.");
  }
  const coverage = demand && demand.clustered_coverage_volume;
  const total = coverage && Number.isInteger(coverage.value) ? coverage.value : null;
  const usable = coverage && (coverage.status === "measured" || coverage.status === "measured_zero" || coverage.status === "partial");
  if (!usable || total == null || total <= 0) {
    return missing("near_me", "Near me phrasing", "map-pin", WEIGHTS.near_me, "Clustered volume was not positive, so a near me share was not computed.");
  }
  const nearVolume = near.reduce((sum, cluster) => sum + cluster.representative_volume, 0);
  const share = nearVolume / total;
  const percent = Math.round(share * 100);
  return {
    id: "near_me",
    name: "Near me phrasing",
    icon: "map-pin",
    weight: WEIGHTS.near_me,
    status: "measured",
    score: Math.min(100, Math.round((100 * share) / NEAR_ME_SATURATION)),
    raw_fact: `${percent} percent of clustered volume is near me phrasing`,
    reason: coverage.partial ? "Some other phrases had no volume. Those phrases were left out, not counted as zero." : null,
    evidence: {
      near_me_volume: nearVolume,
      clustered_volume: total,
      share: Math.round(share * 1000) / 1000,
      saturation: NEAR_ME_SATURATION,
      partial: Boolean(coverage.partial)
    }
  };
}

function explanation(signals, exampleData) {
  const bits = [];
  if (exampleData) bits.push("Sample data.");
  for (const id of ["phone_vs_form", "directory_ratio", "near_me"]) {
    const signal = signals.find((item) => item.id === id);
    if (signal && signal.status === "measured") bits.push(`${signal.raw_fact}.`);
    else bits.push(`${signal ? signal.name : "A signal"} was not measured.`);
  }
  return bits.join(" ");
}

export function buildConversionReadiness({ demand, organic, pages, origin, measuredAt } = {}) {
  const exampleData = origin !== "live" || Boolean(pages && pages.example_data && origin !== "live");
  const sample = origin !== "live";
  const signals = [phoneSignal(pages), directorySignal(organic), nearMeSignal(demand)];
  return assembleSignalCard({
    id: "conversion_readiness",
    title: "Conversion readiness",
    higherMeans: "Higher means buyers call or book from the page, not a directory.",
    signals,
    exampleData: sample,
    measuredAt,
    sources: [
      { name: "Contractor pages", detail: "Free https fetch of up to 5 contractor sites already in the organic results. Not a DataForSEO call. The first part of the html stands in for above the fold." },
      { name: "Organic results", detail: "Directory share uses the existing top 10 directory count. It does not change the grade." },
      { name: "Search phrases", detail: "Near me share uses clustered coverage volume already pulled. A 25 percent share scores 100. A missing near me volume is not zero." }
    ],
    method: "Phone or form is 40 percent, directory ratio is 35 percent, and near me phrasing is 25 percent. Phone on a page scores 100, a form scores 65, and neither scores 20. Missing signals are left out and the rest are rescaled. This is an index, not a recommendation.",
    footerSource: "Page text and search phrases",
    explanation: explanation(signals, sample),
    balance: null
  });
}
