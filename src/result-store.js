import fs from "node:fs/promises";
import path from "node:path";

// Scored map and search results. A host passes any object with load, find,
// and save. The file store survives a process restart on a normal disk.
// Render's free service disk does not. Set RESULT_STORE_PATH to storage that
// already survives restart, or pass resultStore into createSpendGate. This
// repo does not provision a database.

const IDENTITY = [
  "version",
  "organic_depth",
  "trends",
  "volume_keyword_set_id",
  "niche",
  "city",
  "state",
  "google_ads",
  "google_maps"
];

export function sameIdentity(record, identity) {
  if (!record || !identity) return false;
  return IDENTITY.every((field) => record[field] === identity[field]);
}

export function selectStoredResult(records, identity, minMapsDepth) {
  const min = Number(minMapsDepth);
  if (!Number.isInteger(min) || min < 1) return null;
  const matches = (Array.isArray(records) ? records : []).filter((record) => {
    if (!sameIdentity(record, identity)) return false;
    if (!Number.isInteger(record.maps_depth) || record.maps_depth < min) return false;
    if (!record.report || typeof record.report !== "object") return false;
    if (typeof record.captured_at !== "string" || Number.isNaN(Date.parse(record.captured_at))) return false;
    return true;
  });
  matches.sort((left, right) => {
    if (left.maps_depth !== right.maps_depth) return left.maps_depth - right.maps_depth;
    return String(right.captured_at).localeCompare(String(left.captured_at));
  });
  return matches[0] || null;
}

function replaceSameDepth(records, record) {
  const index = records.findIndex((row) => sameIdentity(row, record) && row.maps_depth === record.maps_depth);
  if (index >= 0) records[index] = record;
  else records.push(record);
}

export function createMemoryResultStore(initial = []) {
  const records = [];
  for (const row of Array.isArray(initial) ? initial : []) {
    if (row && typeof row === "object") records.push(row);
  }
  return {
    async load() {},
    find(identity, minMapsDepth) {
      return selectStoredResult(records, identity, minMapsDepth);
    },
    async save(record) {
      replaceSameDepth(records, record);
    }
  };
}

export function createFileResultStore(filePath) {
  const records = [];
  let ready = null;
  let broken = false;
  let tail = Promise.resolve();

  function load() {
    if (!ready) {
      ready = (async () => {
        try {
          const saved = JSON.parse(await fs.readFile(filePath, "utf8"));
          const rows = saved && Array.isArray(saved.records) ? saved.records : null;
          if (!rows) {
            broken = true;
            return;
          }
          records.push(...rows.filter((row) => row && typeof row === "object"));
        } catch (error) {
          if (!error || error.code !== "ENOENT") broken = true;
        }
      })();
    }
    return ready;
  }

  async function writeOnce() {
    if (broken) {
      const error = new Error("The result cache file could not be read. It was left in place.");
      error.code = "result_store_unreadable";
      throw error;
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ records }));
    await fs.rename(temp, filePath);
  }

  function persist() {
    const run = tail.then(() => writeOnce());
    tail = run.catch(() => {});
    return run;
  }

  return {
    load,
    find(identity, minMapsDepth) {
      return selectStoredResult(records, identity, minMapsDepth);
    },
    async save(record) {
      await load();
      replaceSameDepth(records, record);
      await persist();
    }
  };
}

export function openResultStore(options = {}) {
  if (options.store) return options.store;
  if (options.filePath) return createFileResultStore(options.filePath);
  return createMemoryResultStore();
}
