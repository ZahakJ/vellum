// Global zustand store — the single source of truth for the shell.
// Shape follows the State interface pinned in CONTRACTS.md, plus three small
// shell-internal extensions: setDirty (the channel the Editor uses to report
// dirty state), remapPath (tab bookkeeping on renames), and reloadTick
// (bumped when the open note changed on disk, so the Editor remounts).

import { create } from "zustand";
import type { Backlink, HomeSettings, PublishedCounts, TreeNode } from "../shared/types.ts";
import * as api from "./api.ts";
import { clearBrokenEmbeds } from "./editor/embeds.ts";
import { collectNotes, resolveLink } from "./editor/links.ts";
import type { LanguageFilterMode, VisibilityImpact } from "../shared/types.ts";
import { setLang, setNumeralLocale, t, tf } from "./i18n.ts";
// Localization the shell pushes into plain modules rather than into the store:
// the calendar (client/dates.ts), the note-prose layout defaults
// (client/textLayout.ts) and the tag-label map (client/tagLabels.ts). Same
// shape as setLang above — imperative DOM (the properties card, the editor's
// decorations, the blog nav's measuring pass) has no store to subscribe to.
import { setDateCalendar } from "./dates.ts";
import { setSiteTextLayout } from "./textLayout.ts";
import { loadTagLabels } from "./tagLabels.ts";
import { DEFAULT_DATE_CALENDAR, isDateCalendar, type DateCalendar } from "../shared/dates.ts";
import {
  DEFAULT_TEXT_ALIGN,
  DEFAULT_TEXT_DIRECTION,
  isTextAlign,
  isTextDirection,
  type TextAlign,
  type TextDirection,
} from "../shared/textLayout.ts";
import type { Lang } from "./i18n.ts";
import { readVisitorLang, writeVisitorLang } from "./langPref.ts";
import { isTheme, THEMES } from "./themes.ts";
import type { ThemeChoice } from "./themes.ts";
import { isCustomThemeId } from "../shared/customTheme.ts";
import {
  applyThemeChoice,
  isKnownThemeChoice,
  syncCustomThemes,
} from "./design/customThemes.ts";
import { isPublishedContent } from "./publish.ts";
import { applyDefaultTemplate } from "./templateActions.ts";
import { toast } from "./toast.ts";
import { noteLabelOf, noteTitleOf } from "../shared/noteFormat.ts";

/** A note path as the reader knows it: the basename, minus `.md`. The toast
 *  that names a note is a sentence, not a file listing — and tf() bidi-isolates
 *  the value, so an Arabic title still reads correctly inside it. */
function noteTitle(path: string): string {
  return noteTitleOf(path);
}

const THEME_KEY = "vellum.theme";
const VIM_KEY = "vellum.vim";
const READING_KEY = "vellum.reading";
const TABS_KEY = "vellum.tabs";
const PREVIEW_KEY = "vellum.preview";
const SIDE_KEY = "vellum.sidebarSide";
const SIDEBAR_COLLAPSED_KEY = "vellum.sidebarCollapsed";

/** The drawer breakpoint, mirrored from app.css's `@media (max-width: 999px)`.
 *  At and below it the sidebar leaves the grid and becomes an overlay drawer
 *  (so the reading column keeps its full measure at 1024, 900 and 768 alike);
 *  its visibility is then `sidebarOpen`, not `sidebarCollapsed`. Keep the two
 *  numbers in step — this is the only copy of it in the client. */
export const DRAWER_QUERY = "(max-width: 999px)";

export function sidebarIsDrawer(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DRAWER_QUERY).matches;
}
const PANEL_COLLAPSED_KEY = "vellum.panelCollapsed";
const ZEN_KEY = "vellum.zen";

/** Which physical edge the notes sidebar sits on, once everything is settled.
 *  PHYSICAL, not logical: a reader who asks for "the left" means the left of
 *  the screen in either language. */
export type SidebarSide = "left" | "right";

/** The stored PREFERENCE behind that side, and it is three-state on purpose.
 *  `"auto"` is the default and is re-evaluated on every language change —
 *  right in Arabic, left in English — because the leading edge is a property
 *  of the direction, not a thing the reader should have to re-pick. `"left"` /
 *  `"right"` are explicit pins that outrank the language forever.
 *
 *  Two-state was the bug: the side followed the language only while NOTHING
 *  was stored, so the first use of the palette command pinned it for good and
 *  a later switch to Arabic no longer moved it — with no way back other than
 *  clearing localStorage. */
export type SidebarSidePref = "auto" | "left" | "right";

/** Every built-in theme, and its identity, live in `client/themes.ts` — the
 *  list outgrew the store when it reached fifteen, and three surfaces outside
 *  the store read it (the theme picker, the palette's per-theme commands, the
 *  settings panel). Re-exported here so the store's published surface is
 *  unchanged for everything that already imports THEMES/Theme from state. */
export { THEMES, isTheme, counterpartTheme } from "./themes.ts";
export type { Theme } from "./themes.ts";
/** The store's theme is a CHOICE, not a built-in: one of the fifteen ids, or
 *  a `custom:<slug>` naming an override layer in the design store
 *  (shared/customTheme.ts). Everything that only ever handled the fifteen
 *  keeps working — `Theme` is unchanged and still re-exported above — and the
 *  surfaces that must cope with both ask client/themes.ts's choiceGroup /
 *  counterpartChoice / choiceBase instead of the built-in-only functions. */
export type { ThemeChoice } from "./themes.ts";
export type View = "editor" | "graph";

export interface State {
  tree: TreeNode | null;
  openPath: string | null;
  openTabs: string[];
  dirty: Record<string, boolean>;
  view: View;
  theme: ThemeChoice;
  vimMode: boolean;
  /** Which vim sub-mode the live editor is in, or null when vim is off /
   *  no editor is mounted. NOT persisted and never written by the shell —
   *  client/editor/vimStatus.ts is the only writer, forwarding vim's own
   *  `vim-mode-change`. The VIM pill needs it because "the extension is
   *  loaded" and "the keys under your fingers are commands right now" are
   *  different facts, and only the second one traps a reader. */
  vimSubMode: "normal" | "insert" | "visual" | "replace" | null;
  setVimSubMode(m: State["vimSubMode"]): void;
  /** Ctrl/Cmd+E: render the open note read-only instead of editing. */
  readingMode: boolean;
  paletteOpen: boolean;
  /** Mobile drawer: the sidebar overlays the content below the narrow
   *  breakpoint; opening a note closes it. Inert on wide viewports. */
  sidebarOpen: boolean;
  setSidebarOpen(b: boolean): void;

  // ------------------------------------------------------------- shell layout
  /** The reader's stored choice: "auto" (the default — follow the language),
   *  or an explicit "left"/"right" pin. Persisted as "vellum.sidebarSide". */
  sidebarSidePref: SidebarSidePref;
  /** The edge the sidebar is on RIGHT NOW: the pref with "auto" resolved
   *  against the active language. Derived — never persisted, never set
   *  directly; `setSidebarSidePref` and `loadMe` are its only writers. */
  sidebarSide: SidebarSide;
  /** Set the three-state preference. This is the action a Settings →
   *  Appearance segmented control (auto / left / right) calls; the palette's
   *  three commands call it too. */
  setSidebarSidePref(pref: SidebarSidePref): void;
  /** Sidebar collapsed to its slim reopen handle (Ctrl/Cmd+Alt+B; persisted). */
  sidebarCollapsed: boolean;
  setSidebarCollapsed(b: boolean): void;
  /** Show/hide the notes sidebar, whichever shell is on screen (pane above the
   *  drawer breakpoint, overlay drawer below it). Every door — Ctrl/Cmd+Alt+B, the
   *  palette command, the status-bar switch — goes through this. */
  toggleSidebar(): void;
  /** Backlinks/outline panel collapsed (Ctrl/Cmd+Alt+Shift+B; persisted). Also
   *  set by the panel's own responsive auto-collapse on narrow viewports. */
  panelCollapsed: boolean;
  setPanelCollapsed(b: boolean, persist?: boolean): void;
  /** Zen mode: every piece of chrome steps aside and the prose column centers
   *  (Ctrl/Cmd+Shift+Z; persisted, so a reload stays zen). */
  zen: boolean;
  setZen(b: boolean): void;
  backlinks: Backlink[];
  /** Bumped when the open note changed externally; App keys the Editor on it. */
  reloadTick: number;
  /** Heading to scroll to once the next opened note finishes loading
   *  ([[Note#Heading]] navigation); consumed by Editor / ReadingView. */
  pendingHeading: string | null;

  // ------------------------------------------------------------------ auth
  /** This session may mutate the vault (server said so via /api/me). */
  admin: boolean;
  /** /api/me answered — App renders nothing until then to avoid mode flashes. */
  authReady: boolean;
  /** An admin password hash is configured server-side (sign in/out matters). */
  authProtected: boolean;
  /** Reads are open without a session (PUBLIC != false). */
  publicReads: boolean;
  /** Note path/name opened for fresh visitors (HOME_NOTE). */
  homeNote: string | null;
  /** Instance branding from SITE_NAME (wordmark, titles, login modal). */
  siteName: string;
  /** Site chrome language (settings.language / SITE_LANG). "ar" mirrors the
   *  whole chrome RTL; every component rendering t() strings subscribes to
   *  this so a live settings change re-renders the chrome in place. */
  language: Lang;
  /** settings.languageToggle — the instance offers visitors an EN/ع switch.
   *  Off (the default) means no public language chrome exists at all. */
  languageToggle: boolean;
  /** settings.languageFilter — how the site curates by NOTE language.
   *  "follow" is the one that changes the client's behaviour rather than just
   *  its copy: under it, flipping the EN/ع switch changes which notes exist
   *  for this reader, so the switch must refetch the vault instead of only
   *  re-skinning the chrome. */
  languageFilter: LanguageFilterMode;
  /** The server served the FULL collection because the language in force
   *  matched no published note (that language). The public shell prints a
   *  quiet line saying so — the alternative was a site that looked empty. */
  languageFallback: Lang | null;
  /** ADMIN ONLY: what the visitor-facing settings are costing in reach right
   *  now, or null when nothing material is being withheld. The status bar's
   *  standing indicator reads this — the ongoing half of "never silently hide
   *  a site". */
  visibility: VisibilityImpact | null;
  /** COMMENTS=on / settings.commentsEnabled. Off means Marginalia never even
   *  asks /api/comments — the answer is instance-wide and already in /api/me,
   *  so asking per note only bought one console 404 per note open. */
  commentsEnabled: boolean;
  /** Store the visitor's own chrome language and apply it live (strings +
   *  direction only). Ignored unless `languageToggle` is on. */
  setVisitorLang(lang: Lang): void;
  loginOpen: boolean;
  /** Admin moderation panel (palette: "Moderate comments"). */
  moderationOpen: boolean;
  setModerationOpen(b: boolean): void;
  /** Admin trash browser (palette: "Open trash"). The bin every delete dialog
   *  promises; nothing in the product could see it until this landed. */
  trashOpen: boolean;
  setTrashOpen(b: boolean): void;
  /** Admin previewing the public site: every API call carries the preview
   *  flag and the server answers along its real visitor code path, so what
   *  renders IS the visitor experience (blog shell / visitor app view). */
  previewVisitor: boolean;
  /** Enter/exit visitor preview (admin only; never persisted — a reload
   *  always returns the admin to the app). */
  setPreviewVisitor(on: boolean): Promise<void>;

  // ------------------------------------------------- blog mode (PUBLIC_LAYOUT)
  /** Visitor-facing layout: "blog" wraps visitors in the classic blog shell
   *  (client/blog/), "designed" in the composed one (client/design/); admins
   *  always get the full app. The server only ever SENDS "designed" when a
   *  design is actually renderable, so this field never has to be second-
   *  guessed here. */
  publicLayout: "app" | "blog" | "designed";
  /** Why the DESIGNED site is not being served, for a real admin session only
   *  (/api/me withholds it from visitors and from an admin previewing as one).
   *  Null on every healthy instance and on every instance that is not in
   *  "designed" mode; `client/design/DesignStatus.tsx` is its only reader. */
  designNotice: { reason: string; design?: string; detail?: string } | null;
  /** SITE_TAGLINE — masthead subtitle (blog mode). */
  tagline: string | null;
  shareButtons: boolean;
  /** SITE_FOOTER resolved server-side (blog mode; always set when blog). */
  footerLine: string | null;
  /** BCP47 locale for post dates (BLOG_LOCALE, default "en"). */
  blogLocale: string;
  /** BANNER_FALLBACK — what banner-less blog posts show as hero/thumb. */
  bannerFallback: "generated" | "none";
  /** settings.home — "/" mode + dashboard hero banner (blog mode; null = note). */
  home: HomeSettings | null;
  /** settings.logo — site logo image (banner-style value), blog mode. */
  logo: string | null;
  /** settings.dateCalendar — which calendar every human-facing date on this
   *  instance prints in. The formatting itself lives in client/dates.ts (a
   *  plain module, like i18n); this copy is here so React chrome that must
   *  re-render on a live settings change has something to subscribe to. */
  dateCalendar: DateCalendar;
  /** settings.textDirection / settings.textAlign — the SITE default for note
   *  prose. Same arrangement: client/textLayout.ts does the work, the store
   *  carries the value so the status bar's "this note differs" segment and
   *  the settings panel re-render when it moves. */
  textDirection: TextDirection;
  textAlign: TextAlign;
  /** Merge a fresh home config into the store (the dashboard's banner save). */
  setHome(home: HomeSettings | null): void;

  // --------------------------------------------------------------- publish
  /** Published note paths (admin marks/filter); null = unknown/unavailable. */
  publishedPaths: Set<string> | null;
  /** Publish stats from /api/me ("18 published" in the status bar). */
  publishedCounts: PublishedCounts | null;
  /** Status-bar toggle: sidebar shows only published notes (admin). */
  publishedFilter: boolean;
  /** Publish state of the OPEN note, read from its frontmatter by the
   *  status bar's content fetch; null while unknown (note switching). */
  openPublished: boolean | null;

  /** Refresh publishedPaths + counts (admin; no-ops gracefully otherwise). */
  loadPublished(): Promise<void>;
  /** Flip (or set) a note's publish flag via POST /api/publish. */
  togglePublish(path: string, publish?: boolean): Promise<void>;
  setPublishedFilter(b: boolean): void;
  setOpenPublished(b: boolean | null): void;

  // ---------------------------------------------------------------- banners
  /** "Set banner…" modal (admin; acts on the open note). */
  bannerModalOpen: boolean;
  setBannerModalOpen(b: boolean): void;
  /** Write (value) or clear (null) a note's frontmatter banner. */
  setBanner(path: string, value: string | null): Promise<void>;

  // --------------------------------------------------------------- settings
  /** Site settings panel (admin; status-bar gear / palette "Site settings"). */
  settingsOpen: boolean;
  setSettingsOpen(b: boolean): void;

  /** Keyboard-shortcuts overlay (Ctrl/Cmd+/, the status-bar ? button, the
   *  palette). Visitors get it too — the panes, themes and search are theirs. */
  shortcutsOpen: boolean;
  setShortcutsOpen(b: boolean): void;

  /** Boot: fetch /api/me, then load the vault + restore session/home note. */
  bootstrap(): Promise<void>;
  loadMe(): Promise<void>;
  /** Verify the password; throws (with the server message) on failure. */
  login(password: string): Promise<void>;
  logout(): Promise<void>;
  setLoginOpen(b: boolean): void;

  loadTree(): Promise<void>;
  openNote(path: string): void;
  closeTab(path: string): void;
  setView(v: View): void;
  setTheme(t: ThemeChoice): void;
  toggleVim(): void;
  toggleReading(): void;
  setReadingMode(b: boolean): void;
  setPaletteOpen(b: boolean): void;
  refreshBacklinks(): Promise<void>;
  createNote(path: string): Promise<void>;
  renameNote(path: string, toPath: string): Promise<void>;
  /** Default is the recoverable move to the vault's `.trash/`; `permanent`
   *  erases the file. Same two speeds as deleteFolder. */
  deleteNote(path: string, opts?: { permanent?: boolean }): Promise<void>;
  /** Move a folder (and everything under it) to the vault's .trash — or erase
   *  it outright. Closes every open tab inside it, then refreshes the tree. */
  deleteFolder(path: string, opts?: { permanent?: boolean }): Promise<void>;
  /** Delete ONE attachment (image, PDF, recording) at the same two speeds.
   *  A published note may embed it, so the publish state is refreshed with
   *  the tree — this is the one delete whose damage a stranger can see. */
  deleteAttachment(path: string, opts?: { permanent?: boolean }): Promise<void>;
  /** Restore an entry out of `.trash/`. Answers where it actually landed,
   *  which is not always where it came from — the caller says so. */
  restoreTrash(name: string): Promise<{ path: string; renamed: boolean }>;

  /** Editor reports unsaved-changes state here. */
  setDirty(path: string, dirty: boolean): void;
  /** Rewrite a path (or folder prefix) across tabs/openPath/dirty after a rename. */
  remapPath(path: string, toPath: string): void;
  /** Signal that the open note's on-disk content changed externally. */
  bumpReload(): void;
  /** Queue (or clear) a heading for the next opened note to scroll to. */
  setPendingHeading(h: string | null): void;
}

/** The stored theme, at BOOT — before the custom-theme registry has been
 *  fetched, so a `custom:` id cannot be checked for existence yet. It is
 *  accepted on SHAPE here and re-checked in loadMe() once the registry lands:
 *  refusing it now would mean every custom-theme user opens on iron-gall for a
 *  beat and then jumps, which is the flash this function exists to avoid. */
function readTheme(): ThemeChoice {
  const stored = localStorage.getItem(THEME_KEY);
  if (isTheme(stored)) return stored;
  return stored !== null && isCustomThemeId(stored) ? stored : THEMES[0];
}

/** Add (or drop) the instance stylesheet link for VELLUM_DATA/custom.css.
 *  Appended to <head> so it lands after every built-in stylesheet and its
 *  rules win ties — that is the whole point of a custom.css. */
function ensureCustomCss(enabled: boolean): void {
  const existing = document.head.querySelector("link[data-vellum-custom]");
  if (enabled && !existing) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/api/custom.css";
    link.setAttribute("data-vellum-custom", "");
    document.head.appendChild(link);
  } else if (!enabled && existing) {
    existing.remove();
  }
}

/** Add (or drop) the generated typography stylesheet, /api/site-fonts.css.
 *  `sig` is the four-slot signature from /api/me: present = the instance
 *  chose catalog faces, and its value rides along as ?v= so a changed pick
 *  gives the browser a new URL to fetch rather than a cached stylesheet
 *  naming the old families. Inserted BEFORE any custom.css link so a
 *  hand-written --font-serif override still wins — the escape hatch outranks
 *  the catalog, never the other way round. */
function ensureSiteFonts(sig: string | null): void {
  const existing = document.head.querySelector<HTMLLinkElement>("link[data-vellum-fonts]");
  if (sig === null) {
    existing?.remove();
    return;
  }
  const href = `/api/site-fonts.css?v=${encodeURIComponent(sig)}`;
  if (existing) {
    if (existing.getAttribute("href") !== href) existing.setAttribute("href", href);
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute("data-vellum-fonts", "");
  const custom = document.head.querySelector("link[data-vellum-custom]");
  if (custom) document.head.insertBefore(link, custom);
  else document.head.appendChild(link);
}

/** Point the shell's icon link at /favicon.ico when the instance configured a
 *  favicon (settings.json), restoring the built-in inline glyph otherwise.
 *  The ?v= buster makes a just-saved favicon show up in the tab immediately —
 *  browsers cache favicons aggressively. */
let defaultFaviconHref: string | null = null;
function ensureFavicon(enabled: boolean): void {
  const link = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  if (defaultFaviconHref === null) {
    // First sight: remember the shell's own icon (the inline glyph — or
    // /favicon.ico already, when the server injected it before first paint).
    defaultFaviconHref = link.getAttribute("href") ?? "";
  }
  if (enabled) {
    link.href = `/favicon.ico?v=${Date.now()}`;
  } else if (link.getAttribute("href")?.startsWith("/favicon.ico") && !defaultFaviconHref.startsWith("/favicon.ico")) {
    link.href = defaultFaviconHref;
  }
}

function readVim(): boolean {
  return localStorage.getItem(VIM_KEY) === "true";
}

/** A persisted boolean flag, or `null` when the user never chose. The null is
 *  load-bearing for the panel: no stored choice means the responsive
 *  auto-collapse still owns the panel (see BacklinksPanel). */
function readFlag(key: string): boolean | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : raw === "true";
  } catch {
    return null;
  }
}

function persistFlag(key: string, value: boolean): void {
  persistFlagValue(key, String(value));
}

function persistFlagValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage full/unavailable — the preference still works for this session
  }
}

/** True once the reader has explicitly collapsed/expanded the right panel;
 *  until then the viewport width decides (BacklinksPanel reads this). */
export function hasPanelPreference(): boolean {
  return readFlag(PANEL_COLLAPSED_KEY) !== null;
}

/** The stored preference. A value written by an OLDER build is a bare
 *  "left"/"right" with no "auto" in the vocabulary — it was an explicit act
 *  then and it stays an explicit pin now, which is the migration: nothing is
 *  rewritten, the same two strings simply keep meaning what they meant.
 *  Anything else (absent, corrupt, a value from the future) is "auto". */
function readSidebarSidePref(): SidebarSidePref {
  try {
    const raw = localStorage.getItem(SIDE_KEY);
    return raw === "left" || raw === "right" || raw === "auto" ? raw : "auto";
  } catch {
    return "auto";
  }
}

/** The edge "auto" means in this language: the direction's leading one.
 *  Exported because the Settings → Appearance row has to name the edge *Auto*
 *  would land on, which is NOT the same as `sidebarSide`: with the pane pinned
 *  left on an Arabic instance the resolved side is "left" while choosing Auto
 *  would move it right, so a note reading off the resolved value describes the
 *  pin rather than the option it sits on. */
export function defaultSide(lang: Lang): SidebarSide {
  return lang === "ar" ? "right" : "left";
}

/** Resolve the three-state preference against the language in force. */
function effectiveSide(pref: SidebarSidePref, lang: Lang): SidebarSide {
  return pref === "auto" ? defaultSide(lang) : pref;
}

function readReading(): boolean {
  return localStorage.getItem(READING_KEY) === "true";
}

/** One writer for both theme attributes — see client/design/customThemes.ts.
 *  A built-in sets `data-theme` alone; a custom theme sets `data-theme` to its
 *  BASE and `data-custom-theme` to itself, so the generated override sheet
 *  wins on specificity and every untouched token still comes from tokens.css. */
function applyTheme(theme: ThemeChoice): void {
  applyThemeChoice(theme);
}

/** Apply the chrome language to the document: <html dir/lang> drive the CSS
 *  logical properties (the whole chrome mirrors under dir="rtl") and the
 *  i18n module's active dictionary. Called from loadMe, so saving a new
 *  language in the settings panel re-skins the shell live — no reload. */
function applyLanguage(lang: Lang, locale: string): void {
  setLang(lang);
  // The date locale also decides the numerals every COUNT renders in — one
  // numbering system per instance (shared/numerals.ts).
  setNumeralLocale(locale);
  const root = document.documentElement;
  if (lang === "ar") {
    root.setAttribute("dir", "rtl");
    root.setAttribute("lang", "ar");
  } else {
    root.removeAttribute("dir");
    root.setAttribute("lang", "en");
  }
}

// Open tabs survive reloads; their absence marks a fresh visitor (→ home note).
interface StoredTabs {
  tabs: string[];
  open: string | null;
}

function readStoredTabs(): StoredTabs | null {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTabs>;
    if (!Array.isArray(parsed.tabs)) return null;
    return {
      tabs: parsed.tabs.filter((t): t is string => typeof t === "string"),
      open: typeof parsed.open === "string" ? parsed.open : null,
    };
  } catch {
    return null; // corrupted or unavailable storage
  }
}

function persistTabs(tabs: string[], open: string | null): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, open }));
  } catch {
    // storage full/unavailable — session restore just won't work
  }
}

function remap(current: string, from: string, to: string): string {
  if (current === from) return to;
  if (current.startsWith(`${from}/`)) return to + current.slice(from.length);
  return current;
}

// Visitor preview is deliberately NOT persisted: it is a mode that takes the
// editor away, and the reader who lands in it after a reload has no memory of
// asking for it — a reload always returns the admin to the app. (Older builds
// stored the flag; clear it once so an upgrade cannot strand anyone in a
// visitor shell they cannot reason about.)
function clearStoredPreview(): void {
  try {
    localStorage.removeItem(PREVIEW_KEY);
  } catch {
    // storage unavailable — nothing was stored either
  }
}

// The admin's tabs, parked while previewing; restored on exit (with the note
// the preview ended on kept open, per "exit returns to the same note").
let previewSnapshot: { tabs: string[]; open: string | null } | null = null;

// ── Our own writes ──────────────────────────────────────────────────────────
//
// Every write this client makes comes back to it as an SSE "changed" event,
// and App's handler has to tell that echo apart from somebody editing the file
// in Obsidian. It used to do that from ONE side — a publish toggle and a
// banner set stamped a timestamp here, and an ordinary autosave was recognised
// only AFTERWARDS, by watching `dirty` fall from true to false.
//
// THAT WAS TOO LATE, AND NOT BY A LITTLE. The server writes the file and
// notifies its subscribers before it answers the PUT, so the echo overtakes
// the response: measured on this vault, the SSE frame landed at t=4237ms and
// the PUT resolved at t=4239ms. In those two milliseconds `dirty` is still
// true and no save has yet "finished", which is exactly the state the handler
// reads as an external edit — so every autosave, on every note, raised
// "changed on disk — your unsaved edits were kept" about the reader's own
// typing. The alarm that exists to report a conflict was reporting the
// reader to themselves.
//
// So a write is claimed BEFORE it is sent, by the code that sends it, and it
// is claimed PER PATH: a save to one note must not swallow a genuine external
// change to another. The publish and banner paths already had the instinct
// (their comment says "SSE echo arrives before the response"); this is that
// instinct made general and moved to the one place every writer can reach.
const selfWrites = new Map<string, number>();

/** "This client is writing `path` right now." Call it immediately BEFORE the
 *  request, never after it resolves. */
export function markSelfWrite(path: string): void {
  const now = Date.now();
  selfWrites.set(path, now);
  // Bounded opportunistically: a session that edits hundreds of notes must not
  // grow this forever, and anything older than a minute can answer no.
  if (selfWrites.size > 64) {
    for (const [p, at] of selfWrites) if (now - at > 60_000) selfWrites.delete(p);
  }
}

/** True when this client wrote `path` within `windowMs` — the test App's SSE
 *  handler asks before calling a "changed" event somebody else's edit. */
export function recentSelfWrite(path: string, windowMs: number): boolean {
  const at = selfWrites.get(path);
  return at !== undefined && Date.now() - at < windowMs;
}

/** Resolve once `dirty[path]` clears (autosave landed), or after timeoutMs. */
function waitForClean(path: string, timeoutMs: number): Promise<void> {
  if (!useStore.getState().dirty[path]) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      unsubscribe();
      resolve();
    }, timeoutMs);
    const unsubscribe = useStore.subscribe((s) => {
      if (!s.dirty[path]) {
        window.clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

/** Run a store mutation, log any failure and tell the reader.
 *
 *  `failMessage` is a LOCALIZED line the caller supplies. Without it the toast
 *  falls back to `err.message`, which is the server's English log prose
 *  (CONTRACTS: "`error` is English prose written for a log and for curl. It is
 *  NOT a string any UI may print") — so an Arabic operator whose delete failed
 *  read "Note not found: x.md" inside a fully Arabic panel. The delete verbs
 *  pass their own line; the rest of the store still rides the old fallback,
 *  which is the pre-existing pattern and not this round's business. */
async function guarded(
  label: string,
  fn: () => Promise<void>,
  failMessage?: string,
): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`vellum: ${label} failed`, err);
    toast(failMessage ?? (err instanceof Error ? err.message : `${label} failed`));
  }
}

export const useStore = create<State>()((set, get) => {
  const initialTheme = readTheme();
  applyTheme(initialTheme);
  // Every boot starts OUT of preview (see clearStoredPreview).
  clearStoredPreview();
  api.setPreviewVisitor(false);

  /** Load the tree, then restore last session's tabs — or open the home note
   *  for fresh visitors (no tabs remembered in localStorage). */
  const enterVault = async (): Promise<void> => {
    await get().loadTree();
    const tree = get().tree;
    const existing = new Set(collectNotes(tree).map((n) => n.path));
    const stored = readStoredTabs();
    const tabs = (stored?.tabs ?? []).filter((p) => existing.has(p));
    if (tabs.length > 0) {
      const remembered = stored?.open;
      const open =
        remembered && tabs.includes(remembered) ? remembered : tabs[tabs.length - 1];
      set({ openTabs: tabs, openPath: open });
      void get().refreshBacklinks();
      return;
    }
    const home = get().homeNote;
    // A deep link in the address bar outranks the home note — the router
    // applies it right after bootstrap (client/router.ts).
    const deepLinked = location.pathname !== "/" && location.pathname !== "/graph";
    if (home && !deepLinked) {
      const path = resolveLink(home, tree);
      if (path) get().openNote(path);
      else console.warn(`vellum: home note "${home}" not found in the vault`);
    }
  };

  return {
    tree: null,
    openPath: null,
    openTabs: [],
    dirty: {},
    view: "editor",
    theme: initialTheme,
    vimMode: readVim(),
    vimSubMode: null,
    readingMode: readReading(),
    paletteOpen: false,
    sidebarOpen: false,
    // Both are settled again in loadMe() once the instance language is known;
    // until then "auto" resolves against the boot default (en → left).
    sidebarSidePref: readSidebarSidePref(),
    sidebarSide: effectiveSide(readSidebarSidePref(), "en"),
    sidebarCollapsed: readFlag(SIDEBAR_COLLAPSED_KEY) ?? false,
    // No stored choice → the panel starts wherever the viewport wants it
    // (BacklinksPanel's media query), which is collapsed on narrow screens.
    panelCollapsed: readFlag(PANEL_COLLAPSED_KEY) ?? false,
    zen: readFlag(ZEN_KEY) ?? false,
    backlinks: [],
    reloadTick: 0,
    pendingHeading: null,

    admin: true,
    authReady: false,
    authProtected: false,
    publicReads: true,
    homeNote: null,
    siteName: "Vellum",
    language: "en",
    languageToggle: false,
    languageFilter: "off",
    languageFallback: null,
    visibility: null,
    commentsEnabled: false,
    setVisitorLang: (lang) => {
      if (!get().languageToggle || get().language === lang) return;
      writeVisitorLang(lang);
      // Tell the API layer BEFORE anything refetches: every subsequent call
      // (including the loadMe below) must declare the new language, or the
      // server would scope the reply to the language they just left.
      api.setReaderLang(lang);
      // Same order loadMe uses: dictionary + <html dir/lang> first, so the
      // components re-rendering off `language` already read the new strings.
      // The date locale is deliberately NOT touched — dates and numerals stay
      // on the instance's blogLocale (CONTRACTS: one numbering system per
      // instance, chosen by the date locale).
      applyLanguage(lang, get().blogLocale);
      // Same rule as loadMe: an "auto" side follows the direction LIVE, so a
      // visitor flipping the EN/ع switch moves the notes sidebar with it.
      set({ language: lang, sidebarSide: effectiveSide(get().sidebarSidePref, lang) });
      // Under `languageFilter: "follow"` the switch is not cosmetic: the
      // reader has just changed WHICH NOTES EXIST for them, so everything
      // derived from the published collection has to be refetched. Without
      // this the chrome flipped to Arabic and went on listing the English
      // posts — the exact chrome/content disagreement the mode exists to end.
      // /api/me comes first because it carries the fallback flag for the new
      // language; the SSE stream is torn down and resubscribed by the same
      // reloadTick the tree listens on.
      if (get().languageFilter === "follow") {
        void (async () => {
          await get().loadMe();
          await get().loadTree();
          get().bumpReload();
        })();
      }
    },
    loginOpen: false,
    moderationOpen: false,
    trashOpen: false,
    previewVisitor: false,

    publicLayout: "app",
    designNotice: null,
    tagline: null,
    shareButtons: false,
    footerLine: null,
    blogLocale: "en",
    bannerFallback: "generated",
    home: null,
    logo: null,
    dateCalendar: DEFAULT_DATE_CALENDAR,
    textDirection: DEFAULT_TEXT_DIRECTION,
    textAlign: DEFAULT_TEXT_ALIGN,
    setHome: (home) => set({ home }),
    bannerModalOpen: false,
    settingsOpen: false,
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    shortcutsOpen: false,
    setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),

    publishedPaths: null,
    publishedCounts: null,
    publishedFilter: false,
    openPublished: null,

    bootstrap: async () => {
      await get().loadMe();
      const { admin, publicReads } = get();
      if (!admin && !publicReads) {
        // Locked vault: nothing is readable until sign-in.
        set({ authReady: true, loginOpen: true });
        return;
      }
      await enterVault();
      set({ authReady: true });
      void get().loadPublished();
    },

    loadMe: async () => {
      try {
        const me = await api.getMe();
        // A preview flag the server did NOT honor (me.preview absent) means
        // the admin session is gone — we are a real visitor now, so drop the
        // flag rather than showing a lying "previewing" banner.
        if (get().previewVisitor && me.preview !== true) {
          api.setPreviewVisitor(false);
          set({ previewVisitor: false });
        }
        const siteLang: Lang = me.language === "ar" ? "ar" : "en";
        // A visitor's own choice (langPref.ts) wins over the site language —
        // but only while the instance actually offers the switch, so turning
        // settings.languageToggle back off restores the site language for
        // everyone, stored preference or not.
        const languageToggle = me.languageToggle === true;
        const language: Lang = (languageToggle ? readVisitorLang() : null) ?? siteLang;
        // Declare it on every call from here on. Set even when the filter is
        // off: the server ignores it then, and the alternative is a mode-
        // dependent branch on the client that would be wrong for exactly one
        // request each time the mode changed.
        api.setReaderLang(language);
        const locale = me.blogLocale?.trim() || "en";
        // The calendar and the note-layout pair are pushed into their plain
        // modules BEFORE the store commit, exactly as applyLanguage pushes the
        // dictionary: a component re-rendering off `dateCalendar` must already
        // see siteDate() answering in the new calendar, or the first paint
        // after a settings save shows the old one.
        const calendar: DateCalendar = isDateCalendar(me.dateCalendar) ? me.dateCalendar : DEFAULT_DATE_CALENDAR;
        const noteDir: TextDirection = isTextDirection(me.textDirection) ? me.textDirection : DEFAULT_TEXT_DIRECTION;
        const noteAlign: TextAlign = isTextAlign(me.textAlign) ? me.textAlign : DEFAULT_TEXT_ALIGN;
        setDateCalendar(calendar);
        setSiteTextLayout(noteDir, noteAlign);
        applyLanguage(language, locale); // before set(): re-renders already see t() in the new language
        // "auto" is re-evaluated on EVERY language change, not only on a
        // fresh install: switching the instance to Arabic moves the notes
        // sidebar to the right edge, switching back moves it home. An
        // explicit "left"/"right" pin outranks the language and never moves.
        set({ sidebarSide: effectiveSide(get().sidebarSidePref, language) });
        set({
          languageToggle,
          languageFilter: me.languageFilter ?? "off",
          languageFallback: me.languageFallback === "ar" || me.languageFallback === "en" ? me.languageFallback : null,
          visibility: me.visibility ?? null,
          commentsEnabled: me.comments === true,
          admin: me.admin,
          publicReads: me.public,
          authProtected: me.protected ?? false,
          homeNote: me.homeNote ?? null,
          publishedCounts: me.published ?? null,
          siteName: me.siteName?.trim() || "Vellum",
          language,
          publicLayout:
            me.publicLayout === "blog" || me.publicLayout === "designed" ? me.publicLayout : "app",
          designNotice: me.designNotice ?? null,
          tagline: me.tagline?.trim() || null,
          shareButtons: me.shareButtons === true,
          footerLine: me.footer?.trim() || null,
          blogLocale: locale,
          bannerFallback: me.bannerFallback === "none" ? "none" : "generated",
          home: me.home ?? null,
          logo: me.logo ?? null,
          dateCalendar: calendar,
          textDirection: noteDir,
          textAlign: noteAlign,
        });
        // The tag-label map is scoped by session (a visitor is told about
        // visible tags only), so it is refetched on every /api/me — which is
        // also every sign-in, sign-out and preview toggle. Failures are silent:
        // an unlabelled chip renders its canonical tag, which is correct.
        void loadTagLabels();
        // Custom themes: link (or drop) the generated override stylesheet and
        // refresh the registry when its signature moved. Awaited because
        // everything under it — the stored choice, DEFAULT_THEME — is only
        // answerable once the registry knows which custom themes exist.
        await syncCustomThemes(typeof me.customThemes === "string" ? me.customThemes : null);
        // A stored `custom:` choice whose theme is gone (deleted on another
        // device, or on an instance whose designs.json was replaced) falls
        // back to the site default rather than painting its base and claiming
        // to be something else. Boot accepted it on SHAPE; this is where it
        // meets the registry.
        const stored = localStorage.getItem(THEME_KEY);
        if (stored !== null && !isKnownThemeChoice(stored)) {
          localStorage.removeItem(THEME_KEY);
          const fallback = isKnownThemeChoice(me.defaultTheme) ? me.defaultTheme : THEMES[0];
          applyTheme(fallback);
          set({ theme: fallback });
        }
        // DEFAULT_THEME applies only while the user has made no explicit
        // choice (nothing in localStorage) — and is deliberately NOT
        // persisted, so a changed server default keeps reaching them. It may
        // now name a custom theme, which is the whole "selectable everywhere a
        // built-in is" promise reaching its last surface.
        if (
          !localStorage.getItem(THEME_KEY) &&
          isKnownThemeChoice(me.defaultTheme) &&
          me.defaultTheme !== get().theme
        ) {
          applyTheme(me.defaultTheme);
          set({ theme: me.defaultTheme });
        } else if (isKnownThemeChoice(get().theme)) {
          // The registry may have arrived AFTER boot painted the base alone —
          // re-apply so a custom theme's overrides land without a reload.
          applyTheme(get().theme);
        }
        // Fonts before custom.css: ensureSiteFonts inserts itself ahead of the
        // custom.css link, and on first load that link does not exist yet.
        ensureSiteFonts(typeof me.fonts === "string" && me.fonts !== "" ? me.fonts : null);
        ensureCustomCss(me.customCss === true);
        ensureFavicon(me.favicon === true);
      } catch (err) {
        // Server unreachable/old — behave like open local mode.
        console.error("vellum: fetching /api/me failed", err);
        set({ admin: true, publicReads: true, authProtected: false });
      }
    },

    login: async (password) => {
      await api.login(password); // throws with server message on 401/429
      await get().loadMe();
      set({ loginOpen: false });
      // The tree we hold is the visitor's flat published view (or nothing,
      // when the vault was locked) — refetch as admin either way.
      await get().loadTree();
      if (get().openTabs.length === 0) await enterVault();
      void get().loadPublished();
    },

    logout: () =>
      guarded("signing out", async () => {
        await api.logout();
        await get().loadMe();
        set({ publishedPaths: null, publishedFilter: false, openPublished: null, moderationOpen: false, trashOpen: false });
        const { admin, publicReads } = get();
        if (!admin && !publicReads) {
          // Vault is locked again for this session — drop everything readable.
          set({ tree: null, openTabs: [], openPath: null, backlinks: [], view: "editor" });
          return;
        }
        // Back to the visitor's curated view: refetch the (flat) tree and
        // drop tabs pointing at notes that are not published.
        await get().loadTree();
        const visible = new Set(collectNotes(get().tree).map((n) => n.path));
        set((s) => {
          const openTabs = s.openTabs.filter((p) => visible.has(p));
          const openPath =
            s.openPath && visible.has(s.openPath)
              ? s.openPath
              : openTabs[openTabs.length - 1] ?? null;
          return { openTabs, openPath };
        });
        void get().refreshBacklinks();
      }),

    setLoginOpen: (loginOpen) => set({ loginOpen }),

    setModerationOpen: (moderationOpen) => set({ moderationOpen }),

    setTrashOpen: (trashOpen) => set({ trashOpen }),

    setPreviewVisitor: (on) =>
      guarded("toggling visitor preview", async () => {
        if (on === get().previewVisitor) return;
        if (on && !get().admin) return; // admin-only affordance
        // Let a pending autosave land first — the Editor unmounts on entry.
        const before = get().openPath;
        if (before && get().dirty[before]) await waitForClean(before, 2000);
        api.setPreviewVisitor(on);
        // Attachment resolution is scope-dependent; never reuse across modes.
        clearBrokenEmbeds();
        if (on) {
          previewSnapshot = { tabs: [...get().openTabs], open: get().openPath };
          // openPath goes to null for the length of the transition. The
          // scoping below cannot run until loadTree() has answered, and in
          // the meantime the reading view would refetch the OPEN note with
          // the visitor header on — the server correctly 404s an unpublished
          // note, and the owner's very first use of preview announced
          // "Failed to open <path>" about a site that is fine. Drop the tab
          // before the view refetches, then put it back if it survives.
          set({
            previewVisitor: true,
            openPath: null,
            paletteOpen: false,
            moderationOpen: false,
            // The trash browser is an admin surface over deleted vault paths;
            // it must not survive into a visitor preview.
            trashOpen: false,
          });
          // Tree BEFORE me: the shell swap (admin flips false on loadMe) must
          // find the visitor tree already in place, or the blog router would
          // transiently resolve routes against the full admin tree.
          await get().loadTree(); // the flat published tree (header is on)
          await get().loadMe(); // now visitor-shaped (admin: false, preview)
          // Visitor scoping of the session: tabs pointing at unpublished
          // notes disappear, exactly as they do on logout.
          const visible = new Set(collectNotes(get().tree).map((n) => n.path));
          set((s) => {
            const openTabs = s.openTabs.filter((p) => visible.has(p));
            const openPath =
              before && visible.has(before) ? before : openTabs[openTabs.length - 1] ?? null;
            return { openTabs, openPath, view: "editor" as const };
          });
          // And SAY why the note went away. Silence here is the same bug in
          // the other direction: the tab vanishes, the pane reads "The vault
          // is open", and nothing connects either to the eye button.
          if (before && !visible.has(before)) {
            toast(tf("previewNotPublishedNamed", { path: noteTitle(before) }));
          }
          void get().refreshBacklinks();
        } else {
          const current = get().openPath; // exit lands on the same note
          set({ previewVisitor: false, paletteOpen: false });
          // Same ordering on the way out: full tree first, then the admin
          // shell mounts against it.
          await get().loadTree();
          await get().loadMe();
          const snap = previewSnapshot;
          previewSnapshot = null;
          set((s) => {
            let openTabs = snap ? [...snap.tabs] : s.openTabs;
            const openPath = current ?? snap?.open ?? s.openPath;
            if (openPath && !openTabs.includes(openPath)) openTabs = [...openTabs, openPath];
            return { openTabs, openPath, view: "editor" as const };
          });
          void get().refreshBacklinks();
          void get().loadPublished();
        }
      }),

    loadPublished: async () => {
      if (!get().admin) return;
      // Counts always refresh (cheap, drives the "N published" segment).
      try {
        const me = await api.getMe();
        set({ publishedCounts: me.published ?? null });
      } catch {
        // keep last known counts
      }
      // The path set comes from GET /api/published — an ADMIN route. It used
      // to ride on the VISITOR view of /api/tree, which made publish state
      // conditional on `authProtected && publicReads`: on an open local vault
      // and on every PUBLIC=false instance the stars and the published filter
      // silently did not exist, and where it did exist it arrived
      // language-filtered. Both are gone: publish is a fact about a note, and
      // the owner sees it wherever they are signed in.
      try {
        const publishedPaths = await api.getPublishedPaths();
        set({ publishedPaths });
      } catch (err) {
        console.error("vellum: loading published set failed", err);
      }
    },

    togglePublish: (path, publish) =>
      guarded("toggling publish", async () => {
        // If the note is open with unsaved edits, let the autosave land first
        // so the server-side frontmatter edit isn't clobbered by a stale
        // editor buffer (and vice versa).
        if (get().dirty[path]) await waitForClean(path, 2000);
        const current =
          get().openPath === path && get().openPublished !== null
            ? get().openPublished!
            : isPublishedContent((await api.getNote(path)).content);
        const next = publish ?? !current;
        markSelfWrite(path); // the SSE echo arrives before the response
        const result = await api.publishNote(path, next);
        set((s) => {
          const publishedPaths = s.publishedPaths ? new Set(s.publishedPaths) : null;
          if (publishedPaths) {
            if (result.published) publishedPaths.add(result.path);
            else publishedPaths.delete(result.path);
          }
          return {
            publishedPaths,
            openPublished: s.openPath === result.path ? result.published : s.openPublished,
          };
        });
        void get().loadPublished();
        // The note's bytes changed on disk: refresh the open editor/reading
        // pane so its buffer carries the new frontmatter.
        if (get().openPath === result.path) get().bumpReload();
        toast(result.published ? t("publishedToast") : t("unpublishedToast"));
      }),

    setPublishedFilter: (publishedFilter) => set({ publishedFilter }),

    setOpenPublished: (openPublished) => set({ openPublished }),

    setBannerModalOpen: (bannerModalOpen) => set({ bannerModalOpen }),

    setBanner: (path, value) =>
      guarded("setting banner", async () => {
        // Same choreography as togglePublish: let a pending autosave land so
        // the server-side line edit and the editor buffer don't clobber each
        // other, and claim the SSE echo as our own write.
        if (get().dirty[path]) await waitForClean(path, 2000);
        markSelfWrite(path);
        await api.setFrontmatter(path, "banner", value);
        // The note's bytes changed on disk: refresh the open editor/reading
        // pane so its buffer carries the new frontmatter.
        if (get().openPath === path) get().bumpReload();
        toast(value === null ? t("bannerRemovedToast") : t("bannerSetToast"));
      }),

    loadTree: () =>
      guarded("loading vault tree", async () => {
        const tree = await api.getTree();
        set({ tree });
      }),

    openNote: (path) => {
      set((s) => ({
        openTabs: s.openTabs.includes(path) ? s.openTabs : [...s.openTabs, path],
        openPath: path,
        view: "editor",
        // Unknown until the status bar reads the new note's frontmatter —
        // unless the published set already knows the answer.
        openPublished: s.openPath === path ? s.openPublished : s.publishedPaths?.has(path) ?? null,
        // Mobile drawer: picking a note dismisses the overlay sidebar.
        sidebarOpen: false,
      }));
      void get().refreshBacklinks();
    },

    closeTab: (path) => {
      set((s) => {
        const index = s.openTabs.indexOf(path);
        if (index === -1) return s;
        const openTabs = s.openTabs.filter((p) => p !== path);
        const dirty = { ...s.dirty };
        delete dirty[path];
        let openPath = s.openPath;
        if (openPath === path) {
          openPath = openTabs[Math.min(index, openTabs.length - 1)] ?? null;
        }
        return { ...s, openTabs, dirty, openPath };
      });
      void get().refreshBacklinks();
    },

    setView: (view) => set({ view }),

    setTheme: (theme) => {
      localStorage.setItem(THEME_KEY, theme);
      applyTheme(theme);
      set({ theme });
    },

    toggleVim: () => {
      const vimMode = !get().vimMode;
      localStorage.setItem(VIM_KEY, String(vimMode));
      // Leaving vim clears the sub-mode straight away rather than waiting for
      // the editor's effect: the pill must never read "VIM · INSERT" for a
      // mode that is already off.
      set({ vimMode, vimSubMode: vimMode ? get().vimSubMode : null });
    },

    setVimSubMode: (vimSubMode) => set({ vimSubMode }),

    toggleReading: () => get().setReadingMode(!get().readingMode),

    setReadingMode: (readingMode) => {
      localStorage.setItem(READING_KEY, String(readingMode));
      set({ readingMode });
    },

    setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

    setSidebarSidePref: (sidebarSidePref) => {
      persistFlagValue(SIDE_KEY, sidebarSidePref);
      // Resolve immediately against the language in force — "auto" has to
      // land the sidebar somewhere the moment it is chosen, not on the next
      // /api/me.
      set({ sidebarSidePref, sidebarSide: effectiveSide(sidebarSidePref, get().language) });
    },

    setSidebarCollapsed: (sidebarCollapsed) => {
      persistFlag(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed);
      set({ sidebarCollapsed });
    },

    // ONE gesture, whichever shell is on screen. Below the drawer breakpoint
    // the sidebar is an overlay driven by `sidebarOpen`, and `sidebarCollapsed`
    // has nothing on screen to act on — so Ctrl/Cmd+Alt+B, the palette row and the
    // status-bar switch all went dead at 900px, which is exactly the "a
    // control that does nothing" failure this product keeps hunting.
    toggleSidebar: () => {
      const s = get();
      if (sidebarIsDrawer()) s.setSidebarOpen(!s.sidebarOpen);
      else s.setSidebarCollapsed(!s.sidebarCollapsed);
    },

    // `persist` is false for the responsive auto-collapse: a narrow window
    // must not silently become the reader's remembered choice.
    setPanelCollapsed: (panelCollapsed, persist = true) => {
      if (persist) persistFlag(PANEL_COLLAPSED_KEY, panelCollapsed);
      set({ panelCollapsed });
    },

    setZen: (zen) => {
      persistFlag(ZEN_KEY, zen);
      set({ zen });
    },

    refreshBacklinks: async () => {
      const { openPath } = get();
      if (!openPath) {
        set({ backlinks: [] });
        return;
      }
      try {
        const backlinks = await api.getBacklinks(openPath);
        // Ignore stale responses if the open note changed mid-flight.
        if (get().openPath === openPath) set({ backlinks });
      } catch (err) {
        console.error("vellum: loading backlinks failed", err);
      }
    },

    createNote: (path) =>
      guarded(`creating ${path}`, async () => {
        await api.createNote(path);
        // The default template, when the instance has one configured (off by
        // default — a product that silently writes into every new note is a
        // product that has to be fought). It runs BEFORE the note opens, so
        // the editor loads the templated content rather than an empty buffer
        // it would then have to be told about. A failure here is logged and
        // the note stays empty: creation must not depend on it.
        await applyDefaultTemplate(path);
        await get().loadTree();
        get().openNote(path);
        // A just-created note is empty — reading view would be a blank pane.
        if (get().readingMode) get().setReadingMode(false);
      }),

    renameNote: (path, toPath) =>
      guarded(`renaming ${path}`, async () => {
        await api.renameNote(path, toPath);
        get().remapPath(path, toPath);
        await get().loadTree();
        void get().refreshBacklinks();
      }),

    deleteNote: (path, opts) =>
      guarded(`deleting ${path}`, async () => {
        const permanent = opts?.permanent === true;
        // The tree's own label, like the dialog that asked and the tab that
        // closed — a toast reading “Welcome.md” after a row reading "Welcome"
        // is the same file wearing two names in two seconds.
        const name = noteLabelOf(path);
        await api.deleteNote(path, permanent);
        get().closeTab(path);
        await get().loadTree();
        void get().refreshBacklinks();
        // A published note leaving the vault changes the public site — the
        // "N published" segment and the publish marks have to follow it.
        void get().loadPublished();
        toast(tf(permanent ? "noteDeletedToast" : "noteTrashedToast", { name }));
      }, t("couldNotDeleteNote")),

    deleteFolder: (path, opts) =>
      guarded(`deleting folder ${path}`, async () => {
        const permanent = opts?.permanent === true;
        const name = path.split("/").pop() ?? path;
        await api.deleteFolder(path, permanent);
        // Tabs pointing INTO the folder now name files that no longer exist —
        // close them before the tree reload so no stale editor tries to save
        // into the hole. (The folder itself is never a tab.)
        for (const open of [...get().openTabs]) {
          if (open.startsWith(`${path}/`)) get().closeTab(open);
        }
        // The server indexes before it answers, so this refetch is already
        // correct — no wait on the SSE echo (which arrives too, harmlessly).
        await get().loadTree();
        void get().refreshBacklinks();
        void get().loadPublished();
        toast(tf(permanent ? "folderDeletedToast" : "folderTrashedToast", { name }));
      }, t("couldNotDeleteFolder")),

    deleteAttachment: (path, opts) =>
      guarded(`deleting ${path}`, async () => {
        const permanent = opts?.permanent === true;
        const name = path.split("/").pop() ?? path;
        await api.deleteAttachment(path, permanent);
        await get().loadTree();
        // An attachment is not a note, so no tab and no backlinks — but a
        // PUBLISHED note may embed it, and the file leaving the vault leaves
        // that note's <img> pointing at a 404 on the public site. Refresh the
        // publish surfaces for the same reason a note delete does.
        void get().loadPublished();
        // Embed widgets cache what resolved and what did not; a deleted file
        // must not keep rendering from that cache.
        clearBrokenEmbeds();
        get().bumpReload();
        toast(tf(permanent ? "fileDeletedToast" : "fileTrashedToast", { name }));
      }, t("couldNotDeleteFile")),

    restoreTrash: async (name) => {
      const result = await api.restoreTrash(name);
      // A restored folder brings notes, attachments and possibly publish marks
      // back at once; the server has already reindexed, so one refetch is
      // enough and it is already correct.
      await get().loadTree();
      void get().refreshBacklinks();
      void get().loadPublished();
      clearBrokenEmbeds();
      get().bumpReload();
      return { path: result.path, renamed: result.renamed };
    },

    setDirty: (path, isDirty) =>
      set((s) =>
        s.dirty[path] === isDirty ? s : { dirty: { ...s.dirty, [path]: isDirty } },
      ),

    remapPath: (path, toPath) =>
      set((s) => {
        const openTabs = s.openTabs.map((p) => remap(p, path, toPath));
        const dirty: Record<string, boolean> = {};
        for (const [p, d] of Object.entries(s.dirty)) dirty[remap(p, path, toPath)] = d;
        const openPath = s.openPath === null ? null : remap(s.openPath, path, toPath);
        return { openTabs, dirty, openPath };
      }),

    bumpReload: () => set((s) => ({ reloadTick: s.reloadTick + 1 })),

    setPendingHeading: (pendingHeading) => set({ pendingHeading }),
  };
});

// Remember open tabs across reloads (their absence marks a fresh visitor,
// who gets the home note instead). Persist only after the session restored,
// so a slow boot never clobbers the stored tabs with the empty initial state.
useStore.subscribe((s, prev) => {
  if (!s.authReady) return;
  if (s.openTabs !== prev.openTabs || s.openPath !== prev.openPath) {
    persistTabs(s.openTabs, s.openPath);
  }
});
