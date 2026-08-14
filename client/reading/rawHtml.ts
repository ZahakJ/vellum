// Raw inline HTML support for reading view + live preview (Obsidian renders
// author-written HTML in notes; real vaults — dg-publish exports, Excalidraw
// SVGs, <figure> diagrams — depend on it). Everything passes through a strict
// sanitizer: script-ish elements are removed wholesale, event-handler
// attributes and javascript: URLs are stripped, and external <a> links are
// forced to open in a new tab so the SPA never navigates away.
//
// CodeMirror-free on purpose: the reading view uses this in the first-paint
// bundle; the editor's HTML-block widget imports it from the editor chunk.

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
