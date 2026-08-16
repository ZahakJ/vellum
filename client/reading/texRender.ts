// Reading view for `.tex` notes: LaTeX source → DOM, in the SAME visual
// language as rendered markdown.
//
// The point is that a reader should not be able to tell which format a note
// was written in. So this file emits the reading view's own `s-rv-*` classes —
// the same headings, the same blockquote bar, the same table, the same
// transclusion card, the same KaTeX — and adds only what LaTeX genuinely has
// and markdown does not: numbered sections, numbered equations, captions that
// say "Figure 1", theorem boxes, citation chips, resolved cross-references and
// a `\bibitem` bibliography.
//
// Three properties, stated because they are load-bearing:
//
//   * NOTHING IS BUILT FROM A STRING. Every node here comes from
//     createElement + textContent (KaTeX's own output is the one exception,
//     and it is generated from TeX, never from author HTML). There is no
//     innerHTML path a `.tex` file can reach, so there is no HTML injection
//     through TeX.
//   * NOTHING UNSUPPORTED IS SHOWN RAW. An unimplemented command renders as a
//     quiet inline marker; an unparseable document renders as whatever was
//     readable. A reader never sees `\pgfplotsset` in their prose, and never
//     sees a blank pane either.
//   * NOTHING LEAVES THE VAULT. `\input` and `\includegraphics` are resolved
//     through the same resolver wikilinks use, which only ever answers with
//     vault paths.

import { getAnchors, getNote, lookupXref } from "../api.ts";
import { getKatex, loadKatex } from "../katex.ts";
import { t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { isTexPath, noteTitleOf } from "../../shared/noteFormat.ts";
import { findAnchor, parseTex, type Block, type Inline, type NoteAnchor, type TexDocument } from "../../shared/tex.ts";
import { resolveLink } from "../editor/links.ts";
import {
  brokenEmbed,
  embedKnownBroken,
  fileUrl,
  markEmbedBroken,
  resolveAttachment,
} from "../editor/embeds.ts";
import { buildBannerEl, buildPropsCard } from "../editor/noteMeta.ts";
import { bannerFromYaml } from "../banner.ts";
import { markTransclusionOverflow, onRootClick, type RenderOptions } from "./render.ts";
import "./tex.css";

interface Ctx extends RenderOptions {
  doc: TexDocument;
  depth: number;
  ancestors: Set<string>;
  /** KaTeX `macros` — the author's own `\newcommand`s, so math renders the way
   *  their document does without this file ever expanding math itself. */
  macros: Record<string, string>;
  /** Footnote bodies collected in document order (the parser numbered them). */
  footnotes: Inline[][];
  /** Only a top-level render assigns element ids; an embedded one must not
   *  duplicate the host page's anchors. */
  assignIds: boolean;
}

// ── Math ────────────────────────────────────────────────────────────────────

function mathInto(host: HTMLElement, tex: string, display: boolean, ctx: Ctx): void {
  const katex = getKatex();
  if (!katex) {
    // KaTeX still downloading: hold the source in a pending span and swap it
    // when the module lands — the same two-step the markdown renderer uses.
    host.className = display ? "s-rv-mathblock s-rv-math-pending" : "s-rv-math s-rv-math-pending";
    host.dataset.tex = tex;
    host.dataset.display = display ? "1" : "0";
    host.textContent = tex;
    return;
  }
  try {
    host.innerHTML = katex.renderToString(tex, {
      throwOnError: false,
      displayMode: display,
      output: "htmlAndMathml",
      // The author's own macros, sandboxed by KaTeX's expander. `trust` stays
      // at its default false, so `\href`, `\url` and `\includegraphics` inside
      // math cannot emit a link or a request.
      macros: { ...ctx.macros },
      strict: false,
    });
  } catch {
    host.className = "s-rv-code";
    host.textContent = tex;
  }
}

function hydrateMath(root: HTMLElement, ctx: Ctx): void {
  const pending = root.querySelectorAll<HTMLElement>(".s-rv-math-pending");
  if (pending.length === 0) return;
  void loadKatex().then(() => {
    for (const el of pending) {
      const display = el.dataset.display === "1";
      const tex = el.dataset.tex ?? "";
      delete el.dataset.tex;
      delete el.dataset.display;
      el.className = display ? "s-rv-mathblock" : "s-rv-math";
      mathInto(el, tex, display, ctx);
    }
  });
}

// ── Inline ──────────────────────────────────────────────────────────────────

function styleElement(kind: "em" | "strong" | "tt" | "sc" | "u" | "sf"): HTMLElement {
  switch (kind) {
    case "em":
      return document.createElement("em");
    case "strong":
      return document.createElement("strong");
    case "tt": {
      const code = document.createElement("code");
      code.className = "s-rv-code";
      return code;
    }
    case "u": {
      const u = document.createElement("u");
      return u;
    }
    default: {
      const span = document.createElement("span");
      span.className = kind === "sc" ? "s-rv-tex-sc" : "s-rv-tex-sf";
      return span;
    }
  }
}

function renderInline(nodes: Inline[], ctx: Ctx, host: HTMLElement): void {
  for (const node of nodes) {
    switch (node.t) {
      case "text":
        host.appendChild(document.createTextNode(node.v));
        break;
      case "style": {
        const el = styleElement(node.s);
        renderInline(node.c, ctx, el);
        host.appendChild(el);
        break;
      }
      case "math": {
        const span = document.createElement("span");
        span.className = node.display ? "s-rv-math s-rv-math--display" : "s-rv-math";
        mathInto(span, node.tex, node.display === true, ctx);
        host.appendChild(span);
        break;
      }
      case "link":
        host.appendChild(noteLink(node, ctx));
        break;
      case "ref":
        host.appendChild(crossRef(node.key, node.eq, ctx));
        break;
      case "cite":
        host.appendChild(citation(node.keys, node.note, ctx));
        break;
      case "url": {
        const a = document.createElement("a");
        a.className = "s-rv-ext";
        // Only http(s) reaches an href. A `\href{javascript:…}{…}` renders as
        // its own text and nothing else — a note is data, and this is the one
        // place a `.tex` file could otherwise hand the page a URL scheme.
        if (/^https?:\/\//i.test(node.href)) {
          a.href = node.href;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
        }
        a.textContent = node.label ?? node.href;
        host.appendChild(a);
        break;
      }
      case "footnote": {
        const sup = document.createElement("sup");
        sup.className = "s-rv-fnref";
        const a = document.createElement("a");
        a.dataset.fn = String(node.n);
        if (ctx.assignIds) a.id = `fnref-${node.n}`;
        a.textContent = String(node.n);
        sup.appendChild(a);
        host.appendChild(sup);
        break;
      }
      case "anchor": {
        const mark = document.createElement("span");
        mark.className = "s-rv-tex-anchor";
        if (ctx.assignIds) mark.id = anchorId(node.id);
        host.appendChild(mark);
        break;
      }
      case "br":
        host.appendChild(document.createElement("br"));
        break;
      case "graphic": {
        // A picture outside a float: the same <img> the figure draws, with no
        // caption and no number, resolved through the same allowlist.
        const img = document.createElement("img");
        img.className = "s-rv-img s-rv-img--bare";
        img.alt = node.name;
        if (node.width) img.style.width = node.width;
        host.appendChild(img);
        attachGraphic(img, node.name, ctx);
        break;
      }
      case "unknown":
        host.appendChild(unknownMarker(node.name));
        break;
    }
  }
}

/** A command this reader does not implement. Quiet, hoverable, and NEVER the
 *  raw source: printing `\pgfplotsset{compat=1.18}` into someone's prose is
 *  the failure mode this marker exists to prevent. */
function unknownMarker(name: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "s-rv-tex-unknown";
  span.title = tf("texUnsupportedCommand", { name: `\\${name}` });
  span.setAttribute("aria-hidden", "true");
  span.textContent = "·";
  return span;
}

/** `\note{Target}` and `%% [[Target]] %%` — a wikilink in every respect, so it
 *  gets the reading view's own wikilink element and is handled by the same
 *  delegated click listener (render.ts). */
function noteLink(
  node: Extract<Inline, { t: "link" }>,
  ctx: Ctx,
): HTMLElement {
  const resolved = resolveLink(node.target, ctx.tree);
  const label = node.label ?? (node.anchor ? `${node.target} › ${node.anchor}` : node.target);
  if (resolved === null && ctx.brokenLinks === "plain") {
    const span = document.createElement("span");
    span.textContent = label;
    return span;
  }
  const a = document.createElement("a");
  a.className = resolved === null ? "s-rv-wikilink s-rv-wikilink--broken" : "s-rv-wikilink";
  a.dataset.target = node.target;
  if (node.anchor) a.dataset.heading = node.anchor;
  a.textContent = label;
  return a;
}

/** `\ref` / `\eqref` / `\autoref`. LOCAL-FIRST and visibly so: a label defined
 *  in this document becomes an in-page jump printed as its own number, and
 *  only a key with no local definition is asked about the vault. That order is
 *  the promise that importing a LaTeX project cannot change how it compiles. */
function crossRef(key: string, eq: boolean, ctx: Ctx): HTMLElement {
  const local = ctx.doc.anchors.find((a) => a.id === key);
  const a = document.createElement("a");
  if (local) {
    a.className = "s-rv-xref";
    a.dataset.anchor = anchorId(key);
    a.textContent = refText(local, eq);
    a.title = local.title;
    return a;
  }
  // No local label: ask the vault, and stay quiet until it answers. An
  // unresolved cross-reference renders as a muted marker — exactly like a
  // missing wikilink — never as a crash and never as raw source.
  a.className = "s-rv-xref s-rv-xref--pending";
  a.textContent = eq ? "(?)" : "?";
  a.title = key;
  void lookupXref({ label: key })
    .then((hit) => {
      if (!hit.path || !hit.anchor) {
        a.className = "s-rv-xref s-rv-xref--broken";
        a.textContent = eq ? "(?)" : "?";
        a.title = tf("texUnresolvedRef", { key });
        return;
      }
      a.className = "s-rv-xref";
      a.dataset.target = hit.path;
      a.dataset.heading = hit.anchor.id;
      // A number alone means nothing across a note boundary — "see 1" could be
      // any section of any paper — so a CROSS-NOTE reference prints what it
      // points AT. Local references keep the bare number LaTeX would print.
      const isEquation = hit.anchor.kind === "equation";
      a.textContent = isEquation
        ? refText(hit.anchor, eq)
        : hit.anchor.title || refText(hit.anchor, eq);
      a.title = tf("texRefIn", { title: hit.anchor.title, note: noteTitleOf(hit.path) });
    })
    .catch(() => {
      a.className = "s-rv-xref s-rv-xref--broken";
      a.title = tf("texUnresolvedRef", { key });
    });
  return a;
}

/** What a `\ref` PRINTS. `\eqref` parenthesises, as amsmath does; everything
 *  else prints the bare number, or the anchor's title when it carries none. */
function refText(anchor: NoteAnchor, eq: boolean): string {
  const number = anchor.number;
  if (!number) return anchor.title || anchor.id;
  return eq ? `(${number})` : number;
}

/** `\cite{key}` — a chip. It becomes a LINK when some note in the vault
 *  answers to the key (a `\bibitem` or a frontmatter `citekey:`); otherwise it
 *  stays an ordinary bibliography reference, which is what most keys are. */
function citation(keys: string[], note: string | null, ctx: Ctx): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "s-rv-cite";
  wrap.appendChild(document.createTextNode("["));
  keys.forEach((key, i) => {
    if (i > 0) wrap.appendChild(document.createTextNode(", "));
    const local = ctx.doc.blocks.some(
      (b) => b.t === "bib" && b.items.some((item) => item.key === key),
    );
    const el = document.createElement("a");
    el.className = "s-rv-cite__key";
    el.textContent = key;
    if (local) {
      el.dataset.anchor = anchorId(`bib-${key}`);
    } else {
      void lookupXref({ cite: key })
        .then((hit) => {
          if (!hit.path) return;
          el.dataset.target = hit.path;
          el.classList.add("s-rv-cite__key--note");
          el.title = tf("texCiteOpens", { note: noteTitleOf(hit.path) });
        })
        .catch(() => {});
    }
    wrap.appendChild(el);
  });
  if (note) {
    wrap.appendChild(document.createTextNode(", "));
    const span = document.createElement("span");
    span.textContent = note;
    wrap.appendChild(span);
  }
  wrap.appendChild(document.createTextNode("]"));
  return wrap;
}

/** Element ids are namespaced so a LaTeX label like `section` cannot collide
 *  with a markdown heading slug the host page also assigned. */
function anchorId(id: string): string {
  return `tex-${id}`;
}

// ── Blocks ──────────────────────────────────────────────────────────────────

function renderBlocks(blocks: Block[], ctx: Ctx, root: HTMLElement): void {
  for (const block of blocks) root.appendChild(renderBlock(block, ctx));
}

function renderBlock(block: Block, ctx: Ctx): HTMLElement {
  switch (block.t) {
    case "section":
      return sectionEl(block, ctx);
    case "para": {
      const p = document.createElement("p");
      p.className = "s-rv-p";
      p.dir = "auto";
      renderInline(block.c, ctx, p);
      return p;
    }
    case "list": {
      const list = document.createElement(block.ordered ? "ol" : "ul");
      list.className = block.items.some((i) => i.term)
        ? "s-rv-list s-rv-tex-desc"
        : "s-rv-list";
      for (const item of block.items) {
        const li = document.createElement("li");
        li.dir = "auto";
        if (item.term) {
          const term = document.createElement("strong");
          term.className = "s-rv-tex-term";
          renderInline(item.term, ctx, term);
          li.appendChild(term);
          li.appendChild(document.createTextNode(" "));
        }
        renderBlocks(item.c, ctx, li);
        list.appendChild(li);
      }
      return list;
    }
    case "quote": {
      const bq = document.createElement("blockquote");
      bq.className = "s-rv-quote";
      renderBlocks(block.c, ctx, bq);
      return bq;
    }
    case "center": {
      const div = document.createElement("div");
      div.className = "s-rv-tex-center";
      renderBlocks(block.c, ctx, div);
      return div;
    }
    case "code": {
      const pre = document.createElement("pre");
      pre.className = "s-rv-pre";
      const code = document.createElement("code");
      code.textContent = block.text;
      pre.appendChild(code);
      if (block.lang) void highlight(code, block.text, block.lang);
      return pre;
    }
    case "math":
      return mathBlockEl(block, ctx);
    case "figure":
      return figureEl(block, ctx);
    case "table":
      return tableEl(block, ctx);
    case "theorem":
      return theoremEl(block, ctx);
    case "abstract": {
      const box = document.createElement("section");
      box.className = "s-rv-tex-abstract";
      const head = document.createElement("div");
      head.className = "s-rv-tex-abstract__head";
      head.textContent = t("texAbstract");
      box.appendChild(head);
      renderBlocks(block.c, ctx, box);
      return box;
    }
    case "titleblock":
      return titleBlockEl(block, ctx);
    case "bib":
      return bibliographyEl(block, ctx);
    case "transclude":
      return transclusionEl(block.target, ctx);
    case "rule": {
      const hr = document.createElement("hr");
      hr.className = "s-rv-hr";
      return hr;
    }
    case "toc":
      return tocEl(ctx);
    case "unknownEnv": {
      // The wrapper is unknown; its CONTENTS are still the author's writing.
      // Swallowing them would hide a chapter behind one unrecognized macro.
      const div = document.createElement("div");
      div.className = "s-rv-tex-env";
      div.dataset.env = block.name;
      renderBlocks(block.c, ctx, div);
      return div;
    }
  }
}

function sectionEl(block: Extract<Block, { t: "section" }>, ctx: Ctx): HTMLElement {
  // \part and \chapter map onto h1/h2 so an article and a book both land in
  // the six levels the reading view styles.
  const level = Math.min(6, Math.max(1, block.level));
  const el = document.createElement(`h${level}`);
  el.className = `s-rv-h s-rv-h${level}`;
  el.dir = "auto";
  if (ctx.assignIds) el.id = anchorId(block.id);
  if (block.number) {
    const num = document.createElement("span");
    num.className = "s-rv-tex-num";
    num.textContent = block.number;
    el.appendChild(num);
  }
  renderInline(block.title, ctx, el);
  return el;
}

function mathBlockEl(block: Extract<Block, { t: "math" }>, ctx: Ctx): HTMLElement {
  // The NUMBER is already inside the TeX, as an explicit `\tag{n}` the parser
  // injected — KaTeX places it exactly where amsmath does, per row inside an
  // `align`. Drawing a second one beside it is how this shipped a paper with
  // "(1)   (1)" on the same line.
  const body = document.createElement("div");
  body.className = "s-rv-mathblock";
  if (ctx.assignIds && block.id) body.id = anchorId(block.id);
  mathInto(body, block.tex, true, ctx);
  // Every anchor an align defines gets its own landing point, not just the
  // first: `\eqref{eq:z}` must reach row three.
  if (ctx.assignIds) {
    for (const a of ctx.doc.anchors) {
      if (a.kind !== "equation" || a.line !== block.line || a.id === block.id) continue;
      const mark = document.createElement("span");
      mark.className = "s-rv-tex-anchor";
      mark.id = anchorId(a.id);
      body.insertBefore(mark, body.firstChild);
    }
  }
  return body;
}

function figureEl(block: Extract<Block, { t: "figure" }>, ctx: Ctx): HTMLElement {
  const fig = document.createElement("figure");
  fig.className = "s-rv-figure";
  if (ctx.assignIds && block.id) fig.id = anchorId(block.id);
  if (block.graphic) {
    const img = document.createElement("img");
    img.className = "s-rv-img";
    img.alt = block.caption ? inlineToText(block.caption) : block.graphic;
    if (block.width) img.style.width = block.width;
    fig.appendChild(img);
    attachGraphic(img, block.graphic, ctx);
  }
  if (block.caption) {
    fig.appendChild(captionEl(t("texFigure"), block.number, block.caption, ctx));
  }
  return fig;
}

function tableEl(block: Extract<Block, { t: "table" }>, ctx: Ctx): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "s-rv-tablewrap";
  if (ctx.assignIds && block.id) wrap.id = anchorId(block.id);
  if (block.caption) {
    wrap.appendChild(captionEl(t("texTable"), block.number, block.caption, ctx));
  }
  const table = document.createElement("table");
  table.className = "s-rv-table";
  const alignClass = (i: number): string => {
    const a = block.align[i];
    return a === "c" ? "s-rv-al-c" : a === "r" ? "s-rv-al-r" : "";
  };
  if (block.head) {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    block.head.forEach((cell, i) => {
      const th = document.createElement("th");
      th.dir = "auto";
      if (cell.span > 1) th.colSpan = cell.span;
      const cls = alignClass(i);
      if (cls) th.className = cls;
      renderInline(cell.c, ctx, th);
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
  }
  const tbody = document.createElement("tbody");
  for (const row of block.rows) {
    const tr = document.createElement("tr");
    row.forEach((cell, i) => {
      const td = document.createElement("td");
      td.dir = "auto";
      if (cell.span > 1) td.colSpan = cell.span;
      const cls = alignClass(i);
      if (cls) td.className = cls;
      renderInline(cell.c, ctx, td);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function captionEl(
  label: string,
  number: string | null,
  caption: Inline[],
  ctx: Ctx,
): HTMLElement {
  const cap = document.createElement("figcaption");
  cap.className = "s-rv-caption";
  cap.dir = "auto";
  const tag = document.createElement("span");
  tag.className = "s-rv-caption__label";
  tag.textContent = number ? `${label} ${number}` : label;
  cap.appendChild(tag);
  renderInline(caption, ctx, cap);
  return cap;
}

function theoremEl(block: Extract<Block, { t: "theorem" }>, ctx: Ctx): HTMLElement {
  const box = document.createElement("div");
  box.className = `s-rv-theorem s-rv-theorem--${block.env}`;
  if (ctx.assignIds && block.id) box.id = anchorId(block.id);
  const head = document.createElement("div");
  head.className = "s-rv-theorem__head";
  const name = document.createElement("span");
  name.className = "s-rv-theorem__name";
  name.textContent = theoremName(block.env, block.number);
  head.appendChild(name);
  if (block.title) {
    const title = document.createElement("span");
    title.className = "s-rv-theorem__title";
    title.appendChild(document.createTextNode("("));
    renderInline(block.title, ctx, title);
    title.appendChild(document.createTextNode(")"));
    head.appendChild(title);
  }
  box.appendChild(head);
  const body = document.createElement("div");
  body.className = "s-rv-theorem__body";
  renderBlocks(block.c, ctx, body);
  box.appendChild(body);
  return box;
}

/** The printed name of a theorem-like environment. Localized for the dozen
 *  standard ones; anything else keeps the environment's own name capitalized,
 *  which is what a `\newtheorem{observation}{Observation}` author expects. */
function theoremName(env: string, number: string | null): string {
  const known: Record<string, string> = {
    theorem: t("texTheorem"),
    lemma: t("texLemma"),
    proposition: t("texProposition"),
    corollary: t("texCorollary"),
    definition: t("texDefinition"),
    remark: t("texRemark"),
    example: t("texExample"),
    proof: t("texProof"),
  };
  const label = known[env] ?? env.charAt(0).toUpperCase() + env.slice(1);
  return number ? `${label} ${number}` : label;
}

function titleBlockEl(block: Extract<Block, { t: "titleblock" }>, ctx: Ctx): HTMLElement {
  const head = document.createElement("header");
  head.className = "s-rv-tex-titleblock";
  const h1 = document.createElement("h1");
  h1.className = "s-rv-h s-rv-h1 s-rv-tex-title";
  h1.dir = "auto";
  renderInline(block.title, ctx, h1);
  head.appendChild(h1);
  const meta = document.createElement("p");
  meta.className = "s-rv-tex-byline";
  meta.dir = "auto";
  if (block.author) renderInline(block.author, ctx, meta);
  if (block.date) {
    if (block.author) meta.appendChild(document.createTextNode(" · "));
    renderInline(block.date, ctx, meta);
  }
  if (meta.childNodes.length > 0) head.appendChild(meta);
  return head;
}

function bibliographyEl(block: Extract<Block, { t: "bib" }>, ctx: Ctx): HTMLElement {
  const sec = document.createElement("section");
  sec.className = "s-rv-bib";
  const head = document.createElement("div");
  head.className = "s-rv-bib__head";
  head.textContent = t("texReferences");
  sec.appendChild(head);
  const ol = document.createElement("ol");
  ol.className = "s-rv-bib__list";
  block.items.forEach((item, i) => {
    const li = document.createElement("li");
    li.className = "s-rv-bib__item";
    li.dir = "auto";
    if (ctx.assignIds) li.id = anchorId(`bib-${item.key}`);
    const marker = document.createElement("span");
    marker.className = "s-rv-bib__marker";
    marker.textContent = `[${item.label ?? String(i + 1)}]`;
    li.appendChild(marker);
    // The entry's prose goes in ONE child. The row is a flex container, so
    // appending the inline nodes directly made every <em> its own flex item —
    // and the row's gap then opened a visible hole before the comma after an
    // italicised title.
    const text = document.createElement("span");
    text.className = "s-rv-bib__text";
    renderInline(item.c, ctx, text);
    li.appendChild(text);
    ol.appendChild(li);
  });
  sec.appendChild(ol);
  return sec;
}

function tocEl(ctx: Ctx): HTMLElement {
  const nav = document.createElement("nav");
  nav.className = "s-rv-tex-toc";
  const head = document.createElement("div");
  head.className = "s-rv-tex-toc__head";
  head.textContent = t("texContents");
  nav.appendChild(head);
  const ol = document.createElement("ol");
  for (const block of ctx.doc.blocks) {
    if (block.t !== "section") continue;
    const li = document.createElement("li");
    li.className = `s-rv-tex-toc__l${Math.min(4, block.level)}`;
    const a = document.createElement("a");
    a.dataset.anchor = anchorId(block.id);
    a.textContent = block.number
      ? `${block.number}  ${inlineToText(block.title)}`
      : inlineToText(block.title);
    li.appendChild(a);
    ol.appendChild(li);
  }
  nav.appendChild(ol);
  return nav;
}

// ── Graphics ────────────────────────────────────────────────────────────────

/** `\includegraphics{Media/bar}` → the vault file, resolved exactly as a
 *  markdown embed is: by basename through /api/resolve, so the publish
 *  allowlist (which is built from the same names) and the page agree. LaTeX
 *  authors routinely omit the extension, so the candidates are tried in the
 *  order `graphicx` itself would try them. */
const GRAPHIC_EXTS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

function attachGraphic(img: HTMLImageElement, name: string, ctx: Ctx): void {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const hasExt = /\.[A-Za-z0-9]{2,4}$/.test(base);
  const candidates = hasExt ? [base] : GRAPHIC_EXTS.map((ext) => base + ext);
  const fail = (): void => {
    markEmbedBroken(name);
    if (ctx.missingImages === "card") img.remove();
    else img.replaceWith(brokenEmbed(name));
  };
  const tryNext = (i: number): void => {
    if (i >= candidates.length) {
      fail();
      return;
    }
    const candidate = candidates[i];
    if (embedKnownBroken(candidate)) {
      tryNext(i + 1);
      return;
    }
    const r = resolveAttachment(candidate);
    const use = (path: string | null): void => {
      if (!path) {
        markEmbedBroken(candidate);
        tryNext(i + 1);
        return;
      }
      img.onerror = () => {
        markEmbedBroken(candidate);
        img.onerror = null;
        tryNext(i + 1);
      };
      img.src = fileUrl(path);
    };
    if (typeof r === "string" || r === null) use(r);
    else void r.then(use);
  };
  tryNext(0);
}

// ── Transclusion (`\input` / `\include`) ────────────────────────────────────

function transclusionEl(target: string, ctx: Ctx): HTMLElement {
  // LOCAL-FIRST: the note's own folder, exactly as pdflatex resolves it, then
  // the vault-wide basename fallback wikilinks give.
  const dir = ctx.notePath.includes("/")
    ? ctx.notePath.slice(0, ctx.notePath.lastIndexOf("/"))
    : "";
  const bare = target.replace(/\.tex$/i, "");
  const local = dir === "" ? bare : `${dir}/${bare}`;
  const path = resolveLink(local, ctx.tree) ?? resolveLink(bare.slice(bare.lastIndexOf("/") + 1), ctx.tree);

  const card = document.createElement("div");
  card.className = "s-rv-transclude";
  const header = document.createElement("div");
  header.className = "s-rv-transclude__title";
  header.textContent = path ? noteTitleOf(path) : target;
  card.appendChild(header);
  const body = document.createElement("div");
  body.className = "s-rv-transclude__body";
  card.appendChild(body);

  if (!path) {
    // On a reader-facing surface (the blog article sets brokenLinks:"plain")
    // an unresolvable `\input` renders as NOTHING. The alternative is a red
    // card naming a file stem — "chapters/appendix" — which tells a visitor
    // about the vault's internal shape and tells them nothing they can use.
    // The admin still sees the broken card, because for the admin it is a
    // fact worth knowing.
    if (ctx.brokenLinks === "plain") {
      const gone = document.createElement("span");
      gone.className = "s-rv-tex-dropped";
      return gone;
    }
    card.classList.add("s-rv-transclude--broken");
    body.textContent = tf("noNoteNamed", { name: target });
    return card;
  }
  if (ctx.ancestors.has(path) || ctx.depth >= 1) {
    body.textContent = ctx.ancestors.has(path) ? t("noteEmbedsItself") : t("openNoteArrow");
    body.classList.add("s-rv-transclude__note");
    header.classList.add("s-rv-transclude__title--link");
    header.addEventListener("click", () => useStore.getState().openNote(path));
    return card;
  }
  header.classList.add("s-rv-transclude__title--link");
  header.title = tf("openNote", { path: header.textContent ?? "" });
  header.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    useStore.getState().openNote(path);
  });
  body.textContent = "…";
  void getNote(path)
    .then(async (note) => {
      if (!body.isConnected && !card.isConnected) return;
      // The included file may itself be markdown — a vault is not obliged to
      // be all one format — so this goes through the dispatcher, not through
      // this file's own renderer.
      const { renderNoteContent } = await import("./renderNote.ts");
      const el = renderNoteContent(note.content, {
        notePath: path,
        tree: ctx.tree,
        embedded: true,
        ancestors: new Set([...ctx.ancestors, path]),
        brokenLinks: ctx.brokenLinks,
        missingImages: ctx.missingImages,
        visibleTags: ctx.visibleTags,
      });
      body.replaceChildren(el);
      markTransclusionOverflow(
        card,
        body,
        "s-rv-transclude--overflow",
        "s-rv-transclude__more",
        () => useStore.getState().openNote(path),
      );
    })
    .catch(() => {
      body.textContent = t("noteLoadFailed");
    });
  return card;
}

// ── Code highlighting (shared with the markdown renderer) ───────────────────

async function highlight(el: HTMLElement, source: string, lang: string): Promise<void> {
  try {
    const [{ LanguageDescription }, { languages }, { classHighlighter, highlightTree }] =
      await Promise.all([
        import("@codemirror/language"),
        import("@codemirror/language-data"),
        import("@lezer/highlight"),
      ]);
    const desc = LanguageDescription.matchLanguageName(languages, lang, true);
    if (!desc) return;
    const support = await desc.load();
    const tree = support.language.parser.parse(source);
    const frag = document.createDocumentFragment();
    let pos = 0;
    highlightTree(tree, classHighlighter, (from, to, classes) => {
      if (from > pos) frag.appendChild(document.createTextNode(source.slice(pos, from)));
      const span = document.createElement("span");
      span.className = classes;
      span.textContent = source.slice(from, to);
      frag.appendChild(span);
      pos = to;
    });
    if (pos < source.length) frag.appendChild(document.createTextNode(source.slice(pos)));
    el.replaceChildren(frag);
  } catch {
    /* leave the plain text */
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function inlineToText(nodes: Inline[]): string {
  const host = document.createElement("span");
  for (const n of nodes) {
    if (n.t === "text") host.appendChild(document.createTextNode(n.v));
    else if (n.t === "style") host.appendChild(document.createTextNode(inlineToText(n.c)));
    else if (n.t === "link") host.appendChild(document.createTextNode(n.label ?? n.target));
  }
  return host.textContent ?? "";
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Render a whole `.tex` note to a detached element tree (class "s-rv"), in
 *  the reading view's own visual language. */
export function renderTex(src: string, opts: RenderOptions): HTMLElement {
  const doc = parseTex(src);
  const ctx: Ctx = {
    ...opts,
    doc,
    depth: opts.embedded ? 1 : 0,
    ancestors: new Set([...(opts.ancestors ?? []), opts.notePath]),
    macros: doc.macros,
    footnotes: doc.footnotes,
    assignIds: !opts.embedded,
  };
  const root = document.createElement("div");
  root.className = "s-rv s-rv--tex";

  // Frontmatter renders as the SAME properties card a markdown note gets — the
  // comment block is frontmatter, so it reads as frontmatter.
  if (!opts.embedded && doc.frontmatter.trim() !== "") {
    const banner = bannerFromYaml(doc.frontmatter);
    if (banner) root.appendChild(buildBannerEl(banner, "s-rv-banner"));
    const card = buildPropsCard(doc.frontmatter, {
      prefix: "s-rv-props",
      makeTag: (value) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = "s-rv-tag";
        pill.dataset.tag = value;
        pill.dir = "auto";
        pill.textContent = `#${value}`;
        return pill;
      },
    });
    if (card) root.appendChild(card);
  }

  renderBlocks(doc.blocks, ctx, root);

  if (doc.footnotes.length > 0 && !opts.embedded) {
    const sec = document.createElement("section");
    sec.className = "s-rv-footnotes";
    const ol = document.createElement("ol");
    doc.footnotes.forEach((body, i) => {
      const li = document.createElement("li");
      li.id = `fn-${i + 1}`;
      renderInline(body, ctx, li);
      const back = document.createElement("a");
      back.className = "s-rv-fnback";
      back.dataset.fnback = String(i + 1);
      back.title = t("backToReference");
      back.textContent = "↩";
      li.appendChild(document.createTextNode(" "));
      li.appendChild(back);
      ol.appendChild(li);
    });
    sec.appendChild(ol);
    root.appendChild(sec);
  }

  hydrateMath(root, ctx);
  // The reading view's own delegated handler covers wikilinks, tags, footnotes
  // and callout folding; this one adds the two clicks only LaTeX has.
  root.addEventListener("click", onRootClick);
  root.addEventListener("click", onTexClick);
  return root;
}

/** In-page jumps a `.tex` note adds: a `\ref` to a local label, a `\cite` to a
 *  local `\bibitem`, and a `\tableofcontents` entry. */
function onTexClick(ev: MouseEvent): void {
  if (ev.button !== 0) return;
  const target = ev.target as HTMLElement;
  const jump = target.closest<HTMLElement>("[data-anchor]");
  if (!jump?.dataset.anchor || jump.dataset.target) return;
  ev.preventDefault();
  const scope = (target.closest(".s-rv") as HTMLElement | null) ?? document.body;
  scope
    .querySelector(`#${CSS.escape(jump.dataset.anchor)}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Just the block a `#anchor` names, rendered on its own — what
 *  `![[Paper#eq:fourier]]` pulls into a markdown note. Returns null when the
 *  anchor does not resolve, and every caller renders that quietly. */
export function renderTexAnchor(
  src: string,
  anchor: string,
  opts: RenderOptions,
): HTMLElement | null {
  const doc = parseTex(src);
  const hit = findAnchor(doc.anchors, anchor);
  if (!hit) return null;
  const ctx: Ctx = {
    ...opts,
    doc,
    depth: 1,
    ancestors: new Set([...(opts.ancestors ?? []), opts.notePath]),
    macros: doc.macros,
    footnotes: doc.footnotes,
    assignIds: false,
  };
  const blocks = blocksForAnchor(doc, hit);
  if (blocks.length === 0) return null;
  const root = document.createElement("div");
  root.className = "s-rv s-rv--tex";
  renderBlocks(blocks, ctx, root);
  hydrateMath(root, ctx);
  root.addEventListener("click", onRootClick);
  return root;
}

/** The blocks an anchor OWNS. An equation, figure or table is one block; a
 *  section is the block itself plus everything under it until the next heading
 *  at the same or a shallower level — the same span a markdown `#heading`
 *  transclusion pulls in. */
function blocksForAnchor(doc: TexDocument, anchor: NoteAnchor): Block[] {
  const index = doc.blocks.findIndex(
    (b) =>
      ("id" in b && b.id === anchor.id) ||
      (b.t === "section" && b.line === anchor.line) ||
      (b.t === "math" && b.line === anchor.line) ||
      (b.t === "figure" && b.line === anchor.line) ||
      (b.t === "table" && b.line === anchor.line) ||
      (b.t === "theorem" && b.line === anchor.line),
  );
  if (index === -1) return [];
  const first = doc.blocks[index];
  if (first.t !== "section") return [first];
  const level = first.level;
  const out: Block[] = [first];
  for (let i = index + 1; i < doc.blocks.length; i++) {
    const b = doc.blocks[i];
    if (b.t === "section" && b.level <= level) break;
    out.push(b);
  }
  return out;
}

/** What a HOVER CARD shows for a `.tex` note.
 *
 *  Markdown previews are built by slicing source LINES, which a LaTeX document
 *  does not survive: a cut between `\begin{figure}` and its `\caption` is a
 *  different document. So this slices on PARAGRAPH boundaries instead, and
 *  when the link named an anchor it starts at that anchor's own line — the
 *  same "land on the part you pointed at" the markdown card gives a
 *  `[[Note#Heading]]`. The card body scrolls, so the budget only exists to
 *  keep a 900-page thesis from being parsed on a mouse-over. */
export function texPreviewSource(content: string, anchor: string | null, maxChars = 4000): string {
  let src = content;
  if (anchor) {
    const hit = findAnchor(parseTex(content).anchors, anchor);
    if (hit) src = src.split("\n").slice(hit.line - 1).join("\n");
  }
  if (src.length <= maxChars) return src;
  const cut = src.lastIndexOf("\n\n", maxChars);
  return src.slice(0, cut > maxChars / 3 ? cut : maxChars);
}

/** The anchors of a `.tex` note, for callers that hold its source (the outline
 *  panel, the hover preview, wikilink autocomplete). */
export function texAnchors(src: string): NoteAnchor[] {
  return parseTex(src).anchors;
}

/** Fetch a note's anchor table from the server. Used where the CONTENT is not
 *  at hand — the client cannot parse a note it has not downloaded. */
export async function fetchAnchors(path: string): Promise<NoteAnchor[]> {
  try {
    return await getAnchors(path);
  } catch {
    return [];
  }
}

/** True when this note is LaTeX — re-exported so callers need one import. */
export const isTexNote = isTexPath;
