import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { HOST } from "./config.js";

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return fileURLToPath(import.meta.url) === path.resolve(entry);
}

export function start() {
  const port = Number(process.env.PORT);
  const listenPort = process.env.PORT === undefined || process.env.PORT === "" ? 3000 : port;
  if (!Number.isInteger(listenPort) || listenPort < 0 || listenPort > 65535) {
    console.error("PORT must be an integer from 0 to 65535.");
    process.exit(1);
  }
  const configuredStore = process.env.RESULT_STORE_PATH;
  const resultStorePath = configuredStore && configuredStore.trim()
    ? configuredStore.trim()
    : path.join(process.cwd(), "data", "result-cache.json");
  const server = createApp({ resultStorePath });
  server.listen(listenPort, HOST, () => {
    console.log(`centik-niche-validator listening on ${HOST}:${listenPort}`);
  });
  function shutdown() {
    server.close(() => process.exit(0));
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  return server;
}

if (isMain()) start();
