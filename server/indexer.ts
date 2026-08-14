// Indexer: in-memory search + link-graph index, built once at startup and kept
// fresh incrementally from vault watcher events.

import { promises as fs } from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import type { Backlink, GraphData, GraphEdge, SearchHit, TagCount, VaultEvent } from "../shared/types.ts";
import { isPublished } from "./publish.ts";
import { excludedTags } from "./site.ts";
import { listVaultFiles, onEvent, readNote, safeAbs } from "./vault.ts";

interface NoteRecord {
  path: string;
  title: string;
  body: string; // content minus frontmatter
  links: { target: string; line: string; lineIdx: number }[];
  tags: string[];
  /** frontmatter `publish` is exactly true / "true" */
  published: boolean;
  /** Lazily computed prose-stripped body for snippets (null until first use).
   *  Records are replaced wholesale on reindex, so this never goes stale. */
  flat: string | null;
}

const notes = new Map<string, NoteRecord>();
const byName = new Map<string, Set<string>>(); // lowercased basename -> paths

// Publish state: the set of published note paths, plus (derived lazily) the
// set of attachment paths that published notes embed/link — the only files
// /api/file will serve to non-admin visitors.
const publishedSet = new Set<string>();
let allowedAttachmentsCache: Set<string> | null = null; // null = recompute

// Attachments (non-md files): known paths + lowercased basename (with
// extension) -> paths, so ![[image.png]] embeds resolve like wikilinks.
const attachmentPaths = new Set<string>();
const attachmentsByName = new Map<string, Set<string>>();

/** Markdown larger than this is left out of the search/link index (still
 *  readable via /api/note) so a single giant export can't blow up boot. */
const MAX_INDEXED_MD_BYTES = 2 * 1024 * 1024;

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
  console.log(
    `  indexed ${notes.size} notes, ${attachmentPaths.size} attachments in ${Math.round(performance.now() - t0)}ms`,
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
  // Oversized markdown is deliberately not indexed (still served by /api/note).
  try {
    const stat = await fs.stat(safeAbs(relPath));
    if (stat.size > MAX_INDEXED_MD_BYTES) {
      removeFile(relPath);
      return;
    }
  } catch {
    removeFile(relPath);
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
  const title = path.posix.basename(relPath, ".md");
  const { body, frontmatter } = splitFrontmatter(content);
  const record: NoteRecord = {
    path: relPath,
    title,
    body,
    links: parseLinks(body),
    tags: parseTags(body, frontmatter),
    published: isPublished(content),
    flat: null,
  };
  notes.set(relPath, record);
  addName(title, relPath);
  if (record.published) publishedSet.add(relPath);
  allowedAttachmentsCache = null;
  // Tags are indexed too so "#tag" (and frontmatter-only tags) are findable.
  mini.add({ path: relPath, title, body, tags: record.tags.join(" ") });
}

function removeFile(relPath: string): void {
  const record = notes.get(relPath);
  if (!record) return;
  notes.delete(relPath);
  removeName(record.title, relPath);
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

/** Restrict a candidate set to `keep`; null when nothing survives. */
function filterCandidates(candidates: Set<string>, keep: Set<string>): Set<string> | null {
  const kept = new Set([...candidates].filter((p) => keep.has(p)));
  return kept.size === 0 ? null : kept;
}

/** Resolve a wikilink target to a note path: case-insensitive basename, shortest
 *  path wins. `publishedOnly` resolves within the published collection only. */
export function resolveLink(name: string, publishedOnly = false): string | null {
  let key = name.split(/[#|]/)[0].trim().toLowerCase();
  if (key.endsWith(".md")) key = key.slice(0, -3);
  let candidates = byName.get(key);
  if (!candidates || candidates.size === 0) return null;
  if (publishedOnly) {
    const kept = filterCandidates(candidates, publishedSet);
    if (!kept) return null;
    candidates = kept;
  }
  return pickShortest(candidates);
}

/** Resolve a link/embed target to a note OR attachment path. Notes win
 *  (attachment basenames carry an extension, so collisions are rare).
 *  `publishedOnly` sees only published notes + allowlisted attachments. */
export function resolveEmbed(name: string, publishedOnly = false): string | null {
  const asNote = resolveLink(name, publishedOnly);
  if (asNote) return asNote;
  const key = name.split(/[#|]/)[0].trim().toLowerCase();
  if (!key) return null;
  let candidates = attachmentsByName.get(key);
  if (!candidates || candidates.size === 0) return null;
  if (publishedOnly) {
    const kept = filterCandidates(candidates, allowedAttachments());
    if (!kept) return null;
    candidates = kept;
  }
  return pickShortest(candidates);
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
export function publishedNotes(): { path: string; title: string }[] {
  const out: { path: string; title: string }[] = [];
  for (const notePath of publishedSet) {
    const record = notes.get(notePath);
    if (record) out.push({ path: record.path, title: record.title });
  }
  return out;
}

export function publishedCounts(): { notes: number; total: number } {
  return { notes: publishedSet.size, total: notes.size };
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

  let results = mini.search(q);
  if (publishedOnly) results = results.filter((r) => publishedSet.has(String(r.id)));
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
    .filter((p) => !seen.has(p) && (!publishedOnly || publishedSet.has(p)))
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
  for (const record of notes.values()) {
    if (publishedOnly && !record.published) continue;
    for (const link of record.links) {
      const target = resolveLink(link.target, publishedOnly);
      if (!target || target === record.path) continue;
      const key = `${record.path}\0${target}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ source: record.path, target });
      degree.set(record.path, (degree.get(record.path) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
  }
  const nodes = [...notes.values()]
    .filter((record) => !publishedOnly || record.published)
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
  const seen = new Set<string>();
  for (const record of notes.values()) {
    if (record.path === targetPath) continue;
    if (publishedOnly && !record.published) continue;
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

/** Full markdown → prose strip for search snippets: no fence lines, no
 *  frontmatter-ish separators, wikilinks reduced to their label. Heading
 *  text gets an em-dash tail so it doesn't run into the next sentence. */
function stripMarkdown(body: string): string {
  const out: string[] = [];
  let inFence = false;
  let inMath = false;
  for (const raw of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      continue;
    }
    // $$ display math is raw LaTeX — leave it out of snippets entirely.
    const t = raw.trim();
    if (!inMath && t.startsWith("$$")) {
      if (!(t.length > 4 && t.endsWith("$$"))) inMath = true;
      continue;
    }
    if (inMath) {
      if (t.endsWith("$$")) inMath = false;
      continue;
    }
    if (/^\s*---\s*$/.test(raw)) continue;
    const isHeading = /^\s{0,3}#{1,6}\s+/.test(raw);
    let line = stripInlineMd(stripLinePrefix(raw))
      // callout title markers ("[!note] Title" after quote stripping)
      .replace(/^\[!\w+\][+-]?\s*/, "")
      // inline math: drop the $ delimiters, keep the expression text
      .replace(/\$([^$\n]+?)\$/g, "$1")
      // ==highlight== and %%comment%% marks
      .replace(/==([^=\n]+?)==/g, "$1")
      .replace(/%%[^%\n]*%%/g, "")
      // ![[embeds]] first (before the wikilink pass eats their inner
      // brackets and strands the "!"): dropped outright — a filename or
      // embedded-note title glued mid-sentence reads as garbage in a snippet.
      .replace(/!\[\[[^[\]]*\]\]/g, " ")
      .replace(
        wikilinkRegex(),
        (_m, target: string, _heading?: string, alias?: string) =>
          (alias ? alias.slice(1) : target).trim(),
      );
    line = line.trim();
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
