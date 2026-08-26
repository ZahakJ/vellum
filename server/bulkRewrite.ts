// THE ENGINE UNDER EVERY VAULT-WIDE EDIT: preview, apply, take back.
//
// Bulk-edit tools are what note-takers ask for most and trust least, and the
// reason is always the same — a rewrite that touched four hundred files is not
// something a reader can inspect afterwards, so a wrong one is unrecoverable.
// Every such tool in Vellum (tag rename/merge, heading-link repair, and the
// search-and-replace that lands beside them) runs through this module, so the
// three promises are made once instead of three times:
//
//   1. NOTHING IS WRITTEN THAT WAS NOT PREVIEWED. `previewBulk` and `applyBulk`
//      run the SAME transform over the SAME reads. A preview that is produced
//      by different code from the apply is a preview of a different operation.
//   2. NOTHING IS CLOBBERED. Every write carries `writeNote`'s mtime
//      precondition, taken from the read this very call made. A file somebody
//      else changed between the read and the write is SKIPPED and reported, not
//      overwritten — a bulk edit that loses one paragraph of somebody else's
//      work has failed, however many files it got right.
//   3. THERE IS A WAY BACK. Apply keeps the pre-edit bytes of every file it
//      changed in an undo bundle, so one button puts the vault back exactly as
//      it was — including the half of the operation that is not a file at all
//      (a settings re-key, a renamed tag page), which the caller hands over as
//      a `revert` closure.
//
// The bundles are in memory and capped (see UNDO_BYTES_MAX): a rewrite bigger
// than the cap is offered WITHOUT an undo rather than with one that cannot be
// honoured, and the honest answer there is the snapshot — `git` history, which
// v1.8 ships underneath all of this precisely so the scary tools have a floor.

import { randomUUID } from "node:crypto";
import type { BulkResult, BulkSkip } from "../shared/types.ts";
import { indexFile } from "./indexer.ts";
import { emitEvent, readNote, suppressWatcherEcho, writeNote, VaultError } from "./vault.ts";

/** One file's share of a bulk edit: the text to write and how many
 *  substitutions produced it. `null` means the transform found nothing — the
 *  file is not read again, not written, and not counted. */
export type BulkTransform = (
  relPath: string,
  content: string,
) => { text: string; count: number } | null;

/** What a preview says about one file. `count` is what will actually change,
 *  not what the index thinks is there: the index over-counts tags inside code
 *  fences (a known bug tests/tags.test.ts pins), and a preview that repeated
 *  that number would be promising an edit the writer deliberately will not
 *  make. `lines` is a small sample — the dialogs print a handful, never four
 *  hundred. */
export interface BulkPreviewFile {
  path: string;
  count: number;
  lines: { line: number; before: string; after: string }[];
}

export interface BulkPreview {
  files: BulkPreviewFile[];
  /** Files with at least one change — the "N notes" every dialog prints. */
  notes: number;
  /** Substitutions across all of them. */
  edits: number;
}

/** How many changed lines a preview carries per file. A dialog is a sentence
 *  and a list, not a diff viewer; the diff viewer is the history panel. */
const PREVIEW_LINES = 3;

/** Changed lines, paired old-to-new. Only meaningful when the transform keeps
 *  the line count, which every rewrite in this product does (a tag rename can
 *  DELETE a duplicate item line, so the pairing is by index and stops at the
 *  shorter side rather than assuming). */
function changedLines(before: string, after: string): BulkPreviewFile["lines"] {
  const a = before.split("\n");
  const b = after.split("\n");
  const out: BulkPreviewFile["lines"] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n && out.length < PREVIEW_LINES; i++) {
    if (a[i] === b[i]) continue;
    out.push({ line: i + 1, before: a[i].trim().slice(0, 200), after: b[i].trim().slice(0, 200) });
  }
  return out;
}

/** Read each path, run the transform, report — WITHOUT writing a byte. The
 *  dry-run half of every bulk route, and the same reads the apply will make. */
export async function previewBulk(
  paths: readonly string[],
  transform: BulkTransform,
): Promise<BulkPreview> {
  const files: BulkPreviewFile[] = [];
  let edits = 0;
  for (const relPath of paths) {
    let content: string;
    try {
      content = (await readNote(relPath)).content;
    } catch {
      // A path the index still names and the disk no longer has is not an
      // error the reader caused — it is a file that went while we were
      // asking. It contributes nothing and says nothing.
      continue;
    }
    const next = transform(relPath, content);
    if (next === null || next.count === 0 || next.text === content) continue;
    edits += next.count;
    files.push({ path: relPath, count: next.count, lines: changedLines(content, next.text) });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, notes: files.length, edits };
}

// ----------------------------------------------------------------- undo

interface UndoFile {
  path: string;
  /** The bytes the file held BEFORE this bundle touched it. */
  before: string;
  /** The mtime our own write left behind. A file whose mtime has moved since
   *  has been edited by somebody else, and putting our snapshot back over it
   *  would be the clobber this whole module exists to refuse. */
  mtimeAfter: number;
}

interface UndoBundle {
  id: string;
  at: number;
  bytes: number;
  files: UndoFile[];
  /** The half of the operation that is not a file: settings.tagLabels re-keyed,
   *  a tag page renamed. Run AFTER the files are back, so a vault that ends up
   *  half-restored still has its settings describing the files that are there. */
  revert: (() => Promise<void>) | null;
}

/** Bundles live in memory, so they are capped by BYTES, not by count: one
 *  vault-wide replace over a book-length vault must not be able to pin a
 *  hundred megabytes for the fifteen minutes nobody presses Undo. */
const UNDO_BYTES_MAX = 12 * 1024 * 1024;
/** How many operations can still be taken back. Deeper than one because the
 *  tag dialog's own flow is "rename, look, rename again". */
const UNDO_BUNDLES_MAX = 4;
/** A bundle older than this is not an offer any more — the toast that carried
 *  it faded twenty minutes ago, and the vault has moved on. */
const UNDO_TTL_MS = 30 * 60_000;

const bundles: UndoBundle[] = [];

function prune(): void {
  const cutoff = Date.now() - UNDO_TTL_MS;
  for (let i = bundles.length - 1; i >= 0; i--) {
    if (bundles[i].at < cutoff) bundles.splice(i, 1);
  }
  while (bundles.length > UNDO_BUNDLES_MAX) bundles.shift();
}

/** Drop every bundle. Tests call it between vaults; nothing in the running
 *  server does, because a bundle is only ever about files that still exist. */
export function clearUndoBundles(): void {
  bundles.length = 0;
}

// --------------------------------------------------------------- apply

export interface BulkApplyOptions {
  /** Undone with the files. Called by `undoBulk` after the last write. */
  revert?: () => Promise<void>;
}

/** Run the transform over every path and WRITE what it produced.
 *
 *  The read is this call's own, and its mtime is the precondition on the write
 *  that follows it — so the window in which a conflicting edit can be missed is
 *  the width of one file's transform, not the width of the reader's dialog.
 *  A conflict skips that file and is reported; the rest of the operation
 *  proceeds, because refusing four hundred correct edits over one conflicted
 *  file is not caution, it is a tool that cannot be used on a vault anybody
 *  else is touching. */
export async function applyBulk(
  paths: readonly string[],
  transform: BulkTransform,
  opts: BulkApplyOptions = {},
): Promise<BulkResult> {
  const changed: BulkResult["changed"] = [];
  const skipped: BulkSkip[] = [];
  const undoFiles: UndoFile[] = [];
  let bytes = 0;
  let edits = 0;

  for (const relPath of paths) {
    let content: string;
    let mtimeMs: number;
    try {
      const note = await readNote(relPath);
      content = note.content;
      mtimeMs = note.mtimeMs;
    } catch {
      continue; // gone while we were asking — see previewBulk
    }
    const next = transform(relPath, content);
    if (next === null || next.count === 0 || next.text === content) continue;
    try {
      // The synthetic event below is the whole story of this write; the
      // watcher's echo of it would arrive a debounce later and be read as
      // somebody editing the file in Obsidian.
      suppressWatcherEcho(relPath);
      const written = await writeNote(relPath, next.text, mtimeMs);
      undoFiles.push({ path: relPath, before: content, mtimeAfter: written.mtimeMs });
      bytes += content.length;
      emitEvent({ kind: "changed", path: relPath });
      await indexFile(relPath);
      changed.push({ path: relPath, count: next.count });
      edits += next.count;
    } catch (err) {
      // A precondition failure is the ONE outcome this tool has to name: the
      // reader is owed the list of files it did not touch, so they can look.
      const conflict = err instanceof VaultError && err.code === "stale";
      skipped.push({ path: relPath, reason: conflict ? "conflict" : "error" });
      if (!conflict) console.error(`vellum: bulk rewrite of ${relPath} failed`, err);
    }
  }

  let undoId: string | null = null;
  if (undoFiles.length > 0 && bytes <= UNDO_BYTES_MAX) {
    prune();
    undoId = randomUUID();
    bundles.push({
      id: undoId,
      at: Date.now(),
      bytes,
      files: undoFiles,
      revert: opts.revert ?? null,
    });
    prune();
  } else if (undoFiles.length > 0 && opts.revert) {
    // Too big to take back as bytes, but the settings half is cheap and must
    // not be left describing a rewrite that has no undo — it is put back at
    // once rather than stranded. (Nothing calls this today: every caller's
    // revert is paired with a bundle. It is here so the pairing cannot rot.)
    await opts.revert().catch((err: unknown) => {
      console.error("vellum: reverting the non-file half of a bulk edit failed", err);
    });
  }

  return { changed, skipped, notes: changed.length, edits, undoId };
}

/** Put a bundle's files back exactly as they were.
 *
 *  Same precondition, other direction: a file edited since the bulk edit is
 *  SKIPPED, because an undo that silently discards work done after the thing
 *  being undone is the same clobber wearing a friendly label. */
export async function undoBulk(undoId: string): Promise<BulkResult> {
  prune();
  const at = bundles.findIndex((b) => b.id === undoId);
  if (at === -1) {
    throw new VaultError(410, "That change can no longer be taken back", "undoExpired");
  }
  const bundle = bundles.splice(at, 1)[0];
  const changed: BulkResult["changed"] = [];
  const skipped: BulkSkip[] = [];

  for (const file of bundle.files) {
    try {
      const note = await readNote(file.path);
      if (note.mtimeMs !== file.mtimeAfter) {
        skipped.push({ path: file.path, reason: "conflict" });
        continue;
      }
      suppressWatcherEcho(file.path);
      await writeNote(file.path, file.before, note.mtimeMs);
      emitEvent({ kind: "changed", path: file.path });
      await indexFile(file.path);
      changed.push({ path: file.path, count: 1 });
    } catch (err) {
      skipped.push({ path: file.path, reason: "error" });
      console.error(`vellum: undoing the bulk edit of ${file.path} failed`, err);
    }
  }
  if (bundle.revert) {
    await bundle.revert().catch((err: unknown) => {
      console.error("vellum: undoing the non-file half of a bulk edit failed", err);
    });
  }
  return { changed, skipped, notes: changed.length, edits: changed.length, undoId: null };
}
