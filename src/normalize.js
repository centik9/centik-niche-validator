const TOKEN_ALIASES = new Map([
  ["st", "saint"],
  ["mt", "mount"],
  ["ft", "fort"]
]);

export function normalizePlace(value) {
  const text = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "";
  return text.split(" ").map((token) => TOKEN_ALIASES.get(token) || token).join(" ");
}

export function splitLocationName(locationName) {
  const parts = String(locationName ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return { place: "", regions: [], country: "" };
  if (parts.length === 1) return { place: parts[0], regions: [], country: "" };
  return {
    place: parts[0],
    regions: parts.slice(1, -1),
    country: parts[parts.length - 1]
  };
}
