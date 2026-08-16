// Shared accessibility primitives.
//
// Three things every surface in this app needed and none of them had in one
// place: a real focus trap that also GIVES FOCUS BACK, one honest answer to
// "does this reader want motion", and the keyboard-activation shim for the
// handful of imperative DOM nodes that are links in everything but the
// attribute that makes a browser treat them as one.
//
// The trap is a hook rather than a component because every dialog in Vellum
// already owns its own overlay markup — wrapping them would have re-laid out
// five modals to fix a keyboard bug.

import { useEffect, useRef } from "react";

/** Everything the browser will hand a Tab to, inside a container. `:not([inert])`
 *  and the negative-tabindex filter are what keep roving-tabindex widgets (the
 *  tree, the tab bar) from contributing every one of their rows to a trap. */
export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  "iframe",
  "object",
  "embed",
  "summary",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]",
].join(",");

/** Tabbable descendants of `root`, in document order, minus anything parked at
 *  tabindex="-1", hidden, or sitting inside an aria-hidden subtree. */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((el) => {
    if (el.tabIndex < 0) return false;
    if (el.closest("[aria-hidden='true']") !== null) return false;
    // offsetParent is null for display:none; visibility:hidden needs the
    // computed style (a collapsed pane in this app uses exactly that).
    if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
    return getComputedStyle(el).visibility !== "hidden";
  });
}

/** Does this reader want motion? Read live: the OS setting can flip mid-session
 *  and a cached boolean would keep animating at them until reload. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function"
    && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** `scrollTo`/`scrollIntoView` behavior that honours the motion preference —
 *  a smooth scroll is a full-viewport animation, which is exactly the thing
 *  "reduce" is asking us not to do. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

/** Subscribe to motion-preference changes (returns an unsubscribe). */
export function onMotionPreferenceChange(fn: (reduced: boolean) => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const mq = matchMedia("(prefers-reduced-motion: reduce)");
  const handler = (e: MediaQueryListEvent): void => fn(e.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

// ---------------------------------------------------------------------------
// Focus claims.
//
// Some chrome widgets select as the reader arrows through them — the tab bar
// is the obvious one, and that is the correct pattern for a tablist. But
// "select" here means "open a note", and opening a note focuses the editor
// once its content lands. The result was a tab bar you could enter and never
// walk: one ArrowLeft and the caret was in the prose.
//
// So a widget can say "this focus is mine for the next moment"; the surfaces
// that grab focus on arrival check before they take it. A short deadline
// rather than a flag anyone has to remember to clear — the claim expires on
// its own, and a claim that leaks costs one un-focused editor, not a lock.
// ---------------------------------------------------------------------------

let chromeFocusUntil = 0;

/** Hold focus for a chrome widget across the async work an activation kicks
 *  off (a note load, a view swap). */
export function claimFocus(ms = 1500): void {
  chromeFocusUntil = Date.now() + ms;
}

/** Should content-side code skip its own `focus()` right now? */
export function focusIsClaimed(): boolean {
  return Date.now() < chromeFocusUntil;
}

export interface DialogOptions {
  /** Where focus should land when the dialog opens. Default: the first
   *  tabbable element inside it. */
  initialFocus?: () => HTMLElement | null | undefined;
  /** Skip the automatic initial focus entirely (the surface focuses itself —
   *  the command palette's input, say). The trap and the restore still apply. */
  manualFocus?: boolean;
  /** Called on Escape. Omit if the surface already handles Escape itself. */
  onEscape?: () => void;
  /** Turn the whole thing off (a conditionally-rendered dialog that is
   *  currently closed but whose hook still has to run). */
  active?: boolean;
}

/**
 * Focus trap + focus RESTORATION for a modal surface.
 *
 * Restoration is the half that keeps getting dropped: a dialog that dumps
 * focus on `<body>` when it closes has silently sent a keyboard reader back
 * to the top of the document, and they have to re-tab through the whole app
 * to find where they were. So the opener is remembered on mount and focused
 * again on unmount — and only if it is still in the document, because a
 * dialog that deleted the row that opened it must not resurrect a focus
 * target that no longer exists.
 */
export function useDialog(
  ref: { current: HTMLElement | null },
  options: DialogOptions = {},
): void {
  const { manualFocus, active = true } = options;
  // Read the callbacks through a ref so a caller passing inline closures does
  // not re-run the effect (and re-steal focus) on every render.
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;
    const opener = document.activeElement;

    if (!manualFocus) {
      const wanted = opts.current.initialFocus?.();
      const target = wanted ?? tabbables(node)[0] ?? node;
      // A dialog with nothing tabbable in it still has to receive focus, or
      // the reader is left in the page behind it: give the panel itself a
      // programmatic-only tab stop.
      if (target === node && !node.hasAttribute("tabindex")) node.tabIndex = -1;
      target.focus();
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && opts.current.onEscape) {
        e.preventDefault();
        e.stopPropagation();
        opts.current.onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      const ring = tabbables(node);
      if (ring.length === 0) {
        e.preventDefault();
        node.focus();
        return;
      }
      const first = ring[0];
      const last = ring[ring.length - 1];
      const at = document.activeElement;
      // Focus outside the dialog (a click on the backdrop, a stray
      // programmatic focus) rejoins the ring rather than escaping into the
      // page behind the overlay.
      if (!(at instanceof HTMLElement) || !node.contains(at)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }
      if (e.shiftKey && at === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    // Capture: the dialog outranks every global shortcut handler.
    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      // Only if the opener survived: a dialog that deleted the row which
      // opened it must not chase a detached node (focus() there is a silent
      // no-op that leaves the reader on <body> anyway, but the check keeps
      // the intent honest and skips a pointless scroll).
      if (opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
    // `initialFocus`/`onEscape` are read through the ref on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, manualFocus, ref]);
}

/**
 * Enter/Space activation for delegated, imperatively-built controls.
 *
 * The reading view builds wikilinks, tag pills and footnote refs as plain
 * elements and drives them from one delegated click listener. A mouse does
 * not care; a keyboard gets nothing at all. This turns the keys into the
 * click the delegation already understands, so there is exactly one code path
 * for "the reader activated this".
 */
export function activateOnKey(ev: KeyboardEvent, selector: string): boolean {
  if (ev.key !== "Enter" && ev.key !== " " && ev.key !== "Spacebar") return false;
  const target = ev.target;
  if (!(target instanceof HTMLElement)) return false;
  const hit = target.closest<HTMLElement>(selector);
  if (!hit) return false;
  // Space scrolls the page by default; Enter on a real <a href> would navigate.
  ev.preventDefault();
  hit.click();
  return true;
}
