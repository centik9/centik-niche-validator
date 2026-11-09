import { hashAccessCode } from "../src/auth.js";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const code = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
if (!code) {
  console.error("Paste the access code on stdin. Nothing was hashed.");
  process.exit(1);
}
process.stdout.write(`${hashAccessCode(code)}\n`);
