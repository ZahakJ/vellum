// Text formatting: the commands behind Ctrl/Cmd+B, the right-click selection
// menu and the floating toolbar. One implementation, three surfaces — a menu
// item that inserted its own asterisks would drift from the keystroke the
// first time either changed.
//
// THREE RULES, and every command obeys all three.
//
//   1. APPLYING TWICE REMOVES. A "toggle" that only ever adds is a trap: the
//      reader presses Ctrl+B again because nothing looked bold, and now the
//      line reads ****bold****. So each kind carries a regex for its own
//      rendered span, and a range that already sits inside one (or that
//      contains one whole) is UNWRAPPED instead.
//   2. NO SELECTION IS A REAL CASE. Bold-then-type is how people write. With
//      an empty selection the markers are inserted and the caret parked
//      between them — and if the caret is already inside a span of that kind,
//      the span is removed, so the empty-selection case toggles too.
//   3. A MULTI-LINE SELECTION IS APPLIED PER LINE. Markdown emphasis does not
//      cross a blank line: one `**` at the top of a three-paragraph selection
//      and one at the bottom is not bold text, it is two stray asterisks and a
//      lost paragraph break. Each non-blank line inside the selection gets its
//      own pair, trailing whitespace excluded (a marker after the last visible
//      character is a marker the parser ignores). All lines already wrapped →
//      all are unwrapped; otherwise all are wrapped.
//
// The color commands are the same machinery with a longer opening tag; see
// `colorSpan` and CONTRACTS' "Coloured text" section for why the default
// palette is token-valued rather than literal.
//
// A FOURTH RULE, and it is the one an integrator had to add: THE COMMANDS
// ANSWER THE NOTE'S FORMAT. A note is no longer necessarily markdown
// (shared/noteFormat.ts), and `**bold**` typed into a `.tex` file is not bold
// text — it is two pairs of asterisks that pdflatex prints verbatim, that
// `shared/tex.ts` does not read, and that the live preview beside the caret
// does not render. Measured before this landed: Ctrl+B in a `.tex` note wrote
// `**Typed**`, "Heading 2" wrote `## ` (invisible to the `\section` outline),
// and a colour swatch wrote a `<span style>` into a LaTeX document. Every
// surface — the keystroke, the menu, the toolbar — resolves its spelling
// through `wrapFor` / `syntaxOf` below, so none of them can drift from
// another, and a format with no honest spelling in the target language is
// ABSENT rather than approximated: there is no `\sout` without `ulem` and no
// `\hl` without `soul`, so strikethrough and highlight simply do not exist in
// a `.tex` note, and their keystrokes decline (returning false lets the key
// fall through instead of silently eating it).

import { ChangeSet, EditorSelection, Prec, type ChangeSpec } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { isTexPath } from "../../shared/noteFormat.ts";
import { notePathFacet } from "./livePreview.ts";

/** Every wrapping format the editor knows. `color` is dynamic (the opening tag
 *  carries the chosen value), so it is not in this table. */
export type FormatKind =
  | "bold"
  | "italic"
  | "underline"
  | "strikethrough"
  | "highlight"
  | "code";

/** Which language the open note is written in. Named for the SYNTAX rather
 *  than the extension: `.tex` and `.latex` are one language, and the menu asks
 *  this question, never the filename. */
export type NoteSyntax = "markdown" | "latex";

/** The facet is set by both editors (livePreview.ts for markdown,
 *  tex/preview.ts for LaTeX), so this answer is available wherever a view is. */
export function syntaxOf(state: EditorState): NoteSyntax {
  return isTexPath(state.facet(notePathFacet)) ? "latex" : "markdown";
}

interface Wrap {
  open: string;
  close: string;
  /** Matches one already-formatted span of this kind, ANCHORED nowhere: the
   *  toggle asks whether the caret/selection is inside one of these. */
  span: RegExp;
  /** Only for openings whose length varies — the colour tag carries its value,
   *  so `open.length` is not the length of the tag actually in the document.
   *  `applyColor` uses it to find where the existing opening tag ends when it
   *  REPLACES one colour with another. */
  openRe?: RegExp;
}

/** One `\command{…}` call, tolerating a single level of nesting inside the
 *  argument (`\textbf{\emph{x}}`), which is as deep as a regex should reach and
 *  as deep as the toggle needs: past that the reader is writing LaTeX, not
 *  pressing Ctrl+B. */
const texCall = (name: string): RegExp =>
  new RegExp(`\\\\${name}\\{(?:[^{}]|\\{[^{}]*\\})*\\}`, "g");

/** `<u>` rather than `__`: underline is not markdown, it is the HTML the
 *  sanitizer already admits and the reading view already renders (rawHtml.ts's
 *  INLINE_TAGS). `__text__` would be a second spelling of bold.
 *
 *  The LaTeX column is the SAME five kinds spelled in the language the file is
 *  actually written in, and its four entries are exactly the four
 *  `STYLE_COMMANDS` in shared/tex.ts (and `TEXT_STYLE` in tex/preview.ts) can
 *  read back — a command that wrote something the reader cannot parse would
 *  render as raw source in the very next paint. Strikethrough and highlight
 *  are `undefined` on purpose: `\sout` needs `ulem` and `\hl` needs `soul`,
 *  neither of which a Vellum note can assume, and emitting them would put a
 *  document on disk that neither this editor nor pdflatex can render. */
const WRAPS: Record<NoteSyntax, Partial<Record<FormatKind, Wrap>>> = {
  markdown: {
    // The italic regexes have to refuse `**`, or Ctrl+I inside bold text eats
    // one asterisk of each pair and leaves the line broken.
    bold: { open: "**", close: "**", span: /\*\*(?:[^*]|\*(?!\*))+?\*\*/g },
    italic: {
      open: "*",
      close: "*",
      span: /(?<!\*)\*(?!\*)[^*\n]+?\*(?!\*)/g,
    },
    underline: { open: "<u>", close: "</u>", span: /<u>[\s\S]*?<\/u>/g },
    strikethrough: { open: "~~", close: "~~", span: /~~(?:[^~]|~(?!~))+?~~/g },
    highlight: { open: "==", close: "==", span: /==[^=\n]+?==/g },
    code: { open: "`", close: "`", span: /`[^`\n]+?`/g },
  },
  latex: {
    bold: { open: "\\textbf{", close: "}", span: texCall("textbf") },
    // `\emph` rather than `\textit`: it is the one that nests correctly inside
    // an already-italic run, which is why LaTeX documents are written with it.
    italic: { open: "\\emph{", close: "}", span: texCall("emph") },
    underline: { open: "\\underline{", close: "}", span: texCall("underline") },
    code: { open: "\\texttt{", close: "}", span: texCall("texttt") },
  },
};

/** The spelling of `kind` in `syntax`, or null when that language has none. */
export function wrapFor(syntax: NoteSyntax, kind: FormatKind): Wrap | null {
  return WRAPS[syntax][kind] ?? null;
}

/** Which of the six the selection menu and the floating toolbar may offer in
 *  `syntax`. Both read this, so a row can never outlive its command. */
export function formatsFor(syntax: NoteSyntax): FormatKind[] {
  const all: FormatKind[] = [
    "bold", "italic", "underline", "strikethrough", "highlight", "code",
  ];
  return all.filter((k) => WRAPS[syntax][k] !== undefined);
}

/** A colored run. Only the product's own emitter is recognised — `color:` as
 *  the first declaration of a `style` on a `span` — which is also exactly what
 *  the sanitizer allows through (client/reading/rawHtml.ts). */
const COLOR_SPAN = /<span style="color:[^"<>]*">[\s\S]*?<\/span>/g;

export function colorSpan(value: string): Wrap {
  return {
    open: `<span style="color:${value}">`,
    close: "</span>",
    span: COLOR_SPAN,
    openRe: /^<span style="color:[^"<>]*">/,
  };
}

interface Target {
  from: number;
  to: number;
}

/** The span of `wrap` that swallows [from,to], or that [from,to] swallows. */
function enclosingSpan(
  text: string,
  base: number,
  from: number,
  to: number,
  wrap: Wrap,
): Target | null {
  wrap.span.lastIndex = 0;
  for (let m = wrap.span.exec(text); m; m = wrap.span.exec(text)) {
    const start = base + m.index;
    const end = start + m[0].length;
    // Inside the span, MARKERS INCLUDED — not merely inside the inner text.
    // The narrower test broke the second press on a multi-line selection: after
    // wrapping, the selection runs from the first line's inner START to the
    // last line's inner END, so every line BETWEEN them is clipped to
    // [inner.from, line.to] — one end inside the markers and the other outside
    // — which matched neither "inside the inner text" nor "contains the whole
    // span", and Ctrl+B answered by bolding the bold: ****alpha line one****.
    const insideOuter = from >= start && to <= end;
    const coversWhole = from <= start && to >= end;
    if (insideOuter || coversWhole) return { from: start, to: end };
  }
  return null;
}

/** Changes that strip the two markers off a span found at [from,to]. */
function unwrapChanges(from: number, to: number, wrap: Wrap): ChangeSpec[] {
  return [
    { from, to: from + wrap.open.length },
    { from: to - wrap.close.length, to },
  ];
}

/** The lines a selection touches, each clipped to the selection and to its own
 *  visible text. Blank lines drop out — a `**` on an empty line is litter. */
function perLineTargets(
  view: EditorView,
  from: number,
  to: number,
): Target[] {
  const doc = view.state.doc;
  const first = doc.lineAt(from).number;
  const last = doc.lineAt(to).number;
  const out: Target[] = [];
  for (let n = first; n <= last; n++) {
    const line = doc.line(n);
    let a = Math.max(from, line.from);
    let b = Math.min(to, line.to);
    const text = doc.sliceString(a, b);
    const lead = text.length - text.replace(/^\s+/, "").length;
    const trail = text.length - text.replace(/\s+$/, "").length;
    a += lead;
    b -= trail;
    if (b > a) out.push({ from: a, to: b });
  }
  return out;
}

/** Toggle one wrapping format over the current selection. Returns false when
 *  it declines (never, today — kept so it reads as a CodeMirror Command). */
export function toggleWrap(view: EditorView, wrap: Wrap): boolean {
  const state = view.state;
  const doc = state.doc;
  const changes: ChangeSpec[] = [];
  // Where the selection should end up, expressed in PRE-change coordinates and
  // mapped through the ChangeSet once it exists.
  const anchors: { from: number; to: number; wrapped: boolean }[] = [];

  for (const range of state.selection.ranges) {
    if (range.empty) {
      const line = doc.lineAt(range.head);
      const found = enclosingSpan(
        line.text,
        line.from,
        range.head,
        range.head,
        wrap,
      );
      if (found) {
        changes.push(...unwrapChanges(found.from, found.to, wrap));
        anchors.push({ from: range.head, to: range.head, wrapped: false });
      } else {
        changes.push({ from: range.head, insert: wrap.open + wrap.close });
        anchors.push({ from: range.head, to: range.head, wrapped: true });
      }
      continue;
    }

    const targets = perLineTargets(view, range.from, range.to);
    if (targets.length === 0) continue;
    // All already formatted → this is the second press; take them all off.
    const found = targets.map((tgt) => {
      const line = doc.lineAt(tgt.from);
      return enclosingSpan(line.text, line.from, tgt.from, tgt.to, wrap);
    });
    const allWrapped = found.every((f) => f !== null);
    if (allWrapped) {
      for (const f of found) changes.push(...unwrapChanges(f!.from, f!.to, wrap));
      anchors.push({
        from: found[0]!.from,
        to: found[found.length - 1]!.to,
        wrapped: false,
      });
    } else {
      for (const tgt of targets) {
        changes.push({ from: tgt.from, insert: wrap.open });
        changes.push({ from: tgt.to, insert: wrap.close });
      }
      anchors.push({
        from: targets[0].from,
        to: targets[targets.length - 1].to,
        wrapped: true,
      });
    }
  }

  if (changes.length === 0) return false;
  const set = ChangeSet.of(changes, doc.length);
  const ranges = anchors.map((a) => {
    if (a.from === a.to) {
      // Empty selection: park the caret INSIDE the pair just inserted, or
      // where the removed pair used to hold it.
      const pos = set.mapPos(a.from, a.wrapped ? -1 : 1);
      return EditorSelection.cursor(a.wrapped ? pos + wrap.open.length : pos);
    }
    return EditorSelection.range(set.mapPos(a.from, 1), set.mapPos(a.to, -1));
  });
  view.dispatch({
    changes: set,
    selection: EditorSelection.create(ranges),
    userEvent: "input.format",
    scrollIntoView: true,
  });
  return true;
}

/** Wrap the selection in a colored span, replacing any color already on it.
 *  `null` means "remove color" — the same command, run backwards. */
export function applyColor(view: EditorView, value: string | null): boolean {
  const state = view.state;
  const doc = state.doc;
  const bare = colorSpan("");
  const changes: ChangeSpec[] = [];
  for (const range of state.selection.ranges) {
    const line = doc.lineAt(range.from);
    const found = enclosingSpan(line.text, line.from, range.from, range.to, bare);
    if (found) {
      const open = bare.openRe!.exec(doc.sliceString(found.from, found.to));
      const openTo = found.from + (open ? open[0].length : 0);
      if (value === null) {
        changes.push({ from: found.from, to: openTo });
        changes.push({ from: found.to - "</span>".length, to: found.to });
      } else {
        changes.push({ from: found.from, to: openTo, insert: colorSpan(value).open });
      }
      continue;
    }
    if (value === null || range.empty) continue;
    changes.push({ from: range.from, insert: colorSpan(value).open });
    changes.push({ from: range.to, insert: "</span>" });
  }
  if (changes.length === 0) return false;
  const set = ChangeSet.of(changes, doc.length);
  view.dispatch({
    changes: set,
    selection: EditorSelection.create(
      state.selection.ranges.map((r) =>
        EditorSelection.range(set.mapPos(r.from, 1), set.mapPos(r.to, -1)),
      ),
      state.selection.mainIndex,
    ),
    userEvent: "input.format",
    scrollIntoView: true,
  });
  return true;
}

// ── Line-level structure ────────────────────────────────────────────────────

/** Prefixes that are alternatives to one another: applying `## ` to a line
 *  that already carries `# ` REPLACES it rather than stacking, and applying
 *  the same one again takes it off. Ordered families, because `- [ ] ` has to
 *  be recognised before `- `. */
const PREFIX_FAMILIES: RegExp[] = [
  /^(#{1,6} )/,
  /^(- \[[ xX]\] )/,
  /^(- |\* |\+ )/,
  /^(\d+\. )/,
  /^(> )/,
];

/** Toggle a line prefix over every line the selection touches. `1. ` numbers
 *  itself from 1 down the block, because a list of five `1.` lines is a list
 *  markdown renumbers for you but the author cannot read. */
export function toggleLinePrefix(view: EditorView, prefix: string): boolean {
  const state = view.state;
  const doc = state.doc;
  const changes: ChangeSpec[] = [];
  const numbered = /^\d+\. $/.test(prefix);
  for (const range of state.selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    // Off only when EVERY non-blank line already carries it — the same
    // "second press removes" rule the wrapping formats use.
    let all = true;
    for (let n = first; n <= last; n++) {
      const text = doc.line(n).text;
      if (text.trim() === "") continue;
      const has = numbered ? /^\d+\. /.test(text) : text.startsWith(prefix);
      if (!has) all = false;
    }
    let index = 1;
    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      if (line.text.trim() === "") continue;
      const existing = PREFIX_FAMILIES.map((re) => re.exec(line.text)).find(
        (m) => m !== null,
      );
      const cut = existing ? existing[1].length : 0;
      const insert = all ? "" : numbered ? `${index++}. ` : prefix;
      if (cut === 0 && insert === "") continue;
      changes.push({ from: line.from, to: line.from + cut, insert });
    }
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: "input.format", scrollIntoView: true });
  return true;
}

// ── Line-level structure, LaTeX ─────────────────────────────────────────────
//
// A markdown heading is a PREFIX and a LaTeX one is a CALL, so the two cannot
// share `toggleLinePrefix`: `## Introduction` and `\subsection{Introduction}`
// put the text in different places. The family rule survives the translation
// unchanged — applying \subsection to a \section line REPLACES it rather than
// nesting one inside the other — and so does "applying twice removes".

const TEX_SECTIONS = [
  "part", "chapter", "section", "subsection", "subsubsection",
  "paragraph", "subparagraph",
];
/** `\section{Title}` (or any of its family) occupying a whole line, plus
 *  whatever trails it — almost always the `\label` the author put there, which
 *  must survive a re-level. */
const TEX_SECTION_LINE = new RegExp(
  `^(\\s*)\\\\(${TEX_SECTIONS.join("|")})\\*?\\{((?:[^{}]|\\{[^{}]*\\})*)\\}(.*)$`,
);

/** Toggle `\<macro>{…}` over every line the selection touches. */
export function toggleTexSection(view: EditorView, macro: string): boolean {
  const { state } = view;
  const doc = state.doc;
  const changes: ChangeSpec[] = [];
  for (const range of state.selection.ranges) {
    const first = doc.lineAt(range.from).number;
    const last = doc.lineAt(range.to).number;
    // Off only when EVERY non-blank line already carries THIS macro — the same
    // "second press removes" rule the wrapping formats use.
    let all = true;
    for (let n = first; n <= last; n++) {
      const m = TEX_SECTION_LINE.exec(doc.line(n).text);
      if (doc.line(n).text.trim() === "") continue;
      if (!m || m[2] !== macro) all = false;
    }
    for (let n = first; n <= last; n++) {
      const line = doc.line(n);
      if (line.text.trim() === "") continue;
      const m = TEX_SECTION_LINE.exec(line.text);
      const indent = m ? m[1] : line.text.match(/^\s*/)![0];
      const body = m ? m[3] : line.text.trim();
      const trail = m ? m[4] : "";
      const insert = all ? `${indent}${body}${trail}` : `${indent}\\${macro}{${body}}${trail}`;
      if (insert === line.text) continue;
      changes.push({ from: line.from, to: line.to, insert });
    }
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: "input.format", scrollIntoView: true });
  return true;
}

/** Toggle a LaTeX environment around the selected lines — `itemize`,
 *  `enumerate`, `quote`. `item` is true for the two list environments, whose
 *  lines each need their own `\item`; a `quote` is prose and takes none.
 *
 *  The "second press removes" test looks at the lines JUST OUTSIDE the
 *  selection, because that is where `\begin`/`\end` end up after the first
 *  press: a reader who selects the same three lines again means "undo that". */
export function toggleTexEnv(view: EditorView, env: string, item: boolean): boolean {
  const { state } = view;
  const doc = state.doc;
  const range = state.selection.main;
  let first = doc.lineAt(range.from).number;
  let last = doc.lineAt(range.to).number;
  while (first < last && doc.line(first).text.trim() === "") first++;
  while (last > first && doc.line(last).text.trim() === "") last--;
  const opener = `\\begin{${env}}`;
  const closer = `\\end{${env}}`;
  const before = first > 1 ? doc.line(first - 1).text.trim() : "";
  const after = last < doc.lines ? doc.line(last + 1).text.trim() : "";
  const changes: ChangeSpec[] = [];

  if (before === opener && after === closer) {
    // Take it off, `\item` markers included.
    const open = doc.line(first - 1);
    const close = doc.line(last + 1);
    changes.push({ from: open.from, to: Math.min(open.to + 1, doc.length) });
    if (item) {
      for (let n = first; n <= last; n++) {
        const line = doc.line(n);
        const m = /^(\s*)\\item\s?/.exec(line.text);
        if (m) changes.push({ from: line.from + m[1].length, to: line.from + m[0].length });
      }
    }
    changes.push({ from: Math.max(close.from - 1, 0), to: close.to });
  } else {
    changes.push({ from: doc.line(first).from, insert: `${opener}\n` });
    if (item) {
      for (let n = first; n <= last; n++) {
        const line = doc.line(n);
        if (line.text.trim() === "" || /^\s*\\item\b/.test(line.text)) continue;
        const lead = line.text.match(/^\s*/)![0].length;
        changes.push({ from: line.from + lead, insert: "\\item " });
      }
    }
    changes.push({ from: doc.line(last).to, insert: `\n${closer}` });
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: "input.format", scrollIntoView: true });
  return true;
}

/** Wrap the selection in a pair that is not a toggle — `[[…]]`, `$…$`, a
 *  fenced block. Empty selection puts the caret between the two halves. */
export function insertPair(
  view: EditorView,
  open: string,
  close: string,
): boolean {
  const state = view.state;
  view.dispatch(
    state.changeByRange((range) => ({
      changes: [
        { from: range.from, insert: open },
        { from: range.to, insert: close },
      ],
      range: EditorSelection.range(
        range.from + open.length,
        range.to + open.length,
      ),
    })),
    { userEvent: "input.format", scrollIntoView: true },
  );
  return true;
}

/** The command behind one kind, in whatever language the open note is written
 *  in. It DECLINES (false) when the note's language has no honest spelling for
 *  that kind, which is what lets Ctrl/Cmd+Shift+X fall through in a `.tex`
 *  note instead of writing `~~…~~` into a document that cannot read it. */
export function format(kind: FormatKind): (view: EditorView) => boolean {
  return (view) => {
    const wrap = wrapFor(syntaxOf(view.state), kind);
    return wrap ? toggleWrap(view, wrap) : false;
  };
}

/** The bindings, and where each number came from.
 *
 *  Bold `Mod-b` and italic `Mod-i` are Obsidian's (and every word processor's).
 *  Underline `Mod-u` is the word processor's — Obsidian has no underline
 *  command at all, because markdown has no underline; ours emits `<u>`, which
 *  the sanitizer already admitted and the reading view already rendered.
 *  Strikethrough `Mod-Shift-x` and highlight `Mod-Shift-h` are Obsidian's
 *  defaults, checked against its published shortcut tables rather than
 *  guessed. Inline code has no Obsidian default and gets none here; it lives
 *  in the selection menu.
 *
 *  `Mod-b` USED TO FOLD THE NOTES SIDEBAR. Formatting wins inside the editor —
 *  it is the binding every reader arrives with — and the two pane toggles moved
 *  one modifier out, to `Mod-Alt-b` / `Mod-Alt-Shift-b` (App.tsx), keeping the
 *  shape they had: one key, Shift picks the second pane. The status-bar
 *  tooltips, the palette rows and the Ctrl/Cmd+/ sheet all say the new numbers.
 *
 *  Prec.high so these beat `defaultKeymap`, but BELOW the vim compartment,
 *  which is first in the extension list: vim's Ctrl+B is page-up and stays
 *  page-up, exactly as the shell handler already promised.
 *
 *  The same five keys are bound in a `.tex` note and three of them are live
 *  there (`\textbf`, `\emph`, `\underline`); the other two decline, because
 *  LaTeX has no strikethrough or highlight this reader can render. Declining
 *  is deliberate and is not the same as being unbound: `preventDefault: true`
 *  still keeps Ctrl/Cmd+Shift+H off the browser's history sidebar. */
/** A COMMENT — text that stays in the note and reaches no reader.
 *
 *  Not a `FormatKind`, because the two languages do not merely spell it
 *  differently, they SHAPE it differently: markdown's `%%…%%` wraps a span,
 *  LaTeX's `%` prefixes a line. So this is the one command that branches on
 *  `syntaxOf` itself rather than looking a spelling up in `WRAPS`.
 *
 *  It exists because the editor had no way to write either. `defaultKeymap`
 *  binds `Mod-/` to CodeMirror's `toggleComment`, which reads lang-markdown's
 *  `commentTokens` and would write `<!-- -->` — HTML that this product's live
 *  preview does not hide and its reading view renders as nothing, which is a
 *  different thing from a comment. That binding has never fired: `App.tsx`
 *  claims `Ctrl/Cmd+/` for the shortcut sheet in the capture phase, so the
 *  wrong implementation was unreachable rather than wrong-on-screen. The key
 *  here is `Mod-Alt-/`, following the Alt convention the pane toggles and the
 *  daily note already moved to. */
export function toggleComment(view: EditorView): boolean {
  if (syntaxOf(view.state) === "latex") return toggleLinePrefix(view, "% ");
  return toggleWrap(view, {
    open: "%%",
    close: "%%",
    // Single-line by construction: `livePreview.ts`'s COMMENT_RE is
    // `/%%([^%\n]*?)%%/g`, so a comment that spans a newline is not one this
    // product hides. Matching what the renderer matches is the whole contract.
    span: /%%[^%\n]*?%%/g,
  });
}

export const formatKeymap: Extension = Prec.high(
  keymap.of([
    { key: "Mod-Alt-/", run: toggleComment, preventDefault: true },
    { key: "Mod-b", run: format("bold"), preventDefault: true },
    { key: "Mod-i", run: format("italic"), preventDefault: true },
    { key: "Mod-u", run: format("underline"), preventDefault: true },
    { key: "Mod-Shift-x", run: format("strikethrough"), preventDefault: true },
    { key: "Mod-Shift-h", run: format("highlight"), preventDefault: true },
  ]),
);
