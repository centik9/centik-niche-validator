import crypto from "node:crypto";

export const SESSION_COOKIE = "centik_session";
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

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
  const expected = env.TEAM_ACCESS_CODE;
  if (!expected) return false;
  const address = String(email || "").trim().toLowerCase();
  const listed = allowedEmails(env).some((item) => safeEqual(item, address));
  return listed && safeEqual(expected, String(code || ""));
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
