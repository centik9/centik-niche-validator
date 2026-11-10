const STAMP_ZONE = "America/Los_Angeles";

export function formatCapturedDate(iso, timeZone = STAMP_ZONE) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric"
  }).formatToParts(date);
  const month = parts.find((part) => part.type === "month");
  const day = parts.find((part) => part.type === "day");
  const year = parts.find((part) => part.type === "year");
  if (!month || !day || !year) return null;
  return `${month.value} ${day.value}, ${year.value}`;
}

export function formatDataStamp(iso, mapsDepth) {
  const date = formatCapturedDate(iso);
  if (!date) return "";
  const depth = Number(mapsDepth);
  if (Number.isInteger(depth) && depth > 0) return `Data from ${date} · ${depth} listings`;
  return `Data from ${date}`;
}
