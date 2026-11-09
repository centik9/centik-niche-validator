import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "data");
const base = "https://www2.census.gov/programs-surveys/acs/summary_file/2023/table-based-SF/data/5YRData";
const tables = {
  housing: `${base}/acsdt5y2023-b25001.dat`,
  tenure: `${base}/acsdt5y2023-b25003.dat`,
  yearBuilt: `${base}/acsdt5y2023-b25034.dat`,
  income: `${base}/acsdt5y2023-b19013.dat`
};
const gazetteers = {
  county: "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip",
  place: "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip",
  cbsa: "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_cbsa_national.zip"
};

function keep(geoId) {
  if (geoId.startsWith("0500000US")) return { kind: "county", id: geoId.slice(-5) };
  if (geoId.startsWith("1600000US")) return { kind: "place", id: geoId.slice(-7) };
  if (geoId.startsWith("310M700US") || geoId.startsWith("310M500US")) return { kind: "metro", id: geoId.slice(-5) };
  return null;
}

function num(value) {
  if (value === undefined || value === null || value === "" || value === ".") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0) return null;
  return parsed;
}

async function readLines(url, onLine) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status} ${url}`);
  const reader = Readable.fromWeb(response.body);
  let leftover = "";
  let header = null;
  for await (const chunk of reader) {
    leftover += chunk.toString("latin1");
    let index = leftover.indexOf("\n");
    while (index >= 0) {
      const line = leftover.slice(0, index).replace(/\r$/, "");
      leftover = leftover.slice(index + 1);
      if (!header) header = line.split("|");
      else if (line) onLine(header, line.split("|"));
      index = leftover.indexOf("\n");
    }
  }
  if (leftover.trim()) {
    if (!header) header = leftover.split("|");
    else onLine(header, leftover.replace(/\r$/, "").split("|"));
  }
}

async function readZipText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gazetteer failed ${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const dir = mkdtempSync(path.join(tmpdir(), "gaz-"));
  const zipPath = path.join(dir, "file.zip");
  await writeFile(zipPath, bytes);
  const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).trim().split(/\n/);
  const textName = listing.find((name) => name.endsWith(".txt"));
  if (!textName) throw new Error(`No text file in ${url}`);
  return execFileSync("unzip", ["-p", zipPath, textName], { encoding: "latin1", maxBuffer: 32 * 1024 * 1024 });
}

function parseGazetteer(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split("\t").map((cell) => cell.trim());
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split("\t");
    const row = {};
    header.forEach((key, index) => {
      row[key] = (cells[index] || "").trim();
    });
    rows.push(row);
  }
  return rows;
}

function blank() {
  return { hu: null, occ: null, own: null, ytot: null, old: null, inc: null };
}

const records = new Map();
function slot(kind, id) {
  const key = `${kind}:${id}`;
  if (!records.has(key)) records.set(key, { kind, id, ...blank() });
  return records.get(key);
}

console.log("reading housing units");
await readLines(tables.housing, (header, cells) => {
  const geo = keep(cells[0]);
  if (!geo) return;
  const estimate = header.indexOf("B25001_E001");
  slot(geo.kind, geo.id).hu = num(cells[estimate]);
});

console.log("reading tenure");
await readLines(tables.tenure, (header, cells) => {
  const geo = keep(cells[0]);
  if (!geo) return;
  const row = slot(geo.kind, geo.id);
  row.occ = num(cells[header.indexOf("B25003_E001")]);
  row.own = num(cells[header.indexOf("B25003_E002")]);
});

console.log("reading year built");
await readLines(tables.yearBuilt, (header, cells) => {
  const geo = keep(cells[0]);
  if (!geo) return;
  const row = slot(geo.kind, geo.id);
  row.ytot = num(cells[header.indexOf("B25034_E001")]);
  const olderColumns = ["B25034_E007", "B25034_E008", "B25034_E009", "B25034_E010", "B25034_E011"];
  const parts = olderColumns.map((column) => num(cells[header.indexOf(column)]));
  row.old = parts.every((part) => part === null) ? null : parts.reduce((sum, part) => sum + (part || 0), 0);
  if (parts.some((part) => part === null) && parts.some((part) => part !== null)) row.oldPartial = true;
});

console.log("reading income");
await readLines(tables.income, (header, cells) => {
  const geo = keep(cells[0]);
  if (!geo) return;
  slot(geo.kind, geo.id).inc = num(cells[header.indexOf("B19013_E001")]);
});

console.log("reading gazetteers");
const counties = parseGazetteer(await readZipText(gazetteers.county));
const places = parseGazetteer(await readZipText(gazetteers.place));
const cbsas = parseGazetteer(await readZipText(gazetteers.cbsa));
console.log("gazetteer columns", Object.keys(counties[0] || {}), Object.keys(places[0] || {}), Object.keys(cbsas[0] || {}));

const names = { county: {}, place: {}, metro: {} };
for (const row of counties) {
  names.county[row.GEOID] = { n: row.NAME, st: row.USPS };
}
for (const row of places) {
  names.place[row.GEOID] = { n: row.NAME, st: row.USPS };
}
for (const row of cbsas) {
  names.metro[row.GEOID] = { n: row.NAME, st: row.USPS || "" };
}

const payload = {
  meta: {
    product: "American Community Survey 5-year detailed tables",
    vintage: "2019-2023",
    release_year: 2023,
    retrieved_on: "2026-11-08",
    estimate_files: tables,
    name_files: gazetteers,
    name_vintage: "2024 Census Gazetteer",
    summary_levels: ["050 county", "160 place", "310 metropolitan/micropolitan statistical area"],
    coverage_note: "Rows are the county, place, and metro/micro summary levels present in the 2023 ACS 5-year table-based summary files and named in the 2024 Gazetteer. This is not a tract file and not a live Census API call. A 2024 name joined to a 2023 GEOID can be missing when the codes differ; that row is omitted rather than renamed.",
    negative_estimates: "Negative Census sentinel values were stored as null, not as zero."
  },
  counties: {},
  places: {},
  metros: {}
};

let dropped = 0;
for (const row of records.values()) {
  const name = names[row.kind][row.id];
  if (!name || !name.n) {
    dropped += 1;
    continue;
  }
  const compact = {
    n: name.n,
    st: name.st,
    hu: row.hu,
    occ: row.occ,
    own: row.own,
    ytot: row.ytot,
    old: row.old,
    old_partial: Boolean(row.oldPartial),
    inc: row.inc
  };
  if (row.kind === "county") payload.counties[row.id] = compact;
  if (row.kind === "place") payload.places[row.id] = compact;
  if (row.kind === "metro") payload.metros[row.id] = compact;
}

await mkdir(outDir, { recursive: true });
const destination = path.join(outDir, "acs-2023-5yr-extract.json");
await writeFile(destination, JSON.stringify(payload));
const { statSync } = await import("node:fs");
console.log({
  counties: Object.keys(payload.counties).length,
  places: Object.keys(payload.places).length,
  metros: Object.keys(payload.metros).length,
  dropped_without_2024_name: dropped,
  bytes: statSync(destination).size
});
