// Per-note URLs. Every note is a shareable, bookmarkable address:
//
//   /                     → home (empty state or HOME_NOTE)
//   /graph                → graph view
//   /folder/Note          → the note folder/Note.md (".md" stripped, segments
//                           URL-encoded; matching is case-insensitive)
//   /folder/Note#Heading  → same note, scrolled to the heading
//
// The store stays the single source of truth: installRouter() subscribes to
// openPath/view and mirrors them into history (pushState), and popstate maps
// the URL back into the store — so browser back/forward walk the notes you
// visited. applyUrl() is also called once the tree first loads, which is what
// makes a pasted deep link or a refresh land on the right note.

import type { TreeNode } from "../shared/types.ts";
import { collectNotes, resolveLink } from "./editor/links.ts";
import { useStore } from "./state.ts";

/** True while we are applying a URL to the store (popstate / initial load):
 *  the store subscription must then replace, not push, history entries. */
let applying = false;

/** Vault note path → pathname for the address bar ("a/b.md" → "/a/b"). */
export function notePathToUrl(path: string): string {
  const trimmed = path.replace(/\.md$/i, "");
  return "/" + trimmed.split("/").map(encodeURIComponent).join("/");
}

/** Pathname → vault note path, matched against the loaded tree.
 *  Accepts "/a/b", "/a/b.md" (exact, case-insensitive) and falls back to
 *  wikilink-style basename resolution for hand-typed short links. */
export function urlToNotePath(pathname: string, tree: TreeNode | null): string | null {
  let decoded: string;
  try {
    decoded = pathname.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null; // malformed percent-encoding
  }
  const rel = decoded.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!rel) return null;
  const want = (rel.toLowerCase().endsWith(".md") ? rel : `${rel}.md`).toLowerCase();
  for (const note of collectNotes(tree)) {
    if (note.path.toLowerCase() === want) return note.path;
  }
  // Short link like /Welcome for a nested note — resolve like a wikilink.
  if (!rel.includes("/")) return resolveLink(rel, tree);
  return null;
}

/** The URL the current store state should display. */
function urlForState(view: string, openPath: string | null): string {
  if (view === "graph") return "/graph";
  return openPath ? notePathToUrl(openPath) : "/";
}

function currentUrl(): string {
  return location.pathname + location.hash;
}

function setTitle(openPath: string | null, view: string): void {
  const base = "Vellum";
  if (view === "graph") {
    document.title = `Graph · ${base}`;
  } else if (openPath) {
    const name = openPath.split("/").pop()!.replace(/\.md$/i, "");
    document.title = `${name} · ${base}`;
  } else {
    document.title = base;
  }
}

/** Map the current location into the store (initial load and popstate).
 *  Returns true when the URL named something we could show.
 *
 *  `initial` marks the one call made right after bootstrap: a bare "/" then
 *  means "no deep link — keep whatever bootstrap decided" (the restored
 *  session or the HOME_NOTE that enterVault already opened), and returning
 *  false lets App's syncUrl() canonicalize the address bar to that note.
 *  On popstate a "/" entry really is the empty root entry (all tabs closed),
 *  so there it still clears openPath. */
export function applyUrl(initial = false): boolean {
  const store = useStore.getState();
  applying = true;
  try {
    if (location.pathname === "/graph") {
      store.setView("graph");
      return true;
    }
    const path = urlToNotePath(location.pathname, store.tree);
    if (path) {
      const heading = location.hash ? decodeURIComponent(location.hash.slice(1)) : "";
      if (heading) store.setPendingHeading(heading);
      store.openNote(path); // sets view back to "editor" as well
      // Canonicalize short/differently-cased links even when the note was
      // already open (no state change → the subscription stays silent).
      const canonical = notePathToUrl(path) + location.hash;
      if (currentUrl() !== canonical) history.replaceState(null, "", canonical);
      return true;
    }
    if (location.pathname === "/") {
      if (initial) return false; // keep the home note / restored session
      // Back to the root entry: show the empty state (tabs stay open).
      if (store.view === "graph") store.setView("editor");
      useStore.setState({ openPath: null });
      return true;
    }
    return false;
  } finally {
    applying = false;
  }
}

/** Replace the address bar with the canonical URL for the current state
 *  (used when a pasted URL named a note that does not exist). */
export function syncUrl(): void {
  const s = useStore.getState();
  const url = urlForState(s.view, s.openPath);
  setTitle(s.openPath, s.view);
  if (currentUrl() !== url) history.replaceState(null, "", url);
}

/** Wire history <-> store. Call once from App after the store exists. */
export function installRouter(): () => void {
  // Mirror store → address bar.
  const unsubscribe = useStore.subscribe((s, prev) => {
    // A locked vault that just unlocked (login): the tree arrives while the
    // address bar still shows the deep link the visitor came for. Session
    // restore is about to steal openPath, so re-apply the captured URL after
    // it settles.
    if (prev.tree === null && s.tree !== null && location.pathname !== "/") {
      const href = currentUrl();
      queueMicrotask(() => {
        history.replaceState(null, "", href);
        applyUrl();
      });
    }
    if (s.openPath === prev.openPath && s.view === prev.view) return;
    const url = urlForState(s.view, s.openPath);
    setTitle(s.openPath, s.view);
    if (currentUrl() === url) return;
    if (applying) {
      history.replaceState(null, "", url);
    } else {
      history.pushState(null, "", url);
    }
  });

  // Address bar → store.
  const onPopState = (): void => {
    if (!applyUrl()) syncUrl();
  };
  window.addEventListener("popstate", onPopState);

  setTitle(useStore.getState().openPath, useStore.getState().view);

  return () => {
    unsubscribe();
    window.removeEventListener("popstate", onPopState);
  };
}
