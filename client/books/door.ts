// THE DOOR TO THE READER, AND THE ONLY PART OF IT THE APP SHELL PAYS FOR.
//
// This module is reached by a STATIC import from the sidebar, the router and
// the editors, which means it is first-paint code, which means it must never
// touch pdf.js, the shelf or the reader — those live behind the lazy
// BooksSurface chunk that client/components/Pane.tsx mounts. Everything in
// here is a URL parser, a tree walk and a call into the store.
//
// This file used to also BE the reader's mount: a portal element on <body>,
// a React root of its own, and a `booksAreOpen()` flag the router had to ask
// before touching the address bar — all because the reader was a full-screen
// surface layered OVER the app. A book is a WORKSPACE TAB now (the owner:
// "prob should just treat it like a normal tab?? so people can open the book
// while taking notes"), the pane renders it like any other surface, and the
// portal, the root and the flag are deleted rather than kept as a second way
// of opening the same thing.

import { formatBookAnchor, parseBookAnchor, type BookAnchor } from "../../shared/bookAnchor.ts";
import type { TreeNode } from "../../shared/types.ts";
import { useStore } from "../state.ts";
import type { BooksRoute } from "./BooksSurface.tsx";

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
  // A hand-typed or shortened URL may omit the extension — note permalinks do
  // (`/folder/Note`, not `/folder/Note.md`), so a reader will expect `/book/
  // Spivak` to work, and it 400'd instead: the open route requires a real
  // `.pdf` path. Appending it here is the same guess `urlToNoteGuess` makes
  // for notes; a wrong guess still fails on the server, but now for a book
  // that genuinely is not there.
  return { kind: "book", path: /\.pdf$/i.test(rel) ? rel : `${rel}.pdf`, anchor };
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
 * sidebar and the router, and it stays a URL parser and a store call.
 */
export function openBookCitation(
  target: string,
  anchor: BookAnchor,
  tree: TreeNode | null,
  notePath: string,
): void {
  const path = findPdfPath(tree, target);
  if (path !== null) {
    useStore.getState().openBook(path, anchor);
    return;
  }
  void import("./citations.ts").then((mod) => mod.recoverCitation(target, anchor, notePath));
}


/** Open one book by vault path — what a click on a `.pdf` in the tree does. */
export function openBookPath(path: string): void {
  useStore.getState().openBook(path, null);
}
