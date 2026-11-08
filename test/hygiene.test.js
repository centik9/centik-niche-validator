import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { VERSION } from "../src/config.js";

const root = path.resolve(import.meta.dirname, "..");

function read(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

test("package metadata and placeholder env stay non-secret", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.name, "centik-niche-validator");
  assert.equal(pkg.version, VERSION);
  assert.equal(pkg.scripts.start, "node src/server.js");
  assert.equal(pkg.scripts.test, "node --test");
  assert.equal(pkg.license, undefined);
  const env = read(".env.example");
  assert.match(env, /DATAFORSEO_LOGIN=your_dataforseo_login/);
  assert.match(env, /DATAFORSEO_PASSWORD=your_dataforseo_password/);
  assert.match(env, /DATAFORSEO_LIVE=false/);
  const ignore = read(".gitignore");
  for (const line of ["node_modules/", ".env", "!.env.example", ".DS_Store", "Thumbs.db"]) {
    assert.equal(ignore.includes(line), true, line);
  }
});

test("tracked text does not contain a live credential or an innerHTML sink", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|md|json|example|css|html|gitignore)$/.test(entry.name) || entry.name === ".env.example" || entry.name === ".gitignore") files.push(full);
    }
  };
  walk(root);
  const banned = [/AKIA[0-9A-Z]{16}/, /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/, /api\.dataforseo\.com\/[^"'\s]+:/i];
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of banned) assert.equal(pattern.test(text), false, file);
  }
  const client = read("public/app.js");
  assert.equal(client.includes("innerHTML"), false);
  assert.match(client, /Withheld/);
  assert.match(read("public/index.html"), /id="city"/);
  assert.match(read("src/config.js"), /0\.0\.0\.0/);
  assert.match(read("src/server.js"), /HOST/);
});
