// The author-sites enrichment: what one page says about itself, and which
// URLs the server will consent to fetch. The network path is deliberately
// not under test — parseSiteMeta is the part with opinions.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchableSiteUrl, parseSiteMeta } from "../server/authorSites.ts";

describe("authorSites: parseSiteMeta", () => {
  it("prefers og tags and resolves a relative image against the page", () => {
    const html = `<html><head>
      <title>Fallback</title>
      <meta property="og:title" content="Vestige &amp; Light" />
      <meta property="og:description" content="Photographs from the road." />
      <meta property="og:image" content="/covers/main.jpg" />
    </head></html>`;
    const meta = parseSiteMeta(html, "https://vestige.example.com/gallery");
    assert.equal(meta.title, "Vestige & Light");
    assert.equal(meta.description, "Photographs from the road.");
    assert.equal(meta.image, "https://vestige.example.com/covers/main.jpg");
  });

  it("falls back to <title>, tolerates attribute order, drops non-http images", () => {
    const html = `<head>
      <meta content="ignored" name="generator">
      <meta name="description" content="A &#x2014; site">
      <meta content="javascript:alert(1)" property="og:image">
      <title>  Plain Title </title></head>`;
    const meta = parseSiteMeta(html, "https://a.example.com");
    assert.equal(meta.title, "Plain Title");
    assert.equal(meta.description, "A — site");
    assert.equal(meta.image, undefined);
  });

  it("clips runaway fields instead of shipping them", () => {
    const meta = parseSiteMeta(
      `<head><meta property="og:description" content="${"x".repeat(900)}"/></head>`,
      "https://a.example.com",
    );
    assert.ok(meta.description !== undefined && meta.description.length <= 300);
  });
});

describe("authorSites: fetchableSiteUrl", () => {
  it("accepts public http(s) and refuses everything aimed inward", () => {
    assert.equal(fetchableSiteUrl("https://vestige.avicenna.space"), true);
    assert.equal(fetchableSiteUrl("http://example.com/x?y=1"), true);
    for (const bad of [
      "ftp://example.com",
      "not a url",
      "https://localhost:8080",
      "http://127.0.0.1/x",
      "https://10.1.2.3",
      "https://192.168.1.5",
      "https://172.16.0.9",
      "https://169.254.1.1",
      "https://printer.local",
      "http://[::1]:9",
    ]) {
      assert.equal(fetchableSiteUrl(bad), false, bad);
    }
  });
});
