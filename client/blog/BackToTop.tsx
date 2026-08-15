// The ✦ that carries a reader back to the top of a long piece. Icon only —
// the star IS the affordance, and the name lives in title/aria-label so
// screen readers and tooltips get the words the page does not spend.
//
// Two behaviours worth the code:
//   - It gets out of the way. A floating corner button that lands on the
//     footer, or on the comment box a reader is typing in, is worse than no
//     button at all — so it watches the page furniture below it and lifts
//     itself above whatever is about to reach it.
//   - It respects prefers-reduced-motion completely: instant jump, no
//     shimmer, no nudge. The gold trail is delight, not information.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { t } from "../i18n.ts";
import { useStore } from "../state.ts";

/** Furniture the button must never sit on top of, nearest-first. */
const OBSTACLES = ".s-blog-footer, .s-marginalia__form";
/** Resting distance from the bottom edge (mirrors --btt-inset in blog.css). */
const REST = 24;
const GAP = 12;
/** How far the button may climb before it stops being a corner affordance.
 *  An article with comments on puts the form's top 368px above the corner, and
 *  a button that obeys that lift parks in the middle of the screen and drifts
 *  up as the reader scrolls the last two viewports — a floating control with
 *  no anchor. Past this it withdraws instead: the reader is at the end of the
 *  piece, where the footer's own links are, and Home/Ctrl-Home still work. */
const MAX_LIFT_RATIO = 0.28;

export default function BackToTop({ scroller }: { scroller: HTMLElement | null }) {
  useStore((s) => s.language); // re-render the label on a live language switch
  const [shown, setShown] = useState(false);
  const [lift, setLift] = useState(0);
  const [shimmer, setShimmer] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!scroller) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      // The button is position:fixed, so every number it cares about is in
      // VIEWPORT coordinates — not the scroller's box, which on narrow
      // layouts is itself partly scrolled out of the window.
      const vh = document.documentElement.clientHeight;
      // Lift above the nearest intruding piece of furniture. The resting
      // inset comes from the stylesheet (it shrinks on mobile), so the lift
      // lands the button exactly GAP above the obstacle at every breakpoint.
      const btn = btnRef.current;
      const inset =
        (btn && parseFloat(getComputedStyle(btn).getPropertyValue("--btt-inset"))) || REST;
      const rest = vh - inset;
      const size = btn?.getBoundingClientRect().height || 42;
      let raise = 0;
      for (const el of scroller.querySelectorAll<HTMLElement>(OBSTACLES)) {
        const box = el.getBoundingClientRect();
        // Only furniture that actually reaches the button's band counts. A
        // comment form scrolled clean off the TOP of the window is not
        // underneath anything — measuring it there is what asked the button
        // for a 1,200px lift at the foot of a commented article.
        if (box.bottom <= rest - size) continue;
        if (box.top < rest) raise = Math.max(raise, rest - box.top + GAP);
      }
      const capped = raise <= vh * MAX_LIFT_RATIO;
      setLift(capped ? Math.round(raise) : 0);
      // One viewport of scroll: far enough that "back to top" is a real
      // journey, close enough that it appears while the reader still wants it.
      // …and only while it can stay in its corner — see MAX_LIFT_RATIO.
      setShown(Math.max(scroller.scrollTop, window.scrollY) > vh * 0.9 && capped);
    };
    const onScroll = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Content arriving late (comments, images) moves the furniture without
    // any scrolling at all — the button must notice, or it parks on top of a
    // comment box that was not there when it last looked.
    const ro = new ResizeObserver(onScroll);
    ro.observe(scroller);
    const mo = new MutationObserver(onScroll);
    mo.observe(scroller, { childList: true, subtree: true });
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      ro.disconnect();
      mo.disconnect();
    };
  }, [scroller]);

  const toTop = (): void => {
    if (!scroller) return;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior = still ? "auto" : "smooth";
    scroller.scrollTo({ top: 0, behavior });
    // Narrow layouts can scroll the window as well as the shell.
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior });
    if (still) return;
    // The trail: a gold wash that runs up the button as the page travels.
    setShimmer(true);
    window.setTimeout(() => setShimmer(false), 620);
    btnRef.current?.blur(); // no focus ring left hanging at the top of the page
  };

  return (
    <button
      ref={btnRef}
      type="button"
      className={`s-btt${shown ? " s-btt--in" : ""}${shimmer ? " s-btt--go" : ""}`}
      // A custom property, not a transform: blog.css composes the lift with
      // the entrance slide and the hover nudge in one transform.
      style={{ "--btt-lift": `${lift}px` } as CSSProperties}
      title={t("blogBackToTop")}
      aria-label={t("blogBackToTop")}
      aria-hidden={!shown}
      tabIndex={shown ? 0 : -1}
      onClick={toTop}
    >
      <span className="s-btt__glyph" aria-hidden="true">
        ✦
      </span>
      <span className="s-btt__trail" aria-hidden="true" />
    </button>
  );
}
