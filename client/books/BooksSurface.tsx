// The books surface: the shelf and the reader, and the one component that
// knows which of the two is on screen.
//
// It takes a ROUTE and two callbacks and owns no global state, which is the
// whole point: today it is mounted into a portal of its own by
// client/books/mount.ts (the app shell is not this stage's to edit), and when
// the pane work lands the same component becomes the body of a pane by passing
// the same three props from there. Nothing in here reaches for `useStore`,
// `document.body` or the address bar, so that move is a prop change rather
// than a rewrite.

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
}

// The reader is split from the shelf on purpose: a reader who only ever
// browses their shelf never downloads the page renderer, the text layer or the
// search matcher, and the shelf is what a click on "Library" reaches first.
// (pdf.js itself is behind a further boundary again — client/books/pdfjs.ts —
// so neither of these two chunks contains it.)
const BookLibrary = lazy(() => import("./BookLibrary.tsx"));
const BookReader = lazy(() => import("./BookReader.tsx"));

export default function BooksSurface({ route, onRoute, onExit }: BooksSurfaceProps) {
  return (
    <div className="s-books" role="region" aria-label={t("bookLibrary")}>
      <Suspense fallback={<p className="s-books__loading">{t("bookLoading")}</p>}>
        {route.kind === "library" ? (
          <BookLibrary
            onOpen={(path, anchor) => onRoute({ kind: "book", path, anchor })}
            onClose={onExit}
          />
        ) : (
          <BookReader
            path={route.path}
            citation={route.anchor ?? null}
            onClose={onExit}
            onLibrary={() => onRoute({ kind: "library" })}
          />
        )}
      </Suspense>
    </div>
  );
}
