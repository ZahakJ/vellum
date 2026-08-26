// THE DESKTOP GATE — and the point of it is that it runs where Electron is not.
//
//   npm run check-desktop   ·   node scripts/check-desktop.mjs
//
// The desktop app is the one part of this repo most contributors will never
// install. `desktop/` is its own npm project precisely so that `git clone &&
// npm install && npm start` does not pull a 100 MB Chromium down for someone
// fixing a typo in the blog — which means the desktop app is also the one part
// nobody's local build touches, and unbuilt code rots quietly.
//
// So this gate is PURE: no Electron, no node_modules of any kind, no browser,
// no server. It reads files and prints a diff, like check-keymap and
// check-sections, and it runs on every commit in the same breath as typecheck.
// It asks the four questions whose answers are silently wrong the day after
// somebody edits something else:
//
//   1. CAN THE PACKAGED APP EVEN BOOT? The desktop ships `server/index.ts` and
//      runs it directly, so every bare import the server can reach at runtime
//      must be a real dependency of desktop/package.json AT THE SAME VERSION
//      SPEC. Add `import Y from "yaml"` to a server module and the web app
//      keeps working, the typecheck passes, the tests pass — and the packaged
//      desktop app dies at boot with ERR_MODULE_NOT_FOUND, months later, on
//      somebody else's machine.
//
//   2. IS THE DESKTOP STILL ADDITIVE? Nothing under `client/` or `server/` may
//      import "electron". The moment one does, the web build is broken and the
//      desktop has stopped being a wrapper.
//
//   3. IS THE BRIDGE STILL SMALL? Every IPC channel declared in electron/ipc.ts
//      has exactly one main-side site and exactly one preload site, in the
//      matching direction. A channel with two callers, or one left behind after
//      its caller was deleted, is a hole in `contextIsolation` that no longer
//      has a reason.
//
//   4. ARE THE FOUR WALLS STILL UP? `nodeIntegration: true`,
//      `contextIsolation: false`, `sandbox: false` and `webSecurity: false` are
//      each one plausible-looking line, each written a thousand times in
//      tutorials, and each one hands a note's HTML the reader's file system.
//
// Plus one this stage owes the i18n gate: the native menu's strings are
// user-visible copy in a directory `scripts/check-i18n.mjs` does not walk, so
// its four parity assertions are run over electron/menuStrings.ts here, and any
// key that also exists in client/i18n.ts must match it exactly. See the header
// of electron/menuStrings.ts for the merge that ends this arrangement.

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const errs = [];
const notes = [];

/** Every `.ts`/`.tsx` under a directory. */
function walk(rel, out = []) {
  const abs = path.join(root, rel);
  for (const name of readdirSync(abs)) {
    const child = path.join(abs, name);
    if (statSync(child).isDirectory()) walk(path.join(rel, name), out);
    else if (/\.tsx?$/.test(name)) out.push(path.join(rel, name));
  }
  return out;
}

/** Source with comments removed, quotes respected.
 *
 *  Not optional politeness: this repo's comments are prose, and prose in this
 *  repo contains sentences like `import "Ideas"`. Scanning raw text found four
 *  packages named "Ideas", "this", "page 1" and "does this FILE" before this
 *  existed — a gate that reports imaginary dependencies is a gate that gets
 *  its findings ignored. String literals are stepped over rather than skipped
 *  so a `"http://"` inside one is not read as a line comment. */
function stripComments(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        i++;
      }
      out += quote;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Specifiers in a source file: static imports, re-exports and `import()`.
 *  Deliberately textual — a real module graph would need a resolver, and the
 *  thing being asserted is what the SOURCE says. */
function specifiers(raw) {
  const src = stripComments(raw);
  const out = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) for (const m of src.matchAll(re)) out.push(m[1]);
  // AND IT HAS TO SAY WHAT A SPECIFIER LOOKS LIKE, because the scan is textual
  // and `stripComments` does not strip STRINGS: `requiredString(body, "from")`
  // — an ordinary field name in server/api.ts — puts the word `from` directly
  // in front of a quote, and the first pattern above happily read the rest of
  // the expression as a package name. The gate then reported four npm packages
  // called things like `"), requiredString(body, "` and failed the build over
  // dependencies nobody had added. A module specifier is a relative path, a
  // node: builtin, or a package name; anything else is prose that happened to
  // sit next to the word.
  return out.filter((spec) => /^(?:\.{1,2}\/|node:|@[\w.~-]+\/[\w.~-]|[\w.~-])/.test(spec) && !/[\s()"']/.test(spec));
}

/** "@scope/name/sub" → "@scope/name"; "name/sub" → "name". */
function packageName(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

// ── 1. the server's runtime closure ⊆ desktop dependencies ─────────────────
//
// Walked from server/index.ts over RELATIVE imports only, so this is the set a
// spawned server can actually reach — not everything in server/, and not
// devDependencies.
const rootPkg = JSON.parse(read("package.json"));
const desktopPkg = JSON.parse(read("desktop/package.json"));
const rootDeps = rootPkg.dependencies ?? {};
const desktopDeps = desktopPkg.dependencies ?? {};

const visited = new Set();
const bare = new Set();
const builtins = new Set();

(function follow(rel) {
  if (visited.has(rel)) return;
  visited.add(rel);
  let src;
  try {
    src = read(rel);
  } catch {
    errs.push(`UNRESOLVED  ${rel} — reached from the server graph but not on disk`);
    return;
  }
  for (const spec of specifiers(src)) {
    if (spec.startsWith("node:")) {
      builtins.add(spec);
      continue;
    }
    if (spec.startsWith(".")) {
      follow(path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec)));
      continue;
    }
    bare.add(packageName(spec));
  }
})("server/index.ts");

// A server module that reaches into client/ would be a much larger problem
// than a missing dependency, and this walk is the only place it would show.
for (const rel of visited) {
  if (rel.startsWith("client/")) errs.push(`SERVER REACHES CLIENT  ${rel}`);
}

for (const name of [...bare].sort()) {
  const wanted = rootDeps[name];
  if (!wanted) {
    errs.push(
      `NOT A DEPENDENCY  "${name}" is imported from the server graph but is not in package.json\n` +
        `  dependencies. The web deployment resolves it from somewhere else (a transitive hoist);\n` +
        `  a packaged desktop app will not.`,
    );
    continue;
  }
  const have = desktopDeps[name];
  if (!have) {
    errs.push(
      `MISSING FROM desktop/package.json  "${name}": "${wanted}"\n` +
        `  The desktop spawns server/index.ts directly, so every package the server can reach at\n` +
        `  runtime has to be installed beside the packaged app. Without it the app opens a window,\n` +
        `  the server child exits with ERR_MODULE_NOT_FOUND, and the window stays blank.`,
    );
    continue;
  }
  if (have !== wanted) {
    errs.push(
      `VERSION DRIFT  "${name}": root wants "${wanted}", desktop pins "${have}".\n` +
        `  Two resolutions of one package is two behaviours, and only one of them is tested.`,
    );
  }
}

// The reverse is a finding too, though a gentler one: a dependency the desktop
// carries and the server cannot reach is weight in the installer for nothing.
for (const name of Object.keys(desktopDeps)) {
  if (!bare.has(name)) {
    errs.push(
      `UNREACHED  desktop/package.json depends on "${name}", which nothing in the server graph\n` +
        `  imports. Either the server stopped using it (drop it) or it is here for a reason that\n` +
        `  should be written down.`,
    );
  }
}
notes.push(
  `server graph: ${visited.size} modules · ${bare.size} bare deps · ${builtins.size} node: builtins`,
);

// ── 2. the desktop stays out of the web app ────────────────────────────────
for (const rel of [...walk("client"), ...walk("server")]) {
  const src = read(rel);
  for (const spec of specifiers(src)) {
    if (spec === "electron" || spec.startsWith("electron/")) {
      errs.push(
        `CLIENT/SERVER IMPORTS ELECTRON  ${rel} → "${spec}"\n` +
          `  The desktop app is additive. A web build cannot resolve this, and the day it appears the\n` +
          `  browser deployment — the actual product — stops building.`,
      );
    }
  }
}

// ── 3. the bridge is 1:1 in both directions ────────────────────────────────
const ipcSrc = read("electron/ipc.ts");
const preloadSrc = read("electron/preload.ts");
const mainSide = walk("electron")
  .filter((rel) => rel !== path.join("electron", "preload.ts"))
  .map((rel) => [rel, read(rel)]);

/** `{ name: "vellum:x" }` entries out of an `as const` block in ipc.ts. */
function channels(block) {
  const start = ipcSrc.indexOf(`export const ${block} = {`);
  if (start === -1) {
    errs.push(`IPC  electron/ipc.ts has no \`export const ${block}\` block`);
    return new Map();
  }
  const end = ipcSrc.indexOf("} as const;", start);
  const body = ipcSrc.slice(start, end);
  return new Map([...body.matchAll(/^\s{2}(\w+):\s*"([^"]+)",/gm)].map((m) => [m[1], m[2]]));
}

const toMain = channels("TO_MAIN");
const toRenderer = channels("TO_RENDERER");

const countIn = (text, re) => [...text.matchAll(re)].length;
const mainCount = (re) => mainSide.reduce((n, [, src]) => n + countIn(src, re), 0);

for (const [name, literal] of toMain) {
  const handlers = mainCount(new RegExp(`ipcMain\\.handle\\(\\s*TO_MAIN\\.${name}\\b`, "g"));
  if (handlers !== 1) {
    errs.push(`IPC  TO_MAIN.${name} ("${literal}") has ${handlers} ipcMain.handle sites — want exactly 1`);
  }
  const invokes = countIn(preloadSrc, new RegExp(`ipcRenderer\\.invoke\\(\\s*"${literal}"`, "g"));
  if (invokes !== 1) {
    errs.push(`IPC  "${literal}" has ${invokes} ipcRenderer.invoke sites in preload.ts — want exactly 1`);
  }
}

for (const [name, literal] of toRenderer) {
  const sends = mainCount(new RegExp(`\\.send\\(\\s*(?:win\\.webContents\\.)?TO_RENDERER\\.${name}\\b`, "g"))
    + mainCount(new RegExp(`tell\\([^,]+,\\s*TO_RENDERER\\.${name}\\b`, "g"));
  if (sends !== 1) {
    errs.push(`IPC  TO_RENDERER.${name} ("${literal}") is sent from ${sends} places — want exactly 1`);
  }
  const listens = countIn(preloadSrc, new RegExp(`on\\(\\s*"${literal}"`, "g"));
  if (listens !== 1) {
    errs.push(`IPC  "${literal}" has ${listens} ipcRenderer.on sites in preload.ts — want exactly 1`);
  }
}

// A channel the preload names that ipc.ts does not declare is the same bug from
// the other end: a hole with no entry in the register.
for (const m of preloadSrc.matchAll(/"(vellum:[a-z-]+)"/g)) {
  const known = [...toMain.values(), ...toRenderer.values()].includes(m[1]);
  if (!known) errs.push(`IPC  preload.ts uses "${m[1]}", which electron/ipc.ts does not declare`);
}
notes.push(`bridge: ${toMain.size} renderer→main · ${toRenderer.size} main→renderer channels`);

// ── 4. the four walls ──────────────────────────────────────────────────────
const WALLS = [
  [/nodeIntegration\s*:\s*true/, "nodeIntegration: true"],
  [/contextIsolation\s*:\s*false/, "contextIsolation: false"],
  [/sandbox\s*:\s*false/, "sandbox: false"],
  [/webSecurity\s*:\s*false/, "webSecurity: false"],
];
for (const [rel, src] of [...mainSide, [path.join("electron", "preload.ts"), preloadSrc]]) {
  src.split("\n").forEach((line, i) => {
    if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
    for (const [re, label] of WALLS) {
      if (re.test(line)) {
        errs.push(
          `WEBPREFERENCE  ${rel}:${i + 1} — \`${label}\`.\n` +
            `  A note can contain arbitrary HTML. These four are what stand between it and the\n` +
            `  reader's file system, and each of them is one line to undo.`,
        );
      }
    }
  });
}

// ── 4b. everything electron/ imports is actually IN the package ────────────
// The dev run resolves imports against the repo, the packaged app against
// app.asar's files list — so an import that escapes the list is a boot failure
// that ONLY the packaged binary can show, which is the worst place to learn it.
// It happened: menuStrings.ts began re-exporting client/i18n.ts and the
// packaged app died at startup while every dev surface stayed green. This walks
// electron/'s relative-import closure and asserts each landing file is covered
// by electron-builder.yml's files globs.
{
  const yml = read("desktop/electron-builder.yml");
  const globs = [...yml.matchAll(/^\s*-\s*([^!#\s][^\n]*?)\s*$/gm)].map((m) => m[1]);
  const covered = (rel) =>
    globs.some((g) => {
      if (g === rel) return true;
      if (g.endsWith("/**/*.ts")) return rel.startsWith(g.slice(0, -8)) && rel.endsWith(".ts");
      if (g.endsWith("/**/*")) return rel.startsWith(g.slice(0, -5));
      return false;
    });
  const seen = new Set();
  const queue = readdirSync(path.join(root, "electron")).filter((f) => f.endsWith(".ts")).map((f) => `electron/${f}`);
  while (queue.length > 0) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    if (!covered(rel)) {
      errs.push(`PACKAGE  ${rel} is imported by electron/ but matches nothing in electron-builder.yml files — the packaged app will die at boot on it`);
      continue;
    }
    const src = read(rel);
    for (const m of src.matchAll(/from "(\.\.?\/[^"]+)"/g)) {
      const resolved = path.posix.normalize(path.posix.join(rel, "..", m[1]));
      if (resolved.endsWith(".ts")) queue.push(resolved);
    }
  }
}

// ── 5. the menu's copy comes from the ONE dictionary ───────────────────────
// It used to live in `electron/menuStrings.ts` as a second 63-key dictionary,
// kept byte-identical to the client's by this gate. That was scaffolding for a
// stage that could not edit `client/i18n.ts`; the keys have since moved into
// `DICT`, `check-i18n` walks `electron/` as well as `client/`, and menuStrings
// is a re-export. So the four copy assertions and the drift check are gone from
// here — they are check-i18n's, over its own dictionary, where they belong and
// where they also cover the client.
//
// What stays is the bare-English scan for the one construct check-i18n could
// not have known to look for. A menu label does not reach the DOM through
// `textContent`; it reaches Electron through `label:`, so neither of that
// gate's two bare-English scans would ever see it.
const menuTs = read("electron/menu.ts");
menuTs.split("\n").forEach((line, i) => {
  for (const match of line.matchAll(/\blabel:\s*"([^"]+)"/g)) {
    // "Vellum" is the bundle name macOS prints over the application menu
    // whatever we pass; it is a proper noun, not copy.
    if (match[1] === "Vellum") continue;
    errs.push(`MENU COPY  BARE ENGLISH  electron/menu.ts:${i + 1}  \u201c${match[1]}\u201d`);
  }
});
// menuStrings must stay a re-export: a `DICT = {` reappearing here is the
// second dictionary coming back.
if (/const DICT\s*=\s*\{/.test(read("electron/menuStrings.ts"))) {
  errs.push("MENU COPY  electron/menuStrings.ts has grown its own DICT again — there is one dictionary, client/i18n.ts");
}


console.log(notes.map((n) => `  ${n}`).join("\n"));
if (errs.length) {
  console.log(`\nFAIL: ${errs.length}\n\n${errs.join("\n\n")}`);
  process.exit(1);
}
console.log("\nDESKTOP OK");
