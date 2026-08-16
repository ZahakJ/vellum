// Transient toast helper. Errors (and small confirmations) surface through
// this rather than alert() — see CONTRACTS.md conventions.

const TOAST_MS = 3000;
const FADE_MS = 300;

/** Remove any visible toast immediately (e.g. when navigating to another
 *  note — a stale message must not overlay unrelated content). */
export function dismissToasts(): void {
  for (const el of document.querySelectorAll(".s-toast")) el.remove();
}

/** `error` paints the leading rule in --danger (app.css's `.s-toast--error`,
 *  which existed and was never once applied); the default accent rule is for
 *  confirmations and for the calm "this is the expected answer" messages —
 *  a 404 while previewing as a visitor is not a fault, and dressing it as one
 *  is what made the owner's first use of preview report a failure. */
export function toast(msg: string, tone: "info" | "error" = "info"): void {
  // Replace any lingering toast so messages never stack unreadably.
  dismissToasts();

  const el = document.createElement("div");
  el.className = tone === "error" ? "s-toast s-toast--error" : "s-toast";
  el.setAttribute("role", "status");
  // The live region has to be in the document BEFORE it has content: a
  // role="status" node that arrives already full is, to most screen readers,
  // just a new element — nothing changed inside a region they were watching,
  // so nothing is announced. Insert it empty, fill it on the next frame.
  document.body.appendChild(el);
  requestAnimationFrame(() => {
    el.textContent = msg;
  });

  window.setTimeout(() => {
    el.classList.add("s-toast--leaving"); // matches app.css's fade-out class
    window.setTimeout(() => el.remove(), FADE_MS);
  }, TOAST_MS);
}
