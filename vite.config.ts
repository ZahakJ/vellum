import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { chunkFor } from "./build/chunks.ts";

// ── pdf.js side data ───────────────────────────────────────────────────────
// pdf.js is not one file. Four directories ship beside it and each answers a
// question the library cannot answer from the PDF alone:
//
//   cmaps/          how a CJK font's byte sequences map to Unicode. Absent,
//                   a Japanese book renders as boxes.
//   standard_fonts/ the base-14 fonts (Helvetica, Times, …) that a PDF is
//                   allowed to REFERENCE without embedding. A great many
//                   documents do exactly that.
//   wasm/           the JBIG2 and JPEG 2000 decoders. Every scanned book in
//                   the world is one of those two formats.
//   iccs/           the colour profile used to render CMYK correctly.
//
// They are files fetched at runtime by URL, not modules, so bundling cannot
// reach them: rollup would have to know that a string built inside pdf.js
// names a file on disk. So they are copied verbatim to `/pdfjs/…` — a real,
// same-origin path under `connect-src 'self'` — and served from node_modules
// in dev by the middleware below, which is what keeps the dev server and the
// built site agreeing about a URL that would otherwise only exist in one of
// them. (The one thing this plugin deliberately does NOT handle is the pdf.js
// WORKER: that is a module, it is imported with `?url` from
// client/books/pdfjs.ts so the build hashes and emits it like any other asset,
// and `npm run check-books` asserts it never becomes a `blob:` — see the CSP
// note in server/index.ts.)
const PDFJS_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];

/** Where the URL prefix lives, both in dev and under dist/. Spelled again
 *  in client/books/pdfjs.ts (a client module cannot import this file); the two
 *  literals are asserted equal by scripts/check-books.mjs. */
const PDFJS_BASE = "/pdfjs/";

function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = path.dirname(require.resolve("pdfjs-dist/package.json"));
  return {
    name: "vellum:pdfjs-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith(PDFJS_BASE)) return next();
        // Resolved and then re-checked against the root: this is dev-only
        // code, but it is still a path from a URL, and "dev only" is how a
        // traversal ships.
        const abs = path.resolve(root, decodeURIComponent(url.slice(PDFJS_BASE.length)));
        if (!abs.startsWith(root + path.sep) || !existsSync(abs) || !statSync(abs).isFile()) {
          return next();
        }
        res.setHeader("Content-Type", abs.endsWith(".wasm") ? "application/wasm" : "application/octet-stream");
        createReadStream(abs).pipe(res);
      });
    },
    // After the bundle is on disk, not during it: these are opaque data files
    // with no place in the module graph, and emitting them as assets would
    // content-hash names that pdf.js builds by string concatenation.
    closeBundle() {
      const out = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "dist", "pdfjs");
      for (const dir of PDFJS_DIRS) {
        const from = path.join(root, dir);
        if (existsSync(from)) cpSync(from, path.join(out, dir), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  root: "client",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    // The server reads dist/.vite/manifest.json to name the chunks the shell
    // a given request will mount, and preloads exactly those (server/preload.ts).
    manifest: true,
    // Deterministic chunk boundaries — see build/chunks.ts for the policy and
    // why each boundary exists. Without this, rollup's automatic splitting
    // put every component (both shells, the graph engine, the settings and
    // moderation modals) into the single entry chunk that an anonymous blog
    // reader downloads before the first paragraph renders.
    rollupOptions: { output: { manualChunks: chunkFor } },
  },
  server: {
    port: 5801,
    proxy: {
      "/api": { target: "http://localhost:6801", changeOrigin: true },
    },
  },
});
