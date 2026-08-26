// The properties editor's write path — byte-surgical frontmatter values.
//
// WHY A SECOND ENGINE BESIDE `setFrontmatterLine()`. That one replaces exactly
// ONE line and knows nothing about what a value IS, which is precisely right
// for `publish:` and `banner:` — two keys this product owns, whose values it
// writes and nobody else edits. It is precisely WRONG for a properties card,
// where the reader edits keys somebody else's tool wrote, a value can be a LIST
// spread over five lines, and the release's whole claim is that Vellum's
// frontmatter writer does not corrupt YAML round-trips the way Obsidian's does.
// Merging a block list onto its key line would orphan the `- item` lines under
// a key that now holds a value — not a note with an odd list, a note whose YAML
// no longer PARSES, and the first casualty of that is `publish: true`, i.e. the
// note silently leaves the public site. That failure is the reason this file
// exists (v1.8 spec K, Obsidian parity #1).
//
// THE DANGER RAIL, in the order it is enforced below:
//
//  1. Only the lines belonging to the edited key are ever rewritten. Every
//     other byte of the block — comments, blank lines, indentation, key order,
//     CRLF, unknown keys, malformed YAML three lines down — is spliced through
//     untouched. The edit is textual; nothing here re-serializes a parse.
//  2. QUOTE STYLE IS PRESERVED. A value that was plain stays plain, one in
//     single quotes stays in single quotes, one in double quotes stays in
//     double — unless the new text cannot be spelled that way, in which case it
//     is double-quoted, because a value the reader can no longer read back is a
//     worse outcome than a changed quote character.
//  3. A TRAILING `# comment` ON THE KEY LINE SURVIVES the value under it
//     changing. It is the reader's sentence about their own property.
//  4. LIST ITEMS THE EDIT DID NOT TOUCH KEEP THEIR OWN BYTES. Adding one chip
//     to a five-item block list appends one line; removing one deletes one. The
//     other four are the same bytes they were, quotes and trailing comments and
//     all — the card sends the whole array, the writer diffs it.
//  5. Removing the last key removes the FENCE PAIR, so the note does not keep
//     the `---\n---` stub Obsidian leaves behind (which renders as a divider).
//     Unless comments remain in the block: those are the reader's words and a
//     property editor does not get to delete them.

import { isTexPath } from "../shared/noteFormat.ts";
import type { PropertyValue } from "../shared/types.ts";
import { findTexFrontmatter } from "../shared/tex.ts";
import { splitYamlComment } from "../shared/yaml.ts";
import { yamlQuote } from "./publish.ts";

/** A `.tex` note keeps its frontmatter in a `%---` COMMENT block, and the
 *  fences are written the way server/noteFrontmatter.ts writes them. */
const TEX_OPEN = "%---";
const TEX_CLOSE = "%---%";

/** How a scalar is spelled in the file. Preserved across an edit (rail 2). */
type Style = "plain" | "single" | "double";

/** The frontmatter block of a note, located in its own source. */
interface Block {
  /** Offset in `src` where the block's TEXT begins (past the opening fence). */
  start: number;
  /** Every line of the block's text, each KEEPING its own terminator — so a
   *  line that is spliced through is compared and re-emitted byte for byte. */
  lines: string[];
  /** Offset in `src` just past the CLOSING fence and its newline. */
  end: number;
  /** A `.tex` comment block: every line carries a `%` the YAML does not. */
  tex: boolean;
  /** The newline this block is written with (new lines copy it). */
  nl: string;
}

/** Split a run of text into lines that KEEP their terminators. */
function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/** Locate a note's frontmatter block, in either format.
 *
 *  The markdown arm deliberately recognises the EMPTY block (`---\n---\n`),
 *  which `setFrontmatterLine()` does not: that stub is exactly what a
 *  properties card produces when the reader deletes the last property with
 *  another tool, and prepending a second block to it — the documented bug in
 *  tests/frontmatter.test.ts — would leave a stray `---` rule in the prose. */
function blockOf(relPath: string, src: string): Block | null {
  if (isTexPath(relPath)) {
    const fm = findTexFrontmatter(src);
    const open = /^%-{3,}%?[ \t]*\r?\n/.exec(src);
    if (fm === null || open === null) return null;
    const nl = open[0].endsWith("\r\n") ? "\r\n" : "\n";
    return {
      start: open[0].length,
      lines: fm.raw === "" ? [] : linesOf(fm.raw + nl),
      end: fm.end,
      tex: true,
      nl,
    };
  }
  const md = /^(---\r?\n)([\s\S]*?\r?\n|)(---[ \t]*(?:\r?\n|$))/.exec(src);
  if (md === null) return null;
  const nl = md[1].endsWith("\r\n") ? "\r\n" : "\n";
  return { start: md[1].length, lines: linesOf(md[2]), end: md[0].length, tex: false, nl };
}

/** The comment marker a `.tex` block's lines wear, and the YAML underneath it.
 *
 *  A markdown line has NO lead: its indentation stays in the content half on
 *  purpose, because indentation is how `spanOf()` below tells a top-level key
 *  from somebody else's nested mapping. A `.tex` line spells that same
 *  indentation after the `%`, which is what `findTexFrontmatter()` strips. */
function splitLead(line: string, tex: boolean): [string, string] {
  if (!tex) return ["", line];
  const m = /^[ \t]*%[ \t]?/.exec(line);
  const lead = m === null ? "" : m[0];
  return [lead, line.slice(lead.length)];
}

/** A line with its terminator taken off — what the matchers below read. */
function bare(line: string): string {
  return line.replace(/\r?\n$/, "");
}

// ────────────────────────────────────────────── scalars: reading the style

function styleOf(value: string): Style {
  if (value.startsWith('"')) return "double";
  if (value.startsWith("'")) return "single";
  return "plain";
}

/** The text a spelled scalar carries. Deliberately forgiving: this is used to
 *  MATCH surviving list items against what the card sent back, and an item the
 *  matcher misses is only ever re-spelled, never lost. */
function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  return value;
}

/** Values YAML reads as something other than a string when they are written
 *  plain. A plain-styled edit that would CHANGE the type gets quoted instead —
 *  the reader typed characters, not a boolean. */
function looksTyped(text: string): boolean {
  return (
    /^(true|false|yes|no|on|off|null|~)$/i.test(text) ||
    /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text) ||
    /^0[xob][0-9a-f_]+$/i.test(text) ||
    /^\d{4}-\d{1,2}-\d{1,2}([Tt ].*)?$/.test(text)
  );
}

/** Can this text be written with no quotes at all and read back unchanged?
 *  `flow` tightens it for an item inside `[ … ]`, where a comma or a bracket
 *  would end the item. */
function isPlainSafe(text: string, flow: boolean): boolean {
  if (text === "" || text !== text.trim()) return false;
  if (/[\u0000-\u001f\u007f]/.test(text)) return false;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) return false;
  if (/:(\s|$)/.test(text) || /\s#/.test(text)) return false;
  if (flow && /[,[\]{}]/.test(text)) return false;
  return true;
}

/** Spell `text` the way the file already spelled this value (rail 2), falling
 *  back to a double-quoted scalar whenever that spelling cannot carry it.
 *  `wasTyped` says the value being replaced was ITSELF a plain YAML literal
 *  (`weight: 3`), which is what keeps a re-typed number from acquiring quotes
 *  it never had. */
function renderScalar(text: string, style: Style, wasTyped: boolean, flow = false): string {
  if (style === "plain" && isPlainSafe(text, flow) && (!looksTyped(text) || wasTyped)) {
    return text;
  }
  if (style === "single" && !/[\u0000-\u001f\u007f]/.test(text)) {
    return `'${text.replace(/'/g, "''")}'`;
  }
  return yamlQuote(text);
}

/** Split a key line's value from a trailing `# comment` (rail 3). The scan is
 *  `shared/yaml.ts`, because the tag index and the properties card have to
 *  reach the same verdict about the same bytes — and until v1.8 they did not. */
const splitComment = splitYamlComment;

/** Split the inside of a `[ … ]` flow list on its TOP-LEVEL commas. */
function splitFlow(inner: string): string[] {
  const out: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  let at = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote !== null) {
      if (ch === "\\" && quote === '"') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      out.push(inner.slice(at, i));
      at = i + 1;
    }
  }
  out.push(inner.slice(at));
  return out.map((s) => s.trim()).filter((s) => s !== "");
}

// ───────────────────────────────────────────────── locating one key's lines

interface Span {
  /** Index of the key line in `block.lines`. */
  at: number;
  /** Index just past the last line belonging to this key. */
  end: number;
}

/** Every line the key owns: its own, plus the block-list items and nested
 *  lines under it. Blank and comment lines between items are carried along
 *  only when a real continuation follows them — a comment AFTER the list
 *  belongs to whatever the reader wrote it about, not to this key.
 *
 *  TOP LEVEL ONLY, for the reason `setFrontmatterLine()` anchors at `^key:`:
 *  `meta:\n  publish: false` must never be what a write to `publish` finds. */
function spanOf(block: Block, key: string): Span | null {
  const prefix = `${key}:`;
  for (let i = 0; i < block.lines.length; i++) {
    const [, content] = splitLead(bare(block.lines[i]), block.tex);
    if (!content.startsWith(prefix)) continue;
    // `title:` must not match a write to `title` when the file says `titles:`;
    // startsWith on `key + ":"` already guarantees that. Indentation must be
    // zero — a nested key is somebody else's mapping.
    let end = i + 1;
    // A KEY THAT ALREADY CARRIES A VALUE OWNS ONE LINE AND NO MORE. Scanning
    // continuations from a line that says `title: A note` is how a write to
    // `title` came to swallow the comment and the stray indented line beneath
    // it and hand back a note two lines shorter. Only an EMPTY key line can
    // own what follows — a block list, a nested mapping — plus the two block
    // scalar indicators, whose text genuinely lives on the lines below.
    const inline = splitComment(content.slice(prefix.length).trim())[0];
    if (inline !== "" && !/^[|>][-+]?\d*$/.test(inline)) return { at: i, end };
    for (let j = i + 1; j < block.lines.length; j++) {
      const [, next] = splitLead(bare(block.lines[j]), block.tex);
      if (next.trim() === "" || /^[ \t]*#/.test(next)) continue; // maybe interior
      if (/^[ \t]*-[ \t]/.test(next) || /^[ \t]+\S/.test(next)) {
        end = j + 1;
        continue;
      }
      break; // a top-level line: the next key, or the end of this one
    }
    return { at: i, end };
  }
  return null;
}

/** What the file currently says about one key — the shape the new value has to
 *  be spelled INTO. */
interface Current {
  /** Whitespace between `key:` and the value (`key:  x` keeps its two). */
  sep: string;
  /** Trailing `# comment` on the key line, including its leading space. */
  comment: string;
  /** The scalar/flow text after the key, comment removed. */
  inline: string;
  /** Style of the scalar (or the seed style for list items). */
  style: Style;
  /** True when the existing value is a plain YAML literal (rail 2). */
  typed: boolean;
  /** Existing list items, each with the exact bytes that spelled it. */
  items: { text: string; raw: string; line: number | null }[];
  /** The list is written as `- item` lines, not `[ … ]`. */
  blockList: boolean;
  /** The full line prefix a block item wears (`% ` + indent + nothing else). */
  itemLead: string;
}

function readCurrent(block: Block, key: string, span: Span): Current {
  const [, content] = splitLead(bare(block.lines[span.at]), block.tex);
  const after = content.slice(key.length + 1);
  const sepMatch = /^[ \t]*/.exec(after);
  const sep = sepMatch === null ? " " : sepMatch[0];
  const [value, comment] = splitComment(after.slice(sep.length));
  const cur: Current = {
    sep: sep === "" ? " " : sep,
    comment,
    inline: value,
    style: styleOf(value),
    typed: looksTyped(value),
    items: [],
    blockList: false,
    itemLead: block.tex ? "% - " : "- ",
  };

  if (value.startsWith("[") && value.endsWith("]")) {
    const raws = splitFlow(value.slice(1, -1));
    cur.items = raws.map((raw) => ({ text: unquote(raw), raw, line: null }));
    cur.style = raws.length > 0 ? styleOf(raws[0]) : "plain";
    return cur;
  }
  if (value === "") {
    for (let j = span.at + 1; j < span.end; j++) {
      const [lead, next] = splitLead(bare(block.lines[j]), block.tex);
      const item = /^([ \t]*-[ \t]+)(.*)$/.exec(next);
      if (item === null) continue;
      if (cur.items.length === 0) cur.itemLead = lead + item[1];
      const [raw] = splitComment(item[2].trim());
      cur.items.push({ text: unquote(raw), raw, line: j });
    }
    if (cur.items.length > 0) {
      cur.blockList = true;
      cur.style = styleOf(cur.items[0].raw);
    }
  }
  return cur;
}

// ────────────────────────────────────────────────────────────── the writer

/** A key the writer refuses, because the shape would corrupt the block itself
 *  rather than just the value. `.tex` blocks are the sharp case: their fence
 *  detector (`looksLikeYaml`, shared/tex.ts) only recognises ASCII keys, so an
 *  Arabic key written into a comment block would make the WHOLE block stop
 *  being frontmatter — the note would lose every property it has. */
export function frontmatterKeyRefusal(relPath: string, key: string): string | null {
  if (!/^[\p{L}\p{N}_][\p{L}\p{N}_.-]{0,63}$/u.test(key)) {
    return `Frontmatter key not writable: ${key}`;
  }
  if (isTexPath(relPath) && !/^[A-Za-z_][\w.-]*$/.test(key)) {
    return `A LaTeX note's frontmatter keys must be ASCII: ${key}`;
  }
  return null;
}

/**
 * Set (or remove, with `value === null`) one frontmatter property, preserving
 * every byte the edit does not have to touch. The contract is the header of
 * this file; the tests are tests/frontmatter.test.ts.
 */
export function setNoteProperty(
  relPath: string,
  src: string,
  key: string,
  value: PropertyValue | null,
): string {
  const refusal = frontmatterKeyRefusal(relPath, key);
  if (refusal !== null) throw new Error(refusal);

  const block = blockOf(relPath, src);
  if (block === null) {
    if (value === null) return src; // no block, nothing to remove
    return openBlock(relPath, src, key, value);
  }

  const span = spanOf(block, key);
  const lines = block.lines.slice();
  if (span === null) {
    if (value === null) return src;
    const lead = block.tex ? "% " : "";
    lines.push(...emit(block, key, value, freshCurrent(block), lead));
  } else {
    const cur = readCurrent(block, key, span);
    const lead = splitLead(bare(block.lines[span.at]), block.tex)[0];
    const replacement = value === null ? [] : emit(block, key, value, cur, lead);
    lines.splice(span.at, span.end - span.at, ...replacement);
  }

  // Rail 5: a block with nothing left in it goes away with its fences — but
  // only if nothing but whitespace remains. A surviving `# comment` is the
  // reader's own words, and a property editor does not delete prose.
  const remains = lines.some((l) => splitLead(bare(l), block.tex)[1].trim() !== "");
  if (!remains && !lines.some((l) => /#/.test(l))) {
    // …and the blank line the fence was WEARING goes with it. Every note a
    // human writes spells the preamble `---\n…\n---\n\n# Title`, so taking
    // only the fences left the file starting with an empty line — a diff for
    // nobody, and the next `---` this writer opens would sit above it. One
    // line terminator, exactly the one that separated the fence from the
    // prose; a second blank line is the author's own paragraph break.
    return src.slice(block.end).replace(/^\r\n|^\n/, "");
  }

  return src.slice(0, block.start) + lines.join("") + src.slice(block.start + block.lines.join("").length);
}

/** The style a key that is not in the file yet is written with. */
function freshCurrent(block: Block): Current {
  return {
    sep: " ",
    comment: "",
    inline: "",
    style: "plain",
    typed: false,
    items: [],
    blockList: false,
    itemLead: block.tex ? "% - " : "- ",
  };
}

/** One property → the lines that spell it, terminators included. */
function emit(
  block: Block,
  key: string,
  value: PropertyValue,
  cur: Current,
  lead: string,
): string[] {
  const nl = block.nl;
  const head = (text: string): string => `${lead}${key}:${text}${cur.comment}${nl}`;

  if (value.kind === "bool") return [head(`${cur.sep}${value.bool ? "true" : "false"}`)];
  if (value.kind === "date") return [head(`${cur.sep}${value.date}`)];
  if (value.kind === "text") {
    return [head(`${cur.sep}${renderScalar(value.text, cur.style, cur.typed)}`)];
  }

  // A list. Rail 4: an item whose text still appears in the array keeps the
  // exact bytes that spelled it — quotes, spacing, its own trailing comment
  // when it lives on its own line. Only genuinely NEW items are spelled fresh.
  const pool = cur.items.map((it) => ({ ...it, used: false }));
  const take = (text: string): (typeof pool)[number] | null => {
    const hit = pool.find((it) => !it.used && it.text === text);
    if (hit === undefined) return null;
    hit.used = true;
    return hit;
  };

  if (value.items.length === 0) {
    // An emptied list stays a list. Removing the key is a different verb (the
    // row's ×), and a card that made the row VANISH when its last chip came
    // off would leave the reader no way to put one back.
    return [head(`${cur.sep}[]`)];
  }

  if (cur.blockList) {
    const out = [head("")];
    for (const text of value.items) {
      const kept = take(text);
      if (kept !== null && kept.line !== null) {
        out.push(block.lines[kept.line].endsWith(nl) ? block.lines[kept.line] : block.lines[kept.line] + nl);
        continue;
      }
      const raw = kept?.raw ?? renderScalar(text, cur.style, false);
      out.push(`${cur.itemLead}${raw}${nl}`);
    }
    return out;
  }

  const spelled = value.items.map((text) => take(text)?.raw ?? renderScalar(text, cur.style, false, true));
  return [head(`${cur.sep}[${spelled.join(", ")}]`)];
}

/** A note with no frontmatter at all gets a minimal block, in its own format.
 *  A leading comment block is legal above `\documentclass`, so a `.tex` file
 *  still compiles unchanged — the rule server/noteFrontmatter.ts states. */
function openBlock(relPath: string, src: string, key: string, value: PropertyValue): string {
  const block: Block = { start: 0, lines: [], end: 0, tex: isTexPath(relPath), nl: "\n" };
  const lead = block.tex ? "% " : "";
  const body = emit(block, key, value, freshCurrent(block), lead).join("");
  if (block.tex) return `${TEX_OPEN}\n${body}${TEX_CLOSE}\n${src}`;
  return `---\n${body}---\n${src}`;
}
