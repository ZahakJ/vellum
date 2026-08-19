// THE BOOK STORE: what the reader was reading, and where they stopped.
//
// Two responsibilities, and the line between them is the whole design:
//
//   1. IDENTIFY a book by its bytes (`bookKey`), so that a position — and
//      every highlight, margin note and citation into it — survives the vault
//      being reorganised by something that is not us.
//   2. REMEMBER, in VELLUM_DATA/books.json, what each key's reader had done.
//
// WHY VELLUM_DATA AND NOT THE VAULT. The vault is the owner's own directory of
// ordinary files — that is the product's central promise, and it is why there
// is no database anywhere in this application. A sidecar `.vellum-reading.json`
// next to every PDF would be litter in a folder someone syncs, greps and backs
// up, and a dotfile at the vault root would be litter with better manners.
// Reading positions are OUR bookkeeping, not the reader's content, so they
// live where the rest of our bookkeeping lives (settings.json, designs.json,
// git-credentials.json) and the vault stays exactly as clean as the owner left
// it. `persist()` below is the same write-then-rename shape settings.ts uses,
// for the same reason: a crash mid-write must not cost a year of positions.
//
// THE PDF ITSELF IS NEVER WRITTEN TO — and that now covers highlights and
// margin notes as well as positions. Nothing in this module opens a vault file
// for anything but reading, and `scripts/check-books.mjs` asserts it by
// enumerating every write call in this file: the four in `persist()` are the
// whole list, and a fifth is a build failure. Annotating a book must not
// change one byte of it, because the reader's PDF is a file they own, they
// sync and they back up — and a 400 MB scan that changes every time somebody
// marks a sentence is a 400 MB scan every machine has to pull down again.
//
// WHY THE KEY IS A SAMPLE AND NOT THE WHOLE FILE. A scanned atlas is 400 MB.
// Hashing it whole costs a full read on every open and on every shelf listing,
// which on a NAS-mounted vault is seconds of spinning per book and, at 400
// books, a shelf that never paints. The sample is `size || first 64 KiB ||
// last 64 KiB`, and for a PDF those are the three most distinguishing regions
// there are: the header and the first object at the front, the cross-reference
// table and the trailer — including the /ID array the spec asks writers to
// make unique — at the back, and the exact length in between. Two different
// books colliding would need identical lengths AND identical xref tables. A
// file SMALLER than the two windows is hashed whole, so short PDFs get an
// exact digest for free.
//
// What this does mean, and it is the honest cost: re-saving a book (an OCR
// pass, a re-compression, adding a bookmark in another program) produces
// different bytes and therefore a NEW book with a fresh position. That is the
// right trade against the alternative — a stale path key that loses the
// position every time the file merely MOVES, which is the commoner event by a
// wide margin in a directory Obsidian and Syncthing both write to.

import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import {
  cleanBookState,
  cleanHighlight,
  cleanHighlights,
  DEFAULT_BOOK_STATE,
  HIGHLIGHTS_MAX,
  isBookKey,
  isHighlightId,
  sortHighlights,
  type BookHighlight,
  type BookState,
} from "../shared/bookAnchor.ts";
import type { BookEntry, BookHighlightHit, BookLocation } from "../shared/types.ts";
import { dataDir } from "./site.ts";
import { listVaultFiles, normalizeRel, safeAbs, VaultError } from "./vault.ts";

const BOOKS_FILE = "books.json";

/** Bytes sampled from each end of a book for its key. 64 KiB comfortably
 *  covers a PDF header plus its first objects, and a trailer plus the tail of
 *  a cross-reference table, in every file anyone has put in front of this. */
const SAMPLE_BYTES = 64 * 1024;

/** How many PDFs one shelf lists. A vault is a directory, and a directory can
 *  be a 30,000-file scan dump someone pointed VELLUM_VAULT at by mistake;
 *  hashing that would hang the route. The response says it was truncated
 *  rather than silently showing a prefix. */
export const BOOKS_MAX = 2000;

/** How many books the store remembers. Positions are ~200 bytes each, so this
 *  is a quarter-megabyte file at the ceiling — the cap exists so a decade of
 *  opening PDFs cannot grow an unbounded file, not because space is tight.
 *  Eviction is by `updatedAt`: the book you have not touched since 2029 goes
 *  before the one you read last night. */
export const STORE_MAX = 5000;

/** Concurrency for the shelf's hashing pass. Each key costs two small reads;
 *  eight in flight keeps a spinning disk busy without turning a 400-book vault
 *  into 400 simultaneous file handles. */
const HASH_CONCURRENCY = 8;

export function isPdfPath(rel: string): boolean {
  return /\.pdf$/i.test(rel);
}

// ── The key ────────────────────────────────────────────────────────────────

/** path → the key its bytes hashed to, valid while size and mtime hold.
 *  Cleared implicitly: an entry whose stat no longer matches is recomputed. */
const keyCache = new Map<string, { size: number; mtimeMs: number; key: string }>();

/** The content key for a vault PDF. Throws VaultError(404) when the path is
 *  not a readable file — the same answer /api/file gives, so a book deleted
 *  between the tree and the click reports the same thing everywhere. */
export async function bookKey(rel: string): Promise<string> {
  const relPath = normalizeRel(rel);
  if (!isPdfPath(relPath)) throw new VaultError(400, `Not a PDF: ${relPath}`);
  const abs = safeAbs(relPath);
  let size: number;
  let mtimeMs: number;
  try {
    const stat = statSync(abs);
    if (!stat.isFile()) throw new VaultError(404, `File not found: ${relPath}`);
    size = stat.size;
    mtimeMs = stat.mtimeMs;
  } catch (err) {
    if (err instanceof VaultError) throw err;
    throw new VaultError(404, `File not found: ${relPath}`);
  }
  const cached = keyCache.get(relPath);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.key;

  const hash = createHash("sha256");
  // The length goes in FIRST and as text, so two files that share a head and a
  // tail but differ in the middle (a page inserted into an otherwise identical
  // print run) cannot collide on length alone.
  hash.update(`pdf:${size}:`);
  const handle = await open(abs, "r");
  try {
    const head = Buffer.alloc(Math.min(SAMPLE_BYTES, size));
    if (head.length > 0) await handle.read(head, 0, head.length, 0);
    hash.update(head);
    if (size > SAMPLE_BYTES) {
      const tailLen = Math.min(SAMPLE_BYTES, size - SAMPLE_BYTES);
      const tail = Buffer.alloc(tailLen);
      await handle.read(tail, 0, tailLen, size - tailLen);
      hash.update(tail);
    }
  } finally {
    await handle.close();
  }
  const key = hash.digest("hex");
  keyCache.set(relPath, { size, mtimeMs, key });
  return key;
}

// ── The store ──────────────────────────────────────────────────────────────

interface StoreFile {
  version: 1;
  books: Record<string, BookState>;
  /** Annotations, under the same content keys. A SIBLING of `books` rather
   *  than a field inside each state, and that is deliberate: a reading
   *  position is patched forty times an hour by a scroll and is merged
   *  partially (`cleanBookState(patch, prev)`), while a highlight list is
   *  replaced wholesale by a deliberate act. Putting a list of annotations
   *  inside the record a debounced scroll write merges into is how a passage
   *  someone marked gets clobbered by them scrolling past it. */
  highlights: Record<string, BookHighlight[]>;
}

/** An empty store — spelled once, because there are three places that need one
 *  (no file, an unreadable file, a first write) and a fourth shape of empty is
 *  a bug waiting for a reader whose disk filled up. */
function emptyStore(): StoreFile {
  return { version: 1, books: {}, highlights: {} };
}

/** mtime-checked, exactly like settings.ts: an external edit (or a restore
 *  from backup) is picked up without a restart, and the common case is one
 *  cheap stat. Reads NEVER throw — a corrupt store costs positions, and losing
 *  positions must not also mean losing the ability to open a book. */
let cache: { store: StoreFile; mtimeMs: number } | null = null;

function storePath(): string {
  return path.join(dataDir(), BOOKS_FILE);
}

function readStore(): StoreFile {
  const file = storePath();
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    cache = { store: emptyStore(), mtimeMs };
    return cache.store;
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache.store;
  const store: StoreFile = emptyStore();
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const books = (parsed as { books?: unknown })?.books;
    if (typeof books === "object" && books !== null && !Array.isArray(books)) {
      for (const [key, value] of Object.entries(books as Record<string, unknown>)) {
        // A key that is not a digest is not ours. Dropped rather than kept:
        // the file is a map from OUR key space, and anything else in it is
        // either corruption or a future format we do not understand yet.
        if (!isBookKey(key)) continue;
        store.books[key] = cleanBookState(value);
      }
    }
    const marks = (parsed as { highlights?: unknown })?.highlights;
    if (typeof marks === "object" && marks !== null && !Array.isArray(marks)) {
      for (const [key, value] of Object.entries(marks as Record<string, unknown>)) {
        if (!isBookKey(key)) continue;
        const list = cleanHighlights(value);
        if (list.length > 0) store.highlights[key] = list;
      }
    }
  } catch (err) {
    console.warn("vellum: books.json unreadable — reading positions and annotations start fresh:", err);
  }
  cache = { store, mtimeMs };
  return store;
}

function persist(store: StoreFile): void {
  const file = storePath();
  mkdirSync(path.dirname(file), { recursive: true });
  // Write-then-rename, same as settings.ts: a crash mid-write must never leave
  // a torn books.json, because the thing it holds cannot be recomputed from
  // anywhere — nobody remembers what page they were on.
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
  cache = null; // the rename just changed mtime
}

/** The stored state for a key, or null when this book has never been opened.
 *  Null is a real answer the shelf draws differently from "page 1". */
export function getBookState(key: string): BookState | null {
  if (!isBookKey(key)) throw new VaultError(400, "Not a book key");
  return readStore().books[key] ?? null;
}

/** Merge a patch into a key's state and persist. The patch is partial by
 *  design: a scroll PUTs `{ page, offset }` and nothing else, so a reader on a
 *  slow link cannot have a stale echo of the whole record undo their zoom. */
export function putBookState(key: string, patch: unknown): BookState {
  if (!isBookKey(key)) throw new VaultError(400, "Not a book key");
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    throw new VaultError(400, "Book state must be an object");
  }
  const store = readStore();
  const prev = store.books[key] ?? DEFAULT_BOOK_STATE;
  const next = cleanBookState({ ...patch, updatedAt: Date.now() }, prev);
  const books: Record<string, BookState> = { ...store.books, [key]: next };
  const keys = Object.keys(books);
  if (keys.length > STORE_MAX) {
    // Evict the least recently READ, not the least recently opened file: the
    // store is a memory of reading, and the sort key is the only timestamp
    // that means that.
    keys
      .sort((a, b) => books[a].updatedAt - books[b].updatedAt)
      .slice(0, keys.length - STORE_MAX)
      .forEach((old) => delete books[old]);
  }
  persist({ ...store, books });
  return next;
}

/** Forget one book's position (`:forget`). Silent when the key is unknown —
 *  forgetting what was already forgotten is not an error.
 *
 *  ANNOTATIONS SURVIVE IT. `:forget` means "stop resuming this book", which is
 *  a sentence about a scroll offset; the passages someone marked and the notes
 *  they wrote in the margin are their work, and a command that reads as tidying
 *  up must never be the command that throws work away. Deleting a highlight is
 *  its own act, one at a time, with an Undo on it. */
export function forgetBook(key: string): void {
  if (!isBookKey(key)) throw new VaultError(400, "Not a book key");
  const store = readStore();
  if (!(key in store.books)) return;
  const books = { ...store.books };
  delete books[key];
  persist({ ...store, books });
}

// ── Annotations ────────────────────────────────────────────────────────────
//
// Highlights and margin notes, under the same content keys and in the same
// file. Nothing here touches a vault file: the passages are OURS to store and
// the PDF is the reader's to own (shared/bookAnchor.ts argues the trade).

/** Every highlight in one book, in reading order. An empty array for a book
 *  nobody has marked — which, unlike a reading position, is not a fact worth
 *  distinguishing from "never opened". */
export function getHighlights(key: string): BookHighlight[] {
  if (!isBookKey(key)) throw new VaultError(400, "Not a book key");
  return readStore().highlights[key] ?? [];
}

/** Add or replace one highlight, and persist.
 *
 *  Upsert by id rather than append, because that is what EVERY caller wants:
 *  changing the ink, writing a margin note and correcting a quote are all the
 *  same request with the same id, and a store that appended would leave the
 *  old ribbon painted on the page under the new one. */
export function putHighlight(key: string, input: unknown): BookHighlight {
  if (!isBookKey(key)) throw new VaultError(400, "Not a book key");
  const clean = cleanHighlight(input);
  if (clean === null) throw new VaultError(400, "Not a highlight");
  const store = readStore();
  const previous = store.highlights[key] ?? [];
  const kept = previous.filter((h) => h.id !== clean.id);
  if (kept.length >= HIGHLIGHTS_MAX) {
    throw new VaultError(400, `A book may hold ${HIGHLIGHTS_MAX} highlights`);
  }
  const next = sortHighlights([...kept, clean]);
  persist({ ...store, highlights: { ...store.highlights, [key]: next } });
  return clean;
}

/** Remove one highlight. Silent when it was already gone: the Undo on the
 *  toast and a second press of `x` are the same request twice, and neither is
 *  an error. */
export function deleteHighlight(key: string, id: string): void {
  if (!isBookKey(key)) throw new VaultError(400, "Not a book key");
  if (!isHighlightId(id)) throw new VaultError(400, "Not a highlight id");
  const store = readStore();
  const previous = store.highlights[key];
  if (!previous) return;
  const next = previous.filter((h) => h.id !== id);
  if (next.length === previous.length) return;
  const highlights = { ...store.highlights };
  if (next.length === 0) delete highlights[key];
  else highlights[key] = next;
  persist({ ...store, highlights });
}

/** How many highlights the shelf's search will carry across the wire at once.
 *
 *  The search itself is done in the CLIENT, on the same fold the in-book
 *  search uses (client/books/search.ts) — an Arabic passage marked with its
 *  harakat has to be found by someone typing it without them, and there is
 *  exactly one implementation of that rule in this product. Shipping the
 *  passages instead of the query is what lets the shelf reuse it, and this cap
 *  is what keeps that honest: a vault with a decade of marginalia sends its
 *  most recent four thousand and says the answer was cut short. */
export const HIGHLIGHT_SEARCH_MAX = 4000;

export interface HighlightSearchResult {
  hits: BookHighlightHit[];
  truncated: boolean;
}

/** Every highlight in the store, newest first, each carrying enough about its
 *  book to be shown and opened: the key (the address), the last name the book
 *  was seen under and its title. */
export function allHighlights(): HighlightSearchResult {
  const store = readStore();
  const hits: BookHighlightHit[] = [];
  for (const [key, list] of Object.entries(store.highlights)) {
    const state = store.books[key] ?? null;
    for (const highlight of list) {
      hits.push({
        key,
        path: state?.path ?? "",
        title: state?.title ?? "",
        pages: state?.pages ?? 0,
        highlight,
      });
    }
  }
  hits.sort((a, b) => b.highlight.updatedAt - a.highlight.updatedAt);
  const truncated = hits.length > HIGHLIGHT_SEARCH_MAX;
  return { hits: truncated ? hits.slice(0, HIGHLIGHT_SEARCH_MAX) : hits, truncated };
}

/**
 * Where the book carrying this highlight is RIGHT NOW.
 *
 * This is the whole rename story in one function, and it is why a citation is
 * worth making. A note says `[[Ihya.pdf#page=42&…&id=k7f3q2a9]]`; three months
 * later the file is `Sources/al-Ghazali - Ihya (ed. 1998).pdf`, because that is
 * what people do to a shelf, and every reader that stored a path has a dead
 * link. Here the id names a CONTENT KEY, and the key is the bytes, so:
 *
 *   1. The names this key has been seen under are tried first, newest first.
 *      Two cheap reads each, and it answers the common case — the book moved
 *      once, we saw it there, and the note is a month old.
 *   2. Failing that, the vault's PDFs are walked and hashed (`listBooks`),
 *      which is the same pass the shelf already does. It is the expensive
 *      answer and it is only reached when a book turns up somewhere it has
 *      never been seen — a `git pull`, a restore, a new machine.
 *
 * `path` is null when the bytes are genuinely not in this vault any more. That
 * is a real answer and the reader gets told it, rather than being shown a
 * spinner that never resolves.
 */
export async function locateHighlight(id: string): Promise<BookLocation | null> {
  if (!isHighlightId(id)) throw new VaultError(400, "Not a highlight id");
  const store = readStore();
  for (const [key, list] of Object.entries(store.highlights)) {
    const highlight = list.find((h) => h.id === id);
    if (!highlight) continue;
    const state = store.books[key] ?? null;
    const names = state?.names ?? (state?.path ? [state.path] : []);
    return { key, path: await pathForKey(key, names), names, highlight };
  }
  return null;
}

/** Where a key's bytes currently live, or null. Names first, then the walk —
 *  see `locateHighlight` for the argument. */
export async function pathForKey(key: string, names: readonly string[]): Promise<string | null> {
  if (!isBookKey(key)) throw new VaultError(400, "Not a book key");
  for (const name of names) {
    try {
      if (!isPdfPath(name)) continue;
      if (!statSync(safeAbs(normalizeRel(name))).isFile()) continue;
      if ((await bookKey(name)) === key) return name;
    } catch {
      // Not there any more, or not readable: try the next name it has worn.
    }
  }
  const { books } = await listBooks();
  return books.find((b) => b.key === key)?.path ?? null;
}

// ── The shelf ──────────────────────────────────────────────────────────────

export interface ShelfResult {
  books: BookEntry[];
  truncated: boolean;
}

/** Every PDF in the vault, newest-read first, each with its key and state.
 *
 *  The sort is the shelf's argument for existing: a reader opening the library
 *  is overwhelmingly resuming something, so books with a position come first
 *  in the order they were last read, and everything else follows alphabetically
 *  — the difference between "your shelf" and "a directory listing". */
export async function listBooks(): Promise<ShelfResult> {
  const { attachments } = await listVaultFiles();
  const pdfs = attachments.filter(isPdfPath).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" }),
  );
  const truncated = pdfs.length > BOOKS_MAX;
  const shortlist = truncated ? pdfs.slice(0, BOOKS_MAX) : pdfs;

  const entries: BookEntry[] = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= shortlist.length) return;
      const rel = shortlist[index];
      try {
        const stat = statSync(safeAbs(rel));
        if (!stat.isFile()) continue;
        const key = await bookKey(rel);
        entries.push({
          path: rel,
          name: path.posix.basename(rel),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          key,
          state: getBookState(key),
        });
      } catch {
        // A book that vanished between the walk and the hash, or one the
        // filesystem refuses to read: it is simply not on the shelf. A shelf
        // that 500s because one file is unreadable is worse than a shelf with
        // one book missing from it.
      }
    }
  };
  await Promise.all(Array.from({ length: HASH_CONCURRENCY }, worker));

  entries.sort((a, b) => {
    const ra = a.state?.updatedAt ?? 0;
    const rb = b.state?.updatedAt ?? 0;
    if (ra !== rb) return rb - ra;
    return a.path.localeCompare(b.path, undefined, { sensitivity: "base" });
  });
  return { books: entries, truncated };
}

/** Everything the reader needs before pdf.js has even been downloaded: the
 *  key for these bytes and the position filed under it. */
export async function openBook(rel: string): Promise<BookEntry> {
  const relPath = normalizeRel(rel);
  const key = await bookKey(relPath);
  const stat = statSync(safeAbs(relPath));
  return {
    path: relPath,
    name: path.posix.basename(relPath),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    key,
    state: getBookState(key),
  };
}
