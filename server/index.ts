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
import { canRead, initAuth, isPublishLimited } from "./auth.ts";
import { injectHead, renderFeed, requestOrigin } from "./blog.ts";
import { compressDynamic } from "./compress.ts";
import { injectPreloads, preloadTags } from "./preload.ts";
import { faviconPath } from "./settings.ts";
import { initSite, publicLayout } from "./site.ts";
import { initComments } from "./comments.ts";
import { initIndexer } from "./indexer.ts";
import { initVault, isIgnoredSegment, resolveVaultRoot, startWatcher, statAttachment } from "./vault.ts";

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
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) return true;
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

initAuth();
initSite();
initComments();
initVault(vaultDir);
startWatcher();
await initIndexer();

const app = new Hono();
// Dynamic responses (the JSON API, the feed) get compressed per request; the
// built client is handled separately, with a cache (server/assets.ts). The SSE
// stream is excluded by content type — see server/compress.ts.
app.use("*", compressDynamic());
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// RSS feed of published notes. Independent of dist (it is server-rendered),
// but gated exactly like API reads: PUBLIC=false keeps it behind login.
app.get("/feed.xml", (c) => {
  if (!canRead(c)) return c.json({ error: "Sign in required" }, 401);
  return c.body(renderFeed(requestOrigin(c)), 200, {
    "Content-Type": "application/rss+xml; charset=utf-8",
    "Cache-Control": "no-cache",
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
  // Built assets first: compressed, ETagged, and cached in memory. Falls
  // through to serveStatic for anything it does not recognise as a file, and
  // to the SPA shell for client-side routes.
  app.use("*", staticAssets(distDir));
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
