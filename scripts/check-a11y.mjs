// Static accessibility gate.
//
// The point of this script is the same as check-i18n's: catch the class of
// regression that is invisible in review and invisible in a screenshot. It
// does not replace an audit — it holds the line the audit drew.
//
// What it asserts, and why each one is here rather than in someone's head:
//
//   1. No `outline: none` (or `outline: 0`) without a replacement ring in the
//      same rule. Removing the focus ring is the single most common way an
//      otherwise good app becomes unusable without a mouse.
//   2. Every icon-only control has an accessible name. A <button> whose only
//      child is an <svg>/glyph and which carries no aria-label is announced
//      as "button" and nothing else.
//   3. `aria-hidden="true"` never lands on something focusable, and never on
//      an element that also carries an aria-label (a hidden node's name is
//      not read — the pair is always a mistake).
//   4. Delegated click handlers on href-less <a>/div elements are paired with
//      a keyboard route (a keydown listener, tabindex, or activateOnKey).
//   5. The focus-visible baseline still exists in the stylesheets, and the
//      skip link and sr-only utilities are still defined.
//
// Heuristics, deliberately: they are tuned to fire on the shapes this
// codebase actually writes, and every rule can be silenced on one line with
// a trailing `// a11y-ok: <reason>` comment where the exception is real.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const clientRoot = new URL("../client/", import.meta.url).pathname;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(clientRoot);

const code = files.filter((f) => /\.tsx?$/.test(f));
const css = files.filter((f) => f.endsWith(".css"));
const rel = (f) => f.slice(clientRoot.length);

const errs = [];
const OK = /\/\/\s*a11y-ok\b|\/\*\s*a11y-ok\b/;

/** The attribute text of the JSX tag opening at `from` (the index of "<").
 *  Scans for the closing ">" rather than regexing to one, because JSX
 *  attributes are full of arrow functions and generics — `() =>` ends a naive
 *  match three attributes early, which is exactly how a checker starts
 *  reporting the code it was written to bless. Returns null if unterminated. */
function tagAttrs(text, from) {
  let depth = 0;
  let quote = "";
  for (let i = from + 1; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0 && text[i - 1] !== "=") {
      return text.slice(from, i + 1);
    }
  }
  return null;
}

// ── 1. outline: none without a replacement ─────────────────────────────────
// A ring may be replaced by a box-shadow or a border change in the same rule;
// what may not happen is the ring simply disappearing.
/** CSS with comments blanked out but every newline kept, so a rule quoted in
 *  prose ("app.css uses outline: none plus a box-shadow") is not a finding
 *  while line numbers still point at the real file. */
function uncommented(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
}

for (const f of css) {
  const raw = readFileSync(f, "utf8");
  const text = uncommented(raw);
  const rawLines = raw.split("\n");
  const lines = text.split("\n");
  let offset = 0;
  lines.forEach((line, i) => {
    const lineStart = offset;
    offset += line.length + 1;
    if (!/outline:\s*(none|0)\b/.test(line)) return;
    // The waiver lives in a comment, which `uncommented` just erased.
    if (OK.test(rawLines[i])) return;
    // The rest of THIS declaration block — by offset, not by searching for
    // the line's text, which finds the first identically-indented `outline:
    // none;` in the file and reads somebody else's block.
    const rest = text.slice(lineStart + line.length);
    const close = rest.indexOf("}");
    const block = close === -1 ? rest : rest.slice(0, close);
    if (/box-shadow|border-color|outline-color|background/.test(block)) return;
    errs.push(
      `NO FOCUS RING: ${rel(f)}:${i + 1}  outline removed with no replacement in the same rule`,
    );
  });
}

// ── 2. icon-only buttons need a name ───────────────────────────────────────
// A <button …> whose opening tag has no aria-label / aria-labelledby / title,
// and whose body holds no text and no {t(…)} call, is nameless.
for (const f of code) {
  if (!f.endsWith(".tsx")) continue;
  const text = readFileSync(f, "utf8");
  const re = /<button\b/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = tagAttrs(text, m.index);
    if (attrs === null) continue;
    const after = text.slice(m.index + attrs.length);
    const end = after.indexOf("</button>");
    const body = end === -1 ? "" : after.slice(0, end);
    if (OK.test(attrs)) continue;
    if (/aria-label|aria-labelledby|title=/.test(attrs)) continue;
    // Any text the reader can hear: a translated string, a literal word, or
    // an interpolated label. Glyph-only bodies (×, ✦, an <svg>) are not names.
    const spoken = body
      .replace(/<svg[\s\S]*?<\/svg>/g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/aria-hidden="true"[\s\S]*?<\/span>/g, "");
    if (/\bt\(|\btf\(|[A-Za-z]{2,}/.test(spoken)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    errs.push(`NAMELESS BUTTON: ${rel(f)}:${line}  icon-only <button> with no accessible name`);
  }
}

// Same rule for the imperative DOM: createElement("button") followed by a
// textContent/aria-label/title assignment somewhere in the next few lines.
for (const f of code) {
  const text = readFileSync(f, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const m = /(?:const|let)\s+(\w+)\s*=\s*document\.createElement\(["']button["']\)/.exec(line);
    if (!m || OK.test(line)) return;
    const name = m[1];
    // Fourteen lines of CODE, not fourteen lines of file. This codebase writes
    // long "why" comments between the createElement and the assignments, and a
    // raw slice let a comment block push a button's own `textContent =` out of
    // view and report a named button as nameless.
    const window_ = lines
      .slice(i, i + 120)
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l) && l.trim() !== "")
      .slice(0, 14)
      .join("\n");
    const named = new RegExp(
      `${name}\\.(textContent|innerHTML|ariaLabel|title)\\s*=|${name}\\.setAttribute\\(\\s*["'](aria-label|title)["']`,
    );
    if (named.test(window_)) return;
    errs.push(`NAMELESS BUTTON: ${rel(f)}:${i + 1}  createElement("button") with no name assigned`);
  });
}

// ── 3. aria-hidden must not hide something reachable ───────────────────────
for (const f of code) {
  const text = readFileSync(f, "utf8");
  text.split("\n").forEach((line, i) => {
    if (!/aria-hidden=["{]?true|aria-hidden="true"/.test(line)) return;
    if (OK.test(line)) return;
    if (/aria-label/.test(line)) {
      errs.push(
        `HIDDEN BUT NAMED: ${rel(f)}:${i + 1}  aria-hidden together with aria-label — the name is never read`,
      );
    }
  });
}

// The pairing that actually breaks keyboards: aria-hidden on an element that
// is focusable and NOT parked at tabIndex -1.
for (const f of code) {
  if (!f.endsWith(".tsx")) continue;
  const text = readFileSync(f, "utf8");
  const re = /<(button|a|input|select|textarea)\b/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = tagAttrs(text, m.index);
    if (attrs === null) continue;
    if (!/aria-hidden=(?:"true"|\{true\})/.test(attrs)) continue;
    if (/tabIndex=\{-1\}|tabIndex=\{[^}]*-1[^}]*\}|tabIndex="-1"/.test(attrs)) continue;
    if (OK.test(attrs)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    errs.push(
      `HIDDEN BUT FOCUSABLE: ${rel(f)}:${line}  aria-hidden on a <${m[1]}> that Tab can still reach`,
    );
  }
}

// ── 4. pointer-only handlers ───────────────────────────────────────────────
// onClick on a non-interactive element with no keyboard route beside it.
for (const f of code) {
  if (!f.endsWith(".tsx")) continue;
  const text = readFileSync(f, "utf8");
  const re = /<(div|span|li|section|p|td|tr)\b/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = tagAttrs(text, m.index);
    if (attrs === null) continue;
    if (!/\bonClick=/.test(attrs)) continue;
    if (OK.test(attrs)) continue;
    // A keyboard route, or an explicitly inert/presentational node.
    if (/onKeyDown=|onKeyUp=|tabIndex=/.test(attrs)) continue;
    if (/role="(presentation|none)"|aria-hidden=/.test(attrs)) continue;
    // Rows steered by a container's aria-activedescendant (the tree, the
    // palette listbox) are keyboard-driven from that container.
    if (/role="(option|treeitem)"/.test(attrs)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    errs.push(
      `POINTER ONLY: ${rel(f)}:${line}  <${m[1]} onClick> with no keyboard route (add a role+tabIndex, a key handler, or role="presentation")`,
    );
  }
}

// ── 5. the baseline itself is still there ──────────────────────────────────
const allCss = css.map((f) => readFileSync(f, "utf8")).join("\n");
const required = [
  [/:focus-visible\s*\{[^}]*outline:\s*\d/, "a global :focus-visible outline"],
  [/\.s-sr-only\s*\{/, ".s-sr-only (screen-reader-only text)"],
  [/\.s-skip\s*\{/, ".s-skip (skip-to-content link)"],
  [/@media\s*\(prefers-reduced-motion:\s*reduce\)/, "a prefers-reduced-motion block"],
];
for (const [re, what] of required) {
  if (!re.test(allCss)) errs.push(`MISSING BASELINE: ${what} is gone from the stylesheets`);
}

// Both shells must offer a skip link, and both targets must exist.
const shells = [
  ["client/App.tsx", "s-main"],
  ["client/blog/BlogShell.tsx", "s-blog-main"],
];
for (const [file, id] of shells) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url).pathname, "utf8");
  if (!text.includes(`href="#${id}"`)) errs.push(`MISSING SKIP LINK: ${file} has no <a href="#${id}">`);
  if (!text.includes(`id="${id}"`)) errs.push(`MISSING SKIP TARGET: ${file} has no id="${id}"`);
}

if (errs.length > 0) {
  console.error("FAIL:");
  for (const e of errs) console.error(`  ${e}`);
  console.error(`\n${errs.length} accessibility problem(s).`);
  process.exit(1);
}
console.log(`checked ${code.length} source files + ${css.length} stylesheets`);
console.log("A11Y OK");
