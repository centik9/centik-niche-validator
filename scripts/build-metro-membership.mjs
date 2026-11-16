import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const placeUrl = "https://www2.census.gov/geo/docs/reference/codes2020/national_place_by_county2020.txt";
const cbsaUrl = "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx";

function pad(value, width) {
  return String(value ?? "").trim().padStart(width, "0");
}

function xmlText(source) {
  return source
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readZipEntries(buffer) {
  const entries = new Map();
  let offset = 0;
  while (offset + 30 < buffer.length) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const compressed = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    const bytes = buffer.subarray(start, start + compressed);
    const data = method === 0 ? bytes : inflateRawSync(bytes);
    entries.set(name, data);
    offset = start + compressed;
  }
  return entries;
}

function parseSharedStrings(xml) {
  const strings = [];
  const pattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match = pattern.exec(xml);
  while (match) {
    const parts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((part) => xmlText(part[1]));
    strings.push(parts.join(""));
    match = pattern.exec(xml);
  }
  return strings;
}

function columnIndex(ref) {
  const letters = String(ref).replace(/[0-9]/g, "");
  let index = 0;
  for (const char of letters) index = (index * 26) + (char.charCodeAt(0) - 64);
  return index - 1;
}

function parseDelineation(buffer) {
  const entries = readZipEntries(buffer);
  const strings = parseSharedStrings(entries.get("xl/sharedStrings.xml").toString("utf8"));
  const sheet = entries.get("xl/worksheets/sheet1.xml").toString("utf8");
  const rows = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch = rowPattern.exec(sheet);
  while (rowMatch) {
    const cells = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
    let cellMatch = cellPattern.exec(rowMatch[1]);
    while (cellMatch) {
      const attrs = cellMatch[1] || cellMatch[3] || "";
      const body = cellMatch[2] || "";
      const ref = (attrs.match(/\br="([^"]+)"/) || [])[1];
      const type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || "";
      const raw = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let value = "";
      if (type === "s" && raw !== undefined) value = strings[Number(raw)] || "";
      else if (type === "inlineStr") value = xmlText((body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/) || [])[1] || "");
      else if (raw !== undefined) value = xmlText(raw);
      if (ref) cells[columnIndex(ref)] = value.trim();
      cellMatch = cellPattern.exec(rowMatch[1]);
    }
    if (cells.length) rows.push(cells);
    rowMatch = rowPattern.exec(sheet);
  }
  return rows;
}

function parsePlaceCounties(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split("|");
  const stateIndex = header.indexOf("STATEFP");
  const countyIndex = header.indexOf("COUNTYFP");
  const placeIndex = header.indexOf("PLACEFP");
  if (stateIndex < 0 || countyIndex < 0 || placeIndex < 0) {
    throw new Error("Place-by-county header is missing STATEFP, COUNTYFP, or PLACEFP.");
  }
  const byPlace = new Map();
  for (const line of lines.slice(1)) {
    const cells = line.split("|");
    const place = pad(cells[stateIndex], 2) + pad(cells[placeIndex], 5);
    const county = pad(cells[stateIndex], 2) + pad(cells[countyIndex], 3);
    if (!/^\d{7}$/.test(place) || !/^\d{5}$/.test(county)) continue;
    const list = byPlace.get(place) || new Set();
    list.add(county);
    byPlace.set(place, list);
  }
  return byPlace;
}

const extract = JSON.parse(readFileSync(path.join(root, "data", "acs-2023-5yr-extract.json"), "utf8"));
const placeText = await (await fetch(placeUrl)).text();
const cbsaBuffer = Buffer.from(await (await fetch(cbsaUrl)).arrayBuffer());
const placeCounties = parsePlaceCounties(placeText);
const delineation = parseDelineation(cbsaBuffer);

const countyCbsa = new Map();
for (const cells of delineation) {
  const cbsa = pad(cells[0], 5);
  const state = pad(cells[9], 2);
  const county = pad(cells[10], 3);
  if (!/^\d{5}$/.test(cbsa) || cbsa === "00000") continue;
  if (!/^\d{2}$/.test(state) || !/^\d{3}$/.test(county)) continue;
  const fips = state + county;
  const prior = countyCbsa.get(fips);
  if (prior && prior !== cbsa) throw new Error(`County ${fips} is in both CBSA ${prior} and ${cbsa}.`);
  countyCbsa.set(fips, cbsa);
}

const places = {};
for (const geoid of Object.keys(extract.places).sort()) {
  const counties = placeCounties.get(geoid);
  if (!counties) continue;
  places[geoid] = [...counties].sort();
}
const counties = {};
for (const fips of [...countyCbsa.keys()].sort()) {
  if (!extract.counties[fips]) continue;
  counties[fips] = countyCbsa.get(fips);
}

const payload = {
  meta: {
    place_county_file: placeUrl,
    place_county_vintage: "2020 Census national place-by-county codes",
    cbsa_file: cbsaUrl,
    cbsa_vintage: "OMB July 2023 core based statistical area delineation, Census list 1",
    joined_to: "data/acs-2023-5yr-extract.json",
    rule: "Each place lists every county the Census file names for it. Each county lists the one CBSA that contains it. A county absent from the delineation is outside every CBSA. Connecticut's 2020 county codes are not the 2023 planning-region codes in the ACS extract, so those places stay unjoined instead of being reassigned.",
    place_rows: Object.keys(places).length,
    county_rows: Object.keys(counties).length
  },
  place_counties: places,
  county_cbsa: counties
};

const destination = path.join(root, "data", "metro-membership.json");
writeFileSync(destination, JSON.stringify(payload));
console.log({
  places: payload.meta.place_rows,
  counties: payload.meta.county_rows,
  bytes: readFileSync(destination).length,
  leland: places["3737680"],
  leland_cbsa: counties["37019"],
  austin_place: places["4805000"],
  round_rock: places["4863500"]
});
