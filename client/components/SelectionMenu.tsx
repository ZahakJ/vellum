// The selection menu (right-click) and the floating selection toolbar.
//
// One surface, two doors. The MENU is the whole vocabulary — text style,
// structure, insert, colour — reached by right-clicking a selection, which is
// where a reader coming from a word processor looks first and where nothing
// was before (the browser's own context menu, which offers Print and
// Inspect). The TOOLBAR is the six things people actually do, floating over
// the selection the moment there is one, because a formatting gesture that
// costs a right-click is a gesture nobody makes mid-sentence.
//
// EVERY ROW RUNS THE SAME COMMAND THE KEYSTROKE RUNS (client/editor/commands.ts).
// A menu that inserted its own asterisks would disagree with Ctrl+B the first
// time either changed, and the disagreement would be silent.
//
// THE MENU IS KEYBOARD-COMPLETE. ↑↓ walk it, ←→ walk a swatch row and open or
// leave a submenu, Enter runs the highlighted row, Esc leaves a submenu and
// then closes, handing the caret back to the note. Opening it with Shift+F10 /
// the Menu key is the same call as the right-click (the editor extension at
// the bottom of this file binds both), so a reader who never touches a mouse
// has the whole vocabulary too.
//
// A MENU IS NOT A PANEL. The first draft printed the entire vocabulary flat:
// twenty-one rows, seventeen swatches and four lines of body copy, measured at
// 341×884 in a 1440×900 viewport and 341×828 with 1,217px of scroll at
// 390×844 — the reader scrolled ~390px INSIDE a context menu to reach "Remove
// colour". So the shape changed rather than the type size:
//
//   · the six STYLE rows and ONE colour row stay at the top level, because
//     they are what a right-click on a word is for;
//   · STRUCTURE and INSERT became submenu pages (`›`, and ← / Esc to come
//     back). Nothing was dropped: the palette owns the same commands, and a
//     page a reader opens on purpose costs no height to a reader who does not;
//   · the two swatch rows became one, with a FIXED INK checkbox beside it. The
//     two-tier model is right and the reader should not have to adjudicate a
//     WCAG argument at the moment they want a word red: the default row is
//     theme-aware (`var(--vc-blue)`, resolved per theme, AA on its own
//     ground), the checkbox switches it to the nine literal inks that hold
//     3:1 on all thirty grounds, and the arithmetic behind both is one hover
//     away in the row's own tooltip instead of four lines of prose in the box.
//     shared/textColors.ts carries the full version.
//   · "Remove colour" is the ⊘ chip at the end of that row, not a
//     twenty-first row of its own.

import "../styles/selection.css";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { Prec, type Extension } from "@codemirror/state";
import {
  applyColor,
  format,
  formatsFor,
  insertPair,
  syntaxOf,
  toggleLinePrefix,
  toggleTexEnv,
  toggleTexSection,
  type FormatKind,
  type NoteSyntax,
} from "../editor/commands.ts";
import { LITERAL_COLORS, SEMANTIC_COLORS } from "../../shared/textColors.ts";
import { t, type I18nKey } from "../i18n.ts";
import { useStore } from "../state.ts";

// ── The floating toolbar's on/off switch ───────────────────────────────────
// A DEVICE preference, in localStorage beside `vellum.vim` and `vellum.theme`,
// not an instance setting: it says how THIS person likes to edit, it must not
// travel to a co-author through the settings panel, and it must not need a
// server round-trip to answer a selection. Default ON — the affordance only
// works if it is there before you know to look for it. The menu's last row
// turns it off; the palette's "Selection toolbar" row turns it back on, so the
// switch is never one-way (which is the trap a hidden default-on feature sets).
const TOOLBAR_KEY = "vellum.selToolbar";

export function selectionToolbarEnabled(): boolean {
  try {
    return localStorage.getItem(TOOLBAR_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setSelectionToolbarEnabled(on: boolean): void {
  try {
    localStorage.setItem(TOOLBAR_KEY, on ? "on" : "off");
  } catch {
    /* private mode: the choice just will not survive a reload */
  }
  window.dispatchEvent(new CustomEvent("vellum:seltoolbar"));
}

// ── Rows ───────────────────────────────────────────────────────────────────

type Row =
  | { kind: "action"; label: I18nKey; keys?: string; run: (v: EditorView) => void }
  /** A door to another page of the same menu. */
  | { kind: "page"; label: I18nKey; page: PageId }
  /** The colour row: one strip of chips, plus the ⊘ that removes colour. */
  | { kind: "swatches" }
  /** The "fixed ink" switch, and the toolbar switch: rows that toggle rather
   *  than run, so they carry a mark and do not close the menu. */
  | { kind: "toggle"; label: I18nKey; note?: I18nKey; on: boolean; toggle: () => void };

interface Swatch {
  id: string;
  value: string | null;
  dark: string;
  light: string;
}

interface Group {
  /** Untitled groups are separated by their own hairline and nothing else — a
   *  section label over two rows the reader can already read is furniture. */
  title?: I18nKey;
  rows: Row[];
}

type PageId = "root" | "structure" | "insert";

/** The i18n key for each swatch, written out. The gate counts a key as USED
 *  only when it appears as a quoted token in client/, so `t(`color_${id}`)`
 *  would mark all nine of these dead and fail the build — which is the gate
 *  doing its job, not a nuisance to route around. */
const COLOR_LABEL: Record<string, I18nKey> = {
  none: "colorRemove",
  red: "colorRed",
  orange: "colorOrange",
  amber: "colorAmber",
  green: "colorGreen",
  teal: "colorTeal",
  blue: "colorBlue",
  violet: "colorViolet",
  magenta: "colorMagenta",
  grey: "colorGrey",
};

const act = (
  label: I18nKey,
  run: (v: EditorView) => void,
  keys?: string,
): Row => ({ kind: "action", label, run, keys });

/** The style row's label and keystroke, per kind — one table so the menu, the
 *  toolbar and the shortcut sheet cannot disagree about what a key does. */
const STYLE_ROW: Record<FormatKind, { label: I18nKey; keys?: string; glyph: string }> = {
  bold: { label: "fmtBold", keys: "Ctrl/Cmd B", glyph: "B" },
  italic: { label: "fmtItalic", keys: "Ctrl/Cmd I", glyph: "I" },
  underline: { label: "fmtUnderline", keys: "Ctrl/Cmd U", glyph: "U" },
  strikethrough: { label: "fmtStrikethrough", keys: "Ctrl/Cmd ⇧ X", glyph: "S" },
  highlight: { label: "fmtHighlight", keys: "Ctrl/Cmd ⇧ H", glyph: "H" },
  code: { label: "fmtCode", glyph: "‹›" },
};

/** THE MENU IS BUILT PER NOTE, NOT PER APP. A `.tex` note is a note like any
 *  other everywhere else in this editor, but the one thing a formatting menu
 *  is made of — the SPELLING of bold, of a heading, of a link — is exactly
 *  what changes with the language the file is written in. So the vocabulary is
 *  filtered by what the open note can actually carry:
 *
 *   - `formatsFor` drops strikethrough and highlight in LaTeX (no `\sout`
 *     without `ulem`, no `\hl` without `soul`);
 *   - headings become `\section`/`\subsection`/`\subsubsection`, lists become
 *     `itemize`/`enumerate` and a quote becomes the `quote` environment —
 *     while a TASK LIST has no LaTeX spelling at all and is simply absent,
 *     which is the honest answer and the one the rest of this feature gives;
 *   - a wikilink becomes `\note{…}`, Vellum's own macro (the one `vellum.sty`
 *     makes compile elsewhere), and a link becomes `\href{url}{…}`;
 *   - INLINE MATH IS THE ONE ROW THAT IS BYTE-IDENTICAL in both languages;
 *   - and the colour group is gone, because a coloured run is a `<span style>`
 *     — HTML, which `shared/tex.ts` does not read and pdflatex prints as
 *     literal text. Offering a swatch that quietly corrupts the document is
 *     worse than not offering colour in a paper. */
function pagesFor(
  syntax: NoteSyntax,
  ui: {
    literal: boolean;
    toggleLiteral: () => void;
    toolbar: boolean;
  },
): Record<PageId, Group[]> {
  const tex = syntax === "latex";
  const style: Group = {
    title: "selGroupStyle",
    rows: formatsFor(syntax).map((kind) =>
      act(STYLE_ROW[kind].label, format(kind), STYLE_ROW[kind].keys),
    ),
  };
  const structure: Group = {
    title: "selGroupStructure",
    rows: tex
      ? [
          act("fmtHeading1", (v) => toggleTexSection(v, "section")),
          act("fmtHeading2", (v) => toggleTexSection(v, "subsection")),
          act("fmtHeading3", (v) => toggleTexSection(v, "subsubsection")),
          act("fmtBulletList", (v) => toggleTexEnv(v, "itemize", true)),
          act("fmtNumberedList", (v) => toggleTexEnv(v, "enumerate", true)),
          act("fmtQuote", (v) => toggleTexEnv(v, "quote", false)),
        ]
      : [
          act("fmtHeading1", (v) => toggleLinePrefix(v, "# ")),
          act("fmtHeading2", (v) => toggleLinePrefix(v, "## ")),
          act("fmtHeading3", (v) => toggleLinePrefix(v, "### ")),
          act("fmtBulletList", (v) => toggleLinePrefix(v, "- ")),
          act("fmtNumberedList", (v) => toggleLinePrefix(v, "1. ")),
          act("fmtTaskList", (v) => toggleLinePrefix(v, "- [ ] ")),
          act("fmtQuote", (v) => toggleLinePrefix(v, "> ")),
        ],
  };
  const insert: Group = {
    title: "selGroupInsert",
    rows: tex
      ? [
          act("insWikilink", (v) => insertPair(v, "\\note{", "}")),
          act("insLink", (v) => insertPair(v, "\\href{url}{", "}")),
          act("insMath", (v) => insertPair(v, "$", "$")),
          act("insCodeBlock", (v) =>
            insertPair(v, "\\begin{verbatim}\n", "\n\\end{verbatim}")),
        ]
      : [
          act("insWikilink", (v) => insertPair(v, "[[", "]]")),
          act("insLink", (v) => insertPair(v, "[", "](url)")),
          act("insMath", (v) => insertPair(v, "$", "$")),
          act("insCodeBlock", (v) => insertPair(v, "```\n", "\n```")),
        ],
  };
  const colour: Group = {
    title: "selGroupColor",
    rows: [
      { kind: "swatches" },
      {
        kind: "toggle",
        label: "colorFixed",
        note: ui.literal ? "colorFixedNote" : "colorThemeAwareNote",
        on: ui.literal,
        toggle: ui.toggleLiteral,
      },
    ],
  };
  const doors: Group = {
    rows: [
      { kind: "page", label: "selGroupStructure", page: "structure" },
      { kind: "page", label: "selGroupInsert", page: "insert" },
    ],
  };
  // The floating toolbar's switch. An ACTION, not a checkbox: it names the
  // thing it will do next ("Hide the floating toolbar"), which is the one
  // phrasing that needs no mark to be read correctly.
  const toolbar: Group = {
    rows: [
      act(ui.toolbar ? "selToolbarHide" : "selToolbarShow", () => {
        setSelectionToolbarEnabled(!selectionToolbarEnabled());
      }),
    ],
  };
  const back = (title: I18nKey, rows: Row[]): Group[] => [{ title, rows }];
  return {
    root: tex
      ? [style, doors, toolbar]
      : [style, colour, doors, toolbar],
    structure: back("selGroupStructure", structure.rows),
    insert: back("selGroupInsert", insert.rows),
  };
}

/** The chips, in the tier the reader has chosen, with the ⊘ that takes colour
 *  back off. One row, nine or ten chips — never two rows of the same eight
 *  hue names separated by an argument. */
function swatchesFor(literal: boolean): Swatch[] {
  const source = literal ? LITERAL_COLORS : SEMANTIC_COLORS;
  return [
    ...source.map((c) => ({
      id: c.id,
      value: c.value,
      dark: c.swatchDark,
      light: c.swatchLight,
    })),
    { id: "none", value: null, dark: "", light: "" },
  ];
}

/** The strip that floats over a selection. Chosen by what a writer reaches for
 *  mid-sentence: the two everyone knows, the two markdown has that a word
 *  processor does not (highlight, inline code), strikethrough, and the door to
 *  everything else. Underline is deliberately not here — it is the least used
 *  of the six wrapping formats in a markdown vault and it keeps its keystroke.
 *  In a `.tex` note the two that LaTeX cannot spell drop out by the same rule
 *  the menu uses, leaving B / I / ‹› and the door: a toolbar button that does
 *  nothing when pressed is worse than one that is not there. */
function toolbarFor(
  syntax: NoteSyntax,
): { label: I18nKey; glyph: string; run: (v: EditorView) => void }[] {
  // A LETTER, not a pictogram. The first draft drew "▤", which at 14px in a
  // row beside B and I reads as a list icon; the marked-up letter says
  // "highlighter" the way the struck S says "strikethrough".
  const order: FormatKind[] = ["bold", "italic", "strikethrough", "highlight", "code"];
  const live = new Set(formatsFor(syntax));
  return order
    .filter((k) => live.has(k))
    .map((k) => ({ label: STYLE_ROW[k].label, glyph: STYLE_ROW[k].glyph, run: format(k) }));
}

// ── The menu ───────────────────────────────────────────────────────────────

interface MenuProps {
  view: EditorView;
  x: number;
  y: number;
  onClose: () => void;
}

/** Flat list of the rows the keyboard walks, in visual order. */
function flatten(groups: Group[]): { group: number; row: number }[] {
  const out: { group: number; row: number }[] = [];
  groups.forEach((g, gi) => g.rows.forEach((_, ri) => out.push({ group: gi, row: ri })));
  return out;
}

/** Which colour tier the reader last chose, for the session. A per-menu state
 *  would forget between two right-clicks on the same paragraph, and a setting
 *  would travel to a co-author — this is neither: it is which of two shelves
 *  this reader is reaching for right now. */
let literalInk = false;

function SelectionMenu({ view, x, y, onClose }: MenuProps) {
  useStore((s) => s.language); // re-render the strings on a live language flip
  const theme = useStore((s) => s.theme);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(0);
  const [swatch, setSwatch] = useState(0);
  const [page, setPage] = useState<PageId>("root");
  const [literal, setLiteral] = useState(literalInk);
  // Read once per opening: the row that flips it closes the menu behind it.
  const toolbar = selectionToolbarEnabled();
  // The vocabulary of the note this menu was opened over. One view per menu,
  // and a view's format never changes under it (a `.tex` note gets its own
  // editor state), so the SHAPE is read once; the two switches are the only
  // things that move it, and they move it in place.
  const pages = useMemo(
    () =>
      pagesFor(syntaxOf(view.state), {
        literal,
        toggleLiteral: () => {
          literalInk = !literalInk;
          setLiteral(literalInk);
          setSwatch(0);
        },
        toolbar,
      }),
    [view, literal, toolbar],
  );
  const groups = pages[page];
  const flat = useMemo(() => flatten(groups), [groups]);
  const chips = useMemo(() => swatchesFor(literal), [literal]);
  const light = /^(parchment|sandstone|linen|solar)$/.test(theme);
  const rtl = document.documentElement.getAttribute("dir") === "rtl";

  // THE MENU IS CLAMPED INTO THE VIEWPORT AND OPENS TOWARD THE READING
  // DIRECTION — the tree's context menu already had to learn this, for the
  // same reason: in Arabic (and whenever a reader pins the sidebar right) the
  // pointer is regularly at the trailing edge, and a menu that only ever grew
  // that way lost its last group off-screen. Measured after the render, from
  // the real box, and re-measured when a submenu changes the height under it.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const M = 8;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = rtl ? x - w : x;
    if (left + w > window.innerWidth - M) left = x - w;
    if (left < M) left = Math.min(M, window.innerWidth - w - M);
    left = Math.max(M, Math.min(left, window.innerWidth - w - M));
    let top = y;
    if (top + h > window.innerHeight - M) top = y - h;
    top = Math.max(M, Math.min(top, window.innerHeight - h - M));
    setPos({ left, top });
    // Focus AFTER the placement lands, never on mount: the shell learned this
    // twice already (a hidden element cannot take focus, and a popover that
    // has not been placed does not exist yet). Without it Esc lands on the
    // page and the menu cannot be closed from the keyboard at all.
    el.focus();
  }, [x, y, rtl, page]);

  // Keep the highlighted row on screen as ↑↓ walk past the fold.
  useEffect(() => {
    boxRef.current
      ?.querySelector<HTMLElement>(".s-selmenu__row--active")
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const rowAt = (i: number): Row => groups[flat[i].group].rows[flat[i].row];

  const run = (fn: (v: EditorView) => void): void => {
    onClose();
    fn(view);
    view.focus();
  };

  const open = (id: PageId): void => {
    setPage(id);
    setActive(0);
    setSwatch(0);
  };

  const enter = (row: Row): void => {
    if (row.kind === "action") run(row.run);
    else if (row.kind === "page") open(row.page);
    else if (row.kind === "toggle") row.toggle();
    else {
      const chosen = chips[swatch];
      run((v) => {
        applyColor(v, chosen.value);
      });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = (d: number): void => {
      setActive((i) => (i + d + flat.length) % flat.length);
      setSwatch(0);
    };
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      // Esc leaves the submenu first. A key that closed the whole menu from
      // inside a page would punish the reader for opening one.
      if (page !== "root") open("root");
      else {
        onClose();
        view.focus();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      step(1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      setActive(flat.length - 1);
      return;
    }
    const row = rowAt(active);
    // The arrows answer the INLINE direction: in an Arabic menu the swatches
    // are laid out right-to-left and a submenu opens toward the trailing edge,
    // so the finger and the highlight have to move the same way. Same rule the
    // settings SegmentedControl follows.
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const forward = (e.key === "ArrowRight") !== rtl;
      if (row.kind === "swatches") {
        e.preventDefault();
        setSwatch((i) => (i + (forward ? 1 : -1) + chips.length) % chips.length);
        return;
      }
      if (forward && row.kind === "page") {
        e.preventDefault();
        open(row.page);
        return;
      }
      if (!forward && page !== "root") {
        e.preventDefault();
        open("root");
        return;
      }
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      enter(row);
    }
  };

  let index = -1;
  return (
    <div
      className="s-selmenu-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
          view.focus();
        }
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={boxRef}
        className="s-selmenu"
        role="menu"
        aria-label={t("selMenuTitle")}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={
          pos
            ? { left: `${pos.left}px`, top: `${pos.top}px` }
            : { left: "-9999px", top: "0px" }
        }
      >
        {page !== "root" && (
          <button
            type="button"
            className="s-selmenu__back"
            onClick={() => open("root")}
          >
            <span className="s-selmenu__chev" aria-hidden="true">
              ‹
            </span>
            <span className="s-selmenu__label">{t("selMenuBack")}</span>
          </button>
        )}
        {groups.map((group, gi) => (
          <section className="s-selmenu__group" key={group.title ?? `g${gi}`}>
            {group.title && <h3 className="s-selmenu__title">{t(group.title)}</h3>}
            {group.rows.map((row) => {
              index += 1;
              const i = index;
              const on = i === active;
              const cls = `s-selmenu__row${on ? " s-selmenu__row--active" : ""}`;
              // Hover never moves the keyboard highlight without the pointer
              // actually moving — the palette's bug, and the theme picker
              // refused to reproduce it either. It is also the ONLY thing that
              // lights a row: the generic `button:hover` used to paint
              // --bg-hover, which was the active row's own ground, so the row
              // under the finger and the row Enter would run looked equally
              // chosen and were regularly not the same row.
              const hover = { onMouseMove: () => setActive(i) };
              if (row.kind === "action") {
                return (
                  <button
                    type="button"
                    role="menuitem"
                    key={row.label}
                    className={cls}
                    {...hover}
                    onClick={() => run(row.run)}
                  >
                    <span className="s-selmenu__label">{t(row.label)}</span>
                    {row.keys && <span className="s-selmenu__keys">{row.keys}</span>}
                  </button>
                );
              }
              if (row.kind === "page") {
                return (
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    key={row.label}
                    className={cls}
                    {...hover}
                    onClick={() => open(row.page)}
                  >
                    <span className="s-selmenu__label">{t(row.label)}</span>
                    <span className="s-selmenu__chev" aria-hidden="true">
                      ›
                    </span>
                  </button>
                );
              }
              if (row.kind === "toggle") {
                return (
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={row.on}
                    key={row.label}
                    className={cls}
                    title={row.note ? t(row.note) : undefined}
                    {...hover}
                    onClick={row.toggle}
                  >
                    <span
                      className={`s-selmenu__check${
                        row.on ? " s-selmenu__check--on" : ""
                      }`}
                      aria-hidden="true"
                    >
                      ✓
                    </span>
                    <span className="s-selmenu__label">{t(row.label)}</span>
                  </button>
                );
              }
              return (
                <div
                  key="swatches"
                  className={`s-selmenu__swatches${
                    on ? " s-selmenu__swatches--active" : ""
                  }`}
                  role="group"
                  aria-label={t(literal ? "colorFixed" : "colorThemeAware")}
                  title={t(literal ? "colorFixedNote" : "colorThemeAwareNote")}
                  {...hover}
                >
                  {chips.map((s, si) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={s.id}
                      className={`s-selmenu__chip${
                        s.value === null ? " s-selmenu__chip--none" : ""
                      }${on && si === swatch ? " s-selmenu__chip--active" : ""}`}
                      style={
                        s.value === null
                          ? undefined
                          : { background: light ? s.light : s.dark }
                      }
                      title={t(COLOR_LABEL[s.id])}
                      aria-label={t(COLOR_LABEL[s.id])}
                      onMouseMove={() => {
                        setActive(i);
                        setSwatch(si);
                      }}
                      onClick={() =>
                        run((v) => {
                          applyColor(v, s.value);
                        })
                      }
                    />
                  ))}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

// ── Mounting ───────────────────────────────────────────────────────────────
// On <body>, like the theme picker and the toasts: the menu is summoned from
// a CodeMirror event handler, which is outside every React tree in the app.

let host: HTMLDivElement | null = null;
let root: Root | null = null;

export function closeSelectionMenu(): void {
  if (!host || !root) return;
  const h = host;
  const r = root;
  host = null;
  root = null;
  // Later tick: React refuses to unmount a root while it is rendering, and
  // this is called from inside the menu's own handlers.
  setTimeout(() => {
    r.unmount();
    h.remove();
  }, 0);
}

export function openSelectionMenu(view: EditorView, x: number, y: number): void {
  if (host) closeSelectionMenu();
  host = document.createElement("div");
  host.className = "s-selmenu-host";
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <SelectionMenu view={view} x={x} y={y} onClose={closeSelectionMenu} />,
  );
}

export function isSelectionMenuOpen(): boolean {
  return host !== null;
}

// ── The floating toolbar ───────────────────────────────────────────────────

/** A CodeMirror ViewPlugin would have to re-measure on every scroll; a plain
 *  DOM strip parented to the editor's scroller does the same job in a tenth of
 *  the code and is positioned from the selection's own client rect, which is
 *  the only thing that can be right when the selection spans a wrapped row. */
class SelectionToolbar {
  private el: HTMLDivElement | null = null;
  private frame = 0;

  constructor(private view: EditorView) {
    window.addEventListener("vellum:seltoolbar", this.schedule);
    // The strip is placed from the selection's CLIENT rect, so it has to
    // follow the scroller as well as the selection — otherwise it hangs in
    // the air over the paragraph the reader has just scrolled away from.
    view.scrollDOM.addEventListener("scroll", this.schedule, { passive: true });
    window.addEventListener("resize", this.schedule);
    this.schedule();
  }

  update(u: ViewUpdate): void {
    if (u.selectionSet || u.docChanged || u.focusChanged || u.geometryChanged) {
      this.schedule();
    }
  }

  schedule = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.paint());
  };

  paint(): void {
    const view = this.view;
    const sel = view.state.selection.main;
    const show =
      !sel.empty &&
      selectionToolbarEnabled() &&
      view.hasFocus &&
      !isSelectionMenuOpen();
    if (!show) {
      this.el?.remove();
      this.el = null;
      return;
    }
    const box = this.selectionBox();
    if (!box) return;
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.className = "s-seltool";
      this.el.setAttribute("role", "toolbar");
      this.el.setAttribute("aria-label", t("selToolbarLabel"));
      for (const item of toolbarFor(syntaxOf(view.state))) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `s-seltool__btn s-seltool__btn--${item.label}`;
        b.textContent = item.glyph;
        b.title = t(item.label);
        b.setAttribute("aria-label", t(item.label));
        // mousedown, not click: a click would have already destroyed the
        // selection this toolbar exists to act on.
        b.addEventListener("mousedown", (ev) => {
          ev.preventDefault();
          item.run(view);
          view.focus();
        });
        this.el.appendChild(b);
      }
      const more = document.createElement("button");
      more.type = "button";
      more.className = "s-seltool__btn s-seltool__more";
      more.textContent = "…";
      more.title = t("selMenuTitle");
      more.setAttribute("aria-label", t("selMenuTitle"));
      more.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        const r = more.getBoundingClientRect();
        openSelectionMenu(view, r.left, r.bottom + 4);
      });
      this.el.appendChild(more);
      document.body.appendChild(this.el);
    }
    // Centred over the selection, lifted above it, and clamped — the same 8px
    // margin the menu uses. A toolbar that opens off-screen is a toolbar that
    // is not there.
    const el = this.el;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = (box.left + box.right) / 2 - w / 2;
    // Clamped to the PROSE COLUMN first and the window second. Clamping to the
    // window alone put the strip at x=4 at 768 — outside the column, against
    // the viewport edge, acting on text it was no longer over.
    const col = this.view.contentDOM.getBoundingClientRect();
    const lo = Math.max(8, Math.min(col.left, window.innerWidth - w - 8));
    const hi = Math.max(lo, Math.min(col.right - w, window.innerWidth - w - 8));
    left = Math.max(lo, Math.min(left, hi));
    // VERTICAL AVOIDANCE. The strip flips when the band above it is OCCUPIED,
    // not only when that band is off-screen: double-clicking a word on a
    // paragraph's first line used to land the toolbar squarely on the
    // preceding heading's baseline, because `top < 8` was the only test and
    // the heading was at top = 300. Below the selection is the reader's own
    // paragraph, which is the lesser collision by a wide margin.
    let top = box.top - h - 8;
    // The floor is the SCROLLER's top, not the window's: above it is the tab
    // bar, which is chrome the strip may not sit on either.
    const floor = Math.max(8, this.view.scrollDOM.getBoundingClientRect().top);
    if (top < floor || this.occupied(top, top + h, left, left + w, sel.from)) {
      top = box.bottom + 8;
    }
    if (top + h > window.innerHeight - 8) {
      top = Math.max(8, Math.min(box.top - h - 8, window.innerHeight - h - 8));
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  /** The selection's own rectangle, unioned from its client rects.
   *
   *  `coordsAtPos(from)` and `coordsAtPos(to)` describe two CARETS, not a
   *  selection. Triple-click a line and both carets land at column 0, so
   *  their midpoint is the column's left EDGE: measured, a toolbar at
   *  x=302.5–494 over a selection spanning 398–948 — floating in the prose
   *  gutter, clear of the text it acts on. The DOM selection knows the real
   *  shape, every wrapped row of it, so the union of its rects is what the
   *  strip centres over. The carets remain the fallback for the case the DOM
   *  selection cannot answer (a selection outside the rendered viewport). */
  private selectionBox(): { left: number; right: number; top: number; bottom: number } | null {
    const view = this.view;
    const rects: { left: number; right: number; top: number; bottom: number }[] = [];
    const dom = view.dom.ownerDocument.getSelection();
    if (dom && dom.rangeCount > 0 && !dom.isCollapsed) {
      for (const r of dom.getRangeAt(0).getClientRects()) {
        if (r.width === 0 && r.height === 0) continue;
        rects.push(r);
      }
    }
    if (rects.length === 0) {
      const sel = view.state.selection.main;
      const from = view.coordsAtPos(sel.from);
      const to = view.coordsAtPos(sel.to);
      if (!from || !to) return null;
      rects.push(from, to);
    }
    const box = rects.reduce((a, r) => ({
      left: Math.min(a.left, r.left),
      right: Math.max(a.right, r.right),
      top: Math.min(a.top, r.top),
      bottom: Math.max(a.bottom, r.bottom),
    }));
    // A selection can run off the top or bottom of the scroller; the strip
    // belongs over the part of it the reader can see.
    const sc = view.scrollDOM.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      top: Math.max(box.top, sc.top),
      bottom: Math.min(box.bottom, sc.bottom),
    };
  }

  /** Is anything RENDERED in the band the toolbar wants, other than the line
   *  the selection starts on?
   *
   *  Asked of the PAINTED DOM, in a nine-point grid across the band, because
   *  the question is about ink and not about the document model: CodeMirror's
   *  line blocks tile the document with no gaps, so "which line is at this
   *  offset" answers "the one above" for every band and "occupied" for every
   *  selection. A `.cm-line` box, by contrast, is where a line's text and its
   *  own rules actually are — the space between two lines belongs to
   *  `.cm-content` and is genuinely empty. The strip is taken out of
   *  hit-testing for the duration so it cannot answer for itself. */
  private occupied(
    top: number,
    bottom: number,
    left: number,
    right: number,
    selFrom: number,
  ): boolean {
    const view = this.view;
    const el = this.el;
    const ownNode = view.domAtPos(selFrom).node;
    const ownLine =
      (ownNode instanceof Element ? ownNode : ownNode.parentElement)?.closest(".cm-line") ?? null;
    const prior = el?.style.pointerEvents ?? "";
    if (el) el.style.pointerEvents = "none";
    try {
      for (const y of [top + 2, (top + bottom) / 2, bottom - 2]) {
        for (const x of [left + 4, (left + right) / 2, right - 4]) {
          const hit = document.elementFromPoint(x, y);
          const line = hit?.closest(".cm-line") ?? null;
          if (!line || line === ownLine) continue;
          // A BLANK SOURCE LINE PAINTS NOTHING. Markdown puts one between
          // every pair of blocks, so counting it as occupied would flip the
          // strip below on essentially every selection in the document —
          // avoidance that avoids nothing.
          if ((line.textContent ?? "").trim() === "") continue;
          return true;
        }
      }
      return false;
    } finally {
      if (el) el.style.pointerEvents = prior;
    }
  }

  destroy(): void {
    window.removeEventListener("vellum:seltoolbar", this.schedule);
    window.removeEventListener("resize", this.schedule);
    this.view.scrollDOM.removeEventListener("scroll", this.schedule);
    cancelAnimationFrame(this.frame);
    this.el?.remove();
  }
}

/** The editor extension: the right-click door, the keyboard door, and the
 *  floating toolbar. Added in editor/setup.ts. */
export function selectionMenu(): Extension {
  return [
    Prec.high(
      EditorView.domEventHandlers({
        contextmenu(event, view) {
          // Only over a selection: with nothing selected the browser's own
          // menu (spelling suggestions, paste, the dictionary) is the better
          // answer, and taking it away would be theft.
          if (view.state.selection.main.empty) return false;
          event.preventDefault();
          openSelectionMenu(view, event.clientX, event.clientY);
          return true;
        },
        // Shift+F10 and the Menu key are the keyboard's context menu on every
        // platform; a menu reachable only by right-click is a menu half the
        // readers of this app cannot open at all.
        keydown(event, view) {
          const menuKey =
            event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
          if (!menuKey || view.state.selection.main.empty) return false;
          event.preventDefault();
          const sel = view.state.selection.main;
          const coords = view.coordsAtPos(sel.head) ?? view.coordsAtPos(sel.from);
          if (!coords) return false;
          openSelectionMenu(view, coords.left, coords.bottom + 4);
          return true;
        },
      }),
    ),
    // A ViewPlugin so the strip dies with the editor: it is parented to
    // <body> (it has to escape the scroller's overflow), so nothing else would
    // ever take it down, and a tab switch would leave one behind per note.
    ViewPlugin.define((view) => new SelectionToolbar(view)),
  ];
}

export default SelectionMenu;
