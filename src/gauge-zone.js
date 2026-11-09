export function zoneFor(score) {
  if (score === null || score === undefined || Number.isNaN(Number(score))) return null;
  const value = Number(score);
  if (value < 15) return "No";
  if (value < 30) return "Low";
  if (value < 60) return "Medium";
  if (value < 80) return "High";
  return "Max";
}
