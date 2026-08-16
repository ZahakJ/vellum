// THE ERROR BOUNDARY. This is a correctness feature, not a nicety.
//
// The promise, in one sentence: a designed site that cannot render drops
// VISITORS to the stock blog automatically — never a blank page, never a stack
// trace — while the OWNER is told which section failed and is offered one
// click back to stock.
//
// Three failures reach it, and they arrive by two different doors:
//
//   1. An invalid config. The server refuses one on write and quarantines one
//      it cannot understand on read, so a visitor's /api/me already says
//      "blog" — the server-side half of this promise (servedLayout()). What
//      gets here is the case the server cannot see: a design that validated on
//      the wire and does not validate in this build. `DesignedSite` runs the
//      SAME shared validator over what it received before it renders a byte,
//      and a failure comes through `fail()` exactly like a throw.
//   2. A section pointing at a note that is gone, unpublished, or hidden. The
//      section renderer discovers this (its fetch 404s, or the server blanked
//      the path because this session may not read it) and THROWS a
//      SectionError naming itself.
//   3. Anything thrown at render time by a section, for any reason at all.
//      React unwinds to the nearest boundary, which is this one, per section.
//
// All three land in one place, and the answer is one answer:
//   · not the owner → render <BlogShell />, the pristine stock component,
//     unmodified and unaware it is being used as a rescue;
//   · the owner (an admin previewing their own site) → keep the designed page
//     up, replace the failing section with a card naming it, and put a strip
//     across the top offering "back to the stock blog", which is a
//     `PATCH /api/settings {publicLayout:"blog"}` and therefore LOSSLESS: the
//     design file is not touched, and flipping forward again restores it.
//
// Why per SECTION and not one boundary for the page: a boundary that catches
// everything can only say "something broke". The requirement is a notice that
// NAMES the failing section, and React only knows which child threw if the
// boundary is that child's own parent.

import { Component, type ErrorInfo, type ReactNode } from "react";
import type { Section } from "../../shared/design.ts";

/** A section refusing to render itself, with enough in it to write the
 *  notice. Thrown by the renderers; caught here like any other error, so a
 *  section that throws a plain `TypeError` is handled identically — the
 *  difference is only how good the sentence is. */
export class SectionError extends Error {
  /** An i18n key the notice prefers over `message`, which is English prose
   *  for the console. */
  readonly key?: string;
  readonly detail?: string;
  constructor(message: string, key?: string, detail?: string) {
    super(message);
    this.name = "SectionError";
    this.key = key;
    this.detail = detail;
  }
}

export interface SectionFailure {
  /** The section's stable id — what the notice names. */
  id: string;
  // The three chrome parts are boundary kinds too: each frames the page
  // separately, so each can fail separately and be NAMED separately.
  kind: Section["kind"] | "config" | "page" | "header" | "footer";
  /** i18n key for the human sentence, when the thrower named one. */
  key?: string;
  /** The raw message, for the console and for the admin's detail line. */
  message: string;
  detail?: string;
}

interface Props {
  id: string;
  kind: SectionFailure["kind"];
  /** Called once when this subtree throws. The page decides what to do with
   *  it — which is how ONE section's failure can drop the whole page to stock
   *  for a visitor while an admin keeps the rest of the page. */
  onFail: (failure: SectionFailure) => void;
  /** What an admin sees in this section's place. Visitors never see it: by
   *  the time it would render, the page has already switched to stock. */
  fallback: (failure: SectionFailure) => ReactNode;
  children: ReactNode;
}

interface State {
  failure: SectionFailure | null;
}

export class DesignBoundary extends Component<Props, State> {
  state: State = { failure: null };

  static getDerivedStateFromError(error: unknown): State {
    return {
      failure: {
        // Filled in by componentDidCatch, which has the props; this static
        // hook does not. Keeping both is what lets the fallback render on the
        // SAME commit as the throw rather than one paint later.
        id: "",
        kind: "page",
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof SectionError
          ? { key: error.key, detail: error.detail }
          : {}),
      },
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const failure: SectionFailure = {
      id: this.props.id,
      kind: this.props.kind,
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof SectionError ? { key: error.key, detail: error.detail } : {}),
    };
    // The console line is for whoever is debugging, in English, with the
    // component stack. The reader gets a localized sentence or the stock site.
    console.error(
      `vellum: design section "${failure.id}" (${failure.kind}) failed to render`,
      error,
      info.componentStack,
    );
    this.setState({ failure });
    this.props.onFail(failure);
  }

  /** A section that failed stays failed until the design changes — the page
   *  remounts boundaries by keying them on the design signature, so a fixed
   *  design clears every card without a reload. */
  render(): ReactNode {
    if (this.state.failure) {
      return this.props.fallback({ ...this.state.failure, id: this.props.id, kind: this.props.kind });
    }
    return this.props.children;
  }
}
