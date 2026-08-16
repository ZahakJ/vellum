// Blog surface: the RSS feed and crawler-facing <head> injection for the
// served SPA shell. Both are anonymous discovery surfaces, so both speak only
// in VISITOR-visible notes — published AND not curated away by the
// languageFilter (posts(true)). An unpublished, filtered-out or unknown path
// gets the generic site meta, so nothing about the private vault (existence
// included) ever leaks through these routes.

import type { Context } from "hono";
import type { PostMeta } from "../shared/types.ts";
import type { FilterLang } from "./indexer.ts";
import { posts, publishedBanner } from "./indexer.ts";
import { staticPagesActive } from "./pages.ts";
import { faviconPath } from "./settings.ts";
import { siteScope, type LanguageScope } from "./language.ts";
import { blogLocale, siteLanguage, siteName, siteUrl, tagline } from "./site.ts";
import { noteCandidates, stripNoteExt } from "../shared/noteFormat.ts";

// ------------------------------------------------------------------ helpers

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Vault note path → deep-link pathname ("a/b.md" → "/a/b"), mirroring the
 *  client router's notePathToUrl. */
export function notePathToUrl(notePath: string): string {
  const trimmed = stripNoteExt(notePath);
  return "/" + trimmed.split("/").map(encodeURIComponent).join("/");
}

/** Origin for absolute links: SITE_URL when configured, else derived from the
 *  request (X-Forwarded-* honored — link cosmetics, not a security decision). */
export function requestOrigin(c: Context): string {
  const configured = siteUrl();
  if (configured) return configured;
  const url = new URL(c.req.url);
  const proto =
    c.req.header("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(/:$/, "");
  const host = c.req.header("x-forwarded-host")?.split(",")[0].trim() || url.host;
  return `${proto}://${host}`;
}

/** The visitor-visible post a pathname deep-links to, or null. Matching mirrors
 *  the client router: ".md" optional, case-insensitive, percent-encoded
 *  segments.
 *
 *  posts(TRUE) — the visitor list — is the only correct source here. This is a
 *  crawler-facing surface with no session: it is what puts a note into Google
 *  and into social cards. Iterating the admin list leaked a language-hidden
 *  note's title, a 220-char body excerpt (og:description) and its banner
 *  (og:image) to anyone who guessed the deep link, while the sibling feed one
 *  function below correctly hid it — the loudest possible discovery surface
 *  contradicting the quiet one. The permalink itself keeps working: the client
 *  fetches /api/note directly, and /api/note is deliberately never filtered. */
function matchPublished(pathname: string, lang: FilterLang): PostMeta | null {
  let decoded: string;
  try {
    decoded = pathname.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null; // malformed percent-encoding
  }
  const rel = decoded.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!rel) return null;
  // Every note extension is tried, in the same order the client router and
  // the server resolver use, so a `.tex` permalink is matched here exactly as
  // a `.md` one is — and a crawler that follows the feed's link lands on the
  // post's own <title> and og: tags rather than on the generic site meta.
  const wants = noteCandidates(rel).map((c) => c.toLowerCase());
  for (const post of posts(true, lang)) {
    if (wants.includes(post.path.toLowerCase())) return post;
  }
  return null;
}

// ---------------------------------------------------------------------- RSS

const FEED_MAX_ITEMS = 50;

/** RFC-822 date (toUTCString emits RFC-1123, the RSS-valid profile of it). */
function rfc822(iso: string): string {
  return new Date(iso).toUTCString();
}

export function renderFeed(origin: string, scope: LanguageScope): string {
  // The feed is a public discovery surface: the language filter applies
  // (posts(true, …)), exactly like the visitor post list. A feed reader cannot
  // send a header, so /feed.xml honors ?lang= — one feed URL per language,
  // which is what a bilingual reader subscribing to "the Arabic side" needs.
  // …and, in designed mode, minus the static pages: an About page is part of
  // the site, not an item in its feed (server/pages.ts). staticPagesActive()
  // is false under the stock blog, so this feed is byte-for-byte what it was.
  const items = posts(true, scope.lang, staticPagesActive())
    .slice(0, FEED_MAX_ITEMS)
    .map((post) => {
      const link = origin + notePathToUrl(post.path);
      return [
        "    <item>",
        `      <title>${xmlEscape(post.title)}</title>`,
        `      <link>${xmlEscape(link)}</link>`,
        `      <guid>${xmlEscape(link)}</guid>`,
        `      <pubDate>${rfc822(post.date)}</pubDate>`,
        `      <description>${xmlEscape(post.excerpt)}</description>`,
        "    </item>",
      ].join("\n");
    });
  const description = tagline() ?? siteName();
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${xmlEscape(siteName())}</title>`,
    `    <link>${xmlEscape(`${origin}/`)}</link>`,
    `    <atom:link href="${xmlEscape(`${origin}/feed.xml`)}" rel="self" type="application/rss+xml"/>`,
    `    <description>${xmlEscape(description)}</description>`,
    `    <language>${xmlEscape(blogLocale())}</language>`,
    `    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>`,
    // The quiet note, in the one place an XML document has for one: this feed
    // is wider than the site's own setting asked for, because the language it
    // asked for matched nothing and an empty feed is not an answer.
    ...(scope.fallbackFrom
      ? [
          `    <!-- language filter "${xmlEscape(scope.fallbackFrom)}" matched no published note; ` +
            `serving all languages -->`,
        ]
      : []),
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

// ------------------------------------------------------------ head injection

/** Placeholder comment in client/index.html the meta block replaces. */
export const HEAD_PLACEHOLDER = "<!--vellum:head-->";

/** Serve-time SEO: swap the shell's <title> and expand the placeholder into
 *  description/og/canonical (+ RSS alternate) tags. `pathname` deep-linking a
 *  published note gets that note's meta; anything else — "/", unpublished,
 *  unknown — gets the generic site meta (no existence leak). Callers that must
 *  not reveal reads (PUBLIC=false without a session) pass "/" as pathname. */
export function injectHead(html: string, origin: string, pathname: string): string {
  // Crawler-facing and session-less: it speaks for the SITE, so it takes the
  // site scope rather than a reader's. Under "follow" that is the site
  // language — the honest default for a request with no reader behind it.
  const post = matchPublished(pathname, siteScope().lang);
  const name = siteName();
  const title = post ? `${post.title} — ${name}` : name;
  const description = post ? post.excerpt : (tagline() ?? "");
  const canonical = origin + (post ? notePathToUrl(post.path) : "/");
  const tags: string[] = [];
  if (description) {
    tags.push(`<meta name="description" content="${xmlEscape(description)}" />`);
  }
  tags.push(`<meta property="og:title" content="${xmlEscape(title)}" />`);
  // A published note's banner doubles as its social card image. Attachment
  // banners are visitor-fetchable by construction (publish allowlist).
  const banner = post ? publishedBanner(post.path) : null;
  if (banner) {
    const image = /^https:\/\//i.test(banner)
      ? banner
      : `${origin}/api/file?path=${encodeURIComponent(banner)}`;
    tags.push(`<meta property="og:image" content="${xmlEscape(image)}" />`);
  }
  if (description) {
    tags.push(`<meta property="og:description" content="${xmlEscape(description)}" />`);
  }
  tags.push(
    `<meta property="og:type" content="${post ? "article" : "website"}" />`,
    `<meta property="og:site_name" content="${xmlEscape(name)}" />`,
    `<link rel="canonical" href="${xmlEscape(canonical)}" />`,
    `<link rel="alternate" type="application/rss+xml" title="${xmlEscape(name)}" href="/feed.xml" />`,
  );
  let out = html
    .replace(/<title>[^<]*<\/title>/, `<title>${xmlEscape(title)}</title>`)
    .replace(HEAD_PLACEHOLDER, tags.join("\n    "));
  // Arabic mode: the served shell is RTL from the very first paint — the
  // client re-applies the same attributes from /api/me, so this only removes
  // the pre-hydration LTR flash.
  if (siteLanguage() === "ar") {
    out = out.replace(/<html\s+lang="en">/, `<html lang="ar" dir="rtl">`);
  }
  // A configured favicon (settings.json) replaces the shell's inline default
  // so the tab icon is right from the very first paint, before any JS runs.
  // NB: the default href is a data: URI that CONTAINS ">" characters (inline
  // SVG), so the match must consume quoted attribute values, not stop at the
  // first ">" like a naive [^>]* would.
  if (faviconPath()) {
    out = out.replace(
      /<link\s+rel="icon"(?:\s+(?:[a-z-]+="[^"]*"|[a-z-]+))*\s*\/?>/i,
      `<link rel="icon" href="/favicon.ico" />`,
    );
  }
  return out;
}
