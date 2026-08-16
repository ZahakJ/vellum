// THE SECTION BOARD — the page, as a stack of cards you can pick up.
//
// It is the surface the whole designer is judged on: a home page is an ORDER
// before it is anything else, and an order you cannot rearrange with your hand
// is a list of settings pretending to be a design tool.
//
// FOUR THINGS ARE NOT NEGOTIABLE HERE, and each one is a bug this component
// exists to not have:
//
//  * THREE WAYS TO MOVE A ROW, and all three are first-class. Drag it by the
//    grip; press the ↑/↓ buttons; or lift it with the KEYBOARD (Space on the
//    grip, arrows to move, Space or Esc to set it down). The buttons are not a
//    small-screen fallback — a control that exists only on one input device is
//    a control half the readers do not have — and the keyboard lift is not a
//    consolation prize: it moves the row the same way the drag does and says
//    so out loud through a live region.
//  * A DRAG SHOWS WHERE IT WILL LAND. The lifted card follows the pointer and
//    a drop indicator sits in the slot the row will take. The list used to
//    reorder LIVE on `dragenter`, which reads as the page rearranging itself
//    under a pointer that has not committed to anything; a caret in the gap is
//    both calmer and more honest, because the arrangement only changes when
//    the reader lets go.
//  * MOVING A ROW KEEPS THE FOCUS ON THAT ROW. Reordering is a repeated
//    gesture ("down, down, down"), and a list that drops focus after each
//    press turns three presses into three hunts for the button.
//  * A LOCKED ROW STILL MOVES. It cannot be switched off or removed, and its
//    switch and ✕ are absent rather than disabled — an inert control is a
//    question the reader has to answer twice.
//
// POINTER EVENTS, NOT HTML5 DRAG. `draggable` gives a browser-drawn ghost
// nobody can style, no touch support worth the name, and a `dragenter` stream
// that fires against the row UNDER the ghost rather than under the finger.
// Pointer events are one code path for mouse, pen and touch, and the "ghost"
// is the row itself, lifted.

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Toggle } from "../controls/Fields.tsx";
import { localeNum, t, tf } from "../../i18n.ts";
import SectionGlyph from "./SectionGlyph.tsx";

export interface ListRow {
  id: string;
  type: string;
  enabled: boolean;
}

interface Props<T extends ListRow> {
  items: T[];
  label: (item: T) => string;
  desc: (item: T) => string;
  /** Locked rows keep their position controls and lose their switch and ✕. */
  locked?: (item: T) => boolean;
  renderOptions: (item: T) => ReactNode;
  onReorder: (from: number, to: number) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onRemove?: (id: string) => void;
  /** What stands where the rows would be when there are none. An empty list is
   *  the FIRST thing a new design shows, so it is an invitation the host
   *  writes, not an apology this component improvises. */
  empty?: ReactNode;
}

/** A drag in flight. `to` is an INSERTION index into the unchanged array
 *  (0…n), which is what the indicator draws and what the drop translates. */
interface Drag {
  id: string;
  from: number;
  pointerId: number;
  /** Where the pointer went down, and where it is now — the difference is the
   *  lifted card's own transform. */
  startY: number;
  dy: number;
  to: number;
  /** The lifted card's own height plus the list gap: how far the rows it
   *  passes have to move to open a slot for it. */
  height: number;
  /** Where the scrolling column stood when the geometry was measured. The
   *  rows were measured in VIEWPORT coordinates, so every pixel the pane
   *  scrolls afterwards (it follows the pointer at its edges) is a pixel the
   *  measurements are out by — and a drag that reads a stale table drops the
   *  card two rows from where the reader aimed it. */
  scrollTop: number;
}

/** How close to the edge of the scrolling column the pointer has to get before
 *  the column follows it, and how fast it then goes (px per pointer event). */
const EDGE = 48;
const EDGE_STEP = 12;

export default function SectionList<T extends ListRow>({
  items,
  label,
  desc,
  locked,
  renderOptions,
  onReorder,
  onToggle,
  onRemove,
  empty,
}: Props<T>) {
  // One row open at a time: a composer whose every row is expanded is a long
  // form, which is the shape this list exists instead of.
  const [openId, setOpenId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The row a KEYBOARD lift is holding. Same fact as `drag`, different
   *  device: the row moves as the arrows are pressed, so there is no separate
   *  "to" — the list is already in the arrangement the reader is watching. */
  const [lifted, setLifted] = useState<string | null>(null);
  /** The row that just landed. Drives a 180ms settle, so a move is something
   *  the eye can follow rather than a list that is suddenly different. */
  const [settled, setSettled] = useState<string | null>(null);
  /** What the live region is saying. Every move speaks, because a reorder a
   *  screen reader cannot hear is a reorder that did not happen. */
  const [say, setSay] = useState("");
  const listRef = useRef<HTMLUListElement | null>(null);
  /** Row geometry, measured ONCE when a drag starts. Re-measuring on every
   *  move would read the lifted row's own transform back as layout. */
  const rects = useRef<{ top: number; bottom: number }[]>([]);
  // The row a keyboard move just relocated; focus follows it after the
  // reorder has committed (a moved node loses focus when React re-keys it).
  const refocus = useRef<{ id: string; part: "name" | "grip" } | null>(null);

  useEffect(() => {
    const want = refocus.current;
    if (want === null) return;
    refocus.current = null;
    listRef.current
      ?.querySelector<HTMLElement>(
        `[data-row="${CSS.escape(want.id)}"] ${want.part === "grip" ? ".s-dsnc-grip" : ".s-dsnc-row__name"}`,
      )
      ?.focus();
  }, [items]);

  // The settle is a class, not a timer the render depends on: it clears itself
  // and a second move during it simply restarts it.
  useEffect(() => {
    if (settled === null) return;
    const id = window.setTimeout(() => setSettled(null), 220);
    return () => window.clearTimeout(id);
  }, [settled]);

  const announce = (item: T, index: number): void =>
    setSay(tf("dsnMovedTo", { name: label(item), n: localeNum(index + 1), total: localeNum(items.length) }));

  const move = (id: string, delta: number, part: "name" | "grip"): void => {
    const from = items.findIndex((item) => item.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= items.length) return;
    refocus.current = { id, part };
    setSettled(id);
    announce(items[from], to);
    onReorder(from, to);
  };

  // ── The drag ──────────────────────────────────────────────────────────────

  const beginDrag = (e: ReactPointerEvent<HTMLButtonElement>, item: T, index: number): void => {
    // Primary button only, and never while a keyboard lift is in the air.
    if (e.button !== 0 || lifted !== null) return;
    const list = listRef.current;
    if (!list) return;
    e.preventDefault();
    rects.current = [...list.children].map((row) => {
      const box = row.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom };
    });
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = rects.current[index];
    const gap = rects.current[1] && rects.current[0] ? rects.current[1].top - rects.current[0].bottom : 8;
    // The open row is NOT closed on the way into a drag: the geometry above
    // was measured with it open, and collapsing it here would move every gap
    // out from under the indicator the reader is aiming at.
    setDrag({
      id: item.id,
      from: index,
      pointerId: e.pointerId,
      startY: e.clientY,
      dy: 0,
      to: index,
      height: box ? box.bottom - box.top + gap : 0,
      scrollTop: pane()?.scrollTop ?? 0,
    });
  };

  /** The column the board scrolls inside. */
  const pane = (): HTMLElement | null =>
    listRef.current?.closest<HTMLElement>(".s-dsgr__controls") ?? null;

  /**
   * How far row `index` has to move to keep a slot open under the lifted card.
   *
   * THE GAP IS HALF THE ANSWER AND THE CARET IS THE OTHER HALF. A caret alone
   * lands under the card the reader is holding (the card follows the pointer,
   * and the pointer is over the gap); a gap alone says "somewhere around
   * here". Together they say exactly one thing: the card is going in this
   * space, between these two rows.
   */
  const shiftOf = (index: number): number => {
    if (!drag || index === drag.from) return 0;
    if (drag.to > drag.from && index > drag.from && index < drag.to) return -drag.height;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return drag.height;
    return 0;
  };

  /**
   * WHICH ROW DRAWS THE SLOT, and on which side of itself.
   *
   * The slot is always the space directly ABOVE some row, so the row below it
   * draws it — except at the end of the list, and except when that row is the
   * lifted one (its own pseudo-element travels with the card, so it would draw
   * the socket wherever the pointer is rather than where the card will land).
   * Both exceptions hang the slot UNDER the nearest row that is standing
   * still, which is the same space described from the other side.
   */
  const slot = ((): { index: number; side: "before" | "after" } | null => {
    if (!drag) return null;
    const n = items.length;
    // Dropping back where it came from is not "no indicator": the reader is
    // still holding the card, and the space it came out of is the answer.
    const idle = drag.to === drag.from || drag.to === drag.from + 1;
    const anchor = idle ? drag.from + 1 : drag.to;
    if (anchor < n && anchor !== drag.from) return { index: anchor, side: "before" };
    let below = Math.min(n - 1, anchor - 1);
    if (below === drag.from) below -= 1;
    return below >= 0 ? { index: below, side: "after" } : null;
  })();

  /** Which gap the pointer is over: the first row whose middle it has passed. */
  const slotFor = (y: number): number => {
    const boxes = rects.current;
    for (let i = 0; i < boxes.length; i++) {
      if (y < (boxes[i].top + boxes[i].bottom) / 2) return i;
    }
    return boxes.length;
  };

  const onDragMove = (e: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    // A long list is taller than the column it sits in, so the column follows
    // the pointer when the pointer reaches its edge. Without this a design
    // with twenty sections can only be reordered one screen at a time.
    const column = pane();
    if (column) {
      const box = column.getBoundingClientRect();
      if (e.clientY < box.top + EDGE) column.scrollTop -= EDGE_STEP;
      else if (e.clientY > box.bottom - EDGE) column.scrollTop += EDGE_STEP;
    }
    // Every pixel the column has scrolled since the measurement is a pixel the
    // rows have moved under the (unmoved) pointer: the drift is added to the
    // pointer for the LOOKUP and to the card for the TRANSFORM, so the card
    // stays under the finger and the slot stays under the card.
    const drift = (column?.scrollTop ?? 0) - drag.scrollTop;
    setDrag({ ...drag, dy: e.clientY - drag.startY + drift, to: slotFor(e.clientY + drift) });
  };

  const endDrag = (): void => {
    if (!drag) return;
    const { from, to, id } = drag;
    setDrag(null);
    // `to` is an insertion index in the ORIGINAL array: dropping below your own
    // slot loses one place to your own removal.
    const target = to > from ? to - 1 : to;
    if (target !== from) {
      refocus.current = { id, part: "grip" };
      setSettled(id);
      const item = items[from];
      if (item) announce(item, target);
      onReorder(from, target);
    }
  };

  if (items.length === 0 && empty) return <>{empty}</>;

  return (
    <>
      <ul
        className={`s-dsnc-list${drag ? " s-dsnc-list--dragging" : ""}`}
        ref={listRef}
        // The empty slot's own height: the lifted card's, less the list gap.
        style={drag ? ({ "--dsnc-slot": `${drag.height - 8}px` } as CSSProperties) : undefined}
      >
        {items.map((item, index) => {
          const isLocked = locked?.(item) === true;
          const open = openId === item.id;
          const dragging = drag?.id === item.id;
          const name = label(item);
          return (
            <li
              key={item.id}
              data-row={item.id}
              className={[
                "s-dsnc-row",
                item.enabled ? "" : "s-dsnc-row--off",
                open ? "s-dsnc-row--open" : "",
                dragging ? "s-dsnc-row--dragging" : "",
                lifted === item.id ? "s-dsnc-row--lifted" : "",
                settled === item.id ? "s-dsnc-row--settled" : "",
                slot?.index === index && slot.side === "before" ? "s-dsnc-row--dropbefore" : "",
                slot?.index === index && slot.side === "after" ? "s-dsnc-row--dropafter" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                dragging
                  ? { transform: `translateY(${drag.dy}px)` }
                  : drag
                    ? ({ transform: `translateY(${shiftOf(index)}px)` } as CSSProperties)
                    : undefined
              }
            >
              <div className="s-dsnc-row__head">
                {/* THE GRIP IS A BUTTON, and that is the keyboard half of the
                    feature: a `<span>` with a drag listener is a control no
                    keyboard can reach, which is how "drag to reorder" ships as
                    "reorder, if you have a mouse". */}
                <button
                  type="button"
                  className="s-dsnc-grip"
                  aria-label={tf("dsnGrabOf", { name })}
                  aria-describedby="s-dsnc-draghelp"
                  aria-pressed={lifted === item.id}
                  onPointerDown={(e) => beginDrag(e, item, index)}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      const now = lifted === item.id ? null : item.id;
                      setLifted(now);
                      setSay(
                        now
                          ? tf("dsnLifted", { name })
                          : tf("dsnMovedTo", {
                              name,
                              n: localeNum(index + 1),
                              total: localeNum(items.length),
                            }),
                      );
                      return;
                    }
                    if (e.key === "Escape" && lifted === item.id) {
                      e.preventDefault();
                      setLifted(null);
                      setSay(
                        tf("dsnMovedTo", {
                          name,
                          n: localeNum(index + 1),
                          total: localeNum(items.length),
                        }),
                      );
                      return;
                    }
                    // Arrows move a LIFTED row. Alt+arrows move any row, which
                    // is the shortcut a reader who never lifts anything uses.
                    const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
                    if (step === 0 || (lifted !== item.id && !e.altKey)) return;
                    e.preventDefault();
                    move(item.id, step, "grip");
                  }}
                  onBlur={() => {
                    // A lift ends when the reader leaves the grip — but NOT
                    // when the grip is only being handed back to itself after a
                    // move: reordering a keyed node moves it in the DOM, which
                    // blurs it, and treating that as "let go" would end the
                    // lift after every single arrow press.
                    if (refocus.current === null && lifted === item.id) setLifted(null);
                  }}
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <circle cx="6" cy="4" r="1.3" />
                    <circle cx="10" cy="4" r="1.3" />
                    <circle cx="6" cy="8" r="1.3" />
                    <circle cx="10" cy="8" r="1.3" />
                    <circle cx="6" cy="12" r="1.3" />
                    <circle cx="10" cy="12" r="1.3" />
                  </svg>
                </button>
                <span className="s-dsnc-row__mark" aria-hidden="true">
                  <span className="s-dsnc-row__n">{localeNum(index + 1)}</span>
                  <SectionGlyph kind={item.type} />
                </span>
                <button
                  type="button"
                  className="s-dsnc-row__name"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : item.id)}
                  onKeyDown={(e) => {
                    // Alt+↑/↓ is the keyboard's drag from the row itself.
                    // Plain arrows stay with the browser so the list can still
                    // be read through.
                    if (!e.altKey) return;
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      move(item.id, -1, "name");
                    } else if (e.key === "ArrowDown") {
                      e.preventDefault();
                      move(item.id, 1, "name");
                    }
                  }}
                >
                  <span className="s-dsnc-row__label">{name}</span>
                  <span className="s-dsnc-row__desc">{desc(item)}</span>
                </button>
                <div className="s-dsnc-row__tools">
                  <span className="s-dsnc-row__moves">
                    <button
                      type="button"
                      className="s-iconbtn s-dsnc-move"
                      disabled={index === 0}
                      title={t("dsnMoveUp")}
                      aria-label={tf("dsnMoveUpOf", { name })}
                      onClick={() => move(item.id, -1, "name")}
                    >
                      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M8 12.5V4M4 7.5 8 3.5l4 4" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="s-iconbtn s-dsnc-move"
                      disabled={index === items.length - 1}
                      title={t("dsnMoveDown")}
                      aria-label={tf("dsnMoveDownOf", { name })}
                      onClick={() => move(item.id, 1, "name")}
                    >
                      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M8 3.5V12M4 8.5l4 4 4-4" />
                      </svg>
                    </button>
                  </span>
                  {isLocked ? (
                    <span className="s-dsnc-locked">{t("dsnAlwaysShown")}</span>
                  ) : (
                    <>
                      <Toggle
                        value={item.enabled}
                        onChange={(next) => onToggle(item.id, next)}
                        label={tf("dsnShowOf", { name })}
                        onLabel={t("dsnShown")}
                        offLabel={t("dsnHidden")}
                      />
                      {onRemove && (
                        <button
                          type="button"
                          className="s-iconbtn s-dsnc-remove"
                          title={t("dsnRemove")}
                          aria-label={tf("dsnRemoveOf", { name })}
                          onClick={() => {
                            if (openId === item.id) setOpenId(null);
                            onRemove(item.id);
                          }}
                        >
                          <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                            <path d="M4 4l8 8M12 4l-8 8" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {/* The options open IN PLACE, under the row they belong to, and
                  they arrive rather than appear — 160ms of height and opacity,
                  which is the difference between a panel that answered and a
                  panel that flickered. */}
              {open && <div className="s-dsnc-row__opts">{renderOptions(item)}</div>}
            </li>
          );
        })}
      </ul>
      <p className="s-dsnc-draghelp" id="s-dsnc-draghelp">
        {t("dsnDragHelp")}
      </p>
      <p className="s-dsnc-say" role="status" aria-live="polite">
        {say}
      </p>
    </>
  );
}
