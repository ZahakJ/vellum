// A toast that carries one button.
//
// `toast()` states a fact and fades. That is right for "saved", "published",
// "could not reach the server". It is not enough for a MOVE: a drag is the one
// gesture in this product the hand can make by accident — a 4px slip while
// scrolling a 1,375-note tree drops a folder somewhere the reader was not
// looking, and the tree redraws around the new shape so there is nothing left
// on screen saying where it came from. The message that names both ends has to
// carry the way back, or the way back is "read the toast, remember the old
// folder, find the item again, drag it again".
//
// It is the same `.s-toast` element as `toast()` and lives in the same
// `.s-toasts` column, but it OUTLIVES the plain messages that land on top of
// it (v1.8 UX audit F23): a message you have to act on cannot be swept away by
// the next ambient confirmation, and until this round every single `toast()`
// call did exactly that. Only three things close it — its timeout, its own
// button, and its own ✕ — and a SECOND offer replaces the first, because two
// standing "Undo" buttons is a question about which one takes back what.
//
// It lives longer than a plain toast (a message you have to ACT on cannot fade
// at reading speed) and the action is a real <button>: it takes Tab focus and
// answers Enter, because the reader who could not drag is exactly the reader
// most likely to need the undo.

import { t } from "./i18n.ts";
import { ACTION_CLASS, mountToast, retireToast } from "./toast.ts";

/** How long an actionable toast stays. `toast()`'s 3s is reading time; this is
 *  reading time plus deciding time plus reaching the button. */
const ACTION_TOAST_MS = 9000;

/** A toast with one action. `onAction` runs at most once; taking it closes the
 *  toast immediately, so the button cannot be clicked twice. */
export function actionToast(message: string, actionLabel: string, onAction: () => void): void {
  // One offer at a time. Plain toasts are left exactly where they are.
  for (const old of document.querySelectorAll<HTMLElement>(`.${ACTION_CLASS}`)) old.remove();

  const el = document.createElement("div");
  el.className = `s-toast ${ACTION_CLASS}`;
  // "status", not "alert": this is a confirmation the reader may act on, not an
  // interruption — and the button inside it needs to be reachable, which
  // aria-live assertive regions fight with.
  el.setAttribute("role", "status");

  const text = document.createElement("span");
  text.className = "s-toast__msg";
  // The message splices in note and folder names of unknown script.
  text.setAttribute("dir", "auto");
  text.textContent = message;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "s-toast__action";
  button.textContent = actionLabel;

  // The way out that is not the action. An offer that only its own deadline
  // can end is a nine-second banner over the reader's work, and now that a
  // plain toast no longer sweeps it away there has to be a hand that does.
  const close = document.createElement("button");
  close.type = "button";
  close.className = "s-toast__dismiss";
  close.setAttribute("aria-label", t("close"));
  close.textContent = "×";

  let done = false;
  const retire = (): void => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    retireToast(el);
  };
  button.addEventListener("click", () => {
    if (done) return;
    retire();
    onAction();
  });
  close.addEventListener("click", retire);

  el.append(text, button, close);
  mountToast(el, "action");
  const timer = window.setTimeout(retire, ACTION_TOAST_MS);
}
