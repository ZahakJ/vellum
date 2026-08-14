// Entrypoint: resolve + seed the vault, build the index, serve API and client.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { api } from "./api.ts";
import { initAuth } from "./auth.ts";
import { initIndexer } from "./indexer.ts";
import { initVault, isIgnoredSegment, resolveVaultRoot, startWatcher } from "./vault.ts";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT) || 6801;
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
initVault(vaultDir);
startWatcher();
await initIndexer();

const app = new Hono();
app.route("/api", api);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// Prod: serve the built client, with SPA fallback for client-side routes.
const distDir = path.join(projectRoot, "dist");
if (existsSync(distDir)) {
  app.use("*", serveStatic({ root: path.relative(process.cwd(), distDir) || "." }));
  app.get("*", (c) => c.html(readFileSync(path.join(distDir, "index.html"), "utf8")));
}

serve({ fetch: app.fetch, port }, () => {
  const gold = "\x1b[33m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";
  console.log(`
  ${gold}    .   ✦   .${reset}
  ${gold}  v e l l u m${reset}
  ${dim}  ─────────────${reset}
    vault   ${vaultDir}
    serving ${gold}http://localhost:${port}${reset}
`);
});
