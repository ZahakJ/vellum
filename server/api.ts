// API: the HTTP surface. Every route speaks JSON except /events (SSE).

import { createReadStream, readFileSync, promises as fsp } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { stripBidiControls } from "../shared/bidi.ts";
import { UPLOAD_MAX_BYTES } from "../shared/limits.ts";
import type {
  CommentData,
  FrontmatterResult,
  NoteData,
  PublishResult,
  TreeNode,
  UploadResult,
  VaultEvent,
} from "../shared/types.ts";
import { authGuard, authRoutes, clientIp, isPublishLimited } from "./auth.ts";
import {
  AUTHOR_MAX,
  BODY_MAX,
  addComment,
  commentCounts,
  commentRateLimited,
  commentsEnabled,
  listAllComments,
  listComments,
  phantomComment,
  recordCommentPost,
  removeComment,
  setCommentHidden,
} from "./comments.ts";
import {
  backlinks,
  graph,
  indexFile,
  isAllowedAttachment,
  isNotePublished,
  isNoteVisibleToVisitor,
  listImageAttachments,
  posts,
  publishedNotes,
  registerAttachment,
  resolveEmbed,
  search,
  tags,
  visibleNotesUnder,
  whenIndexed,
  wikilinkRegex,
} from "./indexer.ts";
import { setFrontmatterLine, setPublishFlag, yamlQuote } from "./publish.ts";
import { patchSettings, settingsAssetPaths, settingsResponse } from "./settings.ts";
import { attachmentsDir, customCssPath, fontsDir } from "./site.ts";
import {
  VaultError,
  buildTree,
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  emitEvent,
  getVaultRoot,
  noteExists,
  normalizeRel,
  onEvent,
  readNote,
  renameNote,
  safeAbs,
  statAttachment,
  suppressWatcherEcho,
  writeNote,
} from "./vault.ts";

export const api = new Hono();

// Request-body caps, enforced BEFORE any handler buffers a body into memory
// (hono/body-limit rejects on Content-Length up front and meters chunked
// streams as they arrive). Without this, unauthenticated surfaces that parse
// JSON — login, and comment posting with COMMENTS=on — would buffer arbitrarily
// large bodies before their own field-length checks ran, an easy memory-DoS on
// an internet-exposed instance. The general cap is generous (big vault notes
// over PUT /api/note are legitimate); the anonymous surfaces get much tighter
// ones (a comment is ≤ 2000 chars + ≤ 40 of author; 64 KB covers any honest
// payload, JSON escaping and multibyte included). One path-aware middleware —
// not stacked limiters — so a chunked upload to /api/comments is cut off at
// the tight cap, never buffered up to the big one first. A reverse proxy body
// cap (nginx `client_max_body_size`) is still a sensible extra layer — README.
const API_BODY_MAX = 10 * 1024 * 1024; // 10 MB: any /api request
const COMMENT_BODY_MAX = 64 * 1024; //    64 KB: comment posts + login
// UPLOAD_MAX_BYTES (10 MB: the image itself) is shared/limits.ts — the
// client drop-zone hint states the same number in words.
// The multipart envelope (boundary lines, field headers) rides on top of the
// image bytes, so the wire cap leaves a little headroom above the image cap.
const UPLOAD_BODY_MAX = UPLOAD_MAX_BYTES + 64 * 1024;

function tooLarge(maxBytes: number) {
  return (c: Context) => c.json({ error: `Request body too large (${maxBytes} bytes max)` }, 413);
}

const TIGHT_BODY_PATHS = new Set(["/api/comments", "/api/login"]);
api.use("*", async (c, next) => {
  const post = c.req.method === "POST";
  const max = post && TIGHT_BODY_PATHS.has(c.req.path)
    ? COMMENT_BODY_MAX
    : post && c.req.path === "/api/upload"
      ? UPLOAD_BODY_MAX
      : API_BODY_MAX;
  return bodyLimit({ maxSize: max, onError: tooLarge(max) })(c, next);
});

// Auth first: /login, /logout, /me are always reachable; the guard runs before
// every route registered below it (401s mutations without an admin session,
// and gates reads too when PUBLIC=false).
api.route("/", authRoutes);

// Instance styling hook: VELLUM_DATA/custom.css, when present, is served to
// admin and visitor alike (registered before the guard + listed in its
// OPEN_PATHS — pure styling leaks nothing, and the login page of a PUBLIC=false
// vault should still carry the instance's look). Existence is checked per
// request so the file can be added or removed without a restart.
api.get("/custom.css", (c) => {
  const file = customCssPath();
  if (!file) return c.json({ error: "No custom.css configured" }, 404);
  return c.body(readFileSync(file, "utf8"), 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "no-cache",
  });
});

// Custom fonts: GET /api/fonts/<file> serves VELLUM_DATA/fonts/<file> for
// @font-face rules in custom.css. Same openness rationale as custom.css
// (registered before the guard + prefix-exempted in it): fonts are pure
// styling, and the login page of a PUBLIC=false vault should still render in
// the instance's typeface. Strictly basename-only (no separators, no
// dotfiles), whitelisted extensions, ETag + immutable long cache.
const FONT_MIME: Record<string, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

api.get("/fonts/:file", async (c) => {
  const file = c.req.param("file");
  // Basename only: reject anything with path separators (a literal "/" can
  // only arrive percent-encoded — Hono decodes params), traversal dots-as-
  // segment, NUL, or a leading dot (dotfiles stay invisible, as everywhere).
  if (
    !file ||
    file.includes("/") ||
    file.includes("\\") ||
    file.includes("\0") ||
    file.startsWith(".") ||
    file !== path.basename(file)
  ) {
    return c.json({ error: "Invalid font path" }, 400);
  }
  const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase();
  const mime = FONT_MIME[ext];
  if (!mime || !file.includes(".")) {
    return c.json({ error: "Unsupported font type (woff2, woff, ttf, otf)" }, 400);
  }
  const abs = path.join(fontsDir(), file);
  let stat;
  try {
    stat = await fsp.stat(abs);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    return c.json({ error: `Font not found: ${file}` }, 404);
  }
  const etag = `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "ETag": etag,
    // Fonts are content-stable assets: cache hard, revalidate never. A font
    // swap ships as a new filename (and a custom.css edit, served no-cache).
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  };
  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim() === etag || t.trim() === `W/${etag}`)) {
    return c.body(null, 304, { "ETag": etag });
  }
  const nodeStream = createReadStream(abs);
  nodeStream.on("error", (err: unknown) => console.error(`font stream error for ${file}:`, err));
  return c.body(Readable.toWeb(nodeStream) as unknown as ReadableStream, 200, {
    ...headers,
    "Content-Length": String(stat.size),
  });
});

api.use("*", authGuard);

api.onError((err, c) => {
  if (err instanceof VaultError) {
    return c.json({ error: err.message }, err.status as ContentfulStatusCode);
  }
  console.error("api error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

function requiredQuery(value: string | undefined, name: string): string {
  if (!value) throw new VaultError(400, `Missing query param: ${name}`);
  return value;
}

async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (typeof body !== "object" || body === null) throw new Error("not an object");
    return body as Record<string, unknown>;
  } catch {
    throw new VaultError(400, "Invalid JSON body");
  }
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new VaultError(400, `Body field "${key}" must be a non-empty string`);
  }
  return value;
}

// Visitors (hash configured, no admin session) see the vault as a flat curated
// collection: only published notes, no folder structure, names are titles.
function publishedTree(): TreeNode {
  const children: TreeNode[] = publishedNotes()
    .map(({ path: notePath, title }) => ({ name: title, path: notePath, type: "file" as const }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { name: path.basename(getVaultRoot()), path: "", type: "folder", children };
}

api.get("/tree", async (c) => {
  if (isPublishLimited(c)) return c.json(publishedTree());
  return c.json(await buildTree());
});

api.get("/note", async (c) => {
  const notePath = requiredQuery(c.req.query("path"), "path");
  if (isPublishLimited(c) && !isNotePublished(normalizeRel(notePath))) {
    throw new VaultError(404, `Note not found: ${normalizeRel(notePath)}`);
  }
  return c.json(await readNote(notePath));
});

api.put("/note", async (c) => {
  const path = requiredQuery(c.req.query("path"), "path");
  const body = await jsonBody(c);
  if (typeof body.content !== "string") {
    throw new VaultError(400, 'Body field "content" must be a string');
  }
  // Same ordering discipline as /api/publish and /api/frontmatter, and for
  // the same reason: the SSE visitor filter (visitorEvent) samples visibility
  // BEFORE the event and again after, so an event that arrives after the
  // reindex reads the post-edit state as "was". Letting the watcher's
  // debounced echo carry this write did exactly that — an edit that turned a
  // visible note into a hidden one (language flip, publish line removed)
  // emitted nothing at all instead of the mandated "deleted", leaving the
  // visitor's sidebar holding a live link to a note the site now hides; the
  // reverse edit emitted "changed" where the contract requires "created".
  // This is the editor's own save path, i.e. the common case.
  const existed = await noteExists(path);
  suppressWatcherEcho(path);
  const written = await writeNote(path, body.content);
  emitEvent({ kind: existed ? "changed" : "created", path: written.path });
  // Index now rather than after the watcher debounce, so an immediately
  // following rename/search sees this note's links.
  await indexFile(written.path);
  return c.json(written);
});

api.post("/note", async (c) => {
  const body = await jsonBody(c);
  const path = requiredString(body, "path");
  const created = await createNote(path);
  await indexFile(path);
  return c.json(created);
});

api.post("/rename", async (c) => {
  const body = await jsonBody(c);
  const from = requiredString(body, "path");
  const to = requiredString(body, "toPath");
  await renameWithLinkRewrite(from, to);
  return c.json({ ok: true });
});

api.delete("/note", async (c) => {
  const path = requiredQuery(c.req.query("path"), "path");
  await deleteNote(path);
  return c.json({ ok: true });
});

api.post("/folder", async (c) => {
  const body = await jsonBody(c);
  await createFolder(requiredString(body, "path"));
  return c.json({ ok: true });
});

// Delete a folder and everything under it. Default is Obsidian's safe move to
// `.trash/` at the vault root; `?permanent=true` removes it for good. Admin-only
// (the auth guard 401s every non-GET, preview sessions included). The index is
// updated synchronously — vault.deleteFolder emits the synthetic dir-delete —
// so the /api/graph, /api/search and published counts the UI refetches right
// after are already correct.
const TRUTHY_QUERY = new Set(["1", "true", "yes", "on"]);

api.delete("/folder", async (c) => {
  const folderPath = requiredQuery(c.req.query("path"), "path");
  const permanent = TRUTHY_QUERY.has((c.req.query("permanent") ?? "").toLowerCase());
  const result = await deleteFolder(folderPath, { permanent });
  await whenIndexed();
  return c.json(result);
});

// Toggle a note's publish flag with a surgical frontmatter line edit — every
// other byte of the file is preserved. Admin-only via the auth guard (POST).
api.post("/publish", async (c) => {
  const body = await jsonBody(c);
  const notePath = requiredString(body, "path");
  if (typeof body.publish !== "boolean") {
    throw new VaultError(400, 'Body field "publish" must be a boolean');
  }
  const note = await readNote(notePath);
  const updated = setPublishFlag(note.content, body.publish);
  if (updated !== note.content) {
    // The synthetic event below is the whole story — swallow the watcher's
    // redundant echo of this write so listeners don't see the toggle twice.
    suppressWatcherEcho(note.path);
    await writeNote(note.path, updated);
    // Broadcast BEFORE reindexing so the SSE visitor filter can observe the
    // publish state both before and after (created/deleted transitions).
    emitEvent({ kind: "changed", path: note.path });
  }
  await indexFile(note.path);
  const result: PublishResult = { ok: true, path: note.path, published: isNotePublished(note.path) };
  return c.json(result);
});

// Surgical single-key frontmatter setter (admin-only via the auth guard).
// Same machinery as /api/publish: line edit, watcher-echo suppression,
// immediate reindex. Keys are allowlisted; values are single-line strings.
const FRONTMATTER_KEYS = new Set(["banner"]);
const FRONTMATTER_VALUE_MAX = 500;

api.post("/frontmatter", async (c) => {
  const body = await jsonBody(c);
  const notePath = requiredString(body, "path");
  const key = requiredString(body, "key");
  if (!FRONTMATTER_KEYS.has(key)) {
    throw new VaultError(400, `Frontmatter key not editable: ${key}`);
  }
  let value: string | null = null;
  if (body.value !== undefined && body.value !== null) {
    if (typeof body.value !== "string") {
      throw new VaultError(400, 'Body field "value" must be a string or null');
    }
    // Single line, no control chars — a frontmatter line edit must never be
    // able to smuggle extra YAML lines into the block.
    value = body.value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
    if (value.length > FRONTMATTER_VALUE_MAX) {
      throw new VaultError(400, `Value too long (${FRONTMATTER_VALUE_MAX} characters max)`);
    }
    if (value === "") value = null;
  }
  const note = await readNote(notePath);
  const line = value === null ? null : `${key}: ${yamlQuote(value)}`;
  const updated = setFrontmatterLine(note.content, key, line);
  if (updated !== note.content) {
    suppressWatcherEcho(note.path);
    await writeNote(note.path, updated);
    emitEvent({ kind: "changed", path: note.path });
  }
  await indexFile(note.path);
  const result: FrontmatterResult = { ok: true, path: note.path, key, value };
  return c.json(result);
});

api.get("/resolve", (c) => {
  const name = requiredQuery(c.req.query("name"), "name");
  // A miss is an EXPECTED outcome (broken embeds are normal in a real vault):
  // answer 200 { path: null } instead of 404 so every visit to a note with
  // broken embeds doesn't spray red network errors across the console.
  return c.json({ path: resolveEmbed(name, isPublishLimited(c)) });
});

// ------------------------------------------------------- attachment serving

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  pdf: "application/pdf",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json",
  canvas: "application/json",
};

export function contentTypeFor(relPath: string): string {
  const ext = relPath.slice(relPath.lastIndexOf(".") + 1).toLowerCase();
  return MIME_TYPES[ext] ?? "application/octet-stream";
}

/** Parse a single `bytes=a-b` Range header against a file size, or null. */
function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header || size === 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    // suffix range: last N bytes
    const suffix = Number(m[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start > end || start >= size) return null;
  return { start, end };
}

api.get("/file", async (c) => {
  const relQuery = requiredQuery(c.req.query("path"), "path");
  // Visitors may fetch only attachments embedded/linked by published notes —
  // checked before stat so unpublished files 404 without revealing existence.
  // Settings-named assets (dashboard home banner, logo) are visitor-visible
  // by definition: the admin pointed the public homepage at them.
  if (
    isPublishLimited(c) &&
    !isAllowedAttachment(normalizeRel(relQuery)) &&
    !settingsAssetPaths().has(normalizeRel(relQuery))
  ) {
    throw new VaultError(404, `File not found: ${normalizeRel(relQuery)}`);
  }
  const file = await statAttachment(relQuery);

  const etag = `"${file.size.toString(16)}-${Math.round(file.mtimeMs).toString(16)}"`;
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentTypeFor(file.rel),
    "ETag": etag,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-cache",
  };
  // SVG/PDF can carry scripts — sandbox them so they can't run in our origin.
  if (/\.(svg|pdf|html?)$/i.test(file.rel)) {
    baseHeaders["Content-Security-Policy"] = "sandbox";
  }

  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").some((t) => t.trim() === etag || t.trim() === `W/${etag}`)) {
    return c.body(null, 304, { "ETag": etag });
  }

  const rangeHeader = c.req.header("range");
  const range = parseRange(rangeHeader, file.size);
  if (rangeHeader && !range && /^bytes=/.test(rangeHeader.trim())) {
    return c.body(null, 416, { "Content-Range": `bytes */${file.size}` });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? file.size - 1;
  const length = file.size === 0 ? 0 : end - start + 1;
  const nodeStream =
    file.size === 0 ? Readable.from([]) : createReadStream(file.abs, { start, end });
  nodeStream.on("error", (err: unknown) => console.error(`file stream error for ${file.rel}:`, err));
  const body = Readable.toWeb(nodeStream) as unknown as ReadableStream;

  const headers: Record<string, string> = {
    ...baseHeaders,
    "Content-Length": String(length),
  };
  if (range) {
    headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
    return c.body(body, 206, headers);
  }
  return c.body(body, 200, headers);
});

// ------------------------------------------------------- attachment uploads

/** Sniff the actual image type from file bytes — extension and Content-Type
 *  are attacker-controlled and ignored. Returns the canonical extension. */
function sniffImageType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf.toString("latin1", 1, 4) === "PNG") return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 6 && /^GIF8[79]a/.test(buf.toString("latin1", 0, 6))) return "gif";
  if (
    buf.length >= 12 &&
    buf.toString("latin1", 0, 4) === "RIFF" &&
    buf.toString("latin1", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  // SVG has no magic bytes: accept text that opens with an <svg …> root
  // (optionally after a BOM, an XML declaration, comments, or a DOCTYPE).
  const head = buf.toString("utf8", 0, Math.min(buf.length, 2048)).replace(/^\uFEFF/, "");
  const trimmed = head
    .replace(/^\s*<\?xml[^>]*\?>/i, "")
    .replace(/^(\s*<!--[\s\S]*?-->)*/, "")
    .replace(/^\s*<!DOCTYPE[^>]*>/i, "")
    .replace(/^(\s*<!--[\s\S]*?-->)*/, "")
    .trimStart();
  if (/^<svg[\s>]/i.test(trimmed)) return "svg";
  return null;
}

/** Defense-in-depth scrub for uploaded SVGs. The primary defense is that
 *  /api/file serves them under `Content-Security-Policy: sandbox` + nosniff,
 *  but the stored bytes should not depend on every future serving path
 *  repeating those headers: strip script/foreignObject subtrees, on* event
 *  handler attributes, and javascript: URLs at write time. Regex scrubbing is
 *  not a full XML sanitizer — it is belt-and-suspenders, not the belt. */
function sanitizeSvg(src: string): string {
  return src
    .replace(/<script\b[\s\S]*?(?:<\/script\s*>|$)/gi, "")
    .replace(/<foreignObject\b[\s\S]*?(?:<\/foreignObject\s*>|$)/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/((?:xlink:)?href\s*=\s*)(["']?)\s*javascript:[^"'\s>]*\2/gi, "$1$2#$2");
}

/** Client filename → safe basename (no extension): directories stripped,
 *  anything outside letters/digits/space/._- dropped, sensible fallback. */
function sanitizeBaseName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const noExt = base.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  const clean = noExt
    .replace(/[^\p{L}\p{N} ._-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80);
  return clean || `upload-${new Date().toISOString().slice(0, 10)}`;
}

// Admin-only via the auth guard (POST on a non-exempt path). Multipart field
// "file"; bytes sniffed for a real image type; stored under ATTACHMENTS_DIR
// (vault-relative, created on demand) with a collision-free sanitized name.
api.post("/upload", async (c) => {
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody();
  } catch {
    throw new VaultError(400, "Invalid multipart body");
  }
  const file = form.file;
  if (!(file instanceof File)) {
    throw new VaultError(400, 'Multipart field "file" (the image) is required');
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    throw new VaultError(413, `Image too large (${UPLOAD_MAX_BYTES} bytes max)`);
  }
  let buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffImageType(buf);
  if (!ext) {
    throw new VaultError(400, "Not a recognized image (png, jpeg, webp, gif, svg)");
  }
  if (ext === "svg") buf = Buffer.from(sanitizeSvg(buf.toString("utf8")), "utf8");
  const dir = attachmentsDir();
  const base = sanitizeBaseName(file.name ?? "");
  // First free filename: name.ext, name-2.ext, name-3.ext, …
  let rel = "";
  let abs = "";
  for (let i = 1; i <= 200; i++) {
    const candidate = normalizeRel(`${dir}/${i === 1 ? base : `${base}-${i}`}.${ext}`);
    const candidateAbs = safeAbs(candidate); // throws 400/404 on unsafe config/paths
    try {
      await fsp.access(candidateAbs);
    } catch {
      rel = candidate;
      abs = candidateAbs;
      break;
    }
  }
  if (!rel) throw new VaultError(409, "Could not find a free filename for the upload");
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buf);
  // Register now — the picker and banner resolution must see it before the
  // watcher debounce echoes the write.
  registerAttachment(rel);
  const result: UploadResult = { path: rel };
  return c.json(result);
});

// The banner picker's list: every indexed image attachment. Admin-eyes-only —
// visitors would learn unpublished filenames from it, so they get the same
// 404 an unknown route answers.
api.get("/attachments", (c) => {
  if (isPublishLimited(c)) throw new VaultError(404, "Not found");
  return c.json(listImageAttachments());
});

// ------------------------------------------------------ comments (marginalia)
// Live only with COMMENTS=on; otherwise every route 404s like it doesn't exist.
// Comments hang off published notes: for visitors (and posting, for everyone)
// an unpublished/missing note answers the same 404 a missing note would.

function assertCommentsEnabled(): void {
  if (!commentsEnabled()) throw new VaultError(404, "Not found");
}

function commentNotePath(rel: string): string {
  const notePath = normalizeRel(rel);
  if (!notePath.toLowerCase().endsWith(".md")) {
    throw new VaultError(400, `Not a markdown path: ${rel}`);
  }
  return notePath;
}

// Moderation feed: newest comments across all notes, hidden ones included.
// Registered before GET /comments so nothing shadows it; admin sessions only —
// visitors (and admin-as-visitor preview) get the same 404 a missing route
// would give. Must be admin-gated explicitly: the auth guard passes GETs.
api.get("/comments/all", (c) => {
  assertCommentsEnabled();
  if (isPublishLimited(c)) throw new VaultError(404, "Not found");
  const raw = c.req.query("limit");
  let limit = 100;
  if (raw !== undefined) {
    limit = Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new VaultError(400, "limit must be an integer between 1 and 500");
    }
  }
  return c.json(listAllComments(limit));
});

api.get("/comments", (c) => {
  assertCommentsEnabled();
  const notePath = commentNotePath(requiredQuery(c.req.query("path"), "path"));
  // Admins may read (moderate) comments on any note; visitors only where
  // the note itself is visible to them.
  const limited = isPublishLimited(c);
  if (limited && !isNotePublished(notePath)) {
    throw new VaultError(404, `Note not found: ${notePath}`);
  }
  // Admin responses carry the hidden flag (and hidden comments); visitor
  // responses exclude hidden rows and never mention the flag at all.
  return c.json(listComments(notePath, !limited));
});

// NOTE: the 64 KB body cap (see the body-limit middleware up top) runs ahead
// of jsonBody() here — the rate limiter can only run post-parse, so that cap
// is what actually bounds memory per connection on this anonymous surface.
api.post("/comments", async (c) => {
  assertCommentsEnabled();
  const payload = await jsonBody(c);
  const notePath = commentNotePath(requiredString(payload, "path"));
  // Comments attach to the published site only — for anyone, admin included.
  if (!isNotePublished(notePath)) {
    throw new VaultError(404, `Note not found: ${notePath}`);
  }
  // Comment author + body are the ONE unauthenticated channel that renders
  // into the public page, so bidi controls come out at write time — the same
  // discipline /api/frontmatter applies to C0 controls. The chrome's <bdi> /
  // FSI…PDI isolation stops an override from escaping the name span, but it
  // cannot stop the name from lying about itself: an author of
  // "Ali<U+202E>rotartsinimd" renders as "AliAdministrator", neatly inside
  // the byline, and reads as genuine. Strip before length-capping so the cap
  // measures characters the reader will actually see.
  const body = typeof payload.body === "string" ? stripBidiControls(payload.body).trim() : "";
  if (!body) throw new VaultError(400, 'Body field "body" must be a non-empty string');
  if (body.length > BODY_MAX) {
    throw new VaultError(400, `Comment is too long (${BODY_MAX} characters max)`);
  }
  const author =
    (typeof payload.author === "string"
      ? stripBidiControls(payload.author).trim().slice(0, AUTHOR_MAX)
      : "") || "Anonymous";
  // Honeypot: the hidden "website" field is invisible to humans. A filled-in
  // value marks a bot — answer success, store nothing.
  if (typeof payload.website === "string" && payload.website.trim() !== "") {
    return c.json(phantomComment(notePath, author, body));
  }
  const ip = clientIp(c);
  if (commentRateLimited(ip)) {
    throw new VaultError(429, "Slow down — try again in a minute");
  }
  recordCommentPost(ip);
  const comment: CommentData = addComment(notePath, author, body, ip);
  return c.json(comment);
});

// Admin-only via the auth guard (mutation on a non-exempt path). Hide/unhide:
// a hidden comment stays in the db (evidence, reversibility) but vanishes from
// every visitor-facing response.
api.patch("/comments/:id", async (c) => {
  assertCommentsEnabled();
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) throw new VaultError(400, "Invalid comment id");
  const payload = await jsonBody(c);
  if (typeof payload.hidden !== "boolean") {
    throw new VaultError(400, 'Body field "hidden" must be a boolean');
  }
  if (!setCommentHidden(id, payload.hidden)) throw new VaultError(404, "Comment not found");
  return c.json({ ok: true });
});

// Admin-only via the auth guard (mutation on a non-exempt path).
api.delete("/comments/:id", (c) => {
  assertCommentsEnabled();
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) throw new VaultError(400, "Invalid comment id");
  if (!removeComment(id)) throw new VaultError(404, "Comment not found");
  return c.json({ ok: true });
});

api.get("/search", (c) => c.json(search(c.req.query("q") ?? "", isPublishLimited(c))));

api.get("/graph", (c) => c.json(graph(isPublishLimited(c))));

api.get("/backlinks", (c) => {
  const notePath = requiredQuery(c.req.query("path"), "path");
  return c.json(backlinks(normalizeRel(notePath), isPublishLimited(c)));
});

api.get("/tags", (c) => c.json(tags(isPublishLimited(c))));

// Blog: published notes as posts, newest first. Visitor-safe by construction
// (published notes only, EXCLUDE_TAGS filtered). With COMMENTS=on each post
// carries its comment count — the one per-session branch: visitors count
// visible comments only, admin sessions include hidden ones.
api.get("/posts", (c) => {
  // Visitor sessions (and admin-as-visitor preview) get the languageFilter
  // applied; admin lists are never filtered.
  const list = posts(isPublishLimited(c));
  if (commentsEnabled()) {
    const counts = commentCounts(!isPublishLimited(c));
    for (const post of list) post.commentCount = counts.get(post.path) ?? 0;
  }
  return c.json(list);
});

// ------------------------------------------------------------------ settings
// Instance settings (VELLUM_DATA/settings.json): siteName / tagline / footer /
// defaultTheme / publicLayout / blogLocale / excludeTags / commentsEnabled /
// favicon / logo / home { mode, note, banner }. A stored value overrides its
// env default, live. Admin-eyes-only both ways — the visitor-relevant subset
// travels via /api/me instead. GET answers a 404 to visitors (like
// /api/attachments); PATCH is admin-gated by the auth guard (mutation on a
// non-exempt path). Both answer the stored keys plus `effective` (the merged
// values the site is using right now).

api.get("/settings", (c) => {
  if (isPublishLimited(c)) throw new VaultError(404, "Not found");
  return c.json(settingsResponse());
});

api.patch("/settings", async (c) => {
  const body = await jsonBody(c);
  return c.json(patchSettings(body));
});

// ---------------------------------------------------------------- SSE events

/** Map a vault event to the events a publish-limited visitor may see: only events
 *  about notes that visitor can actually discover — published AND not curated
 *  away by the languageFilter. Undiscoverable paths are stripped from renames;
 *  a transition either way (publish/unpublish, and equally a note that becomes
 *  or stops being Arabic under the filter) becomes created/deleted so the
 *  curated collection stays honest. Captures pre-event state synchronously,
 *  then awaits the indexer before reading post-event state.
 *
 *  The languageFilter half is not cosmetic: gating on publication alone made
 *  this the one surface that leaked what CONTRACTS says the filter must never
 *  leak — an anonymous stream received the full vault path of a hidden note
 *  the moment it was created, edited or deleted, unprompted. */
async function visitorEvents(event: VaultEvent): Promise<VaultEvent[]> {
  if (event.dir) {
    // Visitors have no folder structure, so the dir event itself is nothing
    // to them — but the notes a folder DELETE takes away are: with the event
    // dropped outright, a visitor's sidebar kept live links to notes the site
    // now 404s (client/App.tsx only reloads the tree on an event). Fan it out
    // into one "deleted" per note that was visible, sampled synchronously —
    // vault.deleteFolder emits this before the chained reindex removes the
    // records, the same before/after discipline the note branch relies on.
    // Hidden and unpublished notes are never named, so nothing leaks.
    if (event.kind !== "deleted") return [];
    const gone = visibleNotesUnder(event.path);
    await whenIndexed();
    return gone.map((notePath) => ({ kind: "deleted", path: notePath }));
  }
  if (!event.path.toLowerCase().endsWith(".md")) return []; // attachments: never
  const wasVisible = isNoteVisibleToVisitor(event.path);
  await whenIndexed();
  switch (event.kind) {
    case "created":
    case "changed": {
      const nowVisible = isNoteVisibleToVisitor(event.path);
      if (wasVisible && !nowVisible) return [{ kind: "deleted", path: event.path }];
      if (!wasVisible && nowVisible) return [{ kind: "created", path: event.path }];
      return nowVisible ? [{ kind: event.kind, path: event.path }] : [];
    }
    case "deleted":
      return wasVisible ? [{ kind: "deleted", path: event.path }] : [];
    case "renamed": {
      const nowVisible = event.toPath ? isNoteVisibleToVisitor(event.toPath) : false;
      if (wasVisible && nowVisible) return [event];
      if (wasVisible) return [{ kind: "deleted", path: event.path }];
      if (nowVisible && event.toPath) return [{ kind: "created", path: event.toPath }];
      return [];
    }
  }
}

api.get("/events", (c) => {
  const limited = isPublishLimited(c);
  return streamSSE(c, async (stream) => {
    let live = true;
    const unsubscribe = onEvent((event) => {
      if (!live) return;
      const deliver = async (): Promise<void> => {
        const visible = limited ? await visitorEvents(event) : [event];
        for (const out of visible) {
          if (!live) return;
          await stream.writeSSE({ event: "message", data: JSON.stringify(out) });
        }
      };
      deliver().catch(() => {});
    });
    stream.onAbort(() => {
      live = false;
      unsubscribe();
    });
    while (live && !stream.closed) {
      await stream.sleep(15_000);
      try {
        await stream.writeSSE({ event: "ping", data: "" });
      } catch {
        break;
      }
    }
    unsubscribe();
  });
});

// ----------------------------------------------------- rename + link rewrite

function basenameNoExt(relPath: string): string {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1);
  return base.replace(/\.md$/i, "");
}

/** Rename a note; if its title changed, rewrite [[wikilinks]] in notes that pointed at it. */
async function renameWithLinkRewrite(from: string, to: string): Promise<void> {
  const oldTitle = basenameNoExt(from);
  const newTitle = basenameNoExt(to);
  const titleChanged = oldTitle.toLowerCase() !== newTitle.toLowerCase();
  const oldPathNoExt = from.replace(/\.md$/i, "").toLowerCase();
  const newPathNoExt = to.replace(/\.md$/i, "");
  // Capture linkers before the rename, while links still resolve to the old
  // path. Path-form links ([[Folder/Note]]) break on ANY move, so linkers are
  // captured even when the basename is unchanged.
  const linkers = [...new Set(backlinks(from).map((b) => b.path))];

  await renameNote(from, to);

  for (const linker of linkers) {
    try {
      const note: NoteData = await readNote(linker);
      const rewritten = note.content.replace(wikilinkRegex(), (whole, target: string, heading?: string, alias?: string) => {
        const t = target.trim();
        if (titleChanged && t.toLowerCase() === oldTitle.toLowerCase()) {
          return `[[${newTitle}${heading ?? ""}${alias ?? ""}]]`;
        }
        // Path-form target pointing at the old path → rewrite to the new path.
        const norm = t.toLowerCase().replace(/\\/g, "/").replace(/^\.?\/+/, "");
        if (norm === oldPathNoExt || norm === `${oldPathNoExt}.md`) {
          return `[[${newPathNoExt}${heading ?? ""}${alias ?? ""}]]`;
        }
        return whole;
      });
      if (rewritten !== note.content) await writeNote(linker, rewritten);
    } catch (err) {
      console.error(`rename: failed to rewrite links in ${linker}:`, err);
    }
  }
}
