import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import {
  DEFAULT_LEAD_CONVERSION,
  RESEARCHED_RATES,
  conversionFlagCopy,
  findResearchedRate,
  leadRangeFromConversion,
  resolveLeadConversion
} from "../src/lead-conversion-rates.js";

const DASHBOARD_START = "/* lead-conversion-rates-start */";
const DASHBOARD_END = "/* lead-conversion-rates-end */";

function typographicDash(text) {
  return text.includes("\u2014") || text.includes("\u2013");
}

function loadDashboardApi() {
  const source = fs.readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const start = source.indexOf(DASHBOARD_START);
  const end = source.indexOf(DASHBOARD_END);
  assert.ok(start >= 0 && end > start, "dashboard.js is missing the lead-conversion-rates markers");
  const block = source.slice(start + DASHBOARD_START.length, end);
  const context = { LeadConversion: undefined };
  vm.runInNewContext(`${block}\nthis.LeadConversion = LeadConversion;`, context);
  return context.LeadConversion;
}

test("documented default still matches 38, 45, and 52 of 2900 and is not applied", () => {
  assert.equal(DEFAULT_LEAD_CONVERSION.low, 38 / 2900);
  assert.equal(DEFAULT_LEAD_CONVERSION.mid, 45 / 2900);
  assert.equal(DEFAULT_LEAD_CONVERSION.high, 52 / 2900);
  assert.equal(DEFAULT_LEAD_CONVERSION.status, "default");
  for (const id of ["plumbing", "electrician", "hvac", "locksmith", "garage-door"]) {
    assert.notEqual(resolveLeadConversion(id, id).status, "default");
  }
});

test("seeded plumbing, electrician, hvac, cleaning, and roofing apply the LocaliQ rates", () => {
  const cases = [
    ["plumbing", "Plumbing", "plumbing", 7.63],
    ["emergency-plumbing", "Emergency plumbing", "plumbing", 7.63],
    ["water-heater-repair", "Water heater repair", "plumbing", 7.63],
    ["drain-cleaning", "Drain cleaning", "plumbing", 7.63],
    ["hvac", "HVAC repair", "HVAC", 7.02],
    ["electrician", "Electrician", "electricians", 9.08],
    ["cleaning", "Cleaning", "cleaning", 17.65],
    ["roofing", "Roofing", "roofing", 3.7]
  ];
  for (const [id, label, category, percent] of cases) {
    const resolved = resolveLeadConversion(id, label);
    assert.equal(resolved.status, "applied", id);
    assert.equal(resolved.applied, true, id);
    assert.equal(resolved.metric_type, "click_to_lead", id);
    assert.equal(resolved.category_label, category, id);
    assert.equal(resolved.cvr_percent, percent, id);
    assert.equal(resolved.mid, percent / 100, id);
  }
  const hvac = resolveLeadConversion("hvac", "HVAC repair");
  assert.equal(hvac.cvr_percent, (6.56 + 7.48) / 2);
});

test("1600 electrician and 1056 water-heater no longer use the 38-52 of 2900 range", () => {
  const electrician = leadRangeFromConversion(1600, resolveLeadConversion("electrician", "Electrician"));
  assert.deepEqual(electrician, { low: 145, high: 145, mid: 145 });
  assert.equal(electrician.low, Math.round(1600 * (9.08 / 100)));
  assert.notDeepEqual(electrician, { low: 21, high: 29, mid: 25 });

  const waterHeater = leadRangeFromConversion(1056, resolveLeadConversion("water-heater-repair", "Water heater repair"));
  assert.deepEqual(waterHeater, { low: 81, high: 81, mid: 81 });
  assert.equal(waterHeater.low, Math.round(1056 * (7.63 / 100)));
  assert.notDeepEqual(waterHeater, { low: 14, high: 19, mid: 16 });

  const baselineElectrician = {
    low: Math.max(1, Math.round((1600 * 38) / 2900)),
    high: Math.max(1, Math.round((1600 * 52) / 2900)),
    mid: Math.max(1, Math.round((1600 * 45) / 2900))
  };
  assert.deepEqual(baselineElectrician, { low: 21, high: 29, mid: 25 });
  assert.notDeepEqual(electrician, baselineElectrician);
});

test("unmapped niches show looking-up and do not use 38-52 of 2900", () => {
  const unmapped = [
    ["locksmith", "Locksmith"],
    ["garage-door", "Garage door repair"],
    ["mobile-welding", "Mobile welding"],
    ["retaining-wall", "Retaining wall repair"],
    ["crawl-space", "Crawl space encapsulation"],
    ["custom-widget-repair", "Custom widget repair"]
  ];
  for (const [id, label] of unmapped) {
    const resolved = resolveLeadConversion(id, label);
    assert.equal(resolved.status, "looking_up", id);
    assert.equal(resolved.applied, false, id);
    assert.equal(resolved.mid, null, id);
    assert.equal(leadRangeFromConversion(2900, resolved), null, id);
    assert.equal(leadRangeFromConversion(1600, resolved), null, id);
    const copy = conversionFlagCopy(resolved);
    assert.match(copy, /Looking up a conversion rate/);
    assert.match(copy, new RegExp(label));
    assert.match(copy, /We don't have a studied rate yet\./);
  }
  const garages = findResearchedRate("garages", "Garages");
  assert.equal(garages.cvr_percent, 5.66);
  assert.equal(garages.applied, false);
  const garageDoor = findResearchedRate("garage-door", "Garage door repair");
  assert.equal(garageDoor, null);
  assert.notEqual(resolveLeadConversion("garage-door", "Garage door repair").cvr_percent, 5.66);
});

test("drain cleaning stays on the plumbing rate, not the cleaning rate", () => {
  const resolved = resolveLeadConversion("drain-cleaning", "Drain cleaning");
  assert.equal(resolved.category_id, "plumbing");
  assert.equal(resolved.cvr_percent, 7.63);
  assert.notEqual(resolved.cvr_percent, 17.65);
});

test("a hypothetical applied search-to-lead row changes the lead range", () => {
  const rates = [
    ...RESEARCHED_RATES,
    {
      id: "locksmith",
      category_label: "locksmiths",
      aliases: ["locksmith", "locksmiths"],
      metric_type: "search_to_lead",
      cvr_percent: 10,
      low: 0.1,
      mid: 0.1,
      high: 0.1,
      source: "test-only",
      year: 2026,
      applied: true,
      notes: "Hypothetical row for tests only."
    }
  ];
  const resolved = resolveLeadConversion("locksmith", "Locksmith", { rates });
  assert.equal(resolved.status, "applied");
  assert.equal(resolved.metric_type, "search_to_lead");
  assert.deepEqual(leadRangeFromConversion(1000, resolved), { low: 100, high: 100, mid: 100 });
  assert.equal(leadRangeFromConversion(2900, resolveLeadConversion("locksmith", "Locksmith")), null);
});

test("flag copy is plain and has no typographic dash", () => {
  const applied = conversionFlagCopy(resolveLeadConversion("plumbing", "Plumbing"));
  assert.equal(
    applied,
    "These leads use a published ad click-to-lead rate for plumbing. That is the share of ad clicks that become a lead, not the share of all Google searches."
  );
  const looking = conversionFlagCopy(resolveLeadConversion("locksmith", "Locksmith"));
  assert.equal(
    looking,
    "Looking up a conversion rate for Locksmith. We don't have a studied rate yet."
  );
  assert.equal(typographicDash(applied), false);
  assert.equal(typographicDash(looking), false);
  const dashboard = fs.readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  const src = fs.readFileSync(new URL("../src/lead-conversion-rates.js", import.meta.url), "utf8");
  for (const [name, text] of [["dashboard", dashboard], ["html", html], ["css", css], ["src", src]]) {
    assert.equal(text.includes("\u2014"), false, name);
    assert.equal(text.includes("\u2013"), false, name);
  }
});

test("dashboard.js keeps the same apply rules as the source module", () => {
  const api = loadDashboardApi();
  const niches = [
    ["plumbing", "Plumbing"],
    ["emergency-plumbing", "Emergency plumbing"],
    ["water-heater-repair", "Water heater repair"],
    ["hvac", "HVAC repair"],
    ["electrician", "Electrician"],
    ["cleaning", "Cleaning"],
    ["roofing", "Roofing"],
    ["locksmith", "Locksmith"],
    ["garage-door", "Garage door repair"],
    ["mobile-welding", "Mobile welding"],
    ["retaining-wall", "Retaining wall repair"],
    ["crawl-space", "Crawl space encapsulation"]
  ];
  for (const [id, label] of niches) {
    const fromSrc = resolveLeadConversion(id, label);
    const fromDash = api.resolveLeadConversion(id, label);
    assert.equal(fromDash.status, fromSrc.status, id);
    assert.equal(fromDash.cvr_percent, fromSrc.cvr_percent, id);
    assert.equal(fromDash.category_label, fromSrc.category_label, id);
    assert.equal(
      JSON.stringify(api.leadRangeFromConversion(1600, fromDash)),
      JSON.stringify(leadRangeFromConversion(1600, fromSrc)),
      id
    );
    assert.equal(api.conversionFlagCopy(fromDash), conversionFlagCopy(fromSrc), id);
  }
  assert.equal(
    JSON.stringify(api.leadRangeFromConversion(1600, api.resolveLeadConversion("electrician", "Electrician"))),
    JSON.stringify({ low: 145, high: 145, mid: 145 })
  );
  assert.equal(
    JSON.stringify(api.leadRangeFromConversion(1056, api.resolveLeadConversion("water-heater-repair", "Water heater repair"))),
    JSON.stringify({ low: 81, high: 81, mid: 81 })
  );
});
