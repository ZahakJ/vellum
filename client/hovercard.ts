// Shared hover-preview popover: rest the pointer on a link that names a note
// and the note's rendered opening floats beside it, so a reader can skim a
// post without leaving the page they are on. Prior art is the editor's
// wikilink card (client/editor/hoverPreview.ts) — this is the same idea
// unbound from CodeMirror, driven by plain event delegation so ONE install
// covers every link surface a shell has (lists, cards, related, prev/next,
// search results) without touching a single component.
//
// Two things separate it from the editor's card:
//   - It SCROLLS. The editor's tooltip is a glance; this one is an invitation
//     to read on, so the body is a scroll container and the pointer may travel
//     into it (hence the leave grace period, and why wheel events inside the
//     card must not close it).
//   - It knows nothing about notes. The caller supplies `resolve` (element →
//     note path) and `render` (path → body element), which is what keeps the
//     visitor scoping honest: the fetch stays on the caller's visitor-scoped
//     API client, and a note the server refuses simply never opens a card.
//
// Deliberately inert where a hover is not a hover: coarse pointers, where a
// "hover" is a tap that should just navigate. prefers-reduced-motion is NOT a
// reason to withhold it — a reader who asked for less movement asked about the
// 140ms fade (hovercard.css drops it), not about a content feature.
//
// Keyboard readers get the same card: a link focused by Tab (`:focus-visible`,
// so a mouse click never doubles as a hover) opens one and carries an
// `aria-describedby` to it, which is what makes the `role="tooltip"` true.

import "./styles/hovercard.css";

const OPEN_MS = 350;
/** Grace after pointer-leave so the pointer can travel into the card. */
const CLOSE_MS = 180;
const EDGE = 12; // viewport margin the card keeps
/** Gap between the card and the link it belongs to. */
const GAP = 8;
/** Flip above the link once the room up there beats the room below by this
 *  much — a margin, so a card does not seesaw on a pixel of scroll. */
const FLIP_BIAS = 1.25;
/** Smallest card worth opening at all, even in a cramped corner. */
const MIN_ROOM = 140;
/** Tallest a card may grow, as a fraction of the viewport. */
const MAX_VH = 0.72;
/** Rendered bodies kept for the session. A card is one detached DOM tree per
 *  note; on a 1,388-note vault an evening of browsing would otherwise keep
 *  every one of them. */
const CACHE_MAX = 24;

export interface HoverCardConfig {
  /** Delegation root — only links inside it get previews. */
  root: HTMLElement;
  /** The hovered element (or an ancestor) → vault note path, or null. */
  resolve: (el: Element) => string | null;
  /** Build the card's body for a path. Null (or a throw) = no card at all —
   *  which is how a note the visitor may not read stays invisible. */
  render: (path: string) => Promise<HTMLElement | null>;
  /** Heading shown above the body (the note title). */
  title: (path: string) => string;
  /** Scroll container to dismiss on (plus window scroll). */
  scroller?: HTMLElement | null;
}

/** True when hover previews would be noise rather than help: a touch screen,
 *  where "hover" is a tap that should navigate. */
function unwanted(): boolean {
  return matchMedia("(pointer: coarse)").matches;
}

let cardSeq = 0;

/** Install hover previews on `root`. Returns a disposer that also drops the
 *  render cache — callers re-install (new cache) when the language changes,
 *  since the rendered chrome inside a note carries t() strings. */
export function installHoverCards(config: HoverCardConfig): () => void {
  if (unwanted()) return () => {};

  const cache = new Map<string, HTMLElement>();
  let card: HTMLElement | null = null;
  let anchor: Element | null = null;
  let openPath: string | null = null;
  let openTimer = 0;
  let closeTimer = 0;
  /** Bumped on every close so a late render() cannot resurrect a dead card. */
  let generation = 0;

  const clearTimers = (): void => {
    window.clearTimeout(openTimer);
    window.clearTimeout(closeTimer);
    openTimer = 0;
    closeTimer = 0;
  };

  /** Discard whatever is in flight WITHOUT touching a standing card: bumping
   *  the generation is the only cancellation token `open()` has once its
   *  `await config.render(path)` is running, and clearing `openTimer` does
   *  nothing after the timer has already fired. Every early return that means
   *  "the reader has moved on" must come through here, or a slow render mounts
   *  a card at an anchor the pointer left — with no pointerleave to ever close
   *  it, since the pointer was never inside it. */
  const cancelPending = (): void => {
    window.clearTimeout(openTimer);
    openTimer = 0;
    generation++;
  };

  const close = (): void => {
    clearTimers();
    generation++;
    if (card) {
      card.remove();
      card = null;
    }
    anchor?.removeAttribute("aria-describedby");
    anchor = null;
    openPath = null;
  };

  /** Mark which edges of the body have more prose past them. Without this the
   *  card is a window whose glass is invisible: prose is severed mid-line at
   *  the bottom edge and, once scrolled, a half-height slice of a line sits
   *  flush under the title rule. The fades say "there is more here" on both
   *  counts — and they are the affordance, because a scrollbar that only
   *  exists while the pointer is inside the card is not one. */
  const syncFade = (body: HTMLElement): void => {
    const over = body.scrollHeight - body.clientHeight;
    if (over <= 1) {
      body.dataset.fade = "none";
      return;
    }
    const top = body.scrollTop > 2;
    const bottom = body.scrollTop < over - 2;
    body.dataset.fade = top && bottom ? "both" : top ? "top" : "bottom";
  };

  /** Place the card beside its anchor: into whichever room is bigger, and
   *  clamped into the viewport on the inline axis. Alignment starts from the
   *  anchor's INLINE-START edge, so the card hangs off the right of a link in
   *  an RTL page and the left in an LTR one. */
  const place = (el: HTMLElement, rect: DOMRect): void => {
    const rtl = getComputedStyle(document.documentElement).direction === "rtl";
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // Measure at the natural size before deciding which way to open. The room
    // on each side is what is left AFTER the 8px the card stands off its
    // anchor — count it once here, or the card lands 8px past the margin it
    // was supposed to keep from the viewport edge.
    el.style.maxHeight = "";
    const w = el.offsetWidth;
    const below = vh - rect.bottom - EDGE - GAP;
    const above = rect.top - EDGE - GAP;
    // COMPARE THE ROOMS. A threshold ("flip only when there are fewer than
    // 180px below") answers the wrong question: a link in the middle of the
    // page has 310px below and 519px above, clears the threshold, and opens
    // downward into the smaller room — a card cut off mid-line at the window
    // edge, which reads as clipped by the browser rather than as a container
    // with more inside it. The bias keeps a near-tie from seesawing.
    const flip = above > below * FLIP_BIAS;
    const room = Math.max(MIN_ROOM, flip ? above : below);
    // …and a ceiling, because a card that spans the whole window stops
    // reading as a preview of the page and starts reading as the page. The
    // old 60vh was fine as a ceiling; it was never reachable because the
    // ROOM was the binding constraint, and now it usually is not.
    el.style.maxHeight = `${Math.min(room, Math.round(vh * MAX_VH))}px`;
    const h = el.offsetHeight;

    let left = rtl ? rect.right - w : rect.left;
    left = Math.min(Math.max(left, EDGE), Math.max(EDGE, vw - w - EDGE));
    const top = flip ? Math.max(EDGE, rect.top - h - GAP) : rect.bottom + GAP;

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
    el.classList.toggle("s-hovercard--flip", flip);
  };

  const open = async (target: Element, path: string): Promise<void> => {
    const gen = ++generation;
    const el = document.createElement("div");
    el.className = "s-hovercard";
    el.setAttribute("role", "tooltip");

    const head = document.createElement("div");
    head.className = "s-hovercard__title";
    head.dir = "auto"; // the note's own title decides its direction
    head.textContent = config.title(path);

    const body = document.createElement("div");
    body.className = "s-hovercard__body";

    let rendered = cache.get(path) ?? null;
    if (!rendered) {
      let built: HTMLElement | null = null;
      try {
        built = await config.render(path);
      } catch {
        built = null;
      }
      if (gen !== generation) return; // pointer left (or moved on) meanwhile
      if (!built) return; // refused / empty — no card, no trace
      // Oldest-first eviction: a Map iterates in insertion order, and a re-hit
      // re-inserts below, so the cache holds the last CACHE_MAX notes read.
      if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next();
        if (!oldest.done) cache.delete(oldest.value);
      }
      cache.set(path, built);
      rendered = built;
    } else {
      cache.delete(path);
      cache.set(path, rendered); // freshen: this note is the most recent again
    }
    if (gen !== generation) return;

    body.replaceChildren(rendered);
    // Nothing inside a preview is a tab stop, the same way nothing inside it
    // is a click target (hovercard.css kills its pointer-events): the card is
    // a glance at a note, and a keyboard reader tabbing off a link must land
    // on the next link of the PAGE, never inside the quotation of one.
    for (const stop of body.querySelectorAll<HTMLElement>("a, button, [tabindex], input, select, textarea")) {
      stop.tabIndex = -1;
    }
    el.append(head, body);
    // The card lives at the document root, not inside the delegation root:
    // it must escape the shell's scroll container and its stacking contexts.
    // That also puts it outside `root`'s listeners, so it carries its own —
    // entering the card is what cancels the pending dismiss.
    el.addEventListener("pointerenter", () => {
      window.clearTimeout(closeTimer);
      closeTimer = 0;
    });
    el.addEventListener("pointerleave", () => {
      window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(close, CLOSE_MS);
    });
    body.addEventListener("scroll", () => syncFade(body), { passive: true });
    document.body.appendChild(el);
    card = el;
    anchor = target;
    openPath = path;
    // The role="tooltip" only describes something once something points at it.
    el.id = `s-hovercard-${++cardSeq}`;
    target.setAttribute("aria-describedby", el.id);

    place(el, target.getBoundingClientRect());
    syncFade(body);
    // Two frames: the first paints the card at rest, the second lets the
    // entrance transition run (a bare class flip in the same frame does not).
    requestAnimationFrame(() => {
      // Guard on the card itself, not the generation: a pointer that leaves
      // the link in the frame between append and paint cancels the pending
      // work (bumping the generation) while this card legitimately stands —
      // and a card left at opacity 0 is a card that never fades out either.
      if (card === el) el.classList.add("s-hovercard--in");
    });
  };

  const onOver = (ev: PointerEvent): void => {
    if (ev.pointerType !== "mouse") return;
    const target = ev.target as Element | null;
    if (!target) return;

    const path = config.resolve(target);
    if (path === null) {
      if (card) {
        window.clearTimeout(closeTimer);
        closeTimer = window.setTimeout(close, CLOSE_MS);
      }
      cancelPending();
      return;
    }
    if (path === openPath && anchor && anchor.contains(target)) {
      window.clearTimeout(closeTimer); // back on the same link
      closeTimer = 0;
      return;
    }

    // A different link: the standing card goes on the same grace timer, and
    // the new one waits out the full rest interval.
    const hit = (target.closest("a, button, [data-preview-path]") ?? target) as Element;
    window.clearTimeout(openTimer);
    openTimer = window.setTimeout(() => {
      close();
      void open(hit, path);
    }, OPEN_MS);
  };

  const onOut = (ev: PointerEvent): void => {
    if (ev.pointerType !== "mouse") return;
    const to = ev.relatedTarget as Node | null;
    if (to && (card?.contains(to) || anchor?.contains(to))) return;
    cancelPending();
    if (!card) return;
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(close, CLOSE_MS);
  };

  // Keyboard route in and out. `:focus-visible` is what keeps a mouse click
  // from opening a second card under the pointer: a clicked link is focused
  // too, but it is not focus-VISIBLE.
  const onFocusIn = (ev: FocusEvent): void => {
    const target = ev.target as Element | null;
    if (!(target instanceof HTMLElement)) return;
    if (!target.matches(":focus-visible")) return;
    const path = config.resolve(target);
    if (path === null) return;
    if (path === openPath && anchor === target) return;
    close(); // clears the timers too, so the wait below is the only one
    openTimer = window.setTimeout(() => void open(target, path), OPEN_MS);
  };

  const onFocusOut = (ev: FocusEvent): void => {
    const to = ev.relatedTarget as Node | null;
    if (to && card?.contains(to)) return;
    if (anchor && ev.target === anchor) close();
    else cancelPending();
  };

  const onScroll = (ev: Event): void => {
    // Scrolling INSIDE the card is the whole point of it — only page scroll
    // dismisses.
    if (card && ev.target instanceof Node && card.contains(ev.target)) return;
    close();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") close();
  };

  const { root } = config;
  root.addEventListener("pointerover", onOver as EventListener);
  root.addEventListener("pointerout", onOut as EventListener);
  root.addEventListener("focusin", onFocusIn as EventListener);
  root.addEventListener("focusout", onFocusOut as EventListener);
  root.addEventListener("click", close);
  window.addEventListener("scroll", onScroll, true);
  config.scroller?.addEventListener("scroll", onScroll);
  window.addEventListener("resize", close);
  window.addEventListener("keydown", onKey);

  return () => {
    close();
    cache.clear();
    root.removeEventListener("pointerover", onOver as EventListener);
    root.removeEventListener("pointerout", onOut as EventListener);
    root.removeEventListener("focusin", onFocusIn as EventListener);
    root.removeEventListener("focusout", onFocusOut as EventListener);
    root.removeEventListener("click", close);
    window.removeEventListener("scroll", onScroll, true);
    config.scroller?.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", close);
    window.removeEventListener("keydown", onKey);
  };
}
