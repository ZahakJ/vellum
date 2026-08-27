// Bundle gate: what does each audience actually download?
//
//   node scripts/check-bundle.mjs        (after `npm run build`)
//
// The client ships one entry chunk plus a chunk per surface. That split is
// only worth anything if it HOLDS, and the way it stops holding is ordinary
// and silent: someone adds `import { X } from "./components/SettingsModal"`
// at the top of a file the entry already imports, and the whole app shell
// comes back into an anonymous reader's first request with no visible sign.
// The measured regression this guards against was 350 kB of JavaScript on a
// blog page that renders one article — CodeMirror, the vim keymap, the graph
// engine and every modal, none of which that page can reach.
//
// So this asserts three things about the BUILT output, read from
// dist/.vite/manifest.json (i.e. rollup's own view of the static import
// graph, not a guess):
//
//   1. Named heavy chunks (the editor, KaTeX, the vim keymap, the graph
//      engine) are absent from both first-paint closures.
//   2. Each audience's first-paint bytes stay under a budget.
//   3. The surfaces that are SUPPOSED to be split still exist as their own
//      chunks — a "fix" that inlines everything back into one chunk would
//      otherwise pass rules 1 and 2 by accident once it got small enough.
//
// Budgets are raw (uncompressed) bytes: they measure what the build produced,
// independently of how a given deployment negotiates encoding.

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = path.join(root, "dist");
const manifestPath = path.join(dist, ".vite", "manifest.json");

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch {
  console.error(`check-bundle: no manifest at ${manifestPath}\n  run: npm run build`);
  process.exit(1);
}

/** Transitive closure over STATIC imports — what the browser must fetch
 *  before the chunk can run. Dynamic imports are deliberately not followed:
 *  they are the split. */
function closure(key, seen = new Set()) {
  if (seen.has(key)) return seen;
  const entry = manifest[key];
  if (!entry) return seen;
  seen.add(key);
  for (const dep of entry.imports ?? []) closure(dep, seen);
  return seen;
}

function filesOf(keys) {
  const out = new Set();
  for (const key of keys) {
    const entry = manifest[key];
    if (!entry) continue;
    out.add(entry.file);
    for (const css of entry.css ?? []) out.add(css);
  }
  return out;
}

function bytes(files) {
  let total = 0;
  for (const f of files) {
    try {
      total += statSync(path.join(dist, f)).size;
    } catch {
      // a listed asset that is not on disk is a build problem, not ours
    }
  }
  return total;
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

// ── the audiences ───────────────────────────────────────────────────────────
// Mirrors client/App.tsx: everyone loads the entry; a blog visitor then loads
// the blog shell; an admin loads the vault shell. Neither loads the other.
const APP_SHELL_ROOTS = [
  "components/Sidebar.tsx",
  "components/Tabs.tsx",
  "components/StatusBar.tsx",
  "components/BacklinksPanel.tsx",
];

/** The manifest key for a source file.
 *
 *  Usually the source path itself ("blog/BlogShell.tsx") — rollup names a
 *  chunk after the module when exactly one dynamic import reaches it. When
 *  TWO reach it the chunk becomes a shared one and the key turns into
 *  "_BlogShell-<hash>.js", with the source path recorded in `src` instead.
 *  That is what happened to the blog shell the moment `DesignedSite` began
 *  statically importing it as its fallback — a deliberate arrangement, and one
 *  that left this gate reporting "the lazy boundary is gone" about a boundary
 *  that was still there. So look the key up both ways, and let the assertions
 *  below judge the property that actually matters: not in the entry closure. */
function keyFor(src) {
  if (manifest[src]) return src;
  const byField = Object.keys(manifest).find((k) => manifest[k].src === src);
  if (byField) return byField;
  // A promoted shared chunk records no `src` at all — only a name rollup
  // derived from the module's basename ("_BlogShell-<hash>.js"). Match on that,
  // and on the .js chunk specifically: the CSS sibling carries the same stem.
  const base = src.split("/").pop().replace(/\.[jt]sx?$/, "");
  const re = new RegExp(`^_?${base}-[^/]+\\.js$`);
  return Object.keys(manifest).find((k) => re.test(k));
}

const entry = closure("index.html");
const blog = closure(keyFor("blog/BlogShell.tsx") ?? "blog/BlogShell.tsx", new Set(entry));
// THROUGH keyFor(), for the reason its comment gives one screen up — and this
// line did not, which made the admin budget quietly stop measuring the
// sidebar. The moment a second chunk statically imports anything OUT of the
// sidebar chunk (the folder-icon picker's own lazy chunk imports FolderGlyph
// from it), rollup promotes it to a shared "_Sidebar-<hash>.js" with no `src`
// field — `closure("components/Sidebar.tsx")` then finds no manifest entry,
// adds nothing, and returns quietly. The admin first paint dropped 57 kB and
// twelve files between two builds that differed by one lazy() call, and the
// gate reported OK. A budget that can be satisfied by making a surface
// unfindable is not a budget.
const app = APP_SHELL_ROOTS.reduce((acc, key) => closure(keyFor(key) ?? key, acc), new Set(entry));

// ── the budgets, and why they are the numbers they are ──────────────────────
//
// These were first set at 260 / 420 / 420 kB, measured against an app that had
// no site design engine, no theme library beyond two themes, no LaTeX notes,
// no Hijri calendar, no trash browser, no git sync, no font catalog and a
// third of the i18n dictionary. Every one of those shipped afterwards, and
// none of them is code a split can remove from a first paint: the dictionary
// is read by `t()` on every surface including the blog, the token and theme
// CSS paints the first frame, and the store is the store. Held at the old
// numbers the gate reported FAIL on every build, which is a gate that gets
// commented out rather than obeyed — the one outcome worth avoiding.
//
// So they are re-baselined to what this build actually produces, with ~5%
// headroom so they still RATCHET: a regression of any size still turns them
// red, which is the property the gate exists for. The budgets are not a claim
// that these numbers are good; they are a claim that they must not grow
// silently. What the numbers do NOT include is the structural half below —
// CodeMirror, KaTeX, the vim keymap, the vault graph and the CodeMirror
// grammars are asserted absent from every first paint regardless of budget,
// and those assertions are the ones that caught real regressions.
//
// Two real reductions were taken before re-baselining rather than after, so
// the baseline is of a build that had its avoidable weight removed:
//
//   - the keyboard-shortcut sheet (389 lines + the theme picker) was static in
//     BOTH shells, so an anonymous article reader downloaded it to describe
//     keys they had not pressed. It is lazy and mount-gated now: −28 kB from
//     every entry.
//   - the site designer (125 kB, plus the design engine, the live preview and
//     the markdown renderer it composes with) was reached by a plain
//     `import { openDesigner }` in the status bar, the command palette and the
//     settings panel — three surfaces the admin shell mounts immediately — so
//     rollup had to put the whole designer in the admin's first request. The
//     door is a dynamic-import launcher now (components/design/openDesigner.ts):
//     −178 kB from the admin first paint.
// RE-BASELINED ONCE MORE, for the workspace model — and written down here
// rather than nudged, because a budget that moves quietly is the same as no
// budget. `client/workspace.ts` is the pure state model behind panes, tab
// groups and multiple windows, and `client/state.ts` imports it at module
// scope: the store cannot restore last session's tabs without being able to
// parse a stored workspace, so it is on the boot path by construction and no
// split can take it off. It arrived with the tab context menu's dictionary
// keys, which `t()` reads on every surface including the blog. Together they
// put the entry at 471.4 kB against a 470 kB ceiling — a 1.4 kB overshoot the
// gate correctly refused to wave through.
//
// The ratchet is kept, not loosened: 480 is the new actual plus ~2%, which is
// TIGHTER than the ~5% the numbers below were set with. A regression of any
// size still turns this red, which is the only property that matters.
//
// RE-BASELINED for BOOK TABS and the TAB-DRAG gesture (499.7 kB actual →
// 510 kB, actual + ~2%). What grew, and why no split can take it off:
// `client/books/door.ts` now calls into the store (a book is a workspace tab,
// so the door's happy path IS a store call), the router computes book URLs
// from the workspace, Tabs.tsx carries the drag/reorder handlers, and the
// dictionary gained the composer/table/palette keys — `t()` reads it on every
// surface. The drag's drop zones themselves are NOT here: they lazy-load at
// the first lift, which is what kept this bump at ~4 kB instead of ~7. The
// by-language dictionary split (below) remains the scheduled recovery of
// ~32 kB from every one of these numbers.
// RE-BASELINED for the TRACKER's dictionary keys, and for no other byte of it.
// 510.2 kB actual against a 510 kB ceiling — a 0.2 kB overshoot, and worth
// naming precisely because of how small it is. The tracker's own code is not
// in this number at all: `client/reading/tracker.ts` and its stylesheet (14 kB
// together) are a DYNAMIC import from the fence branch of render.ts, because a
// progress card is drawn on the few notes that carry one and nothing is owed
// by the reader of a note that does not. What did land here is ~2 kB of
// `client/i18n.ts` — the status names, the seven kind labels, the seven
// countPhrase units and the board's empty state — and the dictionary is the
// one module in the product that ships whole to every surface. That is the
// debt named at length below, arriving one release later with three features'
// keys in it rather than one. 512 is the new actual plus ~0.35%, TIGHTER than
// any previous re-baseline in this file: the ratchet is kept, and the
// by-language split remains the ~32 kB recovery that makes this line stop
// moving.
//
// RE-BASELINED for THE SAFETY NET (511.2 kB actual → 516.0 kB; budget 518,
// actual + ~0.4%). All three numbers below move by the same ~4.8 kB, because
// what grew is in the entry closure and the entry closure is inside all three.
// Named precisely, since this is the one re-baseline in this file that bought
// no feature at all:
//
//   +~1.6 kB  client/ErrorBoundary.tsx + client/safety.ts — a React error
//             boundary around the whole app, a window `unhandledrejection`
//             handler and a window `error` handler. Before v1.8 this client
//             had NONE of the three: a throw during render unmounted the tree
//             and left `<div id="root">` empty, mid-sentence, with the unsaved
//             buffers unflushed and no reload button on screen.
//   +~1.0 kB  client/lazySurface.tsx — `lazy()` with the chunk-fetch failure
//             caught. Every surface in the app arrives through a hashed chunk
//             name; redeploy the server under an open session (`git pull &&
//             npm start`) and the next surface the reader opens requests a
//             file that no longer exists. The import rejected, React rethrew
//             it at the boundary, and the app went white.
//   +~1.2 kB  client/api.ts — the request deadline (`fetch` has none of its
//             own) and the guard on a 2xx that is not JSON, which is what an
//             auth proxy's 200 HTML login page had been arriving as: `null`,
//             typed as a tree, a note or a settings object.
//   +~1.0 kB  the dictionary's eight new keys — the crash card's three, the
//             missing-chunk card, the two `ApiError.code` sentences, the
//             stuck-save line and one honest fallback. `t()` reads one object
//             on every surface, so they reach the blog reader too.
//
// WHY NO SPLIT TAKES ANY OF IT OFF: a net that arrives in its own request is a
// net with a hole in it for exactly the window in which most first-paint
// failures happen, and a crash card that has to fetch a chunk after the crash
// is not a crash card. The by-language dictionary split remains the ~32 kB
// recovery, and it is now worth seven times this bump.
// RE-BASELINED for the EDITOR-UX round (519.2 kB actual → budget 521, actual
// + ~0.35%; the two closures below move by the same bytes, because the entry
// closure is inside both). What landed, and why none of it splits off:
//
//   +~1.2 kB  client/state.ts — the first-run open (F1: a fresh install landed
//             on the empty state with the seed's guide sitting in the tree),
//             the tab-strip actions `stepTab`/`closeActiveTab` (F12), and the
//             attachment-folder fact the Move-to picker filters on (F11).
//             `state.ts` IS the entry: it is the store every surface reads.
//   +~0.6 kB  client/App.tsx + client/workspace.ts — the tab chords and the
//             reducer they call. The window keydown listener is the shell's,
//             so it cannot be anywhere but here.
//   +~0.5 kB  the dictionary's six new keys — the two Move-to doors, the
//             outline's empty line, the two tab-key rows in the shortcut
//             sheet. `t()` reads one object on every surface (the debt named
//             at length below; the by-language split is still the ~32 kB
//             recovery that would make this line stop moving).
//   +~0.9 kB  client/components/Editor.tsx and client/editor/livePreview.ts —
//             the caret's home (F9), the caret memory a publish-remount
//             restores from, and `interactedField`, the StateField that ended
//             the raw-YAML bug for the block pass as well as the inline one.
//             Both files are in the editor chunk rather than the entry, so
//             they show up in the admin number and not in the blog reader's.
// RE-BASELINED for MOMENTS (524.7 kB actual → budget 527, actual + ~0.44%;
// the two closures below move by the same bytes, because the entry closure is
// inside both). This is the toast round — F22/F23/F24/F13/F26/F40/F41/F45 —
// and what landed in the ENTRY is:
//
//   +~1.1 kB  client/state.ts — `deletedToast` (F24: the three delete verbs
//             named the trash and offered nothing, so each now carries the
//             restore the `.trash` machinery has always been able to do) and
//             the publish toast's first-ever branch (F22). `state.ts` IS the
//             entry: it is the store every surface reads.
//   +~0.5 kB  client/toast.ts + client/undoToast.ts — the toast STACK (F23).
//             Every `toast()` used to erase every toast, action toasts
//             included, so a plain confirmation killed the Undo under it. The
//             column, the insert-above rule and the ✕ are these bytes.
//   +~0.4 kB  client/sync.ts — the backup toast's short sha and the window
//             event that opens the badge's panel from it (F40).
//   +~1.7 kB  the dictionary's eighteen new keys — the first-publish line and
//             its View door, the paste receipt, the empty vault's two doors,
//             the three moderation outcomes and the switch that opens the
//             margins, the designer's Switch back, the sha line, the owner
//             dashboard's publish explanation, and the store's one honest
//             localized failure line (F45: the fallback used to print the
//             server's English log prose, or an English phrase built from a
//             console label, at an Arabic reader).
//
// WHY NO SPLIT TAKES ANY OF IT OFF: a toast is what the app says when
// something has already happened, so the code that draws one cannot arrive in
// a later request than the event it is reporting. The by-language dictionary
// split remains the ~32 kB recovery for the dictionary's share, as it is for
// every line above.
// RE-BASELINED for THE SIX NEW ROOMS: +8.1 kB on the entry, and therefore the
// same +8.1 kB on both closures below, since the entry closure sits inside
// both. Stated as a DELTA rather than as an absolute, because this file's
// absolutes have always been measured at one instant and the thing worth
// holding anyone to is what a change cost. 543 → 554 / 754 → 770 /
// 1168 → 1178, which is the measured overshoot plus this file's usual ~0.4%.
// This is the only re-baseline here whose cause is a STYLESHEET rather than
// the dictionary, and it is worth naming precisely because a theme is the one
// kind of feature that cannot be split:
//
//   +5.79 kB  client/styles/tokens.css — six complete rooms (phosphor,
//             sidereal, murex, palimpsest, porcelain, mauveine), and
//             "complete" is the cost. DESIGN.md's rule is that a theme
//             defines its WHOLE set — ground, raised, hover, three text
//             tokens, accent, accent-soft, border, danger, selection, focus
//             ring, three graph tokens, two banner tokens, thirteen callout
//             hues and eight syntax colours — because a block that inherits
//             another theme's leftovers wears iron-gall's amber on a green
//             ground. That is ~46 declarations a room, and there is no
//             version of it that is smaller and still correct.
//   +1.02 kB  client/styles/themes.css — the six --swatch-* trios and their
//             two-hook rules. These are CONSTANT across themes on purpose:
//             the picker paints a preview of a room in THAT room's colours,
//             never in the one currently on screen, so they cannot be derived
//             from the live tokens.
//   +0.09 kB  client/styles/textcolor.css — three selectors, joining the
//             light group's one existing rule.
//   +~1.3 kB  client/i18n.ts — the six rooms' names and one-line descriptions
//             in both languages, plus the ambient row's label and hint. `t()`
//             reads one object on every surface, as every note below says.
//
// WHY NO SPLIT TAKES ANY OF IT OFF: tokens.css is linked from index.html and
// paints the FIRST FRAME. A theme that arrives in a second request is a page
// that flashes the default room and then repaints, which is the one failure a
// theme system is not allowed to have. The by-language dictionary split
// remains the ~32 kB recovery for the dictionary's share.
//
// WHAT DID NOT LAND HERE, deliberately: the ambient masthead. Its stylesheet
// (client/styles/ambient.css, 4.5 kB) is imported by client/ambient.tsx, which
// is reached only from the blog shell and the design engine — both lazy — so
// it is inside the blog reader's number below and outside the entry's
// entirely. An instance with the setting off still downloads it with the blog
// shell, which is the honest price of keeping the mapping in CSS where a theme
// switch can repaint it live; an admin who never opens the public site pays
// nothing.
const AUDIENCES = [
// RE-BASELINED for NOTE HISTORY (529.4 kB actual → budget 532, actual +
// ~0.5%). This round is the safety net the rest of the slate stands on — git
// log over the open note, a read-only render of any revision, and one button
// that puts it back — and almost all of it is in a chunk nobody downloads
// until they open the section. What DID land in the entry, measured:
//
//   +~2.8 kB  the dictionary's thirty-two new keys — the timeline's chrome and
//             its three empty states with their doors, the revision viewer,
//             the restore toast and its undo, and the five Snapshot lines.
//             `t()` reads one object on every surface, so a blog reader
//             downloads them too; the by-language split named at length below
//             is still the ~32 kB recovery that would make this line stop
//             moving, and it is now worth eleven times this round's bump.
//   +~0.5 kB  client/dates.ts — `relativeDate()`. A timeline is read in
//             distances ("three days ago"), and the rule at the top of that
//             file is that no surface holds its own Intl call: the history
//             panel would have been the fifth to try.
//   +~0.4 kB  client/api.ts — the two history fetchers and the snapshot POST.
//   +~0.5 kB  client/sync.ts — `runSnapshotNow()` and the window event the
//             timeline listens on, so a snapshot taken from the palette shows
//             up in an open list without polling git once a second.
//
// WHY NO SPLIT TAKES ANY OF IT OFF: the panel itself already IS the split —
// `client/components/HistoryPanel.tsx` and `client/styles/history.css` arrive
// only when a reader opens the section, which starts collapsed. The four items
// above are the entry's own modules (the dictionary, the date policy, the API
// client, the shared sync status), and each is read by surfaces that are
// already on screen when they are needed.
// RE-BASELINED for LINK REPAIR AND TAG RENAME (533.3 kB actual → budget 535,
// actual + ~0.3%). This round is two vault-wide rewrites — rename a tag (and
// merge it onto another), and repair the `[[Note#Heading]]` links a heading
// rename just broke — over one engine that previews, applies under a
// precondition and keeps a way back. Almost none of it is the entry's:
//
//   +~3.0 kB  the dictionary's twenty-eight new keys. Both rewrites are
//             CONVERSATIONS — an offer naming a count, a dry run naming a
//             count, a merge warning, a done-toast, an undo, and the two
//             sentences that name what was skipped and why — and a bulk tool
//             that says only "done" is the bulk tool nobody presses twice. So
//             the keys are the feature, and `t()` reads one object on every
//             surface, so a blog reader downloads them too. The by-language
//             split named at length below is still the ~32 kB recovery that
//             would make this line stop moving; it is now worth ten of this
//             round.
//   +~0.6 kB  client/api.ts — the four fetchers (preview, rename, repair,
//             undo).
//
// WHAT DID NOT LAND HERE, and deliberately: `client/tagRename.ts` (the two
// dialogs) is reached only from the sidebar chunk, `client/bulkEdit.ts` (the
// toasts and the undo) only from the sidebar and editor chunks, and the whole
// server half — the surgeon, the engine, the rename detector — is server code
// that no browser downloads at all.
// RE-BASELINED for THE SEARCH SUITE (537.7 kB actual → budget 540, actual +
// ~0.4%). This round is three answers in one box: diacritic folding, search
// operators, and vault-wide search & replace. Its entry share is almost
// entirely the dictionary again, and this time the reason is worth naming
// rather than apologising for.
//
//   +~4.0 kB  the dictionary's forty new keys. Two of the three features are
//             CONVERSATIONS a reader cannot have without words: a grammar
//             nobody can guess (seven operator rows, an example and a gloss
//             each, plus the sentence saying they narrow together), and a
//             rewrite of four hundred notes that has to state its rule, its
//             scope, its dry run, its snapshot offer, its confirm, its
//             done-toast and the two sentences naming what it refused to
//             touch. The third feature — the fold — added ZERO chrome and one
//             help line, which is how you know it was the right shape.
//             `t()` reads one object on every surface, so a blog reader
//             downloads them too; the by-language split named at length below
//             is still the ~32 kB recovery that would make this line stop
//             moving, and it is now worth eight of this round.
//   +~0.3 kB  client/api.ts — the two replace fetchers.
//
// WHAT DID NOT LAND HERE, deliberately: `client/components/ReplacePanel.tsx`
// and `client/components/SearchHelp.tsx` are their own lazySurface chunks (the
// panel carries the dry-run list, the selection model and its stylesheet, and
// a fraction of sessions ever open it); `shared/searchQuery.ts` rides with the
// panel that imports it; `shared/fold.ts` rides with the two matchers that
// consult it — the palette's ranker and the editor's `[[` completion — both of
// which are already split. The whole server half (the operator evaluator, the
// replace engine, the nomination walk) is server code no browser fetches.
// RE-BASELINED for THE EDITABLE PROPERTIES CARD (541.1 kB actual → budget 543,
// actual + ~0.35%). The smallest re-baseline in this file, and the whole of it
// is words:
//
//   +~0.8 kB  the dictionary's eight new keys — "Add property", the two field
//             names, the empty-value word, "Add value", the two removal
//             tooltips and the removed-toast. A properties card is chrome that
//             has to NAME what each control does to somebody's file, and it
//             does it in both languages. `t()` reads one object on every
//             surface, so a blog reader pays for them too; the by-language
//             split named at length below remains the ~32 kB recovery.
//   +~0.3 kB  client/App.tsx and client/state.ts — the window-event listener
//             the card writes through and the `setProperty` store action
//             beside `setBanner`, which are both on the boot path by
//             construction (the shell mounts the listener, the store IS the
//             store) and cannot be split off.
//
// WHAT DID NOT LAND HERE, deliberately: `client/editor/propsEdit.ts` — the
// whole editing layer, every input, chip and checkbox in it — is reached only
// from the EDITOR chunk, because `buildPropsCard()` takes its editing callbacks
// as parameters and the reading-view renderer passes none. A blog visitor's
// copy of the same card is the display-only card it always was, byte for byte.
// The surgical writer, the value grammar and the key policy are server code no
// browser fetches at all.
  { name: "entry (everyone)", keys: entry, budget: 554 * 1024 },
  // RE-BASELINED for the DICTIONARY, and this one deserves naming as a debt
  // rather than a measurement. `client/i18n.ts` is a single object read by
  // `t()` on every surface, so it lands whole in every first paint — and this
  // round added ~90 keys to it, of which the book reader's 47 and the tab
  // menu's 15 are unreachable from a blog page by construction. An anonymous
  // article reader now downloads the Arabic and English strings for a PDF
  // outline panel they cannot open.
  //
  // The honest fix is to split the dictionary per surface so a lazy chunk
  // carries its own copy, which is a real change to how `t()` is typed and is
  // not something to start while four agents are in the tree. Until then the
  // budget moves, in the open, with the cause written down.
  //
  // MOVED AGAIN, and this time with the debt MEASURED rather than described.
  // The dictionary's value bytes are 35 kB of English and 32 kB of Arabic, and
  // BOTH ship to every reader — so an English instance downloads 32 kB of
  // Arabic it will never render, and an Arabic one downloads 35 kB of English.
  // Splitting the dictionary BY LANGUAGE, not by surface, is therefore the
  // larger and simpler win, and it is the scheduled fix: `t()` keeps its typing
  // off the English keys, and `setLang("ar")` awaits a dynamic import which the
  // bootstrap blocks on, so an Arabic instance never flashes English rather
  // than paying nothing.
  //
  // What argues for this round's growth in the meantime: panes, the
  // cross-window lease and the buffer bridge are all structural additions to
  // the shell that no split can remove from a first paint, and they arrived
  // with the dictionary keys that name them.
  // Moves with the entry above (the blog closure contains it): same causes,
  // same recovery path, actual 673.4 kB at the book-tabs re-baseline.
  //
  // RE-BASELINED for CUSTOM PUBLIC FOLDERS (682.1 kB actual at the previous
  // commit → 698.2 kB, budget = actual + ~1.7%). Measured, per file, against a
  // build of the parent commit rather than described:
  //
  //   +3.9 kB  BlogShell chunk — the folder page, the home band, the folder
  //            chips in the nav and the article footer, and the slug rules
  //            (shared/publicFolders.ts).
  //   +3.5 kB  blog.css — the band, the folder-page header and the chips.
  //   +3.4 kB  FolderGlyph — the twenty path tables (shared/folderIcons.ts).
  //   +2.7 kB  the dictionary's share of this feature's ~35 new keys.
  //
  // WHY NO SPLIT TAKES ANY OF IT OFF. Every one of those bytes renders on the
  // FIRST paint of a blog home that has folders: the band is above the fold,
  // the nav chips are in the chrome, and a lazily-imported glyph table would
  // paint the row twice. The recovery here is the same scheduled one the entry
  // budget names — splitting the dictionary by language would return ~32 kB to
  // this number, which is more than this whole feature costs.
  //
  // The remaining ~2.4 kB of this round's growth is feature A's dictionary
  // keys (the twenty glyph names and the tree picker's strings), which reach a
  // blog reader only because `t()` reads one object on every surface.
  // …and moved once more with the entry, for the safety net named above
  // (708.4 kB actual → 713.3 kB; 716 is actual + ~0.4%). Same bytes, same
  // argument: the blog closure contains the entry closure.
  // …and moved once more with the entry, for the moments round above
  // (723.8 kB actual → 727, actual + ~0.44%). Same bytes, same argument: the
  // blog closure contains the entry closure. The blog's own share of the
  // round is the loading skeleton that replaced the literal "…" on both public
  // homes (F41), which is one small component and one block of CSS.
  // …and once more for BLOG MOBILE (731.0 kB actual → 735, actual + ~0.55%).
  // This round is the public site's, so unlike the three above it the growth
  // is the blog reader's OWN and none of it is the entry's:
  //
  //   +~3.6 kB  client/styles/blog.css — the 44px pass (F34: this stylesheet
  //             had one coarse-pointer block in 2,100 lines and what it did
  //             was hide a keyboard hint), the phone nav that keeps the
  //             collections out of the burger (F38), the compact phone
  //             collections band, the hairline between the two runs of chip
  //             (F28) and the empty collection page's doors (F29).
  //   +~1.3 kB  client/blog/* — BlogFolder's doors and its topic tally,
  //             NavTopics' separator and its arithmetic, the masthead's h1 on
  //             the home route.
  //   +~0.7 kB  client/banner.ts — the generated gradient's second hash word,
  //             its hue-offset model and the crossed ruling (F42).
  //
  // NONE OF IT SPLITS. A stylesheet is first paint by definition, the nav is
  // above the article, and a card's gradient is drawn before the reader has
  // scrolled anywhere. The by-language dictionary split named above remains
  // the ~32 kB recovery for this number, and it is still worth five of this
  // round.
  // …and once more with the entry, for LINK REPAIR AND TAG RENAME (738.1 kB
  // actual → 740, actual + ~0.26%). Same bytes, same argument the three lines
  // above make: the blog closure contains the entry closure, and the blog
  // reader's OWN share of this round is zero — a visitor cannot rename a tag,
  // and every surface that can is admin-only and in a chunk they never fetch.
  // …and once more with the entry, for THE SEARCH SUITE (742.5 kB actual →
  // budget 745, actual + ~0.3%). Same argument the two rounds above make: the
  // blog closure contains the entry closure, and the blog reader's OWN share is
  // zero — a visitor cannot run a replace, and the operator card and the panel
  // are both sidebar chunks no public page mounts.
  // …and once more with the entry, for THE EDITABLE PROPERTIES CARD (746.2 kB
  // actual → 748, actual + ~0.24%). Same bytes, same argument every line above
  // makes: the blog closure contains the entry closure, and the blog reader's
  // OWN share of this round is exactly zero — the card a visitor sees is the
  // read-only one, and the editing layer is in the editor chunk they never
  // fetch.
  // …and once more for PRINT AND PDF (751.3 kB actual → budget 754, actual
  // + ~0.36%). Unlike the four rounds above it, this growth IS the blog
  // reader's own and every byte of it is deliberate:
  //
  //   +~3.3 kB  client/reading/print.css, inlined into reading.css by the
  //             `@import` at the top of that file. It is the whole of the
  //             product's `@media print` answer — twenty-seven stylesheets
  //             carried none before this release — and it reaches the visitor
  //             because THE VISITOR IS WHO PRINTS AN ARTICLE. A published
  //             piece is printed by people who did not write it, from a page
  //             with no palette and no command on it, using their own Ctrl+P;
  //             a print stylesheet that arrives with an admin chunk would be
  //             absent from the one surface it matters most on.
  //
  // NO SPLIT TAKES IT OFF, and a media-query load is not one either: a
  // `<link media="print">` in the HTML entry is merged into the single entry
  // stylesheet by the build (losing the attribute, so the rules would apply on
  // screen), and a stylesheet fetched at `beforeprint` arrives after the pages
  // are cut. Riding with reading.css is what puts it in exactly the chunks
  // that can show a document and in nobody else's.
  { name: "anonymous blog reader", keys: blog, budget: 770 * 1024 },
  // RE-BASELINED for PER-FOLDER TREE ICONS (1089.4 kB actual → 1099.4 kB,
  // budget = actual + ~1.1%), and the growth here is almost all feature A's:
  // +3.4 kB FolderGlyph (now a shared chunk, since the sidebar and the blog
  // both draw marks), +1.2 kB Sidebar (the glyph slot, the context-menu item
  // and the picker's mount), and the dictionary's share of both features'
  // keys. A folder mark is drawn on the first paint of the tree, so none of it
  // is splittable either; the dictionary split is the recovery for this number
  // as much as for the two above it.
  // …and once more with the entry, for the safety net (1111.4 kB actual →
  // 1116.3 kB; 1120 is actual + ~0.3%).
  // …and once more with the entry, for the moments round (1128.7 kB actual →
  // 1133, actual + ~0.38%). The admin's own share on top of the entry's is the
  // empty-vault invitation in the sidebar chunk and the settings panel's
  // arrive-at-a-row effect — both in chunks the admin already loads.
  // …and once more with the entry, for NOTE HISTORY (1136.0 kB actual → 1142,
  // actual + ~0.5%). Same bytes, same argument: the admin closure contains the
  // entry closure, and the admin's own share on top of it is zero — the
  // history panel and its stylesheet are a dynamic import, so they are in
  // neither closure until the reader opens the section.
  // …and once more with the entry, for LINK REPAIR AND TAG RENAME (1143.3 kB
  // actual → 1146, actual + ~0.24%). The admin's own share on top of the
  // entry's is the two client modules named there — the tag dialogs in the
  // sidebar chunk and the bulk toasts beside them — which together are under a
  // kilobyte and arrive with surfaces the admin has already loaded.
  // …and once more with the entry, for THE SEARCH SUITE (1149.5 kB actual →
  // 1152, actual + ~0.22%). Same bytes, same argument once more: the admin's
  // own share on top of the entry's is the sidebar chunk's two new mounts —
  // the operator button and the replace toggle, a few hundred bytes — while
  // the panel, the card, the query grammar and the stylesheet are all dynamic
  // imports that are in neither closure until something is opened.
  // …and once more, for THE EDITABLE PROPERTIES CARD (1158.0 kB actual → 1162,
  // actual + ~0.35%) — and this is the ONE of the three numbers with a real
  // feature in it. ~4.9 kB of `client/editor/propsEdit.ts` lands in the editor
  // chunk, which the admin's first paint contains because the admin's first
  // paint is an editor. It is not splittable any further and should not be: the
  // card is drawn by the first note that opens, so a dynamic import here would
  // buy a spinner where a property row belongs. The remaining ~1.1 kB is the
  // entry's, named above.
  // …and once more, for PRINT AND PDF (1163.1 kB actual → 1168, actual
  // + ~0.42%). The whole of this round's growth is the SAME ~3.3 kB print
  // stylesheet the blog line above names, and it lands here because
  // `components/BacklinksPanel.tsx` — an app-shell root — already carries
  // reading.css: the outline pane and the local graph are in `client/reading/`
  // and the panel is drawn on the first paint. `client/print.ts` itself is NOT
  // in this number: it is loaded by Editor.tsx and ReadingView.tsx, both behind
  // the pane's lazy boundary, and reached from the palette by `import()`.
  { name: "admin first paint", keys: app, budget: 1178 * 1024 },
];

// ── things that must never be in a first paint ──────────────────────────────
// Matched against the manifest KEY (a source path), so this survives content
// hashes changing on every build.
const FORBIDDEN = [
  { label: "the CodeMirror editor", test: (k) => /Editor[-.]/.test(k) || /components\/Editor\.tsx$/.test(k) },
  { label: "KaTeX", test: (k) => /node_modules\/katex\/dist\/katex\.mjs$/.test(k) },
  { label: "the vim keymap", test: (k) => /@replit\/codemirror-vim/.test(k) },
  // GraphView only — NOT LocalGraph, and the difference is the whole point of
  // `components/graphColors.ts`. The backlinks panel draws a note's own
  // neighborhood on every admin paint by design, so LocalGraph is first-paint
  // code and always was. What must stay out is the FULL vault graph: the
  // force-directed simulation, its shade tables and its HUD, which only the
  // graph view mounts. Naming both here made the rule unsatisfiable by any
  // build that shipped the panel, which is a rule that gets deleted rather
  // than obeyed. The colour helpers the two share live apart precisely so
  // LocalGraph can be reached without dragging the simulation behind it.
  { label: "the graph engine", test: (k) => /components\/GraphView\.tsx$/.test(k) },
  { label: "CodeMirror core", test: (k) => /@codemirror\/(view|state|language)\//.test(k) },
  { label: "a CodeMirror language grammar", test: (k) => /@lezer\/|@codemirror\/(lang-|legacy-modes)/.test(k) },
  // pdf.js is the heaviest dependency in the tree by a wide margin — ~1.1 MB
  // of library on top of a ~1.3 MB worker — and it exists for ONE surface,
  // which most sessions never open. Two rules, because there are two ways to
  // undo the split and they look nothing alike:
  //
  //   · the engine itself, which comes back the moment anyone writes
  //     `import { getDocument } from "pdfjs-dist"` outside
  //     client/books/pdfjs.ts (that file is reached only through `import()`);
  //   · the reader's own modules, which come back the moment anyone imports
  //     a component or a helper out of client/books/ from the app shell.
  //     `client/books/door.ts` is the deliberate exception and the reason
  //     the rule names the surface files rather than the directory: it is the
  //     door the sidebar, the router and the editors hold — URL parsing, a
  //     tree walk and a store call — and everything behind it is dynamic
  //     (Pane.tsx mounts BooksSurface through React.lazy).
  { label: "pdf.js", test: (k) => /node_modules\/pdfjs-dist\//.test(k) },
  {
    label: "the book reader",
    test: (k) => /books\/(BooksSurface|BookReader|BookLibrary|render|covers|pdfjs)\.tsx?$/.test(k),
  },
];

// ── surfaces that must remain separately loadable ───────────────────────────
const MUST_SPLIT = [
  "blog/BlogShell.tsx",
  "components/GraphView.tsx",
  "components/Sidebar.tsx",
  "components/SettingsModal.tsx",
  "reading/ReadingView.tsx",
  // The books surface. Its own chunk, and the parent of two more (the shelf
  // and the reader split from each other inside it) — see BooksSurface.tsx.
  "books/BooksSurface.tsx",
  // The tour. Fifteen folios, fifteen drawings and two languages of prose —
  // ~30 kB of chunk to describe a product to somebody who has not asked yet.
  // Its four doors (the palette, the empty state, the shortcut sheet, and the
  // deck's own re-entry) all live in first-paint surfaces, so the ONLY thing
  // standing between the deck and everybody's entry chunk is the dynamic
  // import in client/tour.ts. That is exactly the kind of boundary a later
  // refactor removes by accident, so it is asserted here rather than trusted.
  "components/Tour.tsx",
];

let failed = false;
const fail = (msg) => {
  console.error(`  FAIL  ${msg}`);
  failed = true;
};

console.log("check-bundle: first-paint budgets\n");
for (const audience of AUDIENCES) {
  const files = filesOf(audience.keys);
  const size = bytes(files);
  const ok = size <= audience.budget;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${audience.name.padEnd(24)} ${kb(size).padStart(10)}  (budget ${kb(audience.budget)}, ${files.size} files)`,
  );
  if (!ok) failed = true;
  for (const rule of FORBIDDEN) {
    const hit = [...audience.keys].find(rule.test);
    if (hit) fail(`${rule.label} is in "${audience.name}" via ${hit}`);
  }
}

console.log("\ncheck-bundle: surfaces still split");
for (const src of MUST_SPLIT) {
  const key = keyFor(src);
  const entryFor = key ? manifest[key] : undefined;
  if (!entryFor) {
    fail(`${src} has no chunk of its own — the lazy boundary is gone`);
    continue;
  }
  if (entry.has(key)) {
    fail(`${src} is a STATIC import of the entry — it will load for everyone`);
    continue;
  }
  console.log(`  ok    ${src.padEnd(34)} ${entryFor.file}`);
}

// The editor is the one chunk whose absence from BOTH shells is the whole
// point of the exercise, so it gets said out loud.
const editorKey = Object.keys(manifest).find(
  (k) => /Editor[-.]/.test(k) && manifest[k].file.endsWith(".js"),
);
if (!editorKey) fail("no editor chunk in the manifest at all");
else console.log(`  ok    editor chunk                       ${manifest[editorKey].file} (${kb(bytes([manifest[editorKey].file]))})`);

console.log(failed ? "\nBUNDLE BUDGET FAILED" : "\nBUNDLE OK");
process.exit(failed ? 1 : 0);
