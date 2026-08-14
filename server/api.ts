// API: the HTTP surface. Every route speaks JSON except /events (SSE).

import { createReadStream, readFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { CommentData, NoteData, PublishResult, TreeNode, VaultEvent } from "../shared/types.ts";
import { authGuard, authRoutes, clientIp, isPublishLimited } from "./auth.ts";
import {
  AUTHOR_MAX,
  BODY_MAX,
  addComment,
  commentRateLimited,
  commentsEnabled,
  listComments,
  phantomComment,
  recordCommentPost,
  removeComment,
} from "./comments.ts";
import {
  backlinks,
  graph,
  indexFile,
  isAllowedAttachment,
  isNotePublished,
  publishedNotes,
  resolveEmbed,
  search,
  tags,
  whenIndexed,
  wikilinkRegex,
} from "./indexer.ts";
import { setPublishFlag } from "./publish.ts";
import { customCssPath } from "./site.ts";
import {
  VaultError,
  buildTree,
  createFolder,
  createNote,
  deleteNote,
  emitEvent,
  getVaultRoot,
  normalizeRel,
  onEvent,
  readNote,
  renameNote,
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

function tooLarge(maxBytes: number) {
  return (c: Context) => c.json({ error: `Request body too large (${maxBytes} bytes max)` }, 413);
}

const TIGHT_BODY_PATHS = new Set(["/api/comments", "/api/login"]);
api.use("*", async (c, next) => {
  const max =
    c.req.method === "POST" && TIGHT_BODY_PATHS.has(c.req.path) ? COMMENT_BODY_MAX : API_BODY_MAX;
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
  const written = await writeNote(path, body.content);
  // Index now rather than after the watcher debounce, so an immediately
  // following rename/search sees this note's links.
  await indexFile(path);
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

function contentTypeFor(relPath: string): string {
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
  if (isPublishLimited(c) && !isAllowedAttachment(normalizeRel(relQuery))) {
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

api.get("/comments", (c) => {
  assertCommentsEnabled();
  const notePath = commentNotePath(requiredQuery(c.req.query("path"), "path"));
  // Admins may read (moderate) comments on any note; visitors only where
  // the note itself is visible to them.
  if (isPublishLimited(c) && !isNotePublished(notePath)) {
    throw new VaultError(404, `Note not found: ${notePath}`);
  }
  return c.json(listComments(notePath));
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
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body) throw new VaultError(400, 'Body field "body" must be a non-empty string');
  if (body.length > BODY_MAX) {
    throw new VaultError(400, `Comment is too long (${BODY_MAX} characters max)`);
  }
  const author =
    (typeof payload.author === "string" ? payload.author.trim().slice(0, AUTHOR_MAX) : "") ||
    "Anonymous";
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

// ---------------------------------------------------------------- SSE events

/** Map a vault event to what a publish-limited visitor may see: only events
 *  about published notes; unpublished paths are stripped from renames; a
 *  publish/unpublish transition becomes created/deleted so the curated
 *  collection stays honest. Captures pre-event state synchronously, then
 *  awaits the indexer before reading post-event state. */
async function visitorEvent(event: VaultEvent): Promise<VaultEvent | null> {
  if (event.dir) return null; // no folder structure for visitors
  if (!event.path.toLowerCase().endsWith(".md")) return null; // attachments: never
  const wasPublished = isNotePublished(event.path);
  await whenIndexed();
  switch (event.kind) {
    case "created":
    case "changed": {
      const nowPublished = isNotePublished(event.path);
      if (wasPublished && !nowPublished) return { kind: "deleted", path: event.path };
      if (!wasPublished && nowPublished) return { kind: "created", path: event.path };
      return nowPublished ? { kind: event.kind, path: event.path } : null;
    }
    case "deleted":
      return wasPublished ? { kind: "deleted", path: event.path } : null;
    case "renamed": {
      const nowPublished = event.toPath ? isNotePublished(event.toPath) : false;
      if (wasPublished && nowPublished) return event;
      if (wasPublished) return { kind: "deleted", path: event.path };
      if (nowPublished && event.toPath) return { kind: "created", path: event.toPath };
      return null;
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
        const visible = limited ? await visitorEvent(event) : event;
        if (!visible || !live) return;
        await stream.writeSSE({ event: "message", data: JSON.stringify(visible) });
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
  // Capture linkers before the rename, while links still resolve to the old path.
  const linkers = titleChanged ? [...new Set(backlinks(from).map((b) => b.path))] : [];

  await renameNote(from, to);

  for (const linker of linkers) {
    try {
      const note: NoteData = await readNote(linker);
      const rewritten = note.content.replace(wikilinkRegex(), (whole, target: string, heading?: string, alias?: string) =>
        target.trim().toLowerCase() === oldTitle.toLowerCase()
          ? `[[${newTitle}${heading ?? ""}${alias ?? ""}]]`
          : whole,
      );
      if (rewritten !== note.content) await writeNote(linker, rewritten);
    } catch (err) {
      console.error(`rename: failed to rewrite links in ${linker}:`, err);
    }
  }
}
