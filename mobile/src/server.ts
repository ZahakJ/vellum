import { CapacitorHttp, type HttpResponse } from "@capacitor/core";
import { t } from "./i18n.ts";

/**
 * Talking to the instance from the SHELL's own origin.
 *
 * Every call here goes through `CapacitorHttp`, not `fetch`, and that is not a
 * preference — it is the only thing that works. The connection screen is served
 * from https://localhost; the vault lives on the owner's host. A browser `fetch`
 * between them is cross-origin, and Vellum's server ships no CORS headers at
 * all (correctly: it is not an API anyone else should be calling). CapacitorHttp
 * performs the request natively, so there is no preflight to fail — and it
 * shares the WebView's CookieManager, so the `vellum_session` cookie the served
 * app set when the owner signed in rides along on the capture sheet's write.
 */

/** Ten seconds, twice: a home server waking a spun-down disk deserves more than
 *  a browser's default patience, and a wrong address deserves less than a
 *  minute of a spinner. */
const CONNECT_TIMEOUT = 10_000;
const READ_TIMEOUT = 10_000;

/** Hosts that are, by construction, on a network with no public certificate
 *  authority — so a bare address there means http, not a broken https. */
function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true;
  if (h === "127.0.0.1" || h === "::1" || h === "[::1]") return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  // Carrier-grade NAT and link-local, which a phone on a mesh VPN can see.
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

export interface NormalizeOk { ok: true; url: string; host: string }
export interface NormalizeErr { ok: false; message: string }

/**
 * What the owner typed → an origin this app can open, or a reason it cannot.
 *
 * The scheme is guessed only when none was given, and the guess is stated on
 * screen (`serverHint`) rather than made behind the owner's back: a bare name
 * is https, an address on their own network is http. Typing the scheme always
 * wins.
 */
export function normalizeServerUrl(input: string): NormalizeOk | NormalizeErr {
  const raw = input.trim();
  if (!raw) return { ok: false, message: t.errEmpty };

  let candidate = raw;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    // Parse it once as https just to learn the host, then decide the scheme.
    let host = "";
    try {
      host = new URL(`https://${candidate}`).hostname;
    } catch {
      return { ok: false, message: t.errUrl };
    }
    candidate = `${isLocalHost(host) ? "http" : "https"}://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, message: t.errUrl };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, message: t.errScheme };
  }
  if (!url.hostname) return { ok: false, message: t.errUrl };

  // Keep a base path if there is one ("https://box.example/vellum"), drop the
  // trailing slash so joining is a plain concatenation everywhere below.
  const path = url.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${url.protocol}//${url.host}${path}`, host: url.host };
}

/** The subset of /api/me the shell has an opinion about. Everything else on
 *  that payload belongs to the served client. */
export interface MeData {
  admin: boolean;
  public: boolean;
  protected: boolean;
  siteName?: string;
}

export type ProbeResult =
  | { ok: true; me: MeData }
  | { ok: false; message: string };

function isMe(data: unknown): data is MeData {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  // Three booleans that /api/me answers for EVERY session, signed in or not —
  // the route is on the auth guard's open list, which is what makes it a
  // usable handshake before anyone has typed a password.
  return typeof d.admin === "boolean" && typeof d.public === "boolean" && typeof d.protected === "boolean";
}

/** Is this a Vellum server, and what kind of welcome does it give? */
export async function probe(base: string, host: string): Promise<ProbeResult> {
  let res: HttpResponse;
  try {
    res = await CapacitorHttp.request({
      url: `${base}/api/me`,
      method: "GET",
      headers: { Accept: "application/json" },
      connectTimeout: CONNECT_TIMEOUT,
      readTimeout: READ_TIMEOUT,
    });
  } catch (err) {
    const text = String((err as Error)?.message ?? err).toLowerCase();
    const timedOut = text.includes("timeout") || text.includes("timed out");
    return { ok: false, message: timedOut ? t.errTimeout(host) : t.errUnreachable(host) };
  }

  if (res.status !== 200) return { ok: false, message: t.errStatus(host, res.status) };

  // CapacitorHttp parses JSON when the server says so, and hands back the raw
  // string when it does not — which is exactly what a router, a captive portal
  // or somebody else's site does at this path.
  let data: unknown = res.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return { ok: false, message: t.errNotVellum(host) };
    }
  }
  if (!isMe(data)) return { ok: false, message: t.errNotVellum(host) };
  return { ok: true, me: data };
}

export interface NoteRead {
  found: boolean;
  content: string;
  /** Present only when the note existed — the write precondition to echo back.
   *  Spelled `| undefined` rather than optional because the shell compiles with
   *  `exactOptionalPropertyTypes`: "absent" and "present and unknown" are two
   *  different answers and only one of them is true here. */
  mtimeMs: number | undefined;
}

/** GET one note. A 404 is an ANSWER here, not a failure: the dated inbox note
 *  does not exist until the day's first capture, and creating it is the same
 *  PUT as appending to it. */
export async function readNote(base: string, path: string): Promise<NoteRead> {
  const res = await CapacitorHttp.request({
    url: `${base}/api/note`,
    method: "GET",
    params: { path },
    headers: { Accept: "application/json" },
    connectTimeout: CONNECT_TIMEOUT,
    readTimeout: READ_TIMEOUT,
  });
  if (res.status === 404) return { found: false, content: "", mtimeMs: undefined };
  if (res.status !== 200) throw new HttpError(res.status);
  const data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
  return { found: true, content: String(data?.content ?? ""), mtimeMs: Number(data?.mtimeMs) || undefined };
}

/**
 * PUT one note.
 *
 * `PUT /api/note` is create-or-replace — the server emits "created" when the
 * file was not there and "changed" when it was — so one call covers both arms
 * of a capture. `baseMtimeMs` is the write precondition: it is sent whenever we
 * read a body first, so that a capture cannot silently clobber an edit made on
 * the laptop in the seconds since. On a fresh note there is nothing to guard
 * and the field is left off, which is what the editor's own first save does.
 */
export async function writeNote(base: string, path: string, content: string, baseMtimeMs?: number): Promise<void> {
  const res = await CapacitorHttp.request({
    url: `${base}/api/note`,
    method: "PUT",
    params: { path },
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    data: baseMtimeMs === undefined ? { content } : { content, baseMtimeMs },
    connectTimeout: CONNECT_TIMEOUT,
    readTimeout: READ_TIMEOUT,
  });
  if (res.status !== 200) throw new HttpError(res.status);
}

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}
