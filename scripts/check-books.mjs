// THE READER GATE. Ten properties that are invisible in review, expensive to
// discover in production, and trivially assertable from the source.
//
//   npm run check-books   ·   node scripts/check-books.mjs   (after npm run build)
//
// 1. THE PDF.JS WORKER IS A REAL SAME-ORIGIN ASSET. Every pdf.js tutorial on
//    the internet gives the worker to the library as a `blob:` URL built from
//    a fetched script. Under this origin's Content-Security-Policy — which has
//    no `blob:` in it anywhere — that shim is dead. And it dies IN PRODUCTION
//    ONLY: the vite dev server sends no CSP at all, so the whole feature works
//    perfectly for whoever is building it and is broken for every reader. That
//    is the worst failure mode available here, and it is one grep.
//
// 2. THE ENGINE HAS ONE DOOR. `pdfjs-dist` may be named by exactly one module
//    (client/books/pdfjs.ts) and only as a dynamic import. A second static
//    import anywhere is how a 1.1 MB library walks back into a first paint —
//    check-bundle would catch it at the chunk level, but only after a build,
//    and only in the audiences it measures.
//
// 3. THE PDF IS NEVER WRITTEN TO, AND NEITHER IS THE VAULT. server/books.ts
//    reads vault bytes and writes the reading store, and those two must never
//    swap places. The census below enumerates every write call in that file:
//    the four in `persist()` are the whole list, and a fifth is a build
//    failure until someone justifies it here. Highlights and margin notes go
//    through the same door — annotating a book must not change one byte of it.
//
// 4. EVERY READER KEY GOES THROUGH shortcutKey(). `e.key === "j"` is false on
//    an Arabic keyboard. client/keys.ts exists because five of this product's
//    seven global shortcuts were dead under a non-Latin layout, measured; a
//    book reader with sixteen bindings must not re-introduce that, and the
//    shape it re-introduces it in is a bare `e.key === "<letter>"`.
//
// 5. THE READER WEARS THE THEME. No hard-coded colour in books.css, and no
//    physical edge either — this is a full-screen bilingual surface, and
//    `margin-left` is how a mirrored layout comes apart.
//
// 6. THE BUILD ACTUALLY EMITTED ALL OF IT. The worker as an asset, and the
//    four side-data directories pdf.js fetches by URL (without them a
//    Japanese book is boxes and a scanned one is blank pages).
//
// 7. THE SIX PAGE INKS ARE PAGE INKS. `--book-ink-1..6` are defined on `:root`
//    and on NOTHING else. A theme that overrode one would mean the same
//    passage is marked green on the laptop and pink on the desktop, which is
//    not a theme — it is data loss, and it is one grep.
//
// 8. A QUOTE IS ASSEMBLED BY GEOMETRY. pdf.js returns text items in the order
//    the content stream wrote them, which on a two-column paper interleaves
//    the columns; a quote built from `selection.toString()` is alternating
//    half-sentences that read perfectly and say something the author never
//    wrote, pasted silently into somebody's notes. `client/books/columns.ts`
//    is the only way a passage becomes a string, and the shortcut this gate
//    forbids is the shortcut anyone would reach for.
//
// 9. THE CITE WRITE CLAIMS THE ECHO BEFORE IT SENDS. Every write comes back as
//    an SSE frame that OVERTAKES the response (measured: two milliseconds), so
//    a write that does not call markSelfWrite first is reported to the reader
//    as "changed on disk" — the conflict alarm firing about their own
//    citation. client/sectionActions.ts::applyNoteContent is the door that
//    does it; a bare putNote is the bug.
//
// 10. t() COMES FROM THE DICTIONARY. A local fallback shim — `const t = (k) =>
//    DICT[k] ?? k` — makes a missing key compile, run and render its own name,
//    which is precisely what check-i18n exists to catch. One shipped here
//    once and hid two real bugs from the gate. It does not come back.
//
// Pure logic plus one look at dist/: no browser, no server, no dependencies.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

/** Source with its comments removed.
 *
 *  Every scan below asks "does the CODE do X", and this file's own subject
 *  matter — `blob:`, `e.key === "j"` — is quoted in the prose of the very
 *  modules being scanned, because that prose is where the rule is explained.
 *  A gate that reports its own documentation is a gate that gets switched off,
 *  so comments come out first. Quote-aware, so a `//` inside a string (a URL,
 *  a regex) is not mistaken for a comment. */
function code(src) {
  let out = "";
  let quote = null;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (quote) {
      out += ch;
      if (ch === "\\") {
        out += src[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 1;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

let failed = false;
const fail = (msg) => {
  console.error(`  FAIL  ${msg}`);
  failed = true;
};
const ok = (msg) => console.log(`  ok    ${msg}`);

// ── 1. The worker, the CSP and the side data ───────────────────────────────

console.log("check-books: the worker is an asset, not a blob\n");

const pdfjsSrc = read("client/books/pdfjs.ts");

if (!/import\s+workerUrl\s+from\s+"pdfjs-dist\/build\/pdf\.worker[^"]*\?url"/.test(pdfjsSrc)) {
  fail("client/books/pdfjs.ts must import the worker with vite's `?url` suffix, so the build emits it as a real asset");
} else {
  ok("the worker is imported with ?url");
}

if (/GlobalWorkerOptions\.workerSrc\s*=\s*workerUrl/.test(pdfjsSrc)) {
  ok("workerSrc is that emitted asset");
} else {
  fail("client/books/pdfjs.ts must set GlobalWorkerOptions.workerSrc to the ?url import");
}

if (/createObjectURL|blob:/.test(code(pdfjsSrc))) {
  fail("client/books/pdfjs.ts builds a blob: worker URL — that shim is refused by the production CSP (server/index.ts)");
} else {
  ok("no blob: URL is built anywhere near the worker");
}

const serverIndex = read("server/index.ts");
const cspBlock = /const SHELL_CSP = \[([\s\S]*?)\]\.join/.exec(serverIndex);
if (!cspBlock) {
  fail("server/index.ts no longer declares SHELL_CSP as an array — this gate reads it verbatim");
} else {
  const csp = cspBlock[1];
  if (/'wasm-unsafe-eval'/.test(csp)) ok("script-src carries 'wasm-unsafe-eval' (pdf.js decodes JBIG2/JPEG 2000 in wasm)");
  else fail("SHELL_CSP is missing 'wasm-unsafe-eval' — every scanned book renders blank in production");

  if (/"worker-src 'self'"/.test(csp)) ok("worker-src is stated, and it is 'self'");
  else fail("SHELL_CSP must state `worker-src 'self'` — the wall the blob: shim dies against");

  if (/blob:/.test(csp)) {
    fail("SHELL_CSP now allows blob: — that re-opens the door this whole arrangement exists to keep shut");
  } else {
    ok("no blob: anywhere in the policy");
  }
  if (/'unsafe-eval'(?!-)/.test(csp.replace(/'wasm-unsafe-eval'/g, ""))) {
    fail("SHELL_CSP allows full 'unsafe-eval' — pdf.js needs the narrow wasm token, not JavaScript's evaluator");
  }
}

// The side-data prefix is spelled in two files that cannot import each other.
const viteConfig = read("vite.config.ts");
const baseIn = (src) => /PDFJS_BASE = "([^"]+)"/.exec(src)?.[1];
if (baseIn(viteConfig) && baseIn(viteConfig) === baseIn(pdfjsSrc)) {
  ok(`side data is served and requested from the same prefix (${baseIn(pdfjsSrc)})`);
} else {
  fail(
    `PDFJS_BASE disagrees: vite.config.ts says ${baseIn(viteConfig)}, client/books/pdfjs.ts says ${baseIn(pdfjsSrc)} — ` +
      "cmaps, standard fonts and the wasm decoders would 404 for every book",
  );
}

// ── 2. One door to the engine ──────────────────────────────────────────────

console.log("\ncheck-books: pdf.js has exactly one door");

const sources = [];
(function walk(dir) {
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
    else if (/\.(ts|tsx|mjs)$/.test(name)) sources.push(rel);
  }
})("client");
sources.push("server/books.ts", "server/bookRoutes.ts", "shared/bookAnchor.ts");

const importers = sources.filter((rel) => /from\s+"pdfjs-dist/.test(read(rel)));
if (importers.length === 1 && importers[0] === "client/books/pdfjs.ts") {
  ok("only client/books/pdfjs.ts names pdfjs-dist");
} else {
  fail(`pdfjs-dist is imported by ${importers.join(", ") || "nothing at all"} — it must be client/books/pdfjs.ts alone`);
}

// The static half of that import must be TYPES only: `import type * as … ` and
// the `?url` worker. The module itself arrives through `import("pdfjs-dist")`.
if (/\bimport\s*\(\s*"pdfjs-dist"\s*\)/.test(pdfjsSrc)) ok("the engine is reached with a dynamic import()");
else fail("client/books/pdfjs.ts must reach the engine through import(), or rollup hoists it into a first paint");

for (const line of pdfjsSrc.split("\n")) {
  if (/^import\s/.test(line) && /"pdfjs-dist"/.test(line) && !/^import type/.test(line)) {
    fail(`a VALUE import of pdfjs-dist at module scope: ${line.trim()}`);
  }
}

// The books surface must not be statically reachable from the app shell.
// door.ts is the one books module in first-paint code (the sidebar, the router
// and the editors import it), so IT may import nothing of the surface but
// types; the surface itself is mounted by Pane.tsx through React.lazy, which
// keeps it the separate chunk check-bundle pins.
const doorSrc = read("client/books/door.ts");
for (const line of doorSrc.split("\n")) {
  const m = /^import\s+(?!type\b)[\s\S]*?from\s+"\.\/([A-Za-z]+)\.tsx?"/.exec(line.trim());
  if (m) fail(`client/books/door.ts statically imports ./${m[1]} — it is first-paint code and must use import()`);
}
const paneSrc = read("client/components/Pane.tsx");
if (/lazy\(\(\) => import\("\.\.\/books\/BooksSurface\.tsx"\)\)/.test(paneSrc)) {
  ok("Pane.tsx reaches the surface through React.lazy(import())");
} else {
  fail("client/components/Pane.tsx must load BooksSurface with React.lazy(() => import()) — a static import puts the reader in first paint");
}

// ── 3. Nothing writes to the vault ─────────────────────────────────────────

console.log("\ncheck-books: the store writes to VELLUM_DATA and nowhere else");

const storeSrc = code(read("server/books.ts"));
const WRITE_CALLS =
  /\b(writeFileSync|writeFile|appendFileSync|appendFile|createWriteStream|renameSync|rename|rmSync|rm|unlinkSync|unlink|truncateSync|truncate|mkdirSync|mkdir|chmodSync|chmod|utimesSync|copyFileSync)\s*\(/g;
const ALLOWED = new Set(["mkdirSync", "writeFileSync", "renameSync", "chmodSync"]);
const writes = [...storeSrc.matchAll(WRITE_CALLS)].map((m) => m[1]);
const stray = writes.filter((name) => !ALLOWED.has(name));
if (stray.length > 0) {
  fail(`server/books.ts calls ${[...new Set(stray)].join(", ")} — the only writes it may make are the atomic store write`);
} else if (writes.length !== 4) {
  fail(
    `server/books.ts makes ${writes.length} write calls (${writes.join(", ")}); persist() is exactly four — ` +
      "mkdirSync, writeFileSync, renameSync, chmodSync. A fifth needs a reason written down here.",
  );
} else {
  ok("exactly the four write calls of persist(), all inside VELLUM_DATA");
}

if (/\bopen\(abs,\s*"r"\)/.test(storeSrc)) ok("the book itself is opened read-only");
else fail("server/books.ts must open a vault PDF with mode \"r\" — a book is never written to");

if (/dataDir\(\)/.test(storeSrc)) ok("the store path is derived from dataDir()");
else fail("server/books.ts must put its file under dataDir() (VELLUM_DATA), never in the vault");

if (/getVaultRoot|vaultRoot/.test(storeSrc)) {
  fail("server/books.ts reaches for the vault root — the reading store must never be able to land in the vault");
}

// ── 4. Every key survives a non-Latin layout ───────────────────────────────

console.log("\ncheck-books: every reader key goes through shortcutKey()");

const readerSrc = code(read("client/books/BookReader.tsx"));
if (!/shortcutKey\(/.test(readerSrc)) fail("client/books/BookReader.tsx never calls shortcutKey()");
else ok("the reader resolves its character keys through client/keys.ts");

// A bare comparison against a single printable character is the shape of the
// bug: it is false on an Arabic, Russian or Greek keyboard. Named keys
// (Escape, ArrowDown, PageUp, " ") are layout-independent and are fine.
const NAMED = /^(Escape|Enter|Tab|Backspace|Delete|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right)| )$/;
for (const rel of sources.filter((f) => f.startsWith("client/books/"))) {
  const src = code(read(rel));
  for (const m of src.matchAll(/e\.key\s*===\s*"([^"]*)"/g)) {
    if (!NAMED.test(m[1])) {
      fail(`${rel} compares e.key against "${m[1]}" — dead on a non-Latin layout; use shortcutKey(e) (client/keys.ts)`);
    }
  }
  if (/e\.key\.toLowerCase\(\)/.test(src)) {
    fail(`${rel} lowercases e.key to match a binding — that is the exact bug client/keys.ts was written for`);
  }
}

// ── 5. The stylesheet takes its colours from the themes ────────────────────

console.log("\ncheck-books: the reader wears the theme");

const css = read("client/styles/books.css");
const literals = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)].map((m) => m[0]);
if (literals.length > 0) {
  fail(`client/styles/books.css hard-codes ${literals.length} colour(s) (${[...new Set(literals)].join(", ")}) — tokens only`);
} else {
  ok("no hard-coded colours in client/styles/books.css");
}
// Physical edges do not mirror. This surface is full-screen and bilingual.
for (const bad of ["margin-left", "margin-right", "padding-left", "padding-right", "border-left:", "border-right:", "left:", "right:"]) {
  if (new RegExp(`(^|[\\s{;])${bad.replace(/[:]/g, ":")}`, "m").test(css)) {
    fail(`client/styles/books.css uses the physical property "${bad}" — the whole surface mirrors for Arabic`);
  }
}

// ── 6. The worker actually shipped ─────────────────────────────────────────

console.log("\ncheck-books: the built output carries the worker and the side data");

const dist = path.join(root, "dist");
if (!existsSync(dist)) {
  fail(`no dist/ at ${dist}\n        run: npm run build`);
} else {
  const assets = existsSync(path.join(dist, "assets")) ? readdirSync(path.join(dist, "assets")) : [];
  const worker = assets.find((f) => /^pdf\.worker.*\.(m?js)$/.test(f));
  if (worker) ok(`worker asset: assets/${worker}`);
  else fail("no pdf.worker asset in dist/assets — the build did not emit the worker as a same-origin file");

  for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    const at = path.join(dist, "pdfjs", dir);
    if (existsSync(at) && readdirSync(at).length > 0) ok(`side data: dist/pdfjs/${dir}/`);
    else fail(`dist/pdfjs/${dir}/ is missing — see the pdfjsAssets() plugin in vite.config.ts`);
  }
}

// ── 7. The page inks belong to the page, not to the theme ──────────────────

console.log("\ncheck-books: the six page inks are on :root and nowhere else");

const tokens = read("client/styles/tokens.css");
const INK_NAMES = Array.from({ length: 6 }, (_, i) => `--book-ink-${i + 1}`);
const blocks = [...tokens.matchAll(/(:root|\[data-theme="([\w-]+)"\])\s*\{([^}]*)\}/g)];
const rootBlock = blocks.find((m) => m[1] === ":root");
if (!rootBlock) {
  fail("client/styles/tokens.css no longer declares a :root block — this gate reads it verbatim");
} else {
  const missing = INK_NAMES.filter((name) => !new RegExp(`${name}\\s*:`).test(rootBlock[3]));
  if (missing.length > 0) fail(`:root is missing ${missing.join(", ")} — a highlight would paint nothing`);
  else ok("all six inks are defined on :root");
}
const overriding = blocks
  .filter((m) => m[2] !== undefined)
  .filter((m) => INK_NAMES.some((name) => new RegExp(`${name}\\s*:`).test(m[3])))
  .map((m) => m[2]);
if (overriding.length > 0) {
  fail(
    `theme(s) ${[...new Set(overriding)].join(", ")} redefine a --book-ink-* — these are PAGE inks, ` +
      "and a passage marked green on the laptop and pink on the desktop is not a theme, it is data loss",
  );
} else {
  ok("no theme overrides a page ink");
}
// And the reader must reach them as tokens: rule 5 above already forbids a
// literal colour in books.css, so this only has to check the inks are used.
if (/var\(--book-ink-1\)/.test(css)) ok("books.css paints a highlight from the token");
else fail("client/styles/books.css never uses var(--book-ink-1) — the ink is not wired up");

// ── 8. A quote is assembled by geometry, never by stream order ─────────────

console.log("\ncheck-books: a quote is assembled by column geometry");

if (/assembleSelection\(/.test(readerSrc)) {
  ok("the reader builds its passages through client/books/columns.ts");
} else {
  fail("client/books/BookReader.tsx never calls assembleSelection() — a quote must not be built any other way");
}

// The shortcut. `selection.toString()` is the obvious way to get the words and
// it returns them in DOM order, which on a two-column page is the interleaved
// order the PDF wrote — the exact bug columns.ts exists to kill. selection.ts
// is allowed one use of it, and only as a "is anything selected at all" test.
for (const rel of sources.filter((f) => f.startsWith("client/books/"))) {
  const src = code(read(rel));
  for (const m of src.matchAll(/getSelection\(\)[?.\s]*\.?toString\(\)/g)) {
    if (rel !== "client/books/selection.ts") {
      fail(`${rel} reads ${m[0]} — that is DOM order, which is the PDF's stream order on a two-column page`);
    }
  }
}
if (!/columnsOf\(|columnCuts\(/.test(code(read("client/books/columns.ts")))) {
  fail("client/books/columns.ts no longer detects columns — the whole module is the column detector");
} else {
  ok("columns.ts still finds columns before it joins anything");
}

// ── 9. The citation write claims the SSE echo before it sends ──────────────

console.log("\ncheck-books: the citation write claims its own echo");

const citeSrc = code(read("client/books/cite.ts"));
if (/applyNoteContent\(/.test(citeSrc)) {
  ok("the write goes through sectionActions.applyNoteContent (which marks the self-write first)");
} else {
  fail("client/books/cite.ts must write through applyNoteContent — see markSelfWrite in client/state.ts");
}
if (/\bputNote\(/.test(citeSrc)) {
  fail(
    "client/books/cite.ts calls putNote directly — the SSE echo overtakes the response by ~2ms, so a " +
      "write that has not called markSelfWrite() first is reported to the reader as an external edit",
  );
}

// ── 10. No local i18n shim ─────────────────────────────────────────────────

console.log("\ncheck-books: t() comes from the dictionary");

let shim = false;
for (const rel of sources.filter((f) => f.startsWith("client/books/"))) {
  const src = read(rel);
  for (const line of src.split("\n")) {
    if (!/^import\s/.test(line.trim())) continue;
    if (!/[{,]\s*(t|tf)\s*[,}]/.test(line)) continue;
    if (!/"\.\.\/i18n\.ts"/.test(line)) {
      fail(`${rel} imports t()/tf() from something that is not client/i18n.ts: ${line.trim()}`);
      shim = true;
    }
  }
  if (/(const|function)\s+t\s*[=(]/.test(code(src))) {
    fail(`${rel} declares its own t() — a fallback shim makes a missing key compile, run and render its own name`);
    shim = true;
  }
}
if (!shim) ok("every t()/tf() in the reader resolves against client/i18n.ts");

console.log(failed ? "\nBOOKS GATE FAILED" : "\nBOOKS OK");
process.exit(failed ? 1 : 0);
