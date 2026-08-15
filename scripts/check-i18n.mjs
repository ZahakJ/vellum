// Assert: every t()/tf() key used in client/ exists in DICT, every DICT key
// defines BOTH en and ar (non-empty, and ar actually differs / is Arabic),
// every DICT key is used somewhere, tf() placeholders match across langs, and
// no user-visible English copy is typed straight into the source (bypassing
// t()) — in JSX *or* in the imperative DOM builders.
//
// That last scan is the point of this script. Diffing dict-against-used only
// proves the dictionary is tidy; it can never see a string that never went
// near t(), so it certified "PARITY OK / 290 of 290" while `btn.title =
// "Fold section"` shipped to an Arabic instance. The source-against-dict half
// below is what actually answers "is the translation complete", and it has to
// cover .ts as well as .tsx: the editor's chrome (fold chevrons, embed cards,
// upload pills, transclusions) is built with createElement + textContent, not
// JSX, which is exactly where the survivors were hiding.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../client/", import.meta.url).pathname;
const src = readFileSync(join(root, "i18n.ts"), "utf8");

// Parse DICT block
const start = src.indexOf("const DICT = {");
const end = src.indexOf("} satisfies Record<string, Entry>");
const dictSrc = src.slice(start, end);
const entries = new Map();
const re = /^\s{2}([A-Za-z0-9_]+):\s*\{([\s\S]*?)\},?\s*$/gm;
let m;
while ((m = re.exec(dictSrc))) {
  const key = m[1], body = m[2];
  const en = /\ben:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
  const ar = /\bar:\s*"((?:[^"\\]|\\.)*)"/.exec(body);
  entries.set(key, { en: en && en[1], ar: ar && ar[1] });
}

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
})(root);

const used = new Set();
const errs = [];
for (const f of files) {
  const s = readFileSync(f, "utf8");
  // Keys reach t()/tf() literally, via conditionals (t(a ? "x" : "y")), and via
  // thunk tables — so count any quoted dict-key token outside i18n.ts itself.
  for (const mm of s.matchAll(/"([A-Za-z0-9_]+)"/g)) if (entries.has(mm[1])) used.add(mm[1]);
}

for (const [k, v] of entries) {
  if (!v.en) errs.push(`MISSING en: ${k}`);
  if (!v.ar) errs.push(`MISSING ar: ${k}`);
  if (v.en && v.ar && v.en === v.ar && /[A-Za-z]{3}/.test(v.en)) errs.push(`ar === en (untranslated?): ${k} = "${v.en}"`);
  if (v.ar && !/[؀-ۿ]/.test(v.ar) && /[A-Za-z]{3}/.test(v.ar)) errs.push(`ar has no Arabic script: ${k} = "${v.ar}"`);
  // placeholder parity
  const ph = (s) => [...(s || "").matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(",");
  if (ph(v.en) !== ph(v.ar)) errs.push(`placeholder mismatch: ${k} en[${ph(v.en)}] ar[${ph(v.ar)}]`);
}
// ── Bare English copy in JSX ────────────────────────────────────────────────
// The dictionary can only guard strings that go through t()/tf(); a literal
// typed straight into JSX is invisible to it, and one shipped ("note
// (default)" in a settings <select>) sat untranslated between two localized
// rows. Heuristic, deliberately narrow: user-visible text of two or more
// words, in a text node or one of the four copy-bearing attributes. Keycaps
// (<kbd>Ctrl P</kbd>), single words (option VALUES like "dashboard", brand
// names), identifiers ("settings.json") and code fragments are not copy.
const copyWords = (text) =>
  (text
    .replace(/\b[\w-]+[./][\w-]+\b/g, " ") // settings.json, ar-u-nu-latn, /favicon.ico
    .match(/[A-Za-z]{2,}/g) ?? []).length;
const CODEISH = /[={}<>]|&&|\|\||=>|\(\)/;
for (const f of files) {
  if (!f.endsWith(".tsx")) continue;
  const rel = f.slice(root.length);
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    for (const mm of line.matchAll(/>([^<>{}\n]+)</g)) {
      const text = mm[1].trim();
      if (!text || CODEISH.test(text) || copyWords(text) < 2) continue;
      if (/<kbd[ >]/.test(line)) continue; // keycaps, not copy
      errs.push(`BARE ENGLISH (text): ${rel}:${i + 1}  “${text.slice(0, 60)}”`);
    }
    for (const mm of line.matchAll(/\b(placeholder|title|aria-label|alt)="([^"]+)"/g)) {
      if (copyWords(mm[2]) < 2) continue;
      errs.push(`BARE ENGLISH (${mm[1]}): ${rel}:${i + 1}  “${mm[2].slice(0, 60)}”`);
    }
  });
}

// ── Bare English in imperative DOM (.ts and .tsx alike) ─────────────────────
// The chrome that lives outside JSX writes its copy through a handful of DOM
// sinks. A string or template literal landing in one of them is user-visible
// copy by definition, so it must come from t()/tf() — anything with a real
// word in it is a finding. Glyph-only writes ("•", "…", "⌀", "#" + a tag) and
// writes of a variable are not literals with words, so they pass untouched.
const DOM_SINK =
  /(\.(?:textContent|innerText|title|alt|placeholder|ariaLabel)\s*=|setAttribute\(\s*["'](?:title|aria-label|placeholder|alt)["'])/g;
const LITERAL = /(["'`])((?:[^\\]|\\.)*?)\1/g;
const ATTR_NAMES = new Set(["title", "aria-label", "placeholder", "alt"]);
// countPhrase(n, "words") unit names are keys into the plural table, not copy.
const COUNT_UNITS = new Set(
  [...src.slice(src.indexOf("type CountUnit ="), src.indexOf("const UNITS")).matchAll(/"(\w+)"/g)].map(
    (m) => m[1],
  ),
);
// A word worth translating: three or more ASCII letters, outside a ${…} hole.
const hasCopyWord = (text) => /[A-Za-z]{3,}/.test(text.replace(/\$\{[^}]*\}/g, " "));
for (const f of files) {
  const rel = f.slice(root.length);
  if (rel === "i18n.ts") continue; // the dictionary itself
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    DOM_SINK.lastIndex = 0;
    for (const sink of line.matchAll(DOM_SINK)) {
      // The whole statement, not just the first literal after the "=": the two
      // survivors this scan exists for were ternaries
      // (`btn.title = folded ? "Unfold section" : "Fold section"`).
      const end = line.indexOf(";", sink.index);
      const stmt = line.slice(sink.index, end === -1 ? undefined : end);
      LITERAL.lastIndex = 0;
      for (const lit of stmt.matchAll(LITERAL)) {
        const text = lit[2];
        // A dict key reaching t()/tf() is the CORRECT shape, and an attribute
        // name is not copy — everything else with a word in it is a finding.
        if (entries.has(text) || COUNT_UNITS.has(text) || ATTR_NAMES.has(text) || !hasCopyWord(text)) {
          continue;
        }
        errs.push(`BARE ENGLISH (dom): ${rel}:${i + 1}  “${text.slice(0, 60)}”`);
      }
    }
  });
}

for (const k of used) if (!entries.has(k)) errs.push(`USED BUT UNDEFINED: ${k}`);
for (const k of entries.keys()) if (!used.has(k)) errs.push(`UNUSED dict key: ${k}`);

console.log(`dict keys: ${entries.size}, used keys: ${used.size}`);
if (errs.length) { console.log("FAIL:\n" + errs.join("\n")); process.exit(1); }
console.log("PARITY OK");
