import fs from "node:fs/promises";
import path from "node:path";

export function createDiscoveryCache({ filePath = "", now = Date.now } = {}) {
  const records = new Map();
  let ready = null;

  function load() {
    if (!ready) {
      ready = (async () => {
        if (!filePath) return;
        try {
          const saved = JSON.parse(await fs.readFile(filePath, "utf8"));
          const entries = saved && saved.entries && typeof saved.entries === "object" ? saved.entries : null;
          if (!entries) return;
          for (const [key, value] of Object.entries(entries)) {
            if (value && value.report && typeof value.report === "object") records.set(key, value);
          }
        } catch {
          // A new cache file is created on the first saved lookup.
        }
      })();
    }
    return ready;
  }

  async function persist() {
    if (!filePath) return;
    const entries = Object.fromEntries(records);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ entries }));
  }

  return {
    load: load(),
    async get(key) {
      await load();
      const hit = records.get(key);
      return hit ? structuredClone(hit) : null;
    },
    async set(key, report) {
      await load();
      records.set(key, {
        saved_at: new Date(now()).toISOString(),
        report: structuredClone(report)
      });
      try {
        await persist();
      } catch {
        // The in-memory entry still prevents a second paid call in this process.
      }
    }
  };
}
