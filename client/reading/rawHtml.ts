// Raw inline HTML support for reading view + live preview (Obsidian renders
// author-written HTML in notes; real vaults — dg-publish exports, Excalidraw
// SVGs, <figure> diagrams — depend on it). Everything passes through a strict
// sanitizer: script-ish elements are removed wholesale, event-handler
// attributes and javascript: URLs are stripped, and external <a> links are
// forced to open in a new tab so the SPA never navigates away.
//
// CodeMirror-free on purpose: the reading view uses this in the first-paint
// bundle; the editor's HTML-block widget imports it from the editor chunk.

import { COLOR_TOKENS } from "../../shared/textColors.ts";

/** Elements never rendered, wherever they appear (children die with them). */
const BAD_TAGS = new Set([
  "script", "iframe", "object", "embed", "form", "input", "textarea",
  "select", "button", "link", "meta", "base", "style", "dialog", "frame",
  "frameset", "noscript", "title", "head", "html", "body", "slot", "template",
]);

/** Block-ish tags that make a line start an HTML block in the reading view
 *  (CommonMark type-6 flavor: consumed until the next blank line). Includes
 *  the BAD ones so their source is swallowed instead of shown as tag soup. */
const BLOCK_TAGS = new Set([
  "div", "p", "figure", "figcaption", "svg", "table", "thead", "tbody",
  "tfoot", "tr", "td", "th", "caption", "col", "colgroup", "details",
  "summary", "center", "video", "audio", "picture", "source", "img", "br",
  "hr", "dl", "dt", "dd", "section", "article", "aside", "header", "footer",
  "nav", "ul", "ol", "li", "blockquote", "pre", "main", "fieldset", "legend",
  "iframe", "style", "script", "form",
]);

/** Tags allowed to pass through inline (inside a paragraph/heading/cell). */
const INLINE_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "big", "br", "cite", "code", "del", "dfn",
  "em", "font", "i", "img", "ins", "kbd", "mark", "q", "rp", "rt", "ruby",
  "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var",
  "wbr", "center",
]);

/** URL-carrying attributes checked for javascript: payloads. */
const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "data"]);

function dangerousUrl(value: string): boolean {
  // Strip whitespace/control chars that browsers ignore inside schemes.
  return /^javascript:/i.test(value.replace(/[\s\x00-\x1f]+/g, ""));
}

// ── Inline style ───────────────────────────────────────────────────────────
// `style` used to pass through UNTOUCHED on every element — the attribute
// filter only ever looked at `on*`, `srcdoc` and URL attributes. That was a
// hole with the colour feature and without it: `background:url(https://…)` in
// a note is a beacon that fires for every reader of the page and reports their
// IP and User-Agent to whoever wrote the note, and `position:fixed` over the
// whole viewport is a clickjack. Neither needs script, so the CSP never saw
// them.
//
// TWO RULES, because notes are not all ours.
//
//   · On a `<span>` the attribute is REBUILT from scratch and may carry only
//     `color` and `background-color`, whose values must be a hex/rgb/hsl
//     literal or a `var()` naming one of the product's own colour tokens
//     (shared/textColors.ts). That is exactly what the colour commands emit,
//     so our own output survives and everything else on a span is dropped.
//   · On every other element the attribute is FILTERED, not rebuilt: real
//     vaults are full of author HTML whose layout lives in inline style —
//     measured on the 1,388-note fixture, seventeen notes carry
//     `stroke-width` on Excalidraw SVG paths, `width:100%` on a figure,
//     `text-align:center` on a div. Rebuilding those to a colour allowlist
//     would silently un-draw the diagrams the feature exists to render. What
//     is dropped there is what was never legitimate: any declaration whose
//     value reaches OUT of the document (`url()`, `image-set()`, `element()`,
//     the old IE `expression()`), any `position` that takes an element out
//     of flow over the page, and any `var()` naming a token outside the
//     colour set — a `var()` is a READ of the page's own cascade, and the
//     reason `COLOR_TOKENS` exists on the span path is the reason it has to
//     bound every path.
//
// BOTH LISTS ARE ALLOWLISTS. `position` was a denylist (`fixed|sticky`) for
// exactly one release and `absolute` was simply not thought of; a
// `position:absolute; inset:0; width:100vw; height:100vh; z-index:99999`
// div in a published note covered the reading column, the panes and the
// status bar and swallowed every click on the page for an anonymous
// visitor. A property whose whole job is to take an element out of flow
// cannot be filtered by listing the ways one has gone wrong so far.
//
// No CSP change is involved either way: `style-src 'unsafe-inline'` was
// already required by React style props, KaTeX and the banner gradients.

/** Values that fetch, or that escape their own box. */
const DANGEROUS_CSS =
  /\b(?:url|image-set|-webkit-image-set|image|element|expression|attr|paint|cross-fade)\s*\(|\\|@import|<\/?[a-z]/i;

/** Literal colours: `#rgb`/`#rrggbb` (+alpha), the functional notations, and a
 *  BARE IDENTIFIER.
 *
 *  The third one is a deliberate widening of "hex/rgb/hsl only". `color:red`
 *  is what a hand-written note actually says — two of them in the 1,388-note
 *  fixture — and refusing it would delete an author's colour in the name of a
 *  rule that was never about safety here: an identifier has no grammar for a
 *  URL, no parentheses, and no way to express anything but a colour keyword,
 *  and a keyword the browser does not know is simply ignored. Everything with
 *  a payload — `url()`, `image-set()`, escapes, angle brackets — is refused by
 *  DANGEROUS_CSS before this pattern is ever consulted. */
const COLOR_LITERAL =
  /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\(\s*[0-9a-z.,%/ \t+-]*\s*\)|[a-z]{3,20})$/i;

/** The `position` values that keep an element inside the flow it was written
 *  in. Anything else — `absolute`, `fixed`, `sticky`, and whatever the next
 *  value is called — is refused, because the QUESTION is "does this leave the
 *  flow", not "is this one of the two names we happened to write down". */
const IN_FLOW_POSITION = /^(?:static|relative)$/i;

/** Every custom property a value READS, lowercased. */
function varReads(value: string): string[] {
  const out: string[] = [];
  const re = /var\(\s*(--[a-z0-9-]+)/gi;
  for (let m = re.exec(value); m; m = re.exec(value)) out.push(m[1].toLowerCase());
  return out;
}

/** A declaration's `!important` stripped, for the value tests that compare
 *  against a fixed vocabulary. */
function bareValue(value: string): string {
  return value.replace(/\s*!\s*important\s*$/i, "").trim();
}

/** `var(--token)` naming a colour token this product actually owns, with an
 *  optional literal fallback that is checked by the same rule. */
function allowedColor(value: string, tokens: ReadonlySet<string>): boolean {
  const trimmed = value.trim();
  if (DANGEROUS_CSS.test(trimmed)) return false;
  if (COLOR_LITERAL.test(trimmed)) return true;
  const m = /^var\(\s*(--[a-z0-9-]+)\s*(?:,\s*([^)]*))?\)$/i.exec(trimmed);
  if (!m) return false;
  if (!tokens.has(m[1].toLowerCase())) return false;
  return m[2] === undefined || COLOR_LITERAL.test(m[2].trim());
}

/** Split a declaration list without a full CSS parser. Values here never
 *  legitimately contain a `;` (the ones that could — `url()`, quoted strings —
 *  are refused wholesale above), so splitting on `;` is exact for what passes. */
function declarations(css: string): [string, string][] {
  const out: [string, string][] = [];
  for (const part of css.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    out.push([part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).trim()]);
  }
  return out;
}

/** The sanitized `style` for `tag`, or "" when nothing survives. */
export function sanitizeStyle(css: string, tag: string): string {
  const kept: string[] = [];
  const isSpan = tag === "span";
  for (const [prop, value] of declarations(css)) {
    if (value === "") continue;
    if (isSpan) {
      if (prop !== "color" && prop !== "background-color") continue;
      if (!allowedColor(value, COLOR_TOKENS)) continue;
      kept.push(`${prop}:${value}`);
      continue;
    }
    if (DANGEROUS_CSS.test(value)) continue;
    if (prop === "position" && !IN_FLOW_POSITION.test(bareValue(value))) continue;
    if (prop.startsWith("--")) continue; // a custom property is a value smuggler
    // A `var()` anywhere in the value is a read of the page's cascade, so the
    // colour allowlist bounds it here too — otherwise the span path's whole
    // stated reason ("an unbounded allowlist would let a note paint itself in
    // any value the app holds") is nullified by writing `<font>` instead.
    if (varReads(value).some((token) => !COLOR_TOKENS.has(token))) continue;
    // And the two properties that ARE colour answer to the colour rule on
    // every element, not only on our own spans.
    if (prop === "color" || prop === "background-color") {
      if (!allowedColor(bareValue(value), COLOR_TOKENS)) continue;
    }
    kept.push(`${prop}:${value}`);
  }
  return kept.join(";");
}

function sanitizeElement(el: Element): void {
  for (const child of [...el.children]) {
    if (BAD_TAGS.has(child.tagName.toLowerCase())) child.remove();
    else sanitizeElement(child);
  }
  for (const attr of [...el.attributes]) {
    const name = attr.name.toLowerCase();
    if (
      name.startsWith("on") ||
      name === "srcdoc" ||
      (URL_ATTRS.has(name) && dangerousUrl(attr.value))
    ) {
      el.removeAttribute(attr.name);
    } else if (name === "style") {
      const safe = sanitizeStyle(attr.value, el.tagName.toLowerCase());
      if (safe) el.setAttribute("style", safe);
      else el.removeAttribute(attr.name);
    }
  }
  // Author <a href="http…"> must not navigate the SPA away.
  if (el.tagName.toLowerCase() === "a") {
    const href = el.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noopener noreferrer");
    }
  }
}

/** Parse an HTML string and return a sanitized fragment of its content. */
export function sanitizeHtml(html: string): DocumentFragment {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  for (const child of [...tpl.content.children]) {
    if (BAD_TAGS.has(child.tagName.toLowerCase())) child.remove();
    else sanitizeElement(child);
  }
  return tpl.content;
}

/** Tag name when `line` opens an HTML block (reading view), else null. */
export function htmlBlockStart(line: string): string | null {
  const m = /^\s{0,3}<\/?([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])/.exec(line);
  if (!m) return null;
  return BLOCK_TAGS.has(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
}

// ── Inline tag pass (regex-level, runs on the escaped inline text) ──────────

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Rebuild one inline tag with only safe attributes; "" drops it entirely,
 *  null means "not an allowed inline tag — leave it to be escaped". */
export function sanitizeInlineTag(
  close: string,
  name: string,
  attrText: string,
  selfClose: string,
): string | null {
  const tag = name.toLowerCase();
  if (BAD_TAGS.has(tag)) return ""; // swallow, never render or show source
  if (!INLINE_TAGS.has(tag)) return null;
  if (close) return `</${tag}>`;
  const attrs: string[] = [];
  const ATTR_RE = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;
  for (let m = ATTR_RE.exec(attrText); m; m = ATTR_RE.exec(attrText)) {
    const an = m[1].toLowerCase();
    if (an.startsWith("on") || an === "srcdoc") continue;
    const rawVal = m[2] ?? "";
    const unquoted = rawVal.replace(/^["']|["']$/g, "");
    if (URL_ATTRS.has(an) && dangerousUrl(unquoted)) continue;
    if (an === "style") {
      const safe = sanitizeStyle(unquoted, tag);
      if (safe) attrs.push(`style="${escAttr(safe)}"`);
      continue;
    }
    if (rawVal === "") attrs.push(m[1]);
    else attrs.push(`${m[1]}="${escAttr(unquoted)}"`);
  }
  if (tag === "a") {
    const href = attrs.find((a) => a.toLowerCase().startsWith('href="'));
    if (href && /^href="https?:/i.test(href)) {
      if (!attrs.some((a) => a.toLowerCase().startsWith("target="))) {
        attrs.push('target="_blank"', 'rel="noopener noreferrer"');
      }
    }
  }
  return `<${tag}${attrs.length > 0 ? ` ${attrs.join(" ")}` : ""}${selfClose ? " /" : ""}>`;
}
