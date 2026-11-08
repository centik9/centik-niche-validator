import { normalizePlace } from "./normalize.js";
import { isUspsAbbreviation } from "./us-states.js";

const COUNTRIES = [
  { iso: "us", canonicalName: "United States", names: ["united states", "united states of america", "usa", "us", "u s", "u s a"] },
  { iso: "ca", canonicalName: "Canada", names: ["canada", "ca"] },
  { iso: "gb", canonicalName: "United Kingdom", names: ["united kingdom", "uk", "u k", "great britain", "britain", "gb"] },
  { iso: "au", canonicalName: "Australia", names: ["australia", "au"] },
  { iso: "nz", canonicalName: "New Zealand", names: ["new zealand", "nz"] },
  { iso: "ie", canonicalName: "Ireland", names: ["ireland", "ie"] },
  { iso: "mx", canonicalName: "Mexico", names: ["mexico", "mx"] },
  { iso: "de", canonicalName: "Germany", names: ["germany"] },
  { iso: "fr", canonicalName: "France", names: ["france"] },
  { iso: "es", canonicalName: "Spain", names: ["spain"] },
  { iso: "it", canonicalName: "Italy", names: ["italy"] },
  { iso: "nl", canonicalName: "Netherlands", names: ["netherlands", "the netherlands", "holland"] },
  { iso: "be", canonicalName: "Belgium", names: ["belgium"] },
  { iso: "ch", canonicalName: "Switzerland", names: ["switzerland"] },
  { iso: "at", canonicalName: "Austria", names: ["austria"] },
  { iso: "se", canonicalName: "Sweden", names: ["sweden"] },
  { iso: "no", canonicalName: "Norway", names: ["norway"] },
  { iso: "dk", canonicalName: "Denmark", names: ["denmark"] },
  { iso: "fi", canonicalName: "Finland", names: ["finland"] },
  { iso: "pt", canonicalName: "Portugal", names: ["portugal"] },
  { iso: "pl", canonicalName: "Poland", names: ["poland"] },
  { iso: "in", canonicalName: "India", names: ["india"] },
  { iso: "jp", canonicalName: "Japan", names: ["japan"] },
  { iso: "br", canonicalName: "Brazil", names: ["brazil"] },
  { iso: "sg", canonicalName: "Singapore", names: ["singapore"] },
  { iso: "ph", canonicalName: "Philippines", names: ["philippines"] },
  { iso: "za", canonicalName: "South Africa", names: ["south africa"] },
  { iso: "ae", canonicalName: "United Arab Emirates", names: ["united arab emirates", "uae"] }
];

const BY_NAME = new Map();
for (const country of COUNTRIES) {
  for (const name of country.names) BY_NAME.set(name, country);
  BY_NAME.set(country.canonicalName.toLowerCase(), country);
}

const SUBDIVISIONS = new Set(["england", "scotland", "wales", "northern ireland"]);

export function resolveCountry(input) {
  const normalized = normalizePlace(input);
  if (!normalized) {
    return { ok: false, error: "Country is required." };
  }
  if (SUBDIVISIONS.has(normalized)) {
    return {
      ok: false,
      error: "That is a country subdivision. Enter the country (United Kingdom or gb) and put the subdivision in the state field."
    };
  }
  const direct = BY_NAME.get(normalized) || BY_NAME.get(normalized.replace(/ /g, ""));
  if (direct) {
    return { ok: true, iso: direct.iso, canonicalName: direct.canonicalName };
  }
  const compact = normalized.replace(/ /g, "");
  if (/^[a-z]{2}$/.test(compact)) {
    if (isUspsAbbreviation(compact) && compact !== "us") {
      return {
        ok: false,
        error: `${compact.toUpperCase()} is a US state abbreviation, not a country code accepted here. Put the state in the state field. CA in the country field means Canada; type United States or US for the United States.`
      };
    }
    return { ok: true, iso: compact, canonicalName: null };
  }
  return {
    ok: false,
    error: "Country was not recognized. Use a country name such as United States, or a two-letter ISO code that is not a US state abbreviation."
  };
}

export function knownIsoFromSegment(segment) {
  const normalized = normalizePlace(segment);
  if (!normalized) return null;
  const direct = BY_NAME.get(normalized);
  return direct ? direct.iso : null;
}
