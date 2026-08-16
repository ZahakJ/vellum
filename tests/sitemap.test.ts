// The crawler pair: `/sitemap.xml` and `/robots.txt` (server/blog.ts).
//
// Both are anonymous discovery surfaces, so both are scoped like `/feed.xml`
// and not like the admin's own vault: published notes only, EXCLUDE_TAGS and
// the languageFilter applied. Before these routes existed, both paths fell
// through to the SPA catch-all and answered a crawler with a 200 and a page of
// HTML — a "sitemap" that was neither XML nor a map.

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { renderFeed, renderRobots, renderSitemap } from "../server/blog.ts";
import { initIndexer } from "../server/indexer.ts";
import { initSite } from "../server/site.ts";
import { patchSettings } from "../server/settings.ts";
import { initVault } from "../server/vault.ts";
import { makeDir, makeVault, note, removeVault } from "./helpers/vault.ts";

const ORIGIN = "https://vellum.example";

const data = makeDir();
const root = makeVault({
  "Newest.md": note({ publish: "true", date: "2026-05-04" }, "The newest published post.\n"),
  "Middle.md": note({ publish: "true", date: "2025-01-02" }, "An older published post.\n"),
  "Folder/Nested post.md": note({ publish: "true", date: "2024-07-07" }, "A post in a folder.\n"),
  "مقالة.md": note({ publish: "true", date: "2024-03-03" }, "فقرة عربية كاملة تكفي لتصنيف اللغة.\n"),
  "About.md": note({ publish: "true", page: "true", date: "2023-02-02" }, "Who writes here.\n"),
  "Draft.md": note({ date: "2026-06-06" }, "Unpublished — nobody may learn this exists.\n"),
});

/** Every `<loc>` in a rendered sitemap, in document order. */
function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
}

/** The `<lastmod>` paired with a given `<loc>`, or null when it carries none. */
function lastmod(xml: string, loc: string): string | null {
  const at = xml.indexOf(`<loc>${loc}</loc>`);
  assert.notEqual(at, -1, `no <loc> for ${loc}`);
  const block = xml.slice(at, xml.indexOf("</url>", at));
  return block.match(/<lastmod>([^<]*)<\/lastmod>/)?.[1] ?? null;
}

const OFF = { mode: "off", lang: null, fallbackFrom: null } as const;

before(async () => {
  initSite({ VELLUM_DATA: data, SITE_URL: ORIGIN });
  initVault(root);
  await initIndexer();
});

after(() => {
  removeVault(root);
  removeVault(data);
});

beforeEach(() => {
  patchSettings({ publicLayout: null });
});

describe("sitemap.xml", () => {
  it("is a well-formed urlset with the front door first", () => {
    const xml = renderSitemap(ORIGIN, OFF);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
    assert.ok(xml.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'));
    assert.ok(xml.trimEnd().endsWith("</urlset>"));
    assert.equal(locs(xml)[0], `${ORIGIN}/`);
    // Every <url> opened is a <url> closed — the cheap structural check that
    // catches a half-built entry before a crawler does.
    assert.equal((xml.match(/<url>/g) ?? []).length, (xml.match(/<\/url>/g) ?? []).length);
  });

  it("names every visitor-visible note and nothing else", () => {
    const found = locs(renderSitemap(ORIGIN, OFF));
    assert.ok(found.includes(`${ORIGIN}/Newest`));
    assert.ok(found.includes(`${ORIGIN}/Middle`));
    assert.ok(found.includes(`${ORIGIN}/Folder/Nested%20post`));
    // AN UNPUBLISHED NOTE IS NOT A URL. A sitemap that names one hands a
    // crawler the one thing the whole visitor surface withholds: existence.
    assert.ok(!found.some((u) => u.includes("Draft")));
    assert.equal(found.length, 6); // home + 5 published notes
  });

  it("keeps static pages, which the feed drops", () => {
    patchSettings({ publicLayout: "designed" });
    const page = `${ORIGIN}/About`;
    // The feed is a timeline and an About page is not an article…
    assert.ok(!renderFeed(ORIGIN, OFF).includes("<link>" + page + "</link>"));
    // …but the sitemap is the list of URLs this site serves, and /About is one.
    assert.ok(locs(renderSitemap(ORIGIN, OFF)).includes(page));
  });

  it("takes lastmod from the note's own date, to the second", () => {
    const xml = renderSitemap(ORIGIN, OFF);
    assert.equal(lastmod(xml, `${ORIGIN}/Middle`), "2025-01-02T00:00:00Z");
    // The front door borrows the newest post's date rather than claiming
    // "now" on every fetch.
    assert.equal(lastmod(xml, `${ORIGIN}/`), lastmod(xml, `${ORIGIN}/Newest`));
    assert.equal(lastmod(xml, `${ORIGIN}/`), "2026-05-04T00:00:00Z");
  });

  it("percent-encodes paths and XML-escapes the result", () => {
    const found = locs(renderSitemap(ORIGIN, OFF));
    assert.ok(found.includes(`${ORIGIN}/%D9%85%D9%82%D8%A7%D9%84%D8%A9`));
    assert.ok(!found.some((u) => /[<>&"']/.test(u)));
  });

  it("is language-scoped exactly like the feed", () => {
    const arabic = locs(renderSitemap(ORIGIN, { mode: "ar", lang: "ar", fallbackFrom: null }));
    assert.deepEqual(arabic, [`${ORIGIN}/`, `${ORIGIN}/%D9%85%D9%82%D8%A7%D9%84%D8%A9`]);
    const english = locs(renderSitemap(ORIGIN, { mode: "en", lang: "en", fallbackFrom: null }));
    assert.ok(english.includes(`${ORIGIN}/Newest`));
    assert.ok(!english.includes(`${ORIGIN}/%D9%85%D9%82%D8%A7%D9%84%D8%A9`));
  });

  it("says so when the filter fell back to every language", () => {
    const xml = renderSitemap(ORIGIN, { mode: "ar", lang: null, fallbackFrom: "ar" });
    assert.match(xml, /<!-- language filter "ar" matched no published note/);
    // The comment is a note to the operator, not a filter: the full set ships.
    assert.equal(locs(xml).length, 6);
  });
});

describe("robots.txt", () => {
  it("points a crawler at the sitemap and away from the API", () => {
    const body = renderRobots(ORIGIN, true);
    assert.match(body, /^User-agent: \*$/m);
    assert.match(body, /^Allow: \/$/m);
    assert.match(body, /^Disallow: \/api\/$/m);
    assert.match(body, new RegExp(`^Sitemap: ${ORIGIN}/sitemap\\.xml$`, "m"));
    assert.ok(body.endsWith("\n"));
  });

  it("disallows everything, and names no sitemap, on a locked instance", () => {
    const body = renderRobots(ORIGIN, false);
    assert.equal(body, "User-agent: *\nDisallow: /\n");
    // A 401 here would mean "no rules exist — crawl freely" (RFC 9309
    // §2.3.1.3), which is the opposite of what PUBLIC=false means. The route
    // therefore answers 200 with a body that discloses nothing.
    assert.ok(!body.includes("Sitemap:"));
  });
});
