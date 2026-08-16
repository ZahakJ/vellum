// Built-client asset serving: content negotiation (brotli / gzip), a bounded
// in-memory cache of the compressed bytes, ETags and long-lived caching for
// hashed filenames.
//
// Why this exists rather than `serveStatic` alone: the client ships as text
// (JS, CSS, SVG) and `serveStatic` hands it over uncompressed, so every cold
// visit paid ~3× the bytes it had to. On the measured 1,388-note fixture the
// blog home's entry script alone was 350 kB on the wire where brotli makes it
// 96 kB. It is the largest single lever on "what a reader downloads", and it
// costs the server one compression per asset per encoding, for the process
// lifetime.
//
// Correctness notes, because a caching layer is exactly where staleness hides:
//
//   - The cache key includes the file's size and mtime. A rebuilt `dist/`
//     therefore invalidates every entry it changed, even at the same URL
//     (`index.html`, which is NOT content-hashed, is the one that matters).
//   - `Cache-Control: immutable` is only ever attached to a filename carrying
//     a build hash (`name-B7xK2q.js`). Everything else gets `no-cache`, i.e.
//     "revalidate every time", which the ETag then answers with a cheap 304.
//   - `Vary: Accept-Encoding` is always sent, so a shared proxy cannot serve
//     brotli bytes to a client that did not ask for them.
//   - Compression is skipped for anything already compressed (woff2, images,
//     video) and for bodies under 1 kB, where the framing costs more than it
//     saves.

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { brotliCompress, brotliCompressSync, constants as zlibConstants, gzipSync } from "node:zlib";
import type { MiddlewareHandler } from "hono";

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
};

/** Text-ish types worth compressing. Everything else is already compressed. */
const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json|xml)|image\/svg)/;

/** Below this, compression framing costs more than it saves. */
const MIN_COMPRESS_BYTES = 1024;

/** Vite (and every other bundler) writes `name-<hash>.ext`; such a URL can
 *  never change meaning, so it is safe to cache for a year. */
const HASHED = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

/** Total bytes of cached bodies. A built client is a couple of MB across
 *  three encodings; the ceiling is here so a `dist/` full of media cannot
 *  turn this into a memory leak. Oldest-first eviction (Map insertion order),
 *  freshened on hit — the same bounded-LRU shape the client's hover cards use. */
const CACHE_MAX_BYTES = 48 * 1024 * 1024;

/** Copy into a plain (non-shared) ArrayBuffer view — what Hono's `c.body`
 *  accepts, and what keeps the cached bytes independent of the Buffer pool. */
function toBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(buf.byteLength);
  out.set(buf);
  return out;
}

// Brotli quality is a latency/size trade with a 50× spread, and the right
// answer is BOTH ends of it. Measured on this client's 282 kB CodeMirror
// chunk: q5 → 86.2 kB in 13 ms, q11 → 77.8 kB in 465 ms. Paying 465 ms of
// blocked event loop to serve the very first visitor after a restart is how a
// "compression win" turns into a first-contentful-paint regression — the
// first cold blog home measured 896 ms FCP doing exactly that.
//
// So: answer immediately at q5, then recompress at q11 on the libuv
// threadpool (the ASYNC zlib API, which does not block the event loop) and
// swap the smaller body into the cache. Visitor one pays nothing, visitor two
// onward gets the 10% that q11 buys. The ETag is unaffected because it
// identifies the RESOURCE, not the encoding.
const FAST_QUALITY = 5;
const MAX_QUALITY = 11;

/** Bodies above this are not worth a background recompress. */
const UPGRADE_MAX_BYTES = 4 * 1024 * 1024;

interface Entry {
  body: Uint8Array<ArrayBuffer>;
  etag: string;
  type: string;
  encoding: string | null;
  /** true once the q11 body has landed (or been ruled out). */
  upgraded?: boolean;
}

const cache = new Map<string, Entry>();
let cachedBytes = 0;

function remember(key: string, entry: Entry): Entry {
  // A single body larger than the whole budget is served but never cached.
  if (entry.body.byteLength > CACHE_MAX_BYTES) return entry;
  while (cachedBytes + entry.body.byteLength > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const victim = cache.get(oldest.value);
    cache.delete(oldest.value);
    cachedBytes -= victim ? victim.body.byteLength : 0;
  }
  cache.set(key, entry);
  cachedBytes += entry.body.byteLength;
  return entry;
}

/** Recompress `raw` at max quality off the event loop and swap the result in.
 *  Fire-and-forget: if anything invalidated or evicted the entry meanwhile,
 *  the result is simply dropped. */
function upgrade(key: string, raw: Buffer): void {
  const current = cache.get(key);
  if (!current || current.upgraded) return;
  current.upgraded = true; // claim it, so a second request does not queue a second pass
  brotliCompress(
    raw,
    {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: MAX_QUALITY,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
      },
    },
    (err, better) => {
      if (err || !better) return;
      const live = cache.get(key);
      // Only replace the exact entry we started from, and only if it helps.
      if (live !== current || better.byteLength >= live.body.byteLength) return;
      cachedBytes += better.byteLength - live.body.byteLength;
      live.body = toBytes(better);
    },
  );
}

function typeFor(rel: string): string {
  const ext = rel.slice(rel.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] ?? "application/octet-stream";
}

/** br > gzip > identity, honoring `identity;q=0` only as a preference (we
 *  always keep identity available; refusing to serve is worse than ignoring
 *  an exotic header). */
function pickEncoding(accept: string | undefined, type: string, size: number): string | null {
  if (!accept) return null;
  if (size < MIN_COMPRESS_BYTES) return null;
  if (!COMPRESSIBLE.test(type)) return null;
  const a = accept.toLowerCase();
  if (/\bbr\b/.test(a)) return "br";
  if (/\bgzip\b/.test(a)) return "gzip";
  return null;
}

/** Serve one file from `distDir`, or fall through to `next()`.
 *
 *  Only GET/HEAD are handled; anything else belongs to the API. */
export function staticAssets(distDir: string): MiddlewareHandler {
  const root = path.resolve(distDir);

  return async (c, next) => {
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD") return next();

    let rel: string;
    try {
      rel = decodeURIComponent(c.req.path);
    } catch {
      return next();
    }
    // Path safety: resolve and require the result to stay under dist/. A
    // built client has no directories worth listing, so a trailing slash or
    // an empty path is simply not ours.
    if (rel === "/" || rel.endsWith("/")) return next();
    const abs = path.resolve(root, "." + rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) return next();

    let stat;
    try {
      stat = statSync(abs);
    } catch {
      return next();
    }
    if (!stat.isFile()) return next();

    const type = typeFor(abs);
    const encoding = pickEncoding(c.req.header("accept-encoding"), type, stat.size);
    // Size + mtime in the key is what makes a rebuild invalidate the cache.
    const key = `${abs} ${stat.size} ${stat.mtimeMs} ${encoding ?? "id"}`;

    let entry = cache.get(key);
    if (entry) {
      // Freshen: this asset is the most recently used again.
      cache.delete(key);
      cache.set(key, entry);
    } else {
      const raw = readFileSync(abs);
      const body =
        encoding === "br"
          ? brotliCompressSync(raw, {
              params: {
                [zlibConstants.BROTLI_PARAM_QUALITY]: FAST_QUALITY,
                [zlibConstants.BROTLI_PARAM_SIZE_HINT]: raw.byteLength,
              },
            })
          : encoding === "gzip"
            ? gzipSync(raw, { level: 9 })
            : raw;
      // The ETag identifies the RESOURCE, not the encoding — same file, same
      // tag under br and gzip — so a client that switches encodings still
      // revalidates correctly. It is weak for exactly that reason.
      const etag = `W/"${createHash("sha1").update(raw).digest("base64url").slice(0, 22)}"`;
      entry = remember(key, { body: toBytes(body), etag, type, encoding });
      if (encoding === "br" && raw.byteLength <= UPGRADE_MAX_BYTES) upgrade(key, raw);
    }

    const headers: Record<string, string> = {
      "Content-Type": entry.type,
      ETag: entry.etag,
      Vary: "Accept-Encoding",
      "Cache-Control": HASHED.test(abs) ? "public, max-age=31536000, immutable" : "no-cache",
    };
    if (entry.encoding) headers["Content-Encoding"] = entry.encoding;

    const inm = c.req.header("if-none-match");
    if (inm && inm.split(",").some((tag) => tag.trim() === entry.etag)) {
      return c.body(null, 304, headers);
    }
    if (method === "HEAD") {
      headers["Content-Length"] = String(entry.body.byteLength);
      return c.body(null, 200, headers);
    }
    return c.body(entry.body, 200, headers);
  };
}

/** Bytes currently held by the compressed-asset cache — for diagnostics. */
export function assetCacheBytes(): number {
  return cachedBytes;
}
