// The author's other sites, enriched for the blog: settings.authorSites holds
// bare URLs; visitors deserve cards. Each site is asked ONCE for its own
// OpenGraph story (og:title / og:description / og:image, <title> as the
// fallback), the answer lands in VELLUM_DATA/author-sites.json, and /api/me
// serves cards straight from that cache — never from the network. The cache
// warms in the background at boot and whenever the admin saves the setting,
// and refreshes the same way once an entry is a day old, so the request path
// stays synchronous and a slow or dead site costs visitors nothing.
//
// The fetch is deliberately small: http(s) only, private hosts refused (the
// admin is trusted, but a URL that resolves into the machine the server runs
// on has no business being fetched by it), six seconds, first 512 KB. The
// og:image URL is stored as-is and hotlinked by the blog — the shell CSP
// already admits https: images, and proxying strangers' bytes through this
// server would be a worse trade.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AuthorSiteCard, AuthorSiteRef } from "../shared/types.ts";
import { dataDir } from "./site.ts";

const CACHE_FILE = "author-sites.json";
const REFRESH_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const BODY_CAP = 512 * 1024;
const FIELD_MAX = 300;

interface CacheEntry {
  fetchedAt: number;
  ok: boolean;
  title?: string;
  description?: string;
  image?: string;
}

let cache: Record<string, CacheEntry> | null = null;
const inFlight = new Set<string>();

function cachePath(): string {
  return path.join(dataDir(), CACHE_FILE);
}

function loadCache(): Record<string, CacheEntry> {
  if (cache) return cache;
  try {
    const raw: unknown = JSON.parse(readFileSync(cachePath(), "utf8"));
    cache = raw !== null && typeof raw === "object" ? (raw as Record<string, CacheEntry>) : {};
  } catch {
    cache = {};
  }
  return cache;
}

function saveCache(): void {
  if (!cache) return;
  try {
    mkdirSync(dataDir(), { recursive: true });
    const tmp = `${cachePath()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    renameSync(tmp, cachePath());
  } catch (err) {
    console.error("vellum: could not persist the author-sites cache:", err);
  }
}

/** Is this a URL the server may fetch on the admin's behalf? http(s), with a
 *  hostname that is not an address into the server's own network. Exported
 *  for settings validation, so a bad URL is refused at save time with a
 *  message rather than quietly never producing a card. */
export function fetchableSiteUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "0.0.0.0" || host.endsWith(".local")) return false;
  if (host === "::1" || host === "[::1]") return false;
  if (/^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return true;
}

/** One meta tag's content, tolerant of attribute order and quote style. */
function metaContent(html: string, property: string): string | null {
  const tag = new RegExp(
    `<meta\\s+[^>]*(?:property|name)\\s*=\\s*["']${property}["'][^>]*>`,
    "i",
  ).exec(html);
  if (!tag) return null;
  const content = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag[0]);
  const value = content?.[1] ?? content?.[2] ?? null;
  return value ? decodeEntities(value).trim() : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#?apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function clip(s: string | null | undefined): string | undefined {
  if (!s) return undefined;
  const clean = s.replace(/\s+/g, " ").trim();
  if (clean === "") return undefined;
  return clean.length > FIELD_MAX ? `${clean.slice(0, FIELD_MAX - 1)}…` : clean;
}

/** What one page says about itself. Exported for tests. */
export function parseSiteMeta(
  html: string,
  base: string,
): { title?: string; description?: string; image?: string } {
  const title =
    metaContent(html, "og:title") ??
    metaContent(html, "twitter:title") ??
    (() => {
      const t = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
      return t ? decodeEntities(t[1]).trim() : null;
    })();
  const description =
    metaContent(html, "og:description") ??
    metaContent(html, "description") ??
    metaContent(html, "twitter:description");
  let image = metaContent(html, "og:image") ?? metaContent(html, "twitter:image");
  if (image) {
    try {
      const resolved = new URL(image, base);
      image = resolved.protocol === "https:" || resolved.protocol === "http:" ? resolved.href : null;
    } catch {
      image = null;
    }
  }
  return { title: clip(title), description: clip(description), image: image ?? undefined };
}

async function fetchMeta(url: string): Promise<CacheEntry> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "vellum-link-preview/1.0 (+https://github.com/ZahakJ/vellum)" },
    });
    if (!res.ok || !res.body) return { fetchedAt: Date.now(), ok: false };
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html")) return { fetchedAt: Date.now(), ok: false };
    // First 512 KB — og tags live in <head>; a page that buries them deeper
    // than that has made its choice.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      if (size >= BODY_CAP) break;
    }
    void reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks).toString("utf8");
    return { fetchedAt: Date.now(), ok: true, ...parseSiteMeta(html, res.url || url) };
  } catch {
    return { fetchedAt: Date.now(), ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Refresh every stale or missing entry, in the background. Fire and forget:
 *  callers never await the network. */
export function warmAuthorSites(refs: AuthorSiteRef[]): void {
  const store = loadCache();
  for (const ref of refs) {
    if (!fetchableSiteUrl(ref.url)) continue;
    const have = store[ref.url];
    if (have && Date.now() - have.fetchedAt < REFRESH_MS) continue;
    if (inFlight.has(ref.url)) continue;
    inFlight.add(ref.url);
    void fetchMeta(ref.url)
      .then((entry) => {
        // A failed refresh keeps the last good story: stale beats blank.
        const previous = loadCache()[ref.url];
        loadCache()[ref.url] = entry.ok || !previous?.ok ? entry : { ...previous, fetchedAt: entry.fetchedAt };
        saveCache();
      })
      .finally(() => inFlight.delete(ref.url));
  }
}

/** The cards, straight from the cache — no network, ever. A URL with no
 *  cached story still gets a card (title falls back to the admin's override,
 *  then the domain), so a freshly configured site shows up immediately and
 *  simply gains its description and cover on a later load. */
export function authorSiteCards(refs: AuthorSiteRef[]): AuthorSiteCard[] {
  if (refs.length === 0) return [];
  const store = loadCache();
  warmAuthorSites(refs);
  const cards: AuthorSiteCard[] = [];
  for (const ref of refs) {
    if (!fetchableSiteUrl(ref.url)) continue;
    const meta = store[ref.url];
    const domain = new URL(ref.url).hostname.replace(/^www\./, "");
    cards.push({
      url: ref.url,
      domain,
      title: ref.title ?? meta?.title ?? domain,
      ...(meta?.description ? { description: meta.description } : {}),
      ...(meta?.image ? { image: meta.image } : {}),
    });
  }
  return cards;
}
