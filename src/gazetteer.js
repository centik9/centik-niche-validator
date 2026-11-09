const ADS_ROWS = [
  { location_code: 9000001, location_name: "United States", location_code_parent: null, country_iso_code: "US", location_type: "Country" },
  { location_code: 9000002, location_name: "Canada", location_code_parent: null, country_iso_code: "CA", location_type: "Country" },
  { location_code: 9000011, location_name: "Illinois,United States", location_code_parent: 9000001, country_iso_code: "US", location_type: "State" },
  { location_code: 9000012, location_name: "Missouri,United States", location_code_parent: 9000001, country_iso_code: "US", location_type: "State" },
  { location_code: 9000013, location_name: "Massachusetts,United States", location_code_parent: 9000001, country_iso_code: "US", location_type: "State" },
  { location_code: 9000014, location_name: "Oregon,United States", location_code_parent: 9000001, country_iso_code: "US", location_type: "State" },
  { location_code: 9000015, location_name: "Maine,United States", location_code_parent: 9000001, country_iso_code: "US", location_type: "State" },
  { location_code: 9000016, location_name: "Texas,United States", location_code_parent: 9000001, country_iso_code: "US", location_type: "State" },
  { location_code: 9000017, location_name: "New York,United States", location_code_parent: 9000001, country_iso_code: "US", location_type: "State" },
  { location_code: 9000018, location_name: "Kansas,United States", location_code_parent: 9000001, country_iso_code: "US", location_type: "State" },
  { location_code: 9000019, location_name: "Washington,United States", location_code_parent: 9000001, country_iso_code: "US", location_type: "State" },
  { location_code: 9000020, location_name: "District of Columbia,United States", location_code_parent: 9000001, country_iso_code: "US", location_type: "Territory" },
  { location_code: 9000030, location_name: "British Columbia,Canada", location_code_parent: 9000002, country_iso_code: "CA", location_type: "Province" },
  { location_code: 9001001, location_name: "Springfield,Illinois,United States", location_code_parent: 9000011, country_iso_code: "US", location_type: "City" },
  { location_code: 9001002, location_name: "Springfield,Missouri,United States", location_code_parent: 9000012, country_iso_code: "US", location_type: "City" },
  { location_code: 9001003, location_name: "Springfield,Massachusetts,United States", location_code_parent: 9000013, country_iso_code: "US", location_type: "City" },
  { location_code: 9001004, location_name: "Portland,Oregon,United States", location_code_parent: 9000014, country_iso_code: "US", location_type: "City" },
  { location_code: 9001005, location_name: "Portland,Maine,United States", location_code_parent: 9000015, country_iso_code: "US", location_type: "City" },
  { location_code: 9001006, location_name: "South Portland,Maine,United States", location_code_parent: 9000015, country_iso_code: "US", location_type: "City" },
  { location_code: 9001007, location_name: "Austin,Texas,United States", location_code_parent: 9000016, country_iso_code: "US", location_type: "City" },
  { location_code: 9001008, location_name: "New York,New York,United States", location_code_parent: 9000017, country_iso_code: "US", location_type: "City" },
  { location_code: 9001009, location_name: "Kansas City,Missouri,United States", location_code_parent: 9000012, country_iso_code: "US", location_type: "City" },
  { location_code: 9001010, location_name: "Kansas City,Kansas,United States", location_code_parent: 9000018, country_iso_code: "US", location_type: "City" },
  { location_code: 9001011, location_name: "Vancouver,Washington,United States", location_code_parent: 9000019, country_iso_code: "US", location_type: "City" },
  { location_code: 9001012, location_name: "Washington,District of Columbia,United States", location_code_parent: 9000020, country_iso_code: "US", location_type: "City" },
  { location_code: 9001013, location_name: "Saint Louis,Missouri,United States", location_code_parent: 9000012, country_iso_code: "US", location_type: "City" },
  { location_code: 9001014, location_name: "Vancouver,British Columbia,Canada", location_code_parent: 9000030, country_iso_code: "CA", location_type: "City" }
];

const MAPS_OFFSET = 100000;

function toMapsRows(rows) {
  const shifted = new Map(rows.map((row) => [row.location_code, row.location_code + MAPS_OFFSET]));
  return rows.map((row) => ({
    ...row,
    location_code: shifted.get(row.location_code),
    location_code_parent: row.location_code_parent == null ? null : shifted.get(row.location_code_parent)
  }));
}

const TRENDS_OFFSET = 200000;

function toTrendsRows(rows) {
  const shifted = new Map(rows.map((row) => [row.location_code, row.location_code + TRENDS_OFFSET]));
  return rows.map((row) => ({
    ...row,
    location_code: shifted.get(row.location_code),
    location_code_parent: row.location_code_parent == null ? null : shifted.get(row.location_code_parent)
  }));
}

const ROWS = {
  google_ads: ADS_ROWS,
  google_maps: toMapsRows(ADS_ROWS),
  google_trends: toTrendsRows(ADS_ROWS)
};

export const EXAMPLE_GAZETTEER_NOTE = "Bundled example gazetteer for example mode and tests. It is not the DataForSEO location directory, and its location codes are not DataForSEO location codes.";

export function exampleRows(product) {
  const rows = ROWS[product];
  if (!rows) return [];
  return structuredClone(rows);
}
