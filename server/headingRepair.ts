// When a heading is renamed, the links into it go quiet.
//
// `[[Note#Derivation]]` resolves through `findAnchor` (shared/tex.ts): a tail
// matches an anchor's id, or its slug, or its human TITLE. Rename the heading
// and all three stop matching — the link still opens the note, silently landing
// at the top instead of the section, which is the worst shape a broken link can
// take because nothing anywhere says it broke. `server/moveLinks.ts` carries
// `#tails` through a move verbatim (rewriteWikilinkPaths, the `heading ?? ""`),
// which is right for a MOVE and leaves this half of the story untold.
//
// WHERE THE DETECTION LIVES — the seam the v1.8 spec asked to be chosen and
// argued. Three candidates:
//
//   (a) the editor, watching the heading line as it is typed. Cheapest to
//       reason about and wrong: it sees only edits made in Vellum's own
//       CodeMirror, so a heading renamed in the reading view's source, by a
//       template, by the desktop app's other window, or by any future write
//       path is a rename this feature never hears about. It also fires
//       mid-word, on every keystroke.
//   (b) the watcher/indexer, comparing anchor tables on every reindex. Catches
//       everything including Obsidian and `git pull` — and that is exactly why
//       it is wrong: a `git pull` that rewrites forty notes would open forty
//       offers to rewrite links the puller did not touch, and an offer nobody
//       asked for over files nobody looked at is how a bulk tool loses trust.
//   (c) THE WRITE PATH — `PUT /api/note` and its beacon twin. This is what
//       ships. It is server-side, so it covers every write this instance makes
//       whatever surface made it; it is scoped to writes the READER caused, so
//       an external change never opens an offer; and it costs nothing, because
//       the OLD anchor table is already in the index (`noteAnchors(path)`) and
//       the new one is computed by the reindex that follows the write anyway.
//
// The one thing (c) does not solve by itself is that a save fires while the
// reader is still typing: `## Introduction` → `## Introductio` → `## Introduc`
// is three renames, and only the first one has links pointing at it. So a
// rename is remembered as a CHAIN — the original anchor the links actually
// name, plus wherever the heading has got to now — and the offer names the
// pair. Type the heading back to what it was and the chain dissolves with it.

import { markdownAnchors, type NoteAnchor } from "../shared/anchors.ts";
import { isTexPath } from "../shared/noteFormat.ts";
import type { HeadingRepairOffer } from "../shared/types.ts";
import { wikilinkRegex } from "./indexer.ts";
import { parseTex } from "../shared/tex.ts";

/** Headings only. A `.tex` note's anchor table also holds `\label`s, sections,
 *  equations and figures; a `\label` is a name the AUTHOR chose and typing a
 *  new one is not a rename of the old one, so only markdown-style headings and
 *  LaTeX sections — the things whose id is DERIVED from their title — take part. */
function headings(anchors: readonly NoteAnchor[]): NoteAnchor[] {
  return anchors.filter((a) => a.kind === "heading" || a.kind === "section");
}

/** The anchor table a note's CURRENT text has. The indexer's `noteAnchors()`
 *  answers for the version it last indexed, which is the OLD one at the moment
 *  a write lands — that difference is the whole detector. */
export function anchorsOfContent(relPath: string, content: string): NoteAnchor[] {
  return isTexPath(relPath) ? parseTex(content).anchors : markdownAnchors(content);
}

/** One heading renamed in place, or null.
 *
 *  Deliberately strict. A rename is "the same headings, in the same order, with
 *  exactly one of them wearing a different title" — anything else (a heading
 *  added, one deleted, a paste that moved three) is an edit, not a rename, and
 *  guessing at it would rewrite links across the vault on the strength of a
 *  heuristic. The reader who really did rename two headings gets two offers,
 *  one save apart, which is the outcome that cannot be wrong. */
export function detectHeadingRename(
  before: readonly NoteAnchor[],
  after: readonly NoteAnchor[],
): { from: NoteAnchor; to: NoteAnchor } | null {
  const a = headings(before);
  const b = headings(after);
  if (a.length === 0 || a.length !== b.length) return null;
  let hit = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i].title === b[i].title) continue;
    if (hit !== -1) return null; // two at once: an edit, not a rename
    hit = i;
  }
  if (hit === -1) return null;
  // A title that changed without changing its slug (punctuation, capitals)
  // breaks no link: `findAnchor` matches the id first and the id is the same.
  if (a[hit].id.toLowerCase() === b[hit].id.toLowerCase()) return null;
  return { from: a[hit], to: b[hit] };
}

// -------------------------------------------------------------- the chain

interface Chain {
  /** The anchor the vault's links actually name — the heading as it stood
   *  before the reader started typing. */
  origId: string;
  origTitle: string;
  /** Where the heading has got to now. The next save's "before" side has to
   *  match this for the chain to continue. */
  curId: string;
  curTitle: string;
  at: number;
}

/** A chain exists to bridge the autosaves of ONE edit — the reader retyping a
 *  heading a letter at a time — and nothing longer.
 *
 *  IT HAS TO BE SHORT, and the reason is a real failure this number was raised
 *  from ten minutes to fix. Rename `Introduction` to `Preface`, take the
 *  repair, then change your mind and rename it back: the chain that survives
 *  that round records the settled heading as `Preface`, so renaming to
 *  `Preface` again half an hour later reads as "typed back to where it
 *  started" and the offer never appears. Ninety seconds is longer than any
 *  gap between consecutive saves of one word and shorter than any gap between
 *  two decisions. Nothing else depends on the chain: the repair route takes
 *  its pair from the offer and validates it against the note as it stands, so
 *  an expired chain costs nothing at all. */
const CHAIN_TTL_MS = 90_000;
/** One vault does not have a thousand headings under the cursor at once. */
const CHAIN_MAX = 64;

const chains = new Map<string, Chain>();

function pruneChains(): void {
  const cutoff = Date.now() - CHAIN_TTL_MS;
  for (const [path, chain] of chains) if (chain.at < cutoff) chains.delete(path);
  while (chains.size > CHAIN_MAX) {
    const oldest = chains.keys().next();
    if (oldest.done) break;
    chains.delete(oldest.value);
  }
}

/** Forget everything. Tests call it between vaults. */
export function clearHeadingChains(): void {
  chains.clear();
}

/** The rename a note is currently in the middle of, if any. */
export function pendingRename(relPath: string): Chain | null {
  const chain = chains.get(relPath);
  if (!chain) return null;
  if (chain.at < Date.now() - CHAIN_TTL_MS) {
    chains.delete(relPath);
    return null;
  }
  return chain;
}

export function forgetRename(relPath: string): void {
  chains.delete(relPath);
}

/** Fold one write into the chain for `relPath` and answer the rename the vault
 *  now needs repaired — null when this write renamed nothing.
 *
 *  The LINK COUNT is not this function's business: counting means reading every
 *  note that points here, which is I/O, and the caller does it only once a
 *  rename has actually been detected (`server/api.ts` fills in `links` and
 *  drops the offer when it comes back zero — a rename nobody linked to needs no
 *  repair and must not interrupt). The chain survives that drop: the reader may
 *  still be typing, and a later keystroke may well land on a heading that IS
 *  linked. */
export function observeWrite(
  relPath: string,
  before: readonly NoteAnchor[],
  content: string,
): Omit<HeadingRepairOffer, "links"> | null {
  pruneChains();
  const rename = detectHeadingRename(before, anchorsOfContent(relPath, content));
  if (rename === null) return null;

  const open = chains.get(relPath);
  const chain: Chain =
    open && open.curId.toLowerCase() === rename.from.id.toLowerCase()
      ? { ...open, curId: rename.to.id, curTitle: rename.to.title, at: Date.now() }
      : {
          origId: rename.from.id,
          origTitle: rename.from.title,
          curId: rename.to.id,
          curTitle: rename.to.title,
          at: Date.now(),
        };

  // Typed all the way back: there is nothing to repair, and the offer that was
  // standing a keystroke ago is now wrong. Drop the chain rather than keep an
  // identity rename alive.
  if (chain.origId.toLowerCase() === chain.curId.toLowerCase()) {
    chains.delete(relPath);
    return null;
  }
  chains.set(relPath, chain);
  return {
    path: relPath,
    from: chain.origId,
    fromTitle: chain.origTitle,
    to: chain.curId,
    toTitle: chain.curTitle,
  };
}

// ------------------------------------------------------- counting & rewriting

/** How a link SPELLED the anchor it was pointing at — `findAnchor` accepts an
 *  id, a slug of the title, or the title itself, so the repair has to answer in
 *  the same register it was addressed in. A link written `[[Note#Derivation]]`
 *  must come back `[[Note#The derivation]]`, not `[[Note#the-derivation]]`. */
function tailMatch(tail: string, id: string, title: string): "id" | "title" | null {
  const want = tail.trim();
  if (want === "") return null;
  // EXACT spellings first, and that ordering is the whole subtlety: a heading
  // called "Introduction" has the slug `introduction`, so the tail
  // `#Introduction` matches BOTH case-insensitively. Answering it as an id
  // would reprint the reader's prose in lower case — the link would work and
  // the sentence would be vandalised. What was written exactly wins; the
  // case-insensitive fallbacks catch `#INTRODUCTION` and `#Introduction ` last.
  if (want === id) return "id";
  if (want === title.trim()) return "title";
  const lower = want.toLowerCase();
  if (lower === title.trim().toLowerCase()) return "title";
  if (lower === id.toLowerCase()) return "id";
  return null;
}

/** Rewrite `[[…#from]]` tails that point at `targetPath` inside ONE note's
 *  source. Pure string work, like server/moveLinks.ts beside it, and the same
 *  contract: everything the rewrite did not aim at — the target half, the
 *  alias, the `!` of an embed — is reprinted byte for byte.
 *
 *  `resolves` answers whether a wikilink's target half names `targetPath`; the
 *  caller wires it to the indexer's own resolver so a basename link, a path
 *  link and an alias are all one question. */
export function rewriteHeadingLinks(
  content: string,
  resolves: (target: string) => boolean,
  from: { id: string; title: string },
  to: { id: string; title: string },
): { text: string; count: number } {
  let count = 0;
  const text = content.replace(
    wikilinkRegex(),
    (whole: string, target: string, heading?: string, alias?: string) => {
      if (heading === undefined) return whole;
      const how = tailMatch(heading.slice(1), from.id, from.title);
      if (how === null) return whole;
      if (!resolves(target.trim())) return whole;
      count++;
      return `[[${target}#${how === "id" ? to.id : to.title}${alias ?? ""}]]`;
    },
  );
  return { text, count };
}
