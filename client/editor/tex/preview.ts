// Live preview for `.tex` notes — Obsidian's bargain, applied to LaTeX.
//
// The rule is the same one the markdown editor follows and it is the whole
// feature: the line the cursor is on shows its RAW SOURCE; every other line
// reads as the thing it will become. So `\emph{…}` is italic until you put the
// caret in it, a numbered equation is set by KaTeX until you go to edit it, and
// `\begin{figure}` shows the vault's actual image with its caption underneath.
//
// What is deliberately NOT attempted: re-implementing TeX. Sectioning,
// emphasis, lists, math, figures, citations and cross-references get a preview
// because those are what a reader looks at; everything else keeps its source,
// highlighted by the stex mode. A live preview that lies about the other 90%
// of LaTeX would be worse than one that quietly doesn't try.

import "../../styles/preview.css";
import "./tex.css";
import { RangeSet, StateField, Transaction, type Extension, type Range } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { getKatex, loadKatex } from "../../katex.ts";
import { getLang, tf } from "../../i18n.ts";
import { useStore } from "../../state.ts";
import { toast } from "../../toast.ts";
import { resolveLink } from "../links.ts";
import { buildPropsCard } from "../noteMeta.ts";
import { propsEditor } from "../propsEdit.ts";
import {
  brokenEmbed,
  embedKnownBroken,
  fileUrl,
  markEmbedBroken,
  resolveAttachment,
} from "../embeds.ts";
import { notePathFacet } from "../livePreview.ts";
import { languageChanged } from "../langEffect.ts";
import { unescapeTex } from "../../../shared/tex.ts";
import { sectionLevelOf } from "./lang.ts";

// ── Tables ──────────────────────────────────────────────────────────────────

/** `\command{…}` → the class its ARGUMENT is drawn with. The braces and the
 *  command name itself are hidden on an inactive line. */
const TEXT_STYLE: Record<string, string> = {
  emph: "cm-s-em",
  textit: "cm-s-em",
  textsl: "cm-s-em",
  textbf: "cm-s-strong",
  texttt: "cm-s-inline-code",
  textsc: "cm-s-tex-sc",
  textsf: "cm-s-tex-sf",
  underline: "cm-s-tex-u",
  uline: "cm-s-tex-u",
};

/** Commands whose whole call is furniture: shown faint, never hidden (an
 *  author needs to see that a `\label` is there). */
const QUIET_COMMANDS = new Set([
  "usepackage", "documentclass", "newcommand", "renewcommand",
  "providecommand", "def", "newtheorem", "newenvironment", "setlength",
  "geometry", "pagestyle", "thispagestyle", "hypersetup", "graphicspath",
  "bibliographystyle", "vellum", "maketitle", "tableofcontents", "appendix",
  "centering", "noindent", "clearpage", "newpage", "pagebreak", "bigskip",
  "medskip", "smallskip", "vspace", "hspace", "hfill", "vfill", "input",
  "include", "bibliography", "printbibliography", "date", "author", "title",
]);

const CITE_COMMANDS = new Set([
  "cite", "citep", "citet", "citealp", "citealt", "citeauthor", "citeyear",
  "parencite", "textcite", "autocite", "footcite",
]);

const REF_COMMANDS = new Set(["ref", "eqref", "pageref", "autoref", "cref", "Cref", "nameref"]);

/** Commands that vanish entirely on an inactive line. `\label` is the only
 *  one: it prints nothing in the PDF either, and left visible it turned every
 *  `\section{Introduction}\label{sec:intro}` into a heading with a key glued
 *  to it, set in heading type. The caret line still shows it, which is the
 *  live-preview bargain — and the outline and the anchor table surface every
 *  label anyway, so nothing about it is hidden from the author. */
const HIDDEN_COMMANDS = new Set(["label", "index", "nocite"]);

/** Display-math environments: the body is set by KaTeX when the cursor is
 *  outside the block. Starred and unstarred alike. */
const MATH_ENVS = new Set([
  "equation", "align", "gather", "multline", "displaymath", "eqnarray",
  "flalign", "alignat", "IEEEeqnarray",
]);

/** Environments whose body is literal text — nothing inside them is markup. */
const VERBATIM_ENVS = new Set(["verbatim", "Verbatim", "lstlisting", "minted", "alltt"]);

/** Wrappers KaTeX understands as an outer environment. Numbering is stripped
 *  before rendering: the editor is a preview, and a per-block KaTeX counter
 *  would print "(1)" for every equation in the file. */
const KATEX_ENV: Record<string, string> = {
  align: "align*", "align*": "align*",
  gather: "gather*", "gather*": "gather*",
  alignat: "aligned", "alignat*": "aligned",
  flalign: "aligned", "flalign*": "aligned",
  eqnarray: "aligned", "eqnarray*": "aligned",
  IEEEeqnarray: "aligned",
  multline: "gathered", "multline*": "gathered",
};

// ── Widgets ─────────────────────────────────────────────────────────────────

function paintMath(el: HTMLElement, tex: string, display: boolean, after?: () => void): void {
  const paint = (k: NonNullable<ReturnType<typeof getKatex>>): void => {
    try {
      k.render(tex, el, { throwOnError: false, displayMode: display, output: "htmlAndMathml" });
    } catch {
      el.textContent = tex;
    }
  };
  const loaded = getKatex();
  if (loaded) {
    paint(loaded);
    return;
  }
  el.textContent = tex;
  el.classList.add("cm-s-math-pending");
  void loadKatex().then((k) => {
    if (!el.isConnected) return;
    el.classList.remove("cm-s-math-pending");
    paint(k);
    after?.();
  });
}

class InlineMathWidget extends WidgetType {
  constructor(readonly tex: string) {
    super();
  }
  override eq(other: InlineMathWidget): boolean {
    return other.tex === this.tex;
  }
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-s-math";
    paintMath(span, this.tex, false, () => view.requestMeasure());
    return span;
  }
  override ignoreEvent(): boolean {
    return false; // a click drops the caret into the source
  }
}

class BlockMathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly pos: number,
  ) {
    super();
  }
  override eq(other: BlockMathWidget): boolean {
    return other.tex === this.tex;
  }
  toDOM(view: EditorView): HTMLElement {
    const div = document.createElement("div");
    div.className = "cm-s-math-block";
    paintMath(div, this.tex, true, () => view.requestMeasure());
    div.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      view.dispatch({
        selection: { anchor: Math.min(this.pos, view.state.doc.length) },
        scrollIntoView: true,
      });
      view.focus();
    });
    return div;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** `\item` → the same gold bullet the markdown editor draws. */
class BulletWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  override eq(other: BulletWidget): boolean {
    return other.label === this.label;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-s-bullet";
    span.textContent = this.label;
    return span;
  }
}

/** `\cite{key}` → a chip. Same shape the reading view uses, so the editor and
 *  the page agree about what a citation looks like. */
class CiteWidget extends WidgetType {
  constructor(readonly keys: string) {
    super();
  }
  override eq(other: CiteWidget): boolean {
    return other.keys === this.keys;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-s-tex-cite";
    span.textContent = `[${this.keys}]`;
    return span;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/** `\begin{figure}` → the vault's actual image, with its caption underneath.
 *  This is the one place the LaTeX editor shows something a `pdflatex` run
 *  would take a compile to reveal. */
class FigureWidget extends WidgetType {
  readonly lang = getLang();
  constructor(
    readonly graphic: string,
    readonly caption: string,
    readonly width: string | null,
    readonly pos: number,
  ) {
    super();
  }
  override eq(other: FigureWidget): boolean {
    return (
      other.graphic === this.graphic &&
      other.caption === this.caption &&
      other.width === this.width &&
      other.lang === this.lang
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const fig = document.createElement("figure");
    fig.className = "cm-s-tex-figure";
    const img = document.createElement("img");
    img.className = "cm-s-tex-figure__img";
    img.alt = this.caption || this.graphic;
    if (this.width) img.style.width = this.width;
    fig.appendChild(img);
    attachGraphic(img, this.graphic, () => view.requestMeasure());
    if (this.caption) {
      const cap = document.createElement("figcaption");
      cap.className = "cm-s-tex-figure__cap";
      cap.dir = "auto";
      cap.textContent = this.caption;
      fig.appendChild(cap);
    }
    fig.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      view.dispatch({
        selection: { anchor: Math.min(this.pos, view.state.doc.length) },
        scrollIntoView: true,
      });
      view.focus();
    });
    return fig;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** The `%--- … %---%` comment block, drawn as the properties card a markdown
 *  note's YAML gets. It IS frontmatter; it reads as frontmatter. */
class FrontmatterWidget extends WidgetType {
  readonly lang = getLang();
  constructor(
    readonly yaml: string,
    readonly pos: number,
  ) {
    super();
  }
  override eq(other: FrontmatterWidget): boolean {
    return other.yaml === this.yaml && other.lang === this.lang;
  }
  toDOM(view: EditorView): HTMLElement {
    const host = document.createElement("div");
    host.className = "cm-s-props-host";
    const card = buildPropsCard(this.yaml, {
      prefix: "cm-s-props",
      // A `.tex` note's properties live in a `%---` comment block and are
      // edited exactly like a markdown note's: server/frontmatterEdit.ts knows
      // both fences, so the card does not have to.
      ...propsEditor(view.state.facet(notePathFacet)),
      makeTag: (value) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = "cm-s-props__tag";
        pill.dataset.tag = value;
        // dir="auto", not "ltr": a tag is note-derived and can be Arabic, and
        // `#` is bidi-neutral — an RTL base direction would sweep it to the
        // display end and the chip would read `matrix#`.
        pill.dir = "auto";
        pill.textContent = `#${value}`;
        pill.title = tf("searchTag", { tag: value });
        pill.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          window.dispatchEvent(new CustomEvent("vellum:search", { detail: `#${value}` }));
        });
        return pill;
      },
    });
    if (card) host.appendChild(card);
    host.addEventListener("mousedown", (ev) => {
      const el = ev.target as HTMLElement;
      if (el.closest(".cm-s-props__head") || el.closest("button")) return;
      ev.preventDefault();
      view.dispatch({
        selection: { anchor: Math.min(this.pos, view.state.doc.length) },
        scrollIntoView: true,
      });
      view.focus();
    });
    return host;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** `\includegraphics{Media/bar}` → the vault file. LaTeX authors routinely
 *  omit the extension, so the candidates are tried in the order `graphicx`
 *  itself would try them; a total miss draws the ⌀ placeholder the markdown
 *  editor uses, never a broken-image glyph. */
const GRAPHIC_EXTS = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"];

function attachGraphic(img: HTMLImageElement, name: string, after: () => void): void {
  const base = name.slice(name.lastIndexOf("/") + 1);
  const hasExt = /\.[A-Za-z0-9]{2,4}$/.test(base);
  const candidates = hasExt ? [base] : GRAPHIC_EXTS.map((ext) => base + ext);
  const tryNext = (i: number): void => {
    if (i >= candidates.length) {
      markEmbedBroken(name);
      img.replaceWith(brokenEmbed(name));
      after();
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
      img.onload = after;
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

// ── Source scanning helpers ─────────────────────────────────────────────────

interface Span {
  from: number;
  to: number;
}

/** Read a `{…}` group starting at `i` (which must point at `{`); returns the
 *  index just past the closing brace, or -1 when the group is unclosed on this
 *  line — an unclosed group gets no preview, which is the honest answer while
 *  the author is still typing it. */
function groupEnd(text: string, i: number): number {
  if (text[i] !== "{") return -1;
  let depth = 0;
  for (let k = i; k < text.length; k++) {
    if (text[k] === "\\") {
      k++;
      continue;
    }
    if (text[k] === "{") depth++;
    else if (text[k] === "}") {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  return -1;
}

function optEnd(text: string, i: number): number {
  if (text[i] !== "[") return -1;
  for (let k = i; k < text.length; k++) {
    if (text[k] === "\\") {
      k++;
      continue;
    }
    if (text[k] === "]") return k + 1;
  }
  return -1;
}

/** Index of the first UNESCAPED `%` on a line, or -1. */
function commentAt(text: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === "%") return i;
  }
  return -1;
}

const HIDDEN_LINK_RE = /%%\s*\[\[([^[\]]+?)\]\]\s*%%/;

// ── Line-level decorations (ViewPlugin) ─────────────────────────────────────

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let n = from; n <= to; n++) lines.add(n);
  }
  return lines;
}

const SECTION_CLASS = ["cm-s-h1", "cm-s-h1", "cm-s-h2", "cm-s-h3", "cm-s-h4", "cm-s-h5", "cm-s-h6"];

interface LineCtx {
  decos: Range<Decoration>[];
  claimed: Span[];
  active: boolean;
  tree: ReturnType<typeof useStore.getState>["tree"];
  /** The marker each `\item` on THIS line should draw, in order. An
   *  `enumerate` counts; an `itemize` gets the gold bullet the markdown editor
   *  uses. Precomputed per document, because a line cannot see which
   *  environment it is inside. */
  markers: string[];
}

function overlaps(spans: Span[], from: number, to: number): boolean {
  return spans.some((s) => from < s.to && to > s.from);
}

function buildDecorations(view: EditorView, revealActive: boolean): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const active = revealActive ? activeLines(state) : new Set<number>();
  const decos: Range<Decoration>[] = [];
  const claimed: Span[] = [];
  const tree = useStore.getState().tree;
  const regions = documentRegions(state);

  const markers = listMarkers(state);
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      if (seen.has(line.from)) continue;
      seen.add(line.from);
      const region = regionAt(regions, line.number);
      if (region === "verbatim") {
        decos.push(Decoration.line({ class: "cm-s-codeblock" }).range(line.from));
        continue;
      }
      if (region === "frontmatter") {
        decos.push(Decoration.line({ class: "cm-s-frontmatter" }).range(line.from));
        continue;
      }
      if (region === "math") continue; // the block field owns these lines
      const ctx: LineCtx = {
        decos,
        claimed,
        active: active.has(line.number),
        tree,
        markers: [...(markers.get(line.number) ?? [])],
      };
      scanLine(line.text, line.from, ctx);
    }
  }
  return Decoration.set(decos, true);
}

function scanLine(text: string, lineFrom: number, ctx: LineCtx): void {
  const hide = (from: number, to: number): void => {
    if (to > from) ctx.decos.push(Decoration.replace({}).range(from, to));
  };
  const claim = (from: number, to: number): void => {
    ctx.claimed.push({ from, to });
  };

  // A comment runs to the end of the line and stops every other reading of it.
  const cmt = commentAt(text);
  if (cmt >= 0) {
    const rest = text.slice(cmt);
    const hidden = HIDDEN_LINK_RE.exec(rest);
    if (hidden && hidden.index === 0) {
      // `%% [[Note]] %%` — a real link that the PDF never shows. It reads as a
      // link here, muted, so the author can see it is doing something.
      const target = hidden[1].trim();
      const from = lineFrom + cmt;
      const to = from + hidden[0].length;
      const resolved = resolveLink(target, ctx.tree);
      if (!ctx.active) {
        hide(from, from + hidden[0].indexOf("[[") + 2);
        hide(to - (hidden[0].length - hidden[0].lastIndexOf("]]")), to);
      }
      ctx.decos.push(
        Decoration.mark({
          class: resolved
            ? "cm-s-wikilink cm-s-tex-hidden-link"
            : "cm-s-wikilink cm-s-wikilink--broken cm-s-tex-hidden-link",
          attributes: { "data-tex-note": target },
        }).range(from + hidden[0].indexOf("[[") + 2, to - (hidden[0].length - hidden[0].lastIndexOf("]]"))),
      );
      claim(from, to);
      return;
    }
    ctx.decos.push(
      Decoration.mark({ class: "cm-s-tex-comment" }).range(lineFrom + cmt, lineFrom + text.length),
    );
    claim(lineFrom + cmt, lineFrom + text.length);
    // Fall through: the code BEFORE the comment is still code.
  }
  const limit = cmt >= 0 ? cmt : text.length;

  // Sectioning owns the whole line.
  const level = sectionLevelOf(text.slice(0, limit));
  if (level !== null) {
    const open = text.indexOf("{");
    const close = open >= 0 ? groupEnd(text, open) : -1;
    if (open >= 0 && close > 0) {
      ctx.decos.push(
        Decoration.line({ class: SECTION_CLASS[level] ?? "cm-s-h3" }).range(lineFrom),
      );
      if (!ctx.active) {
        hide(lineFrom, lineFrom + open + 1);
        hide(lineFrom + close - 1, lineFrom + close);
      } else {
        ctx.decos.push(
          Decoration.mark({ class: "cm-s-syntax" }).range(lineFrom, lineFrom + open + 1),
        );
      }
      claim(lineFrom, lineFrom + close);
      scanInline(text, open + 1, close - 1, lineFrom, ctx);
      // …and whatever trails the heading — almost always its `\label`.
      scanInline(text, close, limit, lineFrom, ctx);
      return;
    }
  }

  scanInline(text, 0, limit, lineFrom, ctx);
}

/** Walk `[from, to)` of a line, decorating the commands this preview knows.
 *  Recurses into arguments, so `\textbf{\emph{x}}` is bold AND italic. */
function scanInline(text: string, from: number, to: number, lineFrom: number, ctx: LineCtx, depth = 0): void {
  const hide = (a: number, b: number): void => {
    if (b > a && !overlaps(ctx.claimed, a, b)) ctx.decos.push(Decoration.replace({}).range(a, b));
  };
  const mark = (a: number, b: number, cls: string): void => {
    if (b > a) ctx.decos.push(Decoration.mark({ class: cls }).range(a, b));
  };

  let i = from;
  while (i < to) {
    const ch = text[i];

    // $inline math$ — the same pandoc-ish guards the markdown editor uses.
    if (ch === "$" && text[i + 1] !== "$") {
      const close = closingDollar(text, i + 1, to);
      if (close > 0) {
        const tex = text.slice(i + 1, close);
        const a = lineFrom + i;
        const b = lineFrom + close + 1;
        if (tex.trim() !== "" && !overlaps(ctx.claimed, a, b)) {
          if (ctx.active) mark(a, b, "cm-s-math-src");
          else ctx.decos.push(Decoration.replace({ widget: new InlineMathWidget(tex) }).range(a, b));
          ctx.claimed.push({ from: a, to: b });
          i = close + 1;
          continue;
        }
      }
      i++;
      continue;
    }

    if (ch !== "\\") {
      i++;
      continue;
    }

    const m = /^\\([a-zA-Z@]+\*?|.)/.exec(text.slice(i, i + 32));
    if (!m) {
      i++;
      continue;
    }
    const name = m[1];
    let k = i + m[0].length;

    // \( … \) inline math.
    if (name === "(") {
      const close = text.indexOf("\\)", k);
      if (close > 0 && close < to) {
        const a = lineFrom + i;
        const b = lineFrom + close + 2;
        const tex = text.slice(k, close);
        if (ctx.active) mark(a, b, "cm-s-math-src");
        else ctx.decos.push(Decoration.replace({ widget: new InlineMathWidget(tex) }).range(a, b));
        ctx.claimed.push({ from: a, to: b });
        i = close + 2;
        continue;
      }
      i = k;
      continue;
    }

    // \begin{env} / \end{env}: structure, drawn quiet.
    if (name === "begin" || name === "end") {
      const g = groupEnd(text, k);
      const stop = g > 0 ? g : k;
      mark(lineFrom + i, lineFrom + stop, "cm-s-tex-env");
      i = stop;
      continue;
    }

    // \item → a bullet in an itemize, its NUMBER in an enumerate.
    if (name === "item") {
      const optStart = /^\s*\[/.test(text.slice(k)) ? k + text.slice(k).indexOf("[") : -1;
      const o = optStart >= 0 ? optEnd(text, optStart) : -1;
      const stop = o > 0 ? o : k;
      if (!ctx.active) {
        const label = ctx.markers.shift() ?? "•";
        ctx.decos.push(
          Decoration.replace({ widget: new BulletWidget(label) }).range(lineFrom + i, lineFrom + stop),
        );
      } else {
        ctx.markers.shift();
        mark(lineFrom + i, lineFrom + stop, "cm-s-syntax");
      }
      ctx.claimed.push({ from: lineFrom + i, to: lineFrom + stop });
      i = stop;
      continue;
    }

    // \note[alias]{Target} — Vellum's own link macro.
    if (name === "note") {
      const optStart = k;
      const o = optEnd(text, optStart);
      const gStart = o > 0 ? o : k;
      const g = groupEnd(text, gStart);
      if (g > 0) {
        // `\&`, `\%`, `\_` … come back to themselves: a note titled
        // "Wikilinks & Backlinks" can only be WRITTEN `\note{Wikilinks \&
        // Backlinks}` in a file that compiles, and the link has to resolve to
        // the real title, not to the escaped one.
        const target = unescapeTex(text.slice(gStart + 1, g - 1));
        const resolved = resolveLink(target.split("#")[0], ctx.tree);
        const cls = resolved
          ? "cm-s-wikilink cm-s-tex-note"
          : "cm-s-wikilink cm-s-wikilink--broken cm-s-tex-note";
        const attrs = { attributes: { "data-tex-note": target } };
        if (ctx.active) {
          mark(lineFrom + i, lineFrom + g, "cm-s-tex-cmd");
        } else if (o > 0) {
          // With display text, the TARGET is the machinery: show the words.
          hide(lineFrom + i, lineFrom + optStart + 1);
          ctx.decos.push(
            Decoration.mark({ class: cls, ...attrs }).range(lineFrom + optStart + 1, lineFrom + o - 1),
          );
          hide(lineFrom + o - 1, lineFrom + g);
        } else {
          hide(lineFrom + i, lineFrom + gStart + 1);
          ctx.decos.push(
            Decoration.mark({ class: cls, ...attrs }).range(lineFrom + gStart + 1, lineFrom + g - 1),
          );
          hide(lineFrom + g - 1, lineFrom + g);
        }
        ctx.claimed.push({ from: lineFrom + i, to: lineFrom + g });
        i = g;
        continue;
      }
    }

    // \cite{a,b} → a chip; \ref{x} → a quiet reference.
    if (CITE_COMMANDS.has(name) || REF_COMMANDS.has(name)) {
      const o = optEnd(text, k);
      const gStart = o > 0 ? o : k;
      const g = groupEnd(text, gStart);
      if (g > 0) {
        const keys = text.slice(gStart + 1, g - 1);
        const a = lineFrom + i;
        const b = lineFrom + g;
        if (ctx.active) {
          mark(a, b, "cm-s-tex-cmd");
        } else if (CITE_COMMANDS.has(name)) {
          ctx.decos.push(Decoration.replace({ widget: new CiteWidget(keys) }).range(a, b));
        } else {
          hide(a, lineFrom + gStart + 1);
          mark(lineFrom + gStart + 1, lineFrom + g - 1, "cm-s-tex-ref");
          hide(lineFrom + g - 1, b);
        }
        ctx.claimed.push({ from: a, to: b });
        i = g;
        continue;
      }
    }

    // Text styling: hide the wrapper, style the argument, recurse into it.
    const style = TEXT_STYLE[name];
    if (style) {
      const g = groupEnd(text, k);
      if (g > 0) {
        if (ctx.active) {
          mark(lineFrom + i, lineFrom + k + 1, "cm-s-syntax");
          mark(lineFrom + g - 1, lineFrom + g, "cm-s-syntax");
        } else {
          hide(lineFrom + i, lineFrom + k + 1);
          hide(lineFrom + g - 1, lineFrom + g);
        }
        mark(lineFrom + k + 1, lineFrom + g - 1, style);
        if (depth < 4) scanInline(text, k + 1, g - 1, lineFrom, ctx, depth + 1);
        i = g;
        continue;
      }
    }

    // `\label{…}`: gone on an inactive line, faint on the caret's line.
    if (HIDDEN_COMMANDS.has(name)) {
      const g = groupEnd(text, k);
      if (g > 0) {
        if (ctx.active) mark(lineFrom + i, lineFrom + g, "cm-s-tex-cmd");
        else hide(lineFrom + i, lineFrom + g);
        ctx.claimed.push({ from: lineFrom + i, to: lineFrom + g });
        i = g;
        continue;
      }
    }

    // Preamble furniture and the commands with no preview: quiet, never hidden.
    if (QUIET_COMMANDS.has(name)) {
      let stop = k;
      for (;;) {
        const o = optEnd(text, stop);
        if (o > 0) {
          stop = o;
          continue;
        }
        const g = groupEnd(text, stop);
        if (g > 0) {
          stop = g;
          continue;
        }
        break;
      }
      mark(lineFrom + i, lineFrom + Math.min(stop, to), "cm-s-tex-quiet");
      i = Math.max(stop, k);
      continue;
    }

    i = k;
  }
}

const LIST_ENVS = new Set(["itemize", "enumerate", "description", "compactitem", "compactenum"]);

/** For every line, the marker each `\item` on it should draw. One pass over
 *  the document with a stack, so nesting counts independently — an enumerate
 *  inside an itemize starts again at 1, exactly as LaTeX does it. */
function listMarkers(state: EditorState): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const stack: { ordered: boolean; n: number }[] = [];
  const doc = state.doc;
  for (let line = 1; line <= doc.lines; line++) {
    const text = doc.line(line).text;
    const begin = /^\s*\\begin\s*\{([^}]*)\}/.exec(text);
    if (begin) {
      const bare = begin[1].replace(/\*$/, "");
      if (LIST_ENVS.has(bare)) stack.push({ ordered: bare.startsWith("enumerate") || bare === "compactenum", n: 0 });
      continue;
    }
    if (/^\s*\\end\s*\{([^}]*)\}/.test(text)) {
      const bare = /^\s*\\end\s*\{([^}]*)\}/.exec(text)![1].replace(/\*$/, "");
      if (LIST_ENVS.has(bare)) stack.pop();
      continue;
    }
    const top = stack[stack.length - 1];
    if (!top) continue;
    const labels: string[] = [];
    const re = /\\item(?![a-zA-Z])/g;
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      if (top.ordered) {
        top.n++;
        labels.push(`${top.n}.`);
      } else {
        labels.push("•");
      }
    }
    if (labels.length > 0) out.set(line, labels);
  }
  return out;
}

function closingDollar(text: string, from: number, to: number): number {
  for (let i = from; i < to; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === "$") return i;
  }
  return -1;
}

// ── Document regions (verbatim / math / frontmatter) ────────────────────────

type Region = "verbatim" | "math" | "frontmatter";

interface RegionSpan {
  first: number; // 1-based line
  last: number;
  kind: Region;
}

/** The line ranges that are NOT ordinary prose. Computed once per build: a
 *  verbatim body must not be read as markup, a display-math block belongs to
 *  the block field, and the frontmatter comment is a card. */
function documentRegions(state: EditorState): RegionSpan[] {
  const out: RegionSpan[] = [];
  const doc = state.doc;
  // Frontmatter: `%---` on line 1, closing `%---%` / `---%`.
  if (doc.lines >= 2 && /^%-{3,}%?\s*$/.test(doc.line(1).text)) {
    for (let n = 2; n <= Math.min(doc.lines, 60); n++) {
      if (/^\s*%?-{3,}%?\s*$/.test(doc.line(n).text)) {
        out.push({ first: 1, last: n, kind: "frontmatter" });
        break;
      }
    }
  }
  let n = 1;
  while (n <= doc.lines) {
    const text = doc.line(n).text;
    const begin = /^\s*\\begin\s*\{([^}]*)\}/.exec(text);
    if (begin) {
      const env = begin[1];
      const bare = env.replace(/\*$/, "");
      const kind: Region | null = VERBATIM_ENVS.has(bare)
        ? "verbatim"
        : MATH_ENVS.has(bare)
          ? "math"
          : null;
      if (kind) {
        const endTok = new RegExp(`^\\s*\\\\end\\s*\\{${escapeRe(env)}\\}`);
        for (let k = n + 1; k <= doc.lines; k++) {
          if (endTok.test(doc.line(k).text)) {
            out.push({ first: n, last: k, kind });
            n = k;
            break;
          }
          if (k === doc.lines) n = k;
        }
      }
    } else if (/^\s*\\\[/.test(text)) {
      for (let k = n; k <= doc.lines; k++) {
        if (/\\\]\s*$/.test(doc.line(k).text)) {
          out.push({ first: n, last: k, kind: "math" });
          n = k;
          break;
        }
        if (k === doc.lines) n = k;
      }
    } else if (/^\s*\$\$/.test(text)) {
      const single = /^\s*\$\$.*\$\$\s*$/.test(text);
      if (single) out.push({ first: n, last: n, kind: "math" });
      else {
        for (let k = n + 1; k <= doc.lines; k++) {
          if (/\$\$\s*$/.test(doc.line(k).text)) {
            out.push({ first: n, last: k, kind: "math" });
            n = k;
            break;
          }
          if (k === doc.lines) n = k;
        }
      }
    }
    n++;
  }
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regionAt(regions: RegionSpan[], line: number): Region | null {
  for (const r of regions) if (line >= r.first && line <= r.last) return r.kind;
  return null;
}

// ── Block decorations (StateField) ──────────────────────────────────────────

/** The TeX a display block hands to KaTeX: labels and numbering instructions
 *  removed (they are document semantics, not formula), and the unstarred
 *  environments swapped for their starred twins so KaTeX does not print a "(1)"
 *  of its own for every block on the page. */
function mathForKatex(env: string | null, body: string): string {
  const clean = body
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .replace(/\\(?:nonumber|notag)\b/g, "")
    .trim();
  if (env === null) return clean;
  const target = KATEX_ENV[env];
  if (!target) return clean;
  return `\\begin{${target}}${clean}\\end{${target}}`;
}

function buildBlockDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const doc = state.doc;
  const active = activeLines(state);
  const regions = documentRegions(state);
  const touched = (first: number, last: number): boolean => {
    for (let n = first; n <= last; n++) if (active.has(n)) return true;
    return false;
  };

  for (const region of regions) {
    if (region.kind === "verbatim") continue;
    const first = doc.line(region.first);
    const last = doc.line(region.last);
    if (touched(region.first, region.last)) continue;

    if (region.kind === "frontmatter") {
      const yaml = doc
        .sliceString(doc.line(region.first + 1).from, doc.line(region.last - 1).to)
        .replace(/^[ \t]*%[ \t]?/gm, "");
      if (yaml.trim() === "") continue;
      decos.push(
        Decoration.replace({
          widget: new FrontmatterWidget(yaml, first.from),
          block: true,
        }).range(first.from, last.to),
      );
      continue;
    }

    // Display math.
    const beginMatch = /^\s*\\begin\s*\{([^}]*)\}/.exec(first.text);
    let body: string;
    let env: string | null = null;
    if (beginMatch) {
      env = beginMatch[1];
      body = doc.sliceString(first.from + first.text.indexOf("}") + 1, last.from).trim();
      if (region.first === region.last) {
        body = first.text.replace(/^\s*\\begin\s*\{[^}]*\}/, "").replace(/\\end\s*\{[^}]*\}\s*$/, "");
      }
    } else {
      body = doc
        .sliceString(first.from, last.to)
        .replace(/^\s*(?:\\\[|\$\$)/, "")
        .replace(/(?:\\\]|\$\$)\s*$/, "");
    }
    const tex = mathForKatex(env, body);
    if (tex.trim() === "") continue;
    decos.push(
      Decoration.replace({
        widget: new BlockMathWidget(tex, first.from),
        block: true,
      }).range(first.from, last.to),
    );
  }

  // Figures: the whole float becomes its image plus caption.
  const inFloat = new Set<number>();
  for (let n = 1; n <= doc.lines; n++) {
    const m = /^\s*\\begin\s*\{(figure\*?|wrapfigure|SCfigure)\}/.exec(doc.line(n).text);
    if (!m) continue;
    const endTok = new RegExp(`^\\s*\\\\end\\s*\\{${escapeRe(m[1])}\\}`);
    let close = -1;
    for (let k = n + 1; k <= doc.lines; k++) {
      if (endTok.test(doc.line(k).text)) {
        close = k;
        break;
      }
    }
    if (close < 0) continue;
    const first = doc.line(n);
    const last = doc.line(close);
    if (touched(n, close)) {
      n = close;
      continue;
    }
    const src = doc.sliceString(first.from, last.to);
    const graphic = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/.exec(src);
    if (!graphic) {
      n = close;
      continue;
    }
    const caption = /\\caption\s*(?:\[[^\]]*\])?\s*\{/.exec(src);
    const captionText = caption ? plainCaption(src, caption.index + caption[0].length - 1) : "";
    const widthMatch = /width\s*=\s*([0-9.]+)\s*\\(?:line|text|column)width/.exec(src);
    const width = widthMatch ? `${Math.min(100, Math.round(Number(widthMatch[1]) * 100))}%` : null;
    for (let k = n; k <= close; k++) inFloat.add(k);
    decos.push(
      Decoration.replace({
        widget: new FigureWidget(graphic[1].trim(), captionText, width, first.from),
        block: true,
      }).range(first.from, last.to),
    );
    n = close;
  }

  // A GRAPHIC THAT IS NOT A FLOAT IS STILL A PICTURE. `\includegraphics` on a
  // line of its own — bare, or inside `center` / `minipage` — is legal
  // graphicx and common in real papers, and leaving it as source while the
  // one inside `\begin{figure}` drew an image made live preview disagree with
  // itself about the same command. No caption and no number, exactly as the
  // reading view draws it (shared/tex.ts's `graphic` node).
  for (let n = 1; n <= doc.lines; n++) {
    if (inFloat.has(n) || touched(n, n)) continue;
    const line = doc.line(n);
    const m = /^\s*\\includegraphics\s*(\[[^\]]*\])?\s*\{([^}]*)\}\s*$/.exec(line.text);
    if (!m || m[2].trim() === "") continue;
    const wm = /width\s*=\s*([0-9.]+)\s*\\(?:line|text|column)width/.exec(m[1] ?? "");
    decos.push(
      Decoration.replace({
        widget: new FigureWidget(
          m[2].trim(),
          "",
          wm ? `${Math.min(100, Math.round(Number(wm[1]) * 100))}%` : null,
          line.from,
        ),
        block: true,
      }).range(line.from, line.to),
    );
  }

  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  return RangeSet.of(decos, true);
}

/** A caption's plain text: the group's contents with control sequences and
 *  braces stripped. The caption is DISPLAY text under an image, so it must
 *  never show `\emph{…}` — the reading view has the full renderer; here the
 *  words are what matter. */
function plainCaption(src: string, openBrace: number): string {
  const end = groupEnd(src, openBrace);
  if (end < 0) return "";
  return src
    .slice(openBrace + 1, end - 1)
    .replace(/\\label\s*\{[^}]*\}/g, "")
    .replace(/\$([^$]*)\$/g, "$1")
    .replace(/\\[a-zA-Z@]+\*?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const texBlocks = StateField.define<DecorationSet>({
  create: (state) => buildBlockDecorations(state),
  update(value, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(languageChanged)) ||
      tr.annotation(Transaction.userEvent) !== undefined
    ) {
      return buildBlockDecorations(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ── Clicks ──────────────────────────────────────────────────────────────────

/** A rendered `\note{…}` or `%% [[…]] %%` opens the note, exactly as a
 *  markdown wikilink does — including the "click a broken link to create it"
 *  behavior Obsidian has and this product already promises. */
function onMouseDown(event: MouseEvent, view: EditorView): boolean {
  if (event.button !== 0) return false;
  const el = (event.target as HTMLElement).closest<HTMLElement>("[data-tex-note]");
  const raw = el?.dataset.texNote;
  if (!raw) return false;
  event.preventDefault();
  const [target, anchor] = raw.split("#");
  const store = useStore.getState();
  const path = resolveLink(target.trim(), store.tree);
  if (path) {
    if (anchor) store.setPendingHeading(anchor.trim());
    void store.openNote(path);
  } else if (!store.admin) {
    toast(tf("linkNotPublished", { name: target.trim() }));
  } else {
    const notePath = /\.(tex|latex|md)$/i.test(target) ? target.trim() : `${target.trim()}.tex`;
    toast(tf("creatingNote", { name: target.trim() }));
    void store.createNote(notePath);
  }
  void view;
  return true;
}

// ── Plugin ──────────────────────────────────────────────────────────────────

class TexPreviewPlugin {
  decorations: DecorationSet;
  /** Until the reader actually interacts, no line counts as "active": a note
   *  opens fully rendered instead of revealing raw TeX on whatever line the
   *  initial cursor landed on. Same rule as the markdown editor. */
  private interacted = false;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view, false);
  }

  update(update: ViewUpdate): void {
    if (!this.interacted && (update.docChanged || update.transactions.some((tr) => tr.isUserEvent("select")))) {
      this.interacted = true;
    }
    if (
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      update.transactions.some((tr) => tr.effects.some((e) => e.is(languageChanged)))
    ) {
      this.decorations = buildDecorations(update.view, this.interacted);
    }
  }
}

const texPreviewPlugin = ViewPlugin.fromClass(TexPreviewPlugin, {
  decorations: (plugin) => plugin.decorations,
  eventHandlers: {
    mousedown(event, view) {
      return onMouseDown(event, view);
    },
  },
});

/** The whole LaTeX live preview, ready to drop into an EditorState. */
export function texPreview(path: string): Extension {
  return [notePathFacet.of(path), texBlocks, texPreviewPlugin];
}
