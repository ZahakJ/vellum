// Shared types — the wire contract between server and client. Do not drift from these.

export interface TreeNode {
  name: string;          // file or folder basename, e.g. "Ideas.md" or "projects"
  path: string;          // vault-relative POSIX path, e.g. "projects/Ideas.md"; "" for root
  type: "file" | "folder";
  children?: TreeNode[]; // folders only, sorted: folders, then notes, then attachments, alpha within each
  /** Present on non-markdown FILE nodes only — the ADMIN tree lists a vault's
   *  attachments (images, PDFs, audio, video, anything else) beside its notes,
   *  because a folder of 1,158 images that expands to nothing reads as "my
   *  files are gone". A node WITHOUT this field is a note (`.md`); every
   *  consumer that wants notes only filters on it (or, as `collectNotes` does,
   *  on the `.md` suffix of `path`). The visitor tree never carries it: a
   *  visitor's tree is the flat published-note collection and nothing else. */
  attachment?: AttachmentInfo;
}

/** How an attachment is opened: `image` in the in-app viewer, `audio`/`video`
 *  with an inline player, `pdf` in a new tab (browsers render them), anything
 *  else offered as a download. */
export type AttachmentKind = "image" | "pdf" | "audio" | "video" | "other";

export interface AttachmentInfo {
  kind: AttachmentKind;
  /** Lowercase extension without the dot ("png"); "" when the name has none. */
  ext: string;
  /** Size in bytes (the viewer prints it; the tree does not). */
  size: number;
}

export interface NoteData {
  path: string;
  content: string;       // raw markdown including frontmatter
  mtimeMs: number;
}

export interface SearchHit {
  path: string;
  title: string;         // basename without .md
  snippet: string;       // ~160 chars of matched context, match wrapped in <mark>…</mark>
  score: number;
}

export interface GraphNode { id: string; title: string; links: number; tags: string[] }
export interface GraphEdge { source: string; target: string }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[] }

export interface Backlink { path: string; title: string; context: string } // context = line containing the link

export interface TagCount { tag: string; count: number }

export interface VaultEvent {
  kind: "created" | "changed" | "deleted" | "renamed";
  path: string;
  toPath?: string; // renamed only
  dir?: boolean;   // true when the event is about a folder
}

export interface ResolveResult { path: string | null } // GET /api/resolve?name= (null = known miss, 200 not 404 so expected misses stay quiet in devtools)

export interface MeData {
  admin: boolean;      // this session may mutate the vault
  public: boolean;     // reads are open without a session (PUBLIC != false)
  protected: boolean;  // an ADMIN_PASSWORD_HASH is configured (sign in/out is meaningful)
  preview?: boolean;   // admin session previewing as visitor (X-Vellum-Preview) — payload above is visitor-shaped
  homeNote?: string;   // note opened for fresh visitors (HOME_NOTE)
  published?: PublishedCounts; // publish stats for admin UI copy (admin sessions only)
  siteName?: string;   // instance branding (SITE_NAME; default "Vellum")
  defaultTheme?: string; // theme applied when the visitor has no stored choice (DEFAULT_THEME)
  language?: "en" | "ar"; // site chrome language (settings.language / SITE_LANG; default "en"); "ar" flips the whole chrome RTL. Sent to every session.
  languageToggle?: boolean; // settings.languageToggle — the public shell offers visitors an EN/ع chrome switch (default off; absent = off)
  /** Marginalia are live on this instance (COMMENTS=on, or
   *  settings.commentsEnabled). Absent = off, and the client then never asks
   *  /api/comments at all: without this the reading view fired one request per
   *  note open on an instance with the feature off and painted a red 404 in
   *  the console every time — a client asking a question the server has
   *  already answered instance-wide. Visitor-safe: it describes the public
   *  shell, exactly like languageToggle. */
  comments?: boolean;
  customCss?: boolean; // VELLUM_DATA/custom.css exists → client links /api/custom.css
  // Blog mode (PUBLIC_LAYOUT=blog): visitors get a classic blog shell instead
  // of the app chrome; admin sessions keep the full app. Fields below are
  // present only when blog mode is on.
  publicLayout?: "app" | "blog"; // PUBLIC_LAYOUT (absent = "app")
  tagline?: string;    // SITE_TAGLINE — masthead subtitle
  footer?: string;     // SITE_FOOTER resolved (default "© <year> <SITE_NAME>")
  blogLocale?: string; // BLOG_LOCALE — BCP47 tag the client uses for date formatting (default "en")
  bannerFallback?: "generated" | "none"; // BANNER_FALLBACK — blog list/article hero for notes without a banner
  shareButtons?: boolean; // blog article share row (settings.shareButtons, default off)
  home?: HomeSettings; // settings.home — what "/" renders for blog visitors (absent = note mode)
  logo?: string;       // settings.logo — site logo image (banner-style value)
  favicon?: boolean;   // settings.favicon set — /favicon.ico serves it (client repoints its icon link)
  /** settings.fonts names at least one catalog face → the client links the
   *  generated /api/site-fonts.css. The value is a signature of the four
   *  slots ("lora.inter.system.amiri"), used as the ?v= cache-buster so a
   *  changed pick refetches instead of showing yesterday's faces. Sent to
   *  every session: the faces are the public site's own typography. */
  fonts?: string;
}

// GET /api/posts (visitor-safe): published notes as blog posts, newest first.
export interface PostMeta {
  path: string;           // vault-relative note path
  title: string;          // basename without .md
  date: string;           // ISO 8601: frontmatter date/created/published (first parseable), else file birthtime/mtime
  excerpt: string;        // first real paragraph, markdown stripped, ~220 chars, word-boundary + …
  words: number;          // prose word count
  readingMinutes: number; // ceil(words / 200)
  tags: string[];         // EXCLUDE_TAGS filtered
  /** Frontmatter `banner:` resolved: an https URL, or a vault-relative
   *  attachment path (fetch via /api/file?path=). Absent when unset. */
  banner?: string;
  /** Comments on this post (COMMENTS=on only; absent otherwise). Visitors
   *  count visible comments only; admin sessions include hidden ones. */
  commentCount?: number;
}

// Instance settings (VELLUM_DATA/settings.json) — admin-editable at runtime,
// unlike the env-driven site config. GET /api/settings (admin) →
// SettingsResponse, PATCH /api/settings (admin) body = partial SettingsData
// (null clears a key back to its env default) → SettingsResponse. Unknown keys
// already in the file are preserved on write; unknown keys in a PATCH are 400.
// A stored value overrides its env counterpart; an absent key falls back to
// env. Env-only forever (never in settings.json): ADMIN_PASSWORD_HASH,
// SESSION_SECRET, TRUSTED_PROXIES, PORT, HOST, VELLUM_VAULT, VELLUM_DATA,
// PUBLIC.
export interface HomeSettings {
  /** What "/" renders for blog-mode visitors: "note" (default — the classic
   *  intro + Writings list) or "dashboard" (magazine home: hero banner,
   *  card grid of latest posts, most-discussed row). */
  mode?: "note" | "dashboard";
  /** The intro/home note (mode "note"): vault-relative .md path. Overrides
   *  the HOME_NOTE env default when set. */
  note?: string;
  /** Dashboard hero image: https URL or vault-relative attachment path.
   *  Absent → generated-gradient fallback seeded from the site name. */
  banner?: string;
}

export interface SettingsData {
  /** Instance branding (overrides SITE_NAME). ≤ 80 chars. */
  siteName?: string;
  /** Masthead subtitle (overrides SITE_TAGLINE). ≤ 160 chars. */
  tagline?: string;
  /** Footer template, {year}/{siteName} substituted (overrides SITE_FOOTER). ≤ 200 chars. */
  footer?: string;
  /** Theme for visitors without a stored choice (overrides DEFAULT_THEME).
   *  One of the fifteen ids in `shared/themes.ts` — the list both the client's
   *  picker and the server's validator read, so they cannot drift. */
  defaultTheme?: string;
  /** Visitor-facing layout (overrides PUBLIC_LAYOUT). */
  publicLayout?: "app" | "blog";
  /** Chrome language (overrides SITE_LANG): "ar" localizes all chrome
   *  strings to Arabic and mirrors the UI right-to-left. */
  language?: "en" | "ar";
  /** When true AND the site language matches, public blog surfaces (lists,
   *  topics, search, graph, RSS) show only notes written predominantly in
   *  that language's script. Admin surfaces unaffected. Default false. */
  languageFilter?: boolean;
  /** Offer visitors a small EN/ع switch in the public chrome. Their choice
   *  lives in their own localStorage and overrides the site language for
   *  chrome strings and direction only — never for note content, dates or
   *  numerals (those stay on the instance's blogLocale). Default false:
   *  off means the public site looks exactly as it does today. */
  languageToggle?: boolean;
  /** BCP47 date-formatting locale (overrides BLOG_LOCALE). */
  blogLocale?: string;
  /** Tags hidden from visitor surfaces (overrides EXCLUDE_TAGS). Simple
   *  tokens, ≤ 50 chars each. */
  excludeTags?: string[];
  /** Marginalia comments on/off (overrides COMMENTS). */
  commentsEnabled?: boolean;
  /** Show the share-links row under blog articles (default off). */
  shareButtons?: boolean;
  /** Favicon: vault-relative image path (uploaded attachment), served at
   *  /favicon.ico. Absent → the built-in glyph. */
  favicon?: string;
  home?: HomeSettings;
  /** Site logo image (https URL or vault path) shown in place of the
   *  site-name text where a logo fits (masthead, sidebar, dashboard hero). */
  logo?: string;
  /** Git backup & sync (off by default). The token, when one is used, is NOT
   *  here — it lives in VELLUM_DATA/git-credentials.json (0600). */
  gitSync?: GitSyncSettings;
  /** Typography: catalog ids (or "system") per slot. Chosen faces are cached
   *  under VELLUM_DATA/fonts/catalog/ and served from this instance only. */
  fonts?: FontSlotSettings;
}

/** What /api/settings answers: the stored keys (settings.json verbatim,
 *  validated) plus `effective` — the merged values the site is actually
 *  using right now (stored value when set, else env default). */
export interface SettingsResponse extends SettingsData {
  effective: EffectiveSettings;
  /** The typography catalog the panel's four selects are built from. Static
   *  per build; travels with the settings payload so the panel needs no
   *  second request. */
  fontCatalog?: FontCatalogEntry[];
  /** What this instance IS, for the settings panel's About tab. Admin-only by
   *  construction: /api/settings is 404 to visitors. */
  about?: AboutInfo;
}

/** The instance's own facts — version, where it keeps things, how much is in
 *  it. Every one of these was previously answerable only from the terminal
 *  that started the server, which is the wrong place for the person editing
 *  the site from a browser. Paths are ABSOLUTE and admin-only. */
export interface AboutInfo {
  version: string;      // package.json version
  node: string;         // process.version, e.g. "v22.11.0"
  vaultPath: string;    // resolved vault root
  dataPath: string;     // VELLUM_DATA (settings.json, fonts, credentials)
  /** The settings FILE itself. The panel used to say "— settings.json" in its
   *  own title, which named a file without saying where it was; the answer
   *  belongs in About, next to the other absolute paths. */
  settingsPath: string;
  /** VELLUM_DATA/fonts/custom — where uploaded faces land. */
  customFontsPath: string;
  notes: number;        // indexed .md files
  published: number;    // notes with publish: true
  attachments: number;  // indexed image attachments
  tags: number;         // distinct tags
}

export interface EffectiveSettings {
  siteName: string;
  tagline: string | null;
  footer: string | null;          // raw template (may contain {year}/{siteName})
  defaultTheme: string | null;
  publicLayout: "app" | "blog";
  blogLocale: string;
  language: "en" | "ar";
  languageFilter: boolean;
  languageToggle: boolean;
  excludeTags: string[];
  commentsEnabled: boolean;
  shareButtons: boolean;
  favicon: string | null;
  logo: string | null;
  home: Required<Pick<HomeSettings, "mode">> & Omit<HomeSettings, "mode">;
  gitSync: GitSyncEffective;
  /** Typography slots in effect (every slot present, "system" when unset). */
  fonts: FontSlotsEffective;
}

/** PATCH /api/settings body: only the named keys change; null (or "") clears
 *  one back to its env default. Strict allowlist — unknown keys are a 400. */
export interface SettingsPatch {
  siteName?: string | null;
  tagline?: string | null;
  footer?: string | null;
  defaultTheme?: string | null;
  publicLayout?: "app" | "blog" | null;
  language?: "en" | "ar" | null;
  languageFilter?: boolean | null;
  languageToggle?: boolean | null;
  blogLocale?: string | null;
  excludeTags?: string[] | null;
  commentsEnabled?: boolean | null;
  shareButtons?: boolean | null;
  favicon?: string | null;
  home?: {
    mode?: "note" | "dashboard" | null;
    note?: string | null;
    banner?: string | null;
  } | null;
  logo?: string | null;
  /** Git sync configuration; null clears the whole key. */
  gitSync?: {
    enabled?: boolean | null;
    remote?: string | null;
    branch?: string | null;
    intervalMinutes?: number | null;
    pullFirst?: boolean | null;
    authMode?: "ssh" | "token" | null;
  } | null;
  /** WRITE-ONLY. Stored outside settings.json (VELLUM_DATA/git-credentials.json,
   *  0600) and never returned by any read — GET answers `tokenSet` instead.
   *  null / "" clears the stored token. */
  gitToken?: string | null;
  /** Username the token pairs with (not a secret; stored beside it). */
  gitUser?: string | null;
  /** Typography slots; an unknown id (or one the slot does not accept) is a
   *  400, and the server caches the chosen families before it stores them —
   *  a failed download is a 502 and settings.json is left untouched. */
  fonts?: FontSlotSettings | null;
}

// ── Typography (settings.fonts) ────────────────────────────────────────────
// A curated webfont catalog, self-hosted: the server fetches the chosen
// families ONCE (Google Fonts, at save time) into VELLUM_DATA/fonts/catalog/
// and serves them from there. Visitors never contact an external host.

export type FontCategory = "serif" | "sans" | "mono";
export type FontScript = "latin" | "arabic";

/** One catalog entry as the settings panel receives it (SettingsResponse). */
export interface FontCatalogEntry {
  /** Stable slug — the value stored in settings.fonts and the cache dir name. */
  id: string;
  /** Family name as the browser knows it (also the option label). */
  family: string;
  category: FontCategory;
  scripts: FontScript[];
}

/** Each slot holds a catalog id or "system" (the built-in stacks). `arabic` is
 *  the point of the feature: its faces are emitted FIRST in every composite
 *  family, narrowed to the Arabic unicode ranges, so a mixed paragraph picks
 *  the naskh face per CHARACTER — in English mode too. */
export interface FontSlotSettings {
  prose?: string;
  ui?: string;
  mono?: string;
  arabic?: string;
  /** Optical size compensation for the Arabic half, in percent (50–300), or
   *  null for "the catalog's measured value, or none". The catalog faces were
   *  measured against Lora; an UPLOADED face cannot be, so the operator gets
   *  the dial — in the one place where both scripts are on screen together. */
  arabicSizeAdjust?: number | null;
}

/** The resolved slots (every slot present; "system" when unset). */
export interface FontSlotsEffective {
  prose: string;
  ui: string;
  mono: string;
  arabic: string;
  arabicSizeAdjust?: number | null;
}

/** An uploaded face under VELLUM_DATA/fonts/custom — offered in every slot
 *  under "Your fonts", served from this instance like the catalog cache. */
export type FontFormat = "woff2" | "woff" | "ttf" | "otf";

export interface CustomFontInfo {
  /** The value settings.fonts holds: "custom:<file>". */
  id: string;
  /** Basename on disk (generated slug + sniffed extension). */
  file: string;
  /** From the font's own `name` table when it could be read, else the stem. */
  family: string;
  format: FontFormat;
  size: number;
  /** ISO timestamp. */
  uploaded: string;
}

export interface PublishedCounts {
  notes: number;  // notes with frontmatter publish: true
  total: number;  // all indexed notes
}

// GET /api/published (ADMIN ONLY) → PublishedPaths.
// The admin UI's own source for "which notes are published" — the server's
// publish set, with no visitor filter applied to it. It exists because the
// panel used to learn this by fetching /api/tree with `credentials: "omit"`:
// a session pretending to be anonymous, which handed an ADMIN surface the
// visitor's languageFilter (CONTRACTS.md: "Admin surfaces are never
// filtered") and made a just-published note's star flicker back off.
// Admin-only, because a language-hidden published note's path is precisely
// what every public surface is withholding.
export interface PublishedPaths {
  paths: string[]; // vault-relative, sorted
}

// POST /api/publish { path, publish: boolean } (admin only) → PublishResult
export interface PublishResult {
  ok: true;
  path: string;       // normalized vault-relative path
  published: boolean; // publish state after the toggle
}

// POST /api/upload (admin only): multipart image → saved under ATTACHMENTS_DIR.
export interface UploadResult {
  path: string; // vault-relative path of the stored attachment
}

// POST /api/frontmatter { path, key, value } (admin only) → FrontmatterResult.
// Surgical single-line frontmatter edit; key allowlisted ("banner" for now),
// value null/"" removes the line.
export interface FrontmatterResult {
  ok: true;
  path: string;         // normalized vault-relative path
  key: string;
  value: string | null; // value after the edit (null = removed)
}

// Comments (COMMENTS=on): GET /api/comments?path= → CommentData[],
// POST /api/comments { path, author?, body, website? } → CommentData.
// Moderation (admin only): PATCH /api/comments/:id { hidden } → { ok: true },
// GET /api/comments/all?limit= → CommentData[] (newest first, across notes).
// The poster's IP is stored server-side for moderation but never leaves it.
export interface CommentData {
  id: number;
  notePath: string;   // normalized vault-relative path of the note
  author: string;     // trimmed, ≤40 chars, "Anonymous" when omitted
  body: string;       // plain text, ≤2000 chars
  createdMs: number;
  hidden?: boolean;   // admin responses only; hidden comments never reach visitors
}

// ── Backup & sync (git) ─────────────────────────────────────────────────────
// settings.gitSync mirrors the vault to a git remote the operator configures.
// Off by default. The credential for authMode "token" NEVER travels on this
// wire in either direction: PATCH accepts a write-only `gitToken`, and reads
// answer `tokenSet` only.

export interface GitSyncSettings {
  /** Master switch. Default false — a fresh instance touches no remote. */
  enabled?: boolean;
  /** Remote URL: https://… , ssh://… or git@host:path. No embedded
   *  credentials (the token field exists for that). */
  remote?: string;
  /** Branch to commit and push (default "main"). */
  branch?: string;
  /** Automatic sync period; 0 (default) = manual only. Max 1440. */
  intervalMinutes?: number;
  /** Fast-forward-only pull before each sync (default true). */
  pullFirst?: boolean;
  /** "ssh" — the machine's own keys/agent, no secret stored.
   *  "token" — a write-only token in VELLUM_DATA/git-credentials.json. */
  authMode?: "ssh" | "token";
}

/** The gitSync configuration in effect (defaults filled in). `tokenSet` is
 *  the ONLY thing said about the stored credential. */
export interface GitSyncEffective {
  enabled: boolean;
  remote: string | null;
  branch: string;
  intervalMinutes: number;
  pullFirst: boolean;
  authMode: "ssh" | "token";
  tokenSet: boolean;
  gitUser: string | null; // the username the token pairs with (not a secret)
}

/** Outcome of the most recent sync pass (server-side, in memory). */
export interface GitSyncResult {
  at: string;        // ISO timestamp of the attempt
  ok: boolean;
  message: string;   // human-readable, token-scrubbed
  committed: boolean;
  pushed: boolean;
  /** The push moved the remote branch — true whenever something was
   *  committed, and also when this pass only uploaded commits that were
   *  already local (the first sync after "Make it a repo" is exactly that).
   *  Absent on a failed pass, and on results recorded before this field
   *  existed, which is why the client treats it as `=== true`. */
  remoteAdvanced?: boolean;
}

/** GET /api/sync/status, and the answer of POST /api/sync/{init,now}. */
export interface GitSyncStatus {
  enabled: boolean;
  configured: boolean;      // a remote is set in settings
  repo: boolean;            // the vault IS a git work tree root
  branch: string | null;    // null on a detached HEAD
  dirty: number;            // uncommitted entries (git status --porcelain)
  /** Commits this branch has that the remote does not, and vice versa — or
   *  NULL when there is no remote-tracking ref yet, i.e. nothing has ever been
   *  fetched or pushed. That is a third state, not a zero: "0 ahead · 0 behind"
   *  is exactly what a fully backed-up vault reads, and reporting it for a
   *  vault whose commits exist on this machine only is the one wrong answer a
   *  backup panel must never give. Renders as "not on the remote yet". */
  ahead: number | null;
  behind: number | null;
  remoteHost: string | null; // host only, for display — never path or userinfo
  originSet: boolean;        // the repo has an `origin` remote
  busy: boolean;             // a sync is running right now
  intervalMinutes: number;
  authMode: "ssh" | "token";
  tokenSet: boolean;
  last: GitSyncResult | null;
}
