import assert from "node:assert/strict";
import test from "node:test";
import { resolveCountry } from "../src/countries.js";
import { createExampleTransport } from "../src/example-transport.js";
import { exampleRows } from "../src/gazetteer.js";
import { createLocationDirectory, matchCity } from "../src/locations.js";
import { normalizePlace } from "../src/normalize.js";
import { normalizeState } from "../src/states.js";
import { exampleDeps } from "./helpers.js";
import { resolveLocation } from "../src/validator.js";

function query(city, state, countryIso = "us") {
  return {
    cityNorm: normalizePlace(city),
    stateNorm: normalizeState(state, countryIso),
    countryIso,
    codeSource: "example_gazetteer"
  };
}

test("normalizes US state abbreviations and city tokens without cross-country expansion", () => {
  assert.equal(normalizeState("TX", "us"), "texas");
  assert.equal(normalizeState("D.C.", "us"), "district of columbia");
  assert.equal(normalizeState("WA", "ca"), "wa");
  assert.equal(normalizePlace("St. Louis"), "saint louis");
  assert.equal(normalizePlace("São Paulo"), "sao paulo");
});

test("rejects subdivisions and colliding state abbreviations used as countries", () => {
  assert.equal(resolveCountry("England").ok, false);
  assert.equal(resolveCountry("TX").ok, false);
  assert.equal(resolveCountry("CA").iso, "ca");
  assert.equal(resolveCountry("United States").iso, "us");
  assert.equal(resolveCountry("Germany").iso, "de");
  assert.equal(resolveCountry("de").ok, false);
  assert.equal(resolveCountry("fr").iso, "fr");
});

test("matches Springfield, Illinois and records the other Springfields", () => {
  const result = matchCity(exampleRows("google_ads"), query("Springfield", "IL"));
  assert.equal(result.outcome, "matched");
  assert.equal(result.match.location_name, "Springfield,Illinois,United States");
  assert.equal(result.match.location_type, "City");
  assert.equal(result.match.parent.location_name, "Illinois,United States");
  assert.deepEqual(result.same_city_other_regions, ["Massachusetts", "Missouri"]);
});

test("does not match Portland, Maine to Portland, Oregon or South Portland", () => {
  const maine = matchCity(exampleRows("google_ads"), query("Portland", "Maine"));
  assert.equal(maine.match.location_name, "Portland,Maine,United States");
  assert.deepEqual(maine.same_city_other_regions, ["Oregon"]);
  const south = matchCity(exampleRows("google_ads"), query("South Portland", "ME"));
  assert.equal(south.match.location_name, "South Portland,Maine,United States");
  assert.deepEqual(south.same_city_other_regions, []);
  const spring = matchCity(exampleRows("google_ads"), query("Spring", "Illinois"));
  assert.equal(spring.outcome, "unsupported");
});

test("keeps New York City distinct from New York State", () => {
  const result = matchCity(exampleRows("google_ads"), query("New York", "NY"));
  assert.equal(result.outcome, "matched");
  assert.equal(result.match.location_type, "City");
  assert.equal(result.match.location_name, "New York,New York,United States");
  assert.ok(result.rejected_summary.wrong_type >= 1);
  const jersey = matchCity(exampleRows("google_ads"), query("New York", "New Jersey"));
  assert.equal(jersey.outcome, "unsupported");
});

test("does not treat Kansas City as Kansas and does not cross countries for Vancouver", () => {
  const kansas = matchCity(exampleRows("google_ads"), query("Kansas", "Kansas"));
  assert.equal(kansas.outcome, "unsupported");
  const city = matchCity(exampleRows("google_ads"), query("Kansas City", "MO"));
  assert.equal(city.match.location_name, "Kansas City,Missouri,United States");
  assert.deepEqual(city.same_city_other_regions, ["Kansas"]);
  const washington = matchCity(exampleRows("google_ads"), query("Vancouver", "WA"));
  assert.equal(washington.match.location_name, "Vancouver,Washington,United States");
  assert.deepEqual(washington.same_name_other_countries, ["CA"]);
  const canada = matchCity(exampleRows("google_ads"), query("Vancouver", "British Columbia", "ca"));
  assert.equal(canada.match.location_name, "Vancouver,British Columbia,Canada");
  assert.deepEqual(canada.same_name_other_countries, ["US"]);
  const abbreviated = matchCity(exampleRows("google_ads"), query("Vancouver", "WA", "ca"));
  assert.equal(abbreviated.outcome, "unsupported");
});

test("Washington, DC does not resolve as Washington state", () => {
  const dc = matchCity(exampleRows("google_ads"), query("Washington", "DC"));
  assert.equal(dc.match.location_name, "Washington,District of Columbia,United States");
  const state = matchCity(exampleRows("google_ads"), query("Washington", "Washington"));
  assert.equal(state.outcome, "unsupported");
  assert.ok(state.same_city_other_regions.includes("District of Columbia"));
});

test("uses separate example codes for Google Ads and Google Maps", () => {
  const ads = matchCity(exampleRows("google_ads"), query("Austin", "Texas"));
  const maps = matchCity(exampleRows("google_maps"), query("Austin", "Texas"));
  assert.equal(ads.match.location_name, maps.match.location_name);
  assert.notEqual(ads.match.location_code, maps.match.location_code);
  assert.equal(maps.match.code_source, "example_gazetteer");
});

test("rejects a same-named county and a parent in the wrong state", () => {
  const texas = { location_code: 1, location_name: "Texas,United States", location_code_parent: null, country_iso_code: "US", location_type: "State" };
  const county = { location_code: 2, location_name: "Austin,Texas,United States", location_code_parent: 1, country_iso_code: "US", location_type: "County" };
  const onlyCounty = matchCity([texas, county], query("Austin", "Texas"));
  assert.equal(onlyCounty.outcome, "unsupported");
  assert.equal(onlyCounty.rejected_summary.wrong_type, 1);

  const missouri = { location_code: 3, location_name: "Missouri,United States", location_code_parent: null, country_iso_code: "US", location_type: "State" };
  const illinois = { location_code: 4, location_name: "Illinois,United States", location_code_parent: null, country_iso_code: "US", location_type: "State" };
  const badParent = { location_code: 5, location_name: "Springfield,Illinois,United States", location_code_parent: 3, country_iso_code: "US", location_type: "City" };
  const unconfirmed = matchCity([missouri, illinois, badParent], query("Springfield", "Illinois"));
  assert.equal(unconfirmed.outcome, "unconfirmed");
  assert.equal(unconfirmed.match, null);

  const cook = { location_code: 6, location_name: "Cook County,Illinois,United States", location_code_parent: 4, country_iso_code: "US", location_type: "County" };
  const chicago = { location_code: 7, location_name: "Chicago,Illinois,United States", location_code_parent: 6, country_iso_code: "US", location_type: "City" };
  const walked = matchCity([illinois, cook, chicago], query("Chicago", "Illinois"));
  assert.equal(walked.outcome, "matched");
  assert.equal(walked.match.parent.location_name, "Illinois,United States");
});

test("returns ambiguous when two confirmed city rows share the name and state", () => {
  const state = { location_code: 1, location_name: "Texas,United States", location_code_parent: null, country_iso_code: "US", location_type: "State" };
  const first = { location_code: 2, location_name: "Austin,Texas,United States", location_code_parent: 1, country_iso_code: "US", location_type: "City" };
  const second = { location_code: 3, location_name: "Austin,Texas,United States", location_code_parent: 1, country_iso_code: "US", location_type: "Municipality" };
  const result = matchCity([state, first, second], query("Austin", "Texas"));
  assert.equal(result.outcome, "ambiguous");
  assert.equal(result.match, null);
  assert.equal(result.matches.length, 2);
});

test("Saint Louis resolves from St. Louis and a repeated resolve uses the location cache", async () => {
  let gets = 0;
  const base = createExampleTransport();
  const transport = {
    async request(args) {
      if (args.method === "GET") gets += 1;
      return base.request(args);
    }
  };
  const deps = exampleDeps(transport);
  const first = await resolveLocation({ city: "St. Louis", state: "MO", country: "US" }, deps);
  const second = await resolveLocation({ city: "Saint Louis", state: "Missouri", country: "United States" }, deps);
  assert.equal(first.google_ads.match.location_name, "Saint Louis,Missouri,United States");
  assert.equal(second.google_ads.match.location_code, first.google_ads.match.location_code);
  assert.equal(first.normalized_query.state_normalized, "missouri");
  assert.equal(gets, 2);
  assert.equal(first.requests.every((item) => item.sent_to_dataforseo === false), true);
  assert.equal(first.market_measurement.exhaustive_market, false);
});

test("does not cache a failed location list as an empty directory", async () => {
  let gets = 0;
  const transport = {
    async request() {
      gets += 1;
      throw new Error("list failed");
    }
  };
  const directory = createLocationDirectory(transport);
  await assert.rejects(() => directory.list("google_ads", "us"));
  await assert.rejects(() => directory.list("google_ads", "us"));
  assert.equal(gets, 2);
});
