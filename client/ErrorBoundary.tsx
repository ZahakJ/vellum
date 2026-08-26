// A CRASHED RENDER MUST NOT BE A WHITE PAGE.
//
// v1.8 client-solidity audit, finding B2. React's contract is blunt: a throw
// during render with no boundary above it unmounts the ENTIRE tree. This app
// had no boundary at all, so any one of a hundred components could end a
// writing session by leaving `<div id="root">` empty — no message, no reload
// button, and (worse) no chance to write out what was in the buffers, because
// the `beforeunload` flush only runs when the reader closes the tab and a
// reader looking at a white page has no reason to think closing it is safe.
//
// So the boundary does two things, in this order:
//   1. FLUSH. `flushAllBuffers()` is the `sendBeacon` path — it does not need
//      React, it does not need the render that just died, and it is the last
//      moment the unsaved text is reachable at all.
//   2. Say so, and offer the one action that helps.
//
// It reaches nothing but the buffer bridge, the dictionary and the toaster, on
// purpose: a boundary that itself throws is worse than no boundary.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { flushAllBuffers } from "./editor/bufferBridge.ts";
import { t } from "./i18n.ts";

interface State {
  crashed: boolean;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { crashed: false };

  static getDerivedStateFromError(): State {
    return { crashed: true };
  }

  override componentDidCatch(err: Error, info: ErrorInfo): void {
    // The component stack is the only thing that makes a minified production
    // stack legible, and it exists nowhere else.
    console.error("vellum: render crashed", err, info.componentStack);
    try {
      // How many went is written to the console rather than to the card: a
      // number on a crash screen invites arithmetic at the worst possible
      // moment, and the sentence a writer needs is "nothing of yours is
      // waiting", not "3 of 4".
      console.info("vellum: buffers flushed by beacon", flushAllBuffers());
    } catch (flushErr) {
      console.error("vellum: could not flush buffers after a crash", flushErr);
    }
  }

  override render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="s-crash" role="alert">
        <div className="s-crash__card">
          {/* The wordmark's star, as on every other empty surface: this is
              still Vellum, and the page should look like it knows that. */}
          <div className="s-crash__glyph" aria-hidden="true">
            ✦
          </div>
          <h1 className="s-crash__title">{t("crashTitle")}</h1>
          <p className="s-crash__body">{t("crashBody")}</p>
          <button
            type="button"
            className="s-crash__action"
            onClick={() => location.reload()}
          >
            {t("crashReload")}
          </button>
        </div>
      </div>
    );
  }
}
