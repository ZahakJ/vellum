// Bundle gate: what does each audience actually download?
//
//   node scripts/check-bundle.mjs        (after `npm run build`)
//
// The client ships one entry chunk plus a chunk per surface. That split is
// only worth anything if it HOLDS, and the way it stops holding is ordinary
// and silent: someone adds `import { X } from "./components/SettingsModal"`
// at the top of a file the entry already imports, and the whole app shell
// comes back into an anonymous reader's first request with no visible sign.
// The measured regression this guards against was 350 kB of JavaScript on a
// blog page that renders one article — CodeMirror, the vim keymap, the graph
// engine and every modal, none of which that page can reach.
//
// So this asserts three things about the BUILT output, read from
// dist/.vite/manifest.json (i.e. rollup's own view of the static import
// graph, not a guess):
//
//   1. Named heavy chunks (the editor, KaTeX, the vim keymap, the graph
//      engine) are absent from both first-paint closures.
//   2. Each audience's first-paint bytes stay under a budget.
//   3. The surfaces that are SUPPOSED to be split still exist as their own
//      chunks — a "fix" that inlines everything back into one chunk would
//      otherwise pass rules 1 and 2 by accident once it got small enough.
//
// Budgets are raw (uncompressed) bytes: they measure what the build produced,
// independently of how a given deployment negotiates encoding.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(root, "dist");
const manifestPath = path.join(dist, ".vite", "manifest.json");

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  console.error(`check-bundle: no manifest at ${manifestPath}\n  run: npm run build`);
  process.exit(1);
}

/** Transitive closure over STATIC imports — what the browser must fetch
 *  before the chunk can run. Dynamic imports are deliberately not followed:
 *  they are the split. */
function closure(key, seen = new Set()) {
  if (seen.has(key)) return seen;
  const entry = manifest[key];
  if (!entry) return seen;
  seen.add(key);
  for (const dep of entry.imports ?? []) closure(dep, seen);
  return seen;
}

function filesOf(keys) {
  const out = new Set();
  for (const key of keys) {
    const entry = manifest[key];
    if (!entry) continue;
    out.add(entry.file);
    for (const css of entry.css ?? []) out.add(css);
  }
  return out;
}

function bytes(files) {
  let total = 0;
  for (const f of files) {
    try {
      total += statSync(path.join(dist, f)).size;
    } catch {
      // a listed asset that is not on disk is a build problem, not ours
    }
  }
  return total;
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

// ── the audiences ───────────────────────────────────────────────────────────
// Mirrors client/App.tsx: everyone loads the entry; a blog visitor then loads
// the blog shell; an admin loads the vault shell. Neither loads the other.
const APP_SHELL_ROOTS = [
  "components/Sidebar.tsx",
  "components/Tabs.tsx",
  "components/StatusBar.tsx",
  "components/BacklinksPanel.tsx",
];

const entry = closure("index.html");
const blog = closure("blog/BlogShell.tsx", new Set(entry));
const app = APP_SHELL_ROOTS.reduce((acc, key) => closure(key, acc), new Set(entry));

const AUDIENCES = [
  { name: "entry (everyone)", keys: entry, budget: 260 * 1024 },
  { name: "anonymous blog reader", keys: blog, budget: 420 * 1024 },
  { name: "admin first paint", keys: app, budget: 420 * 1024 },
];

// ── things that must never be in a first paint ──────────────────────────────
// Matched against the manifest KEY (a source path), so this survives content
// hashes changing on every build.
const FORBIDDEN = [
  { label: "the CodeMirror editor", test: (k) => /Editor[-.]/.test(k) || /components\/Editor\.tsx$/.test(k) },
  { label: "KaTeX", test: (k) => /node_modules\/katex\/dist\/katex\.mjs$/.test(k) },
  { label: "the vim keymap", test: (k) => /@replit\/codemirror-vim/.test(k) },
  { label: "the graph engine", test: (k) => /components\/(GraphView|LocalGraph)\.tsx$/.test(k) },
  { label: "CodeMirror core", test: (k) => /@codemirror\/(view|state|language)\//.test(k) },
  { label: "a CodeMirror language grammar", test: (k) => /@lezer\/|@codemirror\/(lang-|legacy-modes)/.test(k) },
];

// ── surfaces that must remain separately loadable ───────────────────────────
const MUST_SPLIT = [
  "blog/BlogShell.tsx",
  "components/GraphView.tsx",
  "components/Sidebar.tsx",
  "components/SettingsModal.tsx",
  "reading/ReadingView.tsx",
];

let failed = false;
const fail = (msg) => {
  console.error(`  FAIL  ${msg}`);
  failed = true;
};

console.log("check-bundle: first-paint budgets\n");
for (const audience of AUDIENCES) {
  const files = filesOf(audience.keys);
  const size = bytes(files);
  const ok = size <= audience.budget;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${audience.name.padEnd(24)} ${kb(size).padStart(10)}  (budget ${kb(audience.budget)}, ${files.size} files)`,
  );
  if (!ok) failed = true;
  for (const rule of FORBIDDEN) {
    const hit = [...audience.keys].find(rule.test);
    if (hit) fail(`${rule.label} is in "${audience.name}" via ${hit}`);
  }
}

console.log("\ncheck-bundle: surfaces still split");
for (const key of MUST_SPLIT) {
  const entryFor = manifest[key];
  if (!entryFor) {
    fail(`${key} has no chunk of its own — the lazy boundary is gone`);
    continue;
  }
  if (entry.has(key)) {
    fail(`${key} is a STATIC import of the entry — it will load for everyone`);
    continue;
  }
  console.log(`  ok    ${key.padEnd(34)} ${entryFor.file}`);
}

// The editor is the one chunk whose absence from BOTH shells is the whole
// point of the exercise, so it gets said out loud.
const editorKey = Object.keys(manifest).find(
  (k) => /Editor[-.]/.test(k) && manifest[k].file.endsWith(".js"),
);
if (!editorKey) fail("no editor chunk in the manifest at all");
else console.log(`  ok    editor chunk                       ${manifest[editorKey].file} (${kb(bytes([manifest[editorKey].file]))})`);

console.log(failed ? "\nBUNDLE BUDGET FAILED" : "\nBUNDLE OK");
process.exit(failed ? 1 : 0);
