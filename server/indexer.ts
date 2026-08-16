// Indexer: in-memory search + link-graph index, built once at startup and kept
// fresh incrementally from vault watcher events.

import { closesFence, fenceOpener, type Fence } from "../shared/fences.ts";
import { promises as fs } from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import type { Backlink, GraphData, GraphEdge, PostMeta, SearchHit, TagCount, VaultEvent } from "../shared/types.ts";
import { stripBidiControls } from "../shared/bidi.ts";
import { isNotePath, isTexPath, noteCandidates, noteTitleOf, stripNoteExt } from "../shared/noteFormat.ts";
import { markdownAnchors, type NoteAnchor } from "../shared/anchors.ts";
import { cleanLabelEntry, tagKey, type TagLabelMap } from "../shared/tagLabels.ts";
import { publishFlag, readFrontmatter } from "./publish.ts";
import { readNoteFrontmatter } from "./noteFrontmatter.ts";
import { readTexNote } from "./texNote.ts";
import { excludedTags, languageFilterEnabled, siteLanguage } from "./site.ts";
// Cyclic with this module (settings.ts → site.ts → here) and inert: every
// call below happens at request time, never while either module is loading.
import { templatesFolder } from "./settings.ts";
import { listFolderFiles, listVaultFiles, onEvent, readNote, safeAbs } from "./vault.ts";

interface NoteRecord {
  path: string;
  title: string;
  body: string; // content minus frontmatter
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
  /** frontmatter `publish` is exactly true / "true" */
  published: boolean;
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
  /** Lazily computed prose-stripped body for snippets (null until first use).
   *  Records are replaced wholesale on reindex, so this never goes stale. */
  flat: string | null;
  /** Lazily computed blog-post fields (same lifecycle as `flat`). */
  post: { excerpt: string; words: number } | null;
}

const notes = new Map<string, NoteRecord>();
const byName = new Map<string, Set<string>>(); // lowercased basename -> paths
const byPathLower = new Map<string, string>(); // lowercased vault-relative path -> path
// The two vault-wide LaTeX lookups, so an imported project lights up unmodified:
// a `\ref{sec:method}` that matches no label in its own document, and a
// `\cite{knuth1997}` whose key some note in the vault carries.
const byLabel = new Map<string, Set<string>>();   // lowercased \label id -> paths
const byCitekey = new Map<string, Set<string>>(); // lowercased citekey  -> paths

// Publish state: the set of published note paths, plus (derived lazily) the
// set of attachment paths that published notes embed/link — the only files
// /api/file will serve to non-admin visitors.
const publishedSet = new Set<string>();
let allowedAttachmentsCache: Set<string> | null = null; // null = recompute

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

const mini = new MiniSearch<{ path: string; title: string; body: string; tags: string }>({
  idField: "path",
  fields: ["title", "body", "tags"],
  searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 6, tags: 2 } },
});

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

/** True when the languageFilter hides this record from PUBLIC blog surfaces:
 *  filter on + language "ar" hides non-Arabic notes; filter on + "en" hides
 *  Arabic-majority ones. Curation, not access control — direct URL access to
 *  any published note stays allowed (/api/note is never filtered), only the
 *  discovery surfaces (posts, topics, graph, search, backlinks, RSS) skip
 *  filtered notes, and they must never leak their existence. */
function languageHidden(record: NoteRecord): boolean {
  if (!languageFilterEnabled()) return false;
  // A note with no prose letters (arabic === null) belongs to no language:
  // hiding it from one site and showing it on the other would be a coin toss.
  // It stays visible in both.
  if (record.arabic === null) return false;
  return siteLanguage() === "ar" ? !record.arabic : record.arabic;
}

/** Published AND not curated away by the languageFilter — the visibility rule
 *  every visitor DISCOVERY surface applies, including the push channel: an SSE
 *  stream that announced a filtered-out note would leak its existence, path
 *  and edit timing to exactly the visitors the filter hides it from. (Direct
 *  access stays allowed: /api/note deliberately checks publication only.) */
export function isNoteVisibleToVisitor(relPath: string): boolean {
  const record = notes.get(relPath);
  return publishedSet.has(relPath) && record !== undefined && !languageHidden(record);
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
      await indexFile(file);
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

function handleEvent(event: VaultEvent): void {
  const isNote = isNotePath(event.path);
  const apply = async (): Promise<void> => {
    switch (event.kind) {
      case "created":
      case "changed":
        if (event.dir) break;
        if (isNote) await indexFile(event.path);
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
        if (event.toPath) await indexFile(event.toPath);
        break;
    }
  };
  // Chain on the previous apply so events land in order and whenIndexed()
  // always covers the newest event.
  settled = settled
    .then(apply)
    .catch((err) => console.error(`indexer: failed to apply ${event.kind} ${event.path}:`, err));
}

/** Index (or reindex) one note immediately. Exported so API writes can update
 *  the index synchronously instead of waiting out the watcher debounce —
 *  otherwise a rename issued right after a save misses freshly written links. */
export async function indexFile(relPath: string): Promise<void> {
  let stat;
  let abs;
  try {
    abs = safeAbs(relPath);
    stat = await fs.stat(abs);
  } catch {
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
  } catch {
    removeFile(relPath); // vanished between event and read
    return;
  }
  removeFile(relPath);
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
    links: parts.links,
    xrefs: parts.xrefs,
    assets: parts.assets,
    tags: parseTags(parts.tagSource, parts.frontmatter),
    labels: labelsOfFm(fm),
    published: publishFlag(fm),
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
  allowedAttachmentsCache = null;
  // Tags are indexed too so "#tag" (and frontmatter-only tags) are findable.
  mini.add({
    path: relPath,
    title,
    // A `.tex` note is indexed on its PROSE. Feeding minisearch the raw source
    // would make every document match "begin", "textbf" and "usepackage" and
    // none of them match the sentence the reader remembers writing.
    body: record.prose ?? record.body,
    tags: record.tags.join(" "),
  });
}

/** What indexFile() needs from a note's text, in one shape for both formats. */
interface NoteParts {
  /** Raw source minus frontmatter — LINE-indexed, because backlink context and
   *  the editor both count in source lines. */
  body: string;
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
  const { body, frontmatter } = splitFrontmatter(content);
  return {
    body,
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

/** Register a record's labels and citekeys in the two vault-wide tables. */
function addKeys(record: NoteRecord): void {
  for (const anchor of record.anchors) {
    if (anchor.kind === "heading" || anchor.kind === "section") continue; // slugs are not labels
    let set = byLabel.get(anchor.id.toLowerCase());
    if (!set) byLabel.set(anchor.id.toLowerCase(), (set = new Set()));
    set.add(record.path);
  }
  for (const key of record.citekeys) {
    let set = byCitekey.get(key.toLowerCase());
    if (!set) byCitekey.set(key.toLowerCase(), (set = new Set()));
    set.add(record.path);
  }
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
  for (const file of moved) await indexFile(file);
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
      const hit = resolveLink(link.target);
      if (hit !== null && hit.startsWith(prefix)) {
        out.add(record.path);
        break;
      }
    }
  }
  return [...out].sort();
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
  } catch {
    removeFile(relPath);
    return;
  }
  removeFile(relPath);
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
    links: [],
    xrefs: [],
    assets: [],
    prose: null,
    anchors: [],
    citekeys: citekeyOf(fm),
    excerptSource: null,
    tags: parseTags("", frontmatter),
    labels: labelsOfFm(fm),
    published: publishFlag(fm),
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
  allowedAttachmentsCache = null;
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

function removeFile(relPath: string): void {
  const record = notes.get(relPath);
  if (!record) return;
  notes.delete(relPath);
  oversized.delete(relPath);
  removeKeys(record);
  // The resolution key is the RAW basename (record.title is the sanitized
  // display title) — addName registered it, removeName must unregister it.
  removeName(noteTitleOf(relPath), relPath);
  if (byPathLower.get(relPath.toLowerCase()) === relPath) byPathLower.delete(relPath.toLowerCase());
  publishedSet.delete(relPath);
  allowedAttachmentsCache = null;
  if (mini.has(relPath)) mini.discard(relPath);
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
  allowedAttachmentsCache = null;
  const key = path.posix.basename(relPath).toLowerCase();
  let set = attachmentsByName.get(key);
  if (!set) attachmentsByName.set(key, (set = new Set()));
  set.add(relPath);
  attachmentsByPathLower.set(relPath.toLowerCase(), relPath);
}

function removeAttachment(relPath: string): void {
  if (!attachmentPaths.delete(relPath)) return;
  allowedAttachmentsCache = null;
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

function splitFrontmatter(content: string): { body: string; frontmatter: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return { body: content, frontmatter: "" };
  return { body: content.slice(match[0].length), frontmatter: match[1] };
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
    const inlineValue = fmMatch[1].trim();
    let values: string[] = [];
    if (inlineValue.startsWith("[")) {
      values = inlineValue.replace(/^\[|\]$/g, "").split(",");
    } else if (inlineValue) {
      values = inlineValue.split(",");
    } else {
      const rest = frontmatter.slice(fmMatch.index + fmMatch[0].length);
      for (const line of rest.split("\n")) {
        const item = /^[ \t]*-[ \t]+(.+)$/.exec(line);
        if (item) values.push(item[1]);
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
export function resolveLink(name: string, publishedOnly = false): string | null {
  // The extension comes off whatever it is: `[[Paper.tex]]` and `[[Paper]]`
  // name the same note, exactly as `[[Note.md]]` and `[[Note]]` always did.
  const key = stripNoteExt(name.split(/[#|]/)[0].trim().toLowerCase());
  // Path-form targets ([[Folder/Note]]): exact vault-relative match first
  // (with or without an extension, case-insensitive), mirroring the client
  // resolver. Candidate ORDER is the tie-break: `.md` first, so a vault that
  // grows a `Fourier.tex` beside its `Fourier.md` does not silently
  // re-point every existing link.
  const asPath = path.posix.normalize(key.replace(/\\/g, "/")).replace(/^\.?\/+/, "");
  let pathHit: string | undefined;
  for (const candidate of noteCandidates(asPath)) {
    pathHit = byPathLower.get(candidate);
    if (pathHit) break;
  }
  pathHit ??= byPathLower.get(asPath);
  if (pathHit && (!publishedOnly || isNoteVisibleToVisitor(pathHit))) return pathHit;
  let candidates = byName.get(key);
  if (!candidates || candidates.size === 0) return null;
  if (publishedOnly) {
    const kept = filterCandidates(candidates, isNoteVisibleToVisitor);
    if (!kept) return null;
    candidates = kept;
  }
  return pickShortest(candidates);
}

/** Resolve a link/embed target to a note OR attachment path. Notes win
 *  (attachment basenames carry an extension, so collisions are rare).
 *  `publishedOnly` sees only visitor-visible notes (resolveLink applies the
 *  languageFilter) + allowlisted attachments. Attachments are deliberately NOT
 *  language-filtered: an attachment belongs to no language, and a hidden
 *  note's images must keep loading on its own still-working permalink. */
export function resolveEmbed(name: string, publishedOnly = false): string | null {
  const asNote = resolveLink(name, publishedOnly);
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
): string | null {
  if (xref.kind === "cite") return resolveCitekey(xref.key, publishedOnly);
  return resolveLabel(xref.key, publishedOnly)?.path ?? null;
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
  publishedOnly = false,
): { path: string; anchor: NoteAnchor } | null {
  const key = label.trim().toLowerCase();
  if (!key) return null;
  let candidates = byLabel.get(key);
  if (!candidates || candidates.size === 0) return null;
  if (publishedOnly) {
    const kept = filterCandidates(candidates, isNoteVisibleToVisitor);
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
export function resolveCitekey(key: string, publishedOnly = false): string | null {
  const want = key.trim().toLowerCase();
  if (!want) return null;
  let candidates = byCitekey.get(want);
  if (!candidates || candidates.size === 0) return null;
  if (publishedOnly) {
    const kept = filterCandidates(candidates, isNoteVisibleToVisitor);
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
  const byName = resolveEmbed(path.posix.basename(rel));
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
export function detectTemplatesFolder(): string | null {
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
  if (candidates.size === 1) return [...candidates][0];
  const atRoot = [...candidates].filter((p) => !p.includes("/"));
  return atRoot.length === 1 ? atRoot[0] : null;
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
  // Called lazily, never at module-evaluation time: settings.ts imports this
  // module (through site.ts), so the two are a cycle and only a RUNTIME call
  // is safe in either direction. The merge rule — stored value over
  // auto-detection — lives there and is not copied here.
  const folder = templatesFolder();
  if (folder === null) return false;
  return relPath === folder || relPath.startsWith(`${folder}/`);
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
        const resolved = resolveEmbed(link.target);
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
        const byName = resolveEmbed(path.posix.basename(asset));
        if (byName && attachmentPaths.has(byName)) allowed.add(byName);
      }
      // A published note's banner attachment is visitor-visible too.
      const banner = resolveBanner(record);
      if (banner && attachmentPaths.has(banner)) allowed.add(banner);
    }
    allowedAttachmentsCache = allowed;
  }
  return allowedAttachmentsCache;
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
export function publishedNotes(): { path: string; title: string }[] {
  const out: { path: string; title: string }[] = [];
  for (const notePath of publishedSet) {
    const record = notes.get(notePath);
    if (record && !languageHidden(record)) out.push({ path: record.path, title: record.title });
  }
  return out;
}

/** The visitor-visible notes currently indexed under a folder — what a
 *  `{kind:"deleted", dir:true}` event is about to take away from the public
 *  collection. Sampled synchronously by the SSE visitor filter, before the
 *  chained reindex tears the records down. Hidden and unpublished notes are
 *  never named, so fanning a folder delete out through this leaks nothing the
 *  visitor could not already enumerate from /api/tree. */
export function visibleNotesUnder(relFolder: string): string[] {
  const prefix = `${relFolder}/`;
  const out: string[] = [];
  for (const notePath of publishedSet) {
    if (notePath.startsWith(prefix) && isNoteVisibleToVisitor(notePath)) out.push(notePath);
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

function postMeta(record: NoteRecord): PostMeta {
  if (record.post === null) {
    const flat = flatBody(record);
    record.post = {
      // LaTeX: the abstract when the paper has one, else its first real
      // paragraph — both already plain prose, so the markdown paragraph
      // walker (which reads `#`, `|`, fences and `$$`) never sees TeX.
      excerpt: record.prose !== null ? cutExcerpt(record.excerptSource ?? "") : excerptOf(record.body),
      words: flat === "" ? 0 : flat.split(" ").length,
    };
  }
  const hidden = excludedTags();
  const meta: PostMeta = {
    path: record.path,
    title: record.title,
    date: new Date(record.dateMs).toISOString(),
    excerpt: record.post.excerpt,
    words: record.post.words,
    readingMinutes: Math.ceil(record.post.words / 200),
    tags: record.tags.filter((t) => !hidden.has(t.toLowerCase())),
  };
  const banner = resolveBanner(record);
  if (banner) meta.banner = banner;
  return meta;
}

/** Published notes as blog posts, newest first (visitor-safe: published only,
 *  EXCLUDE_TAGS filtered). Per-note fields are cached on the index record and
 *  refresh incrementally as notes reindex. `visitor` additionally applies the
 *  languageFilter (public lists only — admin surfaces are never filtered). */
export function posts(visitor = false): PostMeta[] {
  const out: { dateMs: number; meta: PostMeta }[] = [];
  for (const notePath of publishedSet) {
    const record = notes.get(notePath);
    if (!record) continue;
    if (visitor && languageHidden(record)) continue;
    // A template is not a post — in EITHER list. The admin's post list is the
    // one that answers "what is on my blog", so a stencil sitting in it is the
    // same lie there as on the public page.
    if (isTemplateNote(notePath)) continue;
    out.push({ dateMs: record.dateMs, meta: postMeta(record) });
  }
  return out
    .sort((a, b) => b.dateMs - a.dateMs || a.meta.path.localeCompare(b.meta.path))
    .map((entry) => entry.meta);
}

export function search(query: string, publishedOnly = false): SearchHit[] {
  const q = query.trim();
  if (!q) return [];
  const qLower = q.toLowerCase();

  // Rank tiers on top of minisearch's relevance score: a note TITLED what you
  // typed always beats a note that merely mentions it, and a title that starts
  // with the query beats a content-only match. Within a tier, minisearch's
  // order (score) is kept.
  const tierOf = (title: string): number => {
    const t = title.toLowerCase();
    if (t === qLower) return 0;
    if (t.startsWith(qLower)) return 1;
    return 2;
  };

  // Visitor scoping: published notes only, minus language-filtered ones
  // (the filter must not leak filtered-out note existence through search).
  const visitorHidden = (p: string): boolean => {
    if (!publishedSet.has(p)) return true;
    const record = notes.get(p);
    return record !== undefined && languageHidden(record);
  };
  let results = mini.search(q);
  if (publishedOnly) results = results.filter((r) => !visitorHidden(String(r.id)));
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
  }));

  // Exact-title short-circuit: if a note titled exactly `q` exists but
  // minisearch left it out (tokenizer/fuzzy quirks), force it in at #1.
  const exactPaths = [...(byName.get(qLower) ?? [])]
    .filter((p) => !seen.has(p) && (!publishedOnly || !visitorHidden(p)))
    .sort((a, b) => a.localeCompare(b));
  if (exactPaths.length > 0) {
    const topScore = (hits[0]?.score ?? 0) + 1;
    const forced = exactPaths.flatMap<SearchHit>((p) => {
      const record = notes.get(p);
      if (!record) return [];
      return [{ path: p, title: record.title, snippet: makeSnippet(record, [q]), score: topScore }];
    });
    hits.unshift(...forced);
    hits.length = Math.min(hits.length, 50);
  }
  return hits;
}

export function graph(publishedOnly = false): GraphData {
  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];
  const degree = new Map<string, number>();
  // Visitor graphs honor the languageFilter on both endpoints — a filtered
  // note must appear neither as a node nor via an edge.
  const hidden = (record: NoteRecord): boolean => publishedOnly && languageHidden(record);
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
    for (const link of record.links) connect(resolveLink(link.target, publishedOnly));
    // …and LaTeX's own vocabulary. THIS is what makes an existing project,
    // dropped into a vault unmodified, light up the graph: a `\cite` whose key
    // some note carries and a `\ref` whose label some note defines are edges,
    // and nothing in either document had to be rewritten to say so.
    for (const xref of record.xrefs) connect(resolveXref(xref, publishedOnly));
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

export function backlinks(targetPath: string, publishedOnly = false): Backlink[] {
  const hits: Backlink[] = [];
  // The TARGET has to pass the visitor filter too, not just the sources: a
  // language-hidden note that answered with backlinks confirmed to an
  // anonymous caller that it exists and is published. (resolveLink() now
  // refuses to resolve to it as well, so this is belt and braces — but it is
  // the check the reader of this function expects to find.)
  if (publishedOnly && !isNoteVisibleToVisitor(targetPath)) return hits;
  const seen = new Set<string>();
  for (const record of notes.values()) {
    if (record.path === targetPath) continue;
    if (publishedOnly && (!record.published || languageHidden(record))) continue;
    let bodyLines: string[] | null = null; // split lazily, once per record
    for (const link of record.links) {
      if (resolveLink(link.target, publishedOnly) !== targetPath) continue;
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
      let context = record.prose !== null ? link.line : cleanContextLine(link.line);
      // A line that is little more than the link itself ("- [[History]]")
      // makes a useless card — widen to the surrounding lines so the card
      // reads like Obsidian's backlink context.
      if (record.prose === null && contextProse(context).length < 16) {
        bodyLines ??= record.body.split("\n");
        context = expandedContext(bodyLines, link.lineIdx);
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
      hits.push({ path: record.path, title: record.title, context });
    }
    // A `\cite` or a cross-note `\ref` is a backlink like any other — the
    // panel is where a note learns who leans on it, and a paper that cites this
    // note by its citekey leans on it exactly as a `[[wikilink]]` does.
    for (const xref of record.xrefs) {
      if (resolveXref(xref, publishedOnly) !== targetPath) continue;
      const key = `${record.path}\0${xref.line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ path: record.path, title: record.title, context: xref.line });
    }
  }
  return hits.sort((a, b) => a.path.localeCompare(b.path));
}

export function tags(publishedOnly = false): TagCount[] {
  const counts = new Map<string, number>();
  const hidden = publishedOnly ? excludedTags() : null;
  for (const record of notes.values()) {
    if (publishedOnly && !record.published) continue;
    // A topic carried ONLY by language-filtered notes must not appear at all:
    // a visible pill with a count is exactly the existence leak the filter
    // has to avoid, and its topic page would come back empty anyway.
    if (publishedOnly && languageHidden(record)) continue;
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

/** One source line → prose context: block prefixes and inline marks stripped,
 *  table pipes turned into dots, [[wikilinks]] kept for the client to gild. */
function cleanContextLine(line: string): string {
  return stripInlineMd(stripLinePrefix(line))
    .replace(/^\s*\|\s*/, "")
    .replace(/\s*\|\s*$/, "")
    .replace(/\s\|\s/g, " · ")
    .replace(/\s{2,}/g, " ")
    .trim();
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
function expandedContext(lines: string[], idx: number): string {
  const isBoundary = (l: string | undefined): boolean =>
    l === undefined || /^\s*(```|~~~)/.test(l) || /^\s*---\s*$/.test(l);
  const parts: string[] = [cleanContextLine(lines[idx] ?? "")];
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function makeSnippet(record: NoteRecord, terms: string[]): string {
  const flat = flatBody(record);
  const lower = flat.toLowerCase();
  let hit = -1;
  let hitLen = 0;
  for (const term of terms) {
    const at = lower.indexOf(term.toLowerCase());
    if (at !== -1 && (hit === -1 || at < hit)) {
      hit = at;
      hitLen = term.length;
    }
  }
  const windowed = windowAround(flat, Math.max(0, hit), hitLen, SNIPPET_RADIUS);
  // Escape first, then mark: "…" prefixes survive because they're not HTML.
  let snippet = escapeHtml(windowed);
  if (terms.length > 0) {
    const marker = new RegExp(terms.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|"), "gi");
    snippet = snippet.replace(marker, "<mark>$&</mark>");
  }
  return snippet;
}
