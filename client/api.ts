// Typed client for the Vellum HTTP API. Every fetcher mirrors an endpoint
// in CONTRACTS.md and returns the shared wire types.

import type {
  AliasEntry,
  AliasesResponse,
  AnchorsResponse,
  Backlink,
  CustomFontInfo,
  DeletePreview,
  FrontmatterResult,
  GitSyncStatus,
  GraphData,
  MeData,
  NoteData,
  PostMeta,
  PublicThemeInfo,
  PublishedPaths,
  PublishResult,
  SearchHit,
  SearchMatch,
  SettingsPatch,
  SettingsResponse,
  TagCount,
  TagLabelsResponse,
  TrackerMeta,
  TrashEntry,
  TreeNode,
  UploadResult,
  VaultEvent,
  XrefResponse,
  VisibilityImpact,
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

// ── Reader language (X-Vellum-Lang) ─────────────────────────────────────────
// The chrome language this browser is actually reading in. It rides on EVERY
// API call for one reason: with `settings.languageFilter: "follow"` the server
// scopes the published collection to the reader's language, so the question
// "which notes exist" has a different answer per reader and the client has to
// say who is asking.
//
// A claim, not a command — the server honors it only while the instance offers
// the EN/ع switch, and only for the two values it knows, exactly as it treats
// X-Vellum-Preview. Sending it always (rather than only under "follow") keeps
// this one line instead of a mode-dependent branch, and costs a header on
// requests the server will ignore it on.

const LANG_HEADER = "X-Vellum-Lang";
let readerLang: string | null = null;

/** Set the language every subsequent API call declares (state.ts drives this,
 *  from the same value it hands the i18n dictionary — chrome and content are
 *  told the same thing or the switch is a lie). */
export function setReaderLang(lang: string | null): void {
  readerLang = lang;
}

/** Merge the session headers (preview, reader language) into a fetch init —
 *  for the few callers outside this module that fetch /api/* directly. */
export function withPreview(init?: RequestInit): RequestInit | undefined {
  if (!previewOn && readerLang === null) return init;
  const headers = new Headers(init?.headers);
  if (previewOn) headers.set(PREVIEW_HEADER, "visitor");
  if (readerLang !== null) headers.set(LANG_HEADER, readerLang);
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

/** A note's anchor table — markdown headings and LaTeX `\label`s in one list,
 *  because they are the same kind of thing. Used where the CONTENT is not at
 *  hand (autocomplete after `[[Note#`, the hover preview of a link into a note
 *  that is not open). */
export async function getAnchors(path: string): Promise<AnchorsResponse["anchors"]> {
  const res = await request<AnchorsResponse>(`/api/anchors?path=${encodeURIComponent(path)}`);
  return res.anchors;
}

/** The VAULT-WIDE half of a LaTeX cross-reference: which note defines a
 *  `\label`, or which note answers to a citation key. Asked only after the
 *  document's own definitions have been checked — local-first is what keeps an
 *  imported project compiling exactly as it did. A miss is `{ path: null }`,
 *  not an error: unresolved keys are the normal state of a bibliography. */
export function lookupXref(query: { label: string } | { cite: string }): Promise<XrefResponse> {
  const param = "label" in query ? `label=${encodeURIComponent(query.label)}` : `cite=${encodeURIComponent(query.cite)}`;
  return request<XrefResponse>(`/api/xref?${param}`);
}

/** Save a note. `baseMtimeMs` is the mtime the caller was last handed for it;
 *  when given, the server refuses the write with 409 `code: "stale"` if the
 *  file changed underneath. Only the buffer registry passes it — see the note
 *  on `assertUnmodified` in server/api.ts for why it is optional. */
export function putNote(
  path: string,
  content: string,
  baseMtimeMs?: number,
): Promise<NoteData> {
  return request<NoteData>(
    `/api/note?path=${encodeURIComponent(path)}`,
    json("PUT", baseMtimeMs === undefined ? { content } : { content, baseMtimeMs }),
  );
}

/** True when a save was refused because the note changed on disk. */
export function isStaleWriteError(err: unknown): boolean {
  return err instanceof ApiError && err.code === "stale";
}

/** The last-gasp save, for a tab that is closing.
 *
 *  `fetch` started in `beforeunload` is cancelled along with the document and
 *  `keepalive` is capped and uneven across browsers; `sendBeacon` is the one
 *  transport the platform promises to deliver after the page is gone. It is
 *  fire-and-forget by construction — there is no response to read, because
 *  there is no longer anywhere to read it — so it returns only whether the
 *  browser accepted the payload for delivery.
 *
 *  It carries the precondition too. A last-gasp save that clobbers a newer
 *  version is still a clobber, and the reader who caused it is by definition
 *  not there to be asked about it. */
export function flushNoteBeacon(path: string, content: string, baseMtimeMs?: number): boolean {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
    return false;
  }
  const body = new Blob(
    [JSON.stringify(baseMtimeMs === undefined ? { path, content } : { path, content, baseMtimeMs })],
    { type: "application/json" },
  );
  return navigator.sendBeacon("/api/note/flush", body);
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

/** Delete ONE attachment — the images, PDFs and recordings the tree lists
 *  under a folder's notes. Same two speeds and the same `.trash/`
 *  destination as a note; the difference is what the DIALOG has to say
 *  first, which is `deletePreview()` below. */
export function deleteAttachment(
  path: string,
  permanent = false,
): Promise<{ ok: true; trashPath?: string }> {
  return request<{ ok: true; trashPath?: string }>(
    `/api/attachment?path=${encodeURIComponent(path)}${permanent ? "&permanent=true" : ""}`,
    { method: "DELETE" },
  );
}

/** What a delete would actually take: the file counts, and — the number that
 *  was missing — how many of the attachments in there a note that SURVIVES
 *  the delete still embeds, with a sample of those notes by name.
 *
 *  Every delete dialog asks this before it opens. A folder holding four
 *  images and no markdown used to say "0 notes will move"; the essay one
 *  folder over kept embedding all four and broke on the public site in
 *  silence. */
export function deletePreview(path: string): Promise<DeletePreview> {
  return request<DeletePreview>(`/api/delete-preview?path=${encodeURIComponent(path)}`);
}

// ── Trash (admin) ───────────────────────────────────────────────────────────
// The bin the delete dialogs have always promised. `.trash/` is invisible to
// the tree, the indexer and the watcher by design, so these three calls are
// the only way the product can see or act on it.

export function listTrash(): Promise<TrashEntry[]> {
  return request<TrashEntry[]>("/api/trash");
}

/** Move an entry back into the vault. `path` is where it actually LANDED and
 *  `renamed` says the origin was taken (or unknown) — the toast prints both,
 *  because a restore that quietly went somewhere else is the same lie the
 *  delete previews exist to stop telling. */
export function restoreTrash(name: string): Promise<{ ok: true; path: string; renamed: boolean }> {
  return request<{ ok: true; path: string; renamed: boolean }>(
    "/api/trash/restore",
    json("POST", { name }),
  );
}

export function purgeTrash(name: string): Promise<{ ok: true }> {
  return request<{ ok: true }>(`/api/trash?name=${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
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

/** Move a folder and everything under it to a new vault-relative PATH. Same
 *  `{ path, toPath }` shape as `renameNote`, because dragging a note and
 *  dragging a folder are one gesture to the reader — and the server does the
 *  same job for both: move the files, then repair every `[[wikilink]]` and
 *  relative embed the move would otherwise have broken. `notes` is how many
 *  `.md` files travelled (the toast's number); `rewritten` how many notes had
 *  links repaired. */
export function moveFolder(
  path: string,
  toPath: string,
): Promise<{ ok: true; notes: number; rewritten: number }> {
  return request<{ ok: true; notes: number; rewritten: number }>(
    "/api/folder/move",
    json("POST", { path, toPath }),
  );
}

export function search(q: string, signal?: AbortSignal): Promise<SearchHit[]> {
  return request<SearchHit[]>(
    `/api/search?q=${encodeURIComponent(q)}`,
    signal ? { signal } : undefined,
  );
}

/** Every line of ONE note the query matches — the expansion under a search
 *  hit. Same visitor scoping as search() by construction: the ordinary
 *  request() carries the preview/session headers, and the server answers a
 *  hidden note with `[]`. */
export function searchMatches(path: string, q: string, signal?: AbortSignal): Promise<SearchMatch[]> {
  return request<SearchMatch[]>(
    `/api/search/matches?path=${encodeURIComponent(path)}&q=${encodeURIComponent(q)}`,
    signal ? { signal } : undefined,
  );
}

export function getGraph(): Promise<GraphData> {
  return request<GraphData>("/api/graph");
}

/** One note's neighborhood: the note, its direct wikilink neighbors (both
 *  directions) and the edges among them. Same shape as `getGraph`, a fraction
 *  of the bytes — the backlinks panel's local graph needs a dozen nodes, not
 *  the whole vault. */
export function getLocalGraph(path: string): Promise<GraphData> {
  return request<GraphData>(`/api/graph?around=${encodeURIComponent(path)}`);
}

/** Every alias the vault's notes declare in their frontmatter, with the note
 *  each one names. The `[[` completion list is built from the tree in the
 *  store, and a tree carries FILENAMES — an alias is frontmatter the client has
 *  never read, so without this one fetch a vault's aliases resolved when typed
 *  in full and could not be completed. */
export async function getAliases(): Promise<AliasEntry[]> {
  const res = await request<AliasesResponse>("/api/aliases");
  return res.aliases;
}

/** Add one alias to a note's frontmatter (merged, never re-stringified). The
 *  offer after a rename: the old title keeps working as a name, so nothing in
 *  the vault — or on the published site — points at a note that no longer
 *  answers to it. */
export function addAlias(path: string, alias: string): Promise<{ ok: true; path: string; alias: string }> {
  return request<{ ok: true; path: string; alias: string }>("/api/alias", json("POST", { path, alias }));
}

export function getBacklinks(path: string): Promise<Backlink[]> {
  return request<Backlink[]>(`/api/backlinks?path=${encodeURIComponent(path)}`);
}

export function getTags(): Promise<TagCount[]> {
  return request<TagCount[]>("/api/tags");
}

/** The DISPLAY names of the vault's tags (canonical tag → language → label).
 *  Scoped by the session exactly as /api/tags is; the canonical tag stays the
 *  key everywhere, so this changes what a chip SAYS and nothing else. */
export function getTagLabels(): Promise<TagLabelsResponse> {
  return request<TagLabelsResponse>("/api/tag-labels");
}

export function getMe(): Promise<MeData> {
  return request<MeData>("/api/me");
}

/** Published notes as blog posts, newest first (blog mode's list). */
export function getPosts(): Promise<PostMeta[]> {
  return request<PostMeta[]>("/api/posts");
}

/** Every ```tracker fence this session may see, newest-touched first — the
 *  shelf a ```tracker-board draws. Scoped server-side exactly like /api/posts
 *  (published only for a visitor, language filter applied, templates out), so
 *  a board on a PUBLISHED note is safe to leave in place. */
export function getTrackers(): Promise<TrackerMeta[]> {
  return request<TrackerMeta[]>("/api/trackers");
}

/**
 * What the visitor-facing settings are costing this site, in notes (admin
 * only; 404 to everyone else). Every argument is a HYPOTHETICAL — pass the
 * value a control is about to be saved with and the answer describes the site
 * as it WOULD be; omit one and it describes the site as it is.
 *
 * This is the whole point of the settings panel's consequence lines. The
 * boolean this replaces hid eighteen of a real site's twenty posts on a click,
 * and no number anywhere said so before or after.
 */
export function getVisibility(
  query: {
    languageFilter?: string;
    excludeTags?: string[];
    publicLayout?: string;
    home?: string;
    homeNote?: string;
  } = {},
  signal?: AbortSignal,
): Promise<VisibilityImpact> {
  const params = new URLSearchParams();
  if (query.languageFilter) params.set("languageFilter", query.languageFilter);
  if (query.excludeTags) params.set("excludeTags", query.excludeTags.join(","));
  if (query.publicLayout) params.set("publicLayout", query.publicLayout);
  if (query.home) params.set("home", query.home);
  // Distinct from absent: "" asks what happens with the home note CLEARED.
  if (query.homeNote !== undefined) params.set("homeNote", query.homeNote);
  const qs = params.toString();
  return request<VisibilityImpact>(
    `/api/visibility${qs ? `?${qs}` : ""}`,
    signal ? { signal } : undefined,
    true,
  );
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

/** Upload one attachment (admin only). `asAdmin` bypasses the visitor-preview
 *  header (see request).
 *
 *  `dir` is CONTEXT, not a destination: the vault folder the upload happened
 *  IN — the open note's folder, the tree row it was dropped on. What the
 *  server does with it is the attachment-LOCATION setting's business: "same
 *  folder" and "subfolder" are relative to it, "vault root" and "specified"
 *  ignore it entirely. It read as a destination while the tree drop was the
 *  only caller that passed one, and that reading has to go: a drop that
 *  overrode the setting made two of the four modes silently inapplicable to
 *  the one gesture most likely to use them. The toast names where the files
 *  actually landed, which is the part a reader needs either way.
 *
 *  The server picks the first free filename, so an upload never overwrites and
 *  the answer carries the name it actually landed under. */
export function uploadAttachment(
  file: File,
  asAdmin = false,
  dir?: string,
): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  // Empty context and absent context mean the same thing (the vault root), so
  // the falsy test is right here in a way it would not be for a destination.
  if (dir) form.append("dir", dir);
  // No Content-Type header: the browser sets the multipart boundary itself.
  return request<UploadResult>("/api/upload", { method: "POST", body: form }, asAdmin);
}

// `getDeleteImpact` / `GET /api/impact` stood here and is gone: it asked "what
// would deleting this folder really take", which is exactly the question
// `getDeletePreview` / `GET /api/delete-preview` answers — for notes, folders
// AND attachments, with the referencing-note titles the dialogs print. Two
// routes answering one question is how two dialogs come to disagree about the
// same delete.

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

/** Mirror the admin's own editor theme to the server (admin only), so the
 *  public default can follow it. Debounced by the caller — the pick lives in
 *  localStorage, and this is the only way the server learns it. Answers what a
 *  cookieless visitor now lands on, and why. */
export function putEditorTheme(theme: string): Promise<PublicThemeInfo> {
  return request<PublicThemeInfo>("/api/theme", json("POST", { theme }), true);
}

/** The same write, for a page that is going away: `pagehide` gives no time for
 *  a promise, and a debounced pick that never landed would silently not apply.
 *  Beacons are POSTs with a JSON body and the session cookie attached, which
 *  is exactly the shape of the route. Returns false when the browser refused
 *  to queue it (the caller then still has its normal timer). */
export function beaconEditorTheme(theme: string): boolean {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
  const blob = new Blob([JSON.stringify({ theme })], { type: "application/json" });
  return navigator.sendBeacon("/api/theme", blob);
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
  // EventSource cannot carry custom headers, so BOTH session dimensions ride
  // on query params here — the preview flag and the reader language, each
  // honored server-side only on this route and under the same gate its header
  // gets. The stream resolves its language once, at subscribe time, so a
  // visitor flipping EN/ع must resubscribe: state.ts tears this down and
  // rebuilds it, which is why the language is read at call time rather than
  // captured when the module loaded.
  const params = new URLSearchParams();
  if (previewOn) params.set("preview", "visitor");
  if (readerLang !== null) params.set("lang", readerLang);
  const query = params.toString();
  const source = new EventSource(query ? `/api/events?${query}` : "/api/events");
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
