// Obsidian-style live preview. A ViewPlugin walks the markdown syntax tree
// over the visible ranges and builds two kinds of decoration:
//
//   - Decoration.replace to hide formatting marks (#, **, `, >, brackets…)
//     on every line the cursor is NOT on, so text reads as rendered prose;
//   - Decoration.mark / Decoration.line / widgets to style headings, emphasis,
//     code, blockquotes, bullets, task checkboxes, wikilinks, tags and urls.
//
// Class names (cm-s-*) are styled in theme.ts using the CSS token vars.

import { RangeSet, type Range } from "@codemirror/state";
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

const TAG_RE = /(^|[\s([{])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

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

function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const active = activeLines(state);
  const decos: Range<Decoration>[] = [];
  const codeSpans: Span[] = []; // code regions to exclude from wikilink/tag scans

  const isActiveAt = (pos: number): boolean =>
    active.has(doc.lineAt(pos).number);

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

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

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
            lineClass(node.from, node.to, "cm-s-quote");
            return;
          case "QuoteMark":
            if (!isActiveAt(node.from)) hide(node.from, node.to, true);
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

          case "Link":
            mark(node.from, node.to, "cm-s-link");
            return;
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

  // Wikilinks and #tags are not markdown syntax nodes — scan visible lines.
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = doc.lineAt(pos);
      if (!overlaps(codeSpans, line.from, line.to)) {
        const lineIsActive = active.has(line.number);
        const text = line.text;

        WIKILINK_RE.lastIndex = 0;
        for (let m = WIKILINK_RE.exec(text); m; m = WIKILINK_RE.exec(text)) {
          const start = line.from + m.index;
          const end = start + m[0].length;
          if (overlaps(codeSpans, start, end)) continue;
          if (lineIsActive) {
            mark(start, end, "cm-s-wikilink");
            continue;
          }
          const inner = m[1];
          const { alias } = parseWikilink(inner);
          const innerFrom = start + 2;
          const innerTo = end - 2;
          hide(start, innerFrom); // [[
          if (alias !== null) {
            const pipe = inner.indexOf("|");
            hide(innerFrom, innerFrom + pipe + 1); // target + |
            mark(innerFrom + pipe + 1, innerTo, "cm-s-wikilink");
          } else {
            mark(innerFrom, innerTo, "cm-s-wikilink");
          }
          hide(innerTo, end); // ]]
        }

        TAG_RE.lastIndex = 0;
        for (let m = TAG_RE.exec(text); m; m = TAG_RE.exec(text)) {
          const start = line.from + m.index + m[1].length;
          const end = start + 1 + m[2].length;
          if (!overlaps(codeSpans, start, end)) mark(start, end, "cm-s-tag");
        }
      }
      pos = line.to + 1;
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

function openWikilink(target: string): void {
  const resolved = resolveLink(target, useStore.getState().tree);
  if (resolved) {
    useStore.getState().openNote(resolved);
  } else {
    toast(`No note named "${target}"`);
  }
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
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos == null) return false;

  const mod = event.metaKey || event.ctrlKey;
  const line = view.state.doc.lineAt(pos);
  const lineIsActive = activeLines(view.state).has(line.number);
  // Plain click follows links only where syntax is hidden (inactive lines);
  // on the active line a modifier is required so editing stays unobstructed.
  if (!mod && lineIsActive) return false;

  WIKILINK_RE.lastIndex = 0;
  const text = line.text;
  for (let m = WIKILINK_RE.exec(text); m; m = WIKILINK_RE.exec(text)) {
    const start = line.from + m.index;
    const end = start + m[0].length;
    if (pos >= start && pos < end) {
      event.preventDefault();
      openWikilink(parseWikilink(m[1]).target);
      return true;
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

// ── Plugin ──────────────────────────────────────────────────────────────────

class LivePreviewPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged || update.selectionSet) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export function livePreview(): Extension {
  return ViewPlugin.fromClass(LivePreviewPlugin, {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      mousedown: handleMousedown,
    },
  });
}
