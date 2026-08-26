// THE NET UNDER THE WHOLE CLIENT.
//
// v1.8 client-solidity audit, finding B2: this app had no global handler of any
// kind. A rejected promise nobody caught — and there are hundreds of `void
// somethingAsync()` call sites — printed a red line in a console the reader
// does not have open and then nothing at all. The reader's evidence was a
// button that did not work, twice, and then a shrug.
//
// This module is the one place that answers for the things no `catch` above it
// did. It is deliberately tiny and deliberately in the entry chunk: a safety
// net that arrives in its own request is a net with a hole in it for exactly
// the period during which most first-paint failures happen.

import { ApiError } from "./api.ts";
import { t } from "./i18n.ts";
import { toast } from "./toast.ts";

/** Server-named failures the reader can act on, mapped to sentences in their
 *  own language. `ApiError.message` is the server's ENGLISH prose, and an
 *  Arabic-only operator reading "Timed out after 30s" inside a fully Arabic
 *  panel is the failure `ApiError.code` was added to end. */
const CODE_KEYS: Record<string, "netTimeout" | "sessionStale"> = {
  timeout: "netTimeout",
  notJson: "sessionStale",
};

/** What to SAY about an error that reached the net. Exported because the lazy
 *  boundary wants the same judgment. */
export function errorSentence(err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  const key = code ? CODE_KEYS[code] : undefined;
  return t(key ?? "unexpectedError");
}

/** True for the rejections that are not FAULTS: a request the client itself
 *  cancelled (search aborts one per keystroke), and a navigation that tore a
 *  request down with the page. Toasting these would make ordinary typing look
 *  like a malfunction — which is how a global handler earns its way straight
 *  back out of a codebase. */
function isQuiet(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  // A 401/404 is an ANSWER. Somebody's `catch` should still have handled it,
  // and the console line below says so, but the reader gets no red box for
  // the server correctly declining to serve a visitor an unpublished note.
  return err instanceof ApiError && (err.status === 401 || err.status === 404);
}

let installed = false;

/** Wire the window-level handlers. Idempotent — StrictMode mounts twice. */
export function installSafetyNet(): void {
  if (installed) return;
  installed = true;

  window.addEventListener("unhandledrejection", (ev) => {
    // NOT preventDefault(): the console line is the developer's half of this,
    // and swallowing it would trade a visible failure for an invisible one.
    console.error("vellum: unhandled rejection", ev.reason);
    if (isQuiet(ev.reason)) return;
    toast(errorSentence(ev.reason), "error");
  });

  // `error` catches what `unhandledrejection` cannot: a throw from a plain
  // event listener, an <img> handler, a timer callback. React's own boundary
  // (client/ErrorBoundary.tsx) covers the render path; between the two there
  // is no longer a throw in this app that reaches nobody.
  window.addEventListener("error", (ev) => {
    // A failed <img>/<link>/<script> load also raises `error` on the window,
    // with no `error` property — a broken attachment thumbnail is the note's
    // business and the embed card already draws it. Only real exceptions here.
    if (!(ev instanceof ErrorEvent) || ev.error === undefined) return;
    console.error("vellum: uncaught error", ev.error);
    if (isQuiet(ev.error)) return;
    toast(errorSentence(ev.error), "error");
  });
}
