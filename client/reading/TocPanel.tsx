// Outline (TOC) section for the right panel, shown above Backlinks: the open
// note's headings, click-to-scroll (the reading view smooth-scrolls; the
// editor jumps its CM view), with the active heading highlighted while the
// reading view scrolls.
//
// AND IT IS A TOOL, NOT A LEGEND. Dragging a row REORDERS that whole section
// inside the note — heading, body and every subheading under it, as one rigid
// block (client/sections.ts). That is the difference between a table of
// contents and an outliner, and it is the gesture the panel exists for: a
// reader who can see the shape of a 1,200-line note in forty rows is exactly
// the reader who can see that section four belongs before section two, and
// before this they had to scroll to it, select it by eye, cut it, scroll back
// and hope the paste landed between the right two headings.
//
// FOUR RULES HOLD THE GESTURE HONEST.
//
//  1. CLICK STILL SCROLLS. The row is a <button> that also carries `draggable`
//     — HTML5 drag is the browser's own click/drag disambiguation, so a press
//     that never moves is a click and nothing here has to guess a threshold.
//  2. THE DROP IS SHOWN BEFORE IT HAPPENS, at the DEPTH it will land at: a
//     rule between two rows, indented to the level the section will take. A
//     reorder that also silently re-parents is the failure mode of every
//     outliner, and the indicator is what makes the re-parenting a decision.
//     Drag toward the reading direction to nest deeper, back to un-nest —
//     inline, so the hand and the indent move the same way in Arabic.
//  3. SPRING-LOADED NESTING. Hovering a row for 600ms without moving means
//     "into this section": the row lights, and the indicator moves to its
//     first-child position. It is the drag-over-a-folder gesture the tree
//     already teaches, and it is what makes a deep nest reachable without
//     pixel-hunting a 24px indent step.
//  4. THE WAY BACK IS A BUTTON. The note is rewritten in ONE transaction, so
//     Ctrl+Z takes it back — and because the reader's hand is on the mouse and
//     their eyes are on the panel, the toast carries an Undo too (the tree's
//     rule for drags, undoToast.ts).
//
// The active-heading highlight is untouched by all of it: it is published by
// whichever surface is scrolling and consumed here, and a reorder neither
// clears it nor moves it.

import { useEffect, useMemo, useRef, useState, type DragEvent as RDragEvent } from "react";
import { getNote } from "../api.ts";
import { localeNum, t } from "../i18n.ts";
import { labelTagsInText, useTagLabels } from "../tagLabels.ts";
import { applySectionMove, liveContent } from "../sectionActions.ts";
import { openEditorSectionMenu } from "../editor/sectioning.ts";
import { openSectionMenu } from "../sectionMenu.ts";
import { levelRange, sectionsOf, type Section } from "../sections.ts";
import { useStore } from "../state.ts";
import { isTexPath } from "../../shared/noteFormat.ts";
import {
  frontmatterNumbering,
  headingNumbers,
  headingNumbersPref,
  numberLabel,
  setHeadingNumbersPref,
} from "./headingNumbers.ts";
import { installReadingSections } from "./headingMenu.ts";
import { noteHeadings, type Heading } from "./toc.ts";

/** How far the pointer must travel across the inline axis for one level of
 *  nesting. The outline's own indent step is 10px per level; 24 is the
 *  smallest distance that cannot be produced by a hand trying to hold still. */
const NEST_PX = 24;
/** Dwell before "before this row" becomes "inside this row". */
const SPRING_MS = 600;

interface DropState {
  /** Insert before this heading line; null = at the end of the note. */
  beforeLine: number | null;
  /** The depth the section will land at. */
  level: number;
  /** Where to paint the rule, in list-content pixels. */
  y: number;
  /** The row currently spring-loaded, if any. */
  springSlug: string | null;
}

export default function TocPanel() {
  const openPath = useStore((s) => s.openPath);
  const admin = useStore((s) => s.admin);
  const isDirty = useStore((s) => (s.openPath ? !!s.dirty[s.openPath] : false));
  const reloadTick = useStore((s) => s.reloadTick);
  const readingMode = useStore((s) => s.readingMode);
  useStore((s) => s.language); // re-render the chrome strings on language change
  // …and on the tag-label map landing or moving: a row can carry a #tag, and
  // the label it prints is not React state (client/tagLabels.ts is a plain
  // module with subscribers, like i18n.ts).
  useTagLabels();
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [content, setContent] = useState<string>("");
  const [active, setActive] = useState<string | null>(null);
  const [numbered, setNumbered] = useState(headingNumbersPref());
  const [dragSlug, setDragSlug] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const listRef = useRef<HTMLElement | null>(null);
  /** Where the drag started, and how deep the dragged section was — the two
   *  numbers rule 2 needs to read a horizontal intent out of a pointer. */
  const gesture = useRef<{ x: number; level: number; springAt: number; springSlug: string } | null>(
    null,
  );

  // The reading view's headings answer a right-click with the same menu these
  // rows do. Installed from here because this component is mounted for exactly
  // as long as the app shell is, and headings are its subject.
  useEffect(() => {
    installReadingSections();
  }, []);

  useEffect(() => {
    if (!openPath) {
      setHeadings([]);
      setContent("");
      return;
    }
    // THE OPEN EDITOR IS THE SOURCE OF TRUTH. The outline deliberately stops
    // recounting while a note is dirty (a heading half-typed is not a heading),
    // but a DRAG must never act on the last autosave — so when an editor holds
    // this path, the note comes out of its buffer and no fetch happens at all.
    const live = liveContent(openPath);
    if (live !== null) {
      setContent(live);
      setHeadings(noteHeadings(openPath, live).filter((h) => !h.furniture));
      return;
    }
    if (isDirty) return; // recount once the autosave lands
    let cancelled = false;
    getNote(openPath)
      .then((note) => {
        // Furniture headings (sections that are only link/tag lists, e.g. a
        // trailing "Tags:") stay out of the outline; their ids still exist
        // in the reading view so in-page anchors keep working.
        // Format-blind: markdown headings and `\section` hierarchies come
        // back in the same shape, with slugs that match the ids the
        // corresponding renderer assigns.
        if (cancelled) return;
        setContent(note.content);
        setHeadings(noteHeadings(openPath, note.content).filter((h) => !h.furniture));
      })
      .catch((err: unknown) => {
        console.error("vellum: loading note for outline failed", err);
      });
    return () => {
      cancelled = true;
    };
  }, [openPath, isDirty, reloadTick]);

  useEffect(() => {
    const onActive = (ev: Event): void => {
      setActive((ev as CustomEvent<string | null>).detail);
    };
    window.addEventListener("vellum:active-heading", onActive);
    return () => window.removeEventListener("vellum:active-heading", onActive);
  }, []);

  useEffect(() => {
    if (!readingMode) setActive(null);
  }, [readingMode]);
  useEffect(() => {
    setActive(null);
  }, [openPath]);

  /** The FULL section list — furniture included, because a section the outline
   *  hides is still a section the note holds, and a drop point computed from
   *  the visible rows alone would carry someone else's lines. Markdown only:
   *  a `.tex` note's structure is `\section{…}` and this model does not
   *  describe it. */
  const sections = useMemo<Section[]>(
    () => (openPath && !isTexPath(openPath) && content ? sectionsOf(content) : []),
    [openPath, content],
  );

  /** "2.3" per heading slug, when this note is numbered. Computed from every
   *  heading, so the outline's numbers are the reading view's numbers. */
  const numbers = useMemo(() => {
    // Markdown only. A `.tex` note's outline already carries the numbers
    // `\section` printed (reading/toc.ts's texHeadings puts them in the row's
    // own text), so numbering it here would print every number twice.
    if (!openPath || !content || isTexPath(openPath)) return null;
    // The note's own frontmatter outranks the device preference, in BOTH
    // directions: `numbered: false` on a note keeps it plain on an instance
    // whose reader turned numbering on.
    if (!(frontmatterNumbering(content) ?? numbered)) return null;
    return headingNumbers(noteHeadings(openPath, content));
  }, [openPath, content, numbered]);

  useEffect(() => {
    const onPref = (ev: Event): void => {
      setNumbered((ev as CustomEvent<boolean>).detail);
    };
    window.addEventListener("vellum:heading-numbers", onPref);
    return () => window.removeEventListener("vellum:heading-numbers", onPref);
  }, []);

  const canDrag = admin && sections.length > 1;

  /** Section for a rendered row (the outline hides furniture; the model does
   *  not, so rows are matched by source line). */
  const sectionOf = (h: Heading): Section | undefined =>
    sections.find((s) => s.headingLine === h.line - 1);

  /** The insertion line that means "after this whole section" — the first
   *  heading past its subtree, so a drop at the end of a parent does not slide
   *  in front of the parent's own children. */
  const afterSection = (s: Section): number | null =>
    sections.find((x) => x.headingLine >= s.endLine)?.headingLine ?? null;

  const clearDrag = (): void => {
    gesture.current = null;
    setDragSlug(null);
    setDrop(null);
  };

  const onRowDragOver = (event: RDragEvent<HTMLElement>, h: Heading): void => {
    const g = gesture.current;
    const moving = dragSlug ? sections.find((s) => s.slug === dragSlug) : null;
    if (!g || !moving) return;
    const row = event.currentTarget as HTMLElement;
    const list = listRef.current;
    if (!list) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const target = sectionOf(h);
    if (!target) return;
    const rect = row.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const below = event.clientY - rect.top > rect.height / 2;

    // Spring-load: the same pointer resting on the same row for SPRING_MS
    // means "into this section", which is the tree's drag-over-a-folder
    // gesture. Any real movement across rows resets the clock.
    if (g.springSlug !== h.slug) {
      g.springSlug = h.slug;
      g.springAt = Date.now();
    }
    const springing =
      !below && Date.now() - g.springAt > SPRING_MS && target.endLine > target.headingLine + 1;

    // Springing means "become this section's FIRST child": the insertion point
    // is its first subheading, or — when it has none — the line just past it.
    const firstChild = sections.find(
      (s) => s.headingLine > target.headingLine && s.headingLine < target.endLine,
    );
    const beforeLine = springing
      ? firstChild?.headingLine ?? afterSection(target)
      : below
        ? afterSection(target)
        : target.headingLine;

    const { lo, hi } = levelRange(sections, beforeLine, moving);
    // Horizontal intent, measured on the INLINE axis so the hand and the
    // indent agree in both directions.
    const rtl = getComputedStyle(list).direction === "rtl";
    const dx = (event.clientX - g.x) * (rtl ? -1 : 1);
    const wanted = springing ? target.level + 1 : g.level + Math.round(dx / NEST_PX);
    const level = Math.max(lo, Math.min(hi, wanted));

    // THE RULE IS DRAWN AT THE SEAM THE BLOCK WILL LAND IN, which for a
    // spring-loaded drop is BELOW the row being hovered, not above it: "into
    // this section" means "as its first child", and a rule floating over the
    // parent's own title says the opposite of what is about to happen.
    const y =
      rect.top - listRect.top + list.scrollTop + (springing || below ? rect.height : 0);
    setDrop({ beforeLine, level, y, springSlug: springing ? h.slug : null });
  };

  const onDrop = (event: RDragEvent<HTMLElement>): void => {
    event.preventDefault();
    const moving = dragSlug ? sections.find((s) => s.slug === dragSlug) : null;
    const target = drop;
    clearDrag();
    if (!moving || !target || !openPath) return;
    void applySectionMove(openPath, content, moving.headingLine, {
      beforeLine: target.beforeLine,
      level: target.level,
    }).then((next) => {
      // Redraw from the rewritten note in this frame. Waiting for the
      // autosave to land and the outline to recount would leave the row the
      // reader just dropped sitting where it used to be for 600ms, which
      // reads as "the drag did nothing". Rows and sections are set from the
      // SAME string, always: a row whose source line no longer names a
      // section is a row that cannot be dragged again.
      if (next === null) return;
      setContent(next);
      setHeadings(noteHeadings(openPath, next).filter((h) => !h.furniture));
    });
  };

  if (!openPath) return null;

  // A NOTE WITH NO HEADINGS KEEPS ITS OUTLINE SECTION (v1.8 audit, F5). The
  // whole section used to vanish, so the right panel's contents changed shape
  // from note to note and a reader who had just used the outline found the
  // panel apparently missing a part of itself — the same complaint the graph's
  // empty sky drew one section down. One quiet line answers it: the outline is
  // there, this note has nothing in it yet. The count badge and the numbering
  // button go, because a `0` badge over an empty list is the "reads as broken"
  // that comment is about, and there is nothing to number.
  const empty = headings.length === 0;

  return (
    <section className="s-toc">
      <header className="s-panel-header s-toc__header">
        <span className="s-panel-title">{t("outline")}</span>
        {!empty && <span className="s-panel-count">{localeNum(headings.length)}</span>}
        {/* Numbering is a READING affordance and it lives here, over the list
            it numbers: the outline is where a reader looks at the shape of the
            document, so it is where they decide whether that shape is
            numbered. The note's own frontmatter still outranks it. */}
        {!empty && (
            <button
              type="button"
              className={`s-toc__numbtn s-iconbtn${numbers ? " s-toc__numbtn--on" : ""}`}
              aria-pressed={numbers !== null}
              title={t(numbers ? "unnumberHeadings" : "numberHeadings")}
              onClick={() => setHeadingNumbersPref(!headingNumbersPref())}
            >
              1.
            </button>
          )}
        </header>
        {empty && <p className="s-panel-empty">{t("noHeadings")}</p>}
        {!empty && (
        <nav
          className={`s-toc__list${dragSlug ? " s-toc__list--dragging" : ""}`}
          // A navigation landmark with no name is one of several: this shell has
          // the sidebar tree, the blog nav and this one.
          aria-label={t("outline")}
          ref={listRef}
          onDragOver={(e) => {
            // Past the last row: the drop lands at the end of the note.
            if (!dragSlug || e.target !== e.currentTarget) return;
            e.preventDefault();
            const list = listRef.current;
            if (!list) return;
            setDrop({
              beforeLine: null,
              level: 1,
              y: list.scrollHeight,
              springSlug: null,
            });
          }}
          onDrop={onDrop}
          onDragEnd={clearDrag}
        >
          {drop && (
            <div
              className="s-toc__drop"
              style={{ top: drop.y, insetInlineStart: `${8 + (drop.level - 1) * 10}px` }}
              aria-hidden="true"
            />
          )}
          {headings.map((h) => {
            const section = sectionOf(h);
            return (
              <button
                key={`${h.slug}:${h.line}`}
                type="button"
                draggable={canDrag && !!section}
                className={`s-toc__item s-toc__item--l${h.level}${
                  active === h.slug ? " s-toc__item--active" : ""
                }${dragSlug === h.slug ? " s-toc__item--dragging" : ""}${
                  drop?.springSlug === h.slug ? " s-toc__item--spring" : ""
                }`}
                // "You are here" was gold text and nothing else; aria-current is
                // the same fact in a form a screen reader can read.
                aria-current={active === h.slug ? "location" : undefined}
                /* The TOOLTIP keeps the heading as the FILE spells it, so a
                   reader looking at a localised row can still learn the
                   canonical tag it carries — the bargain every labelled chip in
                   the product makes. */
                title={h.text}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("vellum:goto-heading", {
                      detail: { slug: h.slug, line: h.line, text: h.text },
                    }),
                  )
                }
                onContextMenu={(e) => {
                  if (!admin || !section) return;
                  e.preventDefault();
                  // An open editor answers first, and its menu is the FULLER
                  // one: fold-all-below, select and focus act on a CodeMirror
                  // view, so they exist exactly when one is mounted on this
                  // path. In reading mode the same right-click gets the three
                  // rows that still mean something.
                  if (openEditorSectionMenu(openPath, section.headingLine, e.clientX, e.clientY)) {
                    return;
                  }
                  openSectionMenu({
                    path: openPath,
                    content,
                    headingLine: section.headingLine,
                    x: e.clientX,
                    y: e.clientY,
                    onDone: () => useStore.getState().bumpReload(),
                  });
                }}
                onDragStart={(e) => {
                  if (!section) return;
                  e.dataTransfer.effectAllowed = "move";
                  // Some browsers refuse to start a drag with no payload.
                  e.dataTransfer.setData("text/plain", h.text);
                  gesture.current = {
                    x: e.clientX,
                    level: section.level,
                    springAt: Date.now(),
                    springSlug: h.slug,
                  };
                  setDragSlug(h.slug);
                }}
                onDragOver={(e) => onRowDragOver(e, h)}
                onDrop={onDrop}
                onDragEnd={clearDrag}
              >
                {/* The ROW is chrome: it keeps the shell's direction, so every
                    entry aligns to the same edge as the panel header, the indent
                    levels step inward from that edge and the active-row accent bar
                    stays attached to the row it marks. Only the LABEL is note
                    content, and it is isolated so an English heading in an Arabic
                    vault still reads "Tags:" rather than ":Tags". `dir="auto"` on
                    the row itself did both jobs at once and got the first one
                    wrong — a Latin heading dragged its whole row to the far side
                    of the panel. */}
                {numbers?.get(h.slug) && (
                  <span className="s-toc__num" aria-hidden="true">
                    {numberLabel(numbers.get(h.slug) ?? "")}
                  </span>
                )}
                <bdi>{labelTagsInText(h.text)}</bdi>
              </button>
            );
          })}
        </nav>
      )}
    </section>
  );
}
