import crypto from "node:crypto";

export const SESSION_COOKIE = "centik_session";
export const SESSION_MS = 12 * 60 * 60 * 1000;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

export function hashAccessCode(code) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(code), salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyAccessCode(code, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (N !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P) return false;
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  if (salt.length !== 16 || expected.length !== SCRYPT_KEYLEN) return false;
  const key = crypto.scryptSync(String(code ?? ""), salt, expected.length, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return crypto.timingSafeEqual(key, expected);
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest();
}

export function safeEqual(left, right) {
  return crypto.timingSafeEqual(digest(left), digest(right));
}

export function allowedEmails(env) {
  const raw = env.ALLOWED_EMAILS && env.ALLOWED_EMAILS.trim() ? env.ALLOWED_EMAILS : "team@centik.ai";
  return raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

export function accessGranted(env, email, code) {
  const hash = env.TEAM_ACCESS_CODE_HASH;
  if (!hash) return false;
  const address = String(email || "").trim().toLowerCase();
  const listed = allowedEmails(env).some((item) => safeEqual(item, address));
  return listed && verifyAccessCode(code, hash);
}

export function signSession(email, secret, now) {
  const payload = Buffer.from(JSON.stringify({
    email: String(email).trim().toLowerCase(),
    exp: now + SESSION_MS
  })).toString("base64url");
  const mac = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function readSession(token, secret, now) {
  if (!token || !secret || !token.includes(".")) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(mac, expected)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!body || typeof body.email !== "string" || !Number.isFinite(body.exp) || body.exp <= now) return null;
    return body;
  } catch {
    return null;
  }
}

export function sessionTokenFromRequest(req) {
  const header = String(req.headers.cookie || "");
  const parts = header.split(";").map((item) => item.trim());
  const found = parts.find((item) => item.startsWith(`${SESSION_COOKIE}=`));
  return found ? decodeURIComponent(found.slice(SESSION_COOKIE.length + 1)) : "";
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}
