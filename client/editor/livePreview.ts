// Obsidian-style live preview. A ViewPlugin walks the markdown syntax tree
// over the visible ranges and builds two kinds of decoration:
//
//   - Decoration.replace to hide formatting marks (#, **, `, >, brackets…)
//     on every line the cursor is NOT on, so text reads as rendered prose;
//   - Decoration.mark / Decoration.line / widgets to style headings, emphasis,
//     code, blockquotes, bullets, task checkboxes, wikilinks, tags and urls.
//
// Round B2 adds: image/file/note embeds (widgets.ts), callouts (callouts.ts),
// KaTeX math (math.ts), ==highlights==, %%comments%%, footnotes, and the
// clickable frontmatter properties card. Block-level widgets (frontmatter
// card, hidden fence lines, $$ math, folded callout bodies) live in a
// StateField because block decorations can't come from a ViewPlugin.
//
// Class names (cm-s-*) are styled in theme.ts and styles/preview.css using
// the CSS token vars.

import "../styles/preview.css";
import { Facet, RangeSet, StateField, Transaction, type Range } from "@codemirror/state";
import type { EditorState, Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { parseWikilink, resolveLink, WIKILINK_RE } from "./links.ts";
import { bannerFromYaml } from "../banner.ts";
import { getLang, t, tf } from "../i18n.ts";
import { buildBannerEl, buildPropsCard, parseProps, TAG_RE } from "./noteMeta.ts";
import {
  FileCardWidget,
  ImageWidget,
  TransclusionWidget,
  parseEmbed,
  resolveRelative,
} from "./widgets.ts";
import {
  calloutFoldDecos,
  calloutFoldField,
  calloutLineDecos,
  findCallouts,
} from "./callouts.ts";
import { blockMathDecos, inlineMathDecos } from "./math.ts";
import { sanitizeHtml } from "../reading/rawHtml.ts";

/** Vault path of the note this editor shows (embeds resolve against it). */
export const notePathFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? "",
});

// ── Widgets ─────────────────────────────────────────────────────────────────

class BulletWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-s-bullet";
    span.textContent = "•";
    return span;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  override eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked;
  }
  toDOM(): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "cm-s-task";
    input.checked = this.checked;
    return input;
  }
  override ignoreEvent(): boolean {
    return false; // let our mousedown handler toggle the underlying text
  }
}

const bulletWidget = new BulletWidget();

/** "›" between note and heading in a rendered [[Note#Heading]] (the reading
 *  view shows the same separator). */
class LinkSepWidget extends WidgetType {
  override eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-s-wikilink-sep";
    span.textContent = "›";
    span.setAttribute("aria-hidden", "true");
    return span;
  }
}

const linkSepWidget = new LinkSepWidget();

// ── Helpers ─────────────────────────────────────────────────────────────────

const HEADING_CLASS: Record<string, string> = {
  ATXHeading1: "cm-s-h1",
  ATXHeading2: "cm-s-h2",
  ATXHeading3: "cm-s-h3",
  ATXHeading4: "cm-s-h4",
  ATXHeading5: "cm-s-h5",
  ATXHeading6: "cm-s-h6",
  SetextHeading1: "cm-s-h1",
  SetextHeading2: "cm-s-h2",
};

// TAG_RE / parseProps live in noteMeta.ts (pure, shared with the reading
// view without pulling the CodeMirror bundle); re-exported for compatibility.
export { TAG_RE, parseProps };
const EMBED_RE = /!\[\[([^[\]]+?)\]\]/g;
const COMMENT_RE = /%%([^%\n]*?)%%/g;
const HIGHLIGHT_RE = /==([^=\n]+?)==/g;
const FOOTNOTE_RE = /\[\^([^\]\s]+)\]/g;

/** Line numbers currently touched by any selection range. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const range of state.selection.ranges) {
    const from = state.doc.lineAt(range.from).number;
    const to = state.doc.lineAt(range.to).number;
    for (let n = from; n <= to; n++) lines.add(n);
  }
  return lines;
}

interface Span {
  from: number;
  to: number;
}

function overlaps(spans: Span[], from: number, to: number): boolean {
  return spans.some((s) => from < s.to && to > s.from);
}

// ── Decoration builder ──────────────────────────────────────────────────────

/** End offset of a YAML frontmatter block opened on line 1, or -1. */
function frontmatterEnd(doc: EditorState["doc"]): number {
  if (doc.lines < 2 || doc.line(1).text.trim() !== "---") return -1;
  const scanTo = Math.min(doc.lines, 60);
  for (let n = 2; n <= scanTo; n++) {
    const text = doc.line(n).text.trim();
    if (text === "---" || text === "...") return doc.line(n).to;
  }
  return -1;
}

function buildDecorations(view: EditorView, revealActive: boolean): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  // Until the user actually interacts (click/keystroke), no line is treated
  // as "active": a freshly opened note renders fully pretty instead of
  // revealing raw markdown on whatever line the initial cursor landed on.
  const active = revealActive ? activeLines(state) : new Set<number>();
  const decos: Range<Decoration>[] = [];
  const codeSpans: Span[] = []; // code regions to exclude from inline scans
  const claimed: Span[] = []; // ranges owned by embeds/math/comments/callouts
  const tree = useStore.getState().tree;
  const notePath = state.facet(notePathFacet);

  const isActiveAt = (pos: number): boolean =>
    active.has(doc.lineAt(pos).number);
  const blocked = (from: number, to: number): boolean =>
    overlaps(codeSpans, from, to) || overlaps(claimed, from, to);

  // YAML frontmatter reads as a quiet mono block, not as markdown.
  const fmEnd = frontmatterEnd(doc);
  let fmLastLine = 0;
  if (fmEnd > 0) {
    fmLastLine = doc.lineAt(fmEnd).number;
    for (let n = 1; n <= fmLastLine; n++) {
      decos.push(
        Decoration.line({ class: "cm-s-frontmatter" }).range(doc.line(n).from),
      );
    }
  }

  /** Hide [from, to), optionally swallowing one trailing space. */
  const hide = (from: number, to: number, eatSpace = false): void => {
    let end = to;
    if (eatSpace && end < doc.length && doc.sliceString(end, end + 1) === " ") {
      end++;
    }
    if (end > from) decos.push(Decoration.replace({}).range(from, end));
  };

  const mark = (from: number, to: number, cls: string): void => {
    if (to > from) {
      decos.push(Decoration.mark({ class: cls }).range(from, to));
    }
  };

  const lineClass = (from: number, to: number, cls: string): void => {
    const first = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (let n = first; n <= last; n++) {
      decos.push(Decoration.line({ class: cls }).range(doc.line(n).from));
    }
  };

  // Callouts: line tinting + title-bar widgets. Their blockquotes are tracked
  // so the generic Blockquote/quote styling skips them.
  const calloutStarts = new Set<number>();
  // Title-bar text ranges replaced by the title widget: syntax-tree styling
  // must skip nodes inside them ("[!type]" parses as a shortcut Link whose
  // LinkMark hide would start exactly where the widget starts — that
  // same-start conflict can drop the widget on incremental redraws).
  const titleSpans: Span[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (const c of findCallouts(state, from, to)) {
      calloutStarts.add(c.from);
      if (!active.has(doc.lineAt(c.titleLineFrom).number)) {
        titleSpans.push({ from: c.contentFrom, to: c.titleLineTo });
      }
    }
  }
  for (const span of calloutLineDecos(state, view.visibleRanges, active, decos)) {
    claimed.push(span);
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

        // Suppress markdown styling inside the frontmatter block.
        if (fmEnd > 0 && node.to <= fmEnd && node.from >= 0 && node.to > node.from) {
          return false;
        }

        // Nodes fully inside a callout title bar: the title widget owns them.
        if (
          titleSpans.some((s) => node.from >= s.from && node.to <= s.to) &&
          node.to > node.from
        ) {
          return false;
        }

        const headingClass = HEADING_CLASS[name];
        if (headingClass) {
          decos.push(
            Decoration.line({ class: headingClass }).range(
              doc.lineAt(node.from).from,
            ),
          );
          return;
        }

        switch (name) {
          case "HeaderMark":
            if (!isActiveAt(node.from)) hide(node.from, node.to, true);
            else mark(node.from, node.to, "cm-s-syntax");
            return;

          case "StrongEmphasis":
            mark(node.from, node.to, "cm-s-strong");
            return;
          case "Emphasis":
            mark(node.from, node.to, "cm-s-em");
            return;
          case "Strikethrough":
            mark(node.from, node.to, "cm-s-strike");
            return;
          case "EmphasisMark":
          case "StrikethroughMark":
            if (!isActiveAt(node.from)) hide(node.from, node.to);
            else mark(node.from, node.to, "cm-s-syntax");
            return;

          case "InlineCode":
            mark(node.from, node.to, "cm-s-inline-code");
            codeSpans.push({ from: node.from, to: node.to });
            return;
          case "CodeMark":
            // Hide only inline-code backticks; keep fence marks visible.
            if (
              node.node.parent?.name === "InlineCode" &&
              !isActiveAt(node.from)
            ) {
              hide(node.from, node.to);
            }
            return;
          case "FencedCode":
          case "CodeBlock":
            lineClass(node.from, node.to, "cm-s-codeblock");
            codeSpans.push({ from: node.from, to: node.to });
            return;

          case "Blockquote":
            if (calloutStarts.has(node.from)) return; // callouts style themselves
            lineClass(node.from, node.to, "cm-s-quote");
            return;
          case "QuoteMark":
            if (!isActiveAt(node.from)) hide(node.from, node.to, true);
            else mark(node.from, node.to, "cm-s-syntax");
            return;

          case "HorizontalRule":
            decos.push(
              Decoration.line({ class: "cm-s-hr" }).range(
                doc.lineAt(node.from).from,
              ),
            );
            return;

          case "ListMark": {
            if (isActiveAt(node.from)) return;
            const text = doc.sliceString(node.from, node.to);
            const isTaskItem =
              node.node.parent?.getChild("Task") != null ||
              node.node.parent?.getChild("TaskMarker") != null;
            if (isTaskItem) {
              hide(node.from, node.to, true); // checkbox widget stands alone
            } else if (text === "-" || text === "*" || text === "+") {
              decos.push(
                Decoration.replace({ widget: bulletWidget }).range(
                  node.from,
                  node.to,
                ),
              );
            }
            return;
          }

          case "TaskMarker": {
            const checked = /x/i.test(doc.sliceString(node.from, node.to));
            if (!isActiveAt(node.from)) {
              decos.push(
                Decoration.replace({
                  widget: new CheckboxWidget(checked),
                }).range(node.from, node.to),
              );
            }
            if (checked) {
              const line = doc.lineAt(node.from);
              mark(Math.min(node.to + 1, line.to), line.to, "cm-s-task-done");
            }
            return;
          }

          case "Image": {
            const text = doc.sliceString(node.from, node.to);
            if (text.startsWith("![[")) return false; // ![[embed]] scan owns it
            const m = /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)$/.exec(text);
            if (m) {
              claimed.push({ from: node.from, to: node.to });
              if (!isActiveAt(node.from)) {
                const src = resolveRelative(m[2], notePath);
                decos.push(
                  Decoration.replace({
                    widget: new ImageWidget(m[1] || m[2], src, null),
                  }).range(node.from, node.to),
                );
                return false;
              }
              mark(node.from, node.to, "cm-s-embed-src");
            }
            return;
          }

          case "Link": {
            // [[Wikilink]] inner [text] parses as a shortcut Link — the
            // wikilink scan below owns its styling; skip the link mark.
            const before = doc.sliceString(Math.max(0, node.from - 1), node.from);
            const after = doc.sliceString(node.to, node.to + 1);
            if (before === "[" && after === "]") return;
            // Footnote refs [^1] parse as shortcut links; the footnote scan
            // owns them.
            if (doc.sliceString(node.from, node.from + 2) === "[^") return false;
            mark(node.from, node.to, "cm-s-link");
            return;
          }
          case "Autolink":
            mark(node.from, node.to, "cm-s-url");
            return;
          case "LinkMark":
            if (!isActiveAt(node.from)) hide(node.from, node.to);
            return;
          case "URL": {
            const parent = node.node.parent?.name;
            if (parent === "Link" && !isActiveAt(node.from)) {
              hide(node.from, node.to);
            }
            return;
          }
          case "LinkTitle":
            if (!isActiveAt(node.from)) hide(node.from, node.to);
            return;

          default:
            return;
        }
      },
    });
  }

  // Inline features that are not markdown syntax nodes — scan visible lines.
  // Order matters: each family claims its ranges so later scans skip them.
  // Code regions are excluded per match (not per line), so a wikilink still
  // renders on a line that also carries inline code.
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      pos = line.to + 1;
      if (line.number <= fmLastLine) continue; // frontmatter is not markdown
      const lineIsActive = active.has(line.number);
      const text = line.text;

      // %%comments%% — hidden entirely off the cursor, faint ink on it.
      COMMENT_RE.lastIndex = 0;
      for (let m = COMMENT_RE.exec(text); m; m = COMMENT_RE.exec(text)) {
        const start = line.from + m.index;
        const end = start + m[0].length;
        if (blocked(start, end)) continue;
        if (lineIsActive) mark(start, end, "cm-s-comment");
        else hide(start, end);
        claimed.push({ from: start, to: end });
      }

      // ![[embeds]] — images, attachment cards, note transclusions.
      EMBED_RE.lastIndex = 0;
      for (let m = EMBED_RE.exec(text); m; m = EMBED_RE.exec(text)) {
        const start = line.from + m.index;
        const end = start + m[0].length;
        if (blocked(start, end)) continue;
        claimed.push({ from: start, to: end });
        const embed = parseEmbed(m[1]);
        if (lineIsActive) {
          mark(start, end, "cm-s-embed-src");
          continue;
        }
        let widget: WidgetType;
        if (embed.kind === "image") {
          widget = new ImageWidget(embed.target, null, embed.width);
        } else if (embed.kind === "file") {
          widget = new FileCardWidget(embed.target);
        } else {
          widget = new TransclusionWidget(
            embed.target,
            resolveLink(embed.target, tree),
            notePath,
          );
        }
        decos.push(Decoration.replace({ widget }).range(start, end));
      }

      // $inline$ math (KaTeX).
      for (const span of inlineMathDecos(
        text,
        line.from,
        lineIsActive,
        blocked,
        decos,
      )) {
        claimed.push(span);
      }

      // [[wikilinks]]
      WIKILINK_RE.lastIndex = 0;
      for (let m = WIKILINK_RE.exec(text); m; m = WIKILINK_RE.exec(text)) {
        if (m.index > 0 && text[m.index - 1] === "!") continue; // embed
        const start = line.from + m.index;
        const end = start + m[0].length;
        if (blocked(start, end)) continue;
        const inner = m[1];
        const { target, heading, alias } = parseWikilink(inner);
        const linkClass =
          resolveLink(target, tree) !== null
            ? "cm-s-wikilink"
            : "cm-s-wikilink cm-s-wikilink--broken";
        if (lineIsActive) {
          mark(start, end, linkClass);
          continue;
        }
        const innerFrom = start + 2;
        const innerTo = end - 2;
        hide(start, innerFrom); // [[
        if (alias !== null) {
          const pipe = inner.indexOf("|");
          hide(innerFrom, innerFrom + pipe + 1); // target + |
          mark(innerFrom + pipe + 1, innerTo, linkClass);
        } else if (heading !== null && inner.indexOf("#") > 0) {
          // [[Note#Heading]] reads as "Note › Heading", like the reading view.
          const hashPos = innerFrom + inner.indexOf("#");
          mark(innerFrom, hashPos, linkClass);
          decos.push(
            Decoration.replace({ widget: linkSepWidget }).range(
              hashPos,
              hashPos + 1,
            ),
          );
          mark(hashPos + 1, innerTo, linkClass);
        } else {
          mark(innerFrom, innerTo, linkClass);
        }
        hide(innerTo, end); // ]]
      }

      // ==highlights==
      HIGHLIGHT_RE.lastIndex = 0;
      for (let m = HIGHLIGHT_RE.exec(text); m; m = HIGHLIGHT_RE.exec(text)) {
        const start = line.from + m.index;
        const end = start + m[0].length;
        if (blocked(start, end)) continue;
        if (lineIsActive) {
          mark(start, start + 2, "cm-s-syntax");
          mark(start + 2, end - 2, "cm-s-highlight");
          mark(end - 2, end, "cm-s-syntax");
        } else {
          hide(start, start + 2);
          mark(start + 2, end - 2, "cm-s-highlight");
          hide(end - 2, end);
        }
        claimed.push({ from: start, to: end });
      }

      // Footnotes: [^1] refs render superscript; [^1]: definitions read faint.
      FOOTNOTE_RE.lastIndex = 0;
      for (let m = FOOTNOTE_RE.exec(text); m; m = FOOTNOTE_RE.exec(text)) {
        const start = line.from + m.index;
        const end = start + m[0].length;
        if (blocked(start, end)) continue;
        const isDef = m.index === 0 && text[m[0].length] === ":";
        if (isDef) {
          mark(start, end + 1, "cm-s-footnote-def");
        } else if (lineIsActive) {
          mark(start, end, "cm-s-footnote cm-s-footnote--src");
        } else {
          hide(start, start + 2); // [^
          mark(start + 2, end - 1, "cm-s-footnote");
          hide(end - 1, end); // ]
        }
        claimed.push({ from: start, to: end });
      }

      // #tags
      TAG_RE.lastIndex = 0;
      for (let m = TAG_RE.exec(text); m; m = TAG_RE.exec(text)) {
        const start = line.from + m.index + m[1].length;
        const end = start + 1 + m[2].length;
        if (!blocked(start, end)) mark(start, end, "cm-s-tag");
      }
    }
  }

  return RangeSet.of(decos, true);
}

// ── Click handling ──────────────────────────────────────────────────────────

function toggleTask(view: EditorView, pos: number): boolean {
  const text = view.state.sliceDoc(pos, pos + 3);
  if (!/^\[[ xX]\]$/.test(text)) return false;
  view.dispatch({
    changes: { from: pos, to: pos + 3, insert: text[1] === " " ? "[x]" : "[ ]" },
  });
  return true;
}

function openWikilink(inner: string): void {
  const { target, heading } = parseWikilink(inner);
  const store = useStore.getState();

  // [[#Heading]] — scroll within the note that's already open.
  if (!target && heading) {
    window.dispatchEvent(
      new CustomEvent("vellum:goto-heading", { detail: { text: heading } }),
    );
    return;
  }

  const resolved = resolveLink(target, store.tree);
  if (resolved) {
    if (heading) store.setPendingHeading(heading);
    store.openNote(resolved);
    return;
  }

  // Unresolved link: clicking it creates the note (Obsidian behavior).
  // Admin only — visitors never mount the editor, but stay safe regardless.
  if (!store.admin) {
    toast(tf("linkMissing", { name: target }));
    return;
  }
  const path = /\.md$/i.test(target) ? target : `${target}.md`;
  toast(tf("creatingNote", { name: target }));
  void store.createNote(path);
}

/** Find an http(s) url in the syntax tree at pos (URL / Autolink / Link). */
function urlAt(state: EditorState, pos: number): string | null {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
    node;
    node = node.parent
  ) {
    let urlNode: SyntaxNode | null = null;
    if (node.name === "URL") urlNode = node;
    else if (node.name === "Autolink" || node.name === "Link") {
      urlNode = node.getChild("URL");
    }
    if (urlNode) {
      const url = state
        .sliceDoc(urlNode.from, urlNode.to)
        .replace(/^<|>$/g, "");
      return /^https?:\/\//.test(url) ? url : null;
    }
  }
  return null;
}

/** Jump to the `[^label]:` definition line for a footnote label. */
function jumpToFootnoteDef(view: EditorView, label: string): boolean {
  const needle = `[^${label}]:`;
  const doc = view.state.doc;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.text.startsWith(needle)) {
      view.dispatch({
        selection: { anchor: line.from + needle.length },
        scrollIntoView: true,
      });
      return true;
    }
  }
  return false;
}

/** Document position under the pointer. `posAtCoords` maps through the
 *  vertical line layout, which can drift by whole lines in scrolled notes
 *  containing block widgets (math, frontmatter card, images) — so a click on
 *  a wikilink would resolve to a neighboring line and the link would never
 *  open. Deriving the position from the DOM node actually under the pointer
 *  (caretPositionFromPoint → posAtDOM) is exact; posAtCoords stays only as
 *  the last-resort fallback. */
function posFromEvent(event: MouseEvent, view: EditorView): number | null {
  const doc = view.contentDOM.ownerDocument;
  const within = (node: Node | null | undefined): node is Node =>
    node != null && view.contentDOM.contains(node);

  if (typeof doc.caretPositionFromPoint === "function") {
    const caret = doc.caretPositionFromPoint(event.clientX, event.clientY);
    if (caret && within(caret.offsetNode)) {
      try {
        return view.posAtDOM(caret.offsetNode, caret.offset);
      } catch {
        /* fall through */
      }
    }
  }
  // WebKit spells it caretRangeFromPoint.
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(event.clientX, event.clientY);
    if (range && within(range.startContainer)) {
      try {
        return view.posAtDOM(range.startContainer, range.startOffset);
      } catch {
        /* fall through */
      }
    }
  }
  if (event.target instanceof Node && within(event.target)) {
    try {
      return view.posAtDOM(event.target);
    } catch {
      /* fall through */
    }
  }
  return view.posAtCoords({ x: event.clientX, y: event.clientY });
}

function handleMousedown(event: MouseEvent, view: EditorView): boolean {
  const target = event.target as HTMLElement;

  // Task checkbox widgets toggle the underlying "[ ]" / "[x]".
  if (
    target instanceof HTMLInputElement &&
    target.classList.contains("cm-s-task")
  ) {
    event.preventDefault();
    return toggleTask(view, view.posAtDOM(target));
  }

  if (event.button !== 0) return false;

  // #tag pills (inline or in the properties card) push a sidebar search.
  const tagEl = target.closest(".cm-s-tag, .cm-s-props__tag");
  if (tagEl?.textContent?.startsWith("#")) {
    event.preventDefault();
    window.dispatchEvent(
      new CustomEvent("vellum:search", { detail: tagEl.textContent }),
    );
    return true;
  }

  // The "Set banner…" header action opens the banner modal (App listens).
  if (target.closest(".cm-s-props__action")) {
    event.preventDefault();
    window.dispatchEvent(new CustomEvent("vellum:set-banner"));
    return true;
  }

  // Properties-card header expands/collapses the card (the widget's own
  // click handler does the toggle) — it must not drop the cursor into the
  // raw YAML the way clicks on the card body do. The banner hero above the
  // card is equally inert: clicking a hero image must not dump the cursor
  // into raw YAML.
  if (target.closest(".cm-s-props__head, .cm-s-banner")) {
    event.preventDefault();
    return true;
  }

  const pos = posFromEvent(event, view);
  if (pos == null) return false;

  const mod = event.metaKey || event.ctrlKey;
  const line = view.state.doc.lineAt(pos);
  const lineIsActive = activeLines(view.state).has(line.number);
  // Plain click follows links only where syntax is hidden (inactive lines);
  // on the active line a modifier is required so editing stays unobstructed.
  if (!mod && lineIsActive) return false;

  const text = line.text;

  WIKILINK_RE.lastIndex = 0;
  for (let m = WIKILINK_RE.exec(text); m; m = WIKILINK_RE.exec(text)) {
    if (m.index > 0 && text[m.index - 1] === "!") continue; // embeds handle themselves
    const start = line.from + m.index;
    const end = start + m[0].length;
    if (pos >= start && pos < end) {
      event.preventDefault();
      openWikilink(m[1]);
      return true;
    }
  }

  // Footnote superscripts jump to their definition.
  FOOTNOTE_RE.lastIndex = 0;
  for (let m = FOOTNOTE_RE.exec(text); m; m = FOOTNOTE_RE.exec(text)) {
    const start = line.from + m.index;
    const end = start + m[0].length;
    const isDef = m.index === 0 && text[m[0].length] === ":";
    if (!isDef && pos >= start && pos < end) {
      if (jumpToFootnoteDef(view, m[1])) {
        event.preventDefault();
        return true;
      }
      return false;
    }
  }

  const url = urlAt(view.state, pos);
  if (url) {
    event.preventDefault();
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }
  return false;
}

// ── Block-level hiding (StateField: block decorations can't come from a
//    ViewPlugin). Off the cursor: YAML frontmatter renders as a properties
//    card, code-fence marker lines (```lang / ```) disappear entirely,
//    $$ math renders as display widgets, and folded callout bodies hide. ──

class FrontmatterWidget extends WidgetType {
  // The properties card renders four t() strings ("Properties · N", the
  // toggle tooltip, the "Set banner…" action and its title). CM reuses a
  // widget's DOM whenever eq() says it is the same widget, so without the
  // language in the identity a live settings flip left an Arabic card sitting
  // above English editor chrome (and vice versa) until a full reload.
  readonly lang = getLang();
  constructor(readonly yaml: string) {
    super();
  }
  override eq(other: FrontmatterWidget): boolean {
    return other.yaml === this.yaml && other.lang === this.lang;
  }
  toDOM(): HTMLElement {
    // Header action: opens the banner modal (handled in the shell via a
    // window event — the editor chunk stays UI-framework-free here).
    const action = document.createElement("button");
    action.type = "button";
    action.className = "cm-s-props__action";
    action.dataset.action = "set-banner";
    action.textContent = t(bannerFromYaml(this.yaml) ? "bannerAction" : "setBannerAction");
    action.title = t("setBannerTitle");
    // Direct listener, like the tag pills: FrontmatterWidget keeps CM's
    // default ignoreEvent()=true, so the editor's mousedown handler never
    // sees clicks inside this widget — the button must dispatch itself.
    action.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      window.dispatchEvent(new CustomEvent("vellum:set-banner"));
    });
    const card = buildPropsCard(this.yaml, {
      prefix: "cm-s-props",
      action,
      makeTag: (value) => {
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = "cm-s-props__tag";
        pill.dataset.tag = value;
        pill.textContent = `#${value}`;
        pill.title = tf("searchTag", { tag: value });
        pill.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("vellum:search", { detail: `#${value}` }),
          );
        });
        return pill;
      },
    });
    // buildBlockDecorations only mounts the widget when parseProps found rows.
    if (!card) return document.createElement("div");
    // Banner hero above the card (subtle, rounded, capped height).
    const banner = bannerFromYaml(this.yaml);
    if (banner) {
      const wrap = document.createElement("div");
      wrap.className = "cm-s-fmblock";
      wrap.appendChild(buildBannerEl(banner, "cm-s-banner"));
      wrap.appendChild(card);
      return wrap;
    }
    return card;
  }
}

/** Rendered raw-HTML block (sanitized) shown while the cursor is outside it —
 *  Obsidian renders author HTML (<figure>, <svg>…) instead of tag soup. */
class HtmlBlockWidget extends WidgetType {
  constructor(readonly html: string) {
    super();
  }
  override eq(other: HtmlBlockWidget): boolean {
    return other.html === this.html;
  }
  toDOM(): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-s-htmlblock";
    box.appendChild(sanitizeHtml(this.html));
    return box;
  }
}

function buildBlockDecorations(state: EditorState): DecorationSet {
  const doc = state.doc;
  const active = activeLines(state);
  const decos: Range<Decoration>[] = [];

  const anyActiveBetween = (firstLine: number, lastLine: number): boolean => {
    for (let n = firstLine; n <= lastLine; n++) {
      if (active.has(n)) return true;
    }
    return false;
  };

  // Frontmatter → properties card while the cursor is outside it.
  const fmEnd = frontmatterEnd(doc);
  if (fmEnd > 0) {
    const lastLine = doc.lineAt(fmEnd).number;
    if (!anyActiveBetween(1, lastLine)) {
      const yaml =
        lastLine > 2
          ? doc.sliceString(doc.line(2).from, doc.line(lastLine - 1).to)
          : "";
      const spec =
        parseProps(yaml).length > 0
          ? { widget: new FrontmatterWidget(yaml), block: true }
          : { block: true };
      decos.push(Decoration.replace(spec).range(doc.line(1).from, fmEnd));
    }
  }

  // Code fences: hide the ``` marker lines while the cursor is outside.
  // Raw HTML blocks render as sanitized DOM widgets while the cursor is
  // outside (and as highlighted source while editing them).
  const fenceSpans: Span[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === "HTMLBlock") {
        const firstLine = doc.lineAt(node.from).number;
        const lastLine = doc.lineAt(node.to).number;
        if (!anyActiveBetween(firstLine, lastLine)) {
          decos.push(
            Decoration.replace({
              widget: new HtmlBlockWidget(
                doc.sliceString(doc.line(firstLine).from, doc.line(lastLine).to),
              ),
              block: true,
            }).range(doc.line(firstLine).from, doc.line(lastLine).to),
          );
        }
        return false;
      }
      if (node.name !== "FencedCode" && node.name !== "CodeBlock") {
        return undefined;
      }
      fenceSpans.push({ from: node.from, to: node.to });
      if (node.name !== "FencedCode") return false;
      const firstLine = doc.lineAt(node.from).number;
      const lastLine = doc.lineAt(node.to).number;
      if (anyActiveBetween(firstLine, lastLine)) return false;
      const open = doc.line(firstLine);
      if (/^\s*(```|~~~)/.test(open.text)) {
        decos.push(Decoration.replace({ block: true }).range(open.from, open.to));
      }
      const close = doc.line(lastLine);
      if (lastLine > firstLine && /^\s*(```|~~~)\s*$/.test(close.text)) {
        decos.push(Decoration.replace({ block: true }).range(close.from, close.to));
      }
      return false;
    },
  });

  // $$ display math (skipping fenced code).
  blockMathDecos(
    state,
    active,
    (pos) => overlaps(fenceSpans, pos, pos + 1),
    decos,
  );

  // Folded callout bodies (inline fold-style replaces).
  calloutFoldDecos(state, decos);

  return RangeSet.of(decos, true);
}

const blockHiding = StateField.define<DecorationSet>({
  create: buildBlockDecorations,
  update(deco, tr) {
    if (tr.docChanged || tr.selection || tr.effects.length > 0) {
      return buildBlockDecorations(tr.state);
    }
    return deco.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ── Plugin ──────────────────────────────────────────────────────────────────

class LivePreviewPlugin {
  decorations: DecorationSet;
  /** The user has touched the note (click/keystroke); before that, the
   *  cursor line is not revealed — see buildDecorations. */
  interacted = false;
  /** A rebuild was deferred because an IME composition was in progress. */
  pendingRebuild = false;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view, this.interacted);
  }

  update(update: ViewUpdate): void {
    const wasInteracted = this.interacted;
    if (
      !this.interacted &&
      (update.docChanged ||
        update.transactions.some(
          (tr) => tr.annotation(Transaction.userEvent) !== undefined,
        ))
    ) {
      this.interacted = true;
    }
    const needsRebuild =
      update.docChanged ||
      update.viewportChanged ||
      update.selectionSet ||
      this.interacted !== wasInteracted ||
      update.transactions.some((tr) => tr.effects.length > 0);
    if (needsRebuild || this.pendingRebuild) {
      if (update.view.composing) {
        // IME composition (Chinese/Japanese/Korean…) in progress: swapping
        // decorations under the composition point can cancel it mid-character.
        // Keep the old set mapped through the changes; rebuild on the update
        // that follows compositionend (see the event handler below).
        this.pendingRebuild = true;
        this.decorations = this.decorations.map(update.changes);
      } else {
        this.pendingRebuild = false;
        this.decorations = buildDecorations(update.view, this.interacted);
      }
    }
  }
}

export function livePreview(path: string): Extension {
  return [
    notePathFacet.of(path),
    calloutFoldField,
    blockHiding,
    ViewPlugin.fromClass(LivePreviewPlugin, {
      decorations: (plugin) => plugin.decorations,
      eventHandlers: {
        mousedown: handleMousedown,
        // Flush a rebuild deferred during IME composition. The empty dispatch
        // runs after the browser settles the composed text; update() then sees
        // composing === false and rebuilds from the final document.
        compositionend(_event, view) {
          window.setTimeout(() => {
            if (view.dom.isConnected) view.dispatch({});
          }, 0);
        },
      },
    }),
  ];
}
