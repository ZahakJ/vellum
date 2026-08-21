// Entrypoint: resolve + seed the vault, build the index, serve API and client.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import { api, contentTypeFor } from "./api.ts";
import { staticAssets } from "./assets.ts";
import { ConfigError, canRead, initAuth, isPublishLimited } from "./auth.ts";
import { injectHead, renderFeed, renderRobots, renderSitemap, requestOrigin } from "./blog.ts";
import { compressDynamic } from "./compress.ts";
import { startGitSyncTimer } from "./gitSync.ts";
import { languageScope } from "./language.ts";
import { injectPreloads, preloadTags } from "./preload.ts";
import { faviconPath, migrateSettings } from "./settings.ts";
import { initSite, publicLayout } from "./site.ts";
import { warmAuthorSites } from "./authorSites.ts";
import { getSettings } from "./settings.ts";
import { initComments } from "./comments.ts";
import { initIndexer } from "./indexer.ts";
import { initVault, isIgnoredSegment, resolveVaultRoot, startWatcher, statAttachment } from "./vault.ts";
import { isNotePath } from "../shared/noteFormat.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT) || 6801;
const host = process.env.HOST?.trim() || "0.0.0.0";
const vaultDir = resolveVaultRoot(process.argv.slice(2), process.env);

// Seed a fresh vault from vault-seed/ so a clean clone opens onto real notes.
// "Fresh" means missing OR present but holding no markdown at all. Walk with
// early exit and skip ignored dirs (.obsidian/.git/.trash) — a big real vault
// must not be fully enumerated just to answer "is there any markdown?".
function hasMarkdown(dir: string): boolean {
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (isIgnoredSegment(entry.name)) continue;
      if (entry.isFile() && isNotePath(entry.name)) return true;
      if (entry.isDirectory()) stack.push(path.join(current, entry.name));
    }
  }
  return false;
}

{
  const seedDir = path.join(projectRoot, "vault-seed");
  if (!existsSync(vaultDir)) {
    if (existsSync(seedDir)) cpSync(seedDir, vaultDir, { recursive: true });
    else mkdirSync(vaultDir, { recursive: true });
  } else if (existsSync(seedDir) && !hasMarkdown(vaultDir)) {
    cpSync(seedDir, vaultDir, { recursive: true });
  }
}

// A configuration that cannot mean what it says stops the process here, with
// the sentence that fixes it and no stack trace — a startup banner nobody
// reads is how PUBLIC=false stayed silently inert (see auth.ts::initAuth).
try {
  initAuth();
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(`\nvellum: refusing to start.\n\n  ${err.message}\n`);
  process.exit(1);
}
initSite();
// One-time settings migrations, after initSite (they may need siteLanguage())
// and before anything reads the merged view. Silent unless something moved.
migrateSettings();
initComments();
// The author-site cards' OpenGraph cache, warmed before the first visitor
// asks. Fire and forget: a dead site costs boot nothing.
warmAuthorSites(getSettings().authorSites ?? []);
initVault(vaultDir);
startWatcher();
await initIndexer();
// Backup & sync scheduler. Inert unless settings.gitSync is enabled with a
// remote and a non-zero interval — a fresh instance never touches a network.
startGitSyncTimer();

const app = new Hono();

// ── Origin hardening ────────────────────────────────────────────────────────
// This origin runs the admin app: an editor with permanent delete, publish,
// settings PATCH and git sync behind ordinary clicks. It carried no CSP, no
// X-Frame-Options, no nosniff and no Referrer-Policy — so any page anywhere
// could frame it and drive those controls by pointer, and the hand-rolled HTML
// sanitizer in the reading view (client/reading/rawHtml.ts) had no backstop
// behind it whatsoever. One middleware, applied to every response this process
// writes, and every value is a DEFAULT: a route that already stated its own
// (e.g. /api/file's `Content-Security-Policy: sandbox` for SVG and PDF bytes)
// keeps it.
//
// The policy is as tight as the app actually allows: no inline script exists
// anywhere (the built shell loads one module by src), so `script-src 'self'`
// costs nothing; inline STYLE does exist by design (React style props, KaTeX,
// the generated banner gradients), so style-src keeps 'unsafe-inline' — which
// buys back nothing an attacker wants without script. Remote images are
// allowed because `banner: https://…` and raw <img> in notes are documented
// features; everything else is same-origin.
//
// `'wasm-unsafe-eval'` is for ONE thing: pdf.js. The reader (client/books/)
// decodes JBIG2 and JPEG 2000 — the two formats every scanned book in the
// world is stored in — with WebAssembly modules, and instantiating a wasm
// module is a script-src decision. Without this token the reader opens a
// scanned PDF and paints blank pages. It is the NARROW token on purpose:
// `'unsafe-eval'` would also switch JavaScript's own evaluator back on, which
// is the thing `script-src 'self'` is here to keep off.
//
// `worker-src 'self'` is stated rather than inherited, and it is a WALL, not a
// default. The tutorial way to give pdf.js its worker is to fetch the worker
// script and hand it over as a `blob:` URL — and that shim dies here, under a
// policy with no `blob:` in it, in PRODUCTION ONLY: the vite dev server serves
// no CSP at all, so the failure never appears while anyone is building the
// feature and appears for every reader afterwards. So the worker is a real
// same-origin asset that the build emits (client/books/pdfjs.ts), this line
// says out loud where a worker may come from, and `npm run check-books`
// asserts both halves so the shim cannot come back.
const SHELL_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: http:",
  "media-src 'self' data: https: http:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

app.use("*", async (c, next) => {
  await next();
  const headers = c.res.headers;
  if (!headers.has("X-Content-Type-Options")) headers.set("X-Content-Type-Options", "nosniff");
  if (!headers.has("Referrer-Policy")) headers.set("Referrer-Policy", "same-origin");
  if (!(headers.get("Content-Type") ?? "").startsWith("text/html")) return;
  // Documents only: the anti-framing and anti-injection half.
  if (!headers.has("Content-Security-Policy")) headers.set("Content-Security-Policy", SHELL_CSP);
  if (!headers.has("X-Frame-Options")) headers.set("X-Frame-Options", "DENY");
  // The shell's <head> is injected per request and differs by session (a
  // PUBLIC=false vault without a cookie gets generic meta; an admin gets the
  // note's own), so it is exactly as session-varying as the API is.
  if (!headers.has("Cache-Control")) headers.set("Cache-Control", "private, no-cache");
  // Same three dimensions the API varies on (api.ts::VARY_ON): the injected
  // <head> is built from the visitor-visible post set, so under
  // `languageFilter: "follow"` it differs by reader language too.
  if (!headers.has("Vary")) headers.set("Vary", "Cookie, X-Vellum-Preview, X-Vellum-Lang");
});

// Dynamic responses (the JSON API, the feed) get compressed per request; the
// built client is handled separately, with a cache (server/assets.ts). The SSE
// stream is excluded by content type — see server/compress.ts. Below the
// header middleware above, which only ever sets headers on the way out and so
// composes with an encoded body either way.
app.use("*", compressDynamic());
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// RSS feed of published notes. Independent of dist (it is server-rendered),
// but gated exactly like API reads: PUBLIC=false keeps it behind login.
app.get("/feed.xml", (c) => {
  if (!canRead(c)) return c.json({ error: "Sign in required" }, 401);
  // The feed is a VISITOR surface even when an admin fetches it — it is the
  // document strangers subscribe to, so it is always language-scoped (unlike
  // /api/posts, which answers the admin with their whole vault). A feed reader
  // has no headers to offer, so the scope comes from ?lang= — /feed.xml?lang=ar
  // is the Arabic side of a bilingual site as its own subscribable URL.
  return c.body(renderFeed(requestOrigin(c), languageScope(c, true)), 200, {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Cache-Control": "no-cache",
    // Same reason as every /api body: with PUBLIC=false this is a 401 without
    // a session and a full feed with one, off one URL — and now one feed per
    // ?lang= as well, which is a query dimension caches already key on.
    "Vary": "Cookie, X-Vellum-Preview, X-Vellum-Lang",
  });
});

// Sitemap of published notes. Same shape, same gate and same scoping as
// /feed.xml above — this is the other half of the crawler's answer to "what
// exists here", and both are visitor surfaces whatever session fetches them.
// Without this route the path fell through to the SPA catch-all, which
// answered a crawler's /sitemap.xml with a 200 and a page of HTML.
app.get("/sitemap.xml", (c) => {
  if (!canRead(c)) return c.json({ error: "Sign in required" }, 401);
  return c.body(renderSitemap(requestOrigin(c), languageScope(c, true)), 200, {
    "Content-Type": "application/xml; charset=utf-8",
    "Cache-Control": "no-cache",
    "Vary": "Cookie, X-Vellum-Preview, X-Vellum-Lang",
  });
});

// robots.txt. NOT gated with a 401 — see renderRobots: on this one path a 4xx
// means "no rules, crawl freely" (RFC 9309 §2.3.1.3), so a locked instance
// answers 200 with `Disallow: /` instead. The body still says nothing a
// stranger could not already learn by fetching "/".
app.get("/robots.txt", (c) => {
  return c.body(renderRobots(requestOrigin(c), canRead(c)), 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    "Vary": "Cookie, X-Vellum-Preview",
  });
});

// Favicon: settings.favicon (an uploaded vault image) served at the classic
// path with its real content type; without one (or when the file vanished),
// the built-in glyph — same one the shell inlines — so the route always
// answers. Open like custom.css: pure styling, no vault content, and browsers
// fetch it cookie-less contexts anyway. Checked per request so a settings
// change applies without a restart.
const FAVICON_FALLBACK =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">&#128396;</text></svg>`;

app.get("/favicon.ico", async (c) => {
  const rel = faviconPath();
  if (rel) {
    try {
      const file = await statAttachment(rel);
      const headers: Record<string, string> = {
        "Content-Type": contentTypeFor(file.rel),
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      };
      // Uploaded SVGs are sanitized at write time, but keep the same
      // belt-and-suspenders sandbox /api/file applies when serving them.
      if (/\.svg$/i.test(file.rel)) headers["Content-Security-Policy"] = "sandbox";
      return c.body(new Uint8Array(readFileSync(file.abs)), 200, headers);
    } catch {
      // fall through to the built-in glyph
    }
  }
  return c.body(FAVICON_FALLBACK, 200, {
    "Content-Type": "image/svg+xml",
    "Cache-Control": "no-cache",
  });
});

// Prod: serve the built client, with SPA fallback for client-side routes.
// Every served shell gets its <head> injected server-side (title/description/
// og/canonical + RSS alternate): a published note's own meta on its deep link,
// the generic site meta everywhere else — unknown and unpublished paths are
// indistinguishable, and a PUBLIC=false vault without a session always gets
// the generic meta so crawler requests can't probe note existence.
const distDir = path.join(projectRoot, "dist");
if (existsSync(distDir)) {
  const serveShell = (c: Context) => {
    const html = readFileSync(path.join(distDir, "index.html"), "utf8");
    const pathname = canRead(c) ? c.req.path : "/";
    // Which shell this request will mount is knowable HERE — the layout is
    // configuration and the session is a cookie already being read — so the
    // browser can fetch that shell's chunk in parallel with the entry instead
    // of discovering it a round trip later. Mirrors App.tsx's `blogVisitor`.
    const shell = publicLayout() === "blog" && isPublishLimited(c) ? "blog" : "app";
    return c.html(
      injectPreloads(injectHead(html, requestOrigin(c), pathname), preloadTags(distDir, shell)),
    );
  };
  // "/" and "/index.html" would otherwise be served raw by serveStatic.
  app.get("/", serveShell);
  app.get("/index.html", serveShell);
  // pdf.js side data (dist/pdfjs/**, put there by the pdfjsAssets() plugin in
  // vite.config.ts). serveStatic below already answers these; what it gets
  // wrong is the ONE content type that is load-bearing. `WebAssembly.
  // instantiateStreaming` refuses anything that is not `application/wasm`,
  // and pdf.js's JBIG2 and JPEG 2000 decoders — i.e. every scanned book —
  // come through it. It does fall back to the slower non-streaming path, with
  // a console warning, so this is a performance fix rather than a correctness
  // one; it is here because the warning is otherwise the reader's first
  // impression of the feature.
  app.use("/pdfjs/*", async (c, next) => {
    await next();
    if (c.req.path.endsWith(".wasm")) c.res.headers.set("Content-Type", "application/wasm");
  });
  // Built assets first: compressed, ETagged, and cached in memory. Falls
  // through to serveStatic for anything it does not recognise as a file, and
  // to the SPA shell for client-side routes.
  app.use("*", staticAssets(distDir));
  app.use("*", serveStatic({ root: path.relative(process.cwd(), distDir) || "." }));
  app.get("*", serveShell);
}

// ── A PARENT PROCESS, WHEN THERE IS ONE ─────────────────────────────────────
// The desktop app (electron/) does not import this file; it SPAWNS it, with an
// IPC channel, so that the web deployment and the desktop run the same boot in
// the same order rather than two callers of a factored-out `boot()` that only
// one of them exercises. Two lines is the whole of what that costs here, and
// both are inert without a parent: `process.send` exists only when the process
// was given an "ipc" stdio.
//
// The disconnect handler is the one that matters. Without it, quitting the
// desktop app leaves this process alive — holding the vault's port, watching
// its directory and rebuilding its index for a window that no longer exists —
// and the next launch of that vault finds its own port taken and has to move,
// which is precisely the event that loses the reader's stored theme, tabs and
// folds (see electron/prefs.ts).
if (process.send) {
  process.on("disconnect", () => process.exit(0));
}

serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  // The port the OS actually gave us, not the one we asked for. They differ
  // when PORT=0, and a parent that is about to load `http://127.0.0.1:<port>`
  // needs the true one.
  process.send?.({ type: "vellum:listening", port: info.port });
  const gold = "\x1b[33m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const shownHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  console.log(`
  ${gold}    .   ✦   .${reset}
  ${gold}  v e l l u m${reset}
  ${dim}  ─────────────${reset}
    vault   ${vaultDir}
    serving ${gold}http://${shownHost}:${info.port}${reset}${host !== "0.0.0.0" ? `${dim}  (bound to ${host})${reset}` : ""}
`);
});
