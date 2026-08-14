// Auth: public view / admin edit. Sessions are stateless HMAC-signed expiry
// cookies (no server-side store); the password is verified against an argon2id
// hash from the environment. No hash configured → open local mode.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";

const COOKIE_NAME = "vellum_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_ATTEMPTS = 10;

interface AuthConfig {
  passwordHash: string | null; // null → open local mode, everyone is admin
  sessionSecret: string;
  publicReads: boolean;        // PUBLIC=false → reads require admin too
  homeNote: string | null;
}

let config: AuthConfig = {
  passwordHash: null,
  sessionSecret: randomBytes(32).toString("hex"),
  publicReads: true,
  homeNote: null,
};

/** Read auth settings from the environment. Call once at startup. */
export function initAuth(env: NodeJS.ProcessEnv = process.env): void {
  const passwordHash = env.ADMIN_PASSWORD_HASH?.trim() || null;
  const publicReads = !/^(false|0|no)$/i.test(env.PUBLIC?.trim() ?? "");
  const homeNote = env.HOME_NOTE?.trim() || null;
  let sessionSecret = env.SESSION_SECRET?.trim() ?? "";
  if (!passwordHash) {
    console.warn("vellum: ADMIN_PASSWORD_HASH not set — open local mode, every visitor is admin (npm run hash-password to lock it down)");
  } else if (!sessionSecret) {
    sessionSecret = randomBytes(32).toString("hex");
    console.warn("vellum: SESSION_SECRET not set — using an ephemeral secret; sessions will not survive restarts");
  }
  config = {
    passwordHash,
    sessionSecret: sessionSecret || randomBytes(32).toString("hex"),
    publicReads,
    homeNote,
  };
}

// ------------------------------------------------------------------ sessions

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
}

function makeSessionToken(): string {
  const payload = `v1.${Date.now() + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

function isValidSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const [version, expiryStr] = payload.split(".");
  if (version !== "v1") return false;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function isAdmin(c: Context): boolean {
  if (!config.passwordHash) return true; // local mode
  return isValidSessionToken(getCookie(c, COOKIE_NAME));
}

// ---------------------------------------------------------------- rate limit

const loginAttempts = new Map<string, number[]>();

function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/** Sliding-window limiter: true when this IP has already burned all
 *  RATE_MAX_ATTEMPTS failed tries this window. Checking never consumes an
 *  attempt — only recordFailedLogin() does — so successful logins and
 *  malformed requests don't eat into the 10 real password tries per minute. */
function rateLimited(ip: string): boolean {
  const now = Date.now();
  if (loginAttempts.size > 1000) {
    for (const [key, times] of loginAttempts) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) loginAttempts.delete(key);
    }
  }
  const recent = (loginAttempts.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  loginAttempts.set(ip, recent);
  return recent.length >= RATE_MAX_ATTEMPTS;
}

function recordFailedLogin(ip: string): void {
  const attempts = loginAttempts.get(ip) ?? [];
  attempts.push(Date.now());
  loginAttempts.set(ip, attempts);
}

// -------------------------------------------------------------------- routes

export const authRoutes = new Hono();

authRoutes.post("/login", async (c) => {
  const ip = clientIp(c);
  if (rateLimited(ip)) {
    return c.json({ error: "Too many login attempts — try again in a minute" }, 429);
  }
  if (!config.passwordHash) return c.json({ ok: true, admin: true }); // nothing to log into
  let password = "";
  try {
    const body: unknown = await c.req.json();
    if (typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).password === "string") {
      password = (body as Record<string, unknown>).password as string;
    }
  } catch {
    // fall through to the 400 below
  }
  if (!password) return c.json({ error: 'Body field "password" required' }, 400);
  const ok = await argon2.verify(config.passwordHash, password).catch(() => false);
  if (!ok) {
    recordFailedLogin(ip);
    return c.json({ error: "Invalid password" }, 401);
  }
  setCookie(c, COOKIE_NAME, makeSessionToken(), {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return c.json({ ok: true, admin: true });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  return c.json({ ok: true });
});

authRoutes.get("/me", (c) => {
  const me: { admin: boolean; public: boolean; protected: boolean; homeNote?: string } = {
    admin: isAdmin(c),
    public: config.publicReads,
    protected: config.passwordHash !== null,
  };
  if (config.homeNote) me.homeNote = config.homeNote;
  return c.json(me);
});

// --------------------------------------------------------------------- guard

/** Always reachable, even with PUBLIC=false (the SPA shell is served outside /api). */
const OPEN_PATHS = new Set(["/api/login", "/api/logout", "/api/me"]);

export const authGuard: MiddlewareHandler = async (c, next) => {
  if (OPEN_PATHS.has(c.req.path)) return next();
  if (!config.passwordHash) return next(); // local mode: everything open
  if (isAdmin(c)) return next();
  const mutating = c.req.method !== "GET" && c.req.method !== "HEAD";
  if (mutating) return c.json({ error: "Admin session required" }, 401);
  if (!config.publicReads) return c.json({ error: "Sign in required" }, 401);
  return next();
};
