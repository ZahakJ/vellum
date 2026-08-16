// Hover previews: resting the pointer on a [[wikilink]] (300ms) floats a
// small card with the target note's rendered opening lines — via the reading
// renderer, so callouts/math/embeds look exactly like the real thing. A
// [[Note#Heading]] link previews from that heading. Footnote refs ([^1])
// preview their definition text.
//
// The rest timer and the tooltip state are OURS (a mousemove listener + a
// StateField behind `showTooltip`) rather than CodeMirror's `hoverTooltip`,
// for one reason: `hoverTooltip` resolves the pointer with `posAtCoords`,
// which maps through the vertical line layout and drifts by whole lines in a
// note containing block widgets — a frontmatter card, $$ math, an image. The
// drifted position lands on a line with no wikilink and `source()` returns
// null, so the card never opens. It is exactly the bug the CLICK path already
// fixed (livePreview.ts::posFromEvent, whose comment condemns posAtCoords in
// these words) and it was left in the hover path, where it is silent: the
// feature simply appears not to exist. Measured on the 1,389-note test vault,
// stock `hoverTooltip` opened 4 of 7 hovered links across the first four
// notes carrying frontmatter — all three links of one note were dead — while
// this implementation opens 7 of 7. Resolving through the DOM node actually
// under the pointer (caretPositionFromPoint → posAtDOM) is exact, so the card
// opens on the link the reader is looking at.
//
// Regression: scripts/shoot-hover.mjs, which hovers EVERY visible link in
// several notes WITH frontmatter — a bare note, and a single link, are
// precisely the cases that kept passing while the feature was broken.

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  EditorView,
  repositionTooltips,
  showTooltip,
  ViewPlugin,
  type Tooltip,
} from "@codemirror/view";
import { getNote } from "../api.ts";
import { t } from "../i18n.ts";
import { useStore } from "../state.ts";
import { renderMarkdown } from "../reading/render.ts";
import { findHeadingLine, parseWikilink, resolveLink, WIKILINK_RE } from "./links.ts";
import { notePathFacet, posFromEvent } from "./livePreview.ts";

const FOOTNOTE_RE = /\[\^([^\]\s]+)\]/g;

const cache = new Map<string, { content: string; at: number }>();
const CACHE_MS = 15_000;

async function noteContent(path: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.content;
  try {
    const note = await getNote(path);
    cache.set(path, { content: note.content, at: Date.now() });
    return note.content;
  } catch {
    return null;
  }
}

/** Strip frontmatter, optionally start at a heading, cap the excerpt. */
function excerpt(content: string, heading: string | null, title?: string): string {
  let body = content.replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/, "");
  if (heading) {
    const line = findHeadingLine(body, heading);
    if (line !== null) body = body.split("\n").slice(line - 1).join("\n");
  } else if (title) {
    // An opening H1 that just repeats the note title would double the card
    // header an inch above it — drop that one line from the preview body.
    // (Checked within the first dozen lines: templates often put a timestamp
    // or a "Status:" line before the H1.)
    const lines = body.split("\n");
    const limit = Math.min(lines.length, 12);
    for (let i = 0; i < limit; i++) {
      const m = /^\s{0,3}#\s+(.+?)\s*$/.exec(lines[i]);
      if (!m) continue;
      if (m[1].trim().toLowerCase() === title.trim().toLowerCase()) {
        lines.splice(i, 1);
        body = lines.join("\n");
      }
      break; // only the first heading is a candidate
    }
  }
  const lines = body.split("\n");
  let out: string[] = [];
  let chars = 0;
  for (const line of lines) {
    out.push(line);
    chars += line.length + 1;
    if (out.length >= 30 || chars > 1400) break;
  }
  // Don't leave a dangling half code-fence open at the cut.
  const fences = out.filter((l) => /^\s*(```|~~~)/.test(l)).length;
  if (fences % 2 === 1) out.push("```");
  return out.join("\n").trim();
}

function card(title: string): {
  dom: HTMLElement;
  body: HTMLElement;
} {
  const dom = document.createElement("div");
  dom.className = "cm-s-hovercard";
  const head = document.createElement("div");
  head.className = "cm-s-hovercard__title";
  head.textContent = title;
  const body = document.createElement("div");
  body.className = "cm-s-hovercard__body";
  body.textContent = "…";
  dom.append(head, body);
  return { dom, body };
}

/** The card floats OUTSIDE contentDOM, so the pointer leaving the text would
 *  otherwise dismiss it before it can be reached (its body holds real links).
 *  Entering the card cancels the pending dismiss; leaving it dismisses at
 *  once. */
function keepReachable(dom: HTMLElement, view: EditorView): void {
  dom.addEventListener("mouseenter", () => view.plugin(hoverManager)?.keep());
  dom.addEventListener("mouseleave", () => view.plugin(hoverManager)?.hide());
}

function noteTooltip(
  view: EditorView,
  from: number,
  to: number,
  target: string,
  heading: string | null,
): Tooltip {
  const hostPath = view.state.facet(notePathFacet);
  const path = resolveLink(target, useStore.getState().tree);
  return {
    pos: from,
    end: to,
    above: true,
    create: () => {
      const title = path
        ? (path.split("/").pop() ?? path).replace(/\.md$/i, "")
        : target;
      const { dom, body } = card(title);
      keepReachable(dom, view);
      if (!path) {
        dom.classList.add("cm-s-hovercard--missing");
        body.textContent = t("embedNotCreated");
        return { dom };
      }
      void noteContent(path).then((content) => {
        if (!dom.isConnected) return;
        if (content === null) {
          body.textContent = t("noteLoadFailed");
          return;
        }
        const md = excerpt(content, heading, title);
        body.replaceChildren(
          md
            ? renderMarkdown(md, {
                notePath: path,
                tree: useStore.getState().tree,
                embedded: true,
                ancestors: new Set([hostPath]),
              })
            : document.createTextNode(t("noteEmpty")),
        );
        repositionTooltips(view);
      });
      return { dom };
    },
  };
}

/** The `[^label]:` definition text: its line plus indented continuations. */
function footnoteDef(docText: string, label: string): string | null {
  const lines = docText.split("\n");
  const prefix = `[^${label}]:`;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith(prefix)) continue;
    const out = [lines[i].slice(prefix.length).trim()];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^(\t| {2,})\S/.test(lines[j])) out.push(lines[j].trim());
      else break;
    }
    const text = out.join("\n").trim();
    return text || null;
  }
  return null;
}

function footnoteTooltip(
  view: EditorView,
  from: number,
  to: number,
  label: string,
): Tooltip | null {
  const def = footnoteDef(view.state.doc.toString(), label);
  if (!def) return null;
  const hostPath = view.state.facet(notePathFacet);
  return {
    pos: from,
    end: to,
    above: true,
    create: () => {
      const { dom, body } = card(`Footnote ${label}`);
      keepReachable(dom, view);
      dom.classList.add("cm-s-hovercard--footnote");
      body.replaceChildren(
        renderMarkdown(def, {
          notePath: hostPath,
          tree: useStore.getState().tree,
          embedded: true,
          ancestors: new Set([hostPath]),
        }),
      );
      return { dom };
    },
  };
}

function source(view: EditorView, pos: number): Tooltip | null {
  const line = view.state.doc.lineAt(pos);
  const text = line.text;

  WIKILINK_RE.lastIndex = 0;
  for (let m = WIKILINK_RE.exec(text); m; m = WIKILINK_RE.exec(text)) {
    if (m.index > 0 && text[m.index - 1] === "!") continue; // embeds render already
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (pos < from || pos >= to) continue;
    const { target, heading } = parseWikilink(m[1]);
    if (!target && !heading) return null;
    if (!target && heading) {
      // [[#Heading]] — same note; preview from that heading.
      const hostPath = view.state.facet(notePathFacet);
      return noteTooltip(view, from, to, hostPath.replace(/\.md$/i, ""), heading);
    }
    return noteTooltip(view, from, to, target, heading);
  }

  FOOTNOTE_RE.lastIndex = 0;
  for (let m = FOOTNOTE_RE.exec(text); m; m = FOOTNOTE_RE.exec(text)) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    const isDef = m.index === 0 && text[m[0].length] === ":";
    if (isDef || pos < from || pos >= to) continue;
    return footnoteTooltip(view, from, to, m[1]);
  }

  return null;
}

// ── Rest timer + tooltip state ──────────────────────────────────────────────

/** Pointer rest before a card opens. */
const HOVER_MS = 300;
/** Grace between leaving the text and reaching the card (it floats outside
 *  contentDOM, so there is a gap of chrome to cross). */
const LEAVE_MS = 140;

const setHover = StateEffect.define<Tooltip | null>();

const hoverField = StateField.define<Tooltip | null>({
  create: () => null,
  update(tip, tr) {
    for (const e of tr.effects) if (e.is(setHover)) return e.value;
    // An edit or a cursor move invalidates the anchor (and in live preview it
    // re-renders the very line the card is pinned to).
    if (tip && (tr.docChanged || tr.selection)) return null;
    return tip;
  },
  provide: (f) => showTooltip.from(f),
});

class HoverManager {
  private restTimer = 0;
  private hideTimer = 0;
  private last: MouseEvent | null = null;

  constructor(private readonly view: EditorView) {
    const dom = view.contentDOM;
    dom.addEventListener("mousemove", this.onMove);
    dom.addEventListener("mouseleave", this.onLeave);
    dom.addEventListener("mousedown", this.onDismiss);
    dom.addEventListener("keydown", this.onDismiss);
  }

  destroy(): void {
    const dom = this.view.contentDOM;
    dom.removeEventListener("mousemove", this.onMove);
    dom.removeEventListener("mouseleave", this.onLeave);
    dom.removeEventListener("mousedown", this.onDismiss);
    dom.removeEventListener("keydown", this.onDismiss);
    window.clearTimeout(this.restTimer);
    window.clearTimeout(this.hideTimer);
    this.last = null; // a MouseEvent pins its target node; don't outlive the view
  }

  /** Pointer is on the card: cancel the pending dismiss. */
  keep(): void {
    window.clearTimeout(this.hideTimer);
    window.clearTimeout(this.restTimer);
  }

  hide(): void {
    window.clearTimeout(this.restTimer);
    window.clearTimeout(this.hideTimer);
    this.show(null);
  }

  private show(tip: Tooltip | null): void {
    if (this.view.state.field(hoverField) === tip) return;
    this.view.dispatch({ effects: setHover.of(tip) });
  }

  private onDismiss = (): void => this.hide();

  private onLeave = (): void => {
    window.clearTimeout(this.restTimer);
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.show(null), LEAVE_MS);
  };

  private onMove = (event: MouseEvent): void => {
    if (event.buttons !== 0) {
      this.hide(); // dragging a selection is not resting
      return;
    }
    this.last = event;
    window.clearTimeout(this.hideTimer);
    const open = this.view.state.field(hoverField);
    if (open) {
      // Still over the same token? Leave the card alone — re-resolving on
      // every mousemove would flicker it.
      const pos = posFromEvent(event, this.view);
      if (pos !== null && pos >= open.pos && pos <= (open.end ?? open.pos)) return;
      this.show(null);
    }
    window.clearTimeout(this.restTimer);
    this.restTimer = window.setTimeout(this.rest, HOVER_MS);
  };

  private rest = (): void => {
    const event = this.last;
    if (!event || !this.view.dom.isConnected) return;
    const pos = posFromEvent(event, this.view);
    if (pos === null) return;
    this.show(source(this.view, pos));
  };
}

const hoverManager = ViewPlugin.fromClass(HoverManager);

export function hoverPreviews(): Extension {
  return [hoverField, hoverManager];
}
