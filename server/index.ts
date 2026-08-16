// Entrypoint: resolve + seed the vault, build the index, serve API and client.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Context } from "hono";
import { api, contentTypeFor } from "./api.ts";
import { ConfigError, canRead, initAuth } from "./auth.ts";
import { injectHead, renderFeed, requestOrigin } from "./blog.ts";
import { startGitSyncTimer } from "./gitSync.ts";
import { languageScope } from "./language.ts";
import { faviconPath, migrateSettings } from "./settings.ts";
import { initSite } from "./site.ts";
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
const SHELL_CSP = [
  "default-src 'self'",
  "script-src 'self'",
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
    return c.html(injectHead(html, requestOrigin(c), pathname));
  };
  // "/" and "/index.html" would otherwise be served raw by serveStatic.
  app.get("/", serveShell);
  app.get("/index.html", serveShell);
  app.use("*", serveStatic({ root: path.relative(process.cwd(), distDir) || "." }));
  app.get("*", serveShell);
}

serve({ fetch: app.fetch, port, hostname: host }, () => {
  const gold = "\x1b[33m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  const shownHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  console.log(`
  ${gold}    .   ✦   .${reset}
  ${gold}  v e l l u m${reset}
  ${dim}  ─────────────${reset}
    vault   ${vaultDir}
    serving ${gold}http://${shownHost}:${port}${reset}${host !== "0.0.0.0" ? `${dim}  (bound to ${host})${reset}` : ""}
`);
});
