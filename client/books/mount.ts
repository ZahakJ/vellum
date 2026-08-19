// THE DOOR TO THE READER, AND THE ONLY PART OF IT THE APP SHELL PAYS FOR.
//
// This module is reached by a STATIC import from the sidebar and the router,
// which means it is first-paint code, which means it must stay tiny and must
// never touch pdf.js, the shelf or the reader except through `import()`.
// `scripts/check-bundle.mjs` asserts exactly that: pdfjs-dist is forbidden in
// every first-paint closure and `books/BooksSurface.tsx` must remain its own
// chunk. Everything in here is a URL parser, a `<div>` and a React root.
//
// WHY A ROOT OF ITS OWN. The reader is a full-screen surface and the app shell
// that would normally host it (client/App.tsx) is not this stage's to edit, so
// the surface mounts into a portal element appended to <body> — the same
// arrangement the attachment viewer already uses for the same reason, and one
// that survives the sidebar being a grid pane that clips its own overflow.
// When the pane work lands, `BooksSurface` moves into a pane by passing it the
// same three props; this file is what gets deleted, not what gets rewritten.
//
// It is deliberately NOT wrapped in <React.StrictMode>, unlike main.tsx.
// StrictMode double-invokes effects in development, and the reader's open
// effect starts a `getDocument` — so a strict double mount would open every
// book twice, and (worse) destroy one of the two documents while the other was
// still rendering from it.

import { createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { formatBookAnchor, parseBookAnchor, type BookAnchor } from "../../shared/bookAnchor.ts";
import type { TreeNode } from "../../shared/types.ts";
import type { BooksRoute, BooksSurfaceProps } from "./BooksSurface.tsx";

export type { BooksRoute };

/** The shelf lives at /library; a book at /book/<vault path>. Both are real
 *  addresses on purpose: a book someone is halfway through is a thing they
 *  want in a bookmark, and "which page" is already remembered server-side, so
 *  the URL only has to name the volume. */
const LIBRARY_PATH = "/library";
const BOOK_PREFIX = "/book/";

/**
 * Parse a location into a books route, or null when the URL is not ours.
 *
 * `hash` defaults to the live one, so the router keeps calling this with a
 * pathname alone and a bookmarked citation still reopens on its own page. A
 * citation URL is `/book/Books/Ihya.pdf#page=42&rect=…&id=…` — the same anchor
 * the wikilink carries, because there is one spelling of "where in a book" in
 * this product and shared/bookAnchor.ts owns it.
 */
export function booksRouteFor(
  pathname: string,
  hash: string = typeof location === "undefined" ? "" : location.hash,
): BooksRoute | null {
  if (pathname === LIBRARY_PATH || pathname === `${LIBRARY_PATH}/`) return { kind: "library" };
  if (!pathname.startsWith(BOOK_PREFIX)) return null;
  let rel: string;
  try {
    rel = pathname
      .slice(BOOK_PREFIX.length)
      .split("/")
      .map(decodeURIComponent)
      .join("/");
  } catch {
    return null; // malformed percent-encoding
  }
  // The same containment rule every path in this product answers to. The
  // server checks it again (safeAbs); this is so a malformed link never gets
  // as far as a request.
  if (rel === "" || rel.includes("..")) return null;
  const anchor = parseBookAnchor(hash.replace(/^#/, ""));
  return { kind: "book", path: rel, anchor };
}

export function urlForBooksRoute(route: BooksRoute): string {
  if (route.kind === "library") return LIBRARY_PATH;
  const url = BOOK_PREFIX + route.path.split("/").map(encodeURIComponent).join("/");
  return route.anchor ? `${url}#${formatBookAnchor(route.anchor)}` : url;
}

/**
 * The vault path of a PDF a wikilink names, or null.
 *
 * Basename matching, case-insensitive, shortest path first — the same rule
 * `client/editor/links.ts::resolveLink` applies to notes, because a citation is
 * a wikilink and a reader has every right to expect it to resolve like one.
 * Pure, so it can live in first-paint code: it is a walk of a tree the store
 * already holds, and the alternative (asking the server) would put a round
 * trip in front of every rendered citation.
 */
export function findPdfPath(tree: TreeNode | null, name: string): string | null {
  const want = name.trim().toLowerCase();
  if (want === "" || !want.endsWith(".pdf")) return null;
  const hits: string[] = [];
  const walk = (node: TreeNode): void => {
    if (node.type === "file") {
      if (node.path.toLowerCase() === want || node.name.toLowerCase() === want) hits.push(node.path);
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  if (tree) walk(tree);
  hits.sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length || a.localeCompare(b));
  return hits[0] ?? null;
}

/**
 * Open the book a citation names, at the passage it names.
 *
 * The happy path is a tree lookup and nothing else — no request, no await, the
 * book opens on the same tick as the click. When the name no longer resolves
 * the recovery is DYNAMICALLY imported: asking the store which bytes those
 * were, finding where they live now and offering to repair the note is a
 * conversation with the server, and it belongs to the rare case rather than to
 * everyone's first paint. This module is reached by a static import from the
 * sidebar and the router, and it stays a URL parser and a React root.
 */
export function openBookCitation(
  target: string,
  anchor: BookAnchor,
  tree: TreeNode | null,
  notePath: string,
): void {
  const path = findPdfPath(tree, target);
  if (path !== null) {
    showBooks({ kind: "book", path, anchor }, true);
    return;
  }
  void import("./citations.ts").then((mod) => mod.recoverCitation(target, anchor, notePath));
}

let host: HTMLElement | null = null;
let root: Root | null = null;
let current: BooksRoute | null = null;
let Surface: ComponentType<BooksSurfaceProps> | null = null;
let exitListener: (() => void) | null = null;

/** The router registers here so that closing the reader puts the address bar
 *  back on whatever the app was showing underneath. */
export function onBooksExit(listener: () => void): void {
  exitListener = listener;
}

export function booksAreOpen(): boolean {
  return current !== null;
}

/** Open (or move within) the books surface.
 *
 *  `push` writes a history entry — what a click should do. A URL that ARRIVED
 *  as a deep link or a back button must not push another one, so the router
 *  passes false. */
export function showBooks(route: BooksRoute, push = false): void {
  current = route;
  if (push) {
    const url = urlForBooksRoute(route);
    // Pathname AND hash: a citation's address carries its passage in the hash,
    // so comparing the pathname alone would refuse to push a move from one
    // page of a book to another page of the same book.
    if (`${location.pathname}${location.hash}` !== url) history.pushState(null, "", url);
  }
  if (!host) {
    host = document.createElement("div");
    host.className = "s-books-host";
    document.body.appendChild(host);
    root = createRoot(host);
  }
  if (!Surface) {
    void import("./BooksSurface.tsx").then((mod) => {
      Surface = mod.default;
      render();
    });
  }
  render();
}

export function hideBooks(notify = true): void {
  current = null;
  render();
  if (notify) exitListener?.();
}

/** Open one book by vault path — what a click on a `.pdf` in the tree does. */
export function openBookPath(path: string): void {
  showBooks({ kind: "book", path }, true);
}

/** Open the shelf. */
export function openLibrary(): void {
  showBooks({ kind: "library" }, true);
}

function render(): void {
  if (!root) return;
  if (current === null || !Surface) {
    root.render(null);
    return;
  }
  root.render(
    createElement(Surface, {
      route: current,
      onRoute: (next: BooksRoute) => showBooks(next, true),
      // Closing hands control back to whoever registered `onBooksExit` — the
      // router — which puts the address bar back on the note underneath.
      onExit: () => hideBooks(),
    }),
  );
}
