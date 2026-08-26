// VAULT-WIDE SEARCH AND REPLACE — 650 likes, eight years, and Obsidian's own
// answer is still "open the folder in VS Code."
//
// Nobody ships this well because a bad vault-wide edit is unrecoverable, so the
// order things were built in this release is the whole argument: the undo of
// last resort first (git snapshots, workstream H), then the shared bulk engine
// with its three promises (server/bulkRewrite.ts), and only then the scary tool
// on top of both. This module is the tool; it owns no writes, no undo and no
// preconditions of its own — it hands `previewBulk`/`applyBulk` a transform and
// inherits every promise they already make.
//
// FOUR DECISIONS, none of them forced, all of them the difference between a
// tool people use and a tool people are afraid of:
//
//  1. THE BODY ONLY. Frontmatter is out of reach. A blind regex over YAML is
//     precisely the failure this release's story mocks Obsidian's properties
//     editor for — quote styles eaten, block lists flattened, a `tags:` line
//     turned into something the indexer no longer reads — and the vault HAS a
//     byte-surgical frontmatter writer for exactly that work
//     (server/noteFrontmatter.ts). One tool per substrate.
//
//  2. MATCHING IS EXACT: case-sensitive, diacritic-sensitive, literal unless
//     the regex toggle is on. This is the one matcher in v1.8 that deliberately
//     does NOT fold (shared/fold.ts). Finding is a question and folding widens
//     it kindly; replacing is a WRITE, and a "replace المقدمة" that silently
//     stripped the harakat off «الْمُقَدِّمَة» would be destroying text the
//     reader never typed and never saw. Case is the same argument in Latin: a
//     case-insensitive replace writes the replacement's casing over both, which
//     is the single most-complained-about behaviour of every editor that does
//     it. Readers who want either reach for the regex toggle, where `[Mm]` and
//     a character class say so out loud.
//
//  3. THE SCOPE IS THE QUERY. The find field IS the sidebar's search box, so
//     the operators (shared/searchQuery.ts) narrow the replace exactly as they
//     narrow the search: `tag:recipes cumin` replaces cumin in the recipes and
//     nowhere else, and the reader has already SEEN which notes those are.
//
//  4. NOTHING IS WRITTEN THAT WAS NOT PREVIEWED — and here that promise needs
//     one thing the engine cannot give it, because a reader looks at a preview
//     for a while. Every previewed file carries the mtime it was read at, the
//     apply refuses any file whose mtime has moved since, and the reader is
//     told which ones those were. `applyBulk`'s own precondition then closes
//     the remaining millisecond.

import { promises as fs } from "node:fs";
import type { ReplaceLine, ReplacePreview, ReplacePreviewFile } from "../shared/types.ts";
import { VaultError, safeAbs } from "./vault.ts";
import type { BulkTransform } from "./bulkRewrite.ts";

/** Longest find/replace strings accepted. A needle longer than this is a
 *  paste accident, and a catastrophic regex is easier to write short. */
const PATTERN_MAX = 2_000;

/** Files whose matched LINES are listed. Every matching file is named and
 *  counted — nothing is hidden — but only the first few carry their rows, so a
 *  vault-wide replace over four hundred notes is still one small answer. Past
 *  this, a file is offered whole rather than line by line, and says so. */
const FILES_WITH_LINES = 40;

/** Rows per file. A file with more than this many matched lines is
 *  all-or-nothing for the same reason: twenty rows is a review, two hundred is
 *  a diff nobody reads before pressing a button. */
const LINES_PER_FILE = 20;

/** A hard ceiling on the answer. Past it the preview says so and the reader is
 *  asked to narrow — a replace across five thousand notes is a thing to do
 *  deliberately in three passes, not accidentally in one. */
const FILES_MAX = 2_000;

/** Longest line quoted back. Same reasoning as SEARCH_MATCH_LINE_MAX. */
const LINE_MAX = 400;

export interface ReplaceSpec {
  find: string;
  replace: string;
  regex: boolean;
}

/** What one file's share of the operation is allowed to touch. `null` lines
 *  means "every match in this file" — the state of a file-level checkbox that
 *  was never opened. */
export interface ReplaceTarget {
  path: string;
  /** The mtime the preview read. Refused if the file has moved since. */
  mtimeMs: number;
  /** FULL-FILE line numbers (1-based, frontmatter counted), or null for all. */
  lines: number[] | null;
}

function clean(spec: ReplaceSpec): ReplaceSpec {
  if (spec.find === "") throw new VaultError(400, "Nothing to find", "emptyFind");
  if (spec.find.length > PATTERN_MAX || spec.replace.length > PATTERN_MAX) {
    throw new VaultError(400, "That pattern is too long", "patternTooLong");
  }
  // A replacement carrying a newline turns one line into two, and every line
  // number in the preview the reader is looking at becomes wrong below it.
  // The tool is line-preserving by construction; say so rather than shipping a
  // preview that lies about where the rest of the edits landed.
  if (/[\r\n]/.test(spec.find) || /[\r\n]/.test(spec.replace)) {
    throw new VaultError(400, "Find and replace work within one line", "multilinePattern");
  }
  return spec;
}

/** The compiled matcher for one line. Regex mode is the reader's own pattern
 *  with `g` bolted on; literal mode is a split/join, which also makes `$` in
 *  the replacement mean a dollar sign rather than a capture reference — the
 *  behaviour a reader typing a price expects and does not think about. */
interface Needle {
  /** Occurrences on this line. */
  count: (line: string) => number;
  /** The line, rewritten. */
  apply: (line: string) => string;
}

function compile(spec: ReplaceSpec): Needle {
  if (!spec.regex) {
    const parts = spec.find;
    return {
      count: (line) => line.split(parts).length - 1,
      apply: (line) => line.split(parts).join(spec.replace),
    };
  }
  let re: RegExp;
  try {
    re = new RegExp(spec.find, "g");
  } catch {
    throw new VaultError(400, "That is not a valid pattern", "badRegex");
  }
  // A pattern that can match the empty string matches at EVERY position, so
  // `a*` → "x" would insert an x between every character in the vault. It is
  // always a mistake and never a subtle one; refusing it is kinder than
  // previewing it.
  if (new RegExp(spec.find).test("")) {
    throw new VaultError(400, "That pattern matches everywhere", "emptyMatch");
  }
  return {
    count: (line) => {
      re.lastIndex = 0;
      let n = 0;
      for (let m = re.exec(line); m !== null; m = re.exec(line)) {
        n += 1;
        if (m[0] === "") re.lastIndex += 1; // belt and braces; `emptyMatch` refused this
        if (n > 10_000) break;
      }
      return n;
    },
    apply: (line) => line.replace(re, spec.replace),
  };
}

/** "Is this note worth reading off the disk?" — asked against the INDEX's copy
 *  of the body, which is already in memory, so a vault-wide replace touches the
 *  filesystem only for the notes that can possibly change.
 *
 *  Line by line, not over the whole body at once: `^` and `$` in a reader's
 *  pattern mean the ends of a LINE here, because that is what they will mean
 *  when the rewrite runs, and a nomination test that read them as the ends of
 *  the document would quietly drop every anchored pattern. */
export function makeBodyTest(spec: ReplaceSpec): (body: string) => boolean {
  const needle = compile(clean(spec));
  return (body) => body.split("\n").some((line) => needle.count(line) > 0);
}

/** Where the frontmatter fence ends, in characters and in lines. Everything
 *  before it is untouchable (decision 1 above) and everything after it counts
 *  its lines from `startLine`, so a preview row's number is the number the
 *  editor's own goto machinery uses. */
function bodyStart(content: string): { at: number; startLine: number } {
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return { at: 0, startLine: 1 };
  const head = match[0];
  return { at: head.length, startLine: head.split("\n").length };
}

/** The one transform both the preview and the apply run — the engine's first
 *  promise, spelled as a single function neither side can substitute. */
export function replaceTransform(
  spec: ReplaceSpec,
  selection: ReadonlyMap<string, ReadonlySet<number> | null> | null,
): BulkTransform {
  const needle = compile(clean(spec));
  return (relPath, content) => {
    const wanted = selection === null ? null : selection.get(relPath);
    if (selection !== null && wanted === undefined) return null;
    const { at, startLine } = bodyStart(content);
    const lines = content.slice(at).split("\n");
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      if (wanted != null && !wanted.has(startLine + i)) continue;
      const n = needle.count(lines[i]);
      if (n === 0) continue;
      count += n;
      lines[i] = needle.apply(lines[i]);
    }
    return count === 0 ? null : { text: content.slice(0, at) + lines.join("\n"), count };
  };
}

/** One file's rows, read from disk. Returns null when the file holds no match
 *  after all — the index's `body` is what nominated it, and a note whose match
 *  lives inside its frontmatter is a note this tool does not touch. */
function fileRows(
  content: string,
  needle: Needle,
  withLines: boolean,
): { count: number; rows: ReplaceLine[]; truncated: boolean } | null {
  const { at, startLine } = bodyStart(content);
  const lines = content.slice(at).split("\n");
  const rows: ReplaceLine[] = [];
  let count = 0;
  let matched = 0;
  for (let i = 0; i < lines.length; i++) {
    const n = needle.count(lines[i]);
    if (n === 0) continue;
    count += n;
    matched += 1;
    if (!withLines || rows.length >= LINES_PER_FILE) continue;
    rows.push({
      line: startLine + i,
      count: n,
      before: lines[i].slice(0, LINE_MAX),
      after: needle.apply(lines[i]).slice(0, LINE_MAX),
    });
  }
  if (count === 0) return null;
  return { count, rows, truncated: !withLines || matched > rows.length };
}

/** The dry run. `paths` is the candidate set the index nominated (the query's
 *  operators already applied); every one of them is READ, because the index's
 *  copy of a body is a parse and the thing being rewritten is the file. */
export async function previewReplace(
  paths: readonly string[],
  spec: ReplaceSpec,
): Promise<ReplacePreview> {
  const needle = compile(clean(spec));
  const files: ReplacePreviewFile[] = [];
  let edits = 0;
  let truncated = false;
  for (const relPath of paths) {
    if (files.length >= FILES_MAX) {
      truncated = true;
      break;
    }
    // safeAbs OUTSIDE the catch, deliberately: a path that climbs out of the
    // vault must be a refusal, not a file that "went while we were asking".
    // Swallowing that distinction is how a traversal becomes a silent skip.
    const abs = safeAbs(relPath);
    let content: string;
    let mtimeMs: number;
    try {
      const [text, stat] = await Promise.all([fs.readFile(abs, "utf8"), fs.stat(abs)]);
      content = text;
      mtimeMs = stat.mtimeMs;
    } catch {
      continue; // gone while we were asking — previewBulk makes the same peace
    }
    const found = fileRows(content, needle, files.length < FILES_WITH_LINES);
    if (found === null) continue;
    edits += found.count;
    files.push({
      path: relPath,
      mtimeMs,
      count: found.count,
      lines: found.rows,
      truncated: found.truncated,
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, notes: files.length, edits, truncated };
}

/** Screen the targets against the disk BEFORE the engine reads them: a file
 *  whose mtime has moved since the preview is one the reader has not actually
 *  seen, and its line numbers may name different lines entirely.
 *
 *  Returns the paths that survived, plus the selection map the transform reads.
 *  The conflicts are reported to the reader in the same words a mid-apply
 *  precondition failure is — one vocabulary for "somebody else was here". */
export async function screenTargets(
  targets: readonly ReplaceTarget[],
): Promise<{
  paths: string[];
  selection: Map<string, Set<number> | null>;
  conflicts: string[];
}> {
  const paths: string[] = [];
  const selection = new Map<string, Set<number> | null>();
  const conflicts: string[] = [];
  for (const target of targets) {
    const abs = safeAbs(target.path); // see previewReplace: a refusal, not a skip
    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(abs)).mtimeMs;
    } catch {
      continue; // gone; nothing to conflict with and nothing to write
    }
    if (mtimeMs !== target.mtimeMs) {
      conflicts.push(target.path);
      continue;
    }
    paths.push(target.path);
    selection.set(target.path, target.lines === null ? null : new Set(target.lines));
  }
  return { paths, selection, conflicts };
}
