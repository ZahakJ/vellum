// Compression for DYNAMIC responses (the JSON API and the RSS feed).
//
// Static assets are handled separately (server/assets.ts) because they can be
// compressed once and cached forever. These cannot: `/api/tree` and
// `/api/graph` change with the vault, and `/api/search` differs per query. So
// they are compressed per response, at a quality chosen for latency rather
// than ratio — brotli q4 turns the fixture's 171 kB tree into ~14 kB in about
// four milliseconds, which is cheaper than the walk that produced it.
//
// It matters most exactly where the payloads are largest, i.e. on the vaults
// where everything else also hurts: a 10k-note tree is well over a megabyte
// of JSON, sent on every reconnect and every burst of vault activity.
//
// Two exclusions, both load-bearing:
//
//   - **`text/event-stream` is never touched.** `/api/events` is an open,
//     unbounded stream; reading its body to compress it would hang the
//     request forever and take live updates with it. The content-type test
//     below is what keeps that from being a possibility rather than a
//     discipline.
//   - **Anything that is not text is skipped.** `/api/file` serves images,
//     video and PDFs — already compressed, and often served as a byte range,
//     which re-encoding would silently break.

import { promisify } from "node:util";
import {
  brotliCompress,
  brotliCompressSync,
  constants as zlibConstants,
  gzip,
  gzipSync,
} from "node:zlib";
import type { Context, MiddlewareHandler } from "hono";

const brotliAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

/** Below this, the framing costs more than the compression saves. */
const MIN_BYTES = 1024;

/** Fast enough to sit in a request's critical path; ~90% of q11's saving. */
const BROTLI_QUALITY = 4;

const COMPRESSIBLE = /^(application\/json|application\/rss\+xml|application\/xml|text\/(plain|xml|html))/;

export function compressDynamic(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    const res = c.res;
    if (!res || res.status === 204 || res.status === 304) return;
    // Never re-encode something already encoded (or ranged).
    if (res.headers.get("Content-Encoding")) return;
    if (res.headers.get("Content-Range")) return;

    const type = res.headers.get("Content-Type") ?? "";
    if (!COMPRESSIBLE.test(type)) return;

    const accept = (c.req.header("accept-encoding") ?? "").toLowerCase();
    const useBrotli = /\bbr\b/.test(accept);
    const useGzip = !useBrotli && /\bgzip\b/.test(accept);
    if (!useBrotli && !useGzip) return;

    const raw = new Uint8Array(await res.arrayBuffer());
    if (raw.byteLength < MIN_BYTES) {
      // The body has been consumed — hand back an equivalent response.
      c.res = new Response(raw, { status: res.status, headers: res.headers });
      return;
    }

    const body = useBrotli
      ? await brotliAsync(raw, {
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
            [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
          },
        })
      : await gzipAsync(raw, { level: 6 });

    const headers = new Headers(res.headers);
    headers.set("Content-Encoding", useBrotli ? "br" : "gzip");
    headers.delete("Content-Length"); // now wrong; the runtime sets the real one
    // A shared cache must not hand these bytes to a client that cannot read them.
    const vary = headers.get("Vary");
    if (!vary) headers.set("Vary", "Accept-Encoding");
    else if (!/accept-encoding/i.test(vary)) headers.set("Vary", `${vary}, Accept-Encoding`);

    c.res = new Response(new Uint8Array(body), { status: res.status, headers });
  };
}

// ── Memoized bodies ────────────────────────────────────────────────────────
//
// `/api/tree` and `/api/graph` already memoize their JSON (server/treeCache.ts,
// server/graphCache.ts) because building it is the expensive part. Once that
// is true, compressing the SAME bytes again on every request becomes the new
// expensive part: brotli over the fixture's 534 kB graph is ~9 ms, and over a
// 10k-note vault's tree it would be tens of milliseconds — per request, of
// single-threaded event loop, for an answer that has not changed.
//
// So the encoded forms live next to the JSON, computed on first demand and
// discarded together with it. Quality stays low for the same reason it does
// in the middleware: these bodies are invalidated by ordinary editing, so a
// slow-but-smaller encode would be paid over and over.

/** A response body plus its encodings, filled in lazily. */
export interface EncodedBody {
  json: string;
  br: Uint8Array<ArrayBuffer> | null;
  gzip: Uint8Array<ArrayBuffer> | null;
}

export function encodedBody(json: string): EncodedBody {
  return { json, br: null, gzip: null };
}

function copy(buf: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

/** Answer with a memoized JSON body, encoded at most once per encoding.
 *
 *  Sets `Content-Encoding` itself, which is also what makes the middleware
 *  above skip the response instead of re-encoding it. */
export function sendEncoded(c: Context, body: EncodedBody): Response {
  const accept = (c.req.header("accept-encoding") ?? "").toLowerCase();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Vary: "Accept-Encoding",
  };
  const worthIt = body.json.length >= MIN_BYTES;
  if (worthIt && /\bbr\b/.test(accept)) {
    body.br ??= copy(
      brotliCompressSync(body.json, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.json.length,
        },
      }),
    );
    headers["Content-Encoding"] = "br";
    return c.body(body.br, 200, headers);
  }
  if (worthIt && /\bgzip\b/.test(accept)) {
    body.gzip ??= copy(gzipSync(body.json, { level: 6 }));
    headers["Content-Encoding"] = "gzip";
    return c.body(body.gzip, 200, headers);
  }
  return c.body(body.json, 200, headers);
}
