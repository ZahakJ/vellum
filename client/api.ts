// Typed client for the Vellum HTTP API. Every fetcher mirrors an endpoint
// in CONTRACTS.md and returns the shared wire types.

import type {
  Backlink,
  CustomFontInfo,
  FrontmatterResult,
  GitSyncStatus,
  GraphData,
  MeData,
  NoteData,
  PostMeta,
  PublishedPaths,
  PublishResult,
  SearchHit,
  SettingsPatch,
  SettingsResponse,
  TagCount,
  TreeNode,
  UploadResult,
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

/** An HTTP error that kept its status. Callers need it because not every
 *  non-2xx is a failure worth a red toast: a 404 from `/api/note` while
 *  previewing as a visitor is the server answering CORRECTLY that the note is
 *  not published, and reporting that as "Failed to open <path>" made the very
 *  first use of preview announce a fault that did not exist. */
export class ApiError extends Error {
  readonly status: number;
  /** The server's STABLE name for this failure, when it named one.
   *
   *  `message` is the server's English prose. It reaches the reader: every
   *  `catch` in the app toasts `err.message`, which is how an Arabic-only
   *  operator came to read "Not a recognized font file (woff2, woff, ttf,
   *  otf)" inside a fully Arabic settings panel — while the `fontUploadFailed`
   *  translation written for that moment was never once rendered. A caller
   *  that can translate a code should prefer it and keep `message` as the
   *  fallback for whatever the server has not named yet. */
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** True when `err` is a 404 raised while the session was previewing as a
 *  visitor — i.e. "not published", not "broken". */
export function isNotPublishedError(err: unknown): boolean {
  return previewOn && err instanceof ApiError && err.status === 404;
}

async function request<T>(url: string, init?: RequestInit, asAdmin = false): Promise<T> {
  // asAdmin: skip the preview header — for admin actions offered INSIDE the
  // visitor preview (the dashboard's "Change banner…"), which must reach the
  // server as the real admin session or the guard would 401/404 them.
  const res = await fetch(url, asAdmin ? init : withPreview(init));
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
    const code =
      body !== null &&
      typeof body === "object" &&
      "code" in body &&
      typeof (body as { code: unknown }).code === "string"
        ? (body as { code: string }).code
        : undefined;
    throw new ApiError(message, res.status, code);
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

/** Delete ONE note. Same two speeds as `deleteFolder`, because a note is not
 *  a cheaper thing to lose than a folder: the default MOVES it to the vault's
 *  `.trash/` (the answer carries where it landed), `permanent` erases it. */
export function deleteNote(
  path: string,
  permanent = false,
): Promise<{ ok: true; trashPath?: string }> {
  return request<{ ok: true; trashPath?: string }>(
    `/api/note?path=${encodeURIComponent(path)}${permanent ? "&permanent=true" : ""}`,
    { method: "DELETE" },
  );
}

export function createFolder(path: string): Promise<{ ok: true }> {
  return request<{ ok: true }>("/api/folder", json("POST", { path }));
}

/** Delete a folder recursively. Default is Obsidian-safe: the folder MOVES to
 *  the vault's `.trash/` (the answer carries where it landed). `permanent`
 *  erases it instead, and answers without a `trashPath`. */
export function deleteFolder(
  path: string,
  permanent = false,
): Promise<{ notes: number; trashPath?: string }> {
  return request<{ notes: number; trashPath?: string }>(
    `/api/folder?path=${encodeURIComponent(path)}${permanent ? "&permanent=true" : ""}`,
    { method: "DELETE" },
  );
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

/** Surgically set (value) or remove (null) one frontmatter key (admin only;
 *  server allowlists the keys — "banner" for now). */
export function setFrontmatter(
  path: string,
  key: string,
  value: string | null,
): Promise<FrontmatterResult> {
  return request<FrontmatterResult>("/api/frontmatter", json("POST", { path, key, value }));
}

/** Upload an image into the vault's attachments dir (admin only). `asAdmin`
 *  bypasses the visitor-preview header (see request). */
export function uploadAttachment(file: File, asAdmin = false): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  // No Content-Type header: the browser sets the multipart boundary itself.
  return request<UploadResult>("/api/upload", { method: "POST", body: form }, asAdmin);
}

/** Every image attachment in the vault (admin only) — the banner picker.
 *  `asAdmin` bypasses the visitor-preview header (see request). */
export function listAttachments(asAdmin = false): Promise<string[]> {
  return request<string[]>("/api/attachments", undefined, asAdmin);
}

// ── Typography: the operator's own faces (admin only) ───────────────────────
// Always the real admin session (asAdmin), like the settings calls beside
// them: the Typography tab stays reachable while previewing the public site,
// and /api/fonts/custom answers a preview session with a 404.

/** Every uploaded face under VELLUM_DATA/fonts/custom. */
export function listCustomFonts(): Promise<CustomFontInfo[]> {
  return request<CustomFontInfo[]>("/api/fonts/custom", undefined, true);
}

/** Upload one .woff2/.woff/.ttf/.otf. The server sniffs the magic bytes and
 *  400s anything that is not a font, whatever the file is called. */
export function uploadFont(file: File): Promise<CustomFontInfo> {
  const form = new FormData();
  form.append("file", file, file.name);
  // No Content-Type header: the browser sets the multipart boundary itself.
  return request<CustomFontInfo>("/api/fonts/upload", { method: "POST", body: form }, true);
}

/** Remove an uploaded face. 409 while a slot still names it. */
export function deleteCustomFont(file: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/fonts/custom/${encodeURIComponent(file)}`, { method: "DELETE" }, true);
}

/** Instance settings (admin only; VELLUM_DATA/settings.json). */
export function getSettings(): Promise<SettingsResponse> {
  return request<SettingsResponse>("/api/settings", undefined, true);
}

/** Partial settings update (admin only; null values clear keys). Always sent
 *  as the real admin session — the affordance lives inside visitor preview. */
export function patchSettings(patch: SettingsPatch): Promise<SettingsResponse> {
  return request<SettingsResponse>("/api/settings", json("PATCH", patch), true);
}

// ── Backup & sync (admin only) ──────────────────────────────────────────────
// Always sent as the real admin session (asAdmin): the affordances live in the
// status bar and the settings panel, both of which stay reachable while the
// admin is previewing the public site. No token ever travels on these calls —
// it is set write-only through patchSettings({ gitToken }).

export function getSyncStatus(): Promise<GitSyncStatus> {
  return request<GitSyncStatus>("/api/sync/status", undefined, true);
}

/** Make the vault a git repo and point origin at the configured remote. */
export function syncInit(): Promise<GitSyncStatus> {
  return request<GitSyncStatus>("/api/sync/init", { method: "POST" }, true);
}

/** One sync pass: (optional) ff-only pull, stage, commit, push. 409 while a
 *  sync is already running. */
export function syncNow(): Promise<GitSyncStatus> {
  return request<GitSyncStatus>("/api/sync/now", { method: "POST" }, true);
}

/**
 * The set of published note paths — the ADMIN's own view of publish state,
 * from an admin-only route (GET /api/published; 404 for anyone else).
 *
 * It used to be read off `/api/tree` with `credentials: "omit"` — the admin's
 * session dropped so the server would answer as if to a stranger. That was
 * one trick with three consequences: the owner's publish marks were built
 * from a VISITOR surface and inherited the visitor's languageFilter, which
 * CONTRACTS.md forbids on an admin surface; a just-published note's star lit
 * optimistically and was then removed again by the next refresh, with no
 * message; and the whole thing only existed when a password hash was
 * configured AND public reads were open, so an open local vault had no
 * publish marks at all. X-Vellum-Preview exists precisely so a session never
 * has to pretend to be someone else.
 */
export async function getPublishedPaths(): Promise<Set<string>> {
  const { paths } = await request<PublishedPaths>("/api/published");
  return new Set(paths);
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
