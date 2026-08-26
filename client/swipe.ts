// Follow-finger swipes for the phone shell.
//
// WHY THIS EXISTS, in the owner's words: "on a phone you cannot swipe to open
// anything." Below the drawer breakpoint the notes sidebar is an overlay whose
// only door was a 30px ☰ in the corner of the tab bar — and the sidebar IS the
// vault's navigation. Every phone-shaped app the reader already uses (Obsidian
// mobile above all) opens that pane by dragging the page sideways, so a reader
// arriving from one of them tries the drag first, gets nothing, and concludes
// the app has no navigation. The button stays exactly where it is; this is the
// second door, not a replacement for the first.
//
// WHAT IT DOES. A horizontal pan anywhere in the shell drags the drawer WITH
// the finger — interruptible at any point, reversible mid-gesture, and
// committed on release by distance (a third of the drawer) or by a flick.
// The outline pane on the opposite edge answers the mirrored pan. Directions
// are LOGICAL: which edge each pane sits on is measured from its own box, so
// Arabic mirrors without a second code path (see `sideOf`).
//
// WHERE IT LIVES IN THE BUILD. client/main.tsx reaches this module through
// `import()` behind `(pointer: coarse)`, the same split the desktop menu uses:
// a mouse must not download a touch gesture, and the entry chunk's budget has
// about a kilobyte of headroom. Its stylesheet rides in the same chunk for the
// same reason. The cost to a desktop first paint is the one-line guard.

import "./styles/swipe.css";
import { DRAWER_QUERY, useStore } from "./state.ts";

/** Android's system back gesture owns a strip down each side of the screen,
 *  and iOS's interactive-pop owns the leading one. A pan that starts inside
 *  either strip belongs to the OS: claiming it means the reader's "go back"
 *  sometimes moves a sidebar instead, which is the kind of unreliability that
 *  makes people stop using gestures at all. 24px is Android's own gutter. */
const EDGE = 24;

/** How far a finger travels before the pan has a direction. Under this it is
 *  a tap, a long-press, or the first pixel of a vertical scroll. */
const SLOP = 12;

/** px/ms. A short fast flick commits even when it never covered a third of
 *  the drawer — that is what makes the gesture feel like it has weight rather
 *  than a tripwire at 33%. */
const FLICK = 0.5;

/** Fraction of the drawer's width that commits a slow drag on release. */
const COMMIT = 1 / 3;

/** The shell surfaces a pan may start on. Everything modal in this app — the
 *  palette, settings, the trash, the attachment viewer, every context menu —
 *  is a SIBLING of these inside `.s-app`, so this one test is also what stops
 *  a swipe across an open dialog from moving the shell underneath it. */
const SURFACES = ".s-main, .s-sidebar, .s-drawer-backdrop, .s-panel, .s-statusbar";

const drawerMq = window.matchMedia(DRAWER_QUERY);

/** The gesture's two classes live on <html>, NOT on `.s-app`.
 *
 *  React owns the shell's className and rewrites it whole on every store
 *  change — an SSE event, the sync badge, the save that lands mid-drag — so a
 *  class parked there would be silently erased in the middle of a gesture and
 *  the drawer would blink out from under the finger. The document element is
 *  nobody's render output; state.ts already writes the theme there for the
 *  same reason. */
const root = document.documentElement;

interface Pan {
  /** The drawer follows the finger; the outline pane commits on release. */
  drawer: boolean;
  /** True when this gesture OPENS its pane, false when it closes it. */
  opening: boolean;
  /** The pane's own edge as a direction: -1 left, +1 right. */
  side: number;
  el: HTMLElement;
  width: number;
  x0: number;
  /** Last sample, for the release velocity. */
  x: number;
  t: number;
  vx: number;
  /** 0 = closed, 1 = open. */
  p: number;
}

let start: { x: number; y: number; el: Element } | null = null;
let pan: Pan | null = null;
let settleTimer = 0;

/** Which edge a pane sits on, MEASURED rather than derived. The answer is a
 *  function of the document direction, the reader's sidebar-side preference
 *  and the breakpoint, and the stylesheet is the only thing that knows all
 *  three at once; a box cannot disagree with what is on the screen. This is
 *  the whole of the RTL story — in Arabic the drawer's box is on the right, so
 *  every comparison below flips with it and there is no second code path.
 *  Returns the direction that moves TOWARD that edge. */
function sideOf(el: Element): number {
  const r = el.getBoundingClientRect();
  return r.left + r.width / 2 < window.innerWidth / 2 ? -1 : 1;
}

/** The outline pane, but only where a swipe could actually reveal it. Below
 *  700px it is `display: none` and has no boxes at all — asking the layout
 *  instead of mirroring the breakpoint keeps that number in the stylesheet,
 *  where it already lives twice. */
function usablePanel(): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(".s-panel");
  return el && el.getClientRects().length > 0 ? el : null;
}

/** Is there a horizontal scroller under the finger with room left to move
 *  THAT way? A table wider than the phone, an unwrapped code fence, any
 *  overflowing strip: the swipe belongs to that element until it reaches its
 *  end, and only then to the shell. Ancestors, because the touch lands on a
 *  <td> and the scrollport is three levels up. */
function scrollableIn(from: Element, dir: number): boolean {
  for (let el: Element | null = from; el && el !== document.body; el = el.parentElement) {
    const range = el.scrollWidth - el.clientWidth;
    if (range > 1) {
      // A finger moving right drags the content right, which DECREASES
      // scrollLeft. The reachable range is 0…range in LTR and −range…0 in RTL,
      // so the element's own direction says which end is which.
      const rtl = getComputedStyle(el).direction === "rtl";
      if (dir > 0 ? el.scrollLeft > (rtl ? -range : 0) + 1 : el.scrollLeft < (rtl ? 0 : range) - 1) {
        return true;
      }
    }
  }
  return false;
}

/** What a pan in `dir` should move, given what is on screen right now.
 *
 *  Four rules over one axis, in this order — no carousel, no pane travel:
 *
 *   1. An OPEN DRAWER answers nothing but its own close. It covers the shell
 *      behind a scrim, and a pane the reader cannot see is not a pane they
 *      can be aiming at.
 *   2. CLOSE WHAT IS OPEN BEFORE OPENING ANYTHING ELSE — the same rule the
 *      scrim's tap already follows.
 *   3. Open the drawer. It outranks the outline pane because it is the
 *      phone's navigation, which settles the one configuration where the two
 *      share an edge (sidebar pinned to the panel's side): the drawer takes
 *      the direction and the pane keeps its chevron.
 *   4. Open the outline pane. */
function plan(dir: number): Pan | null {
  const s = useStore.getState();
  const sidebar = document.querySelector<HTMLElement>(".s-sidebar");
  if (!sidebar) return null;
  const sbSide = sideOf(sidebar);
  if (s.sidebarOpen) {
    return dir === sbSide ? begin(sidebar, sbSide, false, true) : null;
  }
  const panel = usablePanel();
  const pSide = panel ? sideOf(panel) : 0;
  if (panel && !s.panelCollapsed && dir === pSide) return begin(panel, pSide, false, false);
  if (dir === -sbSide) return begin(sidebar, sbSide, true, true);
  if (panel && s.panelCollapsed && dir === -pSide) return begin(panel, pSide, true, false);
  return null;
}

function begin(
  el: HTMLElement,
  side: number,
  opening: boolean,
  drawer: boolean,
): Pan | null {
  // Both panes are measured while they may be off-screen or clipped to zero,
  // so each is asked for the box that keeps its real width: the drawer's own
  // (it is translated, not shrunk) and, for the outline pane, the fixed-width
  // header the collapse clips. A zero here means the pane is not laid out at
  // all and there is nothing to drag.
  const width = drawer
    ? el.offsetWidth
    : (el.querySelector<HTMLElement>(".s-panel-header")?.offsetWidth ?? 0);
  if (width < 1) return null;
  if (drawer) {
    // A gesture begun INSIDE the previous one's 220ms settle owns the drawer
    // now: without this, the older timer would fire mid-drag and hand the
    // transform back to the stylesheet with a finger still on the screen.
    clearTimeout(settleTimer);
    // `s-swipe` makes the closed drawer paintable and hands its transform to
    // this module; `s-swipe--pan` takes the transition off for the length of
    // the drag, because while the finger is down the drawer IS the finger and
    // there is nothing to animate. The transition comes back on release —
    // that is the spring.
    root.classList.add("s-swipe", "s-swipe--pan");
  }
  return {
    drawer,
    opening,
    side,
    el,
    width,
    x0: 0,
    x: 0,
    t: 0,
    vx: 0,
    p: opening ? 0 : 1,
  };
}

function paint(p: Pan): void {
  p.el.style.transform = `translateX(${p.side * (1 - p.p) * p.width}px)`;
  root.style.setProperty("--swipe-p", `${p.p}`);
}

/** Undo everything this module wrote, once the release animation has run.
 *  By now React has committed `.s-app--drawer` (or removed it), so the
 *  stylesheet's own transform equals the inline one and dropping it is
 *  invisible. */
function clear(p: Pan): void {
  p.el.style.transform = "";
  root.style.removeProperty("--swipe-p");
  root.classList.remove("s-swipe", "s-swipe--pan");
}

function onStart(e: TouchEvent): void {
  start = null;
  // Multi-touch is a pinch or a two-finger scroll, never a drawer pan.
  if (pan || e.touches.length !== 1 || !drawerMq.matches) return;
  // Zen is chrome-less by contract: it takes the ☰ away too, and a mode whose
  // whole promise is "nothing but the words" must not answer a stray drag
  // with a sidebar. Esc and the ✕ are the way out, as they always were.
  if (useStore.getState().zen) return;
  const t = e.touches[0];
  const el = t.target as Element | null;
  if (!el?.closest?.(SURFACES)) return;
  if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
  // A live text selection in the editor means the finger is probably on a
  // selection handle, and dragging one is a horizontal gesture that already
  // has an owner. Stealing it would make text un-selectable on a phone.
  if (el.closest(".cm-editor") && !window.getSelection()?.isCollapsed) return;
  start = { x: t.clientX, y: t.clientY, el };
}

function onMove(e: TouchEvent): void {
  if (e.touches.length !== 1) {
    if (pan) release(false);
    start = null;
    return;
  }
  const t = e.touches[0];

  if (pan) {
    const now = e.timeStamp;
    const dt = now - pan.t;
    if (dt > 0) pan.vx = (t.clientX - pan.x) / dt;
    pan.x = t.clientX;
    pan.t = now;
    // Distance in the OPENING direction, as a fraction of the pane's width.
    // Clamped, so an over-drag past either end stops moving the pane and a
    // drag reversed mid-gesture is read as the reversal it is.
    const moved = (t.clientX - pan.x0) * -pan.side;
    pan.p = Math.min(1, Math.max(0, (pan.opening ? moved : pan.width + moved) / pan.width));
    // The outline pane is a GRID COLUMN, not an overlay: following the finger
    // would mean re-laying out the centre column — and re-measuring the whole
    // editor inside it — on every frame. It commits on release instead and
    // rides its own 0.18s width transition, which is the same movement the
    // chevron already produces.
    if (pan.drawer) paint(pan);
    // Only now, and only for a gesture that has already proved it is
    // horizontal: the shell must never be the reason a page stops scrolling.
    e.preventDefault();
    return;
  }

  if (!start) return;
  const dx = t.clientX - start.x;
  const dy = t.clientY - start.y;
  // VERTICAL INTENT WINS. Reading is a vertical act and scrolling is the
  // gesture under every finger on every screen; a sideways drawer that
  // sometimes eats a scroll is worse than no drawer. Undecided while both
  // deltas are inside the slop — a real horizontal pan starts with a few
  // pixels of wobble.
  if (Math.abs(dy) > Math.abs(dx)) {
    if (Math.abs(dy) > SLOP) start = null;
    return;
  }
  if (Math.abs(dx) < SLOP) return;
  const dir = dx > 0 ? 1 : -1;
  if (scrollableIn(start.el, dir)) {
    start = null;
    return;
  }
  const p = plan(dir);
  start = null;
  if (!p) return;
  pan = p;
  // The pan is anchored where the direction was DECIDED, not where the finger
  // landed: anchoring at touchstart would make the drawer jump the slop
  // distance out of the edge on the first painted frame.
  p.x0 = t.clientX;
  p.x = t.clientX;
  p.t = e.timeStamp;
  e.preventDefault();
}

function release(commitAllowed: boolean): void {
  const p = pan;
  pan = null;
  if (!p) return;
  // How far the pane travelled from where this gesture found it.
  const travel = p.opening ? p.p : 1 - p.p;
  // A flick is velocity in the gesture's OWN direction, so a drag that
  // reverses at the last moment springs back instead of committing.
  const flick = p.vx * (p.opening ? -p.side : p.side) > FLICK;
  const commit = commitAllowed && (travel >= COMMIT || flick);
  const s = useStore.getState();
  if (commit) {
    if (p.drawer) s.setSidebarOpen(p.opening);
    else s.setPanelCollapsed(!p.opening);
  }
  if (!p.drawer) return;
  // Hold the drawer where the release found it and let the stylesheet's own
  // 0.2s ease carry it home (or, under prefers-reduced-motion, snap it —
  // swipe.css takes the transition away and this same code path becomes an
  // instant move). `--pan` off is what puts the transition back.
  p.p = commit === p.opening ? 1 : 0;
  root.classList.remove("s-swipe--pan");
  paint(p);
  clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => clear(p), 220);
}

/** Install the gesture layer. Returns its own undo, for symmetry with every
 *  other installer in the client; nothing calls it today. */
export function installSwipe(): () => void {
  const opts = { capture: true, passive: true } as const;
  const move = { capture: true, passive: false } as const;
  const end = (): void => release(true);
  const cancel = (): void => {
    start = null;
    release(false);
  };
  document.addEventListener("touchstart", onStart, opts);
  document.addEventListener("touchmove", onMove, move);
  document.addEventListener("touchend", end, opts);
  document.addEventListener("touchcancel", cancel, opts);
  return () => {
    document.removeEventListener("touchstart", onStart, opts);
    document.removeEventListener("touchmove", onMove, move);
    document.removeEventListener("touchend", end, opts);
    document.removeEventListener("touchcancel", cancel, opts);
  };
}
