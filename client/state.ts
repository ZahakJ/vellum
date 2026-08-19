// Global zustand store — the single source of truth for the shell.
// Shape follows the State interface pinned in CONTRACTS.md, plus three small
// shell-internal extensions: setDirty (the channel the Editor uses to report
// dirty state), remapPath (tab bookkeeping on renames), and reloadTick
// (bumped when the open note changed on disk, so the Editor remounts).

import { create } from "zustand";
import type { Backlink, HomeSettings, PublicThemeInfo, PublishedCounts, TreeNode } from "../shared/types.ts";
import * as api from "./api.ts";
import { clearBrokenEmbeds } from "./editor/embeds.ts";
import { collectNotes, resolveLink, setAliasTable } from "./editor/links.ts";
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
import {
  chromeLang,
  readEditorLang,
  readVisitorLang,
  writeEditorLang,
  writeVisitorLang,
} from "./langPref.ts";
import { choiceLabel, isTheme, THEMES } from "./themes.ts";
import type { ThemeChoice } from "./themes.ts";
import { isCustomThemeId } from "../shared/customTheme.ts";
import {
  applyThemeChoice,
  isKnownThemeChoice,
  syncCustomThemes,
} from "./design/customThemes.ts";
import { remapBufferPath } from "./editor/bufferBridge.ts";
import { isPublishedContent } from "./publish.ts";
import {
  activeTabOf,
  allPaths,
  closeAfterIn,
  closeAllPanes,
  closeOthersIn,
  closeTabIn,
  emptyWorkspace,
  closePane as closePaneIn,
  setPaneMode as setPaneModeIn,
  focusPane as focusPaneIn,
  fromStoredTabs,
  isBookPath,
  openInPane,
  paneAt,
  parseWorkspace,
  pruneWorkspace,
  remapWorkspace,
  dropTabSplit as dropTabSplitIn,
  moveTab as moveTabIn,
  reorderTab as reorderTabIn,
  splitPane as splitPaneIn,
  serializeWorkspace,
  setBookTarget as setBookTargetIn,
  setPinned as setPinnedIn,
  type BookTarget,
  type DropEdge,
  type PaneMode,
  type Workspace,
} from "./workspace.ts";
import { applyDefaultTemplate } from "./templateActions.ts";
import { toast } from "./toast.ts";
import { actionToast } from "./undoToast.ts";
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
/** The workspace supersedes `vellum.tabs`, and BOTH are written. The old key
 *  costs a few bytes and buys a downgrade that does not lose anyone's session:
 *  an instance rolled back to a build without panes still finds the tabs it
 *  understands. It is read only when the new key is absent or unreadable. */
const WORKSPACE_KEY = "vellum.workspace";
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

/** Where a dropped tab lands on its target pane. */
export type TabDropDest = { kind: "tabs"; index: number } | { kind: "edge"; edge: DropEdge };

export interface State {
  tree: TreeNode | null;
  /** THE WORKSPACE IS THE TRUTH; `openPath` and `openTabs` below are a derived
   *  mirror of it, written by `commitWorkspace()` and by nothing else.
   *
   *  Doing it that way round is what makes panes affordable. Roughly forty
   *  places in the client read `openPath` or `openTabs` — the status bar, the
   *  router, the palette, the outline, the backlinks panel, every publish and
   *  banner action — and none of them has to learn what a pane is. They keep
   *  reading a path and a list of paths, and go on being right, because the
   *  mirror answers for the FOCUSED pane. Only the dozen or so places that
   *  WRITE the open set had to change, and they now say what they mean:
   *  `closeOthersIn`, `pruneWorkspace`, `remapWorkspace`.
   *
   *  The model itself is pure and lives in `client/workspace.ts`, where it is
   *  fuzzed over tens of thousands of random edit sequences. Nothing in this
   *  file re-implements a rule it already states. */
  workspace: Workspace;
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
  /** THIS SESSION'S chrome language — not necessarily the site's. "ar"
   *  mirrors the whole chrome RTL; every component rendering t() strings
   *  subscribes to this so a live settings change re-renders the chrome in
   *  place. An admin reads their own `vellum.editorLang` (Settings →
   *  Appearance & language → Editor language), a visitor their own
   *  `vellum.lang` when the instance offers the switch, and everyone else
   *  settings.language / SITE_LANG; `langPref.ts::chromeLang` is the one
   *  place that rule lives. What the SITE publishes in is a settings value
   *  (`/api/settings` → `effective.language`), never this field — reading
   *  this one to answer "what language is the site?" is how the editor and
   *  the public site got welded together in the first place. */
  language: Lang;
  /** What the SITE publishes in (settings.language / SITE_LANG), untouched by
   *  anyone's per-browser preference. It is what `language` falls back to,
   *  what "Follow site" resolves to, and what a visitor with no stored choice
   *  reads — so the two values agree for every session except an admin who
   *  has pinned their editor to the other one. */
  siteLanguage: Lang;
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
  /** The admin's stored editor-language PREFERENCE: null (the default —
   *  follow the site) or an explicit pin. Persisted as "vellum.editorLang".
   *  Held here as well as in localStorage for the same reason
   *  `sidebarSidePref` is: the segmented control has to show which of the
   *  three states is in force, and "which one did I pick?" is not answerable
   *  from `language` alone — a pin to English and a follow of an English site
   *  render identically. */
  editorLangPref: Lang | null;
  /** Store the ADMIN's own editor chrome language and apply it live (strings
   *  + direction only), or follow the site language again with null. A device
   *  preference — it commits on click, never reaches the server, and changes
   *  nothing about what visitors are served. */
  setEditorLang(lang: Lang | null): void;
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
  /** Replace the workspace and re-derive the mirror. The ONE writer of
   *  `openPath`/`openTabs`. */
  commitWorkspace(ws: Workspace): void;
  /** Move the keyboard to a pane. Every tab action below acts on the FOCUSED
   *  pane, so a surface that acts on a particular one focuses it first — which
   *  is what a click on it means anyway. */
  focusPane(id: string): void;
  /** Split the focused pane, carrying its active tab into the new one.
   *  Returns false when the layout is at its cap, so the caller can say so by
   *  name instead of the keystroke appearing to do nothing. */
  splitFocusedPane(axis: "inline" | "block"): boolean;
  closeFocusedPane(): void;
  /** Open a book as an ordinary WORKSPACE TAB — beside notes, in a pane — with
   *  an optional landing target (a citation's page/rect). The full-screen
   *  overlay was Stage 9's stopgap; a book you cannot read beside the note you
   *  are taking is the wrong product, and the model carried `.pdf` tabs and
   *  `bookTarget` from day one waiting for this wire. */
  openBook(path: string, target?: BookTarget | null): void;
  /** The reader landed on its citation — the one-shot target is spent. */
  clearBookTarget(paneId: string): void;
  /** The shelf, as the focused pane's surface. Tabs stay; the mode flips. */
  openLibrary(): void;
  closeLibrary(): void;
  /** One pane's mode, set directly — what a pane's own chrome (its book
   *  surface routing to the shelf) asks for. */
  setPaneMode(paneId: string, mode: PaneMode): void;
  // The tab context menu's rows. Each names what it takes — and none of them
  // takes a PINNED tab, which is the same promise in every row, so a reader
  // never has to remember which of them respects a pin.
  closeOtherTabs(path: string): void;
  closeTabsAfter(path: string): void;
  /** Every note in this window — the row the owner asked for by name. */
  closeAllTabs(): void;
  setTabPinned(path: string, pinned: boolean): void;
  moveTabTo(path: string, index: number): void;
  /** A finished tab drag: `path` leaves `from` and lands on `to` — in its tab
   *  strip at an index, or on an edge, which splits `to` and puts the tab in
   *  the new pane. The gesture reducers refuse whole at the caps. */
  dropTab(from: string, path: string, to: string, dest: TabDropDest): void;
  setView(v: View): void;
  setTheme(t: ThemeChoice): void;
  /** What a cookieless VISITOR lands on, and why — admin sessions only (null
   *  for everyone else, which is also how the chrome knows not to draw the
   *  "Visitors see …" line). Refreshed by loadMe, by the debounced mirror of
   *  the admin's own pick, and by setPublicTheme below. */
  publicTheme: PublicThemeInfo | null;
  /** Pin the public default to a theme, or pass null to go back to following
   *  the admin's editor theme. One click from the theme picker and from the
   *  Appearance row — the whole point is that an owner can see the rule and
   *  change it in the same breath. Writes settings.defaultTheme. */
  setPublicTheme(theme: ThemeChoice | null): Promise<void>;
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

// ── Mirroring the admin's theme to the server ──────────────────────────────
// The public site's default follows the admin's editor theme, and that theme
// lives in this browser's localStorage — nowhere the server can read. So the
// browser posts it. DEBOUNCED, because the theme picker applies every
// highlighted row live and a decisive owner can commit three or four of them
// in a couple of seconds: only a SETTLED choice is worth a file write.
//
// The timer is deliberately generous (one second is longer than a keyboard
// walk through the picker and shorter than any pause a reader would call a
// decision) and it always sends the CURRENT theme, not the one that armed it —
// so a burst of picks costs exactly one request, naming the last room.
const MIRROR_DELAY = 1000;
let mirrorTimer: ReturnType<typeof setTimeout> | null = null;
let mirrorPending: ThemeChoice | null = null;
/** The value the server already has, so an unchanged pick sends nothing. */
let mirrorSent: string | null = null;

function flushMirror(): void {
  if (mirrorTimer !== null) {
    clearTimeout(mirrorTimer);
    mirrorTimer = null;
  }
  const theme = mirrorPending;
  mirrorPending = null;
  if (theme === null) return;
  // A page being unloaded gets a beacon; anything else gets the normal call,
  // whose answer refreshes the "Visitors see …" line the owner is looking at.
  if (document.visibilityState === "hidden") {
    if (api.beaconEditorTheme(theme)) mirrorSent = theme;
    return;
  }
  void api
    .putEditorTheme(theme)
    .then((info) => {
      mirrorSent = theme;
      useStore.setState({ publicTheme: info });
    })
    .catch((err) => {
      // Never a toast: the owner did not ask for this write, they asked for a
      // theme — and they got it. A failed mirror only means visitors keep the
      // previous default until the next pick.
      console.warn("vellum: mirroring the editor theme failed", err);
    });
}

/** Queue the admin's committed theme for the server (no-op for visitors). */
function mirrorTheme(theme: ThemeChoice): void {
  const state = useStore.getState();
  // Only a real admin session mirrors: `admin` is false while previewing as a
  // visitor, and publicTheme is null for anyone the server did not tell.
  if (!state.admin || state.publicTheme === null) return;
  if (theme === mirrorSent) {
    mirrorPending = null;
    if (mirrorTimer !== null) {
      clearTimeout(mirrorTimer);
      mirrorTimer = null;
    }
    return;
  }
  mirrorPending = theme;
  if (mirrorTimer !== null) clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(flushMirror, MIRROR_DELAY);
  // A tab closed inside the debounce window must not swallow the pick.
  window.addEventListener("pagehide", flushMirror, { once: true });
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
  // THE CHROME'S NUMERALS FOLLOW THE CHROME'S LANGUAGE, not the site locale.
  // They used to follow `locale` (the blog's), and on an instance whose site
  // is Arabic that put Eastern Arabic digits inside an ENGLISH interface — the
  // owner met it as "the zoom shows ١٤٠٪ and my editor is in English", which
  // is mixed-script chrome, the exact thing tf()'s isolates exist to prevent
  // one level down. The visitor's cards are untouched: their dates go through
  // siteDate(date, blogLocale), which carries the site locale explicitly, and
  // a visitor page's chrome language IS the language whose digits it gets.
  setNumeralLocale(lang === "ar" ? locale || "ar" : "en");
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

function persistWorkspace(ws: Workspace): void {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify(serializeWorkspace(ws)));
  } catch {
    // storage full/unavailable — session restore just won't work
  }
}

/** The stored workspace, or null. `parseWorkspace` is TOTAL — it never throws
 *  and recovers the reader's open notes out of a layout it cannot otherwise
 *  understand — so the only null here means "nothing stored", and the caller
 *  falls back to `vellum.tabs`. */
function readStoredWorkspace(): Workspace | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return null;
    return parseWorkspace(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The derived mirror: what `openTabs` and `openPath` mean once there is more
 *  than one pane.
 *
 *  `openTabs` is the FOCUSED pane's list, because the tab bar draws that pane.
 *  `openPath` is its active tab — unless that tab is a BOOK, in which case it
 *  falls back to `noteFocus`. That fallback is the whole reason `noteFocus`
 *  exists: `StatusBar` fires `getNote(openPath)` on every change and would 400
 *  on every `.pdf`, and `router.ts` would push a PDF into the address bar as if
 *  it were a permalink. A book pane can hold the keyboard; it cannot be "the
 *  open note". */
function mirrorOf(
  ws: Workspace,
): Pick<State, "workspace" | "openTabs" | "openPath" | "readingMode"> {
  const pane = paneAt(ws, ws.focus);
  const openTabs = pane === null ? [] : pane.tabs.map((t) => t.path);
  // The focused pane's mode, mirrored for the ~dozen readers that ask "is the
  // note being read or written" and have no business knowing about panes.
  const readingMode = pane !== null && pane.mode === "reading";
  const here = pane === null ? null : activeTabOf(pane);
  if (here !== null && !isBookPath(here.path)) {
    return { workspace: ws, openTabs, openPath: here.path, readingMode };
  }
  const noteHome = paneAt(ws, ws.noteFocus);
  const note = noteHome === null ? null : activeTabOf(noteHome);
  return { workspace: ws, openTabs, openPath: note === null ? null : note.path, readingMode };
}

/** The dirty map names OPEN notes and nothing else. A bulk close that left
 *  entries behind would keep the unsaved count in "Close others (2 unsaved)"
 *  counting notes that are no longer anywhere — and that count is the whole
 *  reason those rows are trustworthy. */
function dropDirty(dirty: Record<string, boolean>, ws: Workspace): Record<string, boolean> {
  const open = new Set(allPaths(ws));
  const out: Record<string, boolean> = {};
  for (const [path, flag] of Object.entries(dirty)) if (open.has(path)) out[path] = flag;
  return out;
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
/** The whole WORKSPACE the admin was in when preview started, not a tab list.
 *  Preview is a round trip through a smaller vault, and what has to come back
 *  afterwards is the layout as well as the notes — a reader who split a pane
 *  and then looked at their site as a visitor should not find the split gone. */
let previewSnapshot: Workspace | null = null;

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
    // The workspace first, `vellum.tabs` as the fallback — which is what makes
    // the upgrade invisible: an instance that has never seen this build has no
    // workspace key, and its tab list becomes a one-pane workspace holding
    // exactly the notes it had open. Nobody's session is spent on the upgrade.
    const restored = readStoredWorkspace();
    const stored = readStoredTabs();
    const ws = restored ?? (stored === null ? null : fromStoredTabs(stored));
    if (ws !== null) {
      // A note in the stored workspace may have been deleted, renamed or hidden
      // while this browser was closed. Pruning here rather than at parse time
      // keeps the model pure and total: `client/workspace.ts` knows about tabs,
      // not about which of them still exist.
      const pruned = pruneWorkspace(ws, existing);
      if (allPaths(pruned).length > 0) {
        // The stored reading preference is a DEVICE preference and the pane is
        // where it now lives, so boot carries it across — otherwise a reader who
        // left in reading view comes back to the editor.
        get().commitWorkspace(
          readReading() ? setPaneModeIn(pruned, pruned.focus, "reading") : pruned,
        );
        void get().refreshBacklinks();
        return;
      }
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
    workspace: emptyWorkspace(),
    openPath: null,
    openTabs: [],
    dirty: {},
    view: "editor",
    theme: initialTheme,
    // Admin-only, and only once /api/me has answered.
    publicTheme: null,
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
    siteLanguage: "en",
    editorLangPref: readEditorLang(),
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
    // The editor's own language, and deliberately the SHORTER of the two
    // routines beside it. Nothing about the vault changes: not the API
    // scope (an admin session is never language-limited — server/language.ts
    // hands it ADMIN_SCOPE without reading the header), not the published
    // set, not one byte of what a visitor is served. The chrome re-reads
    // itself and the sidebar picks its edge again; that is the whole blast
    // radius, which is the point of the setting.
    setEditorLang: (lang) => {
      if (!get().admin) return; // admin-only affordance, like previewVisitor
      // The guard is on the PREFERENCE, not on the language it resolves to:
      // picking "English" while following an English site is a real change
      // (it pins), and only re-picking what is already stored is the no-op.
      if (lang === readEditorLang()) return;
      writeEditorLang(lang);
      const next = lang ?? get().siteLanguage;
      // Same order loadMe and setVisitorLang use: dictionary + <html dir/lang>
      // first, so components re-rendering off `language` already read the new
      // strings. blogLocale is untouched for the same reason it is there —
      // dates and numerals are one system per INSTANCE.
      applyLanguage(next, get().blogLocale);
      // An "auto" sidebar side follows the direction LIVE, exactly as it does
      // for the visitor switch and for a settings-side language change.
      set({
        language: next,
        editorLangPref: lang,
        sidebarSide: effectiveSide(get().sidebarSidePref, next),
      });
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
        // Whose preference this session reads, resolved in ONE place
        // (langPref.ts::chromeLang) because the two of them are easy to get
        // wrong in each other's favour: an admin reads their own editor
        // language, a visitor their own — and only while the instance offers
        // the switch, so turning settings.languageToggle back off restores
        // the site language for everyone, stored preference or not. `me.admin`
        // is false while previewing as a visitor, which is exactly what makes
        // the preview honest.
        const languageToggle = me.languageToggle === true;
        const language: Lang = chromeLang({
          admin: me.admin,
          languageToggle,
          siteLang,
          editor: readEditorLang(),
          visitor: readVisitorLang(),
        });
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
          siteLanguage: siteLang,
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
        // The site's default theme applies only while this reader has made no
        // explicit choice (nothing in localStorage) — and is deliberately NOT
        // persisted, so a changed server default keeps reaching them. The
        // server has already resolved WHICH theme that is (a pinned
        // defaultTheme, or the admin's own editor theme when the instance is
        // following it); the client only obeys the precedence: a stored
        // visitor choice always wins. It may name a custom theme, which is the
        // whole "selectable everywhere a built-in is" promise reaching its
        // last surface.
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
        // Admin sessions also learn WHY, so the chrome can say it out loud.
        // (Visitors — and an admin previewing as one — get null: there is
        // nothing to explain to a reader about the owner's own theme.)
        set({ publicTheme: me.publicTheme ?? null });
        // The server's copy of this browser's theme, as of this load: it is
        // what a follow-mode instance is serving, so an unchanged pick later
        // costs no request at all.
        mirrorSent = me.publicTheme?.mode === "follow" ? me.defaultTheme ?? null : null;
        // First run: the instance is following a theme nobody has ever told
        // it. If this admin has actually PICKED one (it is in their
        // localStorage, not merely the built-in default), tell it now instead
        // of leaving the public site on iron-gall until their next pick.
        // Deliberately narrow — an instance that already has a mirrored value
        // is not overwritten just because a second browser opened the app.
        if (me.publicTheme?.mode === "follow" && !me.defaultTheme && localStorage.getItem(THEME_KEY)) {
          mirrorTheme(get().theme);
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
          set({ tree: null, ...mirrorOf(emptyWorkspace()), backlinks: [], view: "editor" });
          return;
        }
        // Back to the visitor's curated view: refetch the (flat) tree and
        // drop tabs pointing at notes that are not published.
        await get().loadTree();
        const visible = new Set(collectNotes(get().tree).map((n) => n.path));
        set((s) => mirrorOf(pruneWorkspace(s.workspace, visible)));
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
          previewSnapshot = get().workspace;
          // THE TABS LEAVE BEFORE THE HEADER GOES ON. The scoping below cannot
          // run until loadTree() answers, and in the meantime every pane
          // refetches ITS OWN note with the visitor header on — the server
          // correctly 404s an unpublished one, and preview opened by
          // announcing "cannot access <note>" about a site that is fine. The
          // pre-pane code nulled `openPath` here for exactly this reason, and
          // panes made that guard DEAD: a pane renders from the workspace, so
          // the write desynced the mirror and unmounted nothing (the owner
          // met this within a day). The pane-shaped guard prunes the
          // WORKSPACE, optimistically, against the published set the store
          // already holds — the authoritative prune against the visitor tree
          // still runs below, and the snapshot above restores everything on
          // the way out.
          set((s) => ({
            ...s,
            ...mirrorOf(pruneWorkspace(s.workspace, s.publishedPaths ?? new Set())),
            previewVisitor: true,
            paletteOpen: false,
            moderationOpen: false,
            // The trash browser is an admin surface over deleted vault paths;
            // it must not survive into a visitor preview.
            trashOpen: false,
          }));
          // Tree BEFORE me: the shell swap (admin flips false on loadMe) must
          // find the visitor tree already in place, or the blog router would
          // transiently resolve routes against the full admin tree.
          await get().loadTree(); // the flat published tree (header is on)
          await get().loadMe(); // now visitor-shaped (admin: false, preview)
          // Visitor scoping of the session: tabs pointing at unpublished
          // notes disappear, exactly as they do on logout.
          const visible = new Set(collectNotes(get().tree).map((n) => n.path));
          set((s) => ({
            ...mirrorOf(
              before !== null && visible.has(before)
                ? openInPane(pruneWorkspace(s.workspace, visible), s.workspace.focus, before)
                : pruneWorkspace(s.workspace, visible),
            ),
            view: "editor" as const,
          }));
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
            // The layout the admin left, plus wherever preview ended up: a
            // reader who followed a link while previewing means to keep it.
            const base = snap ?? s.workspace;
            return {
              ...mirrorOf(current === null ? base : openInPane(base, base.focus, current)),
              view: "editor" as const,
            };
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
        // The tree and the ALIAS table are one refresh. A tree carries
        // filenames; an alias lives in frontmatter, so the client cannot derive
        // it — and a resolver that knows one and not the other draws a dashed
        // "unresolved" link at a note that is sitting right there, then offers
        // to create a duplicate of it. Their staleness is now identical, which
        // is the only way the editor and the backlink panel can agree.
        //
        // The alias half fails SOFTLY: it is an enrichment of the tree, not a
        // condition of it, and the last good table is kept rather than cleared.
        const [tree, aliases] = await Promise.all([
          api.getTree(),
          api.getAliases().catch((err: unknown) => {
            console.error("vellum: loading the alias table failed", err);
            return null;
          }),
        ]);
        if (aliases !== null) setAliasTable(aliases);
        set({ tree });
      }),

    commitWorkspace: (ws) => set((s) => ({ ...s, ...mirrorOf(ws) })),

    focusPane: (id) => set((s) => ({ ...s, ...mirrorOf(focusPaneIn(s.workspace, id)) })),

    splitFocusedPane: (axis) => {
      const s = get();
      const pane = paneAt(s.workspace, s.workspace.focus);
      // The new pane opens on the SAME note, which is what a split is for:
      // the second view of the thing you are already reading. An empty pane
      // beside a note is a pane the reader then has to fill.
      const carry = pane === null ? null : activeTabOf(pane);
      const next = splitPaneIn(s.workspace, s.workspace.focus, axis, carry);
      if (next === null) return false;
      set({ ...s, ...mirrorOf(next) });
      return true;
    },

    closeFocusedPane: () =>
      set((s) => ({ ...s, ...mirrorOf(closePaneIn(s.workspace, s.workspace.focus)) })),

    openBook: (path, target = null) =>
      set((s) => {
        // The target rides the open itself (OpenHow.book): the pane's one-shot
        // `bookTarget` — "land on page 212, flash that rectangle" — consumed
        // by the reader and cleared; a tab that permanently remembered its
        // citation would reopen there forever. A pane still in "library" mode
        // is answering the shelf by opening a book, so the mode comes home to
        // the tabs.
        let ws = openInPane(s.workspace, s.workspace.focus, path, target === null ? {} : { book: target });
        if (paneAt(ws, ws.focus)?.mode === "library") ws = setPaneModeIn(ws, ws.focus, "edit");
        return { ...s, ...mirrorOf(ws), sidebarOpen: false };
      }),

    clearBookTarget: (paneId) =>
      set((s) => ({ ...s, ...mirrorOf(setBookTargetIn(s.workspace, paneId, null)) })),

    openLibrary: () =>
      set((s) => ({
        ...s,
        ...mirrorOf(setPaneModeIn(s.workspace, s.workspace.focus, "library")),
        view: "editor",
        sidebarOpen: false,
      })),

    closeLibrary: () =>
      set((s) => {
        const pane = paneAt(s.workspace, s.workspace.focus);
        if (pane === null || pane.mode !== "library") return s;
        return { ...s, ...mirrorOf(setPaneModeIn(s.workspace, s.workspace.focus, "edit")) };
      }),

    setPaneMode: (paneId, mode) =>
      set((s) => ({ ...s, ...mirrorOf(setPaneModeIn(s.workspace, paneId, mode)) })),

    openNote: (path) => {
      set((s) => ({
        ...mirrorOf(openInPane(s.workspace, s.workspace.focus, path)),
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
        const ws = closeTabIn(s.workspace, s.workspace.focus, path);
        if (ws === s.workspace) return s;
        return { ...s, ...mirrorOf(ws), dirty: dropDirty(s.dirty, ws) };
      });
      void get().refreshBacklinks();
    },

    // ── The tab context menu's rows ─────────────────────────────────────────
    // Every one of them goes through a reducer in client/workspace.ts rather
    // than filtering an array here, because "which tabs does this take" is a
    // question with one answer and it is written down there — pins survive,
    // the active tab lands on its neighbour, and the dirty map is trimmed to
    // what is still open. Four subtly different filters in this file is how
    // "close others" and "close to the right" end up disagreeing about a pin.

    closeOtherTabs: (path) => {
      set((s) => {
        const ws = closeOthersIn(s.workspace, s.workspace.focus, path);
        return { ...s, ...mirrorOf(ws), dirty: dropDirty(s.dirty, ws) };
      });
      void get().refreshBacklinks();
    },

    closeTabsAfter: (path) => {
      set((s) => {
        const ws = closeAfterIn(s.workspace, s.workspace.focus, path);
        return { ...s, ...mirrorOf(ws), dirty: dropDirty(s.dirty, ws) };
      });
    },

    closeAllTabs: () => {
      set((s) => {
        const ws = closeAllPanes(s.workspace);
        return { ...s, ...mirrorOf(ws), dirty: dropDirty(s.dirty, ws) };
      });
      void get().refreshBacklinks();
    },

    setTabPinned: (path, pinned) =>
      set((s) => ({ ...s, ...mirrorOf(setPinnedIn(s.workspace, s.workspace.focus, path, pinned)) })),

    moveTabTo: (path, index) =>
      set((s) => ({ ...s, ...mirrorOf(reorderTabIn(s.workspace, s.workspace.focus, path, index)) })),

    dropTab: (from, path, to, dest) =>
      set((s) => ({
        ...s,
        ...mirrorOf(
          dest.kind === "edge"
            ? dropTabSplitIn(s.workspace, from, path, to, dest.edge)
            : moveTabIn(s.workspace, from, path, to, dest.index),
        ),
      })),

    setView: (view) => set({ view }),

    setTheme: (theme) => {
      localStorage.setItem(THEME_KEY, theme);
      applyTheme(theme);
      set({ theme });
      // An ADMIN's pick is also the public site's default, unless a pin says
      // otherwise. Queued, not sent: see mirrorTheme's note.
      mirrorTheme(theme);
    },

    setPublicTheme: async (theme) => {
      const previous = get().publicTheme;
      // Optimistic, because this is a one-click affordance sitting next to the
      // sentence it changes — the line must not lag behind the button.
      set({
        publicTheme: {
          mode: theme === null ? "follow" : "pinned",
          theme: theme ?? get().theme,
        },
      });
      try {
        // "follow" is stored, not cleared: an instance whose .env pins
        // DEFAULT_THEME needs a value that OVERRIDES that pin, and clearing
        // the key would only fall back to it.
        const res = await api.patchSettings({ defaultTheme: theme ?? "follow" });
        const eff = res.effective;
        set({
          publicTheme: {
            mode: eff.defaultTheme === "follow" ? "follow" : "pinned",
            theme: eff.visitorTheme,
          },
        });
        // Following again means the server's mirror is now what visitors get;
        // make sure it holds this browser's actual theme.
        if (theme === null) mirrorTheme(get().theme);
        toast(theme === null ? t("themeFollowingNow") : tf("themePinnedNow", { theme: choiceLabel(theme) }));
      } catch (err) {
        set({ publicTheme: previous });
        toast(err instanceof Error ? err.message : t("themePinFailed"), "error");
      }
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
      // READING MODE IS PER-PANE, and this writes the PANE, not the flag.
      //
      // It used to set `readingMode` on the store and that was the whole
      // mechanism, because there was one editor and `App.tsx` chose between it
      // and the reading view. With panes, a pane picks its own surface from
      // `pane.mode` — so setting the flag alone left `Ctrl/Cmd+E` flipping a
      // value nothing rendered from. `check-layouts` caught it on all seven
      // keyboard layouts at once, which is what a browser gate is for: nothing
      // in the type system or the unit tests can see a store field that no
      // longer reaches a component.
      //
      // The flag survives as the DERIVED mirror (`mirrorOf`), for the same
      // reason `openPath` does: the status bar, the palette and the mode pill
      // all read it and none of them needs to learn what a pane is.
      localStorage.setItem(READING_KEY, String(readingMode));
      const s = get();
      s.commitWorkspace(
        setPaneModeIn(s.workspace, s.workspace.focus, readingMode ? "reading" : "edit"),
      );
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
        const oldTitle = noteTitleOf(path);
        await api.renameNote(path, toPath);
        get().remapPath(path, toPath);
        await get().loadTree();
        void get().refreshBacklinks();
        // The rewrite fixed every [[wikilink]] INSIDE this vault. It could not
        // fix what is outside it: a published permalink, a link in someone
        // else's notes, a bookmark — and it never sees the reader's own memory
        // of what the note was called. One button keeps the old title working
        // as a name (frontmatter `aliases:`), which is the half of a rename
        // Obsidian leaves to the author. Offered only when the NAME changed —
        // a move keeps it, and an alias for a name nothing lost is clutter.
        const newTitle = noteTitleOf(toPath);
        if (oldTitle.toLowerCase() !== newTitle.toLowerCase()) {
          actionToast(tf("renameKeepAliasToast", { title: oldTitle }), t("renameKeepAliasAction"), () => {
            api
              .addAlias(toPath, oldTitle)
              .then(() => toast(tf("renameAliasKeptToast", { title: oldTitle })))
              .catch((err: unknown) => {
                console.error("vellum: keeping the old title as an alias failed", err);
                toast(tf("renameAliasFailed", { title: oldTitle }), "error");
              });
          });
        }
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
        // The open DOCUMENT follows its file too, not just the tab. A rename
        // that dropped the undo history of the note being renamed would do it
        // at the one moment a reader most wants it back.
        remapBufferPath(path, toPath);
        const dirty: Record<string, boolean> = {};
        for (const [p, d] of Object.entries(s.dirty)) dirty[remap(p, path, toPath)] = d;
        return { ...mirrorOf(remapWorkspace(s.workspace, path, toPath)), dirty };
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
  if (s.workspace !== prev.workspace) persistWorkspace(s.workspace);
  if (s.openTabs !== prev.openTabs || s.openPath !== prev.openPath) {
    // `vellum.tabs` is still written, and deliberately: it costs a few bytes
    // and buys a downgrade that does not strand anyone. A build without panes
    // still finds a session it understands.
    persistTabs(s.openTabs, s.openPath);
  }
});
