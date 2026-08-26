// Indexer: in-memory search + link-graph index, built once at startup and kept
// fresh incrementally from vault watcher events.

import { closesFence, fenceOpener, type Fence } from "../shared/fences.ts";
import { promises as fs } from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import type { AliasEntry, Backlink, GraphData, GraphEdge, PageMeta, PostMeta, SearchHit, SearchMatch, TagCount, TrackerMeta, VaultEvent } from "../shared/types.ts";
import { stripBidiControls } from "../shared/bidi.ts";
import { findAnyMatches, foldQuery, foldTerm } from "../shared/fold.ts";
import { parseSearchQuery, type QueryFilter } from "../shared/searchQuery.ts";
import { numeralSystem, toNumerals } from "../shared/numerals.ts";
import { isNotePath, isTexPath, noteCandidates, noteTitleOf, stripNoteExt } from "../shared/noteFormat.ts";
import { markdownAnchors, type NoteAnchor } from "../shared/anchors.ts";
import { uncomment } from "../shared/yaml.ts";
import { countNoteWords, countWords, readingMinutes } from "../shared/wordCount.ts";
import { cleanLabelEntry, tagKey, type TagLabelMap } from "../shared/tagLabels.ts";
import { pageFlag } from "./pages.ts";
import { publishFlag, readFrontmatter } from "./publish.ts";
import { parseAliases, parseFolders, readNoteFrontmatter } from "./noteFrontmatter.ts";
import { scanTrackers, type Tracker } from "../shared/tracker.ts";
import { readTexNote } from "./texNote.ts";
import { blogLocale, excludedTags } from "./site.ts";
// Cyclic with this module (settings.ts → site.ts → here) and inert: every
// call below happens at request time, never while either module is loading.
import { templatesFolder } from "./settings.ts";
import { listFolderFiles, listVaultFiles, onEvent, readNote, safeAbs } from "./vault.ts";

interface NoteRecord {
  path: string;
  title: string;
  body: string; // content minus frontmatter
  /** How many source lines the frontmatter block occupied (0 when none, and 0
   *  for `.tex`, whose `body` IS the full file). Every `lineIdx` in this
   *  record counts inside `body`, but the editor and the reading view count
   *  the FULL file — this offset is what lets the wire carry a line number a
   *  click can actually land on. */
  bodyStartLine: number;
  links: { target: string; line: string; lineIdx: number }[];
  /** Vault-relative destinations of STANDARD-markdown images — `![alt](Media/x.png)`
   *  — resolved against this note's own folder. `links` only ever holds
   *  `[[wikilink]]`/`![[embed]]` targets, so without this the publish
   *  allowlist could not see the other half of the syntax the renderer
   *  supports, and every markdown-embedded image in a published note 404'd
   *  to visitors while the admin saw it. Absolute URLs and anything that
   *  climbs out of the vault are dropped here, not later. */
  assets: string[];
  tags: string[];
  /** Frontmatter `labels:` — a TAG PAGE's own display names, `{ ar: برمجيات }`.
   *  Kept on every record rather than only on notes under the tags folder,
   *  because the folder is a runtime setting: gate the read on it and renaming
   *  `tags/` to `topics/` would need a full reindex to take effect. Null when
   *  the note has no such key, which is every note but a handful. Display
   *  only — nothing here ever changes what a tag IS. */
  labels: Record<string, string> | null;
  /** Frontmatter `folders:` — the PUBLIC FOLDER slugs this note claims
   *  membership of (shared/publicFolders.ts). Slugs only, already normalized;
   *  a slug no settings.json declares simply matches nothing, which is what
   *  lets an author write the frontmatter before making the folder. Empty for
   *  almost every note, and kept on every record rather than gated on the
   *  setting for the reason `labels` gives: the setting is edited at runtime,
   *  and a gate here would need a full reindex to take effect. */
  folders: string[];
  /** Every ```tracker fence in this note, parsed (shared/tracker.ts). Empty
   *  for almost every note.
   *
   *  Two things need it and neither can re-read the file: `trackers()` builds
   *  the board's list from it, and `allowedAttachments()` reads the COVER out
   *  of it. That second one is the whole reason it is a record field rather
   *  than something the route parses on demand — a cover name lives inside a
   *  code fence, which `parseLinks()` and `parseAssets()` both skip, so
   *  without this the art on a published shelf renders for the owner and
   *  404s for every visitor. */
  trackers: Tracker[];
  /** File mtime in epoch ms — what the tracker board sorts by. `dateMs` below
   *  is the POST date (frontmatter first, birthtime second), which is when a
   *  thing was written; a shelf answers "what did I touch last". */
  mtimeMs: number;
  /** frontmatter `publish` is exactly true / "true" */
  published: boolean;
  /** frontmatter `page` is exactly true / "true" — a STATIC PAGE (About,
   *  Contact): still an ordinary note, but not an article. Read on every
   *  index so the flag is live; ACTED ON only in designed mode (see
   *  server/pages.ts), which is what keeps the stock blog unchanged. */
  page: boolean;
  /** frontmatter `banner:` raw value (https URL or vault-relative attachment
   *  path), trimmed; null when absent/non-string. */
  banner: string | null;
  /** Post date in epoch ms: frontmatter date/created/published (first that
   *  parses wins), else file birthtime (mtime where the fs has no birthtime). */
  dateMs: number;
  /** True when the body is predominantly Arabic script (Arabic-block
   *  codepoints ≥ 40% of the letter codepoints in its PROSE), false when it
   *  is predominantly something else, and null when the prose holds no
   *  letters at all — an image-only or numeric note has no language, so the
   *  filter leaves it alone rather than guessing. Computed once per
   *  (re)index: the languageFilter's per-note cache. */
  arabic: boolean | null;
  /** For a `.tex` note: the reader's prose, with every control sequence,
   *  math delimiter, label and citation key already gone. NULL for markdown,
   *  which derives the same thing lazily from `body` via stripMarkdown().
   *
   *  This one field is what makes a LaTeX note searchable by its WORDS. The
   *  raw source stays in `body` because backlink context and the editor both
   *  count in source LINES, and a prose string has none. */
  prose: string | null;
  /** Named places inside this note — markdown headings and LaTeX labels in one
   *  table, which is what lets `[[Note#anchor]]` and `\ref{Note#anchor}` be a
   *  single lookup regardless of the target's format. */
  anchors: NoteAnchor[];
  /** LaTeX's own cross-reference vocabulary: `\cite{key}` and the `\ref{key}`
   *  that found NO local `\label`. Kept apart from `links` because it resolves
   *  against different tables (byCitekey / byLabel) — and because a
   *  bibliography key is not a note name, so putting it through basename
   *  resolution would draw a broken edge for every reference in a paper. */
  xrefs: { kind: "cite" | "ref"; key: string; line: string; lineIdx: number }[];
  /** LaTeX only: the paragraph a post excerpt is cut from (the abstract when
   *  the paper has one). Extracted at parse time because finding it means
   *  walking the document TREE, not the source lines. */
  excerptSource: string | null;
  /** Bibliography keys this note ANSWERS to: `\bibitem{…}` values plus a
   *  frontmatter `citekey:`. A `\cite{knuth1997}` anywhere in the vault
   *  becomes an edge to the note carrying that key. */
  citekeys: string[];
  /** The OTHER names this note answers to — frontmatter `aliases:`, exactly as
   *  the author spelled them (see parseAliases). Kept on the record, not only
   *  in the lookup table, because three surfaces need the spelling back: search
   *  says WHICH alias matched, `[[` autocomplete offers them, and removeFile
   *  unregisters them. */
  aliases: string[];
  /** Lazily computed prose-stripped body for snippets (null until first use).
   *  Records are replaced wholesale on reindex, so this never goes stale. */
  flat: string | null;
  /** Lazily computed blog-post fields (same lifecycle as `flat`). */
  post: { excerpt: string; words: number } | null;
}

const notes = new Map<string, NoteRecord>();
const byName = new Map<string, Set<string>>(); // lowercased basename -> paths
const byPathLower = new Map<string, string>(); // lowercased vault-relative path -> path
// Frontmatter `aliases:` — lowercased alias -> paths. A SECOND name table, kept
// strictly behind the first: an Obsidian vault links a note by an alias as
// readily as by its filename, and without this every `[[ML]]` in the vault the
// README recruits rendered dashed and offered to create a duplicate note.
const byAlias = new Map<string, Set<string>>();
// The two vault-wide LaTeX lookups, so an imported project lights up unmodified:
// a `\ref{sec:method}` that matches no label in its own document, and a
// `\cite{knuth1997}` whose key some note in the vault carries.
const byLabel = new Map<string, Set<string>>();   // lowercased \label id -> paths
const byCitekey = new Map<string, Set<string>>(); // lowercased citekey  -> paths

// ── The reverse link index ────────────────────────────────────────────────
//
// `backlinks()` answered "who points at this note?" by walking every note ×
// every link and calling resolveLink() on each one — 40,000 resolutions and
// 83 ms per note open on the 1,388-note fixture, paid again on every panel
// refresh. The graph audit named it beside the graph view itself.
//
// The way out is in resolveLink()'s own shape: it is a lookup in THREE tables
// — the path table, the basename table, the alias table — so the set of link
// keys that could possibly answer with a given note is finite and readable off
// that note alone (its path, its path minus the note extension, its basename,
// every alias it declares). Same for `\cite`/`\ref`, one table over: a note's
// citekeys and its non-heading labels. File every link under the key the
// resolver would reduce it to, and a backlink query becomes "union the sources
// filed under those keys, then verify each one with the real resolver".
//
// VERIFICATION STAYS, deliberately. The candidate set is a superset — a
// basename key can name three notes and only one of them wins pickShortest,
// and the visitor filter can move that winner — so every hit is still put
// through resolveLink() before it is reported. What disappears is the walk
// over the notes that were never candidates, not a single rule about which
// candidate is right. One resolver, one answer, no second implementation to
// drift.
const linkSources = new Map<string, Set<string>>(); // link key -> notes carrying it
const xrefSources = new Map<string, Set<string>>(); // \cite/\ref key -> notes carrying it

function fileUnder(map: Map<string, Set<string>>, key: string, notePath: string): void {
  if (!key) return;
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(notePath);
}

function unfileFrom(map: Map<string, Set<string>>, key: string, notePath: string): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(notePath);
  if (set.size === 0) map.delete(key);
}

// ── The graph revision ────────────────────────────────────────────────────
//
// `/api/graph` is the largest response the product makes (534 kB on the
// fixture, ~5 MB at 10k notes) and its memo used to be dropped by EVERY vault
// event and EVERY non-GET request — so during a sync storm each poll paid a
// full rebuild of an answer that had not changed. Most writes do not touch the
// graph at all: typing a paragraph changes no link, no tag, no name and no
// publish flag.
//
// So the index counts its own graph-shaped changes instead, and the memo is
// validated against the count rather than thrown away on rumour. See
// graphSignature() for exactly what "graph-shaped" means, and
// server/graphCache.ts for the read side.
let graphRev = 0;

/** How many graph-shaped changes the index has applied. Monotonic; the only
 *  promise is that it CHANGES whenever `graph()` would answer differently. */
export function graphRevision(): number {
  return graphRev;
}

/** Everything about one note that `graph()` — or the resolution tables it
 *  leans on — can see. Two records with the same signature contribute the same
 *  nodes, the same edges and the same resolution behaviour, so a reindex that
 *  produces one is invisible to the graph and must not cost a rebuild.
 *
 *  It covers more than the graph's own fields on purpose: aliases, labels and
 *  citekeys are how OTHER notes' links land here, and the note's own path and
 *  basename are its entry in the name table. Miss one of those and the memo
 *  survives a change it should not have survived — the one failure mode this
 *  whole mechanism must not have. */
function graphSignature(record: NoteRecord | undefined): string | null {
  if (record === undefined) return null;
  return [
    record.path,
    record.title,
    record.published ? "1" : "0",
    record.arabic === null ? "?" : record.arabic ? "ar" : "la",
    record.tags.join(","),
    record.aliases.join(","),
    record.citekeys.join(","),
    record.links.map((link) => link.target).join(SIG_SEP),
    record.xrefs.map((xref) => `${xref.kind}:${xref.key}`).join(SIG_SEP),
    // LABELS only — a heading slug is not in byLabel and no edge is ever drawn
    // from one, so renaming an H2 must not cost the whole vault a rebuild.
    labelAnchors(record).map((anchor) => anchor.id).join(SIG_SEP),
  ].join(SIG_FIELD);
}

/** Separators no filename, tag, alias, label or link target can contain, so no
 *  two different records can spell the same signature by accident. */
const SIG_SEP = "\u0000";
const SIG_FIELD = "\u0001";

/** The anchors that go into `byLabel` — a `\label{…}`, an equation, a figure.
 *  Heading and section slugs are NOT labels (`[[Note#Heading]]` resolves by the
 *  note, never by the anchor), and addKeys(), removeKeys() and the graph
 *  signature all have to agree on that or one of them registers a key another
 *  forgets. */
function labelAnchors(record: NoteRecord): NoteAnchor[] {
  return record.anchors.filter((a) => a.kind !== "heading" && a.kind !== "section");
}

// Publish state: the set of published note paths, plus (derived lazily) the
// set of attachment paths that published notes embed/link — the only files
// /api/file will serve to non-admin visitors.
const publishedSet = new Set<string>();
let allowedAttachmentsCache: Set<string> | null = null; // null = recompute

// The same walk one step wider: attachment path -> every note that embeds or
// links it, published or not. `allowedAttachments()` answers "may a VISITOR
// fetch this byte"; this answers "would deleting this file break something a
// reader can see", which is the question a delete dialog has to ask and never
// did. Same lifecycle, same invalidation — see invalidateDerived().
let attachmentRefsCache: Map<string, Set<string>> | null = null;

/** Every cache derived from the shape of the index goes stale together: any
 *  mutation that changes a note's links, a note's existence or an attachment's
 *  existence changes all of these answers, and resolution itself shifts as
 *  files come and go.
 *
 *  The templates memo joins them here rather than hanging off `onEvent` (where
 *  treeCache and graphCache hang) DELIBERATELY: `detectTemplatesFolder()` is a
 *  walk of the INDEX, not of the disk, and the index applies a vault event
 *  asynchronously. A memo dropped when the event fires would be refilled from
 *  the pre-event index by any request arriving in that window and would then
 *  stay wrong until the next vault change — the exact stale-memo trap
 *  graphCache.ts had to grow a `whenIndexed()` microtask for. These five call
 *  sites ARE the index's mutations, so a memo dropped here cannot be early. */
function invalidateDerived(): void {
  allowedAttachmentsCache = null;
  attachmentRefsCache = null;
  templatesFolderMemo = null;
}

// Attachments (non-md files): known paths + lowercased basename (with
// extension) -> paths, so ![[image.png]] embeds resolve like wikilinks.
const attachmentPaths = new Set<string>();
const attachmentsByName = new Map<string, Set<string>>();
// Lowercased attachment path -> the real path. A banner (and any other
// path-form image reference) may be written with the casing the author's file
// manager showed them — "Media/Cover.PNG" for "media/cover.png" — and a vault
// that resolves basenames case-insensitively must not turn out to be
// case-SENSITIVE the moment the value carries a folder.
const attachmentsByPathLower = new Map<string, string>();

/** Markdown larger than this gets a MINIMAL record instead of a full one: its
 *  body is never read, so it is absent from full-text search, the link graph,
 *  backlinks, tags and excerpts — but it is still a note, with its title,
 *  publish flag, banner and date, so it appears in the tree, in the post list,
 *  in RSS and on its own URL like any other.
 *
 *  It used to be dropped outright, and that was invisible data loss with the
 *  worst possible blast radius: `/api/note`'s visitor gate reads publishedSet,
 *  so a note the owner had marked `publish: true` answered 404 TO VISITORS
 *  while the admin's own request succeeded — the one failure mode nobody can
 *  see from inside the product. Nothing was logged, and the comment here
 *  claimed the opposite ("still readable via /api/note"). */
const MAX_INDEXED_MD_BYTES = 2 * 1024 * 1024;

/** How much of an oversized note is read for its frontmatter. Frontmatter is
 *  at the top by definition; 64 KB is a hundred times any real block. */
const OVERSIZED_HEAD_BYTES = 64 * 1024;

/** Paths currently held as minimal records — the boot summary counts them, and
 *  the set keeps the warning to one line per file rather than one per save. */
const oversized = new Set<string>();

/** Bounded concurrency for boot-time indexing: avoids EMFILE on big vaults. */
const BOOT_CONCURRENCY = 64;

// `aliases` is a NAME field, so it is boosted like one — under the title (the
// filename is what the note is called) and over tags. A note findable by a
// `[[alias]]` and invisible to a search for the same word is a note whose
// aliases the reader cannot trust.
const mini = new MiniSearch<{ path: string; title: string; body: string; tags: string; aliases: string }>({
  idField: "path",
  fields: ["title", "body", "tags", "aliases"],
  searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 6, aliases: 4, tags: 2 } },
  // DIACRITICS ARE NOT PART OF A WORD'S IDENTITY — Obsidian's eighth
  // most-requested feature of all time, and the one this vault's owner needs
  // most. minisearch's default `processTerm` lowercases and stops there, so a
  // note headed «الْمُقَدِّمَة» is filed under a term no reader will ever type;
  // «المقدمة» answers "no matches" and the search box looks broken. The fold
  // (shared/fold.ts) is applied HERE, which is the one place that fixes both
  // directions at once: minisearch runs `processTerm` over the terms it FILES
  // and over the terms it is ASKED for, so the plain spelling finds the pointed
  // note and the pointed spelling finds the plain one — with no second copy of
  // the query and no widening of the index.
  //
  // A term that folds away to nothing (a lone shadda a typist left behind) is
  // dropped rather than filed: `null` is minisearch's own "skip this token",
  // and an empty term in the index is a term every query matches.
  processTerm: (term) => foldTerm(term) || null,
  // THE SERVER USED TO DIE HERE, and it died in the most ordinary situation
  // this product has: two clients saving into one vault. Reproduced 5/5 with
  // two clients alternating precondition saves (~520 writes), always the same
  // way — an uncaught TypeError thrown from inside minisearch, out of a
  // promise nothing in this process owns, taking the whole server with it.
  //
  // Automatic vacuuming is an ASYNC BATCHED WALK of the term index
  // (`performVacuuming`: `for (const [term] of this._index) … await
  // setTimeout(batchWait)`), scheduled by `discard()` and running between
  // ticks. Every save calls removeFile() → `mini.discard` and then
  // `mini.add` — so a vacuum begun by one save is still walking the radix
  // tree when the next save mutates it, and an iterator over a tree that has
  // just had nodes spliced out from under it reads properties of undefined.
  // No amount of care at OUR call sites fixes that: the two halves are the
  // library's, and it hands us no way to await one of them.
  //
  // So the schedule becomes ours. `autoVacuum: false` means nothing ever
  // vacuums behind a mutation's back; `scheduleVacuum()` below runs one
  // explicitly, ON THE SAME `settled` CHAIN every index mutation now goes
  // through, which makes "a vacuum is running" and "a save is applying"
  // mutually exclusive states rather than a race. `mini.replace()` was the
  // other candidate fix and is not one: it is `discard()` + `add()` with our
  // own two lines moved inside the library, and it schedules the same vacuum.
  autoVacuum: false,
});

/** How long the index must be quiet before the deferred vacuum runs. Long
 *  enough that a burst of saves (or a `git pull`) is one vacuum rather than
 *  fifty; short enough that a working session never carries dirt for long. */
const VACUUM_IDLE_MS = 2_000;

/** Dirt below this is not worth a walk — minisearch's own default trigger. */
const VACUUM_MIN_DIRT = 20;

let vacuumTimer: NodeJS.Timeout | null = null;

/** What the term index is carrying. Diagnostics for the perf harness and for
 *  the test that proves the deferred vacuum actually runs — a vacuum nobody
 *  can observe is a vacuum that quietly stopped happening. */
export function indexStats(): { notes: number; dirt: number; vacuuming: boolean } {
  return { notes: notes.size, dirt: mini.dirtCount, vacuuming: mini.isVacuuming };
}

/** Book a vacuum for the next quiet moment, at most one at a time.
 *
 *  Deliberately NOT debounced-by-restart: under a sustained storm a restarting
 *  timer would never fire and the index would grow dirt forever. One timer per
 *  window, re-booked after it runs, so a long storm is vacuumed periodically
 *  and a quiet vault is vacuumed once. */
function scheduleVacuum(): void {
  if (vacuumTimer !== null || mini.dirtCount < VACUUM_MIN_DIRT) return;
  vacuumTimer = setTimeout(() => {
    vacuumTimer = null;
    // Enqueued, not called: the whole point is that no mutation runs while the
    // walk is in the air. batchWait 0 keeps the yields (other requests still
    // get served between batches) without the 10 ms sleep that made the
    // library's own vacuum take seconds on a real index.
    void enqueue(() => mini.vacuum({ batchSize: 4_000, batchWait: 0 }));
  }, VACUUM_IDLE_MS);
  // A pending vacuum must never be the reason a process refuses to exit.
  vacuumTimer.unref?.();
}

/** Matches [[Name]], [[Name#heading]], [[Name|alias]], [[Name#heading|alias]]. */
export function wikilinkRegex(): RegExp {
  return /\[\[([^[\]|#]+)(#[^[\]|]*)?(\|[^[\]]*)?\]\]/g;
}

// -------------------------------------------------------- language detection

/** Arabic-script blocks: Arabic, Supplement, Extended-A, Presentation Forms. */
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u;
const LETTER_RE = /\p{L}/u;

/** Language-detection budget: sampling the first chunk of a note is plenty
 *  to call its script, and keeps giant notes cheap to reindex. */
const DETECT_MAX_CHARS = 64 * 1024;

/** Everything a reader never reads as prose. Counting it is what made real
 *  Arabic notes score English: a Readwise export of an Arabic book is one
 *  `readwise.io/to_kindle?action=open&asin=…` per highlight, an embedded
 *  YouTube player is ~40 Latin letters of markup around one Arabic caption,
 *  and a "المصادر" list is three English URLs under one Arabic word. None of
 *  those letters are the note's language. Frontmatter is already excluded by
 *  the caller (it splits the body first). Order matters: code fences before
 *  inline code, HTML before markdown links (an <a href> is markup, not a
 *  link destination), destinations before bare URLs. */
const NON_PROSE: { re: RegExp; keepGroup: boolean }[] = [
  // Fenced code (``` or ~~~), then inline code.
  { re: /^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]*(?:```|~~~)[^\n]*$/gm, keepGroup: false },
  { re: /`[^`\n]*`/g, keepGroup: false },
  // HTML comments, then tags and autolinks (<https://…>) — attribute values,
  // alt text and element names are all markup, none of it prose.
  { re: /<!--[\s\S]*?-->/g, keepGroup: false },
  { re: /<[^>\n]{1,300}>/g, keepGroup: false },
  // Markdown links and images: keep the visible text, drop the destination.
  { re: /!?\[([^\]]*)\]\([^)]*\)/g, keepGroup: true },
  // Reference-link definitions ("[label]: https://…") are destinations too.
  { re: /^[ \t]*\[[^\]]+\]:[^\n]*$/gm, keepGroup: false },
  // Bare URLs pasted straight into the text.
  { re: /\b(?:https?|mailto|obsidian|zotero):\/*\S+/gi, keepGroup: false },
  { re: /\bwww\.[^\s)\]]+/gi, keepGroup: false },
];

/** The note's prose: what a reader actually reads, with markup, code and link
 *  destinations removed. `[text](url)` keeps `text` (visible), drops the url. */
function proseOnly(markdown: string): string {
  let out = markdown;
  for (const { re, keepGroup } of NON_PROSE) {
    out = keepGroup ? out.replace(re, (_match, text: string) => ` ${text} `) : out.replace(re, " ");
  }
  return out;
}

/** True when Arabic-block codepoints make up ≥ 40% of the letter codepoints in
 *  the note's PROSE — "written predominantly in Arabic" for the languageFilter.
 *  null when the prose has no letters at all (nothing to judge). */
function detectArabic(body: string): boolean | null {
  const sample = body.length > DETECT_MAX_CHARS ? body.slice(0, DETECT_MAX_CHARS) : body;
  let letters = 0;
  let arabic = 0;
  for (const ch of proseOnly(sample)) {
    if (!LETTER_RE.test(ch)) continue;
    letters++;
    if (ARABIC_RE.test(ch)) arabic++;
  }
  if (letters === 0) return null;
  return arabic / letters >= 0.4;
}

/** THE filter language for one request, or null for "nothing is filtered".
 *
 *  It is a PARAMETER, not a global read, and that is the whole shape of this
 *  round: the mode can now be "follow", where the answer depends on the
 *  language the READER is reading in — so a function that consulted a global
 *  would hand every reader the same site-wide answer and make the EN/ع switch
 *  a lie. `server/language.ts` resolves the mode + reader into this value once
 *  per request; everything below simply obeys it. `null` is passed by every
 *  ADMIN surface, unconditionally: admin surfaces are never filtered. */
export type FilterLang = "ar" | "en" | null;

/** True when the language filter hides this record from PUBLIC blog surfaces:
 *  `lang === "ar"` hides non-Arabic notes, `"en"` hides Arabic-majority ones,
 *  `null` hides nothing. Curation, not access control — direct URL access to
 *  any published note stays allowed (/api/note is never filtered), only the
 *  discovery surfaces (posts, topics, graph, search, backlinks, RSS) skip
 *  filtered notes, and they must never leak their existence. */
function languageHidden(record: NoteRecord, lang: FilterLang): boolean {
  if (lang === null) return false;
  // A note with no prose letters (arabic === null) belongs to no language:
  // hiding it from one site and showing it on the other would be a coin toss.
  // It stays visible in both.
  if (record.arabic === null) return false;
  return lang === "ar" ? !record.arabic : record.arabic;
}

/** Published AND not curated away by the language filter — the visibility rule
 *  every visitor DISCOVERY surface applies, including the push channel: an SSE
 *  stream that announced a filtered-out note would leak its existence, path
 *  and edit timing to exactly the visitors the filter hides it from. (Direct
 *  access stays allowed: /api/note deliberately checks publication only.)
 *
 *  `lang` is REQUIRED on purpose — it has no default. A default would be a
 *  filter language chosen by whichever module forgot to pass one, and the
 *  failure mode of getting it wrong is a visitor seeing a note the site meant
 *  to withhold, or a reader's own language quietly ignored. Every call site is
 *  made to say which scope it is asking about. */
export function isNoteVisibleToVisitor(relPath: string, lang: FilterLang): boolean {
  const record = notes.get(relPath);
  return publishedSet.has(relPath) && record !== undefined && !languageHidden(record, lang);
}

/** The published set split by the script its PROSE is written in — the numbers
 *  the settings row prints BEFORE a filter is saved ("2 of your 20 published
 *  notes qualify"), and the same numbers the empty-set fallback and the admin's
 *  ongoing indicator are computed from. Cheap: `arabic` is cached per record at
 *  index time, so this is one pass over the published set. */
export interface PublishedCensus {
  /** Prose is predominantly Arabic script. */
  arabic: number;
  /** Prose is predominantly something else. */
  latin: number;
  /** No prose letters at all — an image-only or numeric note belongs to no
   *  language and is shown under every mode rather than guessed at. */
  neutral: number;
}

export function publishedCensus(): PublishedCensus {
  let arabic = 0;
  let latin = 0;
  let neutral = 0;
  for (const notePath of publishedSet) {
    const record = notes.get(notePath);
    if (!record) continue;
    if (record.arabic === null) neutral++;
    else if (record.arabic) arabic++;
    else latin++;
  }
  return { arabic, latin, neutral };
}

/** How many of a census's notes survive `lang` — what a visitor reading in
 *  that language would find. Pure, and separate from `publishedCensus()`
 *  because the callers that matter (the per-request scope resolver, the
 *  settings preview) need BOTH the split and this count, and walking the
 *  published set twice for one answer is a pass nobody asked for. */
export function visibleUnder(census: PublishedCensus, lang: FilterLang): number {
  const { arabic, latin, neutral } = census;
  if (lang === null) return arabic + latin + neutral;
  return (lang === "ar" ? arabic : latin) + neutral;
}


/** Topics a visitor would see under `lang`, and which of `hidden` (the
 *  EXCLUDE_TAGS set, real or hypothetical) actually removes a topic that would
 *  otherwise be on the page. An excluded tag that matches nothing is worth
 *  knowing about too — it is a rule the operator believes is working. */
export function publishedTopics(
  lang: FilterLang,
  hidden: Set<string>,
): { visible: number; total: number; suppressed: string[] } {
  const all = new Set<string>();
  const cut = new Set<string>();
  for (const notePath of publishedSet) {
    const record = notes.get(notePath);
    if (!record || languageHidden(record, lang)) continue;
    for (const tag of record.tags) {
      all.add(tag);
      if (hidden.has(tag.toLowerCase())) cut.add(tag);
    }
  }
  return {
    visible: all.size - cut.size,
    total: all.size,
    suppressed: [...cut].sort((a, b) => a.localeCompare(b)),
  };
}

// ------------------------------------------------------------------ building

export async function initIndexer(): Promise<void> {
  const t0 = performance.now();
  const { notes: noteFiles, attachments } = await listVaultFiles();
  for (const file of attachments) addAttachment(file);
  // Index with bounded concurrency: a 1.4k-note vault must not open 1.4k fds.
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < noteFiles.length) {
      const file = noteFiles[next++];
      // applyIndexFile, not indexFile: boot is the one moment nothing else can
      // be touching the index (serve() has not been called, no vacuum is
      // scheduled), so putting 1,388 files through the one-at-a-time chain
      // would only throw away the overlap the fd budget above exists to buy.
      await applyIndexFile(file);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(BOOT_CONCURRENCY, noteFiles.length) }, worker),
  );
  onEvent(handleEvent);
  // The oversized tail is named in the boot line, not just in the per-file
  // warnings above it: "3 by metadata only" is the number that explains why a
  // search comes back empty for text the operator can see on screen.
  const metaOnly = oversized.size > 0 ? `, ${oversized.size} by metadata only (over ${MAX_INDEXED_MD_BYTES / 1024 / 1024} MB)` : "";
  console.log(
    `  indexed ${notes.size} notes, ${attachmentPaths.size} attachments in ${Math.round(performance.now() - t0)}ms${metaOnly}`,
  );
}

/** Resolves once every watcher event emitted so far has been applied to the
 *  index. Callers that observe state both before and after an event (the SSE
 *  visitor filter) await this between the two reads. */
let settled: Promise<void> = Promise.resolve();

export function whenIndexed(): Promise<void> {
  return settled;
}

/** Put one unit of index work on the chain and hand back the promise for IT.
 *
 *  THE CHAIN IS NOW THE ONLY DOOR into the index's mutable state — watcher
 *  events, the routes' own eager reindexes, and the minisearch vacuum all
 *  queue here. That is what makes the vacuum safe (see `autoVacuum: false`
 *  above): two things that both mutate the term index can no longer be in
 *  flight at the same moment, whatever order the event loop wakes them in.
 *
 *  A task that throws is logged and swallowed, exactly as before: one bad file
 *  must not poison the chain for every event behind it. */
function enqueue(task: () => Promise<void>, describe = "task"): Promise<void> {
  const next = settled
    .then(task)
    .catch((err) => console.error(`indexer: ${describe} failed:`, err));
  settled = next;
  return next;
}

function handleEvent(event: VaultEvent): void {
  const isNote = isNotePath(event.path);
  const apply = async (): Promise<void> => {
    switch (event.kind) {
      case "created":
      case "changed":
        if (event.dir) break;
        if (isNote) await applyIndexFile(event.path);
        else addAttachment(event.path);
        break;
      case "deleted":
        if (event.dir) removeFolder(event.path);
        else if (isNote) removeFile(event.path);
        else removeAttachment(event.path);
        break;
      case "renamed":
        // A FOLDER move arrives as one `dir` event (vault.moveFolder), the
        // same shape a folder delete uses — the per-file storm is suppressed,
        // so this branch is the only thing that will ever tell the index that
        // 715 notes changed address. Without it the old records survived as
        // ghosts: search hit paths that 404'd, the graph drew edges into a
        // folder that no longer existed, and the moved notes were not indexed
        // at their new home at all.
        if (event.dir) {
          if (event.toPath) await reindexFolderMove(event.path, event.toPath);
          break;
        }
        removeFile(event.path);
        if (event.toPath) await applyIndexFile(event.toPath);
        break;
      case "bulk":
        // Never reaches here: the aggregate coalescer (server/vault.ts) only
        // feeds the refetching subscribers, and the index is not one of them —
        // it gets every path, always. Stated so the switch is honest about the
        // kind existing on the type.
        break;
    }
  };
  // Chain on the previous apply so events land in order and whenIndexed()
  // always covers the newest event.
  void enqueue(apply, `apply ${event.kind} ${event.path}`);
}

/** Index (or reindex) one note immediately. Exported so API writes can update
 *  the index synchronously instead of waiting out the watcher debounce —
 *  otherwise a rename issued right after a save misses freshly written links.
 *
 *  "Immediately" now means "next on the chain", not "right now, on top of
 *  whatever else is halfway through". Two clients saving into one vault put
 *  two of these in flight at once — that is the ordinary case, not the exotic
 *  one — and interleaving them was how the term index got mutated underneath
 *  its own vacuum (see `autoVacuum: false`). Callers await it exactly as
 *  before and get a stronger guarantee: when this resolves, every index
 *  mutation queued before it has also landed. */
export function indexFile(relPath: string): Promise<void> {
  return enqueue(() => applyIndexFile(relPath), `index ${relPath}`);
}

/** True when a filesystem error means THE FILE IS NOT THERE, and only then.
 *
 *  Everything else — EMFILE under a `git pull`, EACCES on a file the owner
 *  chmodded, EIO on a flaky external disk, EBUSY on a Windows share — says the
 *  file could not be READ, which is a different fact and must lead somewhere
 *  different. `safeAbs()` throws a VaultError for a path outside the vault;
 *  that is not an errno and is not "absent" either. */
function isMissing(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/** A read that failed for a reason other than absence: say so, once, loudly.
 *
 *  The bug this replaces was silent and permanent. An untyped `catch` here
 *  called `removeFile()`, so ONE EMFILE — the ordinary consequence of a big
 *  `git pull` against a watcher — dropped that note out of search, out of the
 *  graph, out of backlinks and out of the tag counts, with nothing written
 *  anywhere and nothing to bring it back short of a restart. Keeping the
 *  previous record is strictly better: it is stale by however much the file
 *  changed, and the next event on that path fixes it.
 *
 *  THE DEFAULT IS "KEEP", and that is the deliberate half. A handful of
 *  refusals that are not errnos land here too — `safeAbs()` answers a 404 for
 *  a path it cannot resolve, which on an unreadable directory is the same
 *  EACCES wearing a different coat, and for a dangling symlink is a genuinely
 *  unservable note. Keeping a record for the second case costs a search hit
 *  that 404s when clicked; evicting for the first costs a note that vanishes
 *  from the whole product until a restart. Those are not close. */
function keepStale(relPath: string, err: unknown, what: string): void {
  const reason =
    (err as NodeJS.ErrnoException | null)?.code ??
    (err instanceof Error ? err.message : String(err));
  console.warn(
    `vellum: could not ${what} "${relPath}" (${reason}) — keeping the previous index entry; ` +
      "it will refresh on the next change to that file",
  );
}

async function applyIndexFile(relPath: string): Promise<void> {
  let stat;
  let abs;
  try {
    abs = safeAbs(relPath);
    stat = await fs.stat(abs);
  } catch (err) {
    if (!isMissing(err)) {
      keepStale(relPath, err, "stat");
      return;
    }
    removeFile(relPath);
    return;
  }
  // Oversized markdown: metadata only, body never read. Search degrades; the
  // note does not disappear. See MAX_INDEXED_MD_BYTES.
  if (stat.size > MAX_INDEXED_MD_BYTES) {
    await indexOversized(relPath, abs, stat);
    return;
  }
  let content: string;
  try {
    content = (await readNote(relPath)).content;
  } catch (err) {
    if (!isMissing(err)) {
      keepStale(relPath, err, "read");
      return;
    }
    removeFile(relPath); // vanished between the stat and the read
    return;
  }
  // Read BEFORE the record is torn down: the graph revision moves only if this
  // reindex changes something the graph can see, and that comparison needs the
  // old signature in hand. Typing a paragraph is the common case and it changes
  // none of it.
  const wasGraph = graphSignature(notes.get(relPath));
  removeFile(relPath, true);
  // Display title: bidi controls out. A filename may legitimately be Arabic
  // or mixed-script, but an embedded RLO makes "invoice<U+202E>fdp.exe.md"
  // render as "invoiceexe.pdf" in the public post list, in RSS <title> and in
  // the og: tags third parties consume. The RESOLUTION key below keeps the raw
  // basename, so [[wikilinks]] written with the same characters still resolve.
  const rawTitle = noteTitleOf(relPath);
  const title = stripBidiControls(rawTitle);
  // ONE branch, at the one point where a note's TEXT is interpreted. Below it
  // every field is format-blind again: links are wikilink-shaped either way,
  // tags come from the same frontmatter text, and `prose` is what the search
  // index, the language detector and the excerpt builder all read.
  const parts = isTexPath(relPath)
    ? texParts(relPath, content)
    : markdownParts(relPath, content);
  const fm = parts.fm;
  const record: NoteRecord = {
    path: relPath,
    title,
    body: parts.body,
    bodyStartLine: parts.bodyStartLine,
    links: parts.links,
    xrefs: parts.xrefs,
    assets: parts.assets,
    tags: parseTags(parts.tagSource, parts.frontmatter),
    labels: labelsOfFm(fm),
    // `parts.fm` is already format-correct (readNoteFrontmatter's two branches
    // live in markdownParts/texParts), so a `.tex` note joins a public folder
    // from its `%---` comment block exactly as a markdown note does.
    folders: parseFolders(fm),
    // The fence walk is shared/fences.ts', so a ```tracker shown INSIDE a
    // ```markdown block is documentation, not a tracker — the same rule the
    // outline and the anchor table keep.
    trackers: scanTrackers(parts.body),
    mtimeMs: stat.mtimeMs,
    published: publishFlag(fm),
    page: pageFlag(fm),
    banner: typeof fm.banner === "string" && fm.banner.trim() ? fm.banner.trim() : null,
    dateMs:
      parseFmDate(fm.date) ??
      parseFmDate(fm.created) ??
      parseFmDate(fm.published) ??
      (stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs),
    arabic: detectArabic(parts.prose ?? parts.body),
    prose: parts.prose,
    anchors: parts.anchors,
    citekeys: parts.citekeys,
    aliases: parseAliases(fm),
    excerptSource: parts.firstParagraph,
    flat: null,
    post: null,
  };
  oversized.delete(relPath); // it may have just shrunk back under the cap
  notes.set(relPath, record);
  addName(rawTitle, relPath);
  byPathLower.set(relPath.toLowerCase(), relPath);
  addKeys(record);
  if (record.published) publishedSet.add(relPath);
  invalidateDerived();
  if (graphSignature(record) !== wasGraph) graphRev++;
  // Tags are indexed too so "#tag" (and frontmatter-only tags) are findable.
  mini.add({
    path: relPath,
    title,
    // A `.tex` note is indexed on its PROSE. Feeding minisearch the raw source
    // would make every document match "begin", "textbf" and "usepackage" and
    // none of them match the sentence the reader remembers writing.
    body: record.prose ?? record.body,
    tags: record.tags.join(" "),
    aliases: record.aliases.join(" "),
  });
}

/** What indexFile() needs from a note's text, in one shape for both formats. */
interface NoteParts {
  /** Raw source minus frontmatter — LINE-indexed, because backlink context and
   *  the editor both count in source lines. */
  body: string;
  /** Lines the stripped frontmatter took with it — see NoteRecord. */
  bodyStartLine: number;
  /** Frontmatter TEXT (YAML), for parseTags(). */
  frontmatter: string;
  /** Where inline `#tags` are looked for. Markdown: the body. LaTeX: nowhere —
   *  `#` is a macro-parameter character there, so `#tag` in a `.tex` file is a
   *  compile error, not a tag. Frontmatter tags work in both. */
  tagSource: string;
  fm: Record<string, unknown>;
  links: NoteRecord["links"];
  xrefs: NoteRecord["xrefs"];
  assets: string[];
  prose: string | null;
  anchors: NoteAnchor[];
  citekeys: string[];
  /** LaTeX only: the abstract-or-first paragraph, already plain prose. */
  firstParagraph: string | null;
}

function markdownParts(relPath: string, content: string): NoteParts {
  const { body, frontmatter, bodyStartLine } = splitFrontmatter(content);
  return {
    body,
    bodyStartLine,
    frontmatter,
    tagSource: body,
    fm: readFrontmatter(content),
    links: parseLinks(body),
    xrefs: [],
    assets: parseAssets(body, relPath),
    prose: null,
    anchors: markdownAnchors(content),
    citekeys: citekeyOf(readFrontmatter(content)),
    firstParagraph: null,
  };
}

function texParts(relPath: string, content: string): NoteParts {
  const tex = readTexNote(relPath, content);
  return {
    body: content,
    bodyStartLine: 0, // a .tex body IS the full file; its lineIdx is already absolute
    frontmatter: tex.frontmatter,
    tagSource: "",
    fm: tex.fm,
    links: tex.links,
    xrefs: tex.xrefs,
    assets: tex.assets,
    prose: tex.prose,
    anchors: tex.anchors,
    citekeys: tex.citekeys,
    firstParagraph: tex.firstParagraph,
  };
}

/** A markdown note can claim a citation key too — `citekey: knuth1997` in its
 *  frontmatter — so a literature note written in markdown answers a `\cite`
 *  from a LaTeX paper. The vocabulary is LaTeX's; the notes need not be. */
function citekeyOf(fm: Record<string, unknown>): string[] {
  const value = fm.citekey;
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
  }
  return [];
}

/** Register a record's labels, citekeys and aliases in the vault-wide tables.
 *
 *  Aliases ride HERE, beside the other two, and not in their own call: every
 *  path that indexes a note calls addKeys() and every path that forgets one
 *  calls removeKeys(), so a table added to this pair cannot be the one a future
 *  incremental `indexFile()` leaves stale. A stale alias resolving to a deleted
 *  note is worse than no aliases at all. */
function addKeys(record: NoteRecord): void {
  for (const anchor of labelAnchors(record)) {
    let set = byLabel.get(anchor.id.toLowerCase());
    if (!set) byLabel.set(anchor.id.toLowerCase(), (set = new Set()));
    set.add(record.path);
  }
  for (const key of record.citekeys) {
    let set = byCitekey.get(key.toLowerCase());
    if (!set) byCitekey.set(key.toLowerCase(), (set = new Set()));
    set.add(record.path);
  }
  // Keyed on the alias EXACTLY as written (lowercased), the same bargain the
  // name table strikes with a raw basename: `title` is sanitized for display,
  // the resolution key is not, so a link written with the author's own
  // characters still resolves.
  for (const alias of record.aliases) {
    let set = byAlias.get(alias.toLowerCase());
    if (!set) byAlias.set(alias.toLowerCase(), (set = new Set()));
    set.add(record.path);
  }
  // …and the REVERSE direction, filed under the key the resolver will reduce
  // each target to. It rides here for the same reason aliases do: one pair of
  // functions owns every vault-wide table, so a table added later cannot be
  // the one an incremental reindex leaves pointing at a note that moved.
  for (const link of record.links) {
    const { key, asPath } = linkKeys(link.target);
    fileUnder(linkSources, key, record.path);
    if (asPath !== key) fileUnder(linkSources, asPath, record.path);
  }
  for (const xref of record.xrefs) fileUnder(xrefSources, xref.key.toLowerCase(), record.path);
}

function removeKeys(record: NoteRecord): void {
  const drop = (map: Map<string, Set<string>>, key: string): void => {
    const set = map.get(key.toLowerCase());
    if (!set) return;
    set.delete(record.path);
    if (set.size === 0) map.delete(key.toLowerCase());
  };
  for (const anchor of record.anchors) drop(byLabel, anchor.id);
  for (const key of record.citekeys) drop(byCitekey, key);
  for (const alias of record.aliases) drop(byAlias, alias);
  for (const link of record.links) {
    const { key, asPath } = linkKeys(link.target);
    unfileFrom(linkSources, key, record.path);
    if (asPath !== key) unfileFrom(linkSources, asPath, record.path);
  }
  for (const xref of record.xrefs) unfileFrom(xrefSources, xref.key.toLowerCase(), record.path);
}

/** A folder MOVED: drop every record under the old prefix, then index the
 *  subtree at its new home. Walks only what moved — `listVaultFiles()` would
 *  re-read all 1,388 notes of a real vault to learn what one drag did.
 *
 *  Awaited through the same `settled` chain every other event uses, so the
 *  route's `whenIndexed()` covers it and the `/api/tree` + `/api/graph` refetch
 *  the client fires on the 200 is already correct. */
export async function reindexFolderMove(fromRel: string, toRel: string): Promise<void> {
  removeFolder(fromRel);
  const { notes: moved, attachments } = await listFolderFiles(toRel);
  for (const file of attachments) addAttachment(file);
  // Already ON the chain (the event that called us is a chain task), so this
  // takes the un-enqueued form. Enqueuing from inside a chain task waits for a
  // promise that cannot resolve until we return: a deadlock, not a slowdown.
  for (const file of moved) await applyIndexFile(file);
}

/** Every note that a move of the subtree at `relFolder` could invalidate — the
 *  set the link rewrite has to walk, sampled BEFORE the move while the links
 *  still resolve.
 *
 *  Three kinds, in one pass over the index. Calling `backlinks()` once per moved
 *  note instead is O(notes²): on the 715-note folder of a real vault that is a
 *  million link resolutions for one drag.
 *   - notes INSIDE the folder: they travel, so every relative destination they
 *     carry has to be re-expressed from the new address;
 *   - notes whose `[[wikilinks]]` resolve to a note inside it (path-form links
 *     dangle; basename links do not, and the rewriter leaves them alone);
 *   - notes whose markdown embeds point at any file inside it — the case that
 *     breaks when a `Media/` folder is dragged and every `![](Media/x.png)` in
 *     the vault stops resolving, for the admin and for every visitor. */
export function notesAffectedByFolderMove(relFolder: string): string[] {
  const prefix = `${relFolder}/`;
  const out = new Set<string>();
  for (const record of notes.values()) {
    if (record.path.startsWith(prefix)) {
      out.add(record.path);
      continue;
    }
    if (record.assets.some((asset) => asset.startsWith(prefix))) {
      out.add(record.path);
      continue;
    }
    for (const link of record.links) {
      if (!link.target.includes("/") && !link.target.includes("\\")) continue; // basename form survives
      const hit = resolveLink(link.target, false, null);
      if (hit !== null && hit.startsWith(prefix)) {
        out.add(record.path);
        break;
      }
    }
  }
  return [...out].sort();
}

/** Index a whole subtree that just APPEARED — a folder restored out of
 *  `.trash/`. The watcher will notice it too, but only after its debounce,
 *  and the restore route answers immediately: without this the tree refetch
 *  that follows a restore showed the folder while search, the graph and the
 *  publish count still thought it was gone. Symmetric with `removeFolder()`,
 *  which is what the delete side does. */
export function indexUnder(relFolder: string): Promise<void> {
  // ONE chain task for the whole subtree — not one per file. A restore is a
  // single logical mutation, and slicing it into hundreds of queue entries
  // would let a save land in the middle of a half-restored folder.
  return enqueue(async () => {
    const { notes: noteFiles, attachments } = await listVaultFiles(relFolder);
    for (const file of attachments) addAttachment(file);
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < noteFiles.length) await applyIndexFile(noteFiles[next++]);
    };
    await Promise.all(
      Array.from({ length: Math.min(BOOT_CONCURRENCY, noteFiles.length) }, worker),
    );
  }, `index under ${relFolder}`);
}

/** The first `bytes` of a file as UTF-8, without reading the rest of it. */
async function readHead(abs: string, bytes: number): Promise<string> {
  const handle = await fs.open(abs, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

/** Metadata-only record for a note past MAX_INDEXED_MD_BYTES: title, publish
 *  flag, banner, date and frontmatter tags, read from the file's HEAD. No
 *  body, so no minisearch entry, no links, no assets, no excerpt — everything
 *  else about the note behaves normally, including publication. */
async function indexOversized(relPath: string, abs: string, stat: { size: number; birthtimeMs: number; mtimeMs: number }): Promise<void> {
  const known = oversized.has(relPath); // sampled before removeFile() clears it
  let head: string;
  try {
    head = await readHead(abs, OVERSIZED_HEAD_BYTES);
  } catch (err) {
    // Same rule as applyIndexFile's two reads: absence removes, anything else
    // keeps what we had and says why.
    if (!isMissing(err)) {
      keepStale(relPath, err, "read the head of");
      return;
    }
    removeFile(relPath);
    return;
  }
  const wasGraph = graphSignature(notes.get(relPath)); // see applyIndexFile
  removeFile(relPath, true);
  const rawTitle = noteTitleOf(relPath);
  // The head is enough for frontmatter in BOTH formats: a `%--- … %---%` block
  // opens on line 1 exactly as a `---` block does.
  const frontmatter = isTexPath(relPath)
    ? readTexNote(relPath, head).frontmatter
    : splitFrontmatter(head).frontmatter;
  const fm = readNoteFrontmatter(relPath, head);
  const record: NoteRecord = {
    path: relPath,
    title: stripBidiControls(rawTitle),
    body: "",
    bodyStartLine: 0,
    links: [],
    xrefs: [],
    assets: [],
    prose: null,
    anchors: [],
    citekeys: citekeyOf(fm),
    // The head carried the whole frontmatter block, so an oversized note
    // answers to its aliases exactly as it answers to its title.
    aliases: parseAliases(fm),
    excerptSource: null,
    tags: parseTags("", frontmatter),
    labels: labelsOfFm(fm),
    // The head carried the whole frontmatter block (readNoteFrontmatter above
    // read BOTH formats out of it), so an oversized note is a member of its
    // folders exactly as a normal one is.
    folders: parseFolders(fm),
    // No body was read at all (metadata-only), so this note contributes no
    // trackers and no tracker covers — the same silence it keeps about links
    // and assets, and for the same reason.
    trackers: [],
    mtimeMs: stat.mtimeMs,
    published: publishFlag(fm),
    page: pageFlag(fm),
    banner: typeof fm.banner === "string" && fm.banner.trim() ? fm.banner.trim() : null,
    dateMs:
      parseFmDate(fm.date) ??
      parseFmDate(fm.created) ??
      parseFmDate(fm.published) ??
      (stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs),
    // No body was read, so there is no prose to judge: "no language", which
    // languageHidden() leaves alone on both an ar and an en site.
    arabic: null,
    flat: null,
    post: null,
  };
  notes.set(relPath, record);
  addName(rawTitle, relPath);
  byPathLower.set(relPath.toLowerCase(), relPath);
  addKeys(record);
  if (record.published) publishedSet.add(relPath);
  invalidateDerived();
  if (graphSignature(record) !== wasGraph) graphRev++;
  // Say it out loud, once per file: a silently unsearchable note is exactly
  // the kind of state this product must never keep to itself.
  oversized.add(relPath);
  if (!known) {
    console.warn(
      `vellum: "${relPath}" is ${Math.round(stat.size / 1024 / 1024)} MB (cap ${MAX_INDEXED_MD_BYTES / 1024 / 1024} MB) — ` +
        "indexed by metadata only: it stays readable, publishable and listed, but its text is not searchable and its links are not in the graph",
    );
  }
}

/** Forget one note.
 *
 *  `reindexing` says the caller is about to put a record straight back at this
 *  path and will move the graph revision itself, by comparing the old signature
 *  with the new one. Every OTHER caller is a real deletion, and a deletion
 *  always changes the graph. */
function removeFile(relPath: string, reindexing = false): void {
  const record = notes.get(relPath);
  if (!record) return;
  if (!reindexing) graphRev++;
  notes.delete(relPath);
  oversized.delete(relPath);
  removeKeys(record);
  // The resolution key is the RAW basename (record.title is the sanitized
  // display title) — addName registered it, removeName must unregister it.
  removeName(noteTitleOf(relPath), relPath);
  if (byPathLower.get(relPath.toLowerCase()) === relPath) byPathLower.delete(relPath.toLowerCase());
  publishedSet.delete(relPath);
  invalidateDerived();
  if (mini.has(relPath)) {
    mini.discard(relPath);
    // The dirt this leaves is cleaned on OUR schedule now, never behind a
    // save's back — see `autoVacuum: false`.
    scheduleVacuum();
  }
}

function removeFolder(relFolder: string): void {
  const prefix = `${relFolder}/`;
  for (const notePath of [...notes.keys()]) {
    if (notePath.startsWith(prefix)) removeFile(notePath);
  }
  for (const attPath of [...attachmentPaths]) {
    if (attPath.startsWith(prefix)) removeAttachment(attPath);
  }
}

function addAttachment(relPath: string): void {
  if (attachmentPaths.has(relPath)) return;
  attachmentPaths.add(relPath);
  invalidateDerived();
  const key = path.posix.basename(relPath).toLowerCase();
  let set = attachmentsByName.get(key);
  if (!set) attachmentsByName.set(key, (set = new Set()));
  set.add(relPath);
  attachmentsByPathLower.set(relPath.toLowerCase(), relPath);
}

function removeAttachment(relPath: string): void {
  if (!attachmentPaths.delete(relPath)) return;
  invalidateDerived();
  const key = path.posix.basename(relPath).toLowerCase();
  const set = attachmentsByName.get(key);
  if (attachmentsByPathLower.get(relPath.toLowerCase()) === relPath) {
    attachmentsByPathLower.delete(relPath.toLowerCase());
  }
  if (!set) return;
  set.delete(relPath);
  if (set.size === 0) attachmentsByName.delete(key);
}

function addName(title: string, relPath: string): void {
  const key = title.toLowerCase();
  let set = byName.get(key);
  if (!set) byName.set(key, (set = new Set()));
  set.add(relPath);
}

function removeName(title: string, relPath: string): void {
  const key = title.toLowerCase();
  const set = byName.get(key);
  if (!set) return;
  set.delete(relPath);
  if (set.size === 0) byName.delete(key);
}

// ------------------------------------------------------------------- parsing

function splitFrontmatter(content: string): { body: string; frontmatter: string; bodyStartLine: number } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return { body: content, frontmatter: "", bodyStartLine: 0 };
  // Count what was CUT, not what remains: line N of `body` is line
  // N + bodyStartLine of the file the editor opens.
  const cut = match[0].match(/\n/g)?.length ?? 0;
  return { body: content.slice(match[0].length), frontmatter: match[1], bodyStartLine: cut };
}

function parseLinks(body: string): NoteRecord["links"] {
  const links: NoteRecord["links"] = [];
  const lines = body.split("\n");
  const re = wikilinkRegex();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    for (let m = re.exec(line); m !== null; m = re.exec(line)) {
      const target = m[1].trim();
      if (target) links.push({ target, line: line.trim(), lineIdx: i });
    }
    re.lastIndex = 0;
  }
  return links;
}

// `![alt](dest)` — the SAME shape the renderers match (client/reading/render.ts
// and client/editor/livePreview.ts): the destination runs to the first
// whitespace or `)`, with an optional quoted title after it. Keeping the three
// regexes the same shape is the point — the allowlist must cover exactly what
// the page will ask for, no more.
const MD_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g;

/** Vault-relative destinations of standard-markdown images in `body`, resolved
 *  against the note's own folder — the server-side twin of the client's
 *  `resolveRelative()` (client/editor/embeds.ts), which turns exactly these
 *  strings into `/api/file?path=…`. External schemes are skipped, `.`/`..`
 *  segments are folded, and a path that climbs above the vault root is
 *  dropped rather than clamped. */
function parseAssets(body: string, relPath: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const base = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")).split("/") : [];
  MD_IMAGE_RE.lastIndex = 0;
  for (let m = MD_IMAGE_RE.exec(body); m !== null; m = MD_IMAGE_RE.exec(body)) {
    const raw = m[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//") || raw.startsWith("#")) continue;
    let clean = raw.replace(/^<|>$/g, "").replace(/[?#].*$/, "");
    try {
      clean = decodeURIComponent(clean);
    } catch {
      // A stray '%' is not an encoding — take the destination literally.
    }
    clean = clean.replace(/\\/g, "/");
    if (!clean) continue;
    // A leading '/' means the vault root, exactly as resolveRelative() reads it.
    const parts = clean.startsWith("/") ? [] : [...base];
    let escaped = false;
    for (const seg of clean.replace(/^\/+/, "").split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (parts.length === 0) {
          escaped = true;
          break;
        }
        parts.pop();
      } else parts.push(seg);
    }
    if (escaped || parts.length === 0) continue;
    const rel = parts.join("/");
    if (!seen.has(rel)) {
      seen.add(rel);
      out.push(rel);
    }
  }
  return out;
}

/** Frontmatter date value → epoch ms, or null when absent/unparseable.
 *  gray-matter's YAML parser hands back Date objects for bare dates and
 *  strings for quoted ones — both are honored. */
function parseFmDate(value: unknown): number | null {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === "string" && value.trim()) {
    const ms = Date.parse(value.trim());
    return Number.isNaN(ms) ? null : ms;
  }
  return null;
}

function parseTags(body: string, frontmatter: string): string[] {
  const tags = new Set<string>();
  // Inline #tags: '#' preceded by start/whitespace/'(' and followed by a word char.
  const inline = /(?:^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
  for (let m = inline.exec(body); m !== null; m = inline.exec(body)) {
    tags.add(m[1].toLowerCase());
  }
  // Frontmatter `tags:` — inline scalar, [a, b] flow list, or block list.
  const fmMatch = /^tags:[ \t]*(.*)$/m.exec(frontmatter);
  if (fmMatch) {
    // A trailing `# comment` is the author's aside, not part of the tag. The
    // scan is quote-aware (shared/yaml.ts) because `tags: ["a # b"]` names one
    // tag with a hash in it — the same verdict the frontmatter writer and the
    // properties card now reach, so a note cannot be filed under a tag reading
    // "alpha # why this one" that nothing else in the product agrees exists.
    const inlineValue = uncomment(fmMatch[1].trim());
    let values: string[] = [];
    if (inlineValue.startsWith("[")) {
      values = inlineValue.replace(/^\[|\]$/g, "").split(",");
    } else if (inlineValue) {
      values = inlineValue.split(",");
    } else {
      const rest = frontmatter.slice(fmMatch.index + fmMatch[0].length);
      for (const line of rest.split("\n")) {
        const item = /^[ \t]*-[ \t]+(.+)$/.exec(line);
        if (item) values.push(uncomment(item[1].trim()));
        else if (line.trim()) break;
      }
    }
    for (const value of values) {
      const tag = value.trim().replace(/^["'#]+|["']+$/g, "").toLowerCase();
      if (tag) tags.add(tag);
    }
  }
  return [...tags].sort();
}

// ------------------------------------------------------------------- queries

/** Shortest-path winner among duplicate basenames: fewest segments, then
 *  shortest string, then alpha — same rule for notes and attachments. */
function pickShortest(candidates: Set<string>): string {
  return [...candidates].sort((a, b) => {
    const depth = a.split("/").length - b.split("/").length;
    if (depth !== 0) return depth;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  })[0];
}

/** Restrict a candidate set to those `keep` accepts; null when none survive. */
function filterCandidates(
  candidates: Set<string>,
  keep: (relPath: string) => boolean,
): Set<string> | null {
  const kept = new Set([...candidates].filter(keep));
  return kept.size === 0 ? null : kept;
}

/** Resolve a wikilink target to a note path: case-insensitive basename, shortest
 *  path wins. `publishedOnly` resolves within the collection the VISITOR can
 *  discover — published AND not curated away by the languageFilter.
 *
 *  The languageFilter half is not optional here. GET /api/resolve hands this
 *  function's answer to anonymous callers, and it takes only a guessable
 *  TITLE: gating on publication alone made it a title→path existence oracle
 *  for exactly the notes the filter hides ("Eppur si muove" → its full vault
 *  path, while a nonexistent name answered null). That is the leak CONTRACTS
 *  says the filter must never produce, and it is a strictly bigger surface
 *  than the by-design /api/note allowance, which requires the exact path the
 *  caller is trying to learn. Direct access by full path stays allowed — this
 *  changes discovery, not reads. */
/** The two forms a wikilink target reduces to before any table is consulted:
 *  `key`, the anchor/alias-stripped lowercase name, and `asPath`, that key
 *  normalized as a vault-relative path.
 *
 *  Extracted so resolveLink() and the reverse index cannot drift. A reverse
 *  index keyed even slightly differently from the resolver is a backlinks panel
 *  that quietly loses rows, which is the worst shape a perf fix can take: it
 *  looks right and it is wrong. */
function linkKeys(target: string): { key: string; asPath: string } {
  // The extension comes off whatever it is: `[[Paper.tex]]` and `[[Paper]]`
  // name the same note, exactly as `[[Note.md]]` and `[[Note]]` always did.
  const key = stripNoteExt(target.split(/[#|]/)[0].trim().toLowerCase());
  // Path-form targets ([[Folder/Note]]) are matched against the vault-relative
  // path table, so `./Folder/Note` and `Folder/Note` have to arrive as one
  // string.
  const asPath = path.posix.normalize(key.replace(/\\/g, "/")).replace(/^\.?\/+/, "");
  return { key, asPath };
}

export function resolveLink(
  name: string,
  publishedOnly: boolean,
  lang: FilterLang,
): string | null {
  const { key, asPath } = linkKeys(name);
  // Path-form targets: exact vault-relative match first (with or without an
  // extension, case-insensitive), mirroring the client resolver. Candidate
  // ORDER is the tie-break: `.md` first, so a vault that grows a `Fourier.tex`
  // beside its `Fourier.md` does not silently re-point every existing link.
  let pathHit: string | undefined;
  for (const candidate of noteCandidates(asPath)) {
    pathHit = byPathLower.get(candidate);
    if (pathHit) break;
  }
  pathHit ??= byPathLower.get(asPath);
  if (pathHit && (!publishedOnly || isNoteVisibleToVisitor(pathHit, lang))) return pathHit;
  // Real basenames, THEN aliases — one rung apart and never mixed. A file
  // actually named `ML.md` must not lose its own name to a `aliases: [ML]` some
  // other note declares, whichever of the two sits at the shorter path.
  //
  // A rung the visitor filter empties falls through to the next one rather than
  // answering null: the visitor's collection is a smaller vault, and inside it
  // no note is named `ML` at all, so the aliased one is the honest answer. It
  // leaks nothing either way — both branches are computed from notes the caller
  // may already discover.
  for (const table of [byName, byAlias]) {
    let candidates = table.get(key);
    if (!candidates || candidates.size === 0) continue;
    if (publishedOnly) {
      const kept = filterCandidates(candidates, (p) => isNoteVisibleToVisitor(p, lang));
      if (!kept) continue;
      candidates = kept;
    }
    // Two notes claiming one alias tie the SAME way two notes sharing a
    // basename do — fewest segments, then shortest string, then alpha. One
    // resolution rule for names, whoever wrote them down.
    return pickShortest(candidates);
  }
  return null;
}

/** Every note that MIGHT point at `targetPath` — a superset the caller
 *  verifies, and the whole of the reverse index's promise.
 *
 *  It is a superset by exactly one rule and no more: resolveLink() consults the
 *  path table, then byName, then byAlias, so a key that answers with this note
 *  is its path, its path minus the note extension, its basename, or one of its
 *  aliases; resolveXref() consults byCitekey and byLabel, so an xref key that
 *  answers with it is one of its citekeys or one of its labels. Anything filed
 *  under any other key CANNOT resolve here, whatever the audience or language
 *  scope — those filters only ever remove candidates, never add one — so
 *  skipping the rest of the vault skips nothing a reader would have seen.
 *
 *  Sorted, so callers that sort by path afterwards keep their old tie-break
 *  (hits from one note stay in that note's own link order). */
function linkCandidates(targetPath: string): string[] {
  const record = notes.get(targetPath);
  const out = new Set<string>();
  const pull = (map: Map<string, Set<string>>, key: string): void => {
    const set = map.get(key);
    if (!set) return;
    for (const source of set) if (source !== targetPath) out.add(source);
  };
  const lower = targetPath.toLowerCase();
  pull(linkSources, lower); // [[Folder/Note.md]]
  pull(linkSources, stripNoteExt(lower)); // [[Folder/Note]]
  pull(linkSources, noteTitleOf(targetPath).toLowerCase()); // [[Note]]
  if (record !== undefined) {
    for (const alias of record.aliases) pull(linkSources, alias.toLowerCase());
    for (const key of record.citekeys) pull(xrefSources, key.toLowerCase());
    for (const anchor of labelAnchors(record)) pull(xrefSources, anchor.id.toLowerCase());
  }
  return [...out].sort();
}

/** Every alias in the vault, as `{ alias, path, title }`, sorted by alias —
 *  what `[[` autocomplete offers beside the note titles it reads from the tree,
 *  which is the one name table the client has no other way to see.
 *
 *  Visitor-scoped like every other discovery surface: an alias must never make
 *  a note reachable that resolveLink itself would refuse to answer with. */
export function aliasEntries(publishedOnly: boolean, lang: FilterLang): AliasEntry[] {
  const out: AliasEntry[] = [];
  for (const record of notes.values()) {
    if (publishedOnly && !isNoteVisibleToVisitor(record.path, lang)) continue;
    for (const alias of record.aliases) {
      // Sanitized for DISPLAY, exactly as the title is: this string is drawn in
      // a completion list, and an embedded RLO there reorders the row.
      out.push({ alias: stripBidiControls(alias), path: record.path, title: record.title });
    }
  }
  // Within one alias, claimants in RESOLUTION order — pickShortest's own rule,
  // fewest segments then shortest then alphabetical — so the first row for any
  // alias is the note `[[alias]]` will actually reach. The `[[` completion
  // relies on this to keep one honest row per alias: sorted by plain path, the
  // row it kept could NAME the loser while inserting a link that lands on the
  // winner.
  return out.sort(
    (a, b) =>
      a.alias.localeCompare(b.alias) ||
      a.path.split("/").length - b.path.split("/").length ||
      a.path.length - b.path.length ||
      a.path.localeCompare(b.path),
  );
}

/** Resolve a link/embed target to a note OR attachment path. Notes win
 *  (attachment basenames carry an extension, so collisions are rare).
 *  `publishedOnly` sees only visitor-visible notes (resolveLink applies the
 *  languageFilter) + allowlisted attachments. Attachments are deliberately NOT
 *  language-filtered: an attachment belongs to no language, and a hidden
 *  note's images must keep loading on its own still-working permalink. */
export function resolveEmbed(name: string, publishedOnly: boolean, lang: FilterLang): string | null {
  const asNote = resolveLink(name, publishedOnly, lang);
  if (asNote) return asNote;
  const key = name.split(/[#|]/)[0].trim().toLowerCase();
  if (!key) return null;
  let candidates = attachmentsByName.get(key);
  if (!candidates || candidates.size === 0) return null;
  if (publishedOnly) {
    const allowed = allowedAttachments();
    const kept = filterCandidates(candidates, (p) => allowed.has(p));
    if (!kept) return null;
    candidates = kept;
  }
  return pickShortest(candidates);
}

// ------------------------------------------------- anchors & cross-references

/** The anchor table for an indexed note — headings, `\label`s, sections,
 *  equations, figures, tables — sorted by source line. Empty for an unknown
 *  path AND for an oversized one (its body was never read), which is why every
 *  caller treats an empty table as "no anchor matched" rather than an error. */
export function noteAnchors(relPath: string): NoteAnchor[] {
  return notes.get(relPath)?.anchors ?? [];
}

/** Where one LaTeX cross-reference points, or null. A `\cite` answers the note
 *  carrying the key; a `\ref` answers the note defining the label. Both are
 *  vault-wide lookups reached only AFTER the document's own definitions have
 *  been checked — the local-first rule lives in server/texNote.ts, which never
 *  records a `\ref` whose label is defined in the same file. */
function resolveXref(
  xref: NoteRecord["xrefs"][number],
  publishedOnly: boolean,
  lang: FilterLang,
): string | null {
  if (xref.kind === "cite") return resolveCitekey(xref.key, publishedOnly, lang);
  return resolveLabel(xref.key, publishedOnly, lang)?.path ?? null;
}

/** The note a `\label{…}` lives in, for a `\ref` that found no local match.
 *
 *  LOCAL-FIRST is the caller's job and is not optional: a `\ref` that matches
 *  a label in its own document must never look here, or importing a project
 *  into a vault could change what its own cross-references point at — which is
 *  precisely the promise that makes dropping a LaTeX project into Vellum safe.
 *
 *  `publishedOnly` scopes to what a visitor may discover, exactly as
 *  resolveLink does: an anonymous caller must not learn that a private note
 *  defines `sec:acquisition`. */
export function resolveLabel(
  label: string,
  publishedOnly: boolean,
  lang: FilterLang,
): { path: string; anchor: NoteAnchor } | null {
  const key = label.trim().toLowerCase();
  if (!key) return null;
  let candidates = byLabel.get(key);
  if (!candidates || candidates.size === 0) return null;
  if (publishedOnly) {
    const kept = filterCandidates(candidates, (p) => isNoteVisibleToVisitor(p, lang));
    if (!kept) return null;
    candidates = kept;
  }
  const notePath = pickShortest(candidates);
  const anchor = notes.get(notePath)?.anchors.find((a) => a.id.toLowerCase() === key);
  return anchor ? { path: notePath, anchor } : null;
}

/** The note that CARRIES a citation key — a `\bibitem{knuth1997}` or a
 *  frontmatter `citekey: knuth1997`. Null leaves the `\cite` alone as an
 *  ordinary bibliography reference, which is the honest default: most keys in
 *  a real paper name a book, not a note. */
export function resolveCitekey(key: string, publishedOnly: boolean, lang: FilterLang): string | null {
  const want = key.trim().toLowerCase();
  if (!want) return null;
  let candidates = byCitekey.get(want);
  if (!candidates || candidates.size === 0) return null;
  if (publishedOnly) {
    const kept = filterCandidates(candidates, (p) => isNoteVisibleToVisitor(p, lang));
    if (!kept) return null;
    candidates = kept;
  }
  return pickShortest(candidates);
}

// ------------------------------------------------------------------- banners

/** THE image-reference ladder — one function, four rungs, and every banner
 *  surface in the product climbs it (note frontmatter, the blog hero and its
 *  thumbnails, og:image, the dashboard hero, the logo and favicon settings,
 *  and GET /api/banner for the client's own render paths).
 *
 *  In order: an `https://` URL passes through (http:/data:/anything else is
 *  refused — a mixed-content <img> is worse than the generated fallback); an
 *  exact vault-relative path; that path RELATIVE TO THE REFERRING NOTE'S OWN
 *  FOLDER, which is where an Obsidian user keeps a note's images; then the
 *  basename, resolved exactly as `![[embed]]` resolves it (case-insensitive,
 *  shortest path wins).
 *
 *  The third and fourth rungs are the bug this exists for. `banner: cover.png`
 *  is what every Obsidian user writes, wikilinks and embeds have always
 *  resolved a bare name from anywhere in the vault, and the banner alone
 *  demanded the file sit at the vault ROOT — so the one link form with no
 *  autocomplete behind it was also the one with the strictest rule, and it
 *  failed by rendering nothing.
 *
 *  `fromDir` is the referring note's folder ("" for the vault root, undefined
 *  when the reference belongs to no note — a settings value). */
export function resolveImageRef(value: string, fromDir?: string): string | null {
  const raw = value.trim();
  if (raw === "") return null;
  if (/^https:\/\//i.test(raw)) return raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null; // http:, data:, javascript:…
  const rel = normalizeRefPath(raw);
  if (rel === "") return null;
  // 1. exact vault-relative path (case-insensitively — see attachmentsByPathLower)
  const exact = attachmentHit(rel);
  if (exact) return exact;
  // 2. relative to the note's own folder ("cover.png" beside the note,
  //    "img/cover.png" under it, "../shared/cover.png" beside its parent)
  if (fromDir !== undefined && fromDir !== "") {
    const joined = normalizeRefPath(`${fromDir}/${rel}`);
    if (joined !== "") {
      const near = attachmentHit(joined);
      if (near) return near;
    }
  }
  // 3. basename, through the resolver embeds use
  const byName = resolveEmbed(path.posix.basename(rel), false, null);
  return byName !== null && attachmentPaths.has(byName) ? byName : null;
}

/** A reference path in vault-relative form: backslashes folded, `.`/`..`
 *  segments applied, leading and trailing slashes dropped. A `..` that walks
 *  above the vault root leaves nothing to resolve, and says so with "". */
function normalizeRefPath(value: string): string {
  const parts: string[] = [];
  for (const seg of value.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return "";
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

/** An indexed attachment at this exact path, case-insensitively. */
function attachmentHit(rel: string): string | null {
  if (attachmentPaths.has(rel)) return rel;
  return attachmentsByPathLower.get(rel.toLowerCase()) ?? null;
}

/** The folder a note lives in ("" at the vault root). */
function folderOf(relPath: string): string {
  const cut = relPath.lastIndexOf("/");
  return cut === -1 ? "" : relPath.slice(0, cut);
}

/** A note's `banner:` value resolved against the ladder above, with the note's
 *  own folder as the relative base. null when unset/unresolvable. */
function resolveBanner(record: NoteRecord): string | null {
  if (!record.banner) return null;
  return resolveImageRef(record.banner, folderOf(record.path));
}

/** GET /api/banner: the same ladder, for a value the CLIENT holds (frontmatter
 *  it has just parsed, a settings value it is about to paint). `notePath` is
 *  the note the value came from, when it came from one.
 *
 *  `publishedOnly` is the visitor scope, and it is the same gate /api/file
 *  applies: a visitor may learn where a banner resolved only when the file is
 *  one they are allowed to fetch. Otherwise the answer is null, which every
 *  caller renders as "no banner" — never as a path that would 404. */
export function resolveBannerRef(
  value: string,
  notePath: string | null,
  publishedOnly: boolean,
  visitorMayFetch: (relPath: string) => boolean,
): string | null {
  const hit = resolveImageRef(value, notePath === null ? undefined : folderOf(notePath));
  if (hit === null || /^https:\/\//i.test(hit)) return hit;
  if (publishedOnly && !visitorMayFetch(hit)) return null;
  return hit;
}

/** A published note's banner as the client uses it (https URL or allowlisted
 *  attachment path), or null. Exported for the blog head injection (og:image). */
export function publishedBanner(relPath: string): string | null {
  if (!publishedSet.has(relPath)) return null;
  const record = notes.get(relPath);
  return record ? resolveBanner(record) : null;
}

// ----------------------------------------------------------------- templates

/** Folder basenames that MEAN "templates" without a reader having configured
 *  anything: Obsidian's own default, the underscore-prefixed convention, and
 *  the Arabic word an ar-language vault would use.
 *
 *  A LEADING ORDERING PREFIX IS NOT PART OF THE NAME. Real vaults number their
 *  top level — "4 - Templates", "04. Templates", "1_Templates" (Johnny.Decimal
 *  and PARA both do it, and the vault this was measured against is one of
 *  them) — and a matcher that misses those is a matcher that misses the case
 *  it exists for. The prefix is stripped, then the rest must match WHOLE:
 *  "Templates for clients" is a folder of notes about templates, not a folder
 *  of templates, and guessing it would hide real posts from the blog. */
const ORDERING_PREFIX = /^\s*\d+\s*[-._)]*\s*/;
const TEMPLATE_FOLDER_NAMES = /^_?templates?$|^قوالب$/i;

function looksLikeTemplatesFolder(name: string): boolean {
  return TEMPLATE_FOLDER_NAMES.test(name.replace(ORDERING_PREFIX, "").trim());
}

/** The vault's templates folder when it is UNAMBIGUOUS, else null.
 *
 *  Auto-detection exists so the feature works on an imported Obsidian vault
 *  with nothing configured; it must never GUESS. So: every folder holding an
 *  indexed file is a candidate by basename, and the answer is the single
 *  match — or, when several match, the single one at the vault root. Two
 *  plausible folders and no root-level tie-break means null, and the settings
 *  field says which one to pick. A wrong guess here would hide a folder of
 *  real posts from the blog and offer the reader the wrong list of templates,
 *  which is strictly worse than asking. */
/** The last answer, held until the index changes shape (invalidateDerived).
 *  A box rather than a bare string, so "no templates folder" (null) memoizes
 *  as firmly as a hit — the null answer is the common one, and it was the one
 *  paying for the whole walk on every call. */
let templatesFolderMemo: { value: string | null } | null = null;

export function detectTemplatesFolder(): string | null {
  // MEASURED: this walk is O(notes + attachments) and it was being run once
  // PER PUBLISHED POST by isTemplateNote() inside posts(), publicFolderCounts()
  // and trackers() — i.e. O(published × total) on the blog's home endpoint,
  // 854 ms on a 3k-note vault, and eight concurrent anonymous GETs were enough
  // to wedge a single-threaded server. The memo is half the fix; hoisting the
  // lookup out of those three loops (templateMatcher() below) is the other.
  if (templatesFolderMemo !== null) return templatesFolderMemo.value;
  const candidates = new Set<string>();
  const consider = (relPath: string): void => {
    const segments = relPath.split("/");
    // The file's own name is not a folder — stop one short.
    for (let i = 0; i < segments.length - 1; i++) {
      if (looksLikeTemplatesFolder(segments[i])) candidates.add(segments.slice(0, i + 1).join("/"));
    }
  };
  for (const notePath of notes.keys()) consider(notePath);
  for (const attPath of attachmentPaths) consider(attPath);
  const atRoot = [...candidates].filter((p) => !p.includes("/"));
  const value =
    candidates.size === 1 ? [...candidates][0] : atRoot.length === 1 ? atRoot[0] : null;
  templatesFolderMemo = { value };
  return value;
}

// --------------------------------------------------------------- tag pages

/** Folder basenames that MEAN "the tag pages live here". Same shape and same
 *  ordering-prefix rule as the templates matcher above, and shared with it for
 *  the same reason the templates one exists: an imported Obsidian vault names
 *  this folder itself, and a feature that only works once the reader has found
 *  a settings field is a feature nobody finds.
 *
 *  THIS FOLDER IS THE HALF THAT WAS MISSING. Templates auto-detected from the
 *  first day; tag labels shipped with a hard `tags` default beside it, so on
 *  the vault both were measured against — whose folders are "4 - Templates"
 *  and "2 - Tags" — the picker found its templates and every Arabic tag chip
 *  silently rendered its canonical English tag. Two halves of one promise,
 *  disagreeing. */
const TAG_FOLDER_NAMES = /^_?tags?$|^وسوم$|^الوسوم$/i;

function looksLikeTagsFolder(name: string): boolean {
  return TAG_FOLDER_NAMES.test(name.replace(ORDERING_PREFIX, "").trim());
}

/** The vault's tag-pages folder when it is UNAMBIGUOUS, else null. The rule is
 *  `detectTemplatesFolder`'s, deliberately: single match wins, several match
 *  and the single ROOT-level one wins, otherwise null and the settings field
 *  says which. A wrong guess costs less here than it does for templates (a
 *  mislabelled chip, not a hidden post), but "never guess" is cheaper still
 *  and keeps one rule in the reader's head for both fields. */
export function detectTagsFolder(): string | null {
  const candidates = new Set<string>();
  for (const notePath of notes.keys()) {
    const segments = notePath.split("/");
    for (let i = 0; i < segments.length - 1; i++) {
      if (looksLikeTagsFolder(segments[i])) candidates.add(segments.slice(0, i + 1).join("/"));
    }
  }
  if (candidates.size === 1) return [...candidates][0];
  const atRoot = [...candidates].filter((p) => !p.includes("/"));
  return atRoot.length === 1 ? atRoot[0] : null;
}

/** True when `relPath` lives in the templates folder. A template is a stencil,
 *  not a post: it renders as literal `{{date}}` placeholders and duplicates
 *  every real article's structure, so it stays out of the blog's post list
 *  (and therefore out of RSS, the dashboard and the topic pages built from
 *  it) even when its frontmatter carries the `publish: true` it was written to
 *  hand DOWN to the notes made from it. */
export function isTemplateNote(relPath: string): boolean {
  return templateMatcher()(relPath);
}

/** The same question, asked once for a whole loop.
 *
 *  THE POINT IS THE HOIST. `isTemplateNote()` resolves the folder every time
 *  it is asked — settings read, path normalized, containment checked, and
 *  (before the memo above) the whole index walked — and three of this file's
 *  hot loops asked it once per published note. A list is one folder lookup and
 *  N string comparisons; anything else is the audit's 854 ms.
 *
 *  Resolved lazily, never at module-evaluation time: settings.ts imports this
 *  module (through site.ts), so the two are a cycle and only a RUNTIME call is
 *  safe in either direction. The merge rule — stored value over auto-detection
 *  — lives there and is not copied here. */
function templateMatcher(): (relPath: string) => boolean {
  const folder = templatesFolder();
  if (folder === null) return () => false;
  const prefix = `${folder}/`;
  return (relPath) => relPath === folder || relPath.startsWith(prefix);
}

/** Note paths inside the templates folder, sorted — the picker's list. */
export function templateNotes(): string[] {
  const folder = templatesFolder();
  if (folder === null) return [];
  const prefix = `${folder}/`;
  return [...notes.keys()].filter((p) => p.startsWith(prefix)).sort((a, b) => a.localeCompare(b));
}

// ------------------------------------------------------------------- publish

/** Attachment paths embedded/linked by published notes — recomputed on demand
 *  after any index mutation (resolution can shift when files come and go). */
function allowedAttachments(): Set<string> {
  if (allowedAttachmentsCache === null) {
    const allowed = new Set<string>();
    for (const notePath of publishedSet) {
      const record = notes.get(notePath);
      if (!record) continue;
      for (const link of record.links) {
        const resolved = resolveEmbed(link.target, false, null);
        if (resolved && attachmentPaths.has(resolved)) allowed.add(resolved);
      }
      // The other half of the embed syntax. `![alt](Media/x.png)` never went
      // through wikilinkRegex(), so `record.links` cannot see it — and the
      // renderer turns it straight into /api/file?path=Media/x.png. Both
      // OBSIDIAN-COMPAT.md and the README promise the form works on the
      // published site; it failed CLOSED (admin saw the image, visitor saw a
      // placeholder, nothing said why), which is a silent public-site
      // breakage of exactly the invisible-state kind. Path first, then the
      // basename fallback resolveEmbed() gives wikilinks, so a note that
      // moved folders keeps rendering.
      for (const asset of record.assets) {
        if (attachmentPaths.has(asset)) {
          allowed.add(asset);
          continue;
        }
        const byName = resolveEmbed(path.posix.basename(asset), false, null);
        if (byName && attachmentPaths.has(byName)) allowed.add(byName);
      }
      // A published note's banner attachment is visitor-visible too.
      const banner = resolveBanner(record);
      if (banner && attachmentPaths.has(banner)) allowed.add(banner);
      // THE FOURTH ROUTE, and the one that is invisible to every markdown
      // scanner: a ```tracker fence's `cover:`. It is inside a code block, so
      // neither `record.links` nor `record.assets` can hold it, and a shelf
      // published with its art would have shown the owner the covers and the
      // reader a row of holes. Same ladder the embeds take.
      for (const cover of trackerCovers(record)) allowed.add(cover);
    }
    allowedAttachmentsCache = allowed;
  }
  return allowedAttachmentsCache;
}

/** Every attachment ONE note points at, by any of the three routes the
 *  renderer honours. Factored out because two callers need exactly this walk
 *  and they must not drift: `allowedAttachments()` (may a visitor fetch it)
 *  and `attachmentRefs()` (would deleting it break a note). A file the publish
 *  allowlist serves but the delete dialog cannot see is the whole bug. */
function collectAttachmentTargets(record: NoteRecord, add: (att: string) => void): void {
  for (const link of record.links) {
    const resolved = resolveEmbed(link.target, false, null);
    if (resolved && attachmentPaths.has(resolved)) add(resolved);
  }
  // The other half of the embed syntax. `![alt](Media/x.png)` never went
  // through wikilinkRegex(), so `record.links` cannot see it — and the
  // renderer turns it straight into /api/file?path=Media/x.png. Both
  // OBSIDIAN-COMPAT.md and the README promise the form works on the
  // published site; it failed CLOSED (admin saw the image, visitor saw a
  // placeholder, nothing said why), which is a silent public-site
  // breakage of exactly the invisible-state kind. Path first, then the
  // basename fallback resolveEmbed() gives wikilinks, so a note that
  // moved folders keeps rendering.
  for (const asset of record.assets) {
    if (attachmentPaths.has(asset)) {
      add(asset);
      continue;
    }
    const byName = resolveEmbed(path.posix.basename(asset), false, null);
    if (byName && attachmentPaths.has(byName)) add(byName);
  }
  // A note's banner attachment counts too: it is visitor-visible when the note
  // is published, and deleting it blanks the post's header either way.
  const banner = resolveBanner(record);
  if (banner && attachmentPaths.has(banner)) add(banner);
  // And a tracker's cover, by the same argument the banner makes — see the
  // twin of this loop in allowedAttachments(). These two walks must never
  // drift; a file the publish allowlist serves but the delete dialog cannot
  // see is the whole bug this function was factored out to prevent.
  for (const cover of trackerCovers(record)) add(cover);
}

/** The attachment paths a note's ```tracker fences name as covers, resolved.
 *  One implementation, two callers (the allowlist and the reference map), for
 *  the reason collectAttachmentTargets() itself exists. */
function trackerCovers(record: NoteRecord): string[] {
  const out: string[] = [];
  for (const tracker of record.trackers) {
    if (tracker.cover === null) continue;
    // Path first, then the basename fallback resolveEmbed() gives wikilinks —
    // exactly what `assets` does above, so `cover: art.jpg` finds the file
    // wherever the vault keeps its attachments.
    if (attachmentPaths.has(tracker.cover)) {
      out.push(tracker.cover);
      continue;
    }
    const byName = resolveEmbed(path.posix.basename(tracker.cover), false, null);
    if (byName && attachmentPaths.has(byName)) out.push(byName);
  }
  return out;
}

/** attachment path -> the notes that embed or link it. Built lazily over
 *  EVERY note (not just the published ones): the question it answers is
 *  "what breaks if this file goes", and an unpublished note breaking is still
 *  the owner's note breaking. */
function attachmentRefs(): Map<string, Set<string>> {
  if (attachmentRefsCache === null) {
    const map = new Map<string, Set<string>>();
    for (const record of notes.values()) {
      collectAttachmentTargets(record, (att) => {
        let set = map.get(att);
        if (!set) map.set(att, (set = new Set()));
        set.add(record.path);
      });
    }
    attachmentRefsCache = map;
  }
  return attachmentRefsCache;
}

/** The notes that embed or link `attachmentRel`, sorted. Empty for a path no
 *  note points at — and for a note path, which is what `backlinks()` is for.
 *
 *  This is the number every delete dialog in the product was missing. A
 *  folder holding four images and no markdown said "0 notes" and moved on;
 *  the essay one folder over went to the public site with four broken
 *  embeds, and nothing anywhere said a word. */
export function notesReferencing(attachmentRel: string): string[] {
  const set = attachmentRefs().get(attachmentRel);
  return set ? [...set].sort() : [];
}

/** The notes that `[[wikilink]]` a NOTE, sorted — the same question one
 *  object over, so a note delete can name what it is about to orphan.
 *  Cheaper than `backlinks()`: no context line is read. */
export function notesLinkingTo(noteRel: string): string[] {
  const out: string[] = [];
  for (const candidate of linkCandidates(noteRel)) {
    const record = notes.get(candidate);
    if (record === undefined) continue;
    if (record.links.some((link) => resolveLink(link.target, false, null) === noteRel)) out.push(record.path);
  }
  return out.sort();
}

/** Every note carrying `tag` OR a tag nested under it, sorted.
 *
 *  The candidate list for a tag rename, and deliberately WIDER than what the
 *  rewrite will change: the index reads `#define` inside a shell fence as a tag
 *  (tests/tags.test.ts pins that known over-count) while `server/tagRewrite.ts`
 *  refuses to edit code, so a file can arrive here and contribute nothing. That
 *  asymmetry is the right one — the cheap in-memory scan proposes, the surgeon
 *  disposes, and the number the dialog prints comes from the surgeon.
 *
 *  Nested tags come along because a tag hierarchy is one name with slashes in
 *  it: renaming `zettel` and leaving `zettel/seed` behind is the failure every
 *  Obsidian thread about this feature complains of. */
export function notesWithTag(tag: string): string[] {
  const root = tag.trim().replace(/^#/, "").toLowerCase();
  if (root === "") return [];
  const prefix = `${root}/`;
  const out: string[] = [];
  for (const record of notes.values()) {
    if (record.tags.some((t) => t === root || t.startsWith(prefix))) out.push(record.path);
  }
  return out.sort();
}

export function isNotePublished(relPath: string): boolean {
  return publishedSet.has(relPath);
}

export function isAllowedAttachment(relPath: string): boolean {
  return allowedAttachments().has(relPath);
}

/** Published notes as { path, title }, unsorted. */
/** The visitor sidebar's flat note list. This is a discovery surface like any
 *  other, so the languageFilter applies: leaving it unfiltered would list the
 *  titles and paths of notes every other public surface is hiding. */
export function publishedNotes(lang: FilterLang): { path: string; title: string }[] {
  const out: { path: string; title: string }[] = [];
  for (const notePath of publishedSet) {
    const record = notes.get(notePath);
    if (record && !languageHidden(record, lang)) out.push({ path: record.path, title: record.title });
  }
  return out;
}

/** The visitor-visible notes currently indexed under a folder — what a
 *  `{kind:"deleted", dir:true}` event is about to take away from the public
 *  collection. Sampled synchronously by the SSE visitor filter, before the
 *  chained reindex tears the records down. Hidden and unpublished notes are
 *  never named, so fanning a folder delete out through this leaks nothing the
 *  visitor could not already enumerate from /api/tree. */
export function visibleNotesUnder(relFolder: string, lang: FilterLang): string[] {
  const prefix = `${relFolder}/`;
  const out: string[] = [];
  for (const notePath of publishedSet) {
    if (notePath.startsWith(prefix) && isNoteVisibleToVisitor(notePath, lang)) out.push(notePath);
  }
  return out.sort();
}

/** Every published note path — the ADMIN's view of publish state, and the
 *  only one that is not a visitor surface. `publishedNotes()` above applies
 *  the languageFilter because it feeds the visitor's sidebar; this one must
 *  not, or the owner's own publish marks inherit a rule written for strangers
 *  and a published-but-hidden note reads as unpublished in the editor that
 *  published it. Sorted, so the answer is stable across reindexes. */
export function publishedPaths(): string[] {
  return [...publishedSet].sort();
}

export function publishedCounts(): { notes: number; total: number } {
  return { notes: publishedSet.size, total: notes.size };
}

// --------------------------------------------------------------- attachments

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i;

/** All indexed image attachments, sorted — the admin banner picker's list. */
export function listImageAttachments(): string[] {
  return [...attachmentPaths].filter((p) => IMAGE_EXT_RE.test(p)).sort((a, b) => a.localeCompare(b));
}

/** Register a just-written attachment immediately (uploads must show up in
 *  the picker / resolve as banners before the watcher debounce lands). */
export function registerAttachment(relPath: string): void {
  addAttachment(relPath);
}

// `attachmentsUnder`, `notesUnder`, `attachmentReferrers` and
// `attachmentUsage` stood between here and the title helper below. They served
// `GET /api/impact`, which asked what a delete would really take — and that
// question is now `deletePreview()`'s, which walks the same files
// `deleteFolder()` will actually move (`listVaultFiles`) and reads references
// through `notesReferencing()`. Keeping a second, differently-derived answer
// beside it is how two dialogs come to describe one delete differently.

/** A note's display title (sanitized, as every other surface shows it), or
 *  its basename when the note is not indexed. */
export function noteTitle(relPath: string): string {
  return notes.get(relPath)?.title ?? path.posix.basename(relPath, ".md");
}

// --------------------------------------------------------------------- posts

const EXCERPT_MAX = 220;
/** A paragraph is "real" prose once it carries this many letters — template
 *  furniture like a bare "2026-03-07 19:28" timestamp or a "Tags: a b" label
 *  line falls short and is skipped (kept only as a last-resort fallback). */
const EXCERPT_MIN_LETTERS = 30;
const EXCERPT_MAX_PARAGRAPHS = 40;

/** True for metadata-ish furniture lines common in note templates: a bare
 *  timestamp, or a short "Label:" line whose content is only #tags ("Status:
 *  #draft", "Tags: #a #b"). Once #tags and one short leading label are
 *  removed, no letters remain — real prose always keeps some. */
function isFurnitureLine(raw: string): boolean {
  const noTags = raw.trim().replace(/(?:^|[\s(])#[\p{L}\p{N}_][\p{L}\p{N}_/-]*/gu, " ");
  const rest = noTags.replace(/^[\p{L} ]{1,24}:\s*/u, "");
  return (rest.match(/\p{L}/gu) ?? []).length === 0;
}

/** First real paragraph of a note body as prose: headings, images, tables,
 *  fences and math never count; consecutive prose lines are joined
 *  (hard-wrapped sources) until a blank/heading/table/fence ends a paragraph.
 *  The first paragraph with EXCERPT_MIN_LETTERS of actual letters wins;
 *  when nothing qualifies, the first letter-bearing (then any) paragraph. */
function firstParagraph(body: string): string {
  const fences = new FenceSkipper();
  let parts: string[] = [];
  let len = 0;
  let paragraphs = 0;
  let fallback = ""; // best sub-threshold paragraph seen (furniture never lands here)
  // Close the open paragraph: return it when it is real prose, else file it
  // as a fallback and return null so the scan continues.
  const finish = (): string | null => {
    if (parts.length === 0) return null;
    const para = parts.join(" ").replace(/\s+/g, " ").trim();
    parts = [];
    len = 0;
    if (!para) return null;
    paragraphs++;
    const letters = (para.match(/\p{L}/gu) ?? []).length;
    if (letters >= EXCERPT_MIN_LETTERS) return para;
    if (!fallback) fallback = para;
    return null;
  };
  for (const raw of body.split("\n")) {
    const boundary =
      fences.skip(raw) ||
      /^\s{0,3}#{1,6}\s+/.test(raw) ||
      /^\s*\|/.test(raw) ||
      !raw.trim() ||
      isFurnitureLine(raw);
    const line = boundary ? "" : proseLine(raw);
    if (!line) {
      // Boundary or furniture-only line (bare image/embed): paragraph ends.
      const done = finish();
      if (done) return done;
      if (paragraphs >= EXCERPT_MAX_PARAGRAPHS) break;
      continue;
    }
    parts.push(line);
    len += line.length + 1;
    if (len > EXCERPT_MAX * 3) break; // enough source for any excerpt
  }
  return finish() ?? fallback;
}

/** ~220-char excerpt cut on a word boundary, "…" marking a real cut.
 *  Single-char emphasis (*em*, _em_) is stripped here too — excerpts are
 *  plain text, unlike search snippets which keep the historical behavior. */
function excerptOf(body: string): string {
  return cutExcerpt(
    firstParagraph(body)
      .replace(/(^|[\s([{])\*([^*\n]+)\*(?=[\s)\]}.,;:!?…]|$)/g, "$1$2")
      .replace(/(^|[\s([{])_([^_\n]+)_(?=[\s)\]}.,;:!?…]|$)/g, "$1$2"),
  );
}

/** Cut an already-plain paragraph to EXCERPT_MAX on a word boundary. Shared by
 *  both formats: markdown reaches it through firstParagraph(), LaTeX through
 *  the abstract-or-first-paragraph the parser hands over. */
function cutExcerpt(para: string): string {
  if (para.length <= EXCERPT_MAX) return para;
  let cut = para.slice(0, EXCERPT_MAX + 1);
  const space = cut.lastIndexOf(" ");
  cut = space > EXCERPT_MAX / 2 ? cut.slice(0, space) : cut.slice(0, EXCERPT_MAX);
  return `${cut.replace(/[\s,;:.!?…·—–-]+$/, "")}…`;
}

/** What a post whose body is only a fence says for itself.
 *
 *  A shelf note — one ```tracker fence per thing, or one ```tracker-board —
 *  has no prose at all, so `firstParagraph()` correctly finds nothing and the
 *  card, the dashboard, RSS and og:description all got a post with a title, a
 *  date and a hole where the sentence goes. The fence IS the content; this
 *  says what is in it.
 *
 *  TWO DECISIONS AT THIS SEAM.
 *
 *  1. It is computed HERE rather than folded into `record.post`, which is
 *     memoized until the note is reindexed. The sentence depends on the site's
 *     language, which is a settings row an owner can change at runtime — a
 *     cached one would keep answering in the old language until every shelf
 *     note happened to be saved again.
 *  2. It is written on the SERVER, in both languages, rather than left to the
 *     client's i18n. An excerpt is not chrome: the same string goes into RSS
 *     and into the og:description a stranger's chat app renders, where there
 *     is no client to translate it. `footerLine()` (server/site.ts) already
 *     writes visitor prose this way, off the same setting, for the same
 *     reason. Numerals go through the one policy (shared/numerals.ts), so the
 *     count matches every other number on the card. */
function fenceSummary(record: NoteRecord): string {
  const locale = blogLocale();
  const arabic = /^ar\b/i.test(locale);
  const count = record.trackers.length;
  if (count > 0) {
    const n = toNumerals(String(count), numeralSystem(locale));
    if (arabic) return count === 1 ? "رفّ فيه متتبِّع واحد." : `رفّ فيه ${n} من المتتبِّعات.`;
    return count === 1 ? "A shelf of one tracker." : `A shelf of ${n} trackers.`;
  }
  // A board is a QUERY over the vault's trackers, so it carries none of its
  // own — the note is a shelf of everything. Same sentence the palette uses
  // for the command that inserts it (i18n `slashTrackerBoardDetail`).
  for (const raw of record.body.split("\n")) {
    if (raw.trim() === "") continue;
    if (!/^\s*(?:```|~~~)\s*tracker-board\b/.test(raw)) break;
    return arabic ? "رفّ بكل المتتبّعات في الخزانة." : "A shelf of every tracker in the vault.";
  }
  return "";
}

/** `hidden` is the visitor's EXCLUDE_TAGS set, passed IN rather than fetched.
 *  `excludedTags()` builds a fresh Set out of settings on every call, and this
 *  function is called once per published post — the same "resolve a
 *  configuration value inside the loop that iterates the vault" shape as the
 *  templates walk two screens up, one loop over. */
function postMeta(record: NoteRecord, hidden: ReadonlySet<string>): PostMeta {
  if (record.post === null) {
    const flat = flatBody(record);
    record.post = {
      // LaTeX: the abstract when the paper has one, else its first real
      // paragraph — both already plain prose, so the markdown paragraph
      // walker (which reads `#`, `|`, fences and `$$`) never sees TeX.
      excerpt: record.prose !== null ? cutExcerpt(record.excerptSource ?? "") : excerptOf(record.body),
      // Counted from the WHOLE note, not from `flat` — which is capped at
      // MAX_SNIPPET_SOURCE_CHARS because snippets do not need more, and which
      // therefore under-counted every note past 128 KiB and told its readers a
      // reading time for a document that stops two thirds of the way through.
      // `countNoteWords` is the same function the author's status bar uses, so
      // the number on the published article is the number they were shown while
      // writing it. A `.tex` note's prose is already extracted and needs no
      // stripping.
      words:
        record.prose !== null ? countWords(record.prose) : countNoteWords(record.body),
    };
  }
  const meta: PostMeta = {
    path: record.path,
    title: record.title,
    date: new Date(record.dateMs).toISOString(),
    // A body that is only a fence has no paragraph to cut; say what the fence
    // holds rather than shipping an empty slot. See fenceSummary().
    excerpt: record.post.excerpt !== "" ? record.post.excerpt : fenceSummary(record),
    words: record.post.words,
    readingMinutes: readingMinutes(record.post.words),
    tags: record.tags.filter((t) => !hidden.has(t.toLowerCase())),
  };
  // Assigned only when non-empty, like every other optional field on this
  // shape: almost no note names a folder, and an empty array on every post
  // would be bytes on the wire saying nothing.
  if (record.folders.length > 0) meta.folders = [...record.folders];
  const banner = resolveBanner(record);
  if (banner) meta.banner = banner;
  return meta;
}

/** How many posts THIS session can see in each public folder — slug → count.
 *
 *  Scoped exactly like posts(): published only, templates out, the
 *  languageFilter applied for visitors. It has to be, because the number on a
 *  folder card is a promise about the page behind it — a card saying "9" that
 *  opens onto 2 posts is the language filter leaking a count of notes the
 *  reader may not have. Only the slugs asked for are counted, so a note
 *  claiming a folder nobody declared adds nothing anywhere. */
export function publicFolderCounts(
  slugs: readonly string[],
  visitor: boolean,
  lang: FilterLang,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slug of slugs) counts.set(slug, 0);
  if (counts.size === 0) return counts;
  const isTemplate = templateMatcher(); // once for the loop — see templateMatcher()
  for (const notePath of publishedSet) {
    const record = notes.get(notePath);
    if (!record || record.folders.length === 0) continue;
    if (visitor && languageHidden(record, lang)) continue;
    if (isTemplate(notePath)) continue;
    for (const slug of record.folders) {
      const current = counts.get(slug);
      if (current !== undefined) counts.set(slug, current + 1);
    }
  }
  return counts;
}

/** Published notes as blog posts, newest first (visitor-safe: published only,
 *  EXCLUDE_TAGS filtered). Per-note fields are cached on the index record and
 *  refresh incrementally as notes reindex. `visitor` additionally applies the
 *  languageFilter (public lists only — admin surfaces are never filtered). */
export function posts(visitor: boolean, lang: FilterLang, excludePages = false): PostMeta[] {
  const out: { dateMs: number; meta: PostMeta }[] = [];
  const isTemplate = templateMatcher(); // once for the loop — see templateMatcher()
  const hidden = excludedTags(); // likewise: one Set for the list, not one per post
  for (const notePath of publishedSet) {
    const record = notes.get(notePath);
    if (!record) continue;
    if (visitor && languageHidden(record, lang)) continue;
    // A template is not a post — in EITHER list. The admin's post list is the
    // one that answers "what is on my blog", so a stencil sitting in it is the
    // same lie there as on the public page.
    if (isTemplate(notePath)) continue;
    // Static pages (frontmatter `page: true`) are part of the site, not of
    // the feed. The caller decides — `excludePages` is false everywhere the
    // stock blog calls this, so its lists are exactly what they always were;
    // designed mode passes staticPagesActive() (server/pages.ts).
    if (excludePages && record.page) continue;
    out.push({ dateMs: record.dateMs, meta: postMeta(record, hidden) });
  }
  return out
    .sort((a, b) => b.dateMs - a.dateMs || a.meta.path.localeCompare(b.meta.path))
    .map((entry) => entry.meta);
}

/** Published STATIC PAGES (frontmatter `page: true`), alphabetical by title —
 *  the list the navigation builder offers and the designed shell routes.
 *  `visitor` applies the languageFilter, exactly as posts() does, so a page
 *  the filter curates away is never named to an anonymous caller. */
export function pages(visitor: boolean, lang: FilterLang): PageMeta[] {
  const out: PageMeta[] = [];
  for (const notePath of publishedSet) {
    const record = notes.get(notePath);
    if (!record || !record.page) continue;
    if (visitor && languageHidden(record, lang)) continue;
    out.push({ path: record.path, title: record.title });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title) || a.path.localeCompare(b.path));
}

/** Every ```tracker fence this session may see, newest-touched first.
 *
 *  The scope is posts()' scope, deliberately and line for line: a visitor gets
 *  the published set with the language filter applied, an admin gets the whole
 *  vault unfiltered, and TEMPLATES ARE OUT of both. That last one is not a
 *  detail — a template carrying a tracker skeleton would show up on the shelf
 *  as a book you are 0% through, in the admin's own list as much as the
 *  public one, which is the same lie posts() refuses to tell about a stencil.
 *
 *  The cover is resolved HERE, through the ladder embeds use, so the board
 *  spends no /api/resolve per card — and it is resolved against the SESSION's
 *  scope, so a visitor is never handed a path they would be 404'd for. */
export function trackers(visitor: boolean, lang: FilterLang): TrackerMeta[] {
  const out: TrackerMeta[] = [];
  const paths = visitor ? publishedSet : notes.keys();
  const isTemplate = templateMatcher(); // once for the loop — see templateMatcher()
  for (const notePath of paths) {
    const record = notes.get(notePath);
    if (!record || record.trackers.length === 0) continue;
    if (visitor && languageHidden(record, lang)) continue;
    if (isTemplate(notePath)) continue;
    for (const tracker of record.trackers) {
      out.push({
        path: record.path,
        title: tracker.title,
        noteTitle: record.title,
        kind: tracker.kind,
        icon: tracker.icon,
        percent: tracker.percent,
        done: tracker.done,
        total: tracker.total,
        unit: tracker.unit,
        status: tracker.status,
        rating: tracker.rating,
        cover: tracker.cover === null ? null : resolveEmbed(tracker.cover, visitor, lang),
        updatedMs: record.mtimeMs,
      });
    }
  }
  return out.sort(
    (a, b) => b.updatedMs - a.updatedMs || a.path.localeCompare(b.path) || a.title.localeCompare(b.title),
  );
}

/** True when this note is a published static page — the designed shell's
 *  router asks before choosing the page layout over the article layout. */
export function isStaticPage(relPath: string): boolean {
  return notes.get(relPath)?.page === true;
}

/** How a caller lets the operator layer speak the reader's own vocabulary.
 *  `tag:برمجيات` has to reach `#software` for the same reason `/topic/برمجيات`
 *  does — a reader copies the word off the chip in front of them — and the
 *  labels live in `server/tagLabels.ts`, which imports THIS module. So the
 *  resolver is handed in rather than imported, and the cycle never forms. */
export interface SearchOptions {
  canonicalTag?: (value: string) => string | null;
  /** The free-TEXT half of the same favour: `expandTagQuery` appends a
   *  canonical tag whenever the words hold one of its localised labels. It is
   *  applied after the operators are peeled off, never before — run over the
   *  raw string it reads `tag:برمجيات` as prose and appends `software` as a
   *  loose term, widening the very query the operator was narrowing. */
  expandTerms?: (text: string) => string;
}

/** Turn the parsed operators into one predicate over records.
 *
 *  Everything expensive happens HERE, once per query, not once per note: a
 *  `linkto:` filter resolves its target and materialises the candidate set
 *  from the reverse index before the walk starts, so a link operator over a
 *  three-thousand-note vault is a set membership test rather than forty
 *  thousand `resolveLink` calls. A filter naming a note that does not exist
 *  compiles to "match nothing", which is the honest answer — `linkto:Ghost` is
 *  a question with no results, not a question to ignore. */
function compileFilters(
  filters: readonly QueryFilter[],
  publishedOnly: boolean,
  lang: FilterLang,
  opts: SearchOptions,
): ((record: NoteRecord) => boolean) | null {
  if (filters.length === 0) return null;
  const tests: ((record: NoteRecord) => boolean)[] = [];
  for (const filter of filters) {
    let test: (record: NoteRecord) => boolean;
    switch (filter.kind) {
      case "tag": {
        // Nested tags are a tree: `tag:zettel` means the topic and everything
        // filed under it, exactly as the sidebar's own tag filter reads it.
        const want = opts.canonicalTag?.(filter.value) ?? filter.value;
        const prefix = `${want}/`;
        test = (r) => r.tags.some((tag) => tag === want || tag.startsWith(prefix));
        break;
      }
      case "path":
        // Substring, not prefix: `path:recipes` finds `Cooking/Recipes/Dal.md`
        // as readily as `Recipes/Dal.md`, and a reader who wants the anchor
        // types the leading folder.
        test = (r) => r.path.toLowerCase().includes(filter.value);
        break;
      case "is":
        test = filter.value === "published" ? (r) => r.published : (r) => r.page;
        break;
      case "before":
        test = (r) => r.dateMs < filter.ms;
        break;
      case "after":
        // Inclusive from the start of the named day, while `before` is
        // exclusive of it — so `after:2024 before:2025` is exactly 2024.
        test = (r) => r.dateMs >= filter.ms;
        break;
      case "linkto": {
        const target = resolveLink(filter.value, publishedOnly, lang);
        if (target === null) {
          test = () => false;
          break;
        }
        const sources = new Set(
          linkCandidates(target).filter((candidate) => {
            const record = notes.get(candidate);
            return (
              record !== undefined &&
              record.links.some((l) => resolveLink(l.target, publishedOnly, lang) === target)
            );
          }),
        );
        test = (r) => sources.has(r.path);
        break;
      }
      case "linkfrom": {
        const source = resolveLink(filter.value, publishedOnly, lang);
        const record = source === null ? undefined : notes.get(source);
        const targets = new Set<string>();
        for (const link of record?.links ?? []) {
          const to = resolveLink(link.target, publishedOnly, lang);
          if (to !== null) targets.add(to);
        }
        test = (r) => targets.has(r.path);
        break;
      }
    }
    tests.push(filter.negated ? (r) => !test(r) : test);
  }
  return (record) => tests.every((t) => t(record));
}

export function search(
  query: string,
  publishedOnly: boolean,
  lang: FilterLang,
  opts: SearchOptions = {},
): SearchHit[] {
  // OPERATORS FIRST, words second (server/searchQuery.ts). What is left after
  // the operators are peeled off is what minisearch is asked — and when
  // NOTHING is left, the filters alone are the query: `tag:recipes` on its own
  // must list every recipe, which is the most obvious thing anybody will type
  // and the one shape a term index cannot answer.
  const parsed = parseSearchQuery(query);
  const keep = compileFilters(parsed.filters, publishedOnly, lang, opts);
  const bare = parsed.text.trim();
  if (!bare) return keep === null ? [] : filteredNotes(keep, publishedOnly, lang);
  const q = (opts.expandTerms?.(bare) ?? bare).trim();
  // The EXPANDED string is what minisearch is asked; the string the reader
  // actually typed is what the exact-name tiers below are measured against. An
  // appended canonical tag is a widening for the term index and a lie to
  // "is this note titled exactly what I typed".
  const qLower = bare.toLowerCase();

  // Rank tiers on top of minisearch's relevance score: a note TITLED what you
  // typed always beats a note that merely mentions it, and a title that starts
  // with the query beats a content-only match. Within a tier, minisearch's
  // order (score) is kept.
  //
  // The comparison is FOLDED, like the index it is re-ranking. A note titled
  // «الْمُقَدِّمَة» is now found by a query for «المقدمة» — and would then have
  // been sorted into the "merely mentions it" tier, under every note whose
  // unpointed title matched literally, which is the same bug one rung up.
  const qFold = foldTerm(qLower);
  const tierOf = (title: string): number => {
    const t = foldTerm(title.toLowerCase());
    if (t === qFold) return 0;
    if (t.startsWith(qFold)) return 1;
    return 2;
  };

  // Visitor scoping: published notes only, minus language-filtered ones
  // (the filter must not leak filtered-out note existence through search).
  const visitorHidden = (p: string): boolean => {
    if (!publishedSet.has(p)) return true;
    const record = notes.get(p);
    return record !== undefined && languageHidden(record, lang);
  };
  let results = mini.search(q);
  if (publishedOnly) results = results.filter((r) => !visitorHidden(String(r.id)));
  if (keep !== null) {
    results = results.filter((r) => {
      const record = notes.get(String(r.id));
      return record !== undefined && keep(record);
    });
  }
  const seen = new Set(results.map((r) => String(r.id)));
  const ranked = results
    .map((result, order) => {
      const id = String(result.id);
      const record = notes.get(id);
      const title = record?.title ?? noteTitleOf(id);
      return { result, record, id, title, tier: tierOf(title), order };
    })
    .sort((a, b) => a.tier - b.tier || a.order - b.order);

  const hits: SearchHit[] = ranked.slice(0, 50).map(({ result, record, id, title }) => ({
    path: id,
    title,
    snippet: record ? makeSnippet(record, Object.keys(result.match)) : "",
    score: result.score,
    ...(record ? aliasReason(record, result.match, qLower) : {}),
  }));

  // Exact-name short-circuit: if a note titled exactly `q` exists but
  // minisearch left it out (tokenizer/fuzzy quirks), force it in at #1.
  //
  // The alias table gets the same treatment one rung down, and needs it more:
  // an alias is routinely a word the note's own text never contains — "ML" on a
  // note that only ever writes "machine learning" — so there is no body match
  // for minisearch to rank, and the note the reader is searching FOR by the
  // name they gave it would come back below notes that merely mention it.
  const forcedFrom = (table: Map<string, Set<string>>): string[] =>
    [...(table.get(qLower) ?? [])]
      .filter((p) => {
        if (seen.has(p) || (publishedOnly && visitorHidden(p))) return false;
        // The short-circuit is a RANK boost, never a bypass: a note forced to
        // the top past an operator the reader typed would be the filter
        // failing in the one row they are most likely to click.
        const record = notes.get(p);
        return keep === null || (record !== undefined && keep(record));
      })
      .sort((a, b) => a.localeCompare(b));
  const exactPaths = forcedFrom(byName);
  const aliasPaths = forcedFrom(byAlias).filter((p) => !exactPaths.includes(p));
  if (exactPaths.length > 0 || aliasPaths.length > 0) {
    const topScore = (hits[0]?.score ?? 0) + 1;
    const force = (paths: string[], score: number, fromAliasTable: boolean): SearchHit[] =>
      paths.flatMap<SearchHit>((p) => {
        const record = notes.get(p);
        if (!record) return [];
        const alias = fromAliasTable
          ? record.aliases.find((a) => a.toLowerCase() === qLower)
          : undefined;
        return [{
          path: p,
          title: record.title,
          snippet: makeSnippet(record, [bare]),
          score,
          ...(alias === undefined ? {} : { alias: stripBidiControls(alias) }),
        }];
      });
    // Named exactly beats aliased exactly, for the same reason resolveLink
    // ranks them that way: a filename is the note's own name.
    hits.unshift(...force(exactPaths, topScore + 1, false), ...force(aliasPaths, topScore, true));
    hits.length = Math.min(hits.length, 50);
  }
  return hits;
}

/** THE CANDIDATE SET FOR A VAULT-WIDE REPLACE: every note whose body holds the
 *  needle, narrowed by whatever operators the reader typed into the same box.
 *
 *  Deliberately NOT `search()`. That one ranks, fuzzes, folds and caps at
 *  fifty — every one of which is right for a reader looking at a list and
 *  wrong for a rewrite, where "the top fifty of what might be four hundred" is
 *  the worst possible answer. This walks the whole index, applies the filters
 *  exactly, and tests the needle exactly (server/searchReplace.ts owns the
 *  test, so it is the same matcher the preview and the write will use).
 *
 *  Admin-only by construction: the route is, and nothing here takes a visitor
 *  scope, because there is no such thing as a visitor's replace. */
export function replaceCandidates(
  query: string,
  bodyHolds: (body: string) => boolean,
  opts: SearchOptions = {},
): string[] {
  const parsed = parseSearchQuery(query);
  const keep = compileFilters(parsed.filters, false, null, opts);
  const out: string[] = [];
  for (const record of notes.values()) {
    if (keep !== null && !keep(record)) continue;
    if (!bodyHolds(record.body)) continue;
    out.push(record.path);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** A query made ENTIRELY of operators — `tag:recipes`, `is:published
 *  after:2024`, `linkto:"Machine Learning"`.
 *
 *  There are no terms to rank, so the order is the vault's own: most recently
 *  written first, which is what every other list of notes in this product
 *  agrees on. The snippet is the note's opening rather than a match window,
 *  because nothing was matched — quoting a line back and marking nothing in it
 *  would suggest the words are in there somewhere. Same cap as a term search:
 *  fifty rows is a sidebar, not a report. */
function filteredNotes(
  keep: (record: NoteRecord) => boolean,
  publishedOnly: boolean,
  lang: FilterLang,
): SearchHit[] {
  const out: { record: NoteRecord }[] = [];
  for (const record of notes.values()) {
    if (publishedOnly && (!record.published || languageHidden(record, lang))) continue;
    if (!keep(record)) continue;
    out.push({ record });
  }
  out.sort(
    (a, b) => b.record.dateMs - a.record.dateMs || a.record.path.localeCompare(b.record.path),
  );
  return out.slice(0, 50).map(({ record }, i) => ({
    path: record.path,
    title: record.title,
    snippet: makeSnippet(record, []),
    // Descending, so a client that sorts by score keeps the order chosen here.
    score: out.length - i,
  }));
}

/** WHY this hit appeared, when the answer is "one of its other names".
 *
 *  Obsidian resolves and searches aliases silently: two notes claiming `ML` and
 *  the reader is never told which one they are looking at, or that an alias was
 *  involved at all. Naming the alias in the result row is the cheap half of
 *  that fix (the deterministic tie rule is the other half).
 *
 *  Nothing is said when the TITLE matched too — the reader can already see why
 *  that row is there, and a redundant caption on every result is noise. */
function aliasReason(
  record: NoteRecord,
  match: Record<string, string[]>,
  qLower: string,
): { alias?: string } {
  if (record.aliases.length === 0) return {};
  if (Object.values(match).some((fields) => fields.includes("title"))) return {};
  const terms = Object.entries(match)
    .filter(([, fields]) => fields.includes("aliases"))
    .map(([term]) => term);
  if (terms.length === 0) return {};
  const hit =
    record.aliases.find((a) => a.toLowerCase() === qLower) ??
    record.aliases.find((a) => terms.some((term) => a.toLowerCase().includes(term)));
  return hit === undefined ? {} : { alias: stripBidiControls(hit) };
}

export function graph(publishedOnly: boolean, lang: FilterLang): GraphData {
  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  const degree = new Map<string, number>();
  // Visitor graphs honor the languageFilter on both endpoints — a filtered
  // note must appear neither as a node nor via an edge.
  const hidden = (record: NoteRecord): boolean => publishedOnly && languageHidden(record, lang);
  for (const record of notes.values()) {
    if (publishedOnly && !record.published) continue;
    if (hidden(record)) continue;
    const connect = (target: string | null): void => {
      if (!target || target === record.path) return;
      const targetRecord = notes.get(target);
      if (targetRecord !== undefined && hidden(targetRecord)) return;
      const key = `${record.path}\0${target}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({ source: record.path, target });
      degree.set(record.path, (degree.get(record.path) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    };
    for (const link of record.links) connect(resolveLink(link.target, publishedOnly, lang));
    // …and LaTeX's own vocabulary. THIS is what makes an existing project,
    // dropped into a vault unmodified, light up the graph: a `\cite` whose key
    // some note carries and a `\ref` whose label some note defines are edges,
    // and nothing in either document had to be rewritten to say so.
    for (const xref of record.xrefs) connect(resolveXref(xref, publishedOnly, lang));
  }
  const nodes = [...notes.values()]
    .filter((record) => (!publishedOnly || record.published) && !hidden(record))
    .map((record) => ({
      id: record.path,
      title: record.title,
      links: degree.get(record.path) ?? 0,
      // Visitors group the sidebar by these tags — honor EXCLUDE_TAGS so
      // workflow/status tags never become published topic headings.
      tags: publishedOnly ? record.tags.filter((t) => !excludedTags().has(t.toLowerCase())) : record.tags,
    }));
  return { nodes, edges };
}

export function backlinks(targetPath: string, publishedOnly: boolean, lang: FilterLang): Backlink[] {
  const hits: Backlink[] = [];
  // The TARGET has to pass the visitor filter too, not just the sources: a
  // language-hidden note that answered with backlinks confirmed to an
  // anonymous caller that it exists and is published. (resolveLink() now
  // refuses to resolve to it as well, so this is belt and braces — but it is
  // the check the reader of this function expects to find.)
  if (publishedOnly && !isNoteVisibleToVisitor(targetPath, lang)) return hits;
  const seen = new Set<string>();
  // The reverse index decides WHO to look at; resolveLink() below still decides
  // whether each link actually lands here. On the 1,388-note fixture this turns
  // 40,000 resolutions per panel open into a few dozen.
  for (const candidate of linkCandidates(targetPath)) {
    const record = notes.get(candidate);
    if (record === undefined) continue;
    if (publishedOnly && (!record.published || languageHidden(record, lang))) continue;
    let bodyLines: string[] | null = null; // split lazily, once per record
    for (const link of record.links) {
      if (resolveLink(link.target, publishedOnly, lang) !== targetPath) continue;
      const key = `${record.path}\0${link.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Strip block prefixes + inline marks but keep [[wikilinks]] — the
      // client renders those as gold spans. Long lines are cut to a
      // word-boundary window centered on the link; "…" marks only real
      // elisions (a cut, or a line that starts mid-sentence).
      // A `.tex` link arrives with its context already extracted as PROSE
      // (shared/tex.ts hands over the paragraph's text, never its source), so
      // the markdown line cleaner — which strips `#`, `>` and table pipes —
      // has nothing to do and the widening below would read raw TeX lines.
      // The needle is the link itself: inside a table row, the cell holding
      // this link is the cell the card is about (see cleanContextLine).
      const needle = [`[[${link.target.toLowerCase()}`];
      let context = record.prose !== null ? link.line : cleanContextLine(link.line, needle);
      // A line that is little more than the link itself ("- [[History]]")
      // makes a useless card — widen to the surrounding lines so the card
      // reads like Obsidian's backlink context.
      // A short line widens into its neighbours so "- [[History]]" reads as a
      // sentence. A TABLE CELL never does: its neighbours are the next row and
      // the header, and gluing those on is the cell-join of F44 wearing the
      // other coat — "Reading table Title worth a reread, see [[Target]]
      // Piranesi". The cell is already the chosen unit.
      const inTable = /^\s*\|/.test(link.line);
      if (record.prose === null && !inTable && contextProse(context).length < 16) {
        bodyLines ??= record.body.split("\n");
        context = expandedContext(bodyLines, link.lineIdx, needle);
      }
      if (context.length > BACKLINK_CONTEXT_MAX) {
        // Center the window on THIS link when it can be found, else on the
        // first wikilink in the context.
        const at = context.toLowerCase().indexOf(`[[${link.target.toLowerCase()}`);
        const first = at === -1 ? /\[\[[^[\]]*\]\]/.exec(context) : null;
        context = windowAround(
          context,
          at !== -1 ? at : (first?.index ?? 0),
          at !== -1 ? link.target.length + 4 : (first?.[0].length ?? 0),
          BACKLINK_CONTEXT_RADIUS,
        );
        // Never leave a sliced half-wikilink at either edge.
        context = context
          .replace(/^…?[^[\]]*\]\]\s*/, "…")
          .replace(/\s*\[\[(?:(?!\]\]).)*$/, "…");
      }
      // Consistent ellipsis: mark a mid-sentence start and a mid-sentence
      // end (hard-wrapped source lines) the same way real cuts are marked.
      if (!context.startsWith("…") && /^\p{Ll}/u.test(context)) {
        context = `…${context}`;
      }
      if (!context.endsWith("…") && !/[.!?…]["')\]]*$/.test(context)) {
        context = `${context}…`;
      }
      hits.push({
        path: record.path,
        title: record.title,
        context,
        line: fileLine(record, link.lineIdx),
      });
    }
    // A `\cite` or a cross-note `\ref` is a backlink like any other — the
    // panel is where a note learns who leans on it, and a paper that cites this
    // note by its citekey leans on it exactly as a `[[wikilink]]` does.
    for (const xref of record.xrefs) {
      if (resolveXref(xref, publishedOnly, lang) !== targetPath) continue;
      const key = `${record.path}\0${xref.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        path: record.path,
        title: record.title,
        context: xref.line,
        line: fileLine(record, xref.lineIdx),
      });
    }
  }
  return hits.sort((a, b) => a.path.localeCompare(b.path));
}

/** A body-relative `lineIdx` as the 1-based line of the FULL file — the only
 *  coordinate the editor (and the wire, by contract) counts in. Parsing runs
 *  on `body`, which lost the frontmatter block, and shipping the body-relative
 *  number was exactly the bug this exists to prevent: every landing would sit
 *  N lines above the mention, where N is the size of the properties block. */
function fileLine(record: NoteRecord, lineIdx: number): number {
  return record.bodyStartLine + lineIdx + 1;
}

/** How many matched lines /api/search/matches will list for one note. A
 *  search hit needs "where, exactly" — not a concordance. Past a hundred the
 *  reader is no longer picking a line, they are re-reading the note, and the
 *  note itself is one click away. */
const SEARCH_MATCHES_MAX = 100;

/** Only this much of one line is quoted (window centered on the first match
 *  beyond it) — a match inside a 4,000-character hard-wrapped paragraph must
 *  not ship the paragraph. */
const SEARCH_MATCH_LINE_MAX = 200;

/** Every line of one note that a search query matches — the expansion under a
 *  search hit, so a click can land on the line rather than on the note.
 *
 *  Substring semantics, per whitespace-separated term, case-insensitive, any
 *  term counts. Deliberately NOT minisearch: the index answers "which notes"
 *  with fuzzy/prefix scoring, but a reader expanding a hit is asking "where
 *  does it SAY that", and a line quoted back for a word it does not contain
 *  reads as a bug. A hit earned purely by fuzzy spelling (or by title/alias)
 *  can therefore answer with an empty list — the client says "no matches"
 *  and the whole-note click still works, which is honest: the note matched,
 *  no line did.
 *
 *  Lines are matched and quoted through the same cleaner the backlink context
 *  uses, so what the row shows is what the panel beside it shows for the same
 *  line — prose, with [[wikilinks]] kept for the client's gold spans. Text is
 *  escaped with matches in literal <mark>…</mark>, exactly like
 *  SearchHit.snippet. */
/** The words a free-text query is actually looking FOR, as the line scanner
 *  and the vault-wide replace both need them: whitespace-separated, a leading
 *  `#` dropped (a reader clicking a tag pill searches for the word, not for the
 *  punctuation), and anything that folds away to nothing thrown out — an
 *  all-harakat "term" would match at every position in the note. */
export function searchTerms(query: string, expand?: (text: string) => string): string[] {
  // The operators are NOT words. `tag:recipes dal` looks for "dal" in the
  // lines of a note the tag already chose; hunting for the literal string
  // "tag:recipes" would quote back nothing and the expansion under every hit
  // would read as broken. `expand` is applied to what is left, for the same
  // reason and in the same order as in `search()`.
  const bare = parseSearchQuery(query).text;
  return [...new Set(
    (expand?.(bare) ?? bare)
      .split(/\s+/)
      .map((t) => t.replace(/^#/, ""))
      .filter((t) => foldQuery(t) !== ""),
  )];
}

export function searchMatches(
  relPath: string,
  query: string,
  publishedOnly: boolean,
  lang: FilterLang,
  opts: SearchOptions = {},
): SearchMatch[] {
  // The same refusal shape backlinks() makes for its target: a visitor asking
  // about a note the filter hides must get the same "nothing" a missing note
  // gets, never a confirmation that lines exist.
  if (publishedOnly && !isNoteVisibleToVisitor(relPath, lang)) return [];
  const record = notes.get(relPath);
  if (!record) return [];
  const terms = searchTerms(query, opts.expandTerms);
  if (terms.length === 0) return [];
  const out: SearchMatch[] = [];
  const lines = record.body.split("\n");
  for (let i = 0; i < lines.length && out.length < SEARCH_MATCHES_MAX; i++) {
    // `.tex` lines are quoted raw (same reasoning as backlink context: the
    // markdown cleaner would mangle them, and the editor shows this source).
    // The search terms are the needle: in a table row, show the cell that
    // actually matched rather than a join of the whole row (cleanContextLine).
    const text = record.prose !== null ? lines[i].trim() : cleanContextLine(lines[i], terms);
    if (text === "") continue;
    const first = findAnyMatches(text, terms, 1)[0];
    if (first === undefined) continue;
    const windowed =
      text.length > SEARCH_MATCH_LINE_MAX
        ? windowAround(text, first.start, first.end - first.start, Math.floor(SEARCH_MATCH_LINE_MAX / 2))
        : text;
    out.push({ line: fileLine(record, i), text: markHtml(windowed, terms) });
  }
  return out;
}

export function tags(publishedOnly: boolean, lang: FilterLang): TagCount[] {
  const counts = new Map<string, number>();
  const hidden = publishedOnly ? excludedTags() : null;
  for (const record of notes.values()) {
    if (publishedOnly && !record.published) continue;
    // A topic carried ONLY by language-filtered notes must not appear at all:
    // a visible pill with a count is exactly the existence leak the filter
    // has to avoid, and its topic page would come back empty anyway.
    if (publishedOnly && languageHidden(record, lang)) continue;
    for (const tag of record.tags) {
      if (hidden?.has(tag.toLowerCase())) continue; // EXCLUDE_TAGS: visitor pills
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// -------------------------------------------------------- tag page labels

/** Frontmatter `labels:` → a cleaned `{ lang: label }` map, or null when the
 *  note carries none (which is every note but the tag pages). */
function labelsOfFm(fm: Record<string, unknown>): Record<string, string> | null {
  if (fm.labels === undefined || fm.labels === null) return null;
  const entry = cleanLabelEntry(fm.labels);
  return Object.keys(entry).length > 0 ? entry : null;
}

/** The display labels the VAULT itself declares: every note under `folder`
 *  that carries a frontmatter `labels:` map, keyed by the tag its path names.
 *
 *  The path IS the tag, nested tags included — `tags/lang/arabic.md` names
 *  `lang/arabic` — so a tag page needs no `tag:` key to say what it is about
 *  and cannot disagree with its own filename. This is source (a) of the
 *  resolution order in `shared/tagLabels.ts`, and it is first because a label
 *  written here travels with the vault: clone it, sync it, open it in
 *  Obsidian, and the naming is still there. */
export function tagPageLabels(folder: string): TagLabelMap {
  const out: TagLabelMap = {};
  const root = folder.replace(/^\/+|\/+$/g, "");
  if (root === "") return out;
  const prefix = `${root.toLowerCase()}/`;
  for (const record of notes.values()) {
    if (record.labels === null) continue;
    const lower = record.path.toLowerCase();
    if (!lower.startsWith(prefix)) continue;
    const tag = tagKey(stripNoteExt(record.path.slice(prefix.length)));
    if (tag === "") continue;
    out[tag] = { ...(out[tag] ?? {}), ...record.labels };
  }
  return out;
}

// ------------------------------------------------------- markdown stripping

/** Remove block-level markers from the start of a line (headings, quotes,
 *  list bullets, checkboxes) so it reads as prose. */
function stripLinePrefix(line: string): string {
  return line
    .replace(/^\s*>\s?/, "")
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s*/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
}

/** A table's alignment row — `|---|:--:|` — which carries no words at all. */
const TABLE_RULE_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** One source line → prose context: block prefixes and inline marks stripped,
 *  ONE table cell kept, [[wikilinks]] kept for the client to gild.
 *
 *  A TABLE ROW IS NOT A SENTENCE. This used to join every cell of a row with
 *  " · ", so a backlink into a five-column table came back as "Dune · Herbert ·
 *  1965 · ★★★★ · [[Read]]" — an unreadable cell-join in a card whose whole job
 *  is to show the reader the sentence their link sits in. (And the joiner was
 *  a `·` between two runs of text, which is banned everywhere else in this
 *  product for the reason the status bar gives.)
 *
 *  So: pick ONE cell. `needles` — the wikilink being reported, or the search
 *  terms being highlighted — decides which, because the cell the caller is
 *  about is the only cell worth showing; with no needle, or no cell matching
 *  one, the first cell that carries anything wins. The alignment row carries
 *  nothing and comes back empty, which every caller already treats as "no
 *  context here". */
function cleanContextLine(line: string, needles?: readonly string[]): string {
  const stripped = stripInlineMd(stripLinePrefix(line));
  const tidy = (text: string): string => text.replace(/\s{2,}/g, " ").trim();
  if (!/^\s*\|/.test(stripped)) return tidy(stripped);
  if (TABLE_RULE_RE.test(stripped)) return "";
  const cells = stripped
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map(tidy)
    .filter((cell) => cell !== "");
  if (cells.length === 0) return "";
  if (needles && needles.length > 0) {
    // Folded, like every other match in this file: an Arabic table whose cells
    // are pointed must still give up the cell the reader's plain query meant,
    // rather than falling through to cells[0].
    const wanted = cells.find((cell) => findAnyMatches(cell, needles, 1).length > 0);
    if (wanted !== undefined) return wanted;
  }
  return cells[0];
}

/** Letters/digits left once wikilinks and punctuation are removed — how much
 *  actual prose a context line carries beyond the link itself. */
function contextProse(context: string): string {
  return context
    .replace(/\[\[[^[\]]*\]\]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Widen a bare-link line to its surroundings: pull in neighboring non-empty
 *  lines (following first, then preceding) until the context reads like a
 *  sentence or the paragraph runs out. Fence/frontmatter markers bound it. */
function expandedContext(lines: string[], idx: number, needles?: readonly string[]): string {
  const isBoundary = (l: string | undefined): boolean =>
    l === undefined || /^\s*(```|~~~)/.test(l) || /^\s*---\s*$/.test(l);
  const parts: string[] = [cleanContextLine(lines[idx] ?? "", needles)];
  let len = parts[0].length;
  let before = idx - 1;
  let after = idx + 1;
  for (let hops = 0; len < 170 && hops < 6; hops++) {
    let grew = false;
    if (after < lines.length && !isBoundary(lines[after])) {
      const t = cleanContextLine(lines[after]);
      after++;
      if (t) {
        parts.push(t);
        len += t.length + 1;
        grew = true;
      }
    }
    if (len < 170 && before >= 0 && !isBoundary(lines[before])) {
      const t = cleanContextLine(lines[before]);
      before--;
      if (t) {
        parts.unshift(t);
        len += t.length + 1;
        grew = true;
      }
    }
    const beforeDone = before < 0 || isBoundary(lines[before]);
    const afterDone = after >= lines.length || isBoundary(lines[after]);
    if (!grew && beforeDone && afterDone) break;
  }
  return parts.join(" ").trim();
}

/** Remove inline markdown marks (emphasis, code ticks, tag hashes, md links)
 *  while leaving `[[wikilink]]` syntax alone. Image references disappear
 *  entirely — their alt text is caption furniture, and keeping it glued
 *  arbitrary words into snippets ("… Thumbnail Network bridge: …"). */
function stripInlineMd(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/(^|[^[])\[([^[\]]+)\]\(([^)]+)\)/g, "$1$2")
    .replace(/\*\*|__|~~/g, "")
    .replace(/`+/g, "")
    // A TAG GOES OUT WHOLE. This used to remove the `#` and leave the word
    // standing in the sentence, so a post ending "…it buys the reader a
    // breath. #design #typography" shipped on the front page as "…it buys the
    // reader a breath. design typography" — a nonsense noun phrase glued to
    // real prose. DESIGN.md's hard rule is that a snippet STRIPS or RENDERS
    // `#`; de-hashing a tag into a noun is neither, and plain text has no way
    // to render one, so it strips. Same token shape isFurnitureLine() uses.
    .replace(/(^|[\s([{])#[\p{L}\p{N}_][\p{L}\p{N}_/-]*/gu, "$1");
}

/** Line-skipping state for fenced code and $$ display math blocks — shared by
 *  the full-body stripper and the excerpt builder. skip() returns true when
 *  the line is fence/math/hr furniture that must not reach the prose. */
class FenceSkipper {
  // WHICH marker opened the block, and how long its run was — `shared/fences.ts`
  // for why a toggle is not enough: a ```markdown block showing a `~~~` block
  // "closed" on the inner marker, and the rest of the code came out as prose in
  // the excerpt on the front page.
  private fence: Fence | null = null;
  private inMath = false;
  skip(raw: string): boolean {
    if (this.fence) {
      if (closesFence(raw, this.fence)) this.fence = null;
      return true;
    }
    const opened = fenceOpener(raw);
    if (opened) {
      this.fence = opened;
      return true;
    }
    // $$ display math is raw LaTeX — leave it out entirely.
    const t = raw.trim();
    if (!this.inMath && t.startsWith("$$")) {
      if (!(t.length > 4 && t.endsWith("$$"))) this.inMath = true;
      return true;
    }
    if (this.inMath) {
      if (t.endsWith("$$")) this.inMath = false;
      return true;
    }
    return /^\s*---\s*$/.test(raw);
  }
}

/** One raw markdown line → trimmed prose: block prefix and inline marks
 *  stripped, callout markers and %%comments%% dropped, ![[embeds]] dropped
 *  outright (a filename glued mid-sentence reads as garbage), [[wikilinks]]
 *  reduced to their alias/target label. Fence/math state is the caller's. */
function proseLine(raw: string): string {
  return stripInlineMd(stripLinePrefix(raw))
    // callout title markers ("[!note] Title" after quote stripping)
    .replace(/^\[!\w+\][+-]?\s*/, "")
    // inline math: drop the $ delimiters, keep the expression text
    .replace(/\$([^$\n]+?)\$/g, "$1")
    // ==highlight== and %%comment%% marks
    .replace(/==([^=\n]+?)==/g, "$1")
    .replace(/%%[^%\n]*%%/g, "")
    // ![[embeds]] first (before the wikilink pass eats their inner
    // brackets and strands the "!").
    .replace(/!\[\[[^[\]]*\]\]/g, " ")
    .replace(
      wikilinkRegex(),
      (_m, target: string, _heading?: string, alias?: string) =>
        (alias ? alias.slice(1) : target).trim(),
    )
    .trim();
}

/** Full markdown → prose strip for search snippets: no fence lines, no
 *  frontmatter-ish separators, wikilinks reduced to their label. Heading
 *  text gets an em-dash tail so it doesn't run into the next sentence.
 *  Furniture lines (bare timestamps, "Status:"/"Tags:" label lines) are
 *  skipped the same way the excerpt builder skips them, so a snippet that
 *  windows the head of a note starts at real prose, not template preamble. */
function stripMarkdown(body: string): string {
  const out: string[] = [];
  const fences = new FenceSkipper();
  for (const raw of body.split("\n")) {
    if (fences.skip(raw)) continue;
    if (isFurnitureLine(raw)) continue;
    // A TABLE ROW IS FIELDS, NOT A SENTENCE — and it used to reach the reader
    // with its `|` pipes standing, which is raw markdown syntax in a snippet
    // (DESIGN.md's hard rule) as well as unreadable. Its alignment row says
    // nothing at all and goes; the rest reads as the record it is. The
    // backlink and per-line search surfaces answer the same finding one cell
    // at a time — see cleanContextLine.
    if (/^\s*\|/.test(raw)) {
      if (TABLE_RULE_RE.test(raw)) continue;
      const cells = raw
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((cell) => proseLine(cell))
        .filter((cell) => cell !== "");
      if (cells.length > 0) out.push(cells.join(", "));
      continue;
    }
    const isHeading = /^\s{0,3}#{1,6}\s+/.test(raw);
    const line = proseLine(raw);
    if (!line) continue;
    out.push(isHeading ? `${line} —` : line);
  }
  return out.join(" ");
}

// ------------------------------------------------------------------ snippets

const SNIPPET_RADIUS = 80;
const BACKLINK_CONTEXT_MAX = 180;
const BACKLINK_CONTEXT_RADIUS = 85;

/** Snippet work is capped: only this much of a note's body is ever stripped
 *  to prose. A match past the cap still lists the note — its snippet just
 *  windows the head of the document instead of the exact hit. */
const MAX_SNIPPET_SOURCE_CHARS = 128 * 1024;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Cut a word-boundary window out of `flat` around [at, at+len), returning
 *  the trimmed text with "…" marking every real elision — never a half word,
 *  never an orphaned punctuation fragment at either edge. */
function windowAround(flat: string, at: number, len: number, radius: number): string {
  let start = Math.max(0, at - radius);
  let end = Math.min(flat.length, at + len + radius);
  if (start > 0) {
    // Snap forward to the next word boundary.
    const space = flat.indexOf(" ", start - 1);
    if (space !== -1 && space < at) start = space + 1;
  }
  if (end < flat.length) {
    // Snap back to the previous word boundary.
    const space = flat.lastIndexOf(" ", end);
    if (space > at + len) end = space;
  }
  let text = flat.slice(start, end).trim();
  // Drop orphaned punctuation left behind by the cut (edges only).
  if (start > 0) text = text.replace(/^[\s,;:.!?…·—–-]+/, "");
  if (end < flat.length) text = text.replace(/[\s,;:·—–-]+$/, "");
  return `${start > 0 ? "…" : ""}${text}${end < flat.length ? "…" : ""}`;
}

/** Prose-stripped, whitespace-collapsed body — computed once per record and
 *  cached (records are replaced on reindex), input capped so a single huge
 *  note can't stall a search response. */
function flatBody(record: NoteRecord): string {
  if (record.flat === null) {
    // A `.tex` note arrives with its prose already extracted (the parse is
    // whole-document, so slicing the SOURCE would cut a snippet mid-macro).
    record.flat =
      record.prose !== null
        ? record.prose.slice(0, MAX_SNIPPET_SOURCE_CHARS).replace(/\s+/g, " ").trim()
        : stripMarkdown(record.body.slice(0, MAX_SNIPPET_SOURCE_CHARS)).replace(/\s+/g, " ").trim();
  }
  return record.flat;
}

/** ESCAPE AND MARK IN ONE PASS, over the fold.
 *
 *  Two things forced this out of the regex it used to be. The fold is the
 *  loud one: the terms the index matched on are folded, so «المقدمة» has to
 *  light up the «الْمُقَدِّمَة» a line actually prints — and a regex built from
 *  the typed term cannot see it. The quiet one is that marking AFTER escaping
 *  searched the escaped text: a note containing `&amp;` had its own entity
 *  hunted for the letters of a query, and `<` had become four characters that
 *  the offsets no longer agreed with.
 *
 *  So the match runs on the RAW text (findAnyMatches reports offsets into it),
 *  and each slice is escaped as it is emitted. `<mark>` is the only markup that
 *  reaches the client, exactly as before. */
function markHtml(text: string, terms: readonly string[]): string {
  if (terms.length === 0) return escapeHtml(text);
  const hits = findAnyMatches(text, terms, 200);
  if (hits.length === 0) return escapeHtml(text);
  let out = "";
  let at = 0;
  for (const hit of hits) {
    out += escapeHtml(text.slice(at, hit.start));
    out += `<mark>${escapeHtml(text.slice(hit.start, hit.end))}</mark>`;
    at = hit.end;
  }
  return out + escapeHtml(text.slice(at));
}

function makeSnippet(record: NoteRecord, terms: string[]): string {
  const flat = flatBody(record);
  const first = findAnyMatches(flat, terms, 1)[0];
  const windowed = windowAround(
    flat,
    first?.start ?? 0,
    first === undefined ? 0 : first.end - first.start,
    SNIPPET_RADIUS,
  );
  // The window is re-matched rather than offset-shifted: windowAround snaps to
  // word boundaries and prefixes an ellipsis, so the offsets it returns from
  // are not the offsets it returns into.
  return markHtml(windowed, terms);
}
