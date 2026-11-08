import { createExampleTransport } from "../src/example-transport.js";
import { createLocationDirectory } from "../src/locations.js";

export function exampleDeps(transport = createExampleTransport()) {
  return {
    transport,
    directory: createLocationDirectory(transport),
    origin: "example",
    codeSource: "example_gazetteer",
    now: () => Date.parse("2026-01-15T00:00:00.000Z"),
    redact: (value) => String(value ?? "")
  };
}

export function confirmedFrom(resolution) {
  const side = (match) => match ? {
    location_code: match.location_code,
    location_name: match.location_name,
    location_type: match.location_type
  } : null;
  return {
    google_ads: side(resolution.google_ads.match),
    google_maps: side(resolution.google_maps.match)
  };
}

export async function withServer(app, fn) {
  await new Promise((resolve) => app.listen(0, "127.0.0.1", resolve));
  const port = app.address().port;
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
}

export function postJson(port, pathname, payload) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}
