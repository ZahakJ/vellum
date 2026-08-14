// Transient toast helper. Errors (and small confirmations) surface through
// this rather than alert() — see CONTRACTS.md conventions.

const TOAST_MS = 3000;
const FADE_MS = 300;

/** Remove any visible toast immediately (e.g. when navigating to another
 *  note — a stale message must not overlay unrelated content). */
export function dismissToasts(): void {
  for (const el of document.querySelectorAll(".s-toast")) el.remove();
}

export function toast(msg: string): void {
  // Replace any lingering toast so messages never stack unreadably.
  dismissToasts();

  const el = document.createElement("div");
  el.className = "s-toast";
  el.setAttribute("role", "status");
  el.textContent = msg;
  document.body.appendChild(el);

  window.setTimeout(() => {
    el.classList.add("s-toast--leaving"); // matches app.css's fade-out class
    window.setTimeout(() => el.remove(), FADE_MS);
  }, TOAST_MS);
}
