// THE ONE NUMBER THE DESKTOP MUST NOT COPY.
//
// `SESSION_TTL_MS` lives in server/auth.ts — 7 days, sliding — and it is not
// exported. It is exactly the kind of constant that gets tuned once, for a good
// reason, and leaves a duplicate of itself somewhere else quietly meaning the
// old thing. The desktop needs it (electron/auth.ts schedules a re-sign-in from
// it), and the honest way to get it is to let the server say it: the login
// response's `Set-Cookie` carries `Max-Age`, written from that constant by
// `setSessionCookie`. So the desktop reads it off the wire.
//
// The cookie's NAME is read the same way and for the same reason. `COOKIE_NAME`
// is private to server/auth.ts, and a desktop app that typed "vellum_session"
// into its own source would keep working for exactly as long as nobody renamed
// it — and then fail by silently never being admin, which surfaces as a login
// modal for a password that does not exist.
//
// Pure and electron-free, so tests/desktop.test.ts drives it directly.

export interface SessionCookie {
  name: string;
  value: string;
  /** Seconds, as the SERVER stated them — see the note at the top. */
  maxAge: number;
}

/** Parse the one `Set-Cookie` the login response carries. Nothing here assumes
 *  the cookie's NAME either: `COOKIE_NAME` is private to server/auth.ts, and a
 *  desktop app that hard-coded "vellum_session" would keep working for exactly
 *  as long as nobody renamed it, then fail by silently never being admin. */
export function parseSessionCookie(header: string): SessionCookie | null {
  const [pair, ...attrs] = header.split(";");
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  if (!name || !value) return null;
  let maxAge = 0;
  for (const attr of attrs) {
    const at = attr.indexOf("=");
    if (at <= 0) continue;
    if (attr.slice(0, at).trim().toLowerCase() !== "max-age") continue;
    const parsed = Number(attr.slice(at + 1).trim());
    if (Number.isFinite(parsed) && parsed > 0) maxAge = Math.floor(parsed);
  }
  return { name, value, maxAge };
}
