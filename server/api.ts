// API: the HTTP surface. Every route speaks JSON except /events (SSE).

import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { NoteData } from "../shared/types.ts";
import { authGuard, authRoutes } from "./auth.ts";
import { backlinks, graph, indexFile, resolveEmbed, search, tags, wikilinkRegex } from "./indexer.ts";
import {
  VaultError,
  buildTree,
  createFolder,
  createNote,
  deleteNote,
  onEvent,
  readNote,
  renameNote,
  statAttachment,
  writeNote,
} from "./vault.ts";

export const api = new Hono();

// Auth first: /login, /logout, /me are always reachable; the guard runs before
// every route registered below it (401s mutations without an admin session,
// and gates reads too when PUBLIC=false).
api.route("/", authRoutes);
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

api.get("/tree", async (c) => c.json(await buildTree()));

api.get("/note", async (c) => {
  const path = requiredQuery(c.req.query("path"), "path");
  return c.json(await readNote(path));
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

api.get("/resolve", (c) => {
  const name = requiredQuery(c.req.query("name"), "name");
  // A miss is an EXPECTED outcome (broken embeds are normal in a real vault):
  // answer 200 { path: null } instead of 404 so every visit to a note with
  // broken embeds doesn't spray red network errors across the console.
  return c.json({ path: resolveEmbed(name) });
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

api.get("/search", (c) => c.json(search(c.req.query("q") ?? "")));

api.get("/graph", (c) => c.json(graph()));

api.get("/backlinks", (c) => {
  const path = requiredQuery(c.req.query("path"), "path");
  return c.json(backlinks(path));
});

api.get("/tags", (c) => c.json(tags()));

api.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    let live = true;
    const unsubscribe = onEvent((event) => {
      if (!live) return;
      stream.writeSSE({ event: "message", data: JSON.stringify(event) }).catch(() => {});
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
  }),
);

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
