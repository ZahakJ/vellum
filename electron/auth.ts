// WHO THE DESKTOP APP IS, TO ITS OWN SERVER.
//
// Two things have to be true at once, and they pull in opposite directions:
//
//   · The owner IS the admin. They chose the folder, they double-clicked the
//     icon, the vault is on their disk. A login screen here is theatre —
//     they would be typing a password to prove they are the person holding the
//     computer the file is on.
//   · The binary must not BE the bypass. Vellum's server speaks HTTP. On a
//     shared machine every other logged-in account can reach 127.0.0.1, and a
//     desktop app that runs the server in open local mode ("no password hash
//     configured → everyone is admin", server/auth.ts::initAuth) is a one-click
//     way to hand every other account on the box read, write, delete, settings
//     and git-sync on this vault. That is a real regression against the web
//     deployment, delivered by the convenience feature.
//
// The resolution is not a new auth mode. `server/auth.ts` already has exactly
// the shape needed, and the desktop uses it as written:
//
//   HOST=127.0.0.1        nothing off this machine can reach the port at all.
//   PUBLIC=false          reads require a session too, so an unauthenticated
//                         local caller gets 401 on everything, not a published
//                         subset. (server/auth.ts refuses to start with
//                         PUBLIC=false and no hash — we always set one.)
//   ADMIN_PASSWORD_HASH   an argon2id hash of 32 random bytes minted HERE, at
//                         launch, never written to disk and never shown.
//   SESSION_SECRET        32 fresh random bytes per launch, so a cookie from a
//                         previous run of the app is not a credential for this
//                         one.
//
// and then the app signs itself in through `POST /api/login` — the same route
// the browser uses, with no special case anywhere in the server — and puts the
// resulting cookie in this vault's own Electron session partition. The reader
// never sees a password because there is no password a human could type: it is
// a capability held by one process, for one launch.
//
// The nice second-order effect: with a real hash configured, `isProtected()` is
// true, so Backup & sync works on the desktop. In open local mode the server
// (correctly) refuses to push a vault anywhere on the word of whoever
// connected.
//
// ── ONE THING THAT IS DELIBERATELY NOT HARD-CODED ──────────────────────────
// The session lifetime. `SESSION_TTL_MS` lives in server/auth.ts (7 days,
// sliding), is not exported, and is exactly the kind of number that gets tuned
// once and forgotten. So the app reads it off the wire: `setSessionCookie`
// writes `Max-Age` from that constant, so the login response TELLS us, and the
// re-sign-in below is scheduled from what the server said rather than from a
// copy of it that could quietly stop being true.

import { randomBytes } from "node:crypto";
import argon2 from "argon2";
import type { Session } from "electron";
import { parseSessionCookie, type SessionCookie } from "./cookie.ts";

export interface Credential {
  /** The plaintext. In memory, in this process, for this launch. */
  password: string;
  /** What the server child is given as ADMIN_PASSWORD_HASH. */
  hash: string;
  /** What the server child is given as SESSION_SECRET. */
  secret: string;
}

/** argon2 parameters for a password NOBODY TYPES.
 *
 *  scripts/hash-password.ts uses m=65536 p=4 — 64 MiB and four threadpool jobs
 *  — because a human password is short, guessable and worth the ~0.6s of
 *  stretching. This one is 32 bytes from `randomBytes`: there is no dictionary
 *  attack on 256 bits of entropy, and stretching it buys nothing but ~1.2s of
 *  launch time (once to hash, once to verify) on every single start of the app.
 *  So the cost is dropped to what it is actually for — being an argon2id hash
 *  the server can verify — and the secrecy comes from the entropy, which is
 *  where it always came from. */
const EPHEMERAL_ARGON2 = { type: 2 as const, memoryCost: 8192, timeCost: 2, parallelism: 1 };

/** Mint this launch's credential. */
export async function mintCredential(): Promise<Credential> {
  const password = randomBytes(32).toString("base64url");
  const hash = await argon2.hash(password, EPHEMERAL_ARGON2);
  return { password, hash, secret: randomBytes(32).toString("hex") };
}

/** Sign in and put the cookie in `ses`'s jar. Returns the lifetime the server
 *  gave it, in ms, so the caller can schedule the next one. Throws with a
 *  readable message — a desktop app that silently ends up unauthenticated
 *  shows the reader a login modal for a password that does not exist. */
export async function signIn(ses: Session, origin: string, credential: Credential): Promise<number> {
  const res = await fetch(`${origin}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: credential.password }),
  });
  if (!res.ok) {
    throw new Error(`vellum: the desktop app could not sign in to its own server (HTTP ${res.status})`);
  }
  const headers = res.headers.getSetCookie?.() ?? [];
  const cookie = headers.map(parseSessionCookie).find((c): c is SessionCookie => c !== null);
  if (!cookie) {
    throw new Error("vellum: the login succeeded but carried no session cookie");
  }
  const lifetimeMs = cookie.maxAge * 1000;
  await ses.cookies.set({
    url: origin,
    name: cookie.name,
    value: cookie.value,
    path: "/",
    httpOnly: true,
    // Loopback http. `secure: true` here would mean a cookie the browser
    // declines to send to the only origin it exists for.
    secure: false,
    sameSite: "lax",
    expirationDate: cookie.maxAge > 0 ? Date.now() / 1000 + cookie.maxAge : undefined,
  });
  return lifetimeMs;
}

/** Keep the session alive for as long as the app is running.
 *
 *  `authGuard` already reissues a cookie past half its life on any API request,
 *  so an app being USED never needs this. It is here for the app that is not:
 *  a reference window left open over a long weekend, a machine that slept. The
 *  timer is set from the lifetime the server reported, halved for the same
 *  reason the server halves it.
 *
 *  Returns a cancel function; the caller stops it when the vault closes. */
export function keepSignedIn(
  ses: Session,
  origin: string,
  credential: Credential,
  lifetimeMs: number,
  onError: (err: unknown) => void,
): () => void {
  let timer: NodeJS.Timeout | null = null;
  const arm = (ms: number): void => {
    // A server that reported no Max-Age at all gets an hour rather than a
    // zero-delay loop — the one failure mode a refresh timer must not have.
    timer = setTimeout(() => {
      void signIn(ses, origin, credential).then(arm).catch(onError);
    }, Math.max(60_000, ms / 2));
    timer.unref();
  };
  arm(lifetimeMs > 0 ? lifetimeMs : 60 * 60 * 1000);
  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
