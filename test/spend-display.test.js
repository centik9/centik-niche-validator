import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createApp } from "../src/app.js";
import { QUERY_COST_USD } from "../src/spend.js";
import { postJson, sessionCookie, TEST_AUTH, withServer } from "./helpers.js";

const LEDGER_COST = 1.25;
const PASSWORD = "test-password-value";

const QUOTE = {
  mode: "live",
  niche: "emergency plumber",
  city: "Austin",
  state: "Texas",
  country: "United States",
  confirmed: {
    google_ads: { location_code: 1026339, location_name: "Austin,Texas,United States", location_type: "City" },
    google_maps: { location_code: 9026339, location_name: "Austin,Texas,United States", location_type: "City" }
  }
};

function liveEnv(extra = {}) {
  return {
    ...TEST_AUTH,
    DATAFORSEO_LIVE: "true",
    DATAFORSEO_LOGIN: "login-user",
    DATAFORSEO_PASSWORD: PASSWORD,
    DATAFORSEO_SPENT_BASELINE_USD: "100",
    SPEND_CAP_USD: "10",
    ...extra
  };
}

async function withSpendApp(env, readAccountSpent, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spend-display-"));
  const ledgerPath = path.join(dir, "spend-ledger.json");
  await fs.writeFile(ledgerPath, JSON.stringify({
    entries: [{
      at: "2026-11-09T12:00:00.000Z",
      user: "team@centik.ai",
      niche: "plumbing",
      market: "Austin, Texas",
      calls: [],
      cost_usd: LEDGER_COST
    }]
  }));
  const reads = { count: 0 };
  const fetches = { count: 0 };
  const app = createApp({
    env,
    ledgerPath,
    readAccountSpent: async () => {
      reads.count += 1;
      return readAccountSpent();
    },
    fetchImpl: async () => {
      fetches.count += 1;
      throw new Error("real DataForSEO fetch");
    }
  });
  try {
    await withServer(app, async (port) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/spend`, {
        headers: { cookie: await sessionCookie(port) }
      });
      const body = await response.json();
      await fn({ port, response, body, reads, fetches });
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("live spend display uses the DataForSEO account minus the baseline", async () => {
  await withSpendApp(liveEnv(), async () => ({
    tasks: [{ result: [{ money: { total: 110, balance: 6.06 } }] }]
  }), async ({ response, body, reads, fetches }) => {
    assert.equal(response.status, 200);
    assert.equal(body.spent_usd, 3.94);
    assert.equal(body.cap_usd, 10);
    assert.equal(body.remaining_usd, 6.06);
    assert.equal(body.account_total_spent_usd, 103.94);
    assert.equal(body.baseline_usd, 100);
    assert.equal(body.spend_source, "dataforseo_account");
    assert.equal(body.spend_label, "DataForSEO account");
    assert.equal(body.entries[0].cost_usd, LEDGER_COST);
    assert.notEqual(body.spent_usd, LEDGER_COST);
    assert.equal(JSON.stringify(body).includes(PASSWORD), false);
    assert.equal(reads.count, 1);
    assert.equal(fetches.count, 0);
  });
});

test("a failed account read or missing baseline falls back to the local ledger", async () => {
  await withSpendApp(liveEnv(), async () => {
    throw new Error("account down");
  }, async ({ port, response, body, reads, fetches }) => {
    assert.equal(response.status, 200);
    assert.equal(body.spent_usd, LEDGER_COST);
    assert.equal(body.cap_usd, 10);
    assert.equal(body.remaining_usd, 8.75);
    assert.equal(body.spend_source, "local_ledger");
    assert.equal(body.spend_label, "local count since last restart");
    assert.equal(body.error, undefined);
    assert.equal(body.entries[0].cost_usd, LEDGER_COST);
    assert.equal(JSON.stringify(body).includes(PASSWORD), false);
    assert.equal(reads.count, 1);
    assert.equal(fetches.count, 0);
    const quoted = await postJson(port, "/api/quote", QUOTE);
    const quote = await quoted.json();
    assert.equal(quoted.status, 403);
    assert.equal(quote.error, "spend_account_unavailable");
    assert.equal(fetches.count, 0);
  });

  await withSpendApp(liveEnv({ DATAFORSEO_SPENT_BASELINE_USD: "" }), async () => {
    throw new Error("baseline missing should not read the account");
  }, async ({ port, response, body, reads }) => {
    assert.equal(response.status, 200);
    assert.equal(body.spent_usd, LEDGER_COST);
    assert.equal(body.spend_label, "local count since last restart");
    assert.equal(body.spend_source, "local_ledger");
    assert.equal(reads.count, 0);
    const quoted = await postJson(port, "/api/quote", QUOTE);
    assert.equal(quoted.status, 403);
    assert.equal((await quoted.json()).error, "spend_baseline_missing");
    assert.equal(reads.count, 0);
  });

  await withSpendApp(liveEnv(), async () => ({ tasks: [{ result: [{ money: { total: 1 } }] }] }), async ({ response, body }) => {
    assert.equal(response.status, 200);
    assert.equal(body.spent_usd, LEDGER_COST);
    assert.equal(body.spend_label, "local count since last restart");
  });

  await withSpendApp(liveEnv(), async () => 50, async ({ response, body }) => {
    assert.equal(response.status, 200);
    assert.equal(body.spent_usd, LEDGER_COST);
    assert.equal(body.spend_label, "local count since last restart");
  });
});

test("sample mode spend display stays on the local ledger", async () => {
  await withSpendApp({
    ...TEST_AUTH,
    DATAFORSEO_LOGIN: "login-user",
    DATAFORSEO_PASSWORD: PASSWORD,
    DATAFORSEO_SPENT_BASELINE_USD: "100"
  }, async () => 103.94, async ({ response, body, reads, fetches }) => {
    assert.equal(response.status, 200);
    assert.equal(body.spent_usd, LEDGER_COST);
    assert.equal(body.cap_usd, 10);
    assert.equal(body.remaining_usd, 8.75);
    assert.equal(body.query_cost_usd, QUERY_COST_USD);
    assert.equal(body.entries[0].cost_usd, LEDGER_COST);
    assert.equal(Object.hasOwn(body, "spend_label"), false);
    assert.equal(Object.hasOwn(body, "spend_source"), false);
    assert.equal(Object.hasOwn(body, "account_total_spent_usd"), false);
    assert.equal(reads.count, 0);
    assert.equal(fetches.count, 0);
    assert.equal(JSON.stringify(body).includes(PASSWORD), false);
  });
});

test("live spend display does not relax the account cap", async () => {
  await withSpendApp(liveEnv(), async () => 111, async ({ port, response, body, fetches }) => {
    assert.equal(response.status, 200);
    assert.equal(body.spent_usd, 11);
    assert.equal(body.cap_usd, 10);
    assert.equal(body.remaining_usd, -1);
    assert.equal(body.spend_label, "DataForSEO account");
    assert.equal(body.entries[0].cost_usd, LEDGER_COST);
    const quoted = await postJson(port, "/api/quote", QUOTE);
    const quote = await quoted.json();
    assert.equal(quoted.status, 403);
    assert.equal(quote.error, "spend_cap_exceeded");
    assert.match(quote.message, /spend cap/);
    assert.equal(fetches.count, 0);
    const again = await (await fetch(`http://127.0.0.1:${port}/api/spend`, {
      headers: { cookie: await sessionCookie(port) }
    })).json();
    assert.equal(again.spent_usd, 11);
    assert.equal(again.entries[0].cost_usd, LEDGER_COST);
  });
});

test("the budget caption names the figure the spend endpoint returns", async () => {
  const html = await fs.readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const dashboard = await fs.readFile(new URL("../public/dashboard.js", import.meta.url), "utf8");
  assert.match(html, /id="spend-caption">Spend to date</);
  assert.match(dashboard, /fetch\("\/api\/spend"\)/);
  assert.match(dashboard, /payload\.spend_label/);
  assert.match(dashboard, /DataForSEO account/);
  assert.equal(dashboard.includes("\u2014"), false);
  assert.equal(dashboard.includes("\u2013"), false);
});
