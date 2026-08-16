// Indexer: in-memory search + link-graph index, built once at startup and kept
// fresh incrementally from vault watcher events.

import { promises as fs } from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import type { Backlink, GraphData, GraphEdge, PostMeta, SearchHit, TagCount, VaultEvent } from "../shared/types.ts";
import { stripBidiControls } from "../shared/bidi.ts";
import { publishFlag, readFrontmatter } from "./publish.ts";
import { excludedTags, languageFilterEnabled, siteLanguage } from "./site.ts";
import { listVaultFiles, onEvent, readNote, safeAbs } from "./vault.ts";

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
  /** Lazily computed prose-stripped body for snippets (null until first use).
   *  Records are replaced wholesale on reindex, so this never goes stale. */
  flat: string | null;
  /** Lazily computed blog-post fields (same lifecycle as `flat`). */
  post: { excerpt: string; words: number } | null;
}

const notes = new Map<string, NoteRecord>();
const byName = new Map<string, Set<string>>(); // lowercased basename -> paths
const byPathLower = new Map<string, string>(); // lowercased vault-relative path -> path

// Publish state: the set of published note paths, plus (derived lazily) the
// set of attachment paths that published notes embed/link — the only files
// /api/file will serve to non-admin visitors.
const publishedSet = new Set<string>();
let allowedAttachmentsCache: Set<string> | null = null; // null = recompute

// Attachments (non-md files): known paths + lowercased basename (with
// extension) -> paths, so ![[image.png]] embeds resolve like wikilinks.
const attachmentPaths = new Set<string>();
const attachmentsByName = new Map<string, Set<string>>();

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
  const isMd = event.path.toLowerCase().endsWith(".md");
  const apply = async (): Promise<void> => {
    switch (event.kind) {
      case "created":
      case "changed":
        if (event.dir) break;
        if (isMd) await indexFile(event.path);
        else addAttachment(event.path);
        break;
      case "deleted":
        if (event.dir) removeFolder(event.path);
        else if (isMd) removeFile(event.path);
        else removeAttachment(event.path);
        break;
      case "renamed":
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
  const rawTitle = path.posix.basename(relPath, ".md");
  const title = stripBidiControls(rawTitle);
  const { body, frontmatter } = splitFrontmatter(content);
  const fm = readFrontmatter(content);
  const record: NoteRecord = {
    path: relPath,
    title,
    body,
    links: parseLinks(body),
    assets: parseAssets(body, relPath),
    tags: parseTags(body, frontmatter),
    published: publishFlag(fm),
    banner: typeof fm.banner === "string" && fm.banner.trim() ? fm.banner.trim() : null,
    dateMs:
      parseFmDate(fm.date) ??
      parseFmDate(fm.created) ??
      parseFmDate(fm.published) ??
      (stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs),
    arabic: detectArabic(body),
    flat: null,
    post: null,
  };
  oversized.delete(relPath); // it may have just shrunk back under the cap
  notes.set(relPath, record);
  addName(rawTitle, relPath);
  byPathLower.set(relPath.toLowerCase(), relPath);
  if (record.published) publishedSet.add(relPath);
  allowedAttachmentsCache = null;
  // Tags are indexed too so "#tag" (and frontmatter-only tags) are findable.
  mini.add({ path: relPath, title, body, tags: record.tags.join(" ") });
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
  const rawTitle = path.posix.basename(relPath, ".md");
  const { frontmatter } = splitFrontmatter(head);
  const fm = readFrontmatter(head);
  const record: NoteRecord = {
    path: relPath,
    title: stripBidiControls(rawTitle),
    body: "",
    links: [],
    assets: [],
    tags: parseTags("", frontmatter),
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
  // The resolution key is the RAW basename (record.title is the sanitized
  // display title) — addName registered it, removeName must unregister it.
  removeName(path.posix.basename(relPath, ".md"), relPath);
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
}

function removeAttachment(relPath: string): void {
  if (!attachmentPaths.delete(relPath)) return;
  allowedAttachmentsCache = null;
  const key = path.posix.basename(relPath).toLowerCase();
  const set = attachmentsByName.get(key);
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
  let key = name.split(/[#|]/)[0].trim().toLowerCase();
  if (key.endsWith(".md")) key = key.slice(0, -3);
  // Path-form targets ([[Folder/Note]]): exact vault-relative match first
  // (with or without .md, case-insensitive), mirroring the client resolver.
  const asPath = path.posix.normalize(key.replace(/\\/g, "/")).replace(/^\.?\/+/, "");
  const pathHit = byPathLower.get(`${asPath}.md`) ?? byPathLower.get(asPath);
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

// ------------------------------------------------------------------- banners

/** Resolve a note's `banner:` value: https URLs pass through (http:// is
 *  refused — a mixed-content <img> is worse than the generated fallback);
 *  anything else must name a known attachment — an exact vault-relative path
 *  first, then wikilink-style basename resolution. null when unset/unresolvable. */
function resolveBanner(record: NoteRecord): string | null {
  const value = record.banner;
  if (!value) return null;
  if (/^https:\/\//i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null; // http:, data:, etc.
  const rel = path.posix.normalize(value.replace(/\\/g, "/").replace(/^\.?\/+/, "")).replace(/\/+$/, "");
  if (attachmentPaths.has(rel)) return rel;
  const byName = resolveEmbed(path.posix.basename(rel));
  return byName !== null && attachmentPaths.has(byName) ? byName : null;
}

/** A published note's banner as the client uses it (https URL or allowlisted
 *  attachment path), or null. Exported for the blog head injection (og:image). */
export function publishedBanner(relPath: string): string | null {
  if (!publishedSet.has(relPath)) return null;
  const record = notes.get(relPath);
  return record ? resolveBanner(record) : null;
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
  const para = firstParagraph(body)
    .replace(/(^|[\s([{])\*([^*\n]+)\*(?=[\s)\]}.,;:!?…]|$)/g, "$1$2")
    .replace(/(^|[\s([{])_([^_\n]+)_(?=[\s)\]}.,;:!?…]|$)/g, "$1$2");
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
      excerpt: excerptOf(record.body),
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
      const title = record?.title ?? path.posix.basename(id, ".md");
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
    for (const link of record.links) {
      const target = resolveLink(link.target, publishedOnly);
      if (!target || target === record.path) continue;
      const targetRecord = notes.get(target);
      if (targetRecord !== undefined && hidden(targetRecord)) continue;
      const key = `${record.path}\0${target}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ source: record.path, target });
      degree.set(record.path, (degree.get(record.path) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
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
      let context = cleanContextLine(link.line);
      // A line that is little more than the link itself ("- [[History]]")
      // makes a useless card — widen to the surrounding lines so the card
      // reads like Obsidian's backlink context.
      if (contextProse(context).length < 16) {
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
    .replace(/(^|[\s([{])#(?=[\p{L}\p{N}_])/gu, "$1");
}

/** Line-skipping state for fenced code and $$ display math blocks — shared by
 *  the full-body stripper and the excerpt builder. skip() returns true when
 *  the line is fence/math/hr furniture that must not reach the prose. */
class FenceSkipper {
  private inFence = false;
  private inMath = false;
  skip(raw: string): boolean {
    if (/^\s*(```|~~~)/.test(raw)) {
      this.inFence = !this.inFence;
      return true;
    }
    if (this.inFence) return true;
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
    record.flat = stripMarkdown(record.body.slice(0, MAX_SNIPPET_SOURCE_CHARS))
      .replace(/\s+/g, " ")
      .trim();
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
