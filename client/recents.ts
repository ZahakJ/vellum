// Frecency over notes VISITED — the palette's memory, and the ranking signal
// the wikilink autocomplete borrows.
//
// "Recently opened" sounds like the tab bar, and it is not: a writer hops
// through six notes in an evening, closes five, and the next morning wants
// the palette to answer "the ones I was just in" — including the closed ones.
// So this module records every note the store's `openPath` lands on, not the
// tabs that happen to survive, and ranks them by FRECENCY: a decayed visit
// count, so a note opened forty times last month still outranks one opened
// once this morning, but not one opened five times today.
//
// The ledger is a browser-local fact (localStorage), like the theme and the
// vim flag: which notes THIS reader keeps returning to is not vault data, and
// an admin's trail must never travel to a visitor. Two consequences the code
// below is shaped around:
//
//   1. PATHS ONLY, PRUNED AT READ TIME. The ledger stores paths, never titles,
//      and every read filters against the live tree. A deleted note leaves the
//      list the moment the tree stops carrying it; a visitor session's tree
//      only carries published notes, so a private note's path — even one left
//      behind by an earlier admin session in the same browser — never surfaces
//      a title it has no right to show.
//   2. STORAGE IS RE-READ ON EVERY PUBLIC CALL. Pop-out windows share the
//      origin's localStorage; an in-memory copy would let two windows clobber
//      each other's evenings. Fifty entries of JSON per palette-open is free.
//
// The math: each entry keeps one WEIGHT and the time it was last touched.
// A visit first decays the stored weight to now (half-life below), then adds
// 1 — so the weight IS the decayed visit count, maintained incrementally,
// and reading a score is one multiplication rather than a replay of history.
// Recency needs no separate term: a fresh visit's +1 has decayed less than
// anyone else's, which is exactly what "recency bonus" means.
//
// This module must stay importable under bare node (tests/recents.test.ts):
// no state.ts import — the store is handed IN through installRecents(), which
// the palette calls — and localStorage is only touched behind guards.

import { collectNotes } from "./editor/links.ts";
import { isNotePath } from "../shared/noteFormat.ts";
import type { TreeNode } from "../shared/types.ts";

export interface RecentEntry {
  /** Vault-relative note path — the only identity stored. Never a title. */
  path: string;
  /** Decayed visit count AS OF `at`. Multiply by the decay since `at` to get
   *  the score now (`decayedWeight`). */
  weight: number;
  /** Last visit, ms since epoch. */
  at: number;
}

/** Hard cap on the persisted ledger. Fifty is a few weeks of real writing;
 *  past it the tail is entries whose weight has decayed to noise anyway. */
export const RECENTS_MAX = 50;

/** Half-life of a visit: a week. Short enough that last month's obsession
 *  yields to this week's, long enough that a weekend away changes nothing. */
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

const STORE_KEY = "vellum.recents";

/** `entry`'s score at `now`. Clock skew (an entry from the future, after a
 *  clock reset) must not explode into a huge score, so the exponent is
 *  floored at zero: the entry reads as "just visited", nothing more. */
export function decayedWeight(entry: RecentEntry, now: number): number {
  const age = Math.max(0, now - entry.at);
  return entry.weight * Math.pow(0.5, age / HALF_LIFE_MS);
}

/** A visit to `path`, pure over the ledger: decay-then-increment, newest
 *  first, capped at RECENTS_MAX by score (not by age — a heavily-visited
 *  entry outlives a string of one-offs even at the cap). */
export function recordVisit(
  entries: readonly RecentEntry[],
  path: string,
  now: number,
): RecentEntry[] {
  const prev = entries.find((e) => e.path === path);
  const carried = prev === undefined ? 0 : decayedWeight(prev, now);
  const next: RecentEntry[] = [
    { path, weight: carried + 1, at: now },
    ...entries.filter((e) => e.path !== path),
  ];
  if (next.length <= RECENTS_MAX) return next;
  // Over the cap: drop the lowest-scoring entry, which is not necessarily
  // the last one in visit order.
  next.sort((a, b) => decayedWeight(b, now) - decayedWeight(a, now));
  return next.slice(0, RECENTS_MAX);
}

/** The ledger ranked for display: pruned against `live` (the paths the
 *  CURRENT session's tree actually carries — deletion and visibility are the
 *  same filter), scored at `now`, best first. Ties break by last visit, then
 *  path, so the order is total and two openings of the palette in one minute
 *  show the same list — the muscle-memory property. */
export function rankRecents(
  entries: readonly RecentEntry[],
  live: ReadonlySet<string>,
  now: number,
): string[] {
  return entries
    .filter((e) => live.has(e.path))
    .sort(
      (a, b) =>
        decayedWeight(b, now) - decayedWeight(a, now) ||
        b.at - a.at ||
        a.path.localeCompare(b.path),
    )
    .map((e) => e.path);
}

/** Parse a stored ledger, dropping anything malformed rather than throwing:
 *  a corrupt ledger is an empty memory, never a broken palette. */
export function parseRecents(raw: string | null): RecentEntry[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RecentEntry[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const { path, weight, at } = item as Record<string, unknown>;
    if (typeof path !== "string" || !isNotePath(path)) continue;
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0) continue;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ path, weight, at });
  }
  return out.slice(0, RECENTS_MAX);
}

// ── Storage ────────────────────────────────────────────────────────────────
// Guarded twice: `typeof localStorage` for bare node (the tests), try/catch
// for browsers where storage throws (private mode quotas). Either failure
// degrades to "no memory", which every caller already renders correctly.

function readLedger(): RecentEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return parseRecents(localStorage.getItem(STORE_KEY));
  } catch {
    return [];
  }
}

function writeLedger(entries: readonly RecentEntry[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(entries));
  } catch {
    // Full or forbidden: the visit is lost, the app is not.
  }
}

// ── The live module ────────────────────────────────────────────────────────

/** Record a visit to `path` (read-modify-write, so a sibling window's visits
 *  survive ours). The subscription below is the only production caller. */
export function noteVisit(path: string, now: number = Date.now()): void {
  if (!isNotePath(path)) return;
  writeLedger(recordVisit(readLedger(), path, now));
}

/** The recent notes, ready for the palette: pruned against `tree` at THIS
 *  read — a path the tree no longer carries (deleted, or not published to
 *  this session) is not returned and therefore never surfaces a title. */
export function recentNotes(
  tree: TreeNode | null,
  opts: { exclude?: string | null; limit?: number } = {},
): string[] {
  if (tree === null) return [];
  const live = new Set(collectNotes(tree).map((n) => n.path));
  const ranked = rankRecents(readLedger(), live, Date.now());
  const withoutOpen =
    opts.exclude == null ? ranked : ranked.filter((p) => p !== opts.exclude);
  return opts.limit === undefined ? withoutOpen : withoutOpen.slice(0, opts.limit);
}

/** Frecency score per path, for the autocomplete's ranking. No tree prune:
 *  callers only look up paths they already hold from the live tree, so a dead
 *  entry here can never add a row — it just scores nothing. */
export function recentScores(now: number = Date.now()): Map<string, number> {
  const out = new Map<string, number>();
  for (const entry of readLedger()) out.set(entry.path, decayedWeight(entry, now));
  return out;
}

/** The slice of the store this module watches. Typed structurally rather than
 *  importing state.ts: the store module touches localStorage and `window` at
 *  import time, which would take this file's tests down with it — and the
 *  palette, which already owns a store import, is the natural installer. */
export interface OpenPathStore {
  getState(): { openPath: string | null };
  subscribe(
    listener: (
      s: { openPath: string | null },
      prev: { openPath: string | null },
    ) => void,
  ): () => void;
}

let installed = false;

/** Start recording visits: every change of the store's `openPath` onto a note
 *  is one. Called by the palette at module load (NOT by state.ts — recording
 *  is this feature's concern, and the store must not grow a dependency on
 *  it). Idempotent, because module-load call sites run once per module but
 *  the guard makes that a fact rather than a hope. */
export function installRecents(store: OpenPathStore): void {
  if (installed) return;
  installed = true;
  // The note already open when we arrive (a restored workspace) counts as
  // visited: the subscription only sees transitions, and the note the reader
  // is looking at right now is the one most worth remembering.
  const current = store.getState().openPath;
  if (current !== null) noteVisit(current);
  store.subscribe((s, prev) => {
    if (s.openPath !== prev.openPath && s.openPath !== null) noteVisit(s.openPath);
  });
}
