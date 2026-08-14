// Auth: public view / admin edit. Sessions are stateless HMAC-signed expiry
// cookies (no server-side store); the password is verified against an argon2id
// hash from the environment. No hash configured → open local mode.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import argon2 from "argon2";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { MeData } from "../shared/types.ts";
import { isNotePublished, publishedCounts, resolveLink } from "./indexer.ts";
import { blogLocale, customCssPath, defaultTheme, footerLine, publicLayout, siteName, tagline } from "./site.ts";
import { normalizeRel } from "./vault.ts";

const COOKIE_NAME = "vellum_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_ATTEMPTS = 10;

interface AuthConfig {
  passwordHash: string | null; // null → open local mode, everyone is admin
  sessionSecret: string;
  publicReads: boolean;        // PUBLIC=false → reads require admin too
  homeNote: string | null;
  trustedProxies: IpRange[];   // X-Forwarded-For honored only from these peers
}

let config: AuthConfig = {
  passwordHash: null,
  sessionSecret: randomBytes(32).toString("hex"),
  publicReads: true,
  homeNote: null,
  trustedProxies: [],
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
  const trustedProxies: IpRange[] = [];
  for (const entry of (env.TRUSTED_PROXIES ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const range = parseIpRange(entry);
    if (range) trustedProxies.push(range);
    else console.warn(`vellum: TRUSTED_PROXIES entry ${JSON.stringify(entry)} is not a valid IP or CIDR — ignored`);
  }
  config = {
    passwordHash,
    sessionSecret: sessionSecret || randomBytes(32).toString("hex"),
    publicReads,
    homeNote,
    trustedProxies,
  };
}

// ------------------------------------------------------------- IP utilities

interface IpRange { bits: 32 | 128; value: bigint; prefix: number }

/** "::ffff:1.2.3.4" → "1.2.3.4"; strips any %zone. */
function canonicalIp(ip: string): string {
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  const lower = ip.toLowerCase();
  if (lower.startsWith("::ffff:") && lower.includes(".")) ip = ip.slice(7);
  return ip;
}

function ipToBigInt(ip: string): { bits: 32 | 128; value: bigint } | null {
  ip = canonicalIp(ip);
  const family = isIP(ip);
  if (family === 4) {
    const [a, b, c, d] = ip.split(".").map(Number);
    return { bits: 32, value: (BigInt(a) << 24n) | (BigInt(b) << 16n) | (BigInt(c) << 8n) | BigInt(d) };
  }
  if (family === 6) {
    // Expand "::" then fold 8 hextets into a 128-bit value. A trailing IPv4
    // (e.g. "64:ff9b::1.2.3.4") is rewritten as two hextets first.
    let s = ip;
    const v4 = s.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (v4) {
      const [, a, b, c, d] = v4.map(Number);
      s = s.slice(0, v4.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
    }
    const halves = s.split("::");
    const head = halves[0] ? halves[0].split(":") : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
    const groups = halves.length === 2
      ? [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail]
      : head;
    if (groups.length !== 8) return null;
    let value = 0n;
    for (const g of groups) value = (value << 16n) | BigInt(parseInt(g, 16));
    return { bits: 128, value };
  }
  return null;
}

/** Parse "10.0.0.1", "10.0.0.0/8", "fd00::/8", … */
function parseIpRange(entry: string): IpRange | null {
  const slash = entry.indexOf("/");
  const ipPart = slash === -1 ? entry : entry.slice(0, slash);
  const parsed = ipToBigInt(ipPart);
  if (!parsed) return null;
  let prefix: number = parsed.bits;
  if (slash !== -1) {
    const p = Number(entry.slice(slash + 1));
    if (!Number.isInteger(p) || p < 0 || p > parsed.bits) return null;
    prefix = p;
  }
  return { bits: parsed.bits, value: parsed.value, prefix };
}

function isTrustedProxy(ip: string): boolean {
  const parsed = ipToBigInt(ip);
  if (!parsed) return false;
  return config.trustedProxies.some((r) =>
    r.bits === parsed.bits && (parsed.value >> BigInt(r.bits - r.prefix)) === (r.value >> BigInt(r.bits - r.prefix)));
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

/** The request ASKS for visitor preview: the X-Vellum-Preview header, or —
 *  for /api/events only, since EventSource cannot set headers — the
 *  ?preview=visitor query param. Asking is not getting: the flag is honored
 *  only for a valid admin session (see isPreviewingVisitor). */
function previewRequested(c: Context): boolean {
  if (c.req.header("x-vellum-preview")?.trim().toLowerCase() === "visitor") return true;
  return c.req.path === "/api/events" && c.req.query("preview") === "visitor";
}

/** Admin previewing the public site: a valid admin session that asked to be
 *  treated as a visitor. Every visitor-scoping decision (isPublishLimited,
 *  the auth guard, /api/me) flows through the same code path a real visitor
 *  takes — no separate "preview filtering" exists anywhere. */
export function isPreviewingVisitor(c: Context): boolean {
  return previewRequested(c) && isAdmin(c);
}

/** True when this request must see the curated published collection only:
 *  a password hash is configured AND the request has no admin session — or
 *  an admin session explicitly previewing the visitor experience. */
export function isPublishLimited(c: Context): boolean {
  if (isPreviewingVisitor(c)) return true;
  return config.passwordHash !== null && !isAdmin(c);
}

/** True when this request may read vault-derived content at all: reads are
 *  public, or the request carries an admin session (open local mode included).
 *  Non-/api surfaces (feed.xml, SEO injection) gate on this so PUBLIC=false
 *  keeps them as closed as the API. */
export function canRead(c: Context): boolean {
  return config.publicReads || isAdmin(c);
}

// ---------------------------------------------------------------- rate limit

const loginAttempts = new Map<string, number[]>();

/** Rate-limit key. X-Forwarded-For is attacker-writable, so it is honored only
 *  when the direct socket peer is a configured trusted proxy (TRUSTED_PROXIES);
 *  the chain is then walked right to left past trusted hops to the address the
 *  nearest trusted proxy actually saw. Otherwise: the socket peer address.
 *  Exported so other rate limiters (comments) key off the same address. */
export function clientIp(c: Context): string {
  let peer = "unknown";
  try {
    peer = canonicalIp(getConnInfo(c).remote.address ?? "unknown");
  } catch {
    /* keep "unknown" */
  }
  if (config.trustedProxies.length === 0 || !isTrustedProxy(peer)) return peer;
  const forwarded = c.req.header("x-forwarded-for");
  if (!forwarded) return peer;
  const hops = forwarded.split(",").map((s) => canonicalIp(s.trim())).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isTrustedProxy(hops[i])) return hops[i];
  }
  return hops[0] ?? peer; // every hop trusted → leftmost is the client
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

/** True when HOME_NOTE points at a note visible to visitors: resolvable as a
 *  wikilink-style name within the published set, or an exact published path. */
function homeNotePublished(ref: string): boolean {
  if (resolveLink(ref, true) !== null) return true;
  try {
    const asPath = /\.md$/i.test(ref) ? ref : `${ref}.md`;
    return isNotePublished(normalizeRel(asPath));
  } catch {
    return false;
  }
}

authRoutes.get("/me", (c) => {
  // Preview: an admin session that asked to be treated as a visitor gets the
  // exact visitor-shaped payload (admin: false, no counts, published-only
  // home note) plus `preview: true` so the client can show the exit banner.
  const preview = isPreviewingVisitor(c);
  const admin = isAdmin(c) && !preview;
  const me: MeData = {
    admin,
    public: config.publicReads,
    protected: config.passwordHash !== null,
  };
  if (preview) me.preview = true;
  // Publish stats are admin UI copy only — telling an anonymous visitor how
  // many notes exist beyond the published ones would leak vault size.
  if (admin) me.published = publishedCounts();
  // Visitors see HOME_NOTE only when it resolves within the published
  // collection — otherwise the name of an unpublished (or missing) note
  // would leak, and opening it could only 404 anyway. Both name-style
  // ("Welcome") and path-style ("guides/Welcome.md") values are honored,
  // mirroring the client's resolution rules.
  if (config.homeNote && (admin || homeNotePublished(config.homeNote))) {
    me.homeNote = config.homeNote;
  }
  // Instance customization (SITE_NAME / DEFAULT_THEME / VELLUM_DATA/custom.css).
  me.siteName = siteName();
  const theme = defaultTheme();
  if (theme) me.defaultTheme = theme;
  if (customCssPath()) me.customCss = true;
  // Blog mode (PUBLIC_LAYOUT=blog): layout + masthead/footer/locale copy.
  // Sent to admin sessions too — the client applies the blog shell only when
  // the session is not admin, but the admin UI may want to preview the copy.
  if (publicLayout() === "blog") {
    me.publicLayout = "blog";
    const tl = tagline();
    if (tl) me.tagline = tl;
    me.footer = footerLine();
    me.blogLocale = blogLocale();
  }
  return c.json(me);
});

// --------------------------------------------------------------------- guard

/** Always reachable, even with PUBLIC=false (the SPA shell is served outside /api). */
const OPEN_PATHS = new Set(["/api/login", "/api/logout", "/api/me", "/api/custom.css"]);

/** /api/fonts/* is styling like custom.css: open to visitors and the login
 *  page of a PUBLIC=false vault (the route itself enforces basename-only +
 *  extension whitelist — nothing else is reachable under the prefix). */
function isOpenPath(path: string): boolean {
  return OPEN_PATHS.has(path) || path.startsWith("/api/fonts/");
}

export const authGuard: MiddlewareHandler = async (c, next) => {
  if (isOpenPath(c.req.path)) return next();
  // Preview: the admin session walks the visitor branch below — mutations
  // 401 and PUBLIC=false locks reads, exactly as they would for a stranger.
  if (!isPreviewingVisitor(c)) {
    if (!config.passwordHash) return next(); // local mode: everything open
    if (isAdmin(c)) return next();
  }
  // Posting a comment is read-level, not vault mutation: visitors may do it
  // (the route itself 404s unless COMMENTS=on and the note is published).
  // It still falls through to the PUBLIC=false check below — a locked vault
  // takes no comments. DELETE /api/comments/:id is a different path, so it
  // stays admin-only like every other mutation.
  const visitorPost = c.req.method === "POST" && c.req.path === "/api/comments";
  const mutating = !visitorPost && c.req.method !== "GET" && c.req.method !== "HEAD";
  if (mutating) return c.json({ error: "Admin session required" }, 401);
  if (!config.publicReads) return c.json({ error: "Sign in required" }, 401);
  return next();
};
