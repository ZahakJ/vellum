// The books surface: the shelf and the reader, and the one component that
// knows which of the two is on screen.
//
// It takes a ROUTE and callbacks and owns no global state, which is the whole
// point: it is the body of a PANE now (client/components/Pane.tsx), exactly
// the move its portal-era header promised. Nothing in here reaches for
// `useStore`, `document.body` or the address bar — the pane decides where the
// route lives and what closing means, and `active` tells the reader whether
// its pane holds the keyboard, because zathura keys listen on `window` and a
// `j` typed toward another pane must not turn a page here.

import { lazy, Suspense } from "react";
import type { BookAnchor } from "../../shared/bookAnchor.ts";
import { t } from "../i18n.ts";
import "../styles/books.css";

export type BooksRoute =
  | { kind: "library" }
  | {
      kind: "book";
      path: string;
      /** The passage a citation named, when a `[[Book.pdf#page=42&rect=…]]` in
       *  a note is what opened this. The reader jumps to the page and pulses
       *  the rectangle once. Absent for an ordinary open. */
      anchor?: BookAnchor | null;
    };

export interface BooksSurfaceProps {
  route: BooksRoute;
  /** Move within the surface (shelf → book, book → shelf). */
  onRoute(route: BooksRoute): void;
  /** Leave the surface entirely. */
  onExit(): void;
  /** Whether this surface's pane holds the keyboard. Defaults true so a lone
   *  surface behaves as the full-screen reader always did. */
  active?: boolean;
  /** The route's citation anchor has been landed on — the pane may clear its
   *  one-shot target. */
  onLanded?(): void;
}

// The reader is split from the shelf on purpose: a reader who only ever
// browses their shelf never downloads the page renderer, the text layer or the
// search matcher, and the shelf is what a click on "Library" reaches first.
// (pdf.js itself is behind a further boundary again — client/books/pdfjs.ts —
// so neither of these two chunks contains it.)
const BookLibrary = lazy(() => import("./BookLibrary.tsx"));
const BookReader = lazy(() => import("./BookReader.tsx"));

export default function BooksSurface({ route, onRoute, onExit, active = true, onLanded }: BooksSurfaceProps) {
  return (
    <div className="s-books" role="region" aria-label={t("bookLibrary")}>
      <Suspense fallback={<p className="s-books__loading">{t("bookLoading")}</p>}>
        {route.kind === "library" ? (
          <BookLibrary
            active={active}
            onOpen={(path, anchor) => onRoute({ kind: "book", path, anchor })}
            onClose={onExit}
          />
        ) : (
          <BookReader
            key={route.path}
            active={active}
            path={route.path}
            citation={route.anchor ?? null}
            onLanded={onLanded}
            onClose={onExit}
            onLibrary={() => onRoute({ kind: "library" })}
          />
        )}
      </Suspense>
    </div>
  );
}
