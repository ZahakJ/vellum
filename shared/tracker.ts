// THE TRACKER — a ```tracker fence, parsed. Pure, and pure on purpose.
//
// A tracker turns a note into a living progress card: a book you are 62 pages
// into, a game at 40 hours, a course at lesson 9. The fence is the whole
// syntax, and this module is the whole model — no CodeMirror, no DOM, no CSS,
// no React. That split is the same one `tableModel.ts` has from `tables.ts`
// and `calloutDefs.ts` has from `callouts.ts`, and it exists for two reasons
// this feature needs badly:
//
//   · `node --test` must load it (tests/tracker.test.ts). An import chain that
//     drags a stylesheet in is unparseable to node, so the logic would go
//     untested exactly where it is subtlest — the progress arithmetic.
//   · `server/indexer.ts` must load it too, to see the COVER a fence names.
//     A cover is invisible to `record.links` and `record.assets` (it is inside
//     a code fence, which every markdown scanner skips), so without this the
//     image renders for the admin and 404s for every visitor — the silent
//     public-site breakage that `allowedAttachments()` already carries a long
//     comment about.
//
// WHY NOT YAML. The body LOOKS like YAML and deliberately is not: a real
// parser turns a stray colon in a title into a syntax error, and the writer is
// mid-sentence in a note, not editing a config file. So: line-based, one
// `key: value` per line, unknown keys ignored, block scalars for prose, and
// every value tolerant of the three or four ways a person actually writes it
// (`62/130`, `45%`, `45`, `٦٢/١٣٠`). The one hard rule is the $$-math rule
// (client/editor/math.ts): a body that parses to NOTHING returns null, and the
// fence falls back to a plain code block, because unparseable content must
// read as its own source rather than vanish into a blank card.

import { closesFence, fenceOpener, sourceLines } from "./fences.ts";
import type { FolderIcon } from "./folderIcons.ts";

/** Where a tracked thing is in its life. Five states, closed — the same
 *  argument shared/folderIcons.ts makes for a closed icon enum: a free-text
 *  status is a chip the renderer cannot colour and a board cannot group. The
 *  words an author actually types are folded into these by STATUS_WORDS. */
export type TrackerStatus = "planned" | "active" | "done" | "paused" | "dropped";

/** The kinds that come with an icon and a default unit. Anything else is kept
 *  verbatim and drawn with the `sparkle` glyph — a tracker for something we
 *  did not think of must still work. */
export type TrackerKind =
  | "book"
  | "game"
  | "film"
  | "show"
  | "course"
  | "project"
  | "habit";

export interface TrackerRating {
  value: number;
  max: number;
}

export interface Tracker {
  /** `title:`, or the first bare line of the body. Never empty when this
   *  object exists — see parseTracker's null rule. */
  title: string;
  /** The kind exactly as the author wrote it ("game", "مسلسل", "boardgame"),
   *  for display when it is not one we know. Null when the fence names none. */
  kind: string | null;
  /** The folded kind, or null when the author's word is not one of the seven.
   *  The renderer localizes THIS; `kind` is what it prints when this is null. */
  kindKey: TrackerKind | null;
  /** Which glyph the card wears, derived from the kind — never authored. */
  icon: FolderIcon;
  /** Attachment name from `cover:`, with `![[…]]` / `[[…]]` unwrapped. */
  cover: string | null;
  done: number | null;
  total: number | null;
  /** 0–100, derived from done/total, or given directly by `45%` / `45`. Null
   *  when the fence says nothing about progress at all. */
  percent: number | null;
  /** `unit:` verbatim (author's word). Null when absent — the renderer then
   *  uses the kind's own default, which is chrome and therefore localized. */
  unit: string | null;
  status: TrackerStatus;
  rating: TrackerRating | null;
  /** `started:` / `finished:` verbatim. An ISO date is formatted under the
   *  instance's calendar by the renderer; anything else prints as written. */
  started: string | null;
  finished: string | null;
  /** `notes:` — markdown, rendered through the normal inline pipeline. */
  notes: string | null;
}

/** What a ```tracker-board fence asks for. Every field optional: an empty
 *  body is a board of everything, which is the common case. */
export interface BoardFilter {
  kind?: string;
  status?: TrackerStatus;
  limit?: number;
}

// ── Kind → glyph, and kind → default unit ───────────────────────────────────

/** The seven kinds and the glyph each one wears.
 *
 *  The DEFAULT UNIT that goes with each kind is deliberately NOT here: a unit
 *  is a word that has to inflect ("62 / 130 pages", "١٣٠ صفحات"), so it is a
 *  countPhrase key and lives with the dictionary in client/reading/tracker.ts.
 *  This module stays free of anything that would make it untestable under
 *  node or unloadable by the server. */
export const TRACKER_KINDS: Record<TrackerKind, FolderIcon> = {
  // The open book, unmistakable at any size — and the reason `book` is in the
  // shared glyph set at all.
  book: "book",
  game: "gamepad",
  film: "film",
  // A series is watched in EPISODES but drawn with the film glyph: the set has
  // one moving-picture shape, and inventing a second one that reads as a
  // rectangle at 14px would break the no-two-confusable rule folderIcons.ts
  // was built on.
  show: "film",
  // A course is a syllabus you work down — the scroll, not the telescope: what
  // you are looking at is a list of lessons, and `telescope` already means
  // "looking further out" in the folder set.
  course: "scroll",
  project: "flask",
  habit: "leaf",
};

/** The words that mean each kind, folded to lowercase. Synonyms are here and
 *  not in the type because "movie" and "film" are one thing to a reader. */
const KIND_WORDS: Record<string, TrackerKind> = {
  book: "book",
  novel: "book",
  reading: "book",
  game: "game",
  videogame: "game",
  "video game": "game",
  film: "film",
  movie: "film",
  show: "show",
  series: "show",
  tv: "show",
  anime: "show",
  course: "course",
  class: "course",
  project: "project",
  habit: "habit",
  routine: "habit",
  // The instance speaks two languages and so does the vault. An owner writing
  // an Arabic note types `kind: كتاب`, and a table that only knew English
  // would answer that with the "everything else" glyph — a card that works
  // less well in the language half the product is written for.
  كتاب: "book",
  رواية: "book",
  لعبة: "game",
  فيلم: "film",
  مسلسل: "show",
  دورة: "course",
  مشروع: "project",
  عادة: "habit",
};

/** The kind a word means, or null when it is one of ours. Exported because the
 *  board's `kind:` filter has to fold the fence's word the same way the card
 *  did, or `kind: movie` would list nothing on a shelf full of films. */
export function foldKind(kind: string | null): TrackerKind | null {
  if (kind === null) return null;
  return KIND_WORDS[kind.trim().toLowerCase()] ?? null;
}

/** The glyph for a kind word. Unknown → `sparkle`, the set's "everything
 *  else" mark: a tracker for a thing we did not anticipate gets a real card,
 *  never a hole where the icon should be. */
export function trackerIcon(kind: string | null): FolderIcon {
  const key = foldKind(kind);
  return key ? TRACKER_KINDS[key] : "sparkle";
}

// ── Status vocabulary ───────────────────────────────────────────────────────

/** What people type, and what it means. `reading`/`playing`/`watching` are the
 *  point of this table: nobody writes `status: active` about a novel. */
const STATUS_WORDS: Record<string, TrackerStatus> = {
  planned: "planned",
  plan: "planned",
  todo: "planned",
  backlog: "planned",
  queued: "planned",
  wishlist: "planned",
  someday: "planned",
  active: "active",
  reading: "active",
  playing: "active",
  watching: "active",
  listening: "active",
  started: "active",
  ongoing: "active",
  current: "active",
  wip: "active",
  "in-progress": "active",
  "in progress": "active",
  done: "done",
  finished: "done",
  complete: "done",
  completed: "done",
  read: "done",
  played: "done",
  watched: "done",
  beaten: "done",
  paused: "paused",
  hold: "paused",
  "on-hold": "paused",
  "on hold": "paused",
  hiatus: "paused",
  shelved: "paused",
  dropped: "dropped",
  abandoned: "dropped",
  quit: "dropped",
  dnf: "dropped",
  // The Arabic half of the same vocabulary — see KIND_WORDS above.
  مخطط: "planned",
  لاحقًا: "planned",
  "قيد القراءة": "active",
  جارٍ: "active",
  مستمر: "active",
  أقرأ: "active",
  انتهى: "done",
  مكتمل: "done",
  متوقف: "paused",
  مؤجل: "paused",
  متروك: "dropped",
  مهجور: "dropped",
};

/** The folded status, or null when the word means nothing to us (the card
 *  then derives one from the progress rather than inventing a chip). */
function parseStatus(raw: string | undefined): TrackerStatus | null {
  if (raw === undefined) return null;
  return STATUS_WORDS[raw.trim().toLowerCase()] ?? null;
}

// ── Numbers ─────────────────────────────────────────────────────────────────

/** Eastern Arabic-Indic and Extended Arabic-Indic digits folded to ASCII.
 *  An Arabic author writes `progress: ٦٢/١٣٠`, and a parser that only knows
 *  0-9 answers "unparseable" — which under the fallback rule means their card
 *  silently becomes a code block. shared/numerals.ts owns the DISPLAY
 *  direction of this conversion; this is the input side of the same fact. */
function foldDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.codePointAt(0) ?? 0;
    return String((code - (code >= 0x06f0 ? 0x06f0 : 0x0660)) % 10);
  });
}

function num(raw: string): number | null {
  const value = Number.parseFloat(foldDigits(raw).replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `62/130`, `62 / 130`, `62 of 130`, `62 من 130`, `45%`, `45`. Returns the
 *  pieces it found; `percent` is derived from a fraction and taken literally
 *  from the other two forms. */
function parseProgress(raw: string): { done: number | null; total: number | null; percent: number | null } {
  const text = foldDigits(raw).trim();
  const fraction = /^(-?[\d.,]+)\s*(?:\/|of|من)\s*([\d.,]+)/i.exec(text);
  if (fraction) {
    const done = num(fraction[1]);
    const total = num(fraction[2]);
    if (done !== null && total !== null && total > 0) {
      return { done, total, percent: clamp((done / total) * 100, 0, 100) };
    }
    if (done !== null) return { done, total: null, percent: null };
  }
  const scalar = /^(-?[\d.,]+)\s*%?$/.exec(text);
  if (scalar) {
    const value = num(scalar[1]);
    if (value !== null) return { done: null, total: null, percent: clamp(value, 0, 100) };
  }
  return { done: null, total: null, percent: null };
}

/** `8/10`, `4/5`, `★★★★`, `★★★★☆`, `4`. A bare number is out of five when it
 *  fits in five and out of ten otherwise — the two scales anyone uses. */
function parseRating(raw: string): TrackerRating | null {
  const text = foldDigits(raw).trim();
  if (text === "") return null;
  const stars = [...text].filter((ch) => ch === "★" || ch === "⭐").length;
  const empty = [...text].filter((ch) => ch === "☆").length;
  if (stars > 0 || empty > 0) {
    return { value: stars, max: Math.max(5, stars + empty) };
  }
  const fraction = /^([\d.,]+)\s*\/\s*([\d.,]+)$/.exec(text);
  if (fraction) {
    const value = num(fraction[1]);
    const max = num(fraction[2]);
    if (value !== null && max !== null && max > 0) {
      return { value: clamp(value, 0, max), max };
    }
    return null;
  }
  const bare = num(text);
  if (bare === null) return null;
  const max = bare <= 5 ? 5 : 10;
  return { value: clamp(bare, 0, max), max };
}

// ── The body ────────────────────────────────────────────────────────────────

/** `key: value` — the key is deliberately narrow (a bare word) so a line of
 *  prose carrying a colon is not mistaken for a field. */
const FIELD_RE = /^(\s*)([A-Za-z][A-Za-z0-9_-]*)\s*:(.*)$/;

/** Strip one matched pair of surrounding quotes — `title: "Elden Ring"`. */
function unquote(value: string): string {
  const text = value.trim();
  if (text.length >= 2 && (text[0] === '"' || text[0] === "'") && text.at(-1) === text[0]) {
    return text.slice(1, -1);
  }
  return text;
}

/** The fence body as fields. First spelling of a key wins (a duplicated key is
 *  a typo, and the first one is what the author sees at the top of the card),
 *  and `notes: |` swallows the indented block under it. */
function parseFields(body: string): Map<string, string> {
  const lines = sourceLines(body);
  const fields = new Map<string, string>();
  for (let i = 0; i < lines.length; i++) {
    const m = FIELD_RE.exec(lines[i]);
    if (!m) continue;
    const key = m[2].toLowerCase();
    let value = m[3].trim();
    if (/^[|>][-+]?$/.test(value)) {
      // A block scalar runs until a line that is neither blank nor indented —
      // that is, until the next field. The common indent comes off so the
      // markdown inside reaches the renderer as markdown and not as an
      // indented code block.
      const block: string[] = [];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (lines[j].trim() === "") {
          block.push("");
          continue;
        }
        if (!/^\s/.test(lines[j])) break;
        block.push(lines[j]);
      }
      const indents = block
        .filter((line) => line.trim() !== "")
        .map((line) => (/^\s*/.exec(line) ?? [""])[0].length);
      const cut = indents.length > 0 ? Math.min(...indents) : 0;
      value = block
        .map((line) => line.slice(cut))
        .join("\n")
        .replace(/\s+$/, "");
      i = j - 1;
    } else {
      value = unquote(value);
    }
    if (!fields.has(key)) fields.set(key, value);
  }
  return fields;
}

/** `cover: ![[art.jpg]]`, `cover: [[art.jpg]]` and `cover: art.jpg` all name
 *  the same attachment. Both bracket forms are accepted because the author has
 *  the embed syntax in their fingers and will type it here. */
function parseCover(raw: string): string | null {
  const inner = /^!?\[\[([^\]]+)\]\]$/.exec(raw.trim());
  const name = (inner ? inner[1] : raw).split("|")[0].trim();
  return name === "" ? null : name;
}

/** Parse ONE ```tracker fence body. Null when the body says nothing this can
 *  draw — no title AND no progress — which is the fence's fallback rule: the
 *  block then renders as its own source, exactly as an unparseable $$ block
 *  does, rather than as an empty card that hides what the author typed. */
export function parseTracker(body: string): Tracker | null {
  const fields = parseFields(body);
  let title = fields.get("title") ?? "";
  if (title === "") {
    // A bare first line is a title: `\`\`\`tracker` + `Elden Ring` is the
    // shortest thing anyone will type, and refusing it would make the fence
    // feel like a form.
    for (const line of sourceLines(body)) {
      const text = line.trim();
      if (text === "" || FIELD_RE.test(line)) continue;
      title = unquote(text);
      break;
    }
  }
  const progress = parseProgress(fields.get("progress") ?? "");
  if (title === "" && progress.percent === null && progress.done === null) return null;

  const kindRaw = fields.get("kind")?.trim() ?? "";
  const kind = kindRaw === "" ? null : kindRaw;
  const kindKey = foldKind(kind);
  const explicit = parseStatus(fields.get("status"));
  let percent = progress.percent;
  // "I finished it" is a complete statement about progress. A done tracker
  // with no numbers reads 100% — anything else would draw an empty bar under
  // the word "Done".
  if (explicit === "done" && percent === null) percent = 100;
  const status =
    explicit ??
    (percent !== null && percent >= 100
      ? "done"
      : percent !== null && percent > 0
        ? "active"
        : "planned");

  const unit = fields.get("unit")?.trim();
  const coverRaw = fields.get("cover")?.trim() ?? "";
  const started = fields.get("started")?.trim();
  const finished = fields.get("finished")?.trim();
  const notes = fields.get("notes");
  return {
    title,
    kind,
    kindKey,
    icon: trackerIcon(kind),
    cover: coverRaw === "" ? null : parseCover(coverRaw),
    done: progress.done,
    total: progress.total,
    percent,
    unit: unit === undefined || unit === "" ? null : unit,
    status,
    rating: parseRating(fields.get("rating") ?? ""),
    started: started === undefined || started === "" ? null : started,
    finished: finished === undefined || finished === "" ? null : finished,
    notes: notes === undefined || notes.trim() === "" ? null : notes,
  };
}

/** A ```tracker-board fence body. Unknown keys and unknown status words are
 *  ignored rather than refused: a board with a typo in it still shows the
 *  shelf, which is more useful than an error card. */
export function parseBoard(body: string): BoardFilter {
  const fields = parseFields(body);
  const filter: BoardFilter = {};
  const kind = fields.get("kind")?.trim();
  if (kind) filter.kind = kind;
  const status = parseStatus(fields.get("status"));
  if (status) filter.status = status;
  const limit = fields.get("limit");
  if (limit !== undefined) {
    const value = num(limit);
    if (value !== null && value >= 1) filter.limit = Math.floor(value);
  }
  return filter;
}

// ── Scanning a whole note ───────────────────────────────────────────────────

/** Which tracker fence this line opens, or null. Exported because the editor's
 *  live preview asks the same question of an opening line before it decides
 *  whether to replace the block with a card. */
export function trackerFenceKind(line: string): "tracker" | "tracker-board" | null {
  const m = /^\s*(?:`{3,}|~{3,})\s*([^\s`~]*)\s*$/.exec(line);
  if (!m) return null;
  const info = m[1].toLowerCase();
  return info === "tracker" || info === "tracker-board" ? info : null;
}

/** Every ```tracker in a note, in document order. The fence walk is
 *  shared/fences.ts — the same one the outline and the anchor table use —
 *  because a scanner with its own idea of where code ends is exactly the bug
 *  that module was written to end. */
export function scanTrackers(md: string): Tracker[] {
  const out: Tracker[] = [];
  const lines = sourceLines(md);
  for (let i = 0; i < lines.length; i++) {
    const fence = fenceOpener(lines[i]);
    if (!fence) continue;
    const kind = trackerFenceKind(lines[i]);
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !closesFence(lines[j], fence); j++) body.push(lines[j]);
    if (kind === "tracker") {
      const tracker = parseTracker(body.join("\n"));
      if (tracker) out.push(tracker);
    }
    i = j; // past the closing fence (or the end) — never re-enter a fence body
  }
  return out;
}

/** The attachment names every tracker in this note names as a cover.
 *
 *  THE VISITOR 404 TRAP, in one function. A cover lives inside a code fence,
 *  so `parseLinks()` and `parseAssets()` (server/indexer.ts) cannot see it —
 *  and `allowedAttachments()` is built from exactly those two. Wired into that
 *  walk, this is what stops a published shelf from rendering its art for the
 *  owner and nothing at all for the reader. */
export function trackerAssets(md: string): string[] {
  const names: string[] = [];
  for (const tracker of scanTrackers(md)) {
    if (tracker.cover && !names.includes(tracker.cover)) names.push(tracker.cover);
  }
  return names;
}

// ── The stepper's edit ──────────────────────────────────────────────────────

/** Nudge a tracker's progress by `delta` units and return the NEW FENCE BODY.
 *
 *  A pure text transform, and it has to be: the editor's − / + buttons dispatch
 *  this as ONE document edit (the toggleTask precedent, livePreview.ts:655) so
 *  the nudge is one undo step and the document stays the single source of
 *  truth — a widget holding its own count would lose it on the next rebuild.
 *
 *  Byte discipline: exactly one line changes, and inside that line only the
 *  number does. Spacing, the key's spelling, the unit suffix, the line's
 *  indent and the file's line endings all survive, because a progress nudge
 *  that rewrites the author's formatting is a diff they did not ask for. */
export function setTrackerProgress(body: string, delta: number): string {
  const tracker = parseTracker(body);
  // Each line WITH its terminator, so a CRLF body comes back CRLF.
  const parts: string[] = body.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const total = tracker?.total ?? null;

  for (let i = 0; i < parts.length; i++) {
    const eol = /(\r?\n)?$/.exec(parts[i])?.[1] ?? "";
    const text = parts[i].slice(0, parts[i].length - eol.length);
    const m = FIELD_RE.exec(text);
    if (!m || m[2].toLowerCase() !== "progress") continue;
    const value = m[3];
    const digits = /[\d٠-٩۰-۹]+(?:[.,][\d٠-٩۰-۹]+)?/.exec(value);
    if (!digits) break; // an unparseable progress line: leave it alone
    const current = num(digits[0]) ?? 0;
    // Against a total the bar counts UNITS; without one the number is a
    // percentage and the ceiling is 100. Either way the clamp is the reason
    // the button can be held down at the end without the number running away.
    const ceiling = total !== null && total > 0 ? total : 100;
    const next = clamp(current + delta, 0, ceiling);
    if (next === current) return body;
    const rounded = Math.round(next * 100) / 100;
    const newValue =
      value.slice(0, digits.index) + String(rounded) + value.slice(digits.index + digits[0].length);
    parts[i] = `${m[1]}${m[2]}:${newValue}${eol}`;
    return parts.join("");
  }

  // No progress line yet: write one. It goes directly under the title rather
  // than at the end, because the end of a body may be inside a `notes: |`
  // block — appending there would make the number part of the prose.
  const start = Math.round(clamp(delta, 0, 100) * 100) / 100;
  const insert = `progress: ${start}%`;
  // The terminator comes off before the match: `(.*)$` cannot cross a newline,
  // so a line still wearing its `\n` matches no field at all.
  const titleIdx = parts.findIndex(
    (line) => FIELD_RE.exec(line.replace(/\r?\n$/, ""))?.[2].toLowerCase() === "title",
  );
  const at = titleIdx >= 0 ? titleIdx + 1 : 0;
  const eol = /(\r\n|\n)/.exec(body)?.[1] ?? "\n";
  if (at >= parts.length) {
    // Landing at the very end: terminate whatever was the last line, and let
    // the new line inherit its unterminated-ness so a body with no trailing
    // newline still has none.
    if (parts.length > 0 && !/\n$/.test(parts[parts.length - 1])) parts[parts.length - 1] += eol;
    parts.push(insert);
  } else {
    parts.splice(at, 0, insert + eol);
  }
  return parts.join("");
}
