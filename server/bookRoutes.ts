// HTTP surface for the reader (server/books.ts).
//
// Mounted under /api/books from server/api.ts, BELOW `api.use("*", authGuard)`,
// so every mutation here is already 401 to a visitor and to an admin wearing
// the preview header. What the guard cannot gate is a GET, so both reads say
// `assertAdminRead(c)` in their first line — and they must, because the shelf
// is an enumeration of the owner's vault.
//
// THE BYTES DO NOT COME THROUGH HERE. The reader fetches the PDF itself from
// /api/file, the same publish-gated door every embed uses, with the same
// `Content-Security-Policy: sandbox` on it. Nothing in this file serves a
// vault file, so nothing in this file can widen who may read one: the routes
// below trade in a content hash and a page number.

import { Hono } from "hono";
import type { Context } from "hono";
import { isPublishLimited } from "./auth.ts";
import {
  allHighlights,
  deleteHighlight,
  forgetBook,
  getBookState,
  getHighlights,
  listBooks,
  locateHighlight,
  openBook,
  putBookState,
  putHighlight,
} from "./books.ts";
import { isBookKey } from "../shared/bookAnchor.ts";
import type {
  BookHighlightSearchResponse,
  BookHighlightsResponse,
  BookLocation,
  BookOpenResponse,
  BooksResponse,
} from "../shared/types.ts";
import { VaultError } from "./vault.ts";

export const bookRoutes = new Hono();

/** Admin-eyes-only READ, same shape and same reasoning as designRoutes.ts:
 *  401 rather than 404, because an admin who asked to be treated as a visitor
 *  is asking honestly and deserves an honest "not with that header on". */
function assertAdminRead(c: Context): void {
  if (isPublishLimited(c)) throw new VaultError(401, "Admin session required");
}

function requiredKey(c: Context): string {
  const key = c.req.query("key") ?? "";
  if (!isBookKey(key)) throw new VaultError(400, "A book key is required");
  return key;
}

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new VaultError(400, "Invalid JSON body");
  }
}

// The shelf. One walk of the vault plus a byte-sample hash per PDF, so it is
// the most expensive read in this file by a wide margin — and it is still one
// request, not one per book, because 400 round trips is the shape of shelf
// that never finishes painting.
bookRoutes.get("/", async (c) => {
  assertAdminRead(c);
  const { books, truncated } = await listBooks();
  const body: BooksResponse = { books, truncated };
  return c.json(body);
});

// One book, by path — what a click on a tree row asks before pdf.js has been
// downloaded. The answer carries the position, so the first page the reader
// sees is the page they left off on rather than page 1 and a jump.
bookRoutes.get("/one", async (c) => {
  assertAdminRead(c);
  const rel = c.req.query("path") ?? "";
  if (!rel.trim()) throw new VaultError(400, "A path is required");
  const entry = await openBook(rel);
  const body: BookOpenResponse = {
    path: entry.path,
    name: entry.name,
    size: entry.size,
    key: entry.key,
    state: entry.state,
  };
  return c.json(body);
});

bookRoutes.get("/state", (c) => {
  assertAdminRead(c);
  const key = requiredKey(c);
  return c.json({ key, state: getBookState(key) });
});

/** Save a position. PATCH semantics on a PUT-shaped route: the body is a
 *  PARTIAL state and is merged, so the once-a-second scroll write sends
 *  `{ page, offset }` and cannot clobber a zoom the reader changed in the
 *  meantime (shared/bookAnchor.ts::cleanBookState does the merge).
 *
 *  POST answers the same handler for exactly one caller: `navigator.sendBeacon`
 *  on pagehide, which is the only way to get the last position off a tab that
 *  is closing and which can only issue a POST. Without it the reader who quits
 *  the browser instead of navigating loses the page they were on — the single
 *  commonest way to end a reading session. */
const saveState = async (c: Context) => {
  const key = requiredKey(c);
  return c.json({ key, state: putBookState(key, await jsonBody(c)) });
};
bookRoutes.put("/state", saveState);
bookRoutes.post("/state", saveState);

// Forget one book (`:forget` in the reader's command line). The book stays on
// the shelf — this erases the position, not the file.
bookRoutes.delete("/state", (c) => {
  const key = requiredKey(c);
  forgetBook(key);
  return c.json({ ok: true as const, key });
});

// ── Annotations ────────────────────────────────────────────────────────────
//
// Same door and the same guard as everything above: a highlight is a sentence
// out of the owner's own library, so the reads say `assertAdminRead(c)` and the
// writes are already behind the auth guard. Nothing here serves a vault file
// either — the routes trade in a content key, a page number and four numbers
// between 0 and 1.

bookRoutes.get("/highlights", (c) => {
  assertAdminRead(c);
  const key = requiredKey(c);
  const body: BookHighlightsResponse = { key, highlights: getHighlights(key) };
  return c.json(body);
});

/** Add or replace one highlight. PUT and not POST because it is an UPSERT by
 *  id: changing the ink, writing a margin note and correcting the quote are
 *  the same request with the same id, made three times. */
bookRoutes.put("/highlights", async (c) => {
  const key = requiredKey(c);
  return c.json({ key, highlight: putHighlight(key, await jsonBody(c)) });
});

bookRoutes.delete("/highlights", (c) => {
  const key = requiredKey(c);
  const id = c.req.query("id") ?? "";
  deleteHighlight(key, id);
  return c.json({ ok: true as const, key, id });
});

// Every highlight in the store, for the library's passage search. The MATCHING
// is done in the client, on the same fold `/` uses inside a book
// (client/books/search.ts): "الْمُقَدِّمَة" has to be found by someone typing
// "المقدمة", and this product has exactly one implementation of that rule.
// Shipping the passages rather than the query is what lets the shelf reuse it.
bookRoutes.get("/highlights/all", (c) => {
  assertAdminRead(c);
  const { hits, truncated } = allHighlights();
  const body: BookHighlightSearchResponse = { hits, truncated };
  return c.json(body);
});

/** Where the book carrying this highlight is NOW.
 *
 *  What a citation asks when the filename in its wikilink no longer resolves.
 *  404 is a real answer here and means "these bytes are not in this vault any
 *  more" — the reader is told that, rather than being left with a link that
 *  spins. */
bookRoutes.get("/locate", async (c) => {
  assertAdminRead(c);
  const id = c.req.query("id") ?? "";
  const found = await locateHighlight(id);
  if (found === null) throw new VaultError(404, "No book carries that citation");
  const body: BookLocation = found;
  return c.json(body);
});
