// Auth: public view / admin edit. Sessions are stateless HMAC-signed cookies
// (no per-session server store) bound to two revocation inputs — a session
// EPOCH kept in VELLUM_DATA and a fingerprint of the password hash — so
// "sign out" and "change the password" both actually end every live session.
// The password is verified against an argon2id hash from the environment.
// No hash configured → open local mode, which is refused outright when the
// operator has asked for a private instance (PUBLIC=false).

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { isNotePath } from "../shared/noteFormat.ts";
import path from "node:path";
import argon2 from "argon2";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import type { MeData } from "../shared/types.ts";
import type { FilterLang } from "./indexer.ts";
import { isNoteVisibleToVisitor, publishedCounts, resolveLink } from "./indexer.ts";
import { languageScope } from "./language.ts";
import { currentVisibility, isReducingReach } from "./visibility.ts";
import { commentsEnabled } from "./comments.ts";
import { fontsSignature, slotsAreSystem } from "./fonts.ts";
import { dateCalendar, fontSlots, getSettings, textAlign, textDirection } from "./settings.ts";
import { FOLLOW_THEME } from "../shared/themes.ts";
import { bannerFallback, blogLocale, customCssPath, dataDir, footerLine, publicLayout, siteLanguage, siteName, tagline, themePinnedByEnv, themePref, visitorTheme } from "./site.ts";
import { activeDesign, customThemesSig, hasThemeChoice } from "./designs.ts";
import { authorSiteCards } from "./authorSites.ts";
import { normalizeRel } from "./vault.ts";

const COOKIE_NAME = "vellum_session";
/** 7 days, not 30, and it slides: every authenticated API request inside the
 *  last half of a token's life reissues the cookie, so an ACTIVE admin is
 *  never logged out and a STOLEN cookie stops working a week after the theft
 *  even if nobody noticed. 30 days of unrevocable bearer token was the cost of
 *  never having to type the password twice a month. */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_ATTEMPTS = 10;
/** Failed logins per minute across ALL addresses — the backstop for the
 *  per-IP window, which a botnet (or one forged hop behind a misconfigured
 *  proxy) simply spreads across keys. Well above any honest instance: this is
 *  a single-admin product. */
const GLOBAL_MAX_ATTEMPTS = 40;
/** Concurrent argon2 verifies. Each is m=65536 (64 MiB) p=4 — what
 *  scripts/hash-password.ts actually produces — and each occupies libuv's
 *  threadpool, the same four threads every fs call in the process shares. Two
 *  in flight is 128 MiB and half the pool; the rest queue, briefly. */
const VERIFY_MAX_CONCURRENT = 2;
/** Queue depth beyond which a login is refused outright rather than parked.
 *  A bounded queue is the difference between "slow" and "the vault stops
 *  answering". */
const VERIFY_MAX_QUEUED = 8;

interface AuthConfig {
  passwordHash: string | null; // null → open local mode, everyone is admin
  sessionSecret: string;
  publicReads: boolean;        // PUBLIC=false → reads require admin too
  homeNote: string | null;
  trustedProxies: IpRange[];   // X-Forwarded-For honored only from these peers
  secureCookies: boolean | null; // SECURE_COOKIES override; null → derive per request
}

let config: AuthConfig = {
  passwordHash: null,
  sessionSecret: randomBytes(32).toString("hex"),
  publicReads: true,
  homeNote: null,
  trustedProxies: [],
  secureCookies: null,
};

/** A boot-time configuration error: printed plainly and the process stops.
 *  Thrown rather than `process.exit()`ed so the harness and any future test
 *  can observe it. */
export class ConfigError extends Error {}

/** Loopback (or a unix-socket-ish empty host): the only bind address where
 *  "no password" is a private decision rather than a public one. */
function isLoopbackHost(host: string): boolean {
  const h = canonicalIp(host.replace(/^\[|\]$/g, ""));
  return h === "127.0.0.1" || h === "::1" || h === "localhost" || h.startsWith("127.");
}

/** Read auth settings from the environment. Call once at startup. */
export function initAuth(env: NodeJS.ProcessEnv = process.env): void {
  const passwordHash = env.ADMIN_PASSWORD_HASH?.trim() || null;
  const publicSet = (env.PUBLIC ?? "").trim() !== "";
  const publicReads = !/^(false|0|no)$/i.test(env.PUBLIC?.trim() ?? "");
  const homeNote = env.HOME_NOTE?.trim() || null;
  let sessionSecret = env.SESSION_SECRET?.trim() ?? "";
  // FAIL CLOSED ON THE ONE FLAG THAT MEANS "LOCK THIS DOWN".
  //
  // authGuard short-circuits on `if (!config.passwordHash) return next()` and
  // isAdmin() answers true unconditionally in that mode — both BEFORE the
  // publicReads check — so PUBLIC=false without a hash was not a private
  // instance, it was an anonymous, fully writable ADMIN instance that
  // announced itself as `{"admin":true,"protected":false}` and accepted
  // anonymous PUT /api/note, GET /api/settings (absolute disk paths) and
  // PATCH gitSync + POST /api/sync/now (commit the vault, push it anywhere).
  // The operator who sets this flag has stated their intent in the one place
  // the product offers; the only honest answer to "I cannot do that" is to
  // stop, and to name the command that fixes it.
  if (publicSet && !publicReads && !passwordHash) {
    throw new ConfigError(
      "PUBLIC=false asks for a private instance, but ADMIN_PASSWORD_HASH is not set.\n" +
        "  Without a password there is no session to require: every anonymous request would be a full\n" +
        "  admin — able to read, write and delete notes, read settings, and configure git sync.\n" +
        "  Fix it with:  npm run hash-password    (then put the printed hash in .env as ADMIN_PASSWORD_HASH)\n" +
        "  Or drop PUBLIC=false to run deliberately open on a trusted network.",
    );
  }
  if (!passwordHash) {
    const host = env.HOST?.trim() || "";
    // Not fatal: binding 0.0.0.0 in open mode is the documented LAN use ("open
    // your vault from any browser on your network"). But it is the shape of
    // the accident, so it gets more than one grey line.
    if (host !== "" && !isLoopbackHost(host)) {
      console.warn(
        `vellum: HOST=${host} is not loopback and ADMIN_PASSWORD_HASH is not set —\n` +
          "        every machine that can reach this port is an ADMIN of this vault (read, write, delete).\n" +
          "        npm run hash-password to lock it down.",
      );
    }
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
  // SECURE_COOKIES: an explicit yes/no for the `Secure` attribute. Unset →
  // derived per request (X-Forwarded-Proto from a trusted proxy, or the
  // request's own scheme), which is right behind the documented HTTPS proxy
  // and right for plain http on a LAN.
  const secureRaw = env.SECURE_COOKIES?.trim().toLowerCase() ?? "";
  const secureCookies = secureRaw === "" ? null : /^(1|true|yes|on)$/.test(secureRaw);
  config = {
    passwordHash,
    sessionSecret: sessionSecret || randomBytes(32).toString("hex"),
    publicReads,
    homeNote,
    trustedProxies,
    secureCookies,
  };
  sessionEpoch = null; // re-read from VELLUM_DATA on first use
}

/** True when this instance has a real credential — i.e. when an "admin
 *  session" means anything at all. Routes that can move the operator's data
 *  OFF the machine (git sync) refuse in open local mode rather than accepting
 *  the word of whoever happened to connect. */
export function isProtected(): boolean {
  return config.passwordHash !== null;
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

/** The session epoch: one integer in VELLUM_DATA that every live token
 *  carries. Bumping it invalidates all of them at once, which is the whole
 *  revocation story — and the reason it is on DISK rather than in memory is
 *  that SESSION_SECRET is meant to survive restarts, so a cookie captured
 *  before a restart used to survive one too.
 *
 *  Read lazily: initAuth() runs before initSite(), so dataDir() is not
 *  trustworthy at that moment. */
let sessionEpoch: number | null = null;

function epochFile(): string {
  return path.join(dataDir(), "session-epoch");
}

function currentEpoch(): number {
  if (sessionEpoch !== null) return sessionEpoch;
  let value = 1;
  try {
    const raw = Number.parseInt(readFileSync(epochFile(), "utf8").trim(), 10);
    if (Number.isSafeInteger(raw) && raw > 0) value = raw;
  } catch {
    /* first run (or unreadable): epoch 1 */
  }
  sessionEpoch = value;
  return value;
}

/** Invalidate every session token this instance ever issued. Persisted, so a
 *  restart cannot resurrect them; still effective in memory if the write
 *  fails, which is the half that matters right now. */
function bumpEpoch(): number {
  const next = currentEpoch() + 1;
  sessionEpoch = next;
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(epochFile(), `${next}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    console.error("vellum: could not persist the session epoch — sessions are revoked until the next restart:", err);
  }
  return next;
}

/** A short fingerprint of the configured password hash, mixed into every
 *  signature. CHANGING THE PASSWORD THEREFORE ENDS EVERY SESSION — with the
 *  old scheme the two were independent, so an admin who changed their password
 *  because a laptop was stolen left the thief's cookie working for 30 more
 *  days. Derived through the session secret so the stored hash is never
 *  recoverable from a cookie. */
function passwordFingerprint(): string {
  return createHash("sha256")
    .update(config.sessionSecret)
    .update(" pw ")
    .update(config.passwordHash ?? "")
    .digest("base64url")
    .slice(0, 16);
}

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret)
    .update(payload)
    .update(" ")
    .update(passwordFingerprint())
    .digest("base64url");
}

/** `v2.<epoch>.<expiry>.<hmac>` — no nonce, no server-side session store, but
 *  two revocation inputs baked into the signature. v1 tokens (no epoch) are
 *  not accepted: upgrading the server signs everyone out once, deliberately. */
function makeSessionToken(): string {
  const payload = `v2.${currentEpoch()}.${Date.now() + SESSION_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** The token's remaining life in ms, or null when it is not a valid session
 *  for THIS instance right now (bad shape, wrong version, stale epoch, past
 *  expiry, bad signature, or signed under a different password). */
function sessionRemainingMs(token: string | undefined): number | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const [version, epochStr, expiryStr] = payload.split(".");
  if (version !== "v2") return null;
  if (Number(epochStr) !== currentEpoch()) return null;
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry)) return null;
  const remaining = expiry - Date.now();
  if (remaining <= 0) return null;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return remaining;
}

function isValidSessionToken(token: string | undefined): boolean {
  return sessionRemainingMs(token) !== null;
}

/** Should this response's cookie carry `Secure`? SECURE_COOKIES decides when
 *  set; otherwise X-Forwarded-Proto — honored ONLY from a configured trusted
 *  proxy, exactly like X-Forwarded-For — and finally the request's own scheme.
 *  The documented deployment is "behind an HTTPS reverse proxy", where the
 *  app's own hop is plain http: without this, the admin cookie was issued
 *  without Secure and one accidental http:// link leaked it in clear. */
function cookieSecure(c: Context): boolean {
  if (config.secureCookies !== null) return config.secureCookies;
  let peer = "";
  try {
    peer = canonicalIp(getConnInfo(c).remote.address ?? "");
  } catch {
    /* fall through */
  }
  if (peer && isTrustedProxy(peer)) {
    const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    if (proto) return proto === "https";
  }
  return new URL(c.req.url).protocol === "https:";
}

function setSessionCookie(c: Context): void {
  setCookie(c, COOKIE_NAME, makeSessionToken(), {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: cookieSecure(c),
    maxAge: SESSION_TTL_MS / 1000,
  });
}

/** Sliding refresh: an admin session past half its life is reissued on any
 *  API request. That is what makes a 7-day TTL humane — an active writer never
 *  meets the login modal — without making the token a month-long bearer. */
function refreshSessionIfStale(c: Context): void {
  if (!config.passwordHash) return;
  const remaining = sessionRemainingMs(getCookie(c, COOKIE_NAME));
  if (remaining === null || remaining > SESSION_TTL_MS / 2) return;
  setSessionCookie(c);
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

const globalAttempts: number[] = [];

function prune(times: number[], now: number): number[] {
  return times.filter((t) => now - t < RATE_WINDOW_MS);
}

/** Take one attempt from this IP's window AND from the global window, or
 *  refuse. It is consumed HERE, before the verify — never after it.
 *
 *  The old shape read the window, then `await argon2.verify(...)`, then
 *  recorded the failure. Every await is a yield point, so the whole window was
 *  read by every request in a concurrent volley before any of them wrote to
 *  it: measured, one 200-way parallel burst evaluated 200/200 guesses against
 *  a limit of 10 per minute. Worse, each in-flight verify is argon2id m=65536
 *  p=4 — 64 MiB and four threadpool jobs — so the same volley is an
 *  unauthenticated memory and threadpool amplifier against a process whose
 *  every fs call shares that pool. POST /api/comments always had this right:
 *  check and record adjacent, with no await between them. */
function takeLoginSlot(ip: string): boolean {
  const now = Date.now();
  if (loginAttempts.size > 1000) {
    for (const [key, times] of loginAttempts) {
      if (times.every((t) => now - t >= RATE_WINDOW_MS)) loginAttempts.delete(key);
    }
  }
  const recent = prune(loginAttempts.get(ip) ?? [], now);
  const global = prune(globalAttempts, now);
  globalAttempts.length = 0;
  globalAttempts.push(...global);
  if (recent.length >= RATE_MAX_ATTEMPTS || global.length >= GLOBAL_MAX_ATTEMPTS) {
    loginAttempts.set(ip, recent);
    return false;
  }
  recent.push(now);
  loginAttempts.set(ip, recent);
  globalAttempts.push(now);
  return true;
}

/** Give the slot back after a CORRECT password: the limiter exists to bound
 *  guessing, and an admin who signs in on four devices in a minute is not
 *  guessing. (The intent the old comment stated — "checking never consumes an
 *  attempt" — is preserved; only the ORDER changed.) */
function refundLoginSlot(ip: string): void {
  const times = loginAttempts.get(ip);
  if (times) times.pop();
  globalAttempts.pop();
}

// A bounded semaphore around argon2. Slots are HANDED OVER on release (rather
// than released-then-reacquired) so the count is exact under any interleaving.
let verifyActive = 0;
const verifyQueue: (() => void)[] = [];

async function acquireVerifySlot(): Promise<boolean> {
  if (verifyActive < VERIFY_MAX_CONCURRENT) {
    verifyActive++;
    return true;
  }
  if (verifyQueue.length >= VERIFY_MAX_QUEUED) return false;
  await new Promise<void>((resolve) => verifyQueue.push(resolve));
  return true; // the slot was handed to us; verifyActive already counts it
}

function releaseVerifySlot(): void {
  const next = verifyQueue.shift();
  if (next) next();
  else verifyActive--;
}

/** One-time nag when a proxy header arrives on an instance that was never told
 *  about a proxy. The header is (correctly) ignored, which means every login in
 *  the world shares ONE rate-limit bucket keyed on the proxy's address — the
 *  admin locks themselves out and never learns why. Silence was the bug. */
let warnedAboutForwardedFor = false;

function warnIfUnconfiguredProxy(c: Context): void {
  if (warnedAboutForwardedFor || config.trustedProxies.length > 0) return;
  if (!c.req.header("x-forwarded-for")) return;
  warnedAboutForwardedFor = true;
  console.warn(
    "vellum: a login arrived carrying X-Forwarded-For but TRUSTED_PROXIES is unset — the header is IGNORED\n" +
      "        (clients can forge it), so the login rate limit is keying off the proxy's own address and\n" +
      "        every visitor shares one bucket. Set TRUSTED_PROXIES to your proxy's address, e.g.\n" +
      "        TRUSTED_PROXIES=127.0.0.1,::1",
  );
}

// -------------------------------------------------------------------- routes

export const authRoutes = new Hono();

authRoutes.post("/login", async (c) => {
  warnIfUnconfiguredProxy(c);
  const ip = clientIp(c);
  if (!config.passwordHash) return c.json({ ok: true, admin: true }); // nothing to log into
  // Parse before spending the attempt: a malformed body is not a guess.
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
  if (!takeLoginSlot(ip)) {
    return c.json({ error: "Too many login attempts — try again in a minute" }, 429);
  }
  if (!(await acquireVerifySlot())) {
    // The queue is full: refund, because this guess was never evaluated.
    refundLoginSlot(ip);
    return c.json({ error: "Too many login attempts — try again in a minute" }, 429);
  }
  let ok = false;
  try {
    ok = await argon2.verify(config.passwordHash, password).catch(() => false);
  } finally {
    releaseVerifySlot();
  }
  if (!ok) return c.json({ error: "Invalid password" }, 401);
  refundLoginSlot(ip);
  setSessionCookie(c);
  return c.json({ ok: true, admin: true });
});

/** Sign out. This ends EVERY session of this instance, on every device, by
 *  bumping the session epoch — deliberately, and it is the point of the route:
 *  before, logout only asked the browser to drop its cookie, so a token
 *  captured anywhere stayed a valid admin credential for its full life and the
 *  only real revocation was editing SESSION_SECRET in .env and restarting.
 *  Vellum has exactly one admin; "sign out here" and "sign out everywhere"
 *  cannot mean different things when there is one credential behind both. */
authRoutes.post("/logout", (c) => {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
  if (config.passwordHash) bumpEpoch();
  return c.json({ ok: true, everywhere: true });
});

/** The HOME_NOTE env value (settings.home.note overrides it when set —
 *  settings.ts builds the merged view from both). */
export function envHomeNote(): string | null {
  return config.homeNote;
}

/** PUBLIC: reads are open without a session. Env-only and unchangeable from
 *  the panel — which is exactly why the panel has to be able to READ it: with
 *  it off, every count the visibility preview prints is moot, and saying so is
 *  the difference between "your site shows 20 posts" and the truth. */
export function publicReads(): boolean {
  return config.publicReads;
}

/** True when a home-note ref points at a note VISIBLE TO VISITORS: resolvable
 *  as a wikilink-style name within the visitor collection, or an exact path
 *  that is published AND not curated away by the languageFilter.
 *
 *  Both halves must apply the same rule. The exact-path fallback used to ask
 *  only isNotePublished(), so an Arabic instance whose HOME_NOTE named an
 *  English published note put that note's title and full vault path into the
 *  anonymous /api/me payload (`homeNote` + `home.note`) — the one name every
 *  other visitor surface, tree and posts and search and RSS and the injected
 *  <head> included, was hiding — and then rendered it as the public homepage.
 *  resolveLink(ref, true) already filtered; this line is what leaked.
 *
 *  `lang` is the caller's resolved scope, not a global read: under
 *  `languageFilter: "follow"` a home note written in English is a real home
 *  page for an English reader and a non-existent one for an Arabic reader, and
 *  /api/me has to answer each of them truthfully. */
function homeNoteVisible(ref: string, lang: FilterLang): boolean {
  // ONE CLAUSE SHORT of the leak this function exists to close: on a
  // PUBLIC=false instance nothing is readable without a session — every other
  // read route 401s — yet `me.homeNote` (and `home.note`) still travelled to
  // anonymous callers, naming a note in a vault whose entire premise is that
  // its names are private. The client cannot use the value in that state
  // anyway: it is about to render the login modal.
  if (!config.publicReads) return false;
  if (resolveLink(ref, true, lang) !== null) return true;
  try {
    const asPath = isNotePath(ref) ? ref : `${ref}.md`;
    return isNoteVisibleToVisitor(normalizeRel(asPath), lang);
  } catch {
    return false;
  }
}

/**
 * The layout a session is actually SERVED, as opposed to the one configured.
 *
 * "designed" downgrades to "blog" whenever the design store has nothing this
 * build can render — an empty store, a corrupt designs.json, a document
 * quarantined by the schema check. The downgrade happens HERE, on the server,
 * and that is the point: the stock blog is the always-working base, so a
 * broken design must never be something the browser has to notice and recover
 * from. It is the same answer the client's error boundary gives for the
 * failures only the browser can see (a section that throws, a note that has
 * gone), arrived at one layer earlier.
 */
export function servedLayout(): "app" | "blog" | "designed" {
  const configured = publicLayout();
  if (configured !== "designed") return configured;
  return activeDesign().design ? "designed" : "blog";
}

authRoutes.get("/me", (c) => {
  // Preview: an admin session that asked to be treated as a visitor gets the
  // exact visitor-shaped payload (admin: false, no counts, published-only
  // home note) plus `preview: true` so the client can show the exit banner.
  const preview = isPreviewingVisitor(c);
  const admin = isAdmin(c) && !preview;
  // One scope for this whole payload, resolved exactly as every other visitor
  // surface resolves it — so an admin previewing as a visitor is told what a
  // visitor is told, home note included, with no separate preview code path.
  const scope = languageScope(c, isPublishLimited(c));
  const me: MeData = {
    admin,
    public: config.publicReads,
    protected: config.passwordHash !== null,
  };
  if (preview) me.preview = true;
  // Publish stats are admin UI copy only — telling an anonymous visitor how
  // many notes exist beyond the published ones would leak vault size.
  if (admin) me.published = publishedCounts();
  const settings = getSettings();
  // Home note, merged (settings.home.note wins over HOME_NOTE). Visitors see
  // it only when it resolves within the published collection — otherwise the
  // name of an unpublished (or missing) note would leak, and opening it could
  // only 404 anyway. Both name-style ("Welcome") and path-style
  // ("guides/Welcome.md") values are honored, mirroring the client.
  const homeRef = settings.home?.note ?? config.homeNote;
  if (homeRef && (admin || homeNoteVisible(homeRef, scope.lang))) {
    me.homeNote = homeRef;
  }
  // Instance customization (settings.json over SITE_NAME / DEFAULT_THEME env,
  // plus VELLUM_DATA/custom.css). The site.ts getters do the merging.
  me.siteName = siteName();
  // Chrome language, for every session: "ar" localizes the shell and mirrors
  // it RTL for admin and visitor alike.
  me.language = siteLanguage();
  // Opt-in EN/ع switch in the public chrome. Visitor-safe by definition (it
  // describes the public shell) and sent to every session so an admin
  // previewing as a visitor sees exactly what a visitor sees.
  if (settings.languageToggle === true) me.languageToggle = true;
  // How this site curates by note language, for every session. The client
  // needs it, not just to render copy: under "follow" a visitor flipping the
  // EN/ع switch changes WHICH NOTES EXIST for them, so the shell must refetch
  // the vault rather than merely re-skin the chrome. Visitor-safe on the same
  // grounds as languageToggle — it describes the public shell.
  if (scope.mode !== "off") me.languageFilter = scope.mode;
  // The filter stood down because the language in force qualified nothing.
  // Said out loud rather than swallowed: the visitor gets a quiet line
  // explaining why they are seeing both languages, and the admin gets the
  // number below.
  if (scope.fallbackFrom) me.languageFallback = scope.fallbackFrom;
  // ADMIN ONLY, and only while something is actually costing reach: the
  // ongoing indicator that this whole round exists for. A site does not
  // silently shrink twice.
  if (admin) {
    const impact = currentVisibility();
    if (isReducingReach(impact)) me.visibility = impact;
  }
  // The author's other sites, as ready-made cards, for every session — the
  // blog home renders them and an admin previewing as a visitor should see
  // them too. Cache-only: a cold cache warms in the background and the next
  // load carries the enrichment.
  const sites = authorSiteCards(settings.authorSites ?? []);
  if (sites.length > 0) me.authorSites = sites;
  // Marginalia, for every session. The reading view used to find this out by
  // asking /api/comments per note and reading the 404 — one bad response per
  // note open on every instance with comments off. It is one instance-wide
  // fact, so it travels with the rest of the shell's configuration.
  if (commentsEnabled()) me.comments = true;
  // Date/relative-time locale for BOTH shells: the reading view's Marginalia
  // timestamps need it in app layout too, and blogLocale() already derives
  // "ar" from the site language when nothing explicit is configured.
  me.blogLocale = blogLocale();
  // The CALENDAR those dates are printed in, and the note-prose layout pair.
  // All three travel to every session and in both shells: the app's own
  // moderation rows, sync status and About print dates too, and the editor
  // and reading view need the layout as much as a blog article does. Sent
  // only when they differ from the default, so the payload of a default
  // instance is byte-for-byte what it was.
  const calendar = dateCalendar();
  if (calendar !== "gregorian") me.dateCalendar = calendar;
  const noteDir = textDirection();
  if (noteDir !== "auto") me.textDirection = noteDir;
  const noteAlign = textAlign();
  if (noteAlign !== "start") me.textAlign = noteAlign;
  // The theme a session with no stored pick lands on: a pinned
  // settings.defaultTheme/DEFAULT_THEME, or — by default — the theme the admin
  // is editing in, mirrored from their browser. Resolved here so no client
  // ever has to know the rule.
  const theme = visitorTheme();
  if (theme) me.defaultTheme = theme;
  // …and, for the admin only, WHY. An owner must never discover that their
  // own browsing changed what the public sees; the picker and the settings
  // row print this back to them.
  if (admin) {
    me.publicTheme = {
      mode: themePref() === FOLLOW_THEME ? "follow" : "pinned",
      theme,
      ...(themePinnedByEnv() ? { env: true } : {}),
    };
  }
  if (customCssPath()) me.customCss = true;
  // Typography: the four-slot signature, for every session. Its presence is
  // what makes the client link /api/site-fonts.css at all, and its value is
  // the ?v= on that link — so changing a pick changes the URL and the browser
  // fetches the new faces instead of reusing the cached stylesheet.
  const slots = fontSlots();
  if (!slotsAreSystem(slots)) me.fonts = fontsSignature(slots);
  // Branding assets from settings.json, for every session: the logo replaces
  // the text wordmark in the sidebar/masthead, and a set favicon makes the
  // client point its icon link at /favicon.ico. Both are visitor-safe by
  // definition — they describe the public shell (and their vault paths are
  // visitor-fetchable via the settings-asset allowlist on /api/file).
  if (settings.logo) me.logo = settings.logo;
  if (settings.favicon) me.favicon = true;
  // Blog and designed modes (PUBLIC_LAYOUT=blog / designed): layout +
  // masthead/footer/locale copy. Sent to admin sessions too — the client
  // applies the public shell only when the session is not admin, but the
  // admin UI may want to preview the copy.
  // Custom themes are the public site's own colour, so their signature travels
  // to every session exactly as the font signature does — its presence makes
  // the client link /api/design/themes.css and its value is that link's ?v=.
  const themeSig = customThemesSig();
  if (themeSig !== "") me.customThemes = themeSig;
  // A default theme is only named when the instance still HAS it: a custom
  // theme that was deleted while `settings.defaultTheme` named it would
  // otherwise reach every browser as a data-theme nothing answers.
  if (me.defaultTheme && !hasThemeChoice(me.defaultTheme)) {
    delete me.defaultTheme;
    // The admin's explanation names the same theme, so it goes with it —
    // "Visitors see custom:sepia" about a theme this instance no longer has
    // is worse than saying nothing about the colour and keeping the mode.
    if (me.publicTheme) me.publicTheme = { ...me.publicTheme, theme: null };
  }
  // Blog and designed modes share the whole public-shell payload below —
  // masthead copy, footer, locale, home config — because a designed site is
  // still a site with a name and a footer. What separates them is one field.
  const layout = servedLayout();
  if (layout !== "app") {
    me.publicLayout = layout;
    if (layout === "designed") {
      const { design } = activeDesign();
      // A signature, not the document: the design travels on its own route
      // (/api/design/public), which is where the visitor scrubbing lives.
      if (design) me.design = `${design.id}.${design.updatedMs}`;
    }
    // Why the designed site is NOT being served, for the owner only. A
    // visitor is given the stock blog and no explanation — that is the whole
    // promise — and an admin previewing as a visitor is a visitor here too,
    // so the notice does not follow them into the preview they asked for.
    if (admin && publicLayout() === "designed") {
      const { design, notice } = activeDesign();
      if (notice) me.designNotice = notice;
      else if (design) {
        // A design that is perfectly VALID can still be unrenderable, and the
        // commonest way is the one nobody is watching for: a `note` section
        // pointing at a note that has since been deleted, unpublished, or
        // hidden by the language filter. The browser finds that out and the
        // error boundary handles it — but only for somebody who is LOOKING at
        // the public site, and the owner is normally in the editor. So the
        // server checks the one thing it can check cheaply and says it in the
        // app, where the owner actually is.
        const dead = design.sections.find((section) => {
          if (section.kind !== "note" || section.hidden) return false;
          if (section.note === "") return true;
          try {
            return !isNoteVisibleToVisitor(normalizeRel(section.note), scope.lang);
          } catch {
            return true;
          }
        });
        if (dead && dead.kind === "note") {
          me.designNotice = {
            reason: "section",
            design: design.name,
            // The admin may name the note: this payload is admin-only, and
            // the path is exactly what makes the notice actionable.
            detail: `${dead.id} → ${dead.note || "(unset)"}`,
          };
        }
      }
    }
    const tl = tagline();
    if (tl) me.tagline = tl;
    me.footer = footerLine();
    me.bannerFallback = bannerFallback();
    if (getSettings().shareButtons !== false) me.shareButtons = true;
    // Runtime settings the blog shell renders from (settings.json): the
    // home config (mode/banner, plus the note when it is visible to this
    // session — same gating as me.homeNote above). Visitor-safe by
    // definition — it describes the public homepage.
    if (settings.home) {
      const { note, ...rest } = settings.home;
      const shaped = note && (admin || homeNoteVisible(note, scope.lang)) ? { ...rest, note } : rest;
      if (Object.keys(shaped).length > 0) me.home = shaped;
    }
  }
  return c.json(me);
});

// --------------------------------------------------------------------- guard

/** Always reachable, even with PUBLIC=false (the SPA shell is served outside /api). */
const OPEN_PATHS = new Set([
  "/api/login",
  "/api/logout",
  "/api/me",
  "/api/custom.css",
  // The generated typography stylesheet is styling like custom.css, and it is
  // what makes the login page of a PUBLIC=false vault render in the
  // instance's own type. It names only catalog faces this server already
  // cached — no vault content, no external URL.
  "/api/site-fonts.css",
  // The custom-theme override stylesheet, for the same reason and on the same
  // terms: hex colours out of a closed allowlist, no vault content, and the
  // login page of a PUBLIC=false instance should be painted in the colours
  // that instance chose.
  "/api/design/themes.css",
]);

/** /api/fonts/* is styling like custom.css: open to visitors and the login
 *  page of a PUBLIC=false vault (the route itself enforces basename-only +
 *  extension whitelist — nothing else is reachable under the prefix). */
function isOpenPath(path: string): boolean {
  return OPEN_PATHS.has(path) || path.startsWith("/api/fonts/");
}

export const authGuard: MiddlewareHandler = async (c, next) => {
  // READ-ONLY openness. The exemptions above exist so a stylesheet and its
  // faces render for anyone; they are not a hole for WRITES. Once fonts could
  // be uploaded and deleted under that same /api/fonts/ prefix, a path-only
  // exemption would have handed an anonymous caller POST /api/fonts/upload and
  // DELETE /api/fonts/custom/<file> — so the exemption is now scoped to the
  // methods it was ever meant for, and every mutation under the prefix falls
  // through to the admin check below like any other.
  const reading = c.req.method === "GET" || c.req.method === "HEAD";
  if (reading && isOpenPath(c.req.path)) return next();
  // Sliding session refresh happens here, on the one middleware every real API
  // request passes through, so an admin who is using the app never meets the
  // login modal even though the token itself is short-lived.
  refreshSessionIfStale(c);
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
