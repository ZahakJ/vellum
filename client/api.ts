// Typed client for the Vellum HTTP API. Every fetcher mirrors an endpoint
// in CONTRACTS.md and returns the shared wire types.

import type {
  Backlink,
  GraphData,
  MeData,
  NoteData,
  PostMeta,
  PublishResult,
  SearchHit,
  TagCount,
  TreeNode,
  VaultEvent,
} from "../shared/types.ts";

// ── Visitor preview (admin-only) ────────────────────────────────────────────
// While on, every API call carries X-Vellum-Preview: visitor and the server —
// seeing a valid admin session — walks its real visitor code path (published-
// only filtering everywhere). The client never imitates that filtering.

const PREVIEW_HEADER = "X-Vellum-Preview";
let previewOn = false;

/** Flip the preview flag for all subsequent API calls (state.ts drives this). */
export function setPreviewVisitor(on: boolean): void {
  previewOn = on;
}

/** Merge the preview header (when on) into a fetch init — for the few
 *  callers outside this module that fetch /api/* directly. */
export function withPreview(init?: RequestInit): RequestInit | undefined {
  if (!previewOn) return init;
  const headers = new Headers(init?.headers);
  headers.set(PREVIEW_HEADER, "visitor");
  return { ...init, headers };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, withPreview(init));
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON body; fall through to status handling
  }
  if (!res.ok) {
    const message =
      body !== null &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

function json(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export function getTree(): Promise<TreeNode> {
  return request<TreeNode>("/api/tree");
}

export function getNote(path: string): Promise<NoteData> {
  return request<NoteData>(`/api/note?path=${encodeURIComponent(path)}`);
}

export function putNote(path: string, content: string): Promise<NoteData> {
  return request<NoteData>(
    `/api/note?path=${encodeURIComponent(path)}`,
    json("PUT", { content }),
  );
}

export function createNote(path: string): Promise<NoteData> {
  return request<NoteData>("/api/note", json("POST", { path }));
}

export function renameNote(path: string, toPath: string): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/rename", json("POST", { path, toPath }));
}

export function deleteNote(path: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/note?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
}

export function createFolder(path: string): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/folder", json("POST", { path }));
}

export function search(q: string, signal?: AbortSignal): Promise<SearchHit[]> {
  return request<SearchHit[]>(
    `/api/search?q=${encodeURIComponent(q)}`,
    signal ? { signal } : undefined,
  );
}

export function getGraph(): Promise<GraphData> {
  return request<GraphData>("/api/graph");
}

export function getBacklinks(path: string): Promise<Backlink[]> {
  return request<Backlink[]>(`/api/backlinks?path=${encodeURIComponent(path)}`);
}

export function getTags(): Promise<TagCount[]> {
  return request<TagCount[]>("/api/tags");
}

export function getMe(): Promise<MeData> {
  return request<MeData>("/api/me");
}

/** Published notes as blog posts, newest first (blog mode's list). */
export function getPosts(): Promise<PostMeta[]> {
  return request<PostMeta[]>("/api/posts");
}

/** Toggle a note's frontmatter publish flag (admin only). */
export function publishNote(path: string, publish: boolean): Promise<PublishResult> {
  return request<PublishResult>("/api/publish", json("POST", { path, publish }));
}

/**
 * The set of published note paths, as an anonymous visitor would see them.
 * Trick: `credentials: "omit"` drops the admin session cookie, so the server
 * answers with the visitor-facing flat tree of published notes — no extra
 * endpoint needed. Only meaningful when a password hash is configured AND
 * public reads are open (otherwise the request 401s / returns the full tree).
 */
export async function getPublishedPaths(): Promise<Set<string>> {
  const tree = await request<TreeNode>("/api/tree", { credentials: "omit" });
  return new Set((tree.children ?? []).map((n) => n.path));
}

/** Throws with the server's message ("Invalid password", rate limit…) on failure. */
export function login(password: string): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/login", json("POST", { password }));
}

export function logout(): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/logout", { method: "POST" });
}

/** Subscribe to the vault SSE stream. Returns an unsubscribe function.
 *  EventSource cannot carry custom headers, so visitor preview rides on a
 *  query param instead — honored server-side only for /api/events and only
 *  with a valid admin session, the same gating as the header. */
export function subscribeEvents(cb: (ev: VaultEvent) => void): () => void {
  const source = new EventSource(previewOn ? "/api/events?preview=visitor" : "/api/events");
  source.onmessage = (e: MessageEvent<string>) => {
    try {
      cb(JSON.parse(e.data) as VaultEvent);
    } catch (err) {
      console.error("vellum: bad SSE payload", err);
    }
  };
  source.onerror = () => {
    // EventSource reconnects on its own; nothing to do.
  };
  return () => source.close();
}
