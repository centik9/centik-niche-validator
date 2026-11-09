const STOPWORDS = new Set(["a", "an", "the", "and", "or", "in", "on", "at", "to", "for", "of", "with", "by", "from"]);

export function clusterToken(token) {
  const text = String(token || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (text.length >= 6 && text.endsWith("s") && !text.endsWith("ss")) return text.slice(0, -1);
  return text;
}

export function clusterKey(phrase) {
  const raw = String(phrase || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const content = raw.filter((token) => !STOPWORDS.has(token));
  const used = (content.length ? content : raw).map(clusterToken).filter(Boolean);
  return used.slice().sort().join(" ");
}

function measuredVolume(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export function clusterCoverage(rows) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const keyword = row && typeof row.keyword === "string" ? row.keyword.trim() : "";
    if (!keyword) continue;
    const key = clusterKey(keyword);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ keyword, volume: measuredVolume(row.volume) });
  }
  const clusters = [];
  for (const [key, members] of groups) {
    const measured = members.filter((member) => member.volume !== null);
    measured.sort((a, b) => b.volume - a.volume || a.keyword.localeCompare(b.keyword));
    const representative = measured[0] || null;
    clusters.push({
      key,
      phrases: members.map((member) => member.keyword),
      representative_phrase: representative ? representative.keyword : null,
      representative_volume: representative ? representative.volume : null,
      status: !representative ? "missing" : representative.volume === 0 ? "measured_zero" : "measured"
    });
  }
  clusters.sort((a, b) => a.key.localeCompare(b.key));
  const measuredClusters = clusters.filter((cluster) => cluster.status === "measured" || cluster.status === "measured_zero");
  const missingCount = clusters.length - measuredClusters.length;
  if (!measuredClusters.length) {
    return {
      clusters,
      status: "missing",
      value: null,
      partial: false,
      missing_cluster_count: missingCount,
      measured_cluster_count: 0
    };
  }
  const value = measuredClusters.reduce((sum, cluster) => sum + cluster.representative_volume, 0);
  const partial = missingCount > 0;
  return {
    clusters,
    status: partial ? "partial" : value === 0 ? "measured_zero" : "measured",
    value,
    partial,
    missing_cluster_count: missingCount,
    measured_cluster_count: measuredClusters.length
  };
}
