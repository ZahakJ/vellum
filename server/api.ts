// API: the HTTP surface. Every route speaks JSON except /events (SSE).

import { createReadStream, readFileSync, promises as fsp } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  ATTACHMENT_TYPES,
  extensionOf,
  normalizeFolder,
} from "../shared/attachments.ts";
import { stripBidiControls } from "../shared/bidi.ts";
import { isNotePath, isTexPath, stripNoteExt } from "../shared/noteFormat.ts";
import { UPLOAD_MAX_BYTES } from "../shared/limits.ts";
import type {
  AliasesResponse,
  AnchorsResponse,
  BannerResolution,
  CommentData,
  DeletePreview,
  FrontmatterResult,
  LanguageFilterMode,
  NoteData,
  PublicThemeInfo,
  PublishedPaths,
  PublishResult,
  TagLabelsResponse,
  TrashEntry,
  TreeNode,
  UploadResult,
  VaultEvent,
  XrefResponse,
} from "../shared/types.ts";
import { authGuard, authRoutes, clientIp, isProtected, isPublishLimited } from "./auth.ts";
import { languageScope } from "./language.ts";
import { visibilityFor, type VisibilityQuery } from "./visibility.ts";
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
import type { FilterLang } from "./indexer.ts";
import {
  aliasEntries,
  backlinks,
  indexFile,
  indexUnder,
  isAllowedAttachment,
  noteTitle,
  isNotePublished,
  isNoteVisibleToVisitor,
  listImageAttachments,
  noteAnchors,
  notesAffectedByFolderMove,
  notesLinkingTo,
  notesReferencing,
  posts,
  publishedNotes,
  publishedPaths,
  registerAttachment,
  resolveBannerRef,
  resolveCitekey,
  resolveEmbed,
  resolveLabel,
  search,
  tags,
  visibleNotesUnder,
  whenIndexed,
  wikilinkRegex,
} from "./indexer.ts";
import { sendEncoded } from "./compress.ts";
import { graphBody, invalidateGraph, localGraphJson } from "./graphCache.ts";
import { invalidateTree, treeBody } from "./treeCache.ts";
import { designRoutes } from "./designRoutes.ts";
import { bookRoutes } from "./bookRoutes.ts";
import { staticPagesActive } from "./pages.ts";
import { gitStatus, initRepo, syncNow } from "./gitSync.ts";
import { dirOf, rewriteDestinations, rewriteForMove } from "./moveLinks.ts";
import { yamlQuote } from "./publish.ts";
import { addNoteAlias, setNoteFrontmatterLine, setNotePublishFlag } from "./noteFrontmatter.ts";
import {
  buildFaceListCss,
  buildFontCss,
  catalogEntry,
  catalogSlotIds,
  cleanFontSlots,
  customSlotIds,
  ensureFontsCached,
  fontDir,
  FONT_SLOTS,
  isCacheFileName,
  pickableIds,
  slotsAreSystem,
} from "./fonts.ts";
import {
  CUSTOM_FONT_MAX_BYTES,
  customDir,
  customFileOf,
  customFontExists,
  customMime,
  deleteCustomFont,
  hasPlausibleTableDirectory,
  isCustomFileName,
  listCustomFonts,
  saveCustomFont,
  sniffFontFormat,
} from "./customFonts.ts";
import { fontSlots, patchSettings, setAdminTheme, settingsAssetPaths, settingsResponse } from "./settings.ts";
// Localised tag labels: display names for canonical tags, plus the query
// rewrite that makes search answer to both spellings.
import { expandTagQuery, visibleTagLabels } from "./tagLabels.ts";
import {
  attachmentsDir,
  customCssPath,
  fontsDir,
  LANGUAGE_FILTER_MODES,
  themePinnedByEnv,
  themePref,
  uploadDirFor,
  visitorTheme,
} from "./site.ts";
import { FOLLOW_THEME } from "../shared/themes.ts";
import {
  VaultError,
  createFolder,
  createNote,
  deleteAttachment,
  deleteFolder,
  deleteNote,
  emitEvent,
  getVaultRoot,
  moveFolder,
  listTrash,
  listVaultFiles,
  noteExists,
  normalizeRel,
  onEvent,
  purgeFromTrash,
  readNote,
  renameNote,
  restoreFromTrash,
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
// A font upload is its own, tighter cap (CUSTOM_FONT_MAX_BYTES ≈ 5 MB): the
// route sniffs magic bytes, so the only thing this stops is a body that never
// had to be read at all. The multipart envelope rides on top of the file.
const FONT_BODY_MAX = CUSTOM_FONT_MAX_BYTES + 64 * 1024;

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
      : post && c.req.path === "/api/fonts/upload"
        ? FONT_BODY_MAX
        : API_BODY_MAX;
  return bodyLimit({ maxSize: max, onError: tooLarge(max) })(c, next);
});

// ── Caching discipline: one middleware, above everything ────────────────────
// EVERY body this API answers varies by session cookie and by the visitor-
// preview header, and none of them said so. /api/tree, /note, /posts, /search,
// /graph, /tags, /backlinks and /me carried NO Cache-Control at all, and
// nothing anywhere carried `Vary`. The README recommends running nginx in
// front, where a shared cache is entitled to reuse a cacheable-looking 200 for
// the next caller — and the object at risk is an admin's entire vault tree
// being handed to an anonymous visitor, or a visitor's published-only tree
// being served back to the admin.
//
// `private, no-store` is the right default for an API whose every answer is
// scoped to who asked; `Vary` states the two dimensions for any cache that
// ignores the first. Both are DEFAULTS: a route that set its own
// Cache-Control keeps it, and the content-addressed font routes (immutable,
// deliberately shared, containing no session-varying byte) are skipped
// entirely so a CDN can still hold them.
// X-Vellum-Lang joined the list the moment `languageFilter: "follow"` existed:
// under that mode two readers of the SAME url, with the same (absent) cookie
// and no preview header, get different post lists, different topics, different
// search results and a different graph. A cache that did not know that would
// serve an Arabic reader's collection to an English one — the same class of
// bug the Cookie dimension was added to prevent, one axis over.
const VARY_ON = "Cookie, X-Vellum-Preview, X-Vellum-Lang";

api.use("*", async (c, next) => {
  await next();
  const headers = c.res.headers;
  const cache = headers.get("Cache-Control");
  if (cache?.includes("immutable")) return; // content-addressed, session-free
  const vary = headers.get("Vary");
  if (!vary) headers.set("Vary", VARY_ON);
  else if (!/\bcookie\b/i.test(vary)) headers.set("Vary", `${vary}, ${VARY_ON}`);
  if (!cache) headers.set("Cache-Control", "private, no-store");
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

// Typography: the catalog cache under VELLUM_DATA/fonts/catalog/<id>/<file>,
// referenced by every src in the generated /api/site-fonts.css. Same openness
// as /api/fonts/<file> above (it is prefix-exempted in the auth guard) and the
// same path discipline, tightened: the directory must be a KNOWN catalog id —
// an allowlist, not a sanitizer — and the filename must match the shape this
// server generates (lowercase slug + .woff2). Nothing else is reachable.
api.get("/fonts/catalog/:id/:file", async (c) => {
  const id = c.req.param("id");
  const file = c.req.param("file");
  if (!catalogEntry(id) || !isCacheFileName(file)) {
    return c.json({ error: "Font not found" }, 404);
  }
  const abs = path.join(fontDir(id), file);
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    const read = await fsp.readFile(abs);
    bytes = new Uint8Array(read.buffer.slice(read.byteOffset, read.byteOffset + read.byteLength));
  } catch {
    return c.json({ error: "Font not found" }, 404);
  }
  const etag = `"${bytes.byteLength.toString(16)}-${id}-${file}"`;
  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").some((tag) => tag.trim() === etag || tag.trim() === `W/${etag}`)) {
    return c.body(null, 304, { "ETag": etag });
  }
  return c.body(bytes, 200, {
    "Content-Type": "font/woff2",
    "ETag": etag,
    // Content-stable: the cache path changes when the family changes.
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  });
});

// The generated typography stylesheet: self-hosted @font-face blocks for the
// chosen catalog faces, three composite families (the Arabic slot's faces
// first, narrowed to the Arabic unicode ranges, so a mixed paragraph picks the
// right face per CHARACTER), then the :root remap of --font-serif/--font-ui/
// --font-mono. Open like custom.css — it IS the public site's typography —
// and it contains no external URL by construction: every src points back at
// /api/fonts/catalog/… on this server.
api.get("/site-fonts.css", async (c) => {
  const slots = fontSlots();
  const css = slotsAreSystem(slots) ? "/* No webfonts configured. */\n" : await buildFontCss(slots, {
    prefix: "Vellum",
    root: true,
  });
  return c.body(css, 200, {
    "Content-Type": "text/css; charset=utf-8",
    // The link carries a ?v= signature of the picks, so a save shows up at
    // once; the bytes themselves may be revalidated cheaply.
    "Cache-Control": "no-cache",
  });
});

// The uploaded faces, as the Typography tab lists them. It sits HERE, above
// GET /fonts/:file, because that route's `:file` would otherwise swallow the
// word "custom" — and it gates itself rather than leaning on the auth guard,
// because the /api/fonts/ prefix is exempt from the guard for READS (the
// bytes are public; the inventory is not). Same shape as GET /api/settings:
// a visitor, or an admin previewing as one, gets a 404.
api.get("/fonts/custom", async (c) => {
  if (isPublishLimited(c)) throw new VaultError(404, "Not found");
  return c.json(await listCustomFonts());
});

// Uploaded faces (VELLUM_DATA/fonts/custom/<file>). Served on exactly the
// terms the catalog cache is — open like custom.css, because a face IS the
// public site's typography and the login page of a PUBLIC=false vault should
// render in it — and with exactly the same path discipline: the name must
// match the shape the uploader GENERATES (lowercase slug + a known font
// extension), so nothing else under the directory is reachable and no caller
// string is ever joined into a path.
api.get("/fonts/custom/:file", async (c) => {
  const file = c.req.param("file");
  if (!isCustomFileName(file)) return c.json({ error: "Font not found" }, 404);
  const abs = path.join(customDir(), file);
  let stat;
  try {
    // lstat, NOT stat: `stat` follows symlinks, so a link planted in the fonts
    // directory served whatever it pointed at. Verified: `symlink.woff2` →
    // /etc/passwd came back 200 with `Content-Type: font/woff2`, to an
    // anonymous request, on a route deliberately exempted from the auth guard
    // so the login page of a private vault can render in the instance's face.
    // Nothing the API does can create such a link (names are generated), but
    // this route reads a directory a human also writes into, and refusing a
    // link outright costs one letter.
    stat = await fsp.lstat(abs);
    if (!stat.isFile()) throw new Error("not a regular file");
  } catch {
    return c.json({ error: `Font not found: ${file}` }, 404);
  }
  const etag = `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
  const ifNoneMatch = c.req.header("if-none-match");
  if (ifNoneMatch && ifNoneMatch.split(",").some((tag) => tag.trim() === etag || tag.trim() === `W/${etag}`)) {
    return c.body(null, 304, { "ETag": etag });
  }
  const nodeStream = createReadStream(abs);
  nodeStream.on("error", (err: unknown) => console.error(`font stream error for ${file}:`, err));
  return c.body(Readable.toWeb(nodeStream) as unknown as ReadableStream, 200, {
    "Content-Type": customMime(file),
    "ETag": etag,
    // A replaced face is a new filename (the uploader never overwrites), so
    // these bytes are content-stable like the catalog cache.
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": String(stat.size),
  });
});

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
    // lstat for the reason the custom-font route above states: this one is the
    // custom.css escape hatch, so the directory it reads is written by hand.
    stat = await fsp.lstat(abs);
    if (!stat.isFile()) throw new Error("not a regular file");
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

// Any write can reshape the vault, and the watcher that would notice is
// debounced 100 ms — long enough for the client's own "create note, then
// refetch the tree" round trip to be answered from a stale memo. Dropping it
// up front costs one directory walk on the next read and removes the race
// entirely. See server/treeCache.ts for the full invalidation contract.
api.use("*", async (c, next) => {
  const writes = c.req.method !== "GET" && c.req.method !== "HEAD";
  if (writes) {
    invalidateTree();
    invalidateGraph();
  }
  await next();
  // Again on the way out: a concurrent read that arrived mid-write could have
  // re-memoized the pre-write state between those two points.
  if (writes) {
    invalidateTree();
    invalidateGraph();
  }
});

api.onError((err, c) => {
  if (err instanceof VaultError) {
    // `code` rides beside `error` when the thrower named one: the prose is for
    // logs and curl, the code is what a localized UI can translate.
    return c.json(
      err.code ? { error: err.message, code: err.code } : { error: err.message },
      err.status as ContentfulStatusCode,
    );
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
function publishedTree(lang: FilterLang): TreeNode {
  const children: TreeNode[] = publishedNotes(lang)
    .map(({ path: notePath, title }) => ({ name: title, path: notePath, type: "file" as const }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { name: path.basename(getVaultRoot()), path: "", type: "folder", children };
}

// The admin tree carries the vault's ATTACHMENTS as well as its notes (each
// non-markdown file gets a TreeNode.attachment marker) — a Media/ folder that
// expanded to nothing was read by a real owner as "my files are missing".
// The visitor tree does not, and cannot: publishedTree() is built from
// publishedNotes() alone, so no filename outside the published set is ever
// named to a visitor (or to an admin previewing as one), whatever the sidebar
// is showing at the time. Attachment BYTES stay gated by /api/file's
// allowlist check either way.
api.get("/tree", async (c) => {
  const limited = isPublishLimited(c);
  // The visitor tree is NOT memoized here: it is language-scoped, so it varies
  // per reader (the cache would need the lang in its key, and this arm is a
  // filter over an in-memory set rather than a disk walk).
  if (limited) return c.json(publishedTree(languageScope(c, limited).lang));
  // The ADMIN tree is memoized (server/treeCache.ts): the walk, its JSON and
  // its compressed forms are rebuilt only after something could have changed
  // the vault's shape. Was a full recursive readdir per request — ~29 ms and
  // 171 kB on the 1,388-note fixture, asked for on every vault event.
  return sendEncoded(c, await treeBody());
});

api.get("/note", async (c) => {
  const notePath = requiredQuery(c.req.query("path"), "path");
  if (isPublishLimited(c) && !isNotePublished(normalizeRel(notePath))) {
    throw new VaultError(404, `Note not found: ${normalizeRel(notePath)}`);
  }
  return c.json(await readNote(notePath));
});

/** The optional `baseMtimeMs` write precondition off a request body. Validated
 *  here; enforced by `writeNote`, next to the write it guards. Only the
 *  editor's buffer registry sends it — the publish toggle, the banner setter,
 *  the section writer and the rename link-rewrite each derive a whole file from
 *  the one they are about to replace, and keep today's behaviour. */
function baseMtime(body: Record<string, unknown>): number | undefined {
  const base = body.baseMtimeMs;
  if (base === undefined || base === null) return undefined;
  if (typeof base !== "number") {
    throw new VaultError(400, 'Body field "baseMtimeMs" must be a number');
  }
  return base;
}

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
  const written = await writeNote(path, body.content, baseMtime(body));
  emitEvent({ kind: existed ? "changed" : "created", path: written.path });
  // Index now rather than after the watcher debounce, so an immediately
  // following rename/search sees this note's links.
  await indexFile(written.path);
  return c.json(written);
});

/** The same write, reachable by `navigator.sendBeacon`.
 *
 *  It exists for exactly one moment: the tab is closing with unsaved text in it.
 *  A `fetch` started in `beforeunload` is cancelled with the document, and
 *  `keepalive` is capped and unreliable across browsers; `sendBeacon` is the one
 *  transport the platform promises to deliver after the page is gone — and it
 *  is POST-only, which is the entire reason this route is a POST of something
 *  `PUT /note` already does.
 *
 *  Everything else about it is identical, including the precondition: a
 *  last-gasp save that clobbers a newer version is still a clobber, and the
 *  reader who caused it is by definition not there to be asked. */
api.post("/note/flush", async (c) => {
  const body = await jsonBody(c);
  const path = requiredString(body, "path");
  if (typeof body.content !== "string") {
    throw new VaultError(400, 'Body field "content" must be a string');
  }
  const existed = await noteExists(path);
  suppressWatcherEcho(path);
  const written = await writeNote(path, body.content, baseMtime(body));
  emitEvent({ kind: existed ? "changed" : "created", path: written.path });
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

// Delete ONE note. Same two-speed contract as DELETE /api/folder, and for the
// same reason: the default MOVES the file to `.trash/` (recoverable from disk,
// invisible to tree/index/watcher), `?permanent=true` removes it for good.
// The parameter is spelled and parsed exactly like the folder route's —
// `1`/`true`/`yes`/`on` — so one rule covers both delete verbs.
api.delete("/note", async (c) => {
  const notePath = requiredQuery(c.req.query("path"), "path");
  const permanent = TRUTHY_QUERY.has((c.req.query("permanent") ?? "").toLowerCase());
  const result = await deleteNote(notePath, { permanent });
  // Await the index the way DELETE /api/folder does: the client refetches
  // /api/tree, /api/graph and the published count on this 200, and a note that
  // is still in the index when they answer is a note the reader sees a second
  // time in their own search results.
  await whenIndexed();
  return c.json({ ok: true, ...result });
});

api.post("/folder", async (c) => {
  const body = await jsonBody(c);
  await createFolder(requiredString(body, "path"));
  return c.json({ ok: true });
});

// Move a folder and everything under it to a new vault-relative path — the
// server half of dragging a folder onto another folder in the tree. Same
// `{ path, toPath }` body as /api/rename, because to the reader dragging a note
// and dragging a folder are one gesture. Admin-only (the auth guard 401s every
// non-GET, preview sessions included), and every refusal — into its own
// descendant, onto an existing name, a symlinked folder — happens before a byte
// moves. See moveFolderWithLinkRewrite for the ordering.
api.post("/folder/move", async (c) => {
  const body = await jsonBody(c);
  const from = requiredString(body, "path");
  const to = requiredString(body, "toPath");
  return c.json(await moveFolderWithLinkRewrite(from, to));
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

// Delete ONE attachment, at the same two speeds as a note and a folder. The
// tree has listed a vault's images, PDFs and recordings since attachments
// landed, and offered no verb on a single one of them: the only way to remove
// a stale upload was to delete the folder around it, which is precisely the
// gesture that lost the owner a published essay's images. Admin-only via the
// auth guard (DELETE). vault.deleteAttachment emits its own synthetic event,
// so the index is settled before the answer.
api.delete("/attachment", async (c) => {
  const filePath = requiredQuery(c.req.query("path"), "path");
  const permanent = TRUTHY_QUERY.has((c.req.query("permanent") ?? "").toLowerCase());
  const result = await deleteAttachment(filePath, { permanent });
  await whenIndexed();
  return c.json({ ok: true, ...result });
});

// ------------------------------------------------------- delete preview
//
// What a delete is ACTUALLY about to take. The folder dialog used to count
// markdown and nothing else, so a folder holding four images and no notes
// said "0 notes will move" — and the essay one folder over, which still
// embedded all four, went to the public site with four broken images and no
// warning anywhere. The indexer has always known which notes point at which
// attachment (it is the same walk that decides what /api/file will serve a
// visitor); it just was not being asked before the destructive verb ran.
//
// The number that matters is not how many files go, it is how many of them
// something that SURVIVES still points at — so notes inside the target are
// not survivors, and a folder whose images only its own notes use reports 0.
//
// Admin-eyes-only: the referrer list names vault paths, which is exactly what
// /attachments and /published withhold from a visitor, so it takes the same
// 404-not-a-route gate rather than a 403.

/** How many referring notes the answer NAMES. The dialog wants to say "…by
 *  ‘essay.md’" when it can and "…by 12 notes" when it cannot; past a handful
 *  the names stop being information and start being a wall. */
const REFERRER_SAMPLE = 5;

api.get("/delete-preview", async (c) => {
  if (isPublishLimited(c)) throw new VaultError(404, "Not found");
  const target = normalizeRel(requiredQuery(c.req.query("path"), "path"));
  if (!target) throw new VaultError(400, 'Query parameter "path" is required');
  const abs = safeAbs(target);
  let stat;
  try {
    stat = await fsp.lstat(abs);
  } catch {
    throw new VaultError(404, `Not found: ${target}`);
  }

  let preview: DeletePreview;
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    const { notes: inside, attachments } = await listVaultFiles(target);
    // Notes under the folder go WITH it, so a link from one of them is not a
    // link that will break. deleteFolder() applies the same ignore rules to
    // the same walk, so these are the same files it will move.
    const doomed = new Set(inside);
    const referrers = new Set<string>();
    let referenced = 0;
    for (const att of attachments) {
      const refs = notesReferencing(att).filter((p) => !doomed.has(p));
      if (refs.length === 0) continue;
      referenced++;
      for (const ref of refs) referrers.add(ref);
    }
    preview = {
      kind: "folder",
      notes: inside.length,
      attachments: attachments.length,
      referenced,
      referrers: [...referrers].sort().slice(0, REFERRER_SAMPLE),
      referrerCount: referrers.size,
    };
  } else if (stat.isSymbolicLink()) {
    // A symlink is a link: the delete unlinks it without touching whatever it
    // points at, and deleteFolder() already refuses to describe a tree it will
    // not move. Report the one file the call will actually remove.
    preview = { kind: "attachment", notes: 0, attachments: 1, referenced: 0, referrers: [], referrerCount: 0 };
  } else if (target.toLowerCase().endsWith(".md")) {
    // A note breaks things too — its incoming [[wikilinks]] go dangling — so
    // the same question is asked one object over and answered in the same
    // shape. `referenced` stays 0: it counts ATTACHMENTS, and a note is not one.
    const refs = notesLinkingTo(target);
    preview = {
      kind: "note",
      notes: 1,
      attachments: 0,
      referenced: 0,
      referrers: refs.slice(0, REFERRER_SAMPLE),
      referrerCount: refs.length,
    };
  } else {
    const refs = notesReferencing(target);
    preview = {
      kind: "attachment",
      notes: 0,
      attachments: 1,
      referenced: refs.length > 0 ? 1 : 0,
      referrers: refs.slice(0, REFERRER_SAMPLE),
      referrerCount: refs.length,
    };
  }
  return c.json(preview);
});

// ------------------------------------------------------------------- trash
//
// The bin every delete dialog in this product promises ("recoverable from
// disk") and that nothing in the product could reach. `.trash/` is a dot-dir,
// deliberately invisible to the tree, the indexer and the watcher, so honouring
// the promise meant handing the owner a terminal. These three routes close
// that loop: list it, restore out of it, empty it. Admin-only — the listing
// names deleted vault paths, so it takes the same 404-not-a-route gate
// /attachments and /published take, and the two mutations ride the auth guard.

api.get("/trash", async (c) => {
  if (isPublishLimited(c)) throw new VaultError(404, "Not found");
  const entries: TrashEntry[] = await listTrash();
  return c.json(entries);
});

// Restore one entry to its recorded origin (or beside it under a counter, or
// at the vault root when nothing recorded where it came from). The answer says
// which of those happened; the client's toast repeats it, because a silent
// "restored" that landed somewhere else is the same class of lie this whole
// round is about.
api.post("/trash/restore", async (c) => {
  const body = await jsonBody(c);
  const name = requiredString(body, "name");
  const result = await restoreFromTrash(name);
  if (result.dir) {
    // A restored folder arrives whole; the watcher would find it eventually,
    // but this route answers now and the client refetches immediately.
    await indexUnder(result.path);
    emitEvent({ kind: "created", path: result.path, dir: true });
  } else if (isNotePath(result.path)) {
    // isNotePath, not `.md`: a restored `.tex` note has to be INDEXED like the
    // note it is, not registered as an attachment (which is what an
    // extension-literal test did to it).
    await indexFile(result.path);
    emitEvent({ kind: "created", path: result.path });
  } else {
    registerAttachment(result.path);
    emitEvent({ kind: "created", path: result.path });
  }
  await whenIndexed();
  return c.json({ ok: true, path: result.path, renamed: result.renamed });
});

// The bin's own permanent delete — the one delete in the product with nothing
// behind it, which is why the client puts it behind a `grave` dialog like
// every other irreversible verb.
api.delete("/trash", async (c) => {
  const name = requiredQuery(c.req.query("name"), "name");
  await purgeFromTrash(name);
  return c.json({ ok: true });
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
  // Format-aware: markdown gets its `---` YAML line, LaTeX its `%---%` comment
  // block. Same surgical contract either way — every other byte is preserved.
  const updated = setNotePublishFlag(note.path, note.content, body.publish);
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
  const updated = setNoteFrontmatterLine(note.path, note.content, key, line);
  if (updated !== note.content) {
    suppressWatcherEcho(note.path);
    await writeNote(note.path, updated);
    emitEvent({ kind: "changed", path: note.path });
  }
  await indexFile(note.path);
  const result: FrontmatterResult = { ok: true, path: note.path, key, value };
  return c.json(result);
});

// Every alias in the vault — the name table the client cannot derive.
//
// `[[` autocomplete builds its list from the tree in the store, and a tree
// carries filenames: an alias lives in frontmatter the client has never read.
// Without this, a vault's aliases resolved when typed in full and could not be
// COMPLETED, which is the same feature working in one place and missing in the
// place the author actually reaches for it.
//
// Visitor-scoped exactly as resolution is (`aliasEntries` applies the same
// filter), so an alias can never name a note a visitor may not discover.
api.get("/aliases", (c) => {
  const limited = isPublishLimited(c);
  const response: AliasesResponse = { aliases: aliasEntries(limited, languageScope(c, limited).lang) };
  return c.json(response);
});

/** A name, not a paragraph — the same ceiling a frontmatter value gets. */
const ALIAS_MAX = 200;

// Add one alias to a note's frontmatter — the write behind "keep the old title
// as an alias" after a rename. Merging and format (a `.tex` note's aliases live
// in its comment block) belong to server/noteFrontmatter.ts; this route is the
// same read-edit-write-reindex shape /api/frontmatter uses, including the
// watcher-echo suppression that stops the edit arriving twice.
api.post("/alias", async (c) => {
  const body = await jsonBody(c);
  const notePath = requiredString(body, "path");
  // Same discipline as /api/frontmatter: one line, no control characters — a
  // frontmatter write must never be able to smuggle extra YAML into the block.
  const alias = requiredString(body, "alias").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (!alias) throw new VaultError(400, 'Body field "alias" must not be blank');
  if (alias.length > ALIAS_MAX) {
    throw new VaultError(400, `Alias too long (${ALIAS_MAX} characters max)`);
  }
  const note = await readNote(notePath);
  const updated = addNoteAlias(note.path, note.content, alias);
  if (updated !== note.content) {
    suppressWatcherEcho(note.path);
    await writeNote(note.path, updated);
    emitEvent({ kind: "changed", path: note.path });
  }
  await indexFile(note.path);
  return c.json({ ok: true, path: note.path, alias });
});

api.get("/resolve", (c) => {
  const name = requiredQuery(c.req.query("name"), "name");
  // A miss is an EXPECTED outcome (broken embeds are normal in a real vault):
  // answer 200 { path: null } instead of 404 so every visit to a note with
  // broken embeds doesn't spray red network errors across the console.
  const limited = isPublishLimited(c);
  return c.json({ path: resolveEmbed(name, limited, languageScope(c, limited).lang) });
});

// A `banner:` value (or any settings image reference) → the file it names.
//
// The client cannot answer this itself: the ladder ends in the vault-wide
// basename index, and a visitor's tree does not carry attachments at all. A
// miss is 200 `{ path: null }`, like /api/resolve — a typo'd banner is an
// ordinary state of a vault, not a server error — and null is exactly what the
// admin surfaces turn into the "missing image" placeholder and the visitor
// surfaces turn into nothing at all.
//
// `note` is the note the value was read from, and it is what makes
// `banner: cover.png` beside the note work. Visitors are scoped to files
// /api/file would actually serve them, so this can never become a probe for
// which unpublished attachments exist.
api.get("/banner", (c) => {
  const value = requiredQuery(c.req.query("value"), "value");
  const note = c.req.query("note");
  let notePath: string | null = null;
  if (note !== undefined && note !== "") {
    try {
      notePath = normalizeRel(note);
    } catch {
      notePath = null; // an unusable note path just drops the relative rung
    }
  }
  const limited = isPublishLimited(c);
  // A visitor may not use a private note's folder as the search base, and may
  // not learn where anything they cannot fetch lives.
  if (limited && notePath !== null && !isNoteVisibleToVisitor(notePath, languageScope(c, limited).lang)) {
    notePath = null;
  }
  const hit = resolveBannerRef(
    value,
    notePath,
    limited,
    // The two visitor-fetchable sets /api/file itself honours: attachments a
    // published note uses, plus the assets settings names (logo, home banner,
    // favicon). Resolving to a path the very next request would 404 on is the
    // failure this endpoint exists to remove.
    (rel) => isAllowedAttachment(rel) || settingsAssetPaths().has(rel),
  );
  const result: BannerResolution = { value, path: hit };
  return c.json(result);
});

// ------------------------------------------------ anchors & cross-references
//
// One anchor space: a markdown heading and a LaTeX \label are the same kind of
// thing, so these two routes serve `[[Note#anchor]]`, `\ref{Note#anchor}`,
// `![[Paper#eq:fourier]]` and the `#` half of wikilink autocomplete without
// any of them knowing the target's format.

api.get("/anchors", (c) => {
  const notePath = normalizeRel(requiredQuery(c.req.query("path"), "path"));
  // Same gate /api/note applies: a visitor may read a published note, so a
  // visitor may read where its anchors are. Nothing else.
  if (isPublishLimited(c) && !isNotePublished(notePath)) {
    throw new VaultError(404, `Note not found: ${notePath}`);
  }
  const result: AnchorsResponse = { path: notePath, anchors: noteAnchors(notePath) };
  return c.json(result);
});

// A `\ref{sec:method}` or `\cite{knuth1997}` that found nothing LOCAL — the
// caller has already checked its own document, because local-first is what
// keeps an imported project compiling the way it always did. A miss is 200
// with nulls, like /api/resolve: unresolved cross-references are the normal
// state of a bibliography, not an error worth painting red in a console.
api.get("/xref", (c) => {
  const limited = isPublishLimited(c);
  const label = c.req.query("label");
  const cite = c.req.query("cite");
  if (label === undefined && cite === undefined) {
    throw new VaultError(400, "Missing query param: label or cite");
  }
  const result: XrefResponse = { path: null, anchor: null };
  if (label !== undefined && label !== "") {
    const hit = resolveLabel(label, limited, languageScope(c, limited).lang);
    if (hit) {
      result.path = hit.path;
      result.anchor = hit.anchor;
    }
  } else if (cite !== undefined && cite !== "") {
    result.path = resolveCitekey(cite, limited, languageScope(c, limited).lang);
  }
  return c.json(result);
});

// The `vellum.sty` a `.tex` note needs to compile OUTSIDE Vellum. It is a
// dozen lines and it is the whole reason `\note{…}` is an honest syntax rather
// than a lock-in: drop this beside the document, `\usepackage{vellum}`, and
// pdflatex renders the link as a hyperref (or as emphasis when hyperref is not
// loaded). Served to anyone who can reach the instance — it is a constant,
// carries nothing about the vault, and a reader who cannot download it cannot
// compile the paper they were just shown.
const VELLUM_STY_PATH = new URL("../assets/vellum.sty", import.meta.url).pathname;
let vellumStyCache: string | null = null;

api.get("/vellum.sty", (c) => {
  vellumStyCache ??= readFileSync(VELLUM_STY_PATH, "utf8");
  return c.body(vellumStyCache, 200, {
    "Content-Type": "text/x-tex; charset=utf-8",
    "Content-Disposition": 'inline; filename="vellum.sty"',
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
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

/** ISO-BMFF brand → canonical extension (the `ftyp` box at offset 4 is what
 *  separates an .avif from an .m4a from a .mov — they share one container). */
function brandExt(brand: string): string {
  if (brand === "avif" || brand === "avis") return "avif";
  if (brand.startsWith("heic") || brand.startsWith("heix") || brand === "mif1" || brand === "hevc") {
    return "heic";
  }
  if (brand === "M4A ") return "m4a";
  if (brand === "qt  ") return "mov";
  return "mp4";
}

/** Sniff the actual attachment type from file bytes — extension and
 *  Content-Type are attacker-controlled and ignored. Returns the canonical
 *  extension, or null when the bytes are not a type we accept.
 *
 *  `hint` is the uploader's own extension, consulted ONLY to pick between
 *  aliases the bytes cannot distinguish (jpg/jpeg, ogg/oga/opus, mp4/m4v);
 *  the family is always decided by the magic number. */
function sniffAttachmentType(buf: Buffer, hint = ""): string | null {
  const alias = (canonical: string, others: string[]): string =>
    others.includes(hint) ? hint : canonical;
  const latin = (from: number, to: number): string =>
    buf.length >= to ? buf.toString("latin1", from, to) : "";

  // ── images ──
  if (buf.length >= 8 && buf[0] === 0x89 && latin(1, 4) === "PNG") return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return alias("jpg", ["jpeg"]);
  }
  if (buf.length >= 6 && /^GIF8[79]a/.test(latin(0, 6))) return "gif";
  if (latin(0, 4) === "RIFF" && latin(8, 12) === "WEBP") return "webp";
  if (latin(0, 2) === "BM" && buf.length >= 14) return "bmp";
  // ── documents ──
  if (latin(0, 5) === "%PDF-") return "pdf";
  // ── audio ──
  if (latin(0, 3) === "ID3") return "mp3";
  if (latin(0, 4) === "RIFF" && latin(8, 12) === "WAVE") return "wav";
  if (latin(0, 4) === "OggS") return alias("ogg", ["oga", "opus"]);
  if (latin(0, 4) === "fLaC") return "flac";
  // ── ISO base media: mp4 / m4a / mov / avif / heic ──
  if (latin(4, 8) === "ftyp") {
    const ext = brandExt(latin(8, 12));
    return ext === "mp4" ? alias("mp4", ["m4v"]) : ext;
  }
  // ── Matroska / WebM ──
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return "webm";
  }
  // An mp3 with no ID3 tag opens on a raw MPEG audio frame sync. Checked LAST
  // of the binary formats: 0xFF 0xEx is two bytes, weak enough that anything
  // with a real magic number must get its say first.
  if (buf.length >= 4 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "mp3";
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
// "file"; bytes sniffed for a type we accept; stored in the folder the
// attachment-location setting resolves to (vault-relative, created on demand)
// with a collision-free sanitized name. The optional field "dir" names the
// vault folder the upload happened IN — the open note's folder, or the tree
// row it was dropped on — which is what the "same folder" and "subfolder"
// modes are relative to; the other two modes ignore it.
api.post("/upload", async (c) => {
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody();
  } catch {
    throw new VaultError(400, "Invalid multipart body");
  }
  const file = form.file;
  if (!(file instanceof File)) {
    throw new VaultError(400, 'Multipart field "file" (the attachment) is required');
  }
  if (file.size > UPLOAD_MAX_BYTES) {
    throw new VaultError(413, `File too large (${UPLOAD_MAX_BYTES} bytes max)`);
  }
  let buf = Buffer.from(await file.arrayBuffer());
  const ext = sniffAttachmentType(buf, extensionOf(typeof file.name === "string" ? file.name : ""));
  if (!ext) {
    // CODED, so the client can say it in the reader's language (see the API
    // section of CONTRACTS: the prose here is for a log and for curl). The
    // code kept its name through the widening from images to every accepted
    // attachment — it is a wire contract, and what it means ("the bytes are
    // not a kind this vault takes") did not change.
    throw new VaultError(
      400,
      `Not a recognized attachment (${[...new Set(Object.keys(ATTACHMENT_TYPES))].join(", ")})`,
      "upload_not_image",
    );
  }
  if (ext === "svg") buf = Buffer.from(sanitizeSvg(buf.toString("utf8")), "utf8");
  // `dir` is the folder the upload happened IN — CONTEXT, not a destination.
  // The attachment-LOCATION setting decides what that means: "same folder" and
  // "subfolder" are relative to it, "vault root" and "specified" ignore it.
  // It is advisory and untrusted either way: normalizeFolder tidies it, and
  // safeAbs in the loop below is what actually refuses anything outside the
  // vault. There is deliberately no "must already exist" check — "subfolder"
  // mode creates its folder on first upload, which is the whole point of it.
  const context = typeof form.dir === "string" ? normalizeFolder(form.dir) : "";
  const dir = uploadDirFor(context);
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

// The admin UI's publish state, from an ADMIN source. The client used to read
// it off /api/tree with `credentials: "omit"` — its own session hidden so the
// server would answer as if to a stranger — which meant the owner's publish
// stars and published filter were built out of the VISITOR tree, and so wore
// the visitor's languageFilter (CONTRACTS.md: "Admin surfaces are never
// filtered"). It also made the whole feature conditional on a password hash
// plus open public reads, so an open local vault silently had no publish
// marks at all. Same 404-not-a-route gate as /attachments: a language-hidden
// published note's path is exactly what the public surfaces withhold.
api.get("/published", (c) => {
  if (isPublishLimited(c)) throw new VaultError(404, "Not found");
  const body: PublishedPaths = { paths: publishedPaths() };
  return c.json(body);
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
  if (!isNotePath(notePath)) {
    throw new VaultError(400, `Not a note path: ${rel}`);
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

// Every discovery surface below resolves ONE scope and hands `scope.lang` down
// (server/language.ts). An admin session gets `null` — no filter, ever.
//
// SEARCH MATCHES BOTH SPELLINGS OF A TAG. `expandTagQuery` appends the
// canonical tag whenever the query holds one of its localised labels, so an
// Arabic reader typing «برمجيات» finds the notes tagged `#software` — without
// the index ever learning about a display setting (see server/tagLabels.ts for
// why the rewrite lives on the query and not in minisearch's `tags` field).
api.get("/search", (c) => {
  const limited = isPublishLimited(c);
  return c.json(
    search(expandTagQuery(c.req.query("q") ?? ""), limited, languageScope(c, limited).lang),
  );
});

// `?around=<path>` answers with just that note's neighborhood — the shape the
// backlinks panel's local graph draws. Without it the panel pulled the ENTIRE
// vault graph (534 kB on the 1,388-note fixture, ~4 MB on a 10k-note vault)
// on every app open in order to render a dozen nodes. Both forms are memoized
// per audience AND per language; see server/graphCache.ts.
api.get("/graph", (c) => {
  const publishedOnly = isPublishLimited(c);
  const lang = languageScope(c, publishedOnly).lang;
  const around = c.req.query("around");
  if (around === undefined || around === "") {
    return sendEncoded(c, graphBody(publishedOnly, lang));
  }
  // Slices are small and there are as many as there are notes, so they are
  // built per request and compressed by the ordinary middleware rather than
  // memoized per path.
  return c.body(localGraphJson(normalizeRel(around), publishedOnly, lang), 200, {
    "Content-Type": "application/json",
  });
});

api.get("/backlinks", (c) => {
  const notePath = requiredQuery(c.req.query("path"), "path");
  const limited = isPublishLimited(c);
  return c.json(backlinks(normalizeRel(notePath), limited, languageScope(c, limited).lang));
});

// Topics. A tag carried only by notes the reader's language hides must not
// appear as a pill: its page would come back empty, and the count on it is an
// existence leak.
api.get("/tags", (c) => {
  const limited = isPublishLimited(c);
  return c.json(tags(limited, languageScope(c, limited).lang));
});

// The DISPLAY names of those tags: canonical tag → language → label, merged
// from the tag pages' own frontmatter and settings.tagLabels. Open to every
// session, because a chip's word is what the public site paints — and scoped
// exactly like /api/tags above, so it can never become an oracle for a tag
// EXCLUDE_TAGS or the language filter is hiding. The canonical tag stays the
// key everywhere: this route changes what a reader SEES and nothing else.
api.get("/tag-labels", (c) => {
  const limited = isPublishLimited(c);
  const response: TagLabelsResponse = {
    labels: visibleTagLabels(limited, languageScope(c, limited).lang),
  };
  return c.json(response);
});

// Blog: published notes as posts, newest first. Visitor-safe by construction
// (published notes only, EXCLUDE_TAGS filtered). With COMMENTS=on each post
// carries its comment count — the one per-session branch: visitors count
// visible comments only, admin sessions include hidden ones.
api.get("/posts", (c) => {
  // Visitor sessions (and admin-as-visitor preview) get the language filter
  // applied at the scope this request resolved to; admin lists are never
  // filtered. The blog client derives prev/next adjacency from this list, so
  // an Arabic reader's "next post" is the next post THEY can read.
  // Static pages leave the feed ONLY in designed mode (server/pages.ts): with
  // the stock blog on, staticPagesActive() is false and this is the call it
  // always was.
  const limited = isPublishLimited(c);
  const list = posts(limited, languageScope(c, limited).lang, staticPagesActive());
  if (commentsEnabled()) {
    const counts = commentCounts(!limited);
    for (const post of list) post.commentCount = counts.get(post.path) ?? 0;
  }
  return c.json(list);
});

// -------------------------------------------------------------------- design
// The site design engine (VELLUM_DATA/designs.json): named, versioned designs
// and custom themes. Mounted here, BELOW the auth guard, so every mutation
// under the prefix is already 401 to a visitor and to an admin wearing the
// preview header; the routes add the read-side gate themselves. Two routes
// under it are deliberately public — /api/design/public (the active design,
// scrubbed per session) and /api/design/themes.css (styling, like
// custom.css). See server/designRoutes.ts.
api.route("/design", designRoutes);
// --------------------------------------------------------------------- books
// The reader (VELLUM_DATA/books.json): the vault's PDFs as a shelf, and where
// each one was left off. Mounted here, below the auth guard, so the writes are
// already admin-only; both reads add `assertAdminRead` themselves because a
// shelf is an enumeration of the owner's own directory. The PDF BYTES are not
// served from here at all — the reader fetches them from /api/file, gated
// exactly as every embed is. See server/bookRoutes.ts.
api.route("/books", bookRoutes);
// ---------------------------------------------------------------- visibility
// "What will this setting cost me?", answered in notes, from this vault,
// BEFORE the save. Admin-only (the counts describe exactly what the public
// surfaces withhold), and every query param is a HYPOTHETICAL: absent ones
// describe what is in force right now, so the settings panel can ask the same
// route for "as it stands" and "as it would be" and print the difference.
//
// It exists because the owner enabled a boolean and his public site dropped
// from 20 posts to 2 with no warning anywhere. A control that can hide a site
// must state its consequence in real numbers, and only the server holds those
// numbers.
api.get("/visibility", (c) => {
  if (isPublishLimited(c)) throw new VaultError(404, "Not found");
  const query: VisibilityQuery = {};
  const mode = c.req.query("languageFilter")?.trim().toLowerCase();
  if (mode !== undefined && mode !== "") {
    if (!(LANGUAGE_FILTER_MODES as readonly string[]).includes(mode)) {
      throw new VaultError(400, `languageFilter must be one of: ${LANGUAGE_FILTER_MODES.join(", ")}`);
    }
    query.languageFilter = mode as LanguageFilterMode;
  }
  const tags = c.req.query("excludeTags");
  if (tags !== undefined) {
    query.excludeTags = tags.split(",").map((t) => t.trim()).filter(Boolean);
  }
  const layout = c.req.query("publicLayout")?.trim().toLowerCase();
  if (layout === "app" || layout === "blog") query.publicLayout = layout;
  const homeMode = c.req.query("home")?.trim().toLowerCase();
  if (homeMode === "note" || homeMode === "dashboard") query.homeMode = homeMode;
  const homeNote = c.req.query("homeNote");
  // "" is meaningful here and distinct from absent: it asks "what if I cleared
  // the home note", which is a real thing the panel's field can be in.
  if (homeNote !== undefined) query.homeNote = homeNote.trim() === "" ? null : homeNote.trim();
  return c.json(visibilityFor(query));
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
  // The sync keys are the ones that can send the vault off this machine, so
  // they need a real credential in every mode — see assertCredentialed().
  // Everything else in this payload is instance styling, which open local
  // mode may legitimately let a trusted LAN change.
  if (["gitSync", "gitToken", "gitUser"].some((k) => Object.prototype.hasOwnProperty.call(body, k))) {
    assertCredentialed();
  }
  // Typography is the one setting with a prerequisite on disk: the chosen
  // families must be cached under VELLUM_DATA/fonts/catalog before
  // settings.json names them, or the site would link a stylesheet with no
  // faces behind it. Validate the ids (400), fetch what is missing (502),
  // and only then write — a download failure leaves settings untouched.
  if (Object.prototype.hasOwnProperty.call(body, "fonts") && body.fonts !== null) {
    const slots = cleanFontSlots(body.fonts, fontSlots());
    await ensureFontsCached(catalogSlotIds(slots));
    // An UPLOADED id is validated for SHAPE by cleanFontSlots and for
    // EXISTENCE here — the same "the faces are on disk before settings.json
    // names them" rule the catalog download enforces, one line down from it.
    for (const id of customSlotIds(slots)) {
      if (!(await customFontExists(id))) {
        throw new VaultError(400, `Uploaded font not found: ${customFileOf(id) ?? id}`);
      }
    }
  }
  return c.json(patchSettings(body));
});

// ------------------------------------------------------------ editor theme
// POST /api/theme { theme } — the admin's own theme, mirrored to the server.
//
// WHY A ROUTE AT ALL. The public site's default theme follows the admin's
// editor theme, and that theme has only ever lived in ONE place the server
// cannot see: `localStorage["vellum.theme"]` in whichever browser the owner
// happens to be writing in. So the browser tells it — once, after the pick has
// settled (the client debounces; see client/state.ts).
//
// Why not PATCH /api/settings: that answers with the whole settings response,
// which counts published notes, lists every image attachment and re-reads the
// font catalog. This fires on a theme click. It writes one key, validates it
// against the shared theme list, no-ops when unchanged, and answers with the
// two facts the chrome puts on screen ("Visitors see Cinnabar — following your
// editor theme"). Admin-gated by the auth guard like any other mutation, so a
// visitor's browser can never move the site's default; an admin PREVIEWING as
// a visitor is a visitor here too, and the client stands down while previewing
// rather than relying on the 401.
api.post("/theme", async (c) => {
  const body = await jsonBody(c);
  setAdminTheme(body.theme); // 400 on anything but a theme id (built-in or custom:)
  const info: PublicThemeInfo = {
    mode: themePref() === FOLLOW_THEME ? "follow" : "pinned",
    theme: visitorTheme(),
    ...(themePinnedByEnv() ? { env: true } : {}),
  };
  return c.json(info);
});

// The settings panel's live preview: the same generated CSS as
// /api/site-fonts.css but under a "VellumPreview…" family prefix and with no
// :root remap, so the panel can show faces the reader has PICKED but not yet
// saved. Admin-eyes-only (it can trigger a download, and it describes an
// unsaved state) — 404 to visitors exactly like GET /api/settings. Failures
// degrade to whatever is already cached instead of erroring: a preview that
// falls back to the system stack is a fine preview, a toast per keystroke is
// not.
api.get("/font-preview.css", async (c) => {
  if (isPublishLimited(c)) throw new VaultError(404, "Not found");
  const q = c.req.query();
  // The size-adjust dial travels too: it changes what the specimen LOOKS
  // like without changing a single id, and the whole point of the dial is
  // being judged against the Latin line beside it.
  const adjust = Number(q.sizeAdjust);
  const slots = cleanFontSlots({
    ...(q.prose ? { prose: q.prose } : {}),
    ...(q.ui ? { ui: q.ui } : {}),
    ...(q.mono ? { mono: q.mono } : {}),
    ...(q.arabic ? { arabic: q.arabic } : {}),
    ...(q.sizeAdjust && Number.isFinite(adjust) ? { arabicSizeAdjust: adjust } : {}),
  });
  for (const id of catalogSlotIds(slots)) {
    try {
      await ensureFontsCached([id]);
    } catch (err) {
      console.warn(`vellum: font preview could not cache ${id}:`, err);
    }
  }
  const css = slotsAreSystem(slots) ? "" : await buildFontCss(slots, { prefix: "VellumPreview", root: false });
  return c.body(css, 200, { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "no-cache" });
});

// ── The operator's own faces ────────────────────────────────────────────────
// Uploading a font is the one thing this product could not do that every real
// instance eventually needs: the catalog is twenty-seven Google families, and
// a serious Arabic vault runs on a licensed face that is on nobody's CDN.
//
// Everything here is admin-only. The GETs gate themselves (the /api/fonts/
// prefix is exempt from the auth guard so a VISITOR can fetch the face BYTES,
// which means a route that lists or manages them has to say so itself); the
// POST and the DELETE are mutations, which the guard now 401s under that
// prefix like anywhere else — including an admin previewing as a visitor.

// Multipart field "file". The FORMAT is decided by the magic bytes and by
// nothing else: not the extension (caller text), not the multipart
// content-type (caller text). A PNG renamed .woff2 is a 400 here, which is
// the whole point — the file is about to be served back with a font MIME.
api.post("/fonts/upload", async (c) => {
  let form: Record<string, unknown>;
  try {
    form = await c.req.parseBody();
  } catch {
    throw new VaultError(400, "Invalid multipart body", "font_bad_body");
  }
  const file = form.file;
  if (!(file instanceof File)) {
    throw new VaultError(400, 'Multipart field "file" (the font) is required', "font_no_file");
  }
  if (file.size > CUSTOM_FONT_MAX_BYTES) {
    throw new VaultError(413, `Font too large (${CUSTOM_FONT_MAX_BYTES} bytes max)`, "font_too_large");
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const format = sniffFontFormat(buf);
  if (!format) {
    throw new VaultError(400, "Not a recognized font file (woff2, woff, ttf, otf)", "font_unrecognized");
  }
  // Magic bytes say "this claims to be a font"; they do not say "a browser can
  // use this". A 4.9 MB file of literal `wOF2` plus five million zeros passed
  // the sniff, was stored, was served, and rendered nothing — a permanently
  // dead face the operator would have to work out for themselves. One cheap
  // structural read (a plausible table count, a directory that fits inside the
  // file) turns that into a 400 at upload time.
  if (!hasPlausibleTableDirectory(buf, format)) {
    throw new VaultError(400, "That font file is damaged (its table directory is unreadable)", "font_damaged");
  }
  return c.json(await saveCustomFont(file.name ?? "", format, buf));
});

// Deleting a face that a slot still names would leave settings.json pointing
// at nothing and the site silently back on its system stack — so a font in
// use is a 409 that NAMES the slots, and the panel offers to clear them.
api.delete("/fonts/custom/:file", async (c) => {
  const file = c.req.param("file");
  if (!isCustomFileName(file)) throw new VaultError(400, "Invalid font file name", "font_bad_name");
  const id = `custom:${file}`;
  const slots = fontSlots();
  const inUse = FONT_SLOTS.filter((slot) => slots[slot] === id);
  if (inUse.length > 0) {
    throw new VaultError(
      409,
      `That font is in use (${inUse.join(", ")}) — choose another face first`,
      "font_in_use",
    );
  }
  await deleteCustomFont(file);
  return c.json({ ok: true });
});

// The font PICKER's own faces: one @font-face per pickable id, under a
// "VellumOpt-…" family, so every option row renders IN THE FACE IT NAMES —
// and the Arabic options render their Arabic sample in it too. Asked for one
// GROUP at a time as that group opens, which is why the ids are a parameter
// rather than "all of them": twenty-seven families at once is a megabyte of
// downloads to draw a menu.
//
// Admin-eyes-only for /api/font-preview.css's reason (it can trigger a
// download), and just as forgiving: a family that will not cache is skipped,
// and the option row falls back to the panel's own type rather than erroring.
api.get("/font-faces.css", async (c) => {
  if (isPublishLimited(c)) throw new VaultError(404, "Not found");
  const wanted = (c.req.query("ids") ?? "").split(",").map((id) => id.trim()).filter(Boolean).slice(0, 40);
  const allowed = new Set(await pickableIds());
  const ids = [...new Set(wanted.filter((id) => allowed.has(id)))];
  for (const id of ids) {
    try {
      await ensureFontsCached([id]);
    } catch (err) {
      console.warn(`vellum: font picker could not cache ${id}:`, err);
    }
  }
  return c.body(await buildFaceListCss(ids), 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "no-cache",
  });
});

// -------------------------------------------------------------- backup & sync
// Git backup (server/gitSync.ts). Admin-eyes-only, all three: the POSTs are
// mutations, so the auth guard 401s visitors and preview sessions already; the
// GET is gated here the same way /api/settings is — a visitor learning the
// branch, the dirty count and the remote host of the operator's backup is a
// leak, and an admin PREVIEWING as a visitor must see exactly what a stranger
// would. Sync errors reaching the client are the real git line, token-scrubbed
// by gitSync.scrub() before it ever leaves the module.

// A REAL CREDENTIAL, IN EVERY MODE. In open local mode (no
// ADMIN_PASSWORD_HASH) the auth guard treats every caller as admin, so these
// three routes were reachable by anyone who could reach the port — and they
// are not ordinary admin routes: PATCH the remote, POST /sync/now, and the
// whole vault is committed and pushed to an address the caller chose. That is
// exfiltration with the operator's own git. "Everyone is admin" is a
// defensible answer for editing notes on a trusted LAN; it is not a
// defensible answer for "send my vault somewhere".
function assertCredentialed(): void {
  if (!isProtected()) {
    throw new VaultError(
      403,
      "Backup & sync needs an admin password: set ADMIN_PASSWORD_HASH (npm run hash-password) and restart. " +
        "Without one, every visitor to this port is an admin and could push your vault to a remote of their choosing.",
      "sync_needs_password",
    );
  }
}

// The STATUS read stays available in open local mode. It is the one route of
// the three that cannot move data anywhere, the client polls it on every page
// load to decide whether to draw the badge at all, and answering 403 there put
// a red line in the console of the default first-run experience for no gain:
// on an instance where every caller is already a full admin, the branch name
// leaks nothing the vault itself does not.
api.get("/sync/status", async (c) => {
  if (isPublishLimited(c)) throw new VaultError(401, "Admin session required");
  return c.json(await gitStatus());
});

api.post("/sync/init", async (c) => {
  assertCredentialed();
  return c.json(await initRepo());
});

api.post("/sync/now", async (c) => {
  assertCredentialed();
  return c.json(await syncNow("manual"));
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
async function visitorEvents(event: VaultEvent, lang: FilterLang): Promise<VaultEvent[]> {
  if (event.dir) {
    // Visitors have no folder structure, so the dir event itself is nothing
    // to them — but the notes a folder DELETE takes away are: with the event
    // dropped outright, a visitor's sidebar kept live links to notes the site
    // now 404s (client/App.tsx only reloads the tree on an event). Fan it out
    // into one "deleted" per note that was visible, sampled synchronously —
    // vault.deleteFolder emits this before the chained reindex removes the
    // records, the same before/after discipline the note branch relies on.
    // Hidden and unpublished notes are never named, so nothing leaks.
    // A folder MOVE is the same problem wearing the other verb: the notes did
    // not go away, they changed address, and a visitor holding the old one gets
    // a 404 from a link the site drew itself. Fan it out the same way, into a
    // per-note `renamed` — a published note that is hidden at its new address
    // (the languageFilter is path-blind, but publication can be re-read) leaves
    // as a `deleted`, so the curated collection stays honest either way.
    if (event.kind === "renamed" && event.toPath) {
      const dirTo = event.toPath;
      const before = visibleNotesUnder(event.path, lang);
      await whenIndexed();
      return before.map((notePath) => {
        const next = `${dirTo}${notePath.slice(event.path.length)}`;
        return isNoteVisibleToVisitor(next, lang)
          ? { kind: "renamed", path: notePath, toPath: next }
          : { kind: "deleted", path: notePath };
      });
    }
    //
    // A folder RESTORED out of `.trash/` is the same fan-out run backwards,
    // and it has to exist for the same reason: dropping the created event
    // left a visitor's sidebar missing published notes that the site was
    // already serving, until something else happened to make it reload. The
    // sample is taken AFTER the index catches up here — the notes do not
    // exist to the indexer before the restore, which is the mirror image of
    // the delete's sample-first discipline.
    if (event.kind === "created") {
      await whenIndexed();
      return visibleNotesUnder(event.path, lang).map((notePath) => ({
        kind: "created" as const,
        path: notePath,
      }));
    }
    if (event.kind !== "deleted") return [];
    const gone = visibleNotesUnder(event.path, lang);
    await whenIndexed();
    return gone.map((notePath) => ({ kind: "deleted", path: notePath }));
  }
  if (!isNotePath(event.path)) return []; // attachments: never
  const wasVisible = isNoteVisibleToVisitor(event.path, lang);
  await whenIndexed();
  switch (event.kind) {
    case "created":
    case "changed": {
      const nowVisible = isNoteVisibleToVisitor(event.path, lang);
      if (wasVisible && !nowVisible) return [{ kind: "deleted", path: event.path }];
      if (!wasVisible && nowVisible) return [{ kind: "created", path: event.path }];
      return nowVisible ? [{ kind: event.kind, path: event.path }] : [];
    }
    case "deleted":
      return wasVisible ? [{ kind: "deleted", path: event.path }] : [];
    case "renamed": {
      const nowVisible = event.toPath ? isNoteVisibleToVisitor(event.toPath, lang) : false;
      if (wasVisible && nowVisible) return [event];
      if (wasVisible) return [{ kind: "deleted", path: event.path }];
      if (nowVisible && event.toPath) return [{ kind: "created", path: event.toPath }];
      return [];
    }
  }
}

api.get("/events", (c) => {
  const limited = isPublishLimited(c);
  // Resolved ONCE, at subscribe time, and held for the life of the stream:
  // EventSource cannot set headers, so this connection's reader language came
  // in as `?lang=` (the same carve-out `?preview=visitor` gets) and cannot
  // change without a reconnect — which is exactly what the client does when a
  // visitor flips the EN/ع switch. A stream that kept re-reading the mode
  // would start announcing notes outside the collection this subscriber was
  // given, which is the leak the filter exists to prevent.
  const lang = languageScope(c, limited).lang;
  return streamSSE(c, async (stream) => {
    let live = true;
    const unsubscribe = onEvent((event) => {
      if (!live) return;
      const deliver = async (): Promise<void> => {
        const visible = limited ? await visitorEvents(event, lang) : [event];
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
  return stripNoteExt(relPath.slice(relPath.lastIndexOf("/") + 1));
}

/** Rename a note; if its title changed, rewrite [[wikilinks]] in notes that pointed at it.
 *
 *  This is also the MOVE endpoint — a drag in the tree and the "Move to…"
 *  command both land here — and a move is not a rename with a different string.
 *  Two things happen only when the FOLDER changes, and neither used to:
 *
 *   - **The moved note's own relative embeds.** `![alt](Media/x.png)` and
 *     `[see](../Ideas/Note.md)` resolve against the note's OWN directory. Drag a
 *     note one folder up and every one of them points somewhere else: the admin
 *     sees broken images, and a published note serves 404s to visitors, because
 *     the publish allowlist is built from the same resolution (`parseAssets()`).
 *     Nothing in the product said so — the images simply stopped loading.
 *   - **Other notes' markdown links TO it.** The old rewrite only knew
 *     `[[wikilinks]]`, so `[see](Ideas/Note.md)` in another note dangled.
 *
 *  Basename-form `[[Note]]` links are deliberately untouched by the move half:
 *  they resolve by name, so a move cannot break them. */
async function renameWithLinkRewrite(from: string, to: string): Promise<void> {
  const fromPath = normalizeRel(from);
  const toPath = normalizeRel(to);
  const oldTitle = basenameNoExt(fromPath);
  const newTitle = basenameNoExt(toPath);
  const titleChanged = oldTitle.toLowerCase() !== newTitle.toLowerCase();
  const oldPathNoExt = stripNoteExt(fromPath).toLowerCase();
  const newPathNoExt = stripNoteExt(toPath);
  const moved: ReadonlyMap<string, string> = new Map([[fromPath, toPath]]);
  // Capture linkers before the rename, while links still resolve to the old
  // path. Path-form links ([[Folder/Note]]) break on ANY move, so linkers are
  // captured even when the basename is unchanged.
  const linkers = [...new Set(backlinks(fromPath, false, null).map((b) => b.path))];

  await renameNote(fromPath, toPath);

  // The note's OWN body, at its new address: markdown destinations resolved
  // against the folder it left, re-expressed from the folder it arrived in.
  if (dirOf(fromPath) !== dirOf(toPath)) {
    try {
      const note: NoteData = await readNote(toPath);
      const rewritten = rewriteDestinations(
        note.content,
        dirOf(fromPath),
        dirOf(toPath),
        new Map(),
      );
      if (rewritten !== note.content) {
        // The `renamed` event already told everyone this file moved; a second
        // `changed` for the same gesture is noise.
        suppressWatcherEcho(toPath);
        await writeNote(toPath, rewritten);
      }
    } catch (err) {
      console.error(`move: failed to rewrite embeds in ${toPath}:`, err);
    }
  }

  for (const linker of linkers) {
    // A note never links to itself, but if it somehow did it now lives at `to`.
    const at = linker === fromPath ? toPath : linker;
    try {
      const note: NoteData = await readNote(at);
      let rewritten = note.content.replace(wikilinkRegex(), (whole, target: string, heading?: string, alias?: string) => {
        const t = target.trim();
        if (titleChanged && t.toLowerCase() === oldTitle.toLowerCase()) {
          return `[[${newTitle}${heading ?? ""}${alias ?? ""}]]`;
        }
        // Path-form target pointing at the old path → rewrite to the new path.
        // PATH-form only: a bare `[[Solo]]` resolves by basename and survives a
        // move untouched, and for a note at the vault ROOT its path spelling IS
        // its basename — so without this guard, moving one root note into a
        // folder rewrote every plain `[[Solo]]` in the vault into
        // `[[folder/Solo]]`, converting portable links into brittle ones and
        // dirtying files that had nothing wrong with them.
        const norm = t.toLowerCase().replace(/\\/g, "/").replace(/^\.?\/+/, "");
        if (norm.includes("/") && (norm === oldPathNoExt || norm === `${oldPathNoExt}.md`)) {
          return `[[${newPathNoExt}${heading ?? ""}${alias ?? ""}]]`;
        }
        return whole;
      });
      // …and the other syntax: `[see](Ideas/Note.md)` pointing at the file that
      // just moved. Same resolution the renderers use, so the allowlist and the
      // page agree afterwards.
      rewritten = rewriteDestinations(rewritten, dirOf(at), dirOf(at), moved);
      // …and, in a `.tex` linker, `\note{Old Title}` — Vellum's OWN macro, so
      // it is ours to keep true. `\input`, `\cite` and `\ref` are deliberately
      // NOT rewritten: they belong to the document's own semantics, and
      // silently editing them could change what `pdflatex` produces. The
      // `%% [[…]] %%` form needs nothing here — it is a wikilink, and the pass
      // above already caught it.
      if (isTexPath(at)) rewritten = rewriteTexNoteMacros(rewritten, oldTitle, newTitle, titleChanged);
      if (rewritten !== note.content) {
        await writeNote(at, rewritten);
        await indexFile(at);
      }
    } catch (err) {
      console.error(`rename: failed to rewrite links in ${at}:`, err);
    }
  }
  // The client refetches tree/graph/search on the 200; index before answering
  // rather than a watcher debounce later, so what it gets back is already true.
  await indexFile(toPath);
  await whenIndexed();
}

/** Rewrite `\note{Old}` / `\note[alias]{Old}` to the new title. Only the
 *  TARGET moves; the optional display text is the author's prose and is left
 *  exactly as written. Matching is case-insensitive on the title, the same
 *  rule wikilink resolution uses, and `\#anchor` suffixes ride along
 *  untouched — a rename changes which note is meant, never which place in it. */
function rewriteTexNoteMacros(
  src: string,
  oldTitle: string,
  newTitle: string,
  titleChanged: boolean,
): string {
  if (!titleChanged) return src;
  const want = oldTitle.toLowerCase();
  return src.replace(
    /\\note(\[[^\]]*\])?\{([^{}]*)\}/g,
    (whole, alias: string | undefined, target: string) => {
      const raw = target.trim();
      const hash = raw.search(/\\?#/);
      const head = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
      const tail = hash >= 0 ? raw.slice(hash) : "";
      if (head.toLowerCase() !== want) return whole;
      return `\\note${alias ?? ""}{${newTitle}${tail}}`;
    },
  );
}

export interface MoveFolderResponse {
  ok: true;
  /** `.md` files that travelled with the folder — the toast's number. */
  notes: number;
  /** How many notes had links or embeds rewritten. */
  rewritten: number;
}

/** Move a folder, then repair every link the move would otherwise have broken.
 *
 *  The order is the whole correctness argument, and it is the folder-DELETE
 *  order with one extra step:
 *   1. sample the affected notes while their links still resolve to the OLD
 *      paths (`notesAffectedByFolderMove`, one pass over the index);
 *   2. move — one `fs.rename`, one synthetic `{kind:"renamed", dir:true}` event,
 *      the watcher's per-file storm suppressed;
 *   3. `whenIndexed()` — the event drives `reindexFolderMove`, so from here on
 *      the index describes the new vault;
 *   4. rewrite: path-form wikilinks and markdown destinations, in the notes
 *      that moved AND in the notes that pointed into the folder;
 *   5. reindex what was rewritten, then answer. A `/api/tree` + `/api/graph`
 *      refetch on the 200 is already correct — no debounce race.
 *
 *  A rewrite that throws is logged and skipped, never retried into a half-state:
 *  the FILES are already where the caller asked, and one unreadable note must
 *  not strand the other 714. */
async function moveFolderWithLinkRewrite(from: string, to: string): Promise<MoveFolderResponse> {
  const fromPath = normalizeRel(from);
  const affected = notesAffectedByFolderMove(fromPath);
  const { notes, moved } = await moveFolder(fromPath, to);
  await whenIndexed();

  const map = new Map(moved.map((m) => [m.from, m.to]));
  const rewritten: string[] = [];
  for (const before of affected) {
    const after = map.get(before) ?? before;
    try {
      const note: NoteData = await readNote(after);
      const next = rewriteForMove(note.content, before, after, map);
      if (next === note.content) continue;
      // Notes INSIDE the folder are already covered by the one dir event;
      // notes outside it get their own `changed`, which is what tells an open
      // editor to reload a body that changed underneath it.
      if (map.has(before)) suppressWatcherEcho(after);
      await writeNote(after, next);
      rewritten.push(after);
    } catch (err) {
      console.error(`move: failed to rewrite links in ${after}:`, err);
    }
  }
  for (const notePath of rewritten) await indexFile(notePath);
  return { ok: true, notes, rewritten: rewritten.length };
}
