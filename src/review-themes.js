const THEMES = [
  ["no shows", /\bno show\b|\bnever showed\b|\bdid not show\b/i],
  ["upsells", /\bupsell\b|\bupcharged\b|\bextra charge\b/i],
  ["failed work", /\bdid not fix\b|\bstill leaking\b|\bstill broken\b|\bhad to redo\b/i],
  ["warranty", /\bwarranty\b|\bnot honored\b/i]
];

function businessKey(value) {
  return String(value || "").trim().toLowerCase();
}

export function clusterThemes(reviews) {
  const low = (Array.isArray(reviews) ? reviews : []).filter((review) => (
    review && Number.isFinite(review.rating) && review.rating <= 2 && typeof review.text === "string" && review.text.trim()
  ));
  const themes = [];
  for (const [name, pattern] of THEMES) {
    const businesses = new Set();
    for (const review of low) {
      if (pattern.test(review.text)) {
        const key = businessKey(review.business);
        if (key) businesses.add(key);
      }
    }
    if (businesses.size >= 2) themes.push({ theme: name, businesses: businesses.size });
  }
  return themes;
}
