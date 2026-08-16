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

// ── Language filter ─────────────────────────────────────────────────────────
/** How the public site curates published notes by the language they are
 *  WRITTEN IN. Four states, because the boolean it replaces could not say the
 *  thing anyone actually wanted:
 *
 *  • `"off"`    — default. Every published note is public. Nothing is hidden.
 *  • `"follow"` — the READER decides: whatever language they are reading the
 *                 chrome in (their EN/ع choice when `languageToggle` is on,
 *                 else the site language) is the language they get notes in.
 *                 This is the only value that makes the visitor switch
 *                 coherent — with anything else the chrome and the content
 *                 disagree.
 *  • `"ar"`/`"en"` — pinned, regardless of who is reading. For a site that
 *                 genuinely is one language. This is what the old boolean
 *                 `true` meant, and stored `true` migrates to exactly this.
 *
 *  Curation, never access control: a direct permalink to any published note
 *  keeps working under every mode (`/api/note` is never filtered). What the
 *  mode moves is DISCOVERY — lists, topics, search, graph, RSS, the SSE
 *  stream, prev/next adjacency.
 *
 *  And under every non-`"off"` mode the server refuses to serve an EMPTY
 *  public site: if the language in force qualifies no published note at all,
 *  the filter stands down for that request and the full set is served with
 *  `MeData.languageFallback` set, rather than answering a visitor with a site
 *  that appears to have nothing in it. */
export type LanguageFilterMode = "off" | "follow" | "ar" | "en";
/** What a delete is ACTUALLY about to take — `GET /api/delete-preview?path=`.
 *
 *  A folder-delete dialog that counts only markdown lies by omission, and it
 *  cost the owner a published essay: he moved a note out of its folder,
 *  deleted the now note-less folder, read "0 notes" and lost the four images
 *  the essay still embedded. The count of files is not the interesting number;
 *  the number of them something SURVIVING still points at is. */
export interface DeletePreview {
  /** What the target is. Mirrors which dialog the client is about to open. */
  kind: "folder" | "note" | "attachment";
  /** `.md` files that go with it (1 for a note, 0 for an attachment). */
  notes: number;
  /** Non-markdown files that go with it (1 for an attachment). */
  attachments: number;
  /** How many of those attachments a note that SURVIVES the delete still
   *  embeds or links. Notes inside the target are not survivors, so a folder
   *  whose images only its own notes use reports 0 — nothing breaks. */
  referenced: number;
  /** The surviving notes doing the referencing (for a note target: the notes
   *  that `[[wikilink]]` it). Vault-relative, sorted, capped at
   *  `referrerCount` — see it for the true total. */
  referrers: string[];
  /** How many surviving notes reference the target in total; `referrers` is a
   *  sample of at most `REFERRER_SAMPLE` of them. */
  referrerCount: number;
}

/** One top-level entry of the vault's `.trash/` — `GET /api/trash`.
 *
 *  The trash is the safety promise every delete dialog makes ("recoverable
 *  from disk"), and until this listing existed the product never showed it:
 *  the only way to honour the promise was a terminal and a `mv`. */
export interface TrashEntry {
  /** The entry's own name INSIDE `.trash/`, which is its id for restore and
   *  purge. Never a path: the trash is flat at its top level, and a name
   *  carrying a separator is refused. */
  name: string;
  /** Where it came from — recorded at delete time, so restoring puts it back
   *  rather than dumping it at the vault root. Null for an entry no manifest
   *  covers (trashed by hand, or by a build older than the manifest), which
   *  the UI says out loud before it restores to the root. */
  origin: string | null;
  /** A folder, a note or an attachment — the same three kinds the delete
   *  dialogs distinguish. */
  kind: "folder" | "note" | "attachment";
  /** When it was trashed: the manifest's timestamp, else the entry's mtime. */
  deletedMs: number;
  /** `.md` files inside (1 for a note); folders count recursively. */
  notes: number;
  /** Non-markdown files inside (1 for an attachment). */
  attachments: number;
  /** Total bytes on disk. */
  bytes: number;
  /** True when `origin` still exists in the vault, so a restore would collide
   *  and land beside it under a counter. The dialog says so first. */
  originTaken: boolean;
}

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
  /** settings.languageFilter — how this site curates by note language.
   *  Visitor-safe like `languageToggle` (it describes the public shell), and
   *  the client NEEDS it: under "follow" a visitor flipping the EN/ع switch
   *  changes which notes exist for them, so the shell must refetch instead of
   *  merely re-skinning. Absent = "off". */
  languageFilter?: LanguageFilterMode;
  /** Set when the language filter STOOD DOWN for this request because the
   *  language in force (this value) qualified no published note — the site is
   *  showing everything rather than nothing. The public shell prints a quiet
   *  line; the admin gets the loud version (see `visibility`). */
  languageFallback?: "ar" | "en";
  /** ADMIN SESSIONS ONLY: what the visitor-facing settings are currently
   *  costing in reach. Present whenever something is materially reducing what
   *  visitors see, so the chrome can carry an ongoing indicator instead of
   *  letting a site quietly shrink to two posts unnoticed. */
  visibility?: VisibilityImpact;
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
  /** PUBLIC_LAYOUT (absent = "app"). "designed" is the site design engine:
   *  the visitor shell is composed from VELLUM_DATA/designs.json instead of
   *  the stock blog components. The server only ever SENDS "designed" when a
   *  design is actually renderable — an empty store, a corrupt file or a
   *  quarantined document all answer "blog", so a visitor's first byte is the
   *  pristine base and nothing has to fall back in the browser. */
  publicLayout?: "app" | "blog" | "designed";
  /** Signature of the ACTIVE design (id + updatedMs), present only in
   *  "designed" mode. Its value changes whenever the design does, which is
   *  what lets the client refetch instead of re-rendering yesterday's layout
   *  after a save. */
  design?: string;
  /** Signature of this instance's custom themes; present makes the client
   *  link /api/design/themes.css, and the value is that link's ?v=. Same
   *  contract as `fonts` above, and sent to every session for the same
   *  reason — a custom theme is the public site's own colour. */
  customThemes?: string;
  /** Why the designed site could not be served, for an ADMIN session only.
   *  Visitors get the stock blog and no explanation, which is the whole
   *  point; the owner gets a sentence naming the design and the reason. */
  designNotice?: { reason: string; design?: string; detail?: string };
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
  /** settings.dateCalendar — which calendar every human-facing date on this
   *  instance is printed in. Sent to EVERY session and in BOTH shells: blog
   *  post meta, dashboard cards, comment timestamps, moderation rows, sync
   *  status and About all read it, and an admin previewing as a visitor must
   *  see the visitor's calendar. Absent = "gregorian". RSS is deliberately
   *  untouched — the XML keeps RFC-822 Gregorian, which is a wire format. */
  dateCalendar?: DateCalendarSetting;
  /** settings.textDirection / settings.textAlign — the SITE default for note
   *  prose in the editor, the reading view and blog articles. A per-note
   *  `dir:`/`align:` in frontmatter beats both. Absent = "auto" / "start",
   *  i.e. exactly the behaviour that shipped before this existed. */
  textDirection?: TextDirectionSetting;
  textAlign?: TextAlignSetting;
}

// ── Visibility impact (ADMIN ONLY) ──────────────────────────────────────────
// GET /api/visibility → VisibilityImpact. Every query param is a HYPOTHETICAL
// override (`languageFilter`, `excludeTags`, `home`, `homeNote`,
// `publicLayout`); anything absent describes what is in force right now. It
// exists because four different settings on this instance can shrink the
// public site, and every one of them used to be a switch with no stated
// consequence: the owner turned the language filter on and his site went from
// 20 posts to 2, silently, with nothing anywhere saying so. A setting that can
// hide a site must be able to say — in real numbers, from this vault, BEFORE
// the save — exactly what it will hide.
//
// Admin-only for the same reason /api/published is: the counts describe
// precisely what the public surfaces are withholding.
export interface VisibilityImpact {
  /** Notes the owner marked `publish: true` — the intent to be public. */
  published: number;
  /** Of those, how many a visitor would actually discover under this scope. */
  visible: number;
  /** Published notes the LANGUAGE filter alone removes. */
  hiddenByLanguage: number;
  /** The mode this answer describes (in force, or the one asked about). */
  languageFilter: LanguageFilterMode;
  /** The language the count was taken at, or null when nothing is filtered.
   *  `"follow"` resolves to the SITE language here: the reader's own language
   *  is per-visitor, so a single number cannot describe it — `census` is what
   *  describes "follow", one row per reader population. */
  filterLang: "ar" | "en" | null;
  /** True when the filter stood down because `filterLang` qualified nothing
   *  (see LanguageFilterMode) — `visible` is then the unfiltered count. */
  fallback: boolean;
  /** How the published set splits by the script its PROSE is written in.
   *  `neutral` notes (no prose letters — image-only, numeric) belong to no
   *  language and are shown under every mode. */
  census: { arabic: number; latin: number; neutral: number };
  /** Topic pills a visitor sees, against how many the visible set carries —
   *  and which excluded tags actually bite (an EXCLUDE_TAGS entry matching
   *  nothing is worth knowing too). */
  topics: { visible: number; total: number; suppressed: string[] };
  /** PUBLIC=false: nothing is readable without a session, whatever the rest
   *  of this says. The single biggest reducer, and env-only. */
  publicReads: boolean;
  /** Which shell visitors land in — "app" ignores `home.mode` entirely.
   *  "designed" is the design-engine shell (server/pages.ts). */
  publicLayout: "app" | "blog" | "designed";
  /** The blog front door: mode, the note it names, and whether that note is
   *  itself visitor-visible (a home note the filter hides is a blank home). */
  home: { mode: "note" | "dashboard"; note: string | null; noteVisible: boolean };
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

/** A STATIC PAGE: an ordinary published note carrying `page: true` in its
 *  frontmatter. It has no separate store and no separate URL space — it is a
 *  note that the designed site lays out as a page (title + prose) instead of
 *  as an article (date, reading time, tags, related, comments). */
export interface PageMeta {
  path: string;  // vault-relative note path
  title: string; // basename without .md, bidi controls stripped
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
  /** Visitor-facing layout (overrides PUBLIC_LAYOUT). "designed" renders the
   *  active design in VELLUM_DATA/designs.json; the stock blog stays exactly
   *  where it is, so switching back is a rescue rather than a migration. */
  publicLayout?: "app" | "blog" | "designed";
  /** Chrome language (overrides SITE_LANG): "ar" localizes all chrome
   *  strings to Arabic and mirrors the UI right-to-left. */
  language?: "en" | "ar";
  /** How public blog surfaces (lists, topics, search, graph, RSS, SSE,
   *  prev/next) curate by the language a note is WRITTEN IN. See
   *  LanguageFilterMode. Admin surfaces unaffected. Default "off".
   *
   *  A stored boolean from before this was an enum is migrated on read AND
   *  rewritten on disk at startup: `true` becomes the site language pinned
   *  ("ar"/"en"), which is exactly what it used to mean, and `false` becomes
   *  "off". It deliberately does NOT become "follow" — a live site must not
   *  change behaviour because it was upgraded. */
  languageFilter?: LanguageFilterMode;
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
  /** Templates folder (vault-relative), Obsidian's core-Templates setting.
   *  Absent → the server auto-detects an unambiguously named folder
   *  ("Templates", "_templates", "قوالب"); ambiguity means unset, never a
   *  guess. Notes inside it are stencils: they never appear in the post list. */
  templatesFolder?: string;
  /** Template applied to every NEW note (vault-relative note path). Absent —
   *  the default — means new notes are born empty, as they always have been. */
  defaultTemplate?: string;
  /** Git backup & sync (off by default). The token, when one is used, is NOT
   *  here — it lives in VELLUM_DATA/git-credentials.json (0600). */
  gitSync?: GitSyncSettings;
  /** Typography: catalog ids (or "system") per slot. Chosen faces are cached
   *  under VELLUM_DATA/fonts/catalog/ and served from this instance only. */
  fonts?: FontSlotSettings;
  // ── Localization: calendar, note layout, tag labels ──────────────────────
  // (See "Hijri dates", "Note alignment" and "Localised tag labels" in
  // CONTRACTS.md. All three are DISPLAY decisions: nothing here ever changes
  // a byte in the vault, and RSS keeps RFC-822 Gregorian regardless.)
  /** Calendar human-facing dates are rendered in. Default "gregorian".
   *  "hijri" is Umm al-Qura; "both" prints one with the other parenthesised,
   *  ordered by the site language. */
  dateCalendar?: DateCalendarSetting;
  /** Base direction for note PROSE (editor, reading view, blog article).
   *  Default "auto" — every block takes its own direction from its first
   *  strong character, which is the behaviour that shipped. */
  textDirection?: TextDirectionSetting;
  /** Alignment for note prose. Default "start" — the reading direction's
   *  leading edge. A per-note `align:` in frontmatter beats this. */
  textAlign?: TextAlignSetting;
  /** Where a tag's own page lives ("tags" by default). A note at
   *  `<tagsFolder>/<tag>.md` may carry `labels: { ar: … }`, which outranks
   *  the `tagLabels` map below. */
  tagsFolder?: string;
  /** Display labels for canonical tags: tag → language → label. For tags
   *  with no page of their own. Never rewrites frontmatter; URLs,
   *  EXCLUDE_TAGS and the language filter keep matching the canonical tag.
   *  Shape and resolution live in `shared/tagLabels.ts` (`TagLabelMap`). */
  tagLabels?: Record<string, Record<string, string>>;
}

/** Mirrors `DateCalendar` in shared/dates.ts (types.ts stays import-free, the
 *  same bargain `NoteAnchorInfo` strikes with shared/tex.ts). */
export type DateCalendarSetting = "gregorian" | "hijri" | "both";
/** Mirrors `TextDirection` / `TextAlign` in shared/textLayout.ts. */
export type TextDirectionSetting = "auto" | "ltr" | "rtl";
export type TextAlignSetting = "start" | "left" | "right" | "center" | "justify";

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
  publicLayout: "app" | "blog" | "designed";
  blogLocale: string;
  language: "en" | "ar";
  languageFilter: LanguageFilterMode;
  languageToggle: boolean;
  excludeTags: string[];
  commentsEnabled: boolean;
  shareButtons: boolean;
  favicon: string | null;
  logo: string | null;
  /** The templates folder actually in force: the stored value when set, the
   *  auto-detected one otherwise, null when neither. The client reads THIS —
   *  a detected folder is as real as a configured one. */
  templatesFolder: string | null;
  /** Whether `templatesFolder` above was auto-detected rather than stored, so
   *  the settings panel can say so instead of showing an empty field beside a
   *  feature that is quietly working. */
  templatesFolderDetected: boolean;
  defaultTemplate: string | null;
  home: Required<Pick<HomeSettings, "mode">> & Omit<HomeSettings, "mode">;
  gitSync: GitSyncEffective;
  /** Typography slots in effect (every slot present, "system" when unset). */
  fonts: FontSlotsEffective;
  /** Localization: the three display settings in force (defaults filled in)
   *  plus the tag-label map the settings editor prefills from. */
  dateCalendar: DateCalendarSetting;
  textDirection: TextDirectionSetting;
  textAlign: TextAlignSetting;
  tagsFolder: string;
  /** True when `tagsFolder` was auto-detected rather than configured — the
   *  same fact `templatesFolderDetected` carries for the field above it, so
   *  the panel can say which folder it found instead of leaving the reader to
   *  guess whether an empty field means "tags" or "the one in your vault". */
  tagsFolderDetected: boolean;
  tagLabels: Record<string, Record<string, string>>;
}

/** PATCH /api/settings body: only the named keys change; null (or "") clears
 *  one back to its env default. Strict allowlist — unknown keys are a 400. */
export interface SettingsPatch {
  siteName?: string | null;
  tagline?: string | null;
  footer?: string | null;
  defaultTheme?: string | null;
  publicLayout?: "app" | "blog" | "designed" | null;
  language?: "en" | "ar" | null;
  languageFilter?: LanguageFilterMode | null;
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
  /** Templates folder; null (or "") clears it back to auto-detection. */
  templatesFolder?: string | null;
  /** Template for new notes; null (or "") turns the default back off. */
  defaultTemplate?: string | null;
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
  /** Localization (null clears each back to its default). `tagLabels` is
   *  replaced WHOLE, not merged: the settings editor holds the entire map on
   *  screen, so a partial merge would make deleting a row impossible. */
  dateCalendar?: DateCalendarSetting | null;
  textDirection?: TextDirectionSetting | null;
  textAlign?: TextAlignSetting | null;
  tagsFolder?: string | null;
  tagLabels?: Record<string, Record<string, string>> | null;
}

// GET /api/tag-labels → TagLabelsResponse. The DISPLAY names of the vault's
// tags, merged from the tag pages' own frontmatter and settings.tagLabels.
// Open to visitors (a chip's word is what the public site paints) but scoped
// like every other tag surface: a visitor is told about visible tags only, so
// the map cannot become an oracle for EXCLUDE_TAGS or for a tag carried solely
// by language-filtered notes.
export interface TagLabelsResponse {
  /** canonical tag → language tag → label. */
  labels: Record<string, Record<string, string>>;
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

// ── LaTeX notes: anchors & cross-references ─────────────────────────────────
// `.tex` and `.latex` files are notes throughout (tree, index, search, graph,
// backlinks, tags, publish, posts, RSS). The two wire shapes below exist for
// the one thing markdown never needed: a NAMED PLACE inside a note that
// another note can point at from either format.

/** One named anchor inside a note — a markdown heading or a LaTeX `\label`,
 *  deliberately the same kind of thing. `[[Note#anchor]]` and
 *  `\ref{Note#anchor}` are one lookup against this table, whatever the
 *  target's format, and `![[Paper#eq:fourier]]` transcludes the one block it
 *  names. Mirrors `NoteAnchor` in shared/tex.ts, which is where it is built. */
export interface NoteAnchorInfo {
  /** Address: a slugified heading, or a `\label{…}` value verbatim. */
  id: string;
  kind: "heading" | "label" | "equation" | "figure" | "table" | "section" | "theorem";
  /** What a reader would call it — heading text, caption, or "(3)". */
  title: string;
  /** 1-based source line. */
  line: number;
  /** Printed number when the thing carries one ("3", "1.2", "A.1"). */
  number?: string;
}

// GET /api/anchors?path= → AnchorsResponse. Visitor-scoped exactly like
// /api/note: a published note's anchors are readable, nothing else is.
export interface AnchorsResponse {
  path: string;
  anchors: NoteAnchorInfo[];
}

// GET /api/banner?value=&note= → BannerResolution. One `banner:` value (or a
// settings image reference) run down the resolution ladder: an https URL
// passes through, a vault-relative path is checked, then the same path
// relative to the referring note's own folder, then the basename through the
// resolver `![[embeds]]` use. A miss is 200 with `path: null` — a typo'd
// banner is an ordinary state of a vault, not an error — and null is what the
// admin surfaces turn into the "missing image" placeholder and the visitor
// surfaces turn into nothing at all.
export interface BannerResolution {
  /** Echo of the value asked about, so a late response can be matched. */
  value: string;
  /** An https URL, a vault-relative attachment path, or null (unresolvable —
   *  or, for a visitor, resolvable but not theirs to fetch). */
  path: string | null;
}

// GET /api/xref?label= | ?cite= → XrefResponse. The VAULT-WIDE half of LaTeX
// cross-referencing, asked only after the local document has been checked —
// local-first is what guarantees that importing a project never changes how it
// compiles. A miss is 200 with nulls, like /api/resolve.
export interface XrefResponse {
  /** The note carrying the label or citekey, or null. */
  path: string | null;
  /** The matched anchor (label lookups only; null for a citekey). */
  anchor: NoteAnchorInfo | null;
}
