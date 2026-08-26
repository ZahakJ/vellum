// Renaming a tag, byte by byte.
//
// "Rename/merge a tag across the vault" is the sixth most-requested thing in
// Obsidian's forum (811 likes) and the reason is that a tag is the one piece of
// vocabulary a vault-keeper changes their mind about: `#todo` becomes `#task`,
// `#ml` and `#machine-learning` turn out to be one topic. Doing it by hand means
// find-and-replace over frontmatter YAML, which is exactly where find-and-replace
// eats quote styles, comments and block lists.
//
// So this module is a SURGEON, not a substitution. Everything here is pure
// string work over one note's text — no fs, no index, no settings — and it
// obeys three rules the naive replace does not:
//
//   * IT NEVER TOUCHES CODE. `server/indexer.ts`'s `parseTags` scans the whole
//     body, fences included, which is a known over-count (tests/tags.test.ts
//     pins `#define` inside a ```sh block as a "tag"). Over-counting a tag list
//     is a cosmetic bug; REWRITING a `#define` inside a shell fence is data
//     loss. Fenced blocks and inline code spans are skipped, so the preview's
//     number is smaller than the tag pill's count sometimes — and it is the
//     honest one, because it is what the writer will actually change.
//   * IT KEEPS THE AUTHOR'S SPELLING. `tags: ["#delta", 'epsilon']` comes back
//     with its quotes, its hash and its spacing intact; a block list stays a
//     block list; a `.tex` note's `%`-prefixed comment block stays commented.
//     Only the tag NAME inside each item changes.
//   * NESTED TAGS COME ALONG. `#zettel` renamed to `#slip` takes `#zettel/seed`
//     to `#slip/seed`, because a tag hierarchy is one name with slashes in it
//     and leaving the children behind under a parent that no longer exists is
//     the failure everybody hits on their second try.
//
// MERGING falls out for free: renaming onto a tag that already exists is the
// same rewrite, and the only extra work is not printing the target twice in one
// frontmatter list (`tags: [alpha, beta]`, alpha→beta, must not become
// `[beta, beta]`). Inline prose is left alone in that case on purpose — two
// `#beta`s in one sentence is the author's sentence, not a list.

import { closesFence, fenceOpener, type Fence } from "../shared/fences.ts";
import { isTexPath } from "../shared/noteFormat.ts";
import { tagKey } from "../shared/tagLabels.ts";
import { findTexFrontmatter } from "../shared/tex.ts";

/** The name rule, re-exported so a route validating a rename and a dialog
 *  validating the same keystroke are provably reading one function. */
export { isTagName } from "../shared/tagLabels.ts";

/** `tag`, or a descendant of it? The one predicate the whole module turns on. */
function underTag(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

/** The new name for a tag that is `from` or lives under it; null for anything
 *  else. */
function remap(candidate: string, from: string, to: string): string | null {
  if (!underTag(candidate, from)) return null;
  return candidate === from ? to : `${to}/${candidate.slice(from.length + 1)}`;
}

// ------------------------------------------------------------ inline #tags

/** Spans of `line` that are inline code — a rewrite must not enter them.
 *  Backtick runs pair up left to right, exactly as the renderer pairs them. */
function codeSpans(line: string): [number, number][] {
  const out: [number, number][] = [];
  const re = /`+/g;
  let open: { at: number; len: number } | null = null;
  for (let m = re.exec(line); m !== null; m = re.exec(line)) {
    if (open === null) open = { at: m.index, len: m[0].length };
    else if (m[0].length === open.len) {
      out.push([open.at, m.index + m[0].length]);
      open = null;
    }
  }
  return out;
}

/** `#tag` occurrences, with the leading boundary character the indexer's regex
 *  also consumes so the replacement can put it back. */
const INLINE_TAG_RE = /(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

/** Rewrite inline `#tags` in a note BODY. Fenced blocks and inline code are
 *  skipped; every other byte survives. */
function rewriteInline(body: string, from: string, to: string): { text: string; count: number } {
  let count = 0;
  let fence: Fence | null = null;
  const out: string[] = [];
  for (const raw of body.split("\n")) {
    // The fence scanner reads the line without its carriage return; the
    // REWRITE happens on the original bytes, so a CRLF note stays CRLF.
    const probe = raw.replace(/\r+$/, "");
    if (fence) {
      if (closesFence(probe, fence)) fence = null;
      out.push(raw);
      continue;
    }
    const opened = fenceOpener(probe);
    if (opened) {
      fence = opened;
      out.push(raw);
      continue;
    }
    const spans = codeSpans(raw);
    out.push(
      raw.replace(INLINE_TAG_RE, (whole, lead: string, tag: string, at: number) => {
        // The HASH's own offset, not the match's: the pattern consumes the
        // boundary character before it, and that character can legitimately sit
        // outside a code span whose contents start one byte later.
        const hashAt = at + lead.length;
        if (spans.some(([s, e]) => hashAt >= s && hashAt < e)) return whole;
        const next = remap(tag.toLowerCase(), from, to);
        if (next === null) return whole;
        count++;
        return `${lead}#${next}`;
      }),
    );
  }
  return { text: out.join("\n"), count };
}

// ------------------------------------------------- frontmatter `tags:` list

/** Where a note's frontmatter TEXT sits inside its own source. Both formats
 *  open on line 1, so the offset is measured off the opening fence rather than
 *  searched for — `indexOf` would find the body's first coincidental copy. */
function frontmatterSpan(relPath: string, src: string): { start: number; end: number } | null {
  if (isTexPath(relPath)) {
    // The same pair `server/noteFrontmatter.ts` uses: the block's TEXT from the
    // canonical parser, its offset measured off the opening fence.
    const block = findTexFrontmatter(src);
    const open = /^%-{3,}%?[ \t]*\r?\n/.exec(src);
    if (block === null || open === null) return null;
    return { start: open[0].length, end: open[0].length + block.raw.length };
  }
  const md = /^(---\r?\n)([\s\S]*?\r?\n)---(?:\r?\n|$)/.exec(src);
  return md === null ? null : { start: md[1].length, end: md[1].length + md[2].length };
}

/** One item of a `tags:` value: where its text sits and what tag it names. */
interface Item {
  start: number;
  end: number;
  /** The canonical tag, quotes and `#` stripped — what `parseTags` reads. */
  tag: string;
}

/** Split a flow/scalar tag value into items with absolute offsets. Commas
 *  only: a tag cannot contain one, so there is no nesting to track. */
function valueItems(text: string, base: number): Item[] {
  const out: Item[] = [];
  let at = 0;
  for (const part of text.split(",")) {
    const lead = part.length - part.trimStart().length;
    const trail = part.length - part.trimEnd().length;
    const body = part.slice(lead, part.length - trail);
    if (body !== "") {
      out.push({
        start: base + at + lead,
        end: base + at + part.length - trail,
        tag: tagKey(body.replace(/^["'#]+|["']+$/g, "")),
      });
    }
    at += part.length + 1;
  }
  return out;
}

/** Reprint one item under a new tag name, keeping the quotes and the `#` the
 *  author wrote. `"#delta"` renamed to `epsilon` comes back as `"#epsilon"`. */
function reprint(original: string, next: string): string {
  const q = /^(["'])([\s\S]*)\1$/.exec(original);
  const inner = q ? q[2] : original;
  const hash = inner.startsWith("#") ? "#" : "";
  const body = `${hash}${next}`;
  return q ? `${q[1]}${body}${q[1]}` : body;
}

/** An edit to splice into the source, highest offset first. */
interface Splice {
  start: number;
  end: number;
  text: string;
}

/** Rewrite the frontmatter `tags:` list. Handles all four spellings a real
 *  vault carries (scalar, comma scalar, `[flow, list]`, block list) in either
 *  note format, and drops an item that the rename turned into a duplicate of
 *  one already in the list — which is what a MERGE does to a note that carried
 *  both tags. */
function rewriteFrontmatter(
  relPath: string,
  src: string,
  from: string,
  to: string,
): { text: string; count: number } {
  const span = frontmatterSpan(relPath, src);
  if (span === null) return { text: src, count: 0 };
  const region = src.slice(span.start, span.end);

  // The key line, at the top level of the block, tolerant of the `%` a `.tex`
  // comment block prefixes every line with. Indentation is NOT allowed: an
  // indented `tags:` belongs to some other key's mapping, and rewriting it
  // would edit a value this feature has no opinion about.
  const lines = region.split("\n");
  let keyAt = -1;
  let keyOffset = 0;
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^(?:%[ \t]?)?tags:/.test(lines[i])) {
      keyAt = i;
      keyOffset = offset;
      break;
    }
    offset += lines[i].length + 1;
  }
  if (keyAt === -1) return { text: src, count: 0 };

  const keyLine = lines[keyAt];
  const valueStart = keyLine.indexOf("tags:") + "tags:".length;
  const rawValue = keyLine.slice(valueStart).replace(/\r+$/, "");
  const inline = rawValue.trim();

  const items: Item[] = [];
  const lineSpans = new Map<number, { start: number; end: number }>(); // item index → whole-line span, block form only

  if (inline.startsWith("[")) {
    // `[a, b]` — the brackets stay where they are; only their contents move.
    const open = keyLine.indexOf("[", valueStart);
    const close = keyLine.lastIndexOf("]");
    if (close <= open) return { text: src, count: 0 };
    items.push(...valueItems(keyLine.slice(open + 1, close), span.start + keyOffset + open + 1));
  } else if (inline !== "") {
    const lead = rawValue.length - rawValue.trimStart().length;
    items.push(...valueItems(rawValue.trimEnd().slice(lead), span.start + keyOffset + valueStart + lead));
  } else {
    // Block list: `- item` lines under the key, ending at the first line that
    // is not one — exactly where `parseTags` stops reading.
    let at = keyOffset + keyLine.length + 1;
    for (let i = keyAt + 1; i < lines.length; i++) {
      const line = lines[i].replace(/\r+$/, "");
      const item = /^([ \t]*(?:%[ \t]?)?)-[ \t]+(.+)$/.exec(line);
      if (!item) {
        if (line.trim() !== "" && line.trim() !== "%") break;
        at += lines[i].length + 1;
        continue;
      }
      const valueAt = at + item[1].length + line.slice(item[1].length).indexOf(item[2]);
      const text = item[2].trimEnd();
      // Whole-line span, clamped: a `.tex` block's LAST line carries no
      // newline of its own inside the region, and reaching past it would eat
      // the closing `%---%` fence.
      lineSpans.set(items.length, {
        start: span.start + at,
        end: Math.min(span.start + at + lines[i].length + 1, span.end),
      });
      items.push({
        start: span.start + valueAt,
        end: span.start + valueAt + text.length,
        tag: tagKey(text.replace(/^["'#]+|["']+$/g, "")),
      });
      at += lines[i].length + 1;
    }
  }

  // Two passes: decide, then splice from the back so no offset moves under us.
  const seen = new Set<string>();
  const splices: Splice[] = [];
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const next = remap(item.tag, from, to);
    const value = next ?? item.tag;
    if (next !== null) count++;
    if (!seen.has(value)) {
      seen.add(value);
      if (next !== null) {
        splices.push({ start: item.start, end: item.end, text: reprint(src.slice(item.start, item.end), next) });
      }
      continue;
    }
    // A duplicate the MERGE made. Remove the item rather than print the target
    // twice — the whole line in block form, the item plus one separator in
    // flow form.
    const whole = lineSpans.get(i);
    if (whole) {
      splices.push({ start: whole.start, end: whole.end, text: "" });
      continue;
    }
    const after = /^[ \t]*,[ \t]*/.exec(src.slice(item.end));
    if (after) {
      splices.push({ start: item.start, end: item.end + after[0].length, text: "" });
      continue;
    }
    const beforeText = src.slice(0, item.start);
    const before = /,[ \t]*$/.exec(beforeText);
    splices.push({
      start: before ? item.start - before[0].length : item.start,
      end: item.end,
      text: "",
    });
  }

  if (splices.length === 0) return { text: src, count: 0 };
  let out = src;
  for (const s of splices.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, s.start) + s.text + out.slice(s.end);
  }
  return { text: out, count };
}

// ------------------------------------------------------------------ the op

/** Rename `from` (and everything under it) to `to` in ONE note's source:
 *  inline `#tags` in the body, `tags:` in the frontmatter, both byte-surgical.
 *  Returns null when the note carries neither — the caller then leaves the file
 *  completely alone, which is what makes "N notes" mean N files opened. */
export function rewriteTag(
  relPath: string,
  src: string,
  fromTag: string,
  toTag: string,
): { text: string; count: number } | null {
  const from = tagKey(fromTag);
  const to = tagKey(toTag);
  if (from === "" || to === "" || from === to) return null;

  const fm = rewriteFrontmatter(relPath, src, from, to);
  let text = fm.text;
  let count = fm.count;

  // Inline tags exist in markdown only: `#` is a macro-parameter character in
  // LaTeX, so `#tag` in a `.tex` file is a compile error rather than a tag —
  // the indexer says the same thing one function over (`tagSource: ""`).
  if (!isTexPath(relPath)) {
    const span = frontmatterSpan(relPath, text);
    const head = span === null ? "" : text.slice(0, span.end);
    const body = span === null ? text : text.slice(span.end);
    const inline = rewriteInline(body, from, to);
    text = head + inline.text;
    count += inline.count;
  }

  return count === 0 || text === src ? null : { text, count };
}
