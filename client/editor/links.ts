// Wikilink parsing + resolution against the vault tree held in the zustand store.

import { closesFence, fenceOpener, sourceLines, type Fence } from "../../shared/fences.ts";
import type { TreeNode } from "../../shared/types.ts";
import { isNotePath, noteCandidates, stripNoteExt } from "../../shared/noteFormat.ts";

export interface NoteRef {
  title: string; // basename without .md
  path: string;  // vault-relative path
}

/** Matches [[Target]], [[Target|Alias]], [[Target#Heading]], [[Target#Heading|Alias]]. */
export const WIKILINK_RE = /\[\[([^[\]]+?)\]\]/g;

export interface WikilinkParts {
  target: string;
  heading: string | null;
  alias: string | null;
}

/** Split the inner text of a wikilink into target / #heading / |alias. */
export function parseWikilink(inner: string): WikilinkParts {
  let rest = inner;
  let alias: string | null = null;
  let heading: string | null = null;
  const pipe = rest.indexOf("|");
  if (pipe >= 0) {
    alias = rest.slice(pipe + 1).trim();
    rest = rest.slice(0, pipe);
  }
  const hash = rest.indexOf("#");
  if (hash >= 0) {
    heading = rest.slice(hash + 1).trim();
    rest = rest.slice(0, hash);
  }
  return { target: rest.trim(), heading, alias };
}

/** Flatten the tree into all markdown notes, sorted by title. */
export function collectNotes(tree: TreeNode | null): NoteRef[] {
  const out: NoteRef[] = [];
  const walk = (node: TreeNode): void => {
    if (node.type === "file") {
      // Match on PATH, not name: the visitor-facing published tree names
      // nodes by bare title (no ".md") while paths stay real vault paths.
      // Any note format: a `.tex` file is a note, so it is a wikilink target,
      // an autocomplete candidate and a graph node like any other.
      if (isNotePath(node.path)) {
        out.push({ title: stripNoteExt(node.name), path: node.path });
      }
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  if (tree) walk(tree);
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/**
 * Resolve a wikilink target to a vault path, mirroring the server's rules:
 * basename match without .md, case-insensitive, shortest path wins on
 * duplicates. Also accepts an explicit vault-relative path as target.
 */
export function resolveLink(target: string, tree: TreeNode | null): string | null {
  // `[[Paper.tex]]` and `[[Paper]]` name the same note — the extension comes
  // off whichever one it is, exactly as `.md` always did.
  const name = stripNoteExt(parseWikilink(target).target.toLowerCase());
  if (!name) return null;
  const notes = collectNotes(tree);

  const matches = notes.filter((n) => n.title.toLowerCase() === name);
  if (matches.length > 0) {
    matches.sort(
      (a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path),
    );
    return matches[0].path;
  }

  // Fall back to a path-style target like "folder/Note" or "folder/Note.tex".
  // Candidate ORDER mirrors the server's (`.md` first), so client and server
  // never disagree about which of two same-named notes a link means.
  for (const candidate of noteCandidates(name)) {
    const byPath = notes.find((n) => n.path.toLowerCase() === candidate);
    if (byPath) return byPath.path;
  }
  return null;
}

/** All ATX heading texts in a note, in order, skipping fenced code. The fence
 *  scan is `shared/fences.ts` — the same one the outline and the anchor table
 *  read, because a heading this file cannot see is a `[[Note#Heading]]` the
 *  autocomplete will not offer, and one it sees inside a code block is one it
 *  offers and the reading view never lands on. */
export function extractHeadings(content: string): string[] {
  const out: string[] = [];
  let fence: Fence | null = null;
  for (const line of sourceLines(content)) {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opened = fenceOpener(line);
    if (opened) {
      fence = opened;
      continue;
    }
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** 1-based line number of the heading whose text matches (case-insensitive). */
export function findHeadingLine(content: string, heading: string): number | null {
  const want = heading.trim().toLowerCase();
  if (!want) return null;
  let fence: Fence | null = null;
  let n = 0;
  for (const line of sourceLines(content)) {
    n++;
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const opened = fenceOpener(line);
    if (opened) {
      fence = opened;
      continue;
    }
    const m = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(line);
    if (m && m[1].trim().toLowerCase() === want) return n;
  }
  return null;
}
