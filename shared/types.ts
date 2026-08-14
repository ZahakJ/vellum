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
  customCss?: boolean; // VELLUM_DATA/custom.css exists → client links /api/custom.css
  // Blog mode (PUBLIC_LAYOUT=blog): visitors get a classic blog shell instead
  // of the app chrome; admin sessions keep the full app. Fields below are
  // present only when blog mode is on.
  publicLayout?: "app" | "blog"; // PUBLIC_LAYOUT (absent = "app")
  tagline?: string;    // SITE_TAGLINE — masthead subtitle
  footer?: string;     // SITE_FOOTER resolved (default "© <year> <SITE_NAME>")
  blogLocale?: string; // BLOG_LOCALE — BCP47 tag the client uses for date formatting (default "en")
}

// GET /api/posts (visitor-safe): published notes as blog posts, newest first.
export interface PostMeta {
  path: string;           // vault-relative note path
  title: string;          // basename without .md
  date: string;           // ISO 8601: frontmatter date/created when parseable, else file birthtime/mtime
  excerpt: string;        // first real paragraph, markdown stripped, ~220 chars, word-boundary + …
  words: number;          // prose word count
  readingMinutes: number; // ceil(words / 200)
  tags: string[];         // EXCLUDE_TAGS filtered
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

// Comments (COMMENTS=on): GET /api/comments?path= → CommentData[],
// POST /api/comments { path, author?, body, website? } → CommentData.
// The poster's IP is stored server-side for moderation but never leaves it.
export interface CommentData {
  id: number;
  notePath: string;   // normalized vault-relative path of the note
  author: string;     // trimmed, ≤40 chars, "Anonymous" when omitted
  body: string;       // plain text, ≤2000 chars
  createdMs: number;
}
