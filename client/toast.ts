// Transient toast helper. Errors (and small confirmations) surface through
// this rather than alert() — see CONTRACTS.md conventions.
//
// TOASTS LIVE IN A STACK NOW (v1.8 UX audit F23). Until this round every
// `toast()` began by removing every toast on screen, action toasts included —
// so the one message in the product the reader has to ACT on was killed by the
// next ambient confirmation that happened to land inside its nine seconds.
// The delete path proved it end to end: "Moved to the trash — Undo" was
// erased by the save toast that followed it, and the way back went with it.
//
// The rule is therefore: a PLAIN toast states a fact and may replace another
// plain toast (two facts stacked unreadably was the reason for the old
// `dismissToasts()` call, and that reason still holds). An ACTION toast is an
// offer with a deadline, and nothing but its own timeout, its own button or
// its own dismiss takes it away.
//
// The host `.s-toasts` is the fixed, centred column both kinds sit in, and
// plain toasts insert ABOVE any standing action toast — so the button never
// moves under a thumb that is already reaching for it.

const TOAST_MS = 3000;
const FADE_MS = 300;

/** The action toast's marker class, shared with `undoToast.ts` — it is the one
 *  thing that tells the two kinds apart in the DOM. */
export const ACTION_CLASS = "s-toast--action";

/** The column every toast is mounted into. Created on first use; it is
 *  `pointer-events: none` so an empty stack never sits over the editor. */
function host(): HTMLElement {
  let el = document.querySelector<HTMLElement>(".s-toasts");
  if (el === null) {
    el = document.createElement("div");
    el.className = "s-toasts";
    document.body.appendChild(el);
  }
  return el;
}

/** Fade an element out and drop it. Idempotent: a toast whose timeout fires
 *  after its button already closed it must not schedule a second removal. */
export function retireToast(el: HTMLElement): void {
  if (el.classList.contains("s-toast--leaving")) return;
  el.classList.add("s-toast--leaving"); // matches app.css's fade-out class
  window.setTimeout(() => el.remove(), FADE_MS);
}

/** Mount a toast element. Plain messages go ABOVE a standing action toast so
 *  the offer keeps the position (and the hit target) it was given. */
export function mountToast(el: HTMLElement, kind: "plain" | "action"): void {
  const parent = host();
  const standing = parent.querySelector(`.${ACTION_CLASS}`);
  if (kind === "plain" && standing !== null) parent.insertBefore(el, standing);
  else parent.appendChild(el);
}

/** Remove the transient toasts — the ones that only state a fact. Called when
 *  navigating to another note (a stale message must not overlay unrelated
 *  content) and by `toast()` itself, so two facts never stack unreadably.
 *
 *  It deliberately does NOT touch an action toast. Deleting the open note is
 *  exactly the gesture that changes `openPath`, and the undo it offers must
 *  outlive the navigation the delete caused — a way back that dismisses itself
 *  in the same frame it appears is not a way back. */
export function dismissToasts(): void {
  for (const el of document.querySelectorAll<HTMLElement>(`.s-toast:not(.${ACTION_CLASS})`)) {
    el.remove();
  }
}

/** `error` paints the leading rule in --danger (app.css's `.s-toast--error`,
 *  which existed and was never once applied); the default accent rule is for
 *  confirmations and for the calm "this is the expected answer" messages —
 *  a 404 while previewing as a visitor is not a fault, and dressing it as one
 *  is what made the owner's first use of preview report a failure. */
export function toast(msg: string, tone: "info" | "error" = "info"): void {
  // Replace any lingering PLAIN toast so messages never stack unreadably.
  dismissToasts();

  const el = document.createElement("div");
  el.className = tone === "error" ? "s-toast s-toast--error" : "s-toast";
  el.setAttribute("role", "status");
  // The live region has to be in the document BEFORE it has content: a
  // role="status" node that arrives already full is, to most screen readers,
  // just a new element — nothing changed inside a region they were watching,
  // so nothing is announced. Insert it empty, fill it on the next frame.
  mountToast(el, "plain");
  requestAnimationFrame(() => {
    el.textContent = msg;
  });

  window.setTimeout(() => retireToast(el), TOAST_MS);
}
