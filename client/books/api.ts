// The reader's half of /api/books. Thin on purpose — the interesting decisions
// are on the server (server/books.ts) and in the state shape
// (shared/bookAnchor.ts); this file only has to get bytes across the wire and
// keep the LAST write of a session from being lost.

import { ApiError, withPreview } from "../api.ts";
import type { BookHighlight, BookState } from "../../shared/bookAnchor.ts";
import type {
  BookHighlightSearchResponse,
  BookHighlightsResponse,
  BookLocation,
  BookOpenResponse,
  BooksResponse,
} from "../../shared/types.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, withPreview(init));
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body — the status is the whole answer
  }
  if (!res.ok) {
    const message =
      body !== null && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `HTTP ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

/** The whole shelf. One request: 400 books is 400 round trips otherwise, and
 *  a shelf that arrives in 400 pieces never finishes arriving. */
export function getBooks(): Promise<BooksResponse> {
  return request<BooksResponse>("/api/books");
}

/** One book by path — the key for its bytes and the position filed under it. */
export function openBookByPath(path: string): Promise<BookOpenResponse> {
  return request<BookOpenResponse>(`/api/books/one?path=${encodeURIComponent(path)}`);
}

/** Save a PARTIAL state. The server merges, so a scroll write carries only the
 *  page and the offset and cannot undo a zoom set a moment earlier. */
export function saveBookState(key: string, patch: Partial<BookState>): Promise<{ state: BookState }> {
  return request<{ state: BookState }>(`/api/books/state?key=${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export function forgetBookState(key: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/books/state?key=${encodeURIComponent(key)}`, { method: "DELETE" });
}

/**
 * The last save of a reading session.
 *
 * The commonest way a session ends is not "navigate away" — it is closing the
 * tab or the laptop lid, and by the time `pagehide` fires a normal `fetch` has
 * no chance of completing: the browser tears the page down first and the
 * request is cancelled in flight. `sendBeacon` is the one mechanism that
 * survives it: the request is handed to the browser process and posted after
 * the page is gone. It can only POST, which is exactly why /api/books/state
 * answers POST as well as PUT.
 *
 * Returns false when the browser refused to queue it (the beacon queue has a
 * size limit); the caller then has nothing left to try, and the position is
 * the one from the last periodic save — seconds old, not a session old.
 */
export function beaconBookState(key: string, patch: Partial<BookState>): boolean {
  if (typeof navigator.sendBeacon !== "function") return false;
  const url = `/api/books/state?key=${encodeURIComponent(key)}`;
  const blob = new Blob([JSON.stringify(patch)], { type: "application/json" });
  try {
    return navigator.sendBeacon(url, blob);
  } catch {
    return false;
  }
}

// ── Annotations ────────────────────────────────────────────────────────────
//
// The reader's half of /api/books/highlights. Same shape as the position
// routes above and the same argument for it: the decisions live on the server
// (server/books.ts) and in the validator both sides share
// (shared/bookAnchor.ts::cleanHighlight); this is the wire.

/** Every highlight in one book. Asked once per open, then kept in the
 *  component — a reader marks a passage every few minutes, not every frame. */
export function getBookHighlights(key: string): Promise<BookHighlightsResponse> {
  return request<BookHighlightsResponse>(`/api/books/highlights?key=${encodeURIComponent(key)}`);
}

/** Add or replace one highlight. An UPSERT by id: setting the ink, writing a
 *  margin note and correcting a quote are the same call with the same id. */
export function saveHighlight(
  key: string,
  highlight: BookHighlight,
): Promise<{ highlight: BookHighlight }> {
  return request<{ highlight: BookHighlight }>(
    `/api/books/highlights?key=${encodeURIComponent(key)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(highlight),
    },
  );
}

export function deleteHighlight(key: string, id: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(
    `/api/books/highlights?key=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

/** Every highlight in the vault, for the shelf's passage search. The matching
 *  happens HERE, on client/books/search.ts's fold — the one implementation of
 *  "المقدمة finds الْمُقَدِّمَة" this product has. */
export function getAllHighlights(): Promise<BookHighlightSearchResponse> {
  return request<BookHighlightSearchResponse>("/api/books/highlights/all");
}

/** Where the book carrying this citation is NOW. What a `[[…&id=…]]` asks when
 *  the filename in it no longer resolves. Rejects with a 404 ApiError when the
 *  bytes are not in this vault any more, which is a real answer. */
export function locateCitation(id: string): Promise<BookLocation> {
  return request<BookLocation>(`/api/books/locate?id=${encodeURIComponent(id)}`);
}
