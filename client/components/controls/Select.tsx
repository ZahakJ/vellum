// The select. One control, used for every closed-set choice in the product.
//
// Why it exists at all: the settings panel was built out of native <select>
// and <input type="checkbox">, and a native control is not themeable. It draws
// the OPERATING SYSTEM's chrome inside a candlelit manuscript room — a rounded
// blue-grey pill on macOS, a flat grey box on Windows, a different one again
// on GTK — which is what the owner of the production instance meant by "super
// .com bubbly". Worse, a native popup is a WINDOW: it opens outside the page,
// so a list of twenty-seven fonts inside a 740px panel rendered as an
// OS-drawn column running off the bottom of the screen, unstyleable,
// unpositionable, and unable to show what a typeface looks like.
//
// So: a styled trigger, and a popover that is ours.
//
//   · ANCHORED and CONSTRAINED. Fixed-positioned at the trigger, clamped into
//     the viewport with an 8px margin, height capped to the space actually
//     available, and FLIPPED above the trigger when there is more room there.
//     It can never leave the window and it never escapes the panel it belongs
//     to. It re-measures on scroll and resize, so it stays on its trigger.
//   · A PORTAL, on <body>. The panel is `overflow: hidden` and its body is a
//     scroller: an in-flow popover would be clipped by the first and dragged
//     by the second. (Portals still bubble events through the REACT tree, so
//     the popover stops mouse events itself — otherwise a click inside it
//     would reach the settings overlay's close handler.)
//   · KEYBOARD-first. ↑↓ move, Home/End jump, Enter commits, Esc reverts to
//     the value the popover opened with, type-ahead jumps by prefix (in lists
//     with no filter field). Moving the highlight APPLIES the value live, the
//     way the theme picker previews a theme — which is what lets the font
//     specimen answer "what does this look like" while the list is still open.
//   · ARIA listbox: a combobox trigger, a labelled listbox, optional groups,
//     `aria-activedescendant` on whichever element holds focus.
//   · RTL by construction: logical properties, and the popover aligns to the
//     trigger's INLINE-START edge, which is its right edge in Arabic.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
// Aliased like SettingsModal does: the DOM KeyboardEvent is a different type
// and both are in scope here.
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { t } from "../../i18n.ts";
import { attachScrollFade } from "../../scrollFade.ts";
import type { ControlIdentity } from "./Fields.tsx";

export interface SelectOption {
  value: string;
  /** The choice, in the reader's language (or a proper noun: a family name). */
  label: string;
  /** Trailing muted text on the same row — the raw id behind a human name. */
  note?: string;
  /** A second line under the label, in `face` — the font picker's specimen. */
  sample?: string;
  sampleDir?: "ltr" | "rtl";
  /** CSS font-family for this row's label and sample. An option that names a
   *  TYPEFACE has to be drawn in it; a list of trademarks in the UI font is
   *  not a font picker. */
  face?: string;
  /** The label's own direction, when it is machine text (a family name). */
  labelDir?: "ltr" | "rtl";
}

export interface SelectGroup {
  id: string;
  label: string;
  options: SelectOption[];
}

interface SelectProps extends ControlIdentity {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectGroup[];
  disabled?: boolean;
  /** Accessible name for the trigger and the listbox (the row's label). */
  label: string;
  /** Offer a filter field inside the popover. For long lists only — it takes
   *  the keyboard, so type-ahead stands down while it is there. */
  filter?: boolean;
  filterPlaceholder?: string;
  /** The groups currently RENDERED, as they change (open, filter). The font
   *  picker uses it to fetch a group's faces the first time it is shown. */
  onVisibleGroups?: (ids: string[]) => void;
  /** The trigger's value is machine text (a font family) and keeps its own
   *  direction inside an Arabic panel. */
  valueDir?: "ltr";
  /** Draw the trigger's current value in its own face too. */
  valueFace?: string;
  /** Extra class on the trigger (the font picker's taller row). */
  triggerClass?: string;
  /** Lay the options out as a GRID of specimen cards instead of a column of
   *  rows. For the font picker and nothing else: its rows are two lines tall,
   *  so a 27-family catalog was judged three and a half faces at a time. */
  grid?: boolean;
}

/** The tabbables inside `scope`, in document order — for Tab out of an open
 *  list (see `onKey`). Deliberately a small local rule rather than a library:
 *  the settings panel holds buttons, inputs and our own controls, and nothing
 *  in it uses a positive tabindex. */
function tabbablesIn(scope: HTMLElement): HTMLElement[] {
  const sel =
    'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
    'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  return [...scope.querySelectorAll<HTMLElement>(sel)].filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

/** How many popovers are open right now. The settings panel's Esc listener is
 *  registered on `window` in the CAPTURE phase and therefore runs before
 *  anything inside it: without this it would close the whole panel on the Esc
 *  that was meant to close a list. Same problem, same shape of answer, as
 *  `isThemePickerOpen()`. */
let openPopovers = 0;

export function isSelectOpen(): boolean {
  return openPopovers > 0;
}

const MAX_POPOVER_HEIGHT = 340;
const MIN_POPOVER_HEIGHT = 150;
const EDGE_MARGIN = 8;
const MIN_POPOVER_WIDTH = 240;
/** A grid of specimen cards needs two columns' worth of measure, or the
 *  specimen line it exists to show is ellipsized in both of them — measured:
 *  at 460 the wider Latin faces cut "The vault is open — 0123" to "… vault is
 *  open — 0123", which is a specimen of the ellipsis. */
const MIN_GRID_WIDTH = 540;

interface Placement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  flipped: boolean;
}

export function Select({
  value,
  onChange,
  options,
  groups,
  disabled,
  label,
  filter,
  filterPlaceholder,
  onVisibleGroups,
  valueDir,
  valueFace,
  triggerClass,
  grid,
  id,
  "aria-describedby": describedBy,
}: SelectProps) {
  const baseId = useId();
  const listId = `${baseId}-list`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(value);
  const [place, setPlace] = useState<Placement | null>(null);
  /** The value the popover opened with — what Esc and an outside click go
   *  back to, because moving the highlight applies the value live. */
  const openedWith = useRef(value);
  /** `close` is a stable callback and must not go stale on the highlight. */
  const activeRef = useRef(value);
  activeRef.current = active;
  const typeahead = useRef({ text: "", at: 0 });

  const allGroups: SelectGroup[] = useMemo(
    () => groups ?? [{ id: "all", label: "", options: options ?? [] }],
    [groups, options],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return allGroups.filter((group) => group.options.length > 0);
    return allGroups
      .map((group) => ({
        ...group,
        options: group.options.filter((option) =>
          `${option.label} ${option.note ?? ""}`.toLowerCase().includes(q),
        ),
      }))
      .filter((group) => group.options.length > 0);
  }, [allGroups, query]);

  const flat = useMemo(() => shown.flatMap((group) => group.options), [shown]);
  const current = useMemo(
    () => allGroups.flatMap((group) => group.options).find((option) => option.value === value),
    [allGroups, value],
  );

  /** Tell the owner which groups are on screen, so it can load their faces.
   *  Keyed on the id list, not the array identity — the memo above rebuilds
   *  on every keystroke. */
  /** Filtering moves the highlight to the first match, the way the palette
   *  resets to row 0: a highlight left on a row the filter has removed makes
   *  Enter commit something that is not on screen. It is the HIGHLIGHT only —
   *  no live apply — because the preview should follow a deliberate ↑↓, not
   *  every letter of a search. */
  useEffect(() => {
    if (!open || query.trim() === "") return;
    if (flat.some((option) => option.value === active)) return;
    if (flat.length > 0) setActive(flat[0].value);
  }, [open, query, flat, active]);

  const visibleKey = shown.map((group) => group.id).join("|");
  useEffect(() => {
    if (!open || !onVisibleGroups) return;
    onVisibleGroups(visibleKey === "" ? [] : visibleKey.split("|"));
  }, [open, visibleKey, onVisibleGroups]);

  const measure = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // The BOUNDS are the SCROLLING REGION this control lives in — not the
    // dialog around it. "Fits correctly within the settings screen bounds" is
    // the complaint this control set answers, and clamping to the dialog met
    // it only in the middle: a long list still ran over the footer divider and
    // the Close / Save row, which are chrome the reader has to be able to
    // reach WHILE choosing. Any host may opt in by carrying
    // `[data-popbounds]` (the settings panel puts it on its body scroller);
    // the dialog is the fallback, and the viewport bounds both, so a panel
    // taller than the window still cannot push the list off screen.
    const host = (
      trigger.closest("[data-popbounds]") ?? trigger.closest('[role="dialog"]')
    )?.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // A STICKY BLOCK IS NOT ROOM. The typography tab pins its live specimen to
    // the top of the scroller, and at 1280×800 in Arabic the Arabic-face
    // picker flipped ABOVE its trigger and covered the specimen's last line —
    // defeating the live preview that justifies applying the value on
    // highlight in the first place. A host marks such a block
    // `[data-popclear]` and the room above the trigger starts below it.
    const clear = trigger
      .closest("[data-popbounds]")
      ?.querySelector<HTMLElement>("[data-popclear]")
      ?.getBoundingClientRect();
    const boundsTop = Math.max(0, host?.top ?? 0, clear?.bottom ?? 0);
    const boundsBottom = Math.min(vh, host?.bottom ?? vh);
    const boundsLeft = Math.max(0, host?.left ?? 0);
    const boundsRight = Math.min(vw, host?.right ?? vw);
    const room = boundsBottom - boundsTop - EDGE_MARGIN * 2;
    const below = boundsBottom - rect.bottom - EDGE_MARGIN;
    const above = rect.top - boundsTop - EDGE_MARGIN;
    // The height this list WANTS, capped by the room the bounds actually have
    // — so the MIN_POPOVER_HEIGHT floor below is a floor, never a licence to
    // overflow the box we just promised to stay inside.
    const want = Math.max(MIN_POPOVER_HEIGHT, Math.min(MAX_POPOVER_HEIGHT, room));
    // Three placements, tried in order. Below the trigger; flipped above it;
    // and — when NEITHER side of the trigger can hold a usable list — the
    // whole clear region, overlaying the trigger itself. That third case is
    // what a native select has always done, and it is the difference between
    // judging ten typefaces and judging three: clamping to the panel body
    // (which is what keeps the list off the Close / Save row) leaves a picker
    // near the foot of the tab barely 150px of room on its best side, while
    // 340px of clear region sits unused above it. The trigger is the one thing
    // safe to cover: its value is the ticked row inside the list, and the
    // specimen this list is judged against is `[data-popclear]` and therefore
    // outside the region entirely.
    const fitsBelow = below >= want;
    const fitsAbove = above >= want;
    const overlay = !fitsBelow && !fitsAbove;
    const maxHeight = overlay ? want : Math.max(MIN_POPOVER_HEIGHT, Math.min(want, fitsBelow ? below : above));
    const top = overlay
      ? Math.max(boundsTop + EDGE_MARGIN, Math.min(rect.top - 4, boundsBottom - EDGE_MARGIN - maxHeight))
      : fitsBelow
        ? rect.bottom + 4
        : Math.max(boundsTop + EDGE_MARGIN, rect.top - maxHeight - 4);
    // `flipped` is the ENTRY ANIMATION's direction, so it follows where the
    // popover actually ended up rather than which branch chose it.
    const flipped = top < rect.top;
    const width = Math.min(
      Math.max(rect.width, grid ? MIN_GRID_WIDTH : MIN_POPOVER_WIDTH),
      boundsRight - boundsLeft - EDGE_MARGIN * 2,
    );
    // Anchored to the trigger's INLINE-START edge, then clamped into the
    // bounds — in Arabic that edge is the trigger's right one.
    const rtl = getComputedStyle(trigger).direction === "rtl";
    const raw = rtl ? rect.right - width : rect.left;
    const left = Math.max(
      boundsLeft + EDGE_MARGIN,
      Math.min(raw, boundsRight - width - EDGE_MARGIN),
    );
    setPlace({ top, left, width, maxHeight, flipped });
  }, [grid]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
  }, [open, measure, visibleKey]);

  useEffect(() => {
    if (!open) return;
    openPopovers += 1;
    const onScroll = (): void => measure();
    // Capture: the panel body is the scroller, not the window.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      openPopovers -= 1;
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, measure]);

  const close = useCallback(
    (commit: boolean, chosen?: string) => {
      // Commit takes the HIGHLIGHTED row, not whatever the live preview last
      // painted: filtering moves the highlight without applying it (a value
      // that changed on every keystroke of "amir" would be four saves' worth
      // of noise), so Enter has to be the thing that says which row won.
      //
      // `chosen` is not a convenience — it is the whole correctness of the
      // POINTER path. `activeRef` is assigned during RENDER, so a handler that
      // calls `setActive(v)` and then closes in the same tick still reads the
      // PREVIOUS highlight here: a click on a row set the value and this line
      // immediately put it back, and every mouse pick in the panel silently
      // did nothing. (Only the keyboard worked, because ↑↓ commit on a later
      // keystroke, by which time the render has landed.) A row that answers
      // the keyboard and ignores the mouse is worse than a native select, so
      // the caller that already knows which row won says so outright.
      onChange(commit ? (chosen ?? activeRef.current) : openedWith.current);
      setOpen(false);
      setQuery("");
      triggerRef.current?.focus();
    },
    [onChange],
  );

  /** Outside pointer: a DOM listener, because the popover is a portal and its
   *  React events bubble to the panel, not to the page. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [open, close]);

  const openList = useCallback(() => {
    if (disabled) return;
    openedWith.current = value;
    setActive(value);
    setQuery("");
    setOpen(true);
  }, [disabled, value]);

  /** The popover renders only once it has been PLACED (the first pass has no
   *  measurement yet), so anything that reaches into its DOM has to wait for
   *  that pass — not merely for `open`. Focusing on `open` alone silently did
   *  nothing, left focus on the trigger, and took the whole keyboard contract
   *  with it: Esc landed outside the popover and never closed it, and every
   *  keystroke meant for the filter went to a button. Same failure the shell's
   *  "focus AFTER the reveal lands" rule documents, one component down. */
  const placed = open && place !== null;

  /** The list's own scroll boundaries fade rather than slice — the rows
   *  arriving under the sticky filter field were cut mid-glyph. Re-attached on
   *  `visibleKey` because filtering changes what there is to scroll. */
  useEffect(() => {
    if (!placed) return;
    return attachScrollFade(listRef.current);
  }, [placed, visibleKey]);

  /** Keep the highlighted row in view — including the one the list opens on. */
  useEffect(() => {
    if (!placed) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [placed, active, visibleKey]);

  useEffect(() => {
    if (!placed) return;
    // Focus follows the control that takes the typing: the filter field when
    // there is one, otherwise the list itself.
    const target = filter ? inputRef.current : listRef.current;
    target?.focus({ preventScroll: true });
  }, [placed, filter]);

  const move = useCallback(
    (delta: number, absolute?: "first" | "last") => {
      if (flat.length === 0) return;
      const at = flat.findIndex((option) => option.value === active);
      let next = absolute === "first" ? 0 : absolute === "last" ? flat.length - 1 : at + delta;
      if (at < 0 && absolute === undefined) next = delta > 0 ? 0 : flat.length - 1;
      next = Math.max(0, Math.min(flat.length - 1, next));
      const option = flat[next];
      setActive(option.value);
      // Live, like the theme picker: the specimen under this control is the
      // whole reason the list is open, and it can only answer if the value
      // moves with the highlight. Esc puts it back.
      onChange(option.value);
    },
    [active, flat, onChange],
  );

  const onKey = useCallback(
    (e: ReactKeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        close(true);
        return;
      }
      // TAB COMMITS AND THEN ADVANCES — otherwise it is Enter wearing another
      // key's name. It used to `close(true)` and stop there, and `close`
      // returns focus to the trigger, so Tab left the reader exactly where
      // Enter left them: on the control they had just finished with, one key
      // short of the next row. (Shift+Tab was not handled at all, and since
      // the popover is a portal on <body>, the browser's own Tab from inside
      // it would have walked off the end of the document rather than through
      // the panel.) So: commit, then step to the next tabbable in the same
      // bounds, once the trigger has actually taken focus back.
      if (e.key === "Tab") {
        e.preventDefault();
        const trigger = triggerRef.current;
        const back = e.shiftKey;
        close(true);
        requestAnimationFrame(() => {
          if (!trigger) return;
          const scope =
            trigger.closest<HTMLElement>("[data-popbounds]") ??
            trigger.closest<HTMLElement>('[role="dialog"]') ??
            document.body;
          const stops = tabbablesIn(scope);
          const at = stops.indexOf(trigger);
          const next = stops[at + (back ? -1 : 1)];
          next?.focus();
        });
        return;
      }
      const steps: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 };
      if (e.key in steps) {
        e.preventDefault();
        move(steps[e.key]);
        return;
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        move(0, e.key === "Home" ? "first" : "last");
        return;
      }
      // Type-ahead, but only where the keyboard is free: a filter field IS the
      // type-ahead, and two of them fighting over the same keystrokes is the
      // worst of both.
      if (!filter && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const now = Date.now();
        const text = (now - typeahead.current.at < 800 ? typeahead.current.text : "") + e.key.toLowerCase();
        typeahead.current = { text, at: now };
        const hit = flat.find((option) => option.label.toLowerCase().startsWith(text));
        if (hit) {
          e.preventDefault();
          setActive(hit.value);
          onChange(hit.value);
        }
      }
    },
    [close, filter, flat, move, onChange],
  );

  const optionId = (v: string): string => `${baseId}-opt-${v.replace(/[^A-Za-z0-9_-]/g, "_")}`;

  const popover = open && place && (
    <div
      ref={popoverRef}
      className={`s-ctl-pop${place.flipped ? " s-ctl-pop--up" : ""}${grid ? " s-ctl-pop--grid" : ""}`}
      style={{
        top: `${place.top}px`,
        left: `${place.left}px`,
        width: `${place.width}px`,
        maxHeight: `${place.maxHeight}px`,
      }}
      // A portal's React events bubble through the COMPONENT tree, so without
      // this a click in here would reach the settings overlay's close handler.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKey}
    >
      {filter && (
        <div className="s-ctl-pop__filter">
          <input
            ref={inputRef}
            className="s-ctl-input s-ctl-pop__field"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={active ? optionId(active) : undefined}
            aria-label={label}
            value={query}
            placeholder={filterPlaceholder ?? t("filterPlaceholder")}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      <div
        ref={listRef}
        id={listId}
        className="s-ctl-pop__list s-scrollfade"
        role="listbox"
        aria-label={label}
        tabIndex={filter ? -1 : 0}
        aria-activedescendant={active ? optionId(active) : undefined}
      >
        {shown.length === 0 && <div className="s-ctl-pop__empty">{t("noMatchesDot")}</div>}
        {shown.map((group) => (
          <div className="s-ctl-pop__group" key={group.id} role="group" aria-label={group.label || label}>
            {group.label !== "" && <div className="s-ctl-pop__grouplabel">{group.label}</div>}
            {/* One wrapper per group so `--grid` can lay the options out in
                columns WITHIN a group: a grid spanning the group headings
                would put "Arabic — naskh" beside a serif face. */}
            <div className="s-ctl-pop__opts">
            {group.options.map((option) => (
              <div
                key={option.value}
                id={optionId(option.value)}
                role="option"
                aria-selected={option.value === value}
                data-active={option.value === active ? "true" : undefined}
                className={`s-ctl-pop__opt${option.value === active ? " s-ctl-pop__opt--on" : ""}`}
                // mousemove, not mouseenter: the popover materializes under
                // wherever the pointer already is, and a highlight that moves
                // without the pointer moving is the palette's own old bug.
                onMouseMove={() => {
                  if (option.value !== active) {
                    setActive(option.value);
                    onChange(option.value);
                  }
                }}
                onClick={() => {
                  setActive(option.value);
                  close(true, option.value);
                }}
              >
                <span className="s-ctl-pop__optmain">
                  {/* Same isolate rule as the sample below and as every
                      note-derived label in the product: the ROW keeps the
                      panel's direction (so the label starts at the panel's
                      start edge) and only the Latin family name is isolated.
                      `dir="ltr"` on the label element itself also set its
                      ALIGNMENT, which left-aligned "Reem Kufi" inside a
                      full-width box in an Arabic panel — the name and the
                      sample it belongs to ended up at opposite edges. */}
                  <span
                    className="s-ctl-pop__optlabel"
                    style={option.face ? { fontFamily: option.face } : undefined}
                  >
                    {option.labelDir ? <bdi dir={option.labelDir}>{option.label}</bdi> : option.label}
                  </span>
                  {option.note && <span className="s-ctl-pop__optnote">{option.note}</span>}
                </span>
                {option.sample && (
                  // The row keeps the PANEL's direction and the sample is an
                  // inline isolate inside it, exactly like the specimen block:
                  // `dir="rtl"` on the element itself would also set its
                  // ALIGNMENT, flinging an Arabic sample to the far edge of the
                  // row while the family name it belongs to stayed at the near
                  // one. Two things being compared have to start at the same
                  // place.
                  <span
                    className="s-ctl-pop__optsample"
                    style={option.face ? { fontFamily: option.face } : undefined}
                  >
                    <bdi dir={option.sampleDir ?? "auto"}>{option.sample}</bdi>
                  </span>
                )}
                {option.value === value && (
                  <span className="s-ctl-pop__check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </div>
            ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        id={id}
        aria-label={id ? undefined : label}
        aria-describedby={describedBy}
        disabled={disabled}
        className={`s-ctl s-ctl-select${open ? " s-ctl-select--open" : ""}${triggerClass ? ` ${triggerClass}` : ""}`}
        onClick={() => (open ? close(true) : openList())}
        onKeyDown={(e) => {
          // While the list is open the trigger answers to the SAME handler the
          // popover uses. Focus should be inside the popover by then, but a
          // control whose keyboard contract depends on where focus happened to
          // land is a control that loses its Esc — and Esc is the one key here
          // that must never miss.
          if (open) {
            onKey(e);
            return;
          }
          if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openList();
          }
        }}
      >
        <span
          className="s-ctl-select__value"
          style={valueFace ? { fontFamily: valueFace } : undefined}
        >
          {valueDir ? <bdi dir={valueDir}>{current?.label ?? value}</bdi> : (current?.label ?? value)}
        </span>
        {current?.note && <span className="s-ctl-select__note">{current.note}</span>}
        <svg className="s-ctl-select__chev" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M4 6.5 L8 10.5 L12 6.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {popover && createPortal(popover, document.body)}
    </>
  );
}
