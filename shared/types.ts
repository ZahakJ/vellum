// Shared types — the wire contract between server and client. Do not drift from these.

import type { AttachmentMode } from "./attachments.ts";
import type { BookHighlight, BookState } from "./bookAnchor.ts";
import type { FolderIcon } from "./folderIcons.ts";
import type { TrackerRating, TrackerStatus } from "./tracker.ts";

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

/** ONE NOTE'S DISK STATE, AND NOTHING ELSE — the cheap half of `NoteData`.
 *
 *  A client that has been asleep (a laptop lid, a backgrounded tab, a desktop
 *  app left running for days) misses every SSE frame while it is away, and
 *  EventSource replays nothing on reconnect. It therefore wakes holding
 *  buffers whose `baseMtimeMs` describes a file that has since moved — and
 *  when a SECOND server writes the same vault (the desktop app's child server
 *  beside a systemd instance), even a client that never slept can miss the
 *  news, because the two watchers announce to their own subscribers only.
 *
 *  `GET /api/note/state` answers "is what I hold still the file?" for the open
 *  tabs in one round trip, without shipping their bodies back. `mtimeMs` is
 *  null when the note is not there — deleted, or (for a visitor-scoped
 *  session) not theirs to know about, which are deliberately the same answer. */
export interface NoteState {
  path: string;
  mtimeMs: number | null;
}

export interface NoteStatesResponse {
  states: NoteState[];
}

export interface SearchHit {
  path: string;
  title: string;         // basename without .md
  snippet: string;       // ~160 chars of matched context, match wrapped in <mark>…</mark>
  score: number;
  /** The frontmatter alias that earned this hit, when the title did not — the
   *  row says so, because a result whose words appear nowhere in the note
   *  otherwise reads as a bug. Absent on an ordinary title/body match. */
  alias?: string;
}

/** One frontmatter alias and the note it names — `GET /api/aliases`, which is
 *  how `[[` autocomplete learns names the vault TREE does not carry. */
export interface AliasEntry {
  alias: string;
  path: string;
  title: string;
}
export interface AliasesResponse { aliases: AliasEntry[] }

export interface GraphNode { id: string; title: string; links: number; tags: string[] }
export interface GraphEdge { source: string; target: string }
export interface GraphData { nodes: GraphNode[]; edges: GraphEdge[] }

export interface Backlink {
  path: string;
  title: string;
  context: string; // the line containing the link, cleaned for display
  /** 1-based line of the mention in the note's FULL source (frontmatter
   *  included) — the number the editor's own goto machinery counts in, so a
   *  click can land ON the mention instead of at the note's top. Appended,
   *  never reordered: the wire shape above it is what older clients read. */
  line: number;
}

/** One matched line inside one note — `GET /api/search/matches?path=&q=`.
 *  `text` arrives like `SearchHit.snippet` does: HTML-escaped with the matched
 *  terms wrapped in literal `<mark>…</mark>`, so the client renders both
 *  through the same renderer and they cannot drift apart. `line` counts like
 *  `Backlink.line`: 1-based, full source, frontmatter included. */
export interface SearchMatch { line: number; text: string }

export interface TagCount { tag: string; count: number }

export interface VaultEvent {
  /** `"bulk"` is the ONE kind that names no file: "too much changed to
   *  narrate — re-read everything you are holding". It is produced only by the
   *  aggregate coalescer in server/vault.ts and only for subscribers that
   *  answer an event by refetching (the SSE stream), never for the index,
   *  which needs every path. `path` is "" on it. */
  kind: "created" | "changed" | "deleted" | "renamed" | "bulk";
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

/** One entry of settings.authorSites as the ADMIN writes it: a URL and an
 *  optional display title that outranks whatever the site says about itself. */
export interface AuthorSiteRef {
  url: string;
  title?: string;
}

/** What a VISITOR receives for one author site: the reference enriched with
 *  the site's own OpenGraph story (server/authorSites.ts fetches and caches
 *  it). `title` always resolves — the admin's override, the page's og:title,
 *  or the bare domain, in that order — so the blog never renders a hole. */
export interface AuthorSiteCard {
  url: string;
  domain: string;
  title: string;
  description?: string;
  image?: string;
}

/** One PUBLIC FOLDER as the owner writes it in settings.json: a page of their
 *  own making on the public site, outside the tag system. Notes join it by
 *  naming its `slug` in their `folders:` frontmatter — nothing here reaches
 *  into the vault, and nothing in the vault can invent one of these. */
export interface PublicFolderRef {
  /** Stable row id: React keys and the reorder buttons. NOT the identity — the
   *  slug is what the URL, the frontmatter and every link use — so renaming a
   *  slug is a real rename and this value simply comes along. */
  id: string;
  /** URL segment (`/folder/<slug>`) and the word frontmatter names.
   *  `^[a-z0-9][a-z0-9-]*$`, ≤ 60. */
  slug: string;
  /** What the folder is CALLED — the card, the page heading, the nav chip. */
  title: string;
  /** One glyph from the closed set in shared/folderIcons.ts. */
  icon: FolderIcon;
  /** One line under the title on the card and the folder page. ≤ 200. */
  description?: string;
  /** Taken down without being deleted (the NavItem precedent): the folder
   *  keeps its title, glyph and members and reaches no visitor at all. */
  hidden?: boolean;
}

/** settings.publicFolders — ONE option with sub-options, the `attachments`
 *  shape. `enabled` is the master switch; `nav` and `home` decide where the
 *  folders SHOW; `folders` is the list itself, which survives the master being
 *  turned off (turning the feature off is a take-down, not a delete). */
export interface PublicFoldersSettings {
  /** The master switch. Absent = off: an upgraded instance publishes nothing
   *  new until the owner asks for it. */
  enabled?: boolean;
  /** Folder chips at the START of the topic nav row. Default false. */
  nav?: boolean;
  /** The folders band on the blog home. Default TRUE — a folder nobody can
   *  find is not a folder, so the discovery surface is the one that is on. */
  home?: boolean;
  /** The folders, in the order the owner arranged them. ≤ 12. */
  folders?: PublicFolderRef[];
}

/** What a VISITOR receives for one public folder: the reference minus the
 *  bookkeeping, plus the one fact only the server can supply — how many posts
 *  this session can actually see in it. A hidden folder never becomes one. */
export interface PublicFolderCard {
  id: string;
  slug: string;
  title: string;
  icon: FolderIcon;
  description?: string;
  /** Published posts carrying this slug that THIS session may see (the
   *  languageFilter and EXCLUDE_TAGS apply, exactly as they do to /api/posts).
   *  Zero is a real answer and still renders: an empty folder on a live site is
   *  an invitation, not a bug. */
  count: number;
}

export interface MeData {
  admin: boolean;      // this session may mutate the vault
  public: boolean;     // reads are open without a session (PUBLIC != false)
  protected: boolean;  // an ADMIN_PASSWORD_HASH is configured (sign in/out is meaningful)
  preview?: boolean;   // admin session previewing as visitor (X-Vellum-Preview) — payload above is visitor-shaped
  homeNote?: string;   // note opened for fresh visitors (HOME_NOTE)
  published?: PublishedCounts; // publish stats for admin UI copy (admin sessions only)
  siteName?: string;   // instance branding (SITE_NAME; default "Vellum")
  /** The author's other sites, enriched and ready to render (blog home shows
   *  them as cards). Present only when configured AND the server has cards —
   *  a cold cache warms in the background and the next load carries them. */
  authorSites?: AuthorSiteCard[];
  /** The theme applied when this session has no stored choice — already
   *  RESOLVED by the server: a pinned `settings.defaultTheme`/`DEFAULT_THEME`,
   *  or (in the default "follow" mode) the theme the admin's own editor is
   *  wearing, mirrored to `settings.adminTheme`. Absent = the built-in
   *  default. A visitor who has picked a theme is never touched by it. */
  defaultTheme?: string;
  /** ADMIN SESSIONS ONLY: why `defaultTheme` is what it is, so the chrome can
   *  SAY it ("Visitors see Cinnabar — following your editor theme") instead of
   *  letting an owner discover that their personal browsing moved the public
   *  site. Never sent to visitors: it describes the owner, not the site. */
  publicTheme?: PublicThemeInfo;
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
  shareButtons?: boolean; // blog article share row (settings.shareButtons, default ON; absent = on)
  home?: HomeSettings; // settings.home — what "/" renders for blog visitors (absent = note mode)
  /** settings.publicFolders, resolved into ready-to-render cards. Present only
   *  in blog mode, only when the feature is enabled, and only when at least one
   *  visible folder survives — so a site that never turned this on ships a
   *  byte-identical payload. Counts are scoped to this session. */
  publicFolders?: PublicFolderCard[];
  /** Where those cards may be drawn: the two sub-options, resolved. Sent
   *  beside the cards rather than folded into them because they describe the
   *  SITE, not a folder — and because the folder PAGE (`/folder/<slug>`) works
   *  regardless of either: turning off the home band hides a door, it does not
   *  unpublish the room behind it. */
  publicFoldersHome?: boolean;
  publicFoldersNav?: boolean;
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
  /** settings.folderIcons — the vault tree's per-folder marks, folder path →
   *  glyph. Sent outside the blog-only block (an admin has the sidebar in
   *  every layout) but ADMIN SESSIONS ONLY: the keys are vault folder paths,
   *  and a visitor's tree has no folders in it — publishedTree() gives them a
   *  flat published-note list, which is precisely the promise that stops
   *  vault paths reaching them. Absent when nothing is marked. */
  folderIcons?: Record<string, FolderIcon>;
  /** Where new attachments land, as the "Move to…" picker needs to know it
   *  (v1.8 audit, F11: the picker offered `attachments/` as a destination for
   *  NOTES, which is the one folder in the vault a note has no business in).
   *  `mode` is the policy from shared/attachments.ts and `folder` its name;
   *  only the two folder-bearing modes send anything, because the other two
   *  name no folder to keep a note out of. ADMIN SESSIONS ONLY, on the same
   *  grounds as folderIcons above: it is a vault path, and moving is admin. */
  attachmentFolder?: { mode: "specified" | "subfolder"; folder: string };
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

/** The public default theme, explained (MeData.publicTheme, admin-only, and
 *  the answer POST /api/theme gives back). */
export interface PublicThemeInfo {
  /** "follow" — visitors track the admin's editor theme (the default);
   *  "pinned" — `settings.defaultTheme` / `DEFAULT_THEME` names a theme and
   *  the admin's own browsing no longer moves the public site. */
  mode: "follow" | "pinned";
  /** The theme a cookieless visitor lands on right now (null = the built-in
   *  default, i.e. follow mode before the admin's browser has mirrored
   *  anything). Same value as MeData.defaultTheme. */
  theme: string | null;
  /** The pin comes from the DEFAULT_THEME env var rather than settings.json —
   *  the panel says where a value lives, so it says it here too. */
  env?: boolean;
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
  /** Frontmatter `folders:` — the public-folder slugs this post belongs to.
   *  Absent when the note names none, which is almost every note. Carried on
   *  the post rather than fetched per folder because the blog already holds the
   *  whole post list client-side: the folder page is one `.filter()` over it,
   *  exactly as the topic page is. */
  folders?: string[];
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

// GET /api/trackers → TrackerMeta[]: every ```tracker fence in the vault, one
// row per fence (a note may hold several), newest-touched first. The shelf a
// ```tracker-board fence draws.
//
// Scoped EXACTLY like /api/posts, and for the same reason: a visitor session
// sees published notes only, with the language filter applied and templates
// out (a stencil would list as a book you are 0% through). An admin sees the
// whole vault. Publishing your gaming shelf is the point of the feature, so
// the endpoint has to be trustworthy about which half of it is public.
export interface TrackerMeta {
  path: string;      // the note the fence lives in
  title: string;     // the tracker's own title ("Elden Ring")
  noteTitle: string; // the note's title — the card's tooltip, since one note may hold many
  kind: string | null;   // as authored ("game", "مسلسل"); null when the fence names none
  icon: FolderIcon;      // derived from the kind, never authored
  percent: number | null;
  done: number | null;
  total: number | null;
  unit: string | null;   // the author's own word; the card falls back to the kind's default
  status: TrackerStatus;
  rating: TrackerRating | null;
  /** The cover attachment, RESOLVED to a vault path (fetch via
   *  /api/file?path=), or null. Resolved server-side through the same ladder
   *  embeds use, so the board does not spend one /api/resolve per card — and
   *  scoped to the session, so a visitor never gets a path they may not
   *  fetch. */
  cover: string | null;
  /** The note's mtime in epoch ms — the board's sort key. NOT the post date:
   *  `date:` in frontmatter is when the thing was started, and a shelf sorts
   *  by what you touched last. */
  updatedMs: number;
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
  /** What visitors without a stored choice get (overrides DEFAULT_THEME).
   *  One of the fifteen ids in `shared/themes.ts` — the list both the client's
   *  picker and the server's validator read, so they cannot drift — or the
   *  word "follow" (FOLLOW_THEME), which serves `adminTheme` instead.
   *  ABSENT = "follow": a fresh instance's blog wears its author's theme. */
  defaultTheme?: string;
  /** The admin's own editor theme, mirrored here from their browser (their
   *  pick lives in localStorage; the server has no other way to know it).
   *  Written by POST /api/theme, debounced client-side so flicking through the
   *  picker does not write fifteen times. Kept SEPARATE from `defaultTheme` on
   *  purpose: pinning a theme and going back to following must lose neither
   *  the pin nor the mirror. Read only while `defaultTheme` is "follow". */
  adminTheme?: string;
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
  /** The author's other sites, shown to blog visitors as rich cards ("more
   *  from the author"). ≤ 6 entries, each an http(s) URL the server will
   *  enrich with the site's own OpenGraph metadata. */
  authorSites?: AuthorSiteRef[];
  /** Marginalia comments on/off (overrides COMMENTS). */
  commentsEnabled?: boolean;
  /** Show the share-links row under blog articles (default ON). */
  shareButtons?: boolean;
  /** Favicon: vault-relative image path (uploaded attachment), served at
   *  /favicon.ico. Absent → the built-in glyph. */
  favicon?: string;
  home?: HomeSettings;
  /** The owner's own navigation collections on the stock blog: a master switch,
   *  two placement sub-options and the folder list. Membership is declared by
   *  each note's `folders:` frontmatter, so nothing here duplicates the vault.
   *  Designed mode ignores this key entirely — that shell composes its own
   *  navigation from NavItems (see docs/blog-mode.md). */
  publicFolders?: PublicFoldersSettings;
  /** Site logo image (https URL or vault path) shown in place of the
   *  site-name text where a logo fits (masthead, sidebar, dashboard hero). */
  logo?: string;
  /** Where new attachments are written (Obsidian's "Default location for new
   *  attachments"). Absent → mode "specified" with ATTACHMENTS_DIR as the
   *  folder, i.e. exactly what instances did before this key existed.
   *  Existing attachments are never moved by a change here. */
  attachments?: AttachmentSettings;
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
  /** Per-folder marks for the vault tree: vault-relative FOLDER path → one
   *  glyph from the closed set in `shared/folderIcons.ts`. A folder with no
   *  entry wears nothing, which is the default and the majority. Lives here
   *  rather than in a sidecar file for the reason CONTRACTS.md:2918-2938
   *  gives: a handful of short strings, rewritten whole, on no hot path. */
  folderIcons?: Record<string, FolderIcon>;
}

export interface AttachmentSettings {
  /** vault-root | same-folder | subfolder | specified (see shared/attachments.ts). */
  mode?: AttachmentMode;
  /** The folder the two folder-bearing modes use: a vault-relative path for
   *  "specified", a relative subfolder name for "subfolder". Path-safe, never
   *  a dot-folder, created on demand. */
  folder?: string;
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
  /** The default-theme PREFERENCE in force: a pinned theme id, or "follow"
   *  (the default). Never null in practice — an unset key resolves to
   *  "follow" — but the field keeps its nullable type for older clients. */
  defaultTheme: string | null;
  /** The theme a cookieless visitor actually lands on right now: the pin, or
   *  the mirrored admin theme, or null for the built-in default. The panel
   *  prints this ("Visitors see …") so the rule is never invisible. */
  visitorTheme: string | null;
  publicLayout: "app" | "blog" | "designed";
  blogLocale: string;
  language: "en" | "ar";
  languageFilter: LanguageFilterMode;
  languageToggle: boolean;
  excludeTags: string[];
  authorSites: AuthorSiteRef[];
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
  /** Public folders with every default filled in — what the settings editor
   *  prefills from, so an unset key and an explicitly-default one look the
   *  same to the panel (there is no env counterpart to inherit from). */
  publicFolders: Required<Omit<PublicFoldersSettings, "folders">> & { folders: PublicFolderRef[] };
  /** Always resolved: the attachment mode in force and the folder it uses. */
  attachments: Required<AttachmentSettings>;
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
  /** The stored folder→glyph map, `{}` when nothing is marked. */
  folderIcons: Record<string, FolderIcon>;
}

/** PATCH /api/settings body: only the named keys change; null (or "") clears
 *  one back to its env default. Strict allowlist — unknown keys are a 400. */
export interface SettingsPatch {
  siteName?: string | null;
  tagline?: string | null;
  footer?: string | null;
  /** A theme id (pin it) or "follow" (visitors track the admin's editor
   *  theme). null clears the key back to DEFAULT_THEME, and to "follow" when
   *  that is unset too. */
  defaultTheme?: string | null;
  publicLayout?: "app" | "blog" | "designed" | null;
  language?: "en" | "ar" | null;
  languageFilter?: LanguageFilterMode | null;
  languageToggle?: boolean | null;
  blogLocale?: string | null;
  excludeTags?: string[] | null;
  authorSites?: AuthorSiteRef[] | null;
  commentsEnabled?: boolean | null;
  shareButtons?: boolean | null;
  favicon?: string | null;
  home?: {
    mode?: "note" | "dashboard" | null;
    note?: string | null;
    banner?: string | null;
  } | null;
  logo?: string | null;
  /** Public folders. Sub-keys merge like `attachments`; `folders` is REPLACED
   *  WHOLE, on the tagLabels terms — the editor holds the entire list on
   *  screen, so a merging patch would make deleting a row impossible. */
  publicFolders?: {
    enabled?: boolean | null;
    nav?: boolean | null;
    home?: boolean | null;
    folders?: PublicFolderRef[] | null;
  } | null;
  /** Where new attachments go. Either half may be set alone; null clears the
   *  whole key back to the pre-setting behaviour. */
  attachments?: {
    mode?: AttachmentMode | null;
    folder?: string | null;
  } | null;
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
  /** Folder glyphs, replaced WHOLE like `tagLabels` above and for the same
   *  reason: the picker writes the map the client is holding, so a merging
   *  PATCH would make "None" impossible — the cleared row would come back. */
  folderIcons?: Record<string, FolderIcon> | null;
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

// ------------------------------------------------- bulk rewrites (v1.8)
//
// Tag rename/merge and heading-link repair — and the vault-wide search and
// replace beside them — all answer in this shape, because they are all the same
// operation underneath (server/bulkRewrite.ts): read every candidate, transform
// it, write what changed under a precondition, keep the way back.

/** A file a bulk edit refused to touch. `conflict` is the important one: the
 *  note changed between our read and our write, so it was left exactly as
 *  somebody else left it. The dialogs name these files — a bulk edit that says
 *  "done" while quietly skipping four notes is the bulk edit nobody trusts. */
export interface BulkSkip {
  path: string;
  reason: "conflict" | "error";
}

export interface BulkResult {
  changed: { path: string; count: number }[];
  skipped: BulkSkip[];
  /** Files actually written. */
  notes: number;
  /** Substitutions across all of them. */
  edits: number;
  /** Hand this to POST /api/bulk/undo to put the vault back. Null when the
   *  edit was too large to hold in memory — the snapshot in Backup & sync is
   *  the floor under that case. */
  undoId: string | null;
}

/** GET /api/tags/rename-preview?from=&to= (admin only). The dry run every
 *  rename dialog shows before it will let the reader press anything. */
export interface TagRenamePreview {
  from: string;
  to: string;
  /** The target tag already exists in the vault, so this is a MERGE — two
   *  topics becoming one, which is not undone by renaming back. */
  merge: boolean;
  /** Notes that will actually be rewritten. */
  notes: number;
  /** Substitutions across them. */
  edits: number;
  /** A sample, for the dialog's list. */
  files: { path: string; count: number }[];
  /** The tag's own page under the tags folder, which follows the rename
   *  (its path IS the tag). Null when there is no such page, or when a merge
   *  means the destination page is already taken. */
  page: string | null;
}

/** POST /api/tags/rename { from, to } (admin only). */
export interface TagRenameResult extends BulkResult {
  from: string;
  to: string;
  /** Where the tag page ended up, when one moved. */
  page: string | null;
}

// ── Vault-wide search & replace (v1.8, parity #7) ──────────────────────────
//
// The scariest tool in the product, so the wire shape carries the evidence:
// every file names the mtime its preview was read at, and the apply refuses
// anything that has moved since. See server/searchReplace.ts.

/** One matched line, as the preview lists it and as the reader ticks it. Plain
 *  text on both sides — the client marks the difference itself, because a
 *  replace preview is the one place `<mark>` from the server would be marking
 *  something that does not exist yet. */
export interface ReplaceLine {
  /** 1-based line in the FULL file, frontmatter counted — the number the
   *  editor's goto machinery uses, so a row can be clicked open. */
  line: number;
  count: number;
  before: string;
  after: string;
}

export interface ReplacePreviewFile {
  path: string;
  /** The mtime this preview was read at. Sent straight back on apply. */
  mtimeMs: number;
  /** Substitutions in this file. */
  count: number;
  /** A sample of matched lines. Empty for files past the sampling cap. */
  lines: ReplaceLine[];
  /** More matched lines than are listed — the file is offered whole rather
   *  than line by line, and the row says so. */
  truncated: boolean;
}

/** GET /api/replace/preview (admin only). */
export interface ReplacePreview {
  files: ReplacePreviewFile[];
  notes: number;
  edits: number;
  /** More matching files than the ceiling allows; narrow the query. */
  truncated: boolean;
}

/** POST /api/replace (admin only) — a BulkResult with the two things only this
 *  tool has to report: files that moved between the preview and the press, and
 *  the snapshot it took first. */
export interface ReplaceResult extends BulkResult {
  /** Paths refused because the file changed after the preview read it. */
  conflicts: string[];
  /** The short sha of the commit made before the rewrite, when one was asked
   *  for and there was anything to commit. Null when the reader declined,
   *  when the vault is not a repository, or when the tree was already clean. */
  snapshot: string | null;
}

/** The offer a note write makes when the reader has just renamed a heading
 *  that other notes link INTO. Rides on the write's own response — see
 *  server/headingRepair.ts for why the write path is the seam. */
export interface HeadingRepairOffer {
  path: string;
  /** The anchor id the vault's links actually name. */
  from: string;
  /** …and the heading text they may have spelled instead. */
  fromTitle: string;
  to: string;
  toTitle: string;
  /** How many links point at the old anchor. Never 0 — no links, no offer. */
  links: number;
}

/** PUT /api/note → the note as written, plus the one thing the write noticed. */
export interface NoteWriteResult extends NoteData {
  headingRepair?: HeadingRepairOffer;
}

// POST /api/upload (admin only): multipart file (field "file") → saved under
// the folder the attachment-location setting resolves to. The optional field
// "dir" carries the vault folder the upload happened in (the open note's
// folder, the tree row dropped on) — it is what the "same folder" and
// "subfolder" modes are relative to, and it is ignored by the other two.
export interface UploadResult {
  path: string; // vault-relative path of the stored attachment
}

// `GET /api/impact` + `DeleteImpact` stood here and are gone. They asked what
// a delete would really take — the right question, prompted by a folder of
// four images truthfully answering "0 notes" — but `GET /api/delete-preview` +
// `DeletePreview` (above) answer it for notes, folders AND attachments, and
// carry the referencing titles the dialogs print. Two wire shapes for one
// question is how two dialogs come to describe one delete differently.

// POST /api/frontmatter { path, key, value } (admin only) → FrontmatterResult.
// Surgical frontmatter property edit; `value: null` removes the property.
//
// THE VALUE IS TYPED ON THE WIRE (v1.8, the editable properties card). A card
// with a checkbox, a date picker and list chips in it cannot say what it means
// with a string: `"true"` and `true` are different YAML, and so are
// `2026-01-02` and `"2026-01-02"`. The kind travels with the value so the
// writer spells it the way the reader picked it, instead of guessing from the
// characters — guessing is how a note titled "no" becomes `title: false`.
//
// A bare string is still accepted by the route and read as `{kind:"text"}`,
// because `banner:` has been written that way since v1.2 and its callers have
// nothing to say about kinds.
export type PropertyValue =
  | { kind: "text"; text: string }
  | { kind: "bool"; bool: boolean }
  | { kind: "date"; date: string }   // YYYY-MM-DD, written unquoted
  | { kind: "list"; items: string[] };

export interface FrontmatterResult {
  ok: true;
  path: string;                 // normalized vault-relative path
  key: string;
  value: PropertyValue | null;  // value after the edit (null = removed)
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
  /** The ABBREVIATED sha of the commit this pass made, when it made one.
   *
   *  A backup that reports success and nothing else is a sentence the reader
   *  cannot check against anything (v1.8 UX audit F40): "committed and pushed"
   *  is true of every successful pass ever run, so it says the same thing on
   *  the run that saved the chapter and on the run that saved a whitespace
   *  fix. Seven characters make it a specific event — one an owner can find in
   *  `git log`, or paste to whoever is helping them. Absent when the pass
   *  committed nothing, when it failed, and on results recorded before this
   *  field existed. */
  sha?: string;
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

// ── Note history (git log over one note) ────────────────────────────────────
// The undo of last resort. Backup & sync already commits the whole vault; this
// is the READ half — the same repository, asked "what did this note look like
// before?". Admin-only, and a graceful empty answer on a vault that is not a
// git repository yet, because the honest reply there is an invitation rather
// than an error.

/** One commit that touched a note, newest first. */
export interface NoteRevision {
  /** Full object name — what the blob route is asked for. */
  sha: string;
  /** git's own abbreviation, so a reader can paste it into `git log`. */
  short: string;
  /** Author date, ISO 8601 with offset. Formatted client-side through
   *  client/dates.ts, so a Hijri instance dates its history in Hijri. */
  iso: string;
  /** Commit subject, token-scrubbed and length-capped. */
  subject: string;
  /** The note's path AT THAT REVISION. `git log --follow` crosses renames, so
   *  an old revision of a note that has since moved lives under its old name
   *  and `git show <sha>:<path>` must be asked for that one. */
  path: string;
  /** Lines added / removed by this commit, or null for a revision git
   *  reported no numstat for (a binary blob, an empty merge).
   *
   *  This is what the spec's "sizes" became. A byte count of a markdown
   *  revision answers nothing a reader is asking — "+42 −3" answers "how much
   *  of this was that edit", which is the question the timeline exists for,
   *  and both come out of the same single `git log` call. */
  added: number | null;
  removed: number | null;
}

/** GET /api/history?path= */
export interface NoteHistoryResponse {
  /** False when the vault is not a git work tree — the client offers Backup &
   *  sync rather than reporting an empty history. */
  repo: boolean;
  revisions: NoteRevision[];
  /** The listing hit its ceiling: older revisions exist. */
  truncated: boolean;
}

/** GET /api/history/blob?path=&sha= */
export interface NoteRevisionBlob {
  sha: string;
  path: string;
  content: string;
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

// ── The library ────────────────────────────────────────────────────────────
// GET /api/books → BooksResponse. The vault's PDFs as a shelf: one entry per
// file on disk, each carrying the CONTENT KEY the reading store is filed under
// (shared/bookAnchor.ts explains why that is a hash of the bytes and not the
// path) and whatever state that key already has.
//
// Admin-only, and deliberately so: a book is a file the owner put in their
// vault, not something a published note linked to, and enumerating the shelf
// would answer "what else is in there" for a visitor who was shown one page.
// The BYTES of a book still travel through /api/file, which is publish-gated
// exactly as it always was — this route widens nothing.

export interface BookEntry {
  /** Vault-relative path, e.g. "Books/Muqaddimah.pdf". */
  path: string;
  /** Basename, for a shelf that has to print something before any PDF is
   *  parsed — most PDFs carry no /Title at all. */
  name: string;
  size: number;
  mtimeMs: number;
  /** sha256 of the byte sample (server/books.ts) — the reading-state key. */
  key: string;
  /** The stored reading state, or null when this book has never been opened.
   *  Null and "page 1" are different facts and the shelf draws them
   *  differently: nothing at all versus a hairline at the very start. */
  state: BookState | null;
}

export interface BooksResponse {
  books: BookEntry[];
  /** True when the walk stopped at the cap (BOOKS_MAX in server/books.ts).
   *  The shelf says so rather than quietly showing a prefix of a vault. */
  truncated: boolean;
}

// GET /api/books/one?path= → BookOpenResponse. What the reader asks for when a
// click on a tree row (or a /book/… URL) names a path: the key those bytes
// hash to, plus the position to restore. One round trip, before pdf.js is even
// downloaded, so the first page rendered is the page the reader was on rather
// than page 1 followed by a jump.
export interface BookOpenResponse {
  path: string;
  name: string;
  size: number;
  key: string;
  state: BookState | null;
}

// ── Annotations (GET|PUT|DELETE /api/books/highlights) ──────────────────────
//
// A highlight is a rectangle on a page and the words under it. It lives in
// VELLUM_DATA against the book's CONTENT KEY, never in the PDF — the PDF is a
// file the owner owns, syncs and backs up, and a reader who marks a sentence
// must not thereby rewrite a 400 MB scan. shared/bookAnchor.ts carries the
// shape (`BookHighlight`) and the validator; these are the envelopes the
// routes trade in.

export interface BookHighlightsResponse {
  key: string;
  highlights: BookHighlight[];
}

/** One highlight, plus enough about the book it is in to be listed and opened
 *  from somewhere that is not that book — the library's passage search. */
export interface BookHighlightHit {
  key: string;
  /** The last path this book was seen at. A LABEL, not an address: the key is
   *  the address, and this may well be stale by the time anyone reads it. */
  path: string;
  title: string;
  pages: number;
  highlight: BookHighlight;
}

export interface BookHighlightSearchResponse {
  hits: BookHighlightHit[];
  /** True when the store held more than the route will carry at once. */
  truncated: boolean;
}

// GET /api/books/locate?id= → BookLocation. What a citation asks when the
// filename in its wikilink no longer resolves: the id names a content key, the
// key names the bytes, and the server says where those bytes are NOW. `path`
// is null when they are not in this vault any more, which is a real answer and
// is told to the reader rather than hidden behind a spinner.
export interface BookLocation {
  key: string;
  path: string | null;
  /** Every name these bytes have been filed under, newest first — what the
   *  "repair this link?" offer shows. */
  names: string[];
  highlight: BookHighlight;
}
