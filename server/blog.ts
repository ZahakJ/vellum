// Blog surface: the RSS feed and crawler-facing <head> injection for the
// served SPA shell. Both speak only in published notes — an unpublished or
// unknown path gets the generic site meta, so nothing about the private vault
// (existence included) ever leaks through these routes.

import type { Context } from "hono";
import type { PostMeta } from "../shared/types.ts";
import { posts } from "./indexer.ts";
import { blogLocale, siteName, siteUrl, tagline } from "./site.ts";

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
  const trimmed = notePath.replace(/\.md$/i, "");
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

/** The published post a pathname deep-links to, or null. Matching mirrors the
 *  client router: ".md" optional, case-insensitive, percent-encoded segments.
 *  Only published notes are findable — by construction of posts(). */
function matchPublished(pathname: string): PostMeta | null {
  let decoded: string;
  try {
    decoded = pathname.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null; // malformed percent-encoding
  }
  const rel = decoded.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!rel) return null;
  const want = (rel.toLowerCase().endsWith(".md") ? rel : `${rel}.md`).toLowerCase();
  for (const post of posts()) {
    if (post.path.toLowerCase() === want) return post;
  }
  return null;
}

// ---------------------------------------------------------------------- RSS

const FEED_MAX_ITEMS = 50;

/** RFC-822 date (toUTCString emits RFC-1123, the RSS-valid profile of it). */
function rfc822(iso: string): string {
  return new Date(iso).toUTCString();
}

export function renderFeed(origin: string): string {
  const items = posts()
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
  const post = matchPublished(pathname);
  const name = siteName();
  const title = post ? `${post.title} — ${name}` : name;
  const description = post ? post.excerpt : (tagline() ?? "");
  const canonical = origin + (post ? notePathToUrl(post.path) : "/");
  const tags: string[] = [];
  if (description) {
    tags.push(`<meta name="description" content="${xmlEscape(description)}" />`);
  }
  tags.push(`<meta property="og:title" content="${xmlEscape(title)}" />`);
  if (description) {
    tags.push(`<meta property="og:description" content="${xmlEscape(description)}" />`);
  }
  tags.push(
    `<meta property="og:type" content="${post ? "article" : "website"}" />`,
    `<meta property="og:site_name" content="${xmlEscape(name)}" />`,
    `<link rel="canonical" href="${xmlEscape(canonical)}" />`,
    `<link rel="alternate" type="application/rss+xml" title="${xmlEscape(name)}" href="/feed.xml" />`,
  );
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${xmlEscape(title)}</title>`)
    .replace(HEAD_PLACEHOLDER, tags.join("\n    "));
}
