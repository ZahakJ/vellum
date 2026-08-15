// Shared types — the wire contract between server and client. Do not drift from these.

export interface TreeNode {
  name: string;          // file or folder basename, e.g. "Ideas.md" or "projects"
  path: string;          // vault-relative POSIX path, e.g. "projects/Ideas.md"; "" for root
  type: "file" | "folder";
  children?: TreeNode[]; // folders only, sorted: folders first, then files, alpha
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
   *  One of: iron-gall, void, lapis, parchment. */
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
}

/** What /api/settings answers: the stored keys (settings.json verbatim,
 *  validated) plus `effective` — the merged values the site is actually
 *  using right now (stored value when set, else env default). */
export interface SettingsResponse extends SettingsData {
  effective: EffectiveSettings;
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
  excludeTags: string[];
  commentsEnabled: boolean;
  shareButtons: boolean;
  favicon: string | null;
  logo: string | null;
  home: Required<Pick<HomeSettings, "mode">> & Omit<HomeSettings, "mode">;
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
}

export interface PublishedCounts {
  notes: number;  // notes with frontmatter publish: true
  total: number;  // all indexed notes
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
