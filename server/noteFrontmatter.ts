// Frontmatter, one operation per format.
//
// A `.md` note keeps its YAML `---` block (server/publish.ts, untouched). A
// `.tex` note keeps a `%--- … %---%` COMMENT block, so the same file still
// compiles: `pdflatex` sees two comment lines, Vellum sees `publish: true`.
// Every route that toggles publish or writes a `banner:` goes through here, so
// neither of them has to know which kind of note it is holding.

import matter from "gray-matter";
import { isTexPath } from "../shared/noteFormat.ts";
import { findTexFrontmatter } from "../shared/tex.ts";
import { publishFlag, readFrontmatter, setFrontmatterLine, setPublishFlag, yamlQuote } from "./publish.ts";

/** The comment fences a `.tex` frontmatter block is WRITTEN with (reading
 *  tolerates the variants; writing picks one and sticks to it). */
const TEX_OPEN = "%---";
const TEX_CLOSE = "%---%";

/** Frontmatter data for a note of either format. */
export function readNoteFrontmatter(relPath: string, src: string): Record<string, unknown> {
  if (!isTexPath(relPath)) return readFrontmatter(src);
  const block = findTexFrontmatter(src);
  if (!block) return {};
  try {
    return (matter(`---\n${block.yaml}\n---\n`).data as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export function noteIsPublished(relPath: string, src: string): boolean {
  return publishFlag(readNoteFrontmatter(relPath, src));
}

/** Set (or remove, with `line === null`) one `key:` line, preserving every
 *  other byte of the file — the same surgical contract publish.ts states for
 *  markdown, extended to the comment block. */
export function setNoteFrontmatterLine(
  relPath: string,
  src: string,
  key: string,
  line: string | null,
): string {
  if (!isTexPath(relPath)) return setFrontmatterLine(src, key, line);
  return setTexFrontmatterLine(src, key, line);
}

export function setNotePublishFlag(relPath: string, src: string, publish: boolean): string {
  if (!isTexPath(relPath)) return setPublishFlag(src, publish);
  return setTexFrontmatterLine(src, "publish", `publish: ${publish}`);
}

function setTexFrontmatterLine(src: string, key: string, line: string | null): string {
  const block = findTexFrontmatter(src);
  const keyLine = new RegExp(`^([ \\t]*%[ \\t]?)?${key}:.*$`, "m");

  if (block) {
    const rawLines = block.raw.split("\n");
    const idx = rawLines.findIndex((l) => keyLine.test(l));
    if (idx >= 0) {
      if (line === null) rawLines.splice(idx, 1);
      else rawLines[idx] = `% ${line}`;
    } else {
      if (line === null) return src; // nothing to remove
      rawLines.push(`% ${line}`);
    }
    // A block emptied of every key would leave two bare fences behind; drop it.
    const body = rawLines.filter((l) => l.trim() !== "" && l.trim() !== "%");
    const rebuilt =
      body.length === 0 ? "" : `${TEX_OPEN}\n${body.join("\n")}\n${TEX_CLOSE}\n`;
    return rebuilt + src.slice(block.end);
  }

  if (line === null) return src;
  // No block yet: prepend one. A leading comment block is legal above
  // \documentclass, so the file still compiles unchanged.
  return `${TEX_OPEN}\n% ${line}\n${TEX_CLOSE}\n${src}`;
}

// ---------------------------------------------------------------- aliases

/** The other names a note answers to — frontmatter `aliases:`.
 *
 *  The README invites the reader to point Vellum at an existing Obsidian
 *  vault, and in one of those a note is routinely linked by a name that is not
 *  its filename. Three spellings reach this function from real vaults, because
 *  YAML gives three different values for what an author reads as one list:
 *
 *    aliases: [ML, machine-learning]   → an array
 *    aliases:                          → an array (block list)
 *      - ML
 *    aliases: ML, machine-learning     → the STRING "ML, machine-learning"
 *    aliases: ML                       → the STRING "ML"
 *
 *  A scalar is split on commas; a LIST ITEM never is. That asymmetry is the
 *  whole rule: `aliases: [Smith, John]` is already two items to YAML, so an
 *  author who means one alias containing a comma writes `["Smith, John"]` —
 *  splitting items too would turn every quoted bibliographic alias into two
 *  wrong ones, and there would be no way left to spell the right one.
 *
 *  `alias:` (singular) is read as well: Obsidian accepted it for years and
 *  vaults still carry it, and a note whose only alias is silently ignored is
 *  exactly the first-hour disappointment this feature exists to remove.
 *
 *  Duplicates collapse case-insensitively, first spelling kept — the table
 *  this feeds is keyed lowercased, so the second one could only ever be a
 *  second Set entry for the same note. */
export function parseAliases(fm: Record<string, unknown>): string[] {
  const raw = fm.aliases ?? fm.alias;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: string): void => {
    const alias = value.trim();
    if (!alias || seen.has(alias.toLowerCase())) return;
    seen.add(alias.toLowerCase());
    out.push(alias);
  };
  // A bare number is a legitimate alias ("2024" on a year note) and YAML hands
  // it over as a number, not a string; anything else — a nested map, a date, a
  // boolean — is not a name and is dropped rather than stringified into one.
  const scalar = (value: unknown): string | null => {
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return null;
  };
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const text = scalar(item);
      if (text !== null) push(text);
    }
    return out;
  }
  const text = scalar(raw);
  if (text === null) return out;
  for (const part of text.split(",")) push(part);
  return out;
}

/** A frontmatter `aliases:` line whose value is EMPTY, followed by at least one
 *  `- item` — the block form, in either note format (a `.tex` block prefixes
 *  its lines with `%`). Group 1 is the item's own prefix + indentation, which
 *  is the only shape we can safely copy when adding one more. */
/** Find the block-form alias list inside frontmatter TEXT: the offset just
 *  after the `aliases:` key line, and the exact `indent + "- "` prefix its
 *  first item uses (a `.tex` note's items carry a `%` in that prefix).
 *
 *  A LINE SCAN, and the regex it replaces is the reason. That regex demanded
 *  the first `- item` on the very next line after the key, so YAML that is
 *  perfectly valid — a trailing `# comment` on the key line, a blank line or a
 *  comment between the key and its items — made it miss. The fallback then
 *  rewrote the key line into flow form while the item lines stayed behind,
 *  orphaned under a key that now holds a value: not a note with an odd alias
 *  list, a note whose YAML no longer parses — and the first casualty of
 *  frontmatter that stops parsing is `publish: true`, i.e. the note silently
 *  leaves the public site. The scan reads lines the way YAML does, so the only
 *  way to miss a block list is for there not to be one. */
function findAliasBlock(text: string): { insertAt: number; itemPrefix: string } | null {
  const lines = text.split("\n");
  let at = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = at;
    at += line.length + 1;
    // The key line, comment-tolerant: `aliases:`, `aliases:  # names`, and the
    // `%`-prefixed spelling a .tex comment block carries.
    if (!/^[ \t]*(?:%[ \t]*)?aliases:[ \t]*(?:#.*)?\r?$/.test(line)) continue;
    // Walk forward past blank and comment-only lines to the first real line.
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j];
      if (/^[ \t]*(?:%[ \t]*)?\r?$/.test(next)) continue; // blank
      if (/^[ \t]*(?:%[ \t]*)?#/.test(next)) continue; // comment
      const item = /^([ \t]*(?:%[ \t]*)?)-[ \t]+\S/.exec(next);
      // A real line that is not an item means the key holds no block list
      // (empty key, or the next mapping key) — the flow path handles it.
      if (item === null) return null;
      return { insertAt: lineStart + line.length + 1, itemPrefix: item[1] };
    }
    return null;
  }
  return null;
}

/** Add one alias to a note, preserving every other byte — the write half of
 *  "keep the old title as an alias" after a rename.
 *
 *  Two shapes, because the surgical line editor above can only ever replace ONE
 *  line and a block list is several. Merging a block list into one flow line
 *  would leave its `- item` lines orphaned under a key that now holds a value:
 *  that is not a note with an odd alias list, it is a note whose YAML no longer
 *  parses — and the first thing lost when frontmatter stops parsing is
 *  `publish: true`, i.e. the note silently leaves the public site. So:
 *
 *   - block form → one more item line, wearing the indentation (and, in a
 *     `.tex` note, the `%` comment prefix) of the item already there;
 *   - absent or inline → one `aliases: [...]` line, the new name first.
 *
 *  Idempotent: an alias the note already answers to returns the source
 *  unchanged, so the offer can be taken twice without growing the list. */
export function addNoteAlias(relPath: string, src: string, alias: string): string {
  const name = alias.trim();
  if (!name) return src;
  const existing = parseAliases(readNoteFrontmatter(relPath, src));
  if (existing.some((a) => a.toLowerCase() === name.toLowerCase())) return src;

  // Only the frontmatter block is searched for the block form: a BODY that
  // happens to quote an `aliases:` list (this file's own prose does) must
  // never be edited by a frontmatter write.
  const region = frontmatterRegion(relPath, src);
  const block = region === null ? null : findAliasBlock(region.text);
  if (region !== null && block !== null) {
    const at = region.start + block.insertAt;
    return `${src.slice(0, at)}${block.itemPrefix}- ${yamlQuote(name)}\n${src.slice(at)}`;
  }
  const list = [name, ...existing].map(yamlQuote).join(", ");
  return setNoteFrontmatterLine(relPath, src, "aliases", `aliases: [${list}]`);
}

/** Where a note's frontmatter TEXT sits inside its own source, for the one
 *  operation that has to look at more than a single key line. Null when the
 *  note has no frontmatter at all. */
function frontmatterRegion(relPath: string, src: string): { start: number; text: string } | null {
  // Both formats open on line 1, so the block's text starts exactly where the
  // opening fence ends — measured, not searched for: `indexOf(block.text)`
  // would answer with the body's first coincidental copy of it.
  if (isTexPath(relPath)) {
    const block = findTexFrontmatter(src);
    const open = /^%-{3,}%?[ \t]*\r?\n/.exec(src);
    return block === null || open === null ? null : { start: open[0].length, text: block.raw };
  }
  const md = /^(---\r?\n)([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(src);
  return md === null ? null : { start: md[1].length, text: md[2] };
}
