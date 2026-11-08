const SDA_URL = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest";

export const FREEZE_THAW = {
  status: "unavailable",
  value: null,
  unit: "freeze-thaw cycles",
  note: "NOAA Climate at a Glance does not publish a freeze-thaw cycle count. U.S. Climate Normals frost and freeze dates are a separate station product and are not queried here. Unavailable is not zero and is not a mild climate."
};

export function areasymbol(usps, countyFips) {
  const symbol = `${usps}${String(countyFips).slice(2)}`;
  if (!/^[A-Z]{2}\d{3}$/.test(symbol)) return null;
  return symbol;
}

export function droughtPressureIndex(pdsi) {
  const index = Math.round(50 - pdsi * 10);
  return Math.max(0, Math.min(100, index));
}

export async function fetchSoilShares(counties, fetchImpl) {
  const bySymbol = new Map();
  const symbols = [];
  for (const county of counties) {
    const symbol = areasymbol(county.state_usps, county.geoid);
    if (!symbol) continue;
    bySymbol.set(symbol, county.geoid);
    symbols.push(symbol);
  }
  if (!symbols.length) return { rows: {}, requested: false };
  const list = symbols.map((symbol) => `'${symbol}'`).join(",");
  const query = `
    SELECT areasymbol,
           SUM(CASE WHEN max_lep >= 6 THEN acres ELSE 0 END) AS high_acres,
           SUM(CASE WHEN max_lep IS NOT NULL THEN acres ELSE 0 END) AS rated_acres
    FROM (
      SELECT l.areasymbol,
             (mu.muacres * c.comppct_r / 100.0) AS acres,
             MAX(hz.lep_r) AS max_lep
      FROM legend AS l
      INNER JOIN mapunit AS mu ON mu.lkey = l.lkey
      INNER JOIN component AS c ON c.mukey = mu.mukey
      INNER JOIN chorizon AS hz ON hz.cokey = c.cokey
      WHERE l.areasymbol IN (${list})
        AND hz.hzdept_r < 100
        AND c.comppct_r IS NOT NULL
        AND mu.muacres IS NOT NULL
      GROUP BY l.areasymbol, mu.mukey, c.cokey, mu.muacres, c.comppct_r
    ) AS components
    GROUP BY areasymbol`;
  const response = await fetchImpl(SDA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ QUERY: query, FORMAT: "JSON" }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    const error = new Error(`USDA Soil Data Access returned HTTP ${response.status}.`);
    error.code = "soil_failed";
    throw error;
  }
  const payload = await response.json();
  const table = payload && payload.Table;
  const rows = {};
  if (Array.isArray(table)) {
    for (const row of table) {
      const symbol = row[0];
      const geoid = bySymbol.get(symbol);
      if (!geoid) continue;
      rows[geoid] = {
        areasymbol: symbol,
        high_acres: Number(row[1]),
        rated_acres: Number(row[2])
      };
    }
  }
  return { rows, requested: true, url: SDA_URL };
}

export async function fetchCountyDrought(counties, fetchImpl) {
  const rows = {};
  await Promise.all(counties.map(async (county) => {
    const fips3 = String(county.geoid).slice(2);
    const url = `https://www.ncei.noaa.gov/cag/county/time-series/${county.state_usps}-${fips3}-pdsi-1-12-2023-2024.json`;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        rows[county.geoid] = { status: "failed", url };
        return;
      }
      const payload = await response.json();
      const data = payload && payload.data;
      const periods = data ? Object.keys(data).sort() : [];
      const period = periods[periods.length - 1];
      const value = period ? Number(data[period].value) : NaN;
      if (!period || !Number.isFinite(value)) {
        rows[county.geoid] = { status: "missing", url, title: payload && payload.description && payload.description.title };
        return;
      }
      rows[county.geoid] = {
        status: "measured",
        url,
        period,
        value,
        title: payload.description && payload.description.title
      };
    } catch {
      rows[county.geoid] = { status: "failed", url };
    }
  }));
  return rows;
}
