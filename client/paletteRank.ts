// WHAT THE COMMAND PALETTE CONSIDERS A MATCH, and in what order it puts the
// two kinds of row. Extracted from CommandPalette.tsx so that tests can drive
// exactly this code rather than a second copy of the arithmetic — the same
// argument client/keymap.ts makes for the keymap gate, and noteName.ts for the
// filename rule.
//
// THE BUG THIS FILE EXISTS FOR (v1.8 audit, F18). The palette's matcher
// rejected only a MISSING character, and the matched command block was
// concatenated whole on top of the note list. So typing "sort" put *Design
// your site* above every note in the vault: `s·o·r·t` really is a subsequence
// of "de**s**ign y**o**u**r** si**t**e". It just is not a match, and nothing in
// the code had ever said what a match is. Three things were missing — a floor,
// a cap, and one yardstick both kinds of row could be measured on — and this
// module is all three.
//
// No React, no store, no i18n: it takes strings and returns numbers, which is
// why it can be tested at all.

import { foldKeep } from "../shared/fold.ts";

export interface FuzzyResult {
  score: number;
  indices: number[];
}

/** A raw fuzzy score, divided by the number of characters the reader typed.
 *
 *  THE POINT OF NORMALIZING. The raw score grows with the query — four
 *  characters can earn 31 where two can earn at most ~15 — so no single number
 *  can be a floor across queries. Per character it is a QUALITY: a run that
 *  starts a word and continues unbroken pays 7–8, an acronym over word starts
 *  3.5–5.5 depending on how far apart the words are, and a subsequence
 *  scattered through unrelated words 2.5 or less, because every jump costs its
 *  gap penalty and earns no bonus. One constant separates the last two, which
 *  is what COMMAND_FLOOR is. */
export function normalize(score: number, queryLength: number): number {
  return score / Math.max(1, queryLength);
}

/** One greedy pass, taking the first occurrence of each query character at or
 *  after `from`. Both arguments are already lower-cased. */
function matchFrom(q: string, t: string, from: number): FuzzyResult | null {
  const indices: number[] = [];
  let score = 0;
  let ti = from;
  let prev = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return null;
    score += found === prev + 1 ? 8 : 1; // consecutive runs score high
    if (found === 0 || /[\s/\-_.]/.test(t[found - 1])) score += 6; // word starts
    score -= Math.min(3, found - ti); // mild gap penalty
    indices.push(found);
    prev = found;
    ti = found + 1;
  }
  return { score, indices };
}

/** The best subsequence match of `query` in `text`, or null when there is none.
 *
 *  ONE GREEDY PASS IS NOT ENOUGH once the score decides ORDER. Taking the first
 *  occurrence of each character is fine for a yes/no answer and wrong for a
 *  ranking: "note" against "Design Notes" latches onto the `n` of *desig**n***,
 *  and the whole word sitting two characters later — a word start followed by
 *  three consecutive characters, the best match this haystack has — is never
 *  seen. The note scored 3.25 and lost to four chrome rows in its own vault. So
 *  every position where the FIRST character occurs is tried as an anchor and
 *  the best pass wins; the highlight indices come from that pass, so the marks
 *  land on the run the score was actually paid for.
 *
 *  Bounded work by construction: these haystacks are command labels, hints and
 *  note titles — tens of characters, a handful of anchors. */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  // `foldKeep`, not `foldTerm`: the indices this returns are handed straight to
  // the row's highlighter, so the fold must not change a single offset. It
  // folds the LETTER FAMILIES (أ/ا, ى/ي, ة/ه, é/e) and leaves the harakat
  // standing — a subsequence match steps over those without noticing, and
  // deleting them would slide every `<mark>` one glyph left of the letter it
  // was paid for. Same table as the search index (shared/fold.ts), because the
  // quick switcher and the search box disagreeing about what a word IS is the
  // failure v1.8 set out to end.
  const q = foldKeep(query);
  const t = foldKeep(text);
  if (q === "") return { score: 0, indices: [] };
  let best: FuzzyResult | null = null;
  for (let from = t.indexOf(q[0]); from !== -1; from = t.indexOf(q[0], from + 1)) {
    const hit = matchFrom(q, t, from);
    if (hit === null) break; // no later anchor can complete what this one could not
    if (best === null || hit.score > best.score) best = hit;
  }
  return best;
}

/** THE SCORE FLOOR, in normalized points. MEASURED, not guessed: every query
 *  below was run against the whole command table (see tests/paletteRank.test.ts,
 *  which holds these numbers).
 *
 *    −0.75  "sort" → *Design your site*   ← the F18 trap
 *     1.50  "note" → *Design your site*
 *     2.50  the top of the scattered pile ("cp" → *Collapse all folders*)
 *   ┄ 3.00  THE FLOOR ┄
 *     3.50  "tg" → *Toggle graph*         ← the weakest match anyone MEANT
 *     7.75  "pane" → *Split pane*         ← a contiguous run at a word start
 *
 *  Three sits in the gap between the scattered pile and the weakest deliberate
 *  match — a two-letter acronym over word starts, which has to survive. The
 *  floor is not asked to separate perfectly; it is asked to delete the class of
 *  match nobody meant. Above it, ORDER does the remaining work: the cap keeps
 *  five and the sort puts the strong matches first, so an ambiguous hit sits
 *  under the row it was probably meant for instead of over the whole vault. */
export const COMMAND_FLOOR = 3;

/** How many command rows a query may put on screen. Past the fifth the list has
 *  stopped answering the query and started reciting the table, and what sits
 *  underneath is notes — the thing the palette is mostly for. */
export const MAX_COMMAND_ROWS = 5;

/** A note that matched only in its BODY, on the command scale: just under the
 *  floor. If the reader typed something that names a command well, that command
 *  outranks notes which merely contain the word somewhere in their prose —
 *  while a note whose TITLE is what was typed still wins, which is the whole
 *  complaint F18 was making. */
export const BODY_ONLY_SCORE = COMMAND_FLOOR - 0.5;

/** A note hit on the SAME yardstick as a command row, so the two can be ordered
 *  against each other at all. */
export function noteScore(query: string, title: string): number {
  const onTitle = fuzzyMatch(query, title);
  if (onTitle === null) return BODY_ONLY_SCORE;
  return Math.max(BODY_ONLY_SCORE, normalize(onTitle.score, query.length));
}

/** How far a hint hit is pushed below every label hit. Large enough to separate
 *  the two populations completely, small enough that hint hits keep their own
 *  order among themselves. */
const HINT_PENALTY = 100;

export interface RankedCommand<T> {
  command: T;
  /** Highlight positions in the LABEL. Empty for a hint hit — the indices
   *  belong to a string the row does not draw. */
  indices: number[];
  score: number;
}

/** The command rows a query earns: floored, sorted, capped.
 *
 *  The floor is applied to the label and to the hint SEPARATELY and BEFORE the
 *  hint's demotion. Demote first and every hint hit fails the floor, which
 *  deletes the searchable-hint behaviour rather than ranking it — and a hint is
 *  visible text on the row ("marginalia" / «الحواشي»), so typing what you can
 *  read must never answer "no matches". */
export function rankCommands<T>(
  query: string,
  commands: readonly T[],
  textOf: (command: T) => { label: string; hint?: string },
): RankedCommand<T>[] {
  const out: RankedCommand<T>[] = [];
  for (const command of commands) {
    const { label, hint } = textOf(command);
    const onLabel = fuzzyMatch(query, label);
    if (onLabel !== null) {
      const score = normalize(onLabel.score, query.length);
      if (score >= COMMAND_FLOOR) {
        out.push({ command, indices: onLabel.indices, score });
        continue;
      }
    }
    const onHint = hint === undefined ? null : fuzzyMatch(query, hint);
    if (onHint !== null) {
      const score = normalize(onHint.score, query.length);
      if (score >= COMMAND_FLOOR) out.push({ command, indices: [], score: score - HINT_PENALTY });
    }
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, MAX_COMMAND_ROWS);
}

/** WHERE THE COMMAND BLOCK LANDS among the notes: the number of leading note
 *  rows that outrank its best member.
 *
 *  Notes keep the server's relevance order EXACTLY — re-sorting them by title
 *  fuzz would throw away everything MiniSearch knows about the body — so the
 *  interleave is a placement rather than a merge, and each kind stays one run
 *  under one section caption. A true row-by-row weave prints "Commands / Notes
 *  / Commands / Notes" down the panel, which is four captions saying what the
 *  row icons had already said.
 *
 *  An exact tie goes to the command: a query that scores identically against a
 *  command's label and a note's title is a query that spelled the command out,
 *  and the command is the row that runs in one keystroke. */
export function commandCut(
  query: string,
  titles: readonly string[],
  bestCommandScore: number,
): number {
  let cut = 0;
  while (cut < titles.length && noteScore(query, titles[cut]) > bestCommandScore) cut++;
  return cut;
}
