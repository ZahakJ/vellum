// A SCROLL BOUNDARY MUST FADE, NOT GUILLOTINE.
//
// Every scroller in the settings surface cut its content with a flat edge:
// at the top of the panel body a segmented pill was sliced through its middle
// with its accent border cut square, which reads as a rendering fault rather
// than as "there is more above"; the popover list did the same under its
// sticky filter field; and the typography tab's sticky specimen let the tops
// of the row scrolling underneath show through as a band of disconnected
// glyph fragments. In Arabic that band is worst of all — the tashkeel sit well
// above and below the baseline, so what survives a hard cut is a line of loose
// marks belonging to no letter.
//
// The fix is one alpha mask at each end, applied ONLY where there is something
// to fade: a list short enough to fit keeps full contrast at both ends, which
// is why this is a scroll listener and not a static gradient. The mask itself
// lives in `.s-scrollfade` (app.css); this module only maintains the two data
// attributes that switch it on.

/** Paint the two data attributes `.s-scrollfade` keys off, now. */
function sync(el: HTMLElement): void {
  // 1px of tolerance: fractional scroll positions (a trackpad, a zoomed page,
  // a device pixel ratio that is not 1) never land exactly on 0 or on the
  // scroll height, and a fade that flickers at rest is worse than no fade.
  const above = el.scrollTop > 1;
  const below = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
  el.dataset.moreAbove = above ? "true" : "false";
  el.dataset.moreBelow = below ? "true" : "false";
}

/** Keep `el`'s fade honest for as long as it is mounted. Returns the teardown,
 *  so a React effect can `return attachScrollFade(node)` directly. */
export function attachScrollFade(el: HTMLElement | null): () => void {
  if (!el) return () => {};
  sync(el);
  const onScroll = (): void => sync(el);
  el.addEventListener("scroll", onScroll, { passive: true });
  // The content changes under it too — switching tabs, filtering a list,
  // revealing the size-adjust row — and none of those are a scroll event.
  const ro = new ResizeObserver(onScroll);
  ro.observe(el);
  for (const child of el.children) ro.observe(child);
  const mo = new MutationObserver(() => {
    onScroll();
    for (const child of el.children) ro.observe(child);
  });
  mo.observe(el, { childList: true, subtree: true, characterData: true });
  return () => {
    el.removeEventListener("scroll", onScroll);
    ro.disconnect();
    mo.disconnect();
  };
}
