// THE EDITOR'S HALF OF SECTIONING.
//
// One extension, five jobs, all of them about the same object — the subtree a
// heading owns (client/sections.ts):
//
//   · a ⋯ affordance beside every heading's fold chevron, and a right-click on
//     any heading line, both opening the shared heading menu;
//   · the keystrokes: jump to the previous/next heading, focus a section,
//     select one, fold or unfold everything below it;
//   · FOCUS MODE — collapse everything except the section the caret is in,
//     with Esc putting the note back exactly as it was;
//   · fold state that SURVIVES A RELOAD, per note, keyed by heading slug
//     rather than by line number so a paragraph typed above a fold does not
//     silently move it to a different section;
//   · the bridge the outline panel and the reading view write through
//     (`vellum:section-read` / `vellum:section-apply`), which is what makes
//     "the open editor is the source of truth" true rather than aspirational.
//
// Registered as ONE entry in setup.ts's extension list, markdown only: a
// `.tex` note's structure is `\section{…}`, folded by texFolds, and a markdown
// heading scan run over it would find nothing and offer a menu about nothing.

import { foldEffect, foldable, foldedRanges, unfoldEffect } from "@codemirror/language";
import { Prec, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { getLang, t } from "../i18n.ts";
import { sectionAtLine, sectionOffsets, sectionsOf, type Section } from "../sections.ts";
import { openSectionMenu } from "../sectionMenu.ts";
import { toast } from "../toast.ts";
import { notePathFacet } from "./livePreview.ts";
import { posFromEvent } from "./pointer.ts";

const HEADING_LINE_RE = /^\s{0,3}#{1,6}\s/;

/** Live editor views by note path — the outline panel's door into the editor,
 *  and what makes "the open buffer is the source of truth" enforceable rather
 *  than hopeful. Maintained by the plugin below, so a destroyed editor can
 *  never leave a stale view behind. */
const viewsByPath = new Map<string, EditorView>();

// ── Fold helpers ────────────────────────────────────────────────────────────

/** Fold (or unfold) every section strictly INSIDE `section`. "All below" means
 *  the subheadings this one owns — not the whole document, and not this
 *  heading itself, which would hide the very row the reader clicked on. */
function setFoldsBelow(view: EditorView, section: Section, fold: boolean): void {
  const sections = sectionsOf(view.state.doc.toString());
  const effects = [];
  for (const s of sections) {
    if (s.headingLine <= section.headingLine || s.headingLine >= section.endLine) continue;
    const line = view.state.doc.line(s.headingLine + 1);
    if (fold) {
      const range = foldable(view.state, line.from, line.to);
      if (range) effects.push(foldEffect.of(range));
    } else {
      const already = foldedAt(view, line.to);
      if (already) effects.push(unfoldEffect.of(already));
    }
  }
  if (effects.length) view.dispatch({ effects });
}

function foldedAt(view: EditorView, lineTo: number): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  foldedRanges(view.state).between(lineTo, lineTo, (from, to) => {
    if (from === lineTo) {
      found = { from, to };
      return false;
    }
    return undefined;
  });
  return found;
}

function currentFolds(view: EditorView): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
    out.push({ from, to });
    return undefined;
  });
  return out;
}

/** The section the caret sits in — the deepest one, which is what a reader
 *  pointing at a line means by "this section". */
function sectionAtCursor(view: EditorView): Section | null {
  const line = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  return sectionAtLine(sectionsOf(view.state.doc.toString()), line);
}

// ── Focus mode ──────────────────────────────────────────────────────────────
//
// A mode that removes what is on screen has to be reversible by the key every
// reader already tries, and it has to put back EXACTLY what was there — a
// reader who had three sections folded before pressing it must not find them
// open afterwards. So the fold set is saved whole and restored whole.

const focusSaves = new WeakMap<EditorView, { from: number; to: number }[]>();

function enterFocus(view: EditorView, section: Section): boolean {
  const sections = sectionsOf(view.state.doc.toString());
  const saved = currentFolds(view);
  const effects = [];
  for (const f of saved) effects.push(unfoldEffect.of(f));
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const isSelf = s.headingLine === section.headingLine;
    const isAncestor = s.headingLine < section.headingLine && s.endLine >= section.endLine;
    const isDescendant = s.headingLine > section.headingLine && s.headingLine < section.endLine;
    if (isSelf || isAncestor || isDescendant) continue;
    const line = view.state.doc.line(s.headingLine + 1);
    const range = foldable(view.state, line.from, line.to);
    if (range) effects.push(foldEffect.of(range));
    // Skip the subtree we just hid — folding inside a fold is invisible work.
    while (i + 1 < sections.length && sections[i + 1].headingLine < s.endLine) i++;
  }
  if (effects.length === 0) return false;
  focusSaves.set(view, saved);
  view.dispatch({ effects });
  view.dom.classList.add("cm-s-focussection");
  // A MODE THAT REMOVES WHAT IS ON SCREEN HAS TO SAY SO, and has to name the
  // way back in the same breath — the rule reading mode and zen already
  // follow. Half a note vanishing with nothing on screen to explain it is the
  // "silent mode" bug this product has written down three times.
  toast(t("focusSectionOn"));
  return true;
}

function leaveFocus(view: EditorView): boolean {
  const saved = focusSaves.get(view);
  if (!saved) return false;
  focusSaves.delete(view);
  view.dom.classList.remove("cm-s-focussection");
  const effects = [];
  for (const f of currentFolds(view)) effects.push(unfoldEffect.of(f));
  for (const f of saved) {
    if (f.to <= view.state.doc.length) effects.push(foldEffect.of(f));
  }
  if (effects.length) view.dispatch({ effects });
  return true;
}

// ── Fold state that survives a reload ───────────────────────────────────────
//
// Keyed by heading SLUG, not by line: line numbers are the one property of a
// fold that a keystroke three paragraphs above it changes, and a fold that
// silently walks to another section on the next reload is worse than no
// persistence at all. Slugs are the reading view's ids, generated by the same
// rule the outline and the anchor table use, so `[[Note#Heading]]`, the TOC
// row and the remembered fold all name the same place.

const FOLDS_KEY = "vellum.folds";
const FOLDS_MAX_NOTES = 80;

function readFolds(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(FOLDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function writeFolds(path: string, slugs: string[]): void {
  try {
    const all = readFolds();
    if (slugs.length === 0) delete all[path];
    else {
      delete all[path]; // re-inserted last: insertion order is the LRU
      all[path] = slugs;
    }
    const keys = Object.keys(all);
    for (const stale of keys.slice(0, Math.max(0, keys.length - FOLDS_MAX_NOTES))) delete all[stale];
    localStorage.setItem(FOLDS_KEY, JSON.stringify(all));
  } catch {
    // A full or disabled localStorage costs a convenience, never the editor.
  }
}

/** The slugs of the sections currently folded. */
function foldedSlugs(view: EditorView): string[] {
  const sections = sectionsOf(view.state.doc.toString());
  const out: string[] = [];
  for (const s of sections) {
    const line = view.state.doc.line(s.headingLine + 1);
    if (foldedAt(view, line.to)) out.push(s.slug);
  }
  return out;
}

function restoreFolds(view: EditorView): void {
  const path = view.state.facet(notePathFacet);
  const want = new Set(readFolds()[path] ?? []);
  if (want.size === 0) return;
  const effects = [];
  for (const s of sectionsOf(view.state.doc.toString())) {
    if (!want.has(s.slug)) continue;
    const line = view.state.doc.line(s.headingLine + 1);
    const range = foldable(view.state, line.from, line.to);
    if (range) effects.push(foldEffect.of(range));
  }
  if (effects.length) view.dispatch({ effects });
}

// ── The ⋯ affordance ────────────────────────────────────────────────────────

class SectionButtonWidget extends WidgetType {
  // Same rule folding.ts states: the chrome language is part of a widget's
  // identity, or a live language flip leaves an Arabic tooltip on an English
  // editor forever.
  readonly lang = getLang();
  constructor(readonly linePos: number) {
    super();
  }
  override eq(other: SectionButtonWidget): boolean {
    return other.linePos === this.linePos && other.lang === this.lang;
  }
  toDOM(view: EditorView): HTMLElement {
    // A zero-width host so the button can be absolutely positioned into the
    // prose gutter WITHOUT joining the line's inline flow: the fold chevron
    // beside it pulls itself in with a negative margin, and a second element
    // playing that trick would push the heading's own text off its measure.
    const host = document.createElement("span");
    host.className = "cm-s-secthost";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cm-s-sectbtn";
    btn.title = t("sectionActions");
    btn.setAttribute("aria-label", btn.title);
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>';
    btn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const rect = btn.getBoundingClientRect();
      openMenuForLine(view, this.linePos, rect.left, rect.bottom + 4);
    });
    host.appendChild(btn);
    return host;
  }
}

function openMenuForLine(view: EditorView, pos: number, x: number, y: number): void {
  const doc = view.state.doc;
  const line = doc.lineAt(Math.min(pos, doc.length));
  const content = doc.toString();
  openSectionMenu({
    path: view.state.facet(notePathFacet),
    content,
    headingLine: line.number - 1,
    x,
    y,
    onFoldBelow: (s) => setFoldsBelow(view, s, true),
    onUnfoldBelow: (s) => setFoldsBelow(view, s, false),
    onSelect: (s) => selectSection(view, s),
    onFocus: (s) => {
      enterFocus(view, s);
      view.focus();
    },
  });
}

function selectSection(view: EditorView, section: Section): void {
  const { from, to } = sectionOffsets(view.state.doc.toString(), section);
  view.dispatch({
    selection: { anchor: from, head: Math.min(to, view.state.doc.length) },
    scrollIntoView: true,
  });
  view.focus();
}

function buildButtons(view: EditorView): DecorationSet {
  const decos = [];
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      pos = line.to + 1;
      if (seen.has(line.from)) continue;
      seen.add(line.from);
      if (!HEADING_LINE_RE.test(line.text)) continue;
      decos.push(
        // side -2: ahead of folding.ts's chevron at the same position, so the
        // two never swap places as decorations are rebuilt.
        Decoration.widget({ widget: new SectionButtonWidget(line.from), side: -2 }).range(line.from),
      );
    }
  }
  return Decoration.set(decos);
}

// ── The extension ───────────────────────────────────────────────────────────

/** Move the caret to the previous / next heading line. */
function jumpHeading(view: EditorView, dir: -1 | 1): boolean {
  const sections = sectionsOf(view.state.doc.toString());
  if (sections.length === 0) return false;
  const here = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  const target =
    dir === 1
      ? sections.find((s) => s.headingLine > here)
      : [...sections].reverse().find((s) => s.headingLine < here);
  if (!target) return false;
  const pos = view.state.doc.line(target.headingLine + 1).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 24 }),
  });
  return true;
}

export function sectioning(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        private readonly onRead: (ev: Event) => void;
        private readonly onApply: (ev: Event) => void;
        private saveTimer: number | undefined;

        constructor(readonly view: EditorView) {
          this.decorations = buildButtons(view);
          viewsByPath.set(view.state.facet(notePathFacet), view);
          // The bridge the outline and the reading view read and write
          // through. Synchronous by construction: the caller inspects the
          // detail object the moment dispatchEvent returns.
          this.onRead = (ev: Event) => {
            const d = (ev as CustomEvent<{ path: string; content: string | null }>).detail;
            if (d.path === view.state.facet(notePathFacet)) d.content = view.state.doc.toString();
          };
          this.onApply = (ev: Event) => {
            const d = (ev as CustomEvent<{ path: string; content: string; handled: boolean }>)
              .detail;
            if (d.path !== view.state.facet(notePathFacet)) return;
            const was = view.state.doc.toString();
            d.handled = true;
            if (was === d.content) return;
            // ONE transaction over the whole document: Ctrl+Z takes the drag
            // back in a single press, and the editor's own autosave carries it
            // to disk, so the outline never has to write the file itself.
            view.dispatch({
              changes: { from: 0, to: view.state.doc.length, insert: d.content },
              // A whole-document replace maps every selection to 0; parking the
              // caret at the doc start would scroll a 1,200-line note to the
              // top for a drag that happened 40 rows down.
              selection: { anchor: Math.min(view.state.selection.main.head, d.content.length) },
            });
          };
          window.addEventListener("vellum:section-read", this.onRead);
          window.addEventListener("vellum:section-apply", this.onApply);
          // Folds are restored a tick after the view exists: dispatching from
          // inside a plugin constructor is a re-entrant update.
          queueMicrotask(() => {
            if (view.dom.isConnected) restoreFolds(view);
          });
        }

        update(update: ViewUpdate): void {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = buildButtons(update.view);
          }
          const foldChanged = update.transactions.some((tr) =>
            tr.effects.some((e) => e.is(foldEffect) || e.is(unfoldEffect)),
          );
          if (foldChanged || update.docChanged) {
            // Debounced: a "fold all below" is one gesture and a dozen
            // effects, and localStorage is synchronous.
            window.clearTimeout(this.saveTimer);
            this.saveTimer = window.setTimeout(() => {
              writeFolds(update.view.state.facet(notePathFacet), foldedSlugs(update.view));
            }, 250);
          }
        }

        destroy(): void {
          window.clearTimeout(this.saveTimer);
          window.removeEventListener("vellum:section-read", this.onRead);
          window.removeEventListener("vellum:section-apply", this.onApply);
          const path = this.view.state.facet(notePathFacet);
          if (viewsByPath.get(path) === this.view) viewsByPath.delete(path);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),

    // Right-click a heading. Below the selection menu's own handler on
    // purpose: with text selected, the formatting menu is what a right-click
    // means (CONTRACTS), and this one steps aside for it.
    EditorView.domEventHandlers({
      contextmenu(event, view) {
        if (!view.state.selection.main.empty) return false;
        const pos = posFromEvent(event, view);
        if (pos === null) return false;
        const line = view.state.doc.lineAt(pos);
        if (!HEADING_LINE_RE.test(line.text)) return false;
        event.preventDefault();
        openMenuForLine(view, line.from, event.clientX, event.clientY);
        return true;
      },
    }),

    Prec.high(
      keymap.of([
        // UNCLAIMED, AND CHECKED AGAINST THE WHOLE MAP. Ctrl/Cmd+B, +I and +U
        // are formatting's; Ctrl/Cmd+Arrow is move-line (setup.ts) and Alt+Arrow
        // is CodeMirror's own; Ctrl/Cmd+Shift+[ / ] fold, Ctrl/Cmd+Alt+[ / ]
        // fold all. Ctrl/Cmd+Alt+Arrow was free on every one of them.
        { key: "Mod-Alt-ArrowUp", preventDefault: true, run: (v) => jumpHeading(v, -1) },
        { key: "Mod-Alt-ArrowDown", preventDefault: true, run: (v) => jumpHeading(v, 1) },
        {
          key: "Mod-Alt-f",
          preventDefault: true,
          run: (view) => {
            if (leaveFocus(view)) return true;
            const section = sectionAtCursor(view);
            return section ? enterFocus(view, section) : false;
          },
        },
      ]),
    ),

    // ESC LEAVES FOCUS MODE — AND IT IS NOT Prec.high, DELIBERATELY. Under vim
    // Esc is sacred (CONTRACTS states it twice), so this binding sits at plain
    // precedence, below the vim compartment: in vim mode Esc still means
    // "normal mode" and Ctrl/Cmd+Alt+F is the way back out. Everywhere else it
    // runs before defaultKeymap's Esc, and declines — returns false — when no
    // section is focused, so nothing else loses the key.
    keymap.of([{ key: "Escape", run: (view) => leaveFocus(view) }]),
  ];
}

/** Open the heading menu for a section of the OPEN note from outside the
 *  editor (the outline panel's right-click), with the editor-only rows wired
 *  when an editor is in fact mounted on that path. Returns false when no
 *  editor holds the path — the caller then opens the reading-view menu. */
export function openEditorSectionMenu(
  path: string,
  headingLine: number,
  x: number,
  y: number,
): boolean {
  const view = viewsByPath.get(path);
  if (!view || !view.dom.isConnected) return false;
  openMenuForLine(view, view.state.doc.line(headingLine + 1).from, x, y);
  return true;
}

