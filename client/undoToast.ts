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
// Deliberately the same `.s-toast` element as `toast()`, so the two never stack
// and `dismissToasts()` clears either. It lives longer (a message you have to
// ACT on cannot fade at reading speed) and the action is a real <button>: it
// takes Tab focus and answers Enter, because the reader who could not drag is
// exactly the reader most likely to need the undo.

import { dismissToasts } from "./toast.ts";

/** How long an actionable toast stays. `toast()`'s 3s is reading time; this is
 *  reading time plus deciding time plus reaching the button. */
const ACTION_TOAST_MS = 9000;
/** Matches the `.s-toast--leaving` fade in app.css. */
const FADE_MS = 300;

/** A toast with one action. `onAction` runs at most once; taking it closes the
 *  toast immediately, so the button cannot be clicked twice. */
export function actionToast(message: string, actionLabel: string, onAction: () => void): void {
  dismissToasts();

  const el = document.createElement("div");
  el.className = "s-toast s-toast--action";
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

  let done = false;
  const close = (): void => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    el.classList.add("s-toast--leaving");
    window.setTimeout(() => el.remove(), FADE_MS);
  };
  button.addEventListener("click", () => {
    if (done) return;
    close();
    onAction();
  });

  el.append(text, button);
  document.body.appendChild(el);
  const timer = window.setTimeout(close, ACTION_TOAST_MS);
}
