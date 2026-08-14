// API: the HTTP surface. Every route speaks JSON except /events (SSE).

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { NoteData } from "../shared/types.ts";
import { backlinks, graph, search, tags, wikilinkRegex } from "./indexer.ts";
import {
  VaultError,
  buildTree,
  createFolder,
  createNote,
  deleteNote,
  onEvent,
  readNote,
  renameNote,
  writeNote,
} from "./vault.ts";

export const api = new Hono();

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
  return c.json(await writeNote(path, body.content));
});

api.post("/note", async (c) => {
  const body = await jsonBody(c);
  return c.json(await createNote(requiredString(body, "path")));
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
