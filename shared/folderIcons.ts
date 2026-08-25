// THE FOLDER GLYPH SET — one closed vocabulary, drawn once, used twice.
//
// A folder in the vault tree may wear one of these, and (feature B) so may a
// public folder on the blog. Both surfaces read the SAME table, which is the
// whole reason this module exists: two hand-kept icon lists drift, and the
// second one to drift is always the one the visitor sees.
//
// WHY A CLOSED ENUM AND NOT A NAME. shared/designChrome.ts:188-190 settled
// this for the site designer and the argument is unchanged here: a free-text
// icon field is a promise the renderer cannot keep. Someone types "bookshelf",
// nothing draws, and the only feedback is a blank space. A union of twenty
// means the picker IS the documentation and an unknown value is a 400 at the
// door rather than a hole in the sidebar.
//
// WHY PATH STRINGS AND NOT JSX. This module is loaded by server/settings.ts to
// validate a PATCH and by tests/folderIcons.test.ts under bare node. A `.tsx`
// full of elements could be neither. The client wraps these in one <svg> in
// client/components/FolderGlyph.tsx; nothing else here knows React exists.
//
// HOW THEY ARE DRAWN (client/components/design/SectionGlyph.tsx:11-25):
//  * A 0 0 24 24 grid, stroke 1.7, fill none, currentColor, round caps/joins —
//    the sidebar's own house style (Sidebar.tsx:349-403), so a folder glyph and
//    an attachment glyph sit on the same row without one looking imported.
//  * The drawing is the SHAPE OF THE THING, never a letter or a symbol.
//  * Every glyph must survive 14px. That rule threw out more detail than it
//    kept: the telescope lost its finder scope, the pawn its bevel, the
//    gamepad its shoulder buttons. What is left is silhouette.
//  * NO TWO CONFUSABLE AT 14px, including against the attachment glyphs that
//    share the tree. `music` is a SINGLE note precisely because the audio
//    attachment glyph is already the beamed pair (Sidebar.tsx:369-377), and
//    `book` is the OPEN book because a closed one reads as `archive` at 14px.

/** The twenty. Order is the picker's reading order: things you make, places
 *  you go, things you watch and play, then the marks that mean "everything
 *  else". */
export type FolderIcon =
  | "book"
  | "quill"
  | "flask"
  | "star"
  | "compass"
  | "map"
  | "leaf"
  | "moon"
  | "heart"
  | "music"
  | "camera"
  | "code"
  | "scroll"
  | "gamepad"
  | "film"
  | "telescope"
  | "archive"
  | "sparkle"
  | "globe"
  | "chess";

export const FOLDER_ICONS: readonly FolderIcon[] = [
  "book",
  "quill",
  "flask",
  "star",
  "compass",
  "map",
  "leaf",
  "moon",
  "heart",
  "music",
  "camera",
  "code",
  "scroll",
  "gamepad",
  "film",
  "telescope",
  "archive",
  "sparkle",
  "globe",
  "chess",
];

/** SVG path data per icon: an array of `d` strings on a 0 0 24 24 grid,
 *  designed for `stroke-width: 1.7`, `fill: none`, `stroke: currentColor`.
 *  A zero-length `h.01` segment is a DOT under a round linecap — the standard
 *  trick, and the only way the gamepad's face buttons survive 14px. */
export const FOLDER_ICON_PATHS: Record<FolderIcon, string[]> = {
  // An OPEN book: two leaves meeting at a spine. The closed book was tried
  // first and lost — at 14px its outline is a rectangle, which is what
  // `archive` and `film` already are.
  book: [
    "M12 7.2v13.4",
    "M3 18.6a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1h5.2A3.8 3.8 0 0 1 12 7.2a3.8 3.8 0 0 1 3.8-3.8H21a1 1 0 0 1 1 1v13.2a1 1 0 0 1-1 1h-5.6a3.4 3.4 0 0 0-3.4 2 3.4 3.4 0 0 0-3.4-2z",
  ],
  // A feather held nib-down. The shaft runs clear of the vane and out past it
  // — that overshoot is the whole difference from `leaf`, which has a stem
  // that stops where the blade starts.
  quill: [
    "M20.3 12.3a6.1 6.1 0 0 0-8.6-8.6L4.9 10.5v8.6h8.6z",
    "M15.9 8.1 2.4 21.6",
    "M17.6 15.1H9",
  ],
  // A conical flask: capped neck, shoulders, and the meniscus of whatever is
  // in it. The liquid line is what stops it reading as a plain triangle.
  flask: [
    "M9.2 2.6v6.6L4.3 17.9A2 2 0 0 0 6 21h12a2 2 0 0 0 1.7-3.1l-4.9-8.7V2.6",
    "M8.2 2.6h7.6",
    "M6.6 15.2h10.8",
  ],
  // Five points, convex, filled by nothing. Its partner `sparkle` is the
  // FOUR-point concave one, and the two never meet in the same silhouette.
  star: [
    "M12 2.8 15 8.9l6.7 1-4.9 4.7 1.2 6.6L12 18.1l-6 3.1 1.2-6.6-4.9-4.7 6.7-1z",
  ],
  // A compass rose: the needle is a slim diagonal lozenge, and that asymmetry
  // is what keeps it apart from `globe`, whose interior is a symmetric grid.
  compass: [
    "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19z",
    "M16.3 7.7 13.6 13.6 7.7 16.3 10.4 10.4z",
  ],
  // A folded paper map: three panels, the outer two dropped, the creases
  // drawn. Not a pin, not a globe — the object you unfold on a table.
  map: [
    "M9 3.4 3.6 5.8a1 1 0 0 0-.6.92v13.1a.7.7 0 0 0 .98.64L9 18.2l6 2.4 5.4-2.4a1 1 0 0 0 .6-.92V4.18a.7.7 0 0 0-.98-.64L15 5.8z",
    "M9 3.4v14.8",
    "M15 5.8v14.8",
  ],
  // One leaf with its midrib, on a stem that STOPS at the blade. See `quill`.
  leaf: [
    "M11 20.4A7 7 0 0 1 9.8 6.5C15.5 5.4 17 4.9 19 2.4c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z",
    "M2.4 21.6c0-3 1.9-5.4 5.1-6C10 15.1 12.5 13.6 13.5 12.4",
  ],
  // A crescent, cut by a second circle. The most instantly-read shape here.
  moon: [
    "M21.2 12.9A9.2 9.2 0 1 1 11.1 2.8 7.2 7.2 0 0 0 21.2 12.9z",
  ],
  heart: [
    "M20.9 4.6a5.6 5.6 0 0 0-7.9 0L12 5.7l-1-1.1a5.6 5.6 0 0 0-7.9 7.9l1.1 1L12 21.4l7.8-7.8 1.1-1a5.6 5.6 0 0 0 0-7.9z",
  ],
  // A SINGLE eighth note with its flag. Deliberately not the beamed pair:
  // that drawing is already taken by the audio attachment glyph, and the two
  // appear on the same rows of the same tree.
  music: [
    "M11.9 17.3a3.45 3.45 0 1 1-6.9 0 3.45 3.45 0 1 1 6.9 0z",
    "M11.9 17.3V3.2",
    "M11.9 3.2c3.1.8 5.8 2.4 6.7 4.9",
  ],
  // A camera: body, the viewfinder hump over the shutter side, and the lens.
  // The lens circle is what keeps it out of `film`/`archive` territory.
  camera: [
    "M14.6 4.2H9.4L7.7 6.4a2 2 0 0 1-1.6.8H4a2 2 0 0 0-2 2v8.6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9.2a2 2 0 0 0-2-2h-2.1a2 2 0 0 1-1.6-.8z",
    "M15.5 13.4a3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0z",
  ],
  code: [
    "M8.6 17.6 3 12l5.6-5.6",
    "M15.4 6.4 21 12l-5.6 5.6",
  ],
  // A scroll: the sheet, with a roll curling at each end.
  scroll: [
    "M19 17V5a2 2 0 0 0-2-2H4",
    "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2h4",
  ],
  // A gamepad: grips, d-pad, two face buttons. The buttons are dots (a
  // zero-length segment under a round cap) because at 14px a 1.8px circle
  // outline fills in and becomes a smudge anyway.
  gamepad: [
    "M17.4 5.6H6.6a4.5 4.5 0 0 0-4.44 3.8l-.68 4.9a3.3 3.3 0 0 0 3.27 3.75 3.1 3.1 0 0 0 2.63-1.46l1.1-1.74h7.24l1.1 1.74a3.1 3.1 0 0 0 2.63 1.46 3.3 3.3 0 0 0 3.27-3.75l-.68-4.9A4.5 4.5 0 0 0 17.4 5.6z",
    "M6.4 10v3.2",
    "M4.8 11.6H8",
    "M16.3 10.9h.01",
    "M18.9 13.1h.01",
  ],
  // A filmstrip: the frame, both perforated rails, four sprocket holes.
  film: [
    "M3.6 4h16.8A1.6 1.6 0 0 1 22 5.6v12.8a1.6 1.6 0 0 1-1.6 1.6H3.6A1.6 1.6 0 0 1 2 18.4V5.6A1.6 1.6 0 0 1 3.6 4z",
    "M7 4v16",
    "M17 4v16",
    "M2 9.3h5",
    "M2 14.7h5",
    "M17 9.3h5",
    "M17 14.7h5",
  ],
  // A telescope on a tripod. Straight lines only — every curved barrel drawn
  // for this slot turned to porridge at 14px; the round linejoin does the
  // softening that the arcs were there for.
  telescope: [
    "M6.1 15.4 3.9 11.6 16.8 2.9 20.2 8.7z",
    "M11.8 13 8.8 21",
    "M11.8 13 14.8 21",
    "M10.1 17.6h3.4",
  ],
  // A lidded box with a pull. The detached lid is the whole tell against
  // `book` and `film`.
  archive: [
    "M3 3.8h18a1 1 0 0 1 1 1v2.8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1z",
    "M4 8.6v9.8a1.8 1.8 0 0 0 1.8 1.8h12.4a1.8 1.8 0 0 0 1.8-1.8V8.6",
    "M9.8 12.6h4.4",
  ],
  // The wordmark's own star, twice: a big four-point sparkle and a small one
  // trailing it. Concave points, so it never reads as `star`.
  sparkle: [
    "M10.6 2.6 12.2 8 17.6 9.6 12.2 11.2 10.6 16.6 9 11.2 3.6 9.6 9 8z",
    "M18.4 14.2 19.3 16.5 21.6 17.4 19.3 18.3 18.4 20.6 17.5 18.3 15.2 17.4 17.5 16.5z",
  ],
  // A globe: equator and one meridian ellipse. A symmetric interior grid —
  // see the note on `compass`.
  globe: [
    "M12 2.5a9.5 9.5 0 1 0 0 19 9.5 9.5 0 0 0 0-19z",
    "M2.5 12h19",
    "M12 2.5a4.2 9.5 0 0 1 0 19 4.2 9.5 0 0 1 0-19z",
  ],
  // A chess PAWN, not a knight: a knight's mane is four curves that merge into
  // a blob below 20px, and the pawn's head-collar-flare reads at any size.
  chess: [
    "M14.8 5.8a2.8 2.8 0 1 1-5.6 0 2.8 2.8 0 1 1 5.6 0z",
    "M9.7 8.4c-.4 1-1 1.5-1 2.3 0 3.4-1.1 5.6-2.5 7.1h11.6c-1.4-1.5-2.5-3.7-2.5-7.1 0-.8-.6-1.3-1-2.3",
    "M5.6 17.8h12.8a1 1 0 0 1 1 1v1.2a1 1 0 0 1-1 1H5.6a1 1 0 0 1-1-1v-1.2a1 1 0 0 1 1-1z",
  ],
};

/** Is this a glyph this build can actually draw? The one gate every PATCH,
 *  every frontmatter row and every hydrated store value goes through — a
 *  value that fails it must never reach a renderer, because an unknown icon
 *  renders NOTHING and a folder that silently lost its mark is a bug report. */
export function isFolderIcon(value: unknown): value is FolderIcon {
  return typeof value === "string" && NAMES.has(value);
}

/** The enum as a lookup. Built from `FOLDER_ICONS`, deliberately NOT from
 *  `FOLDER_ICON_PATHS` — that is a bundle contract, not a style preference.
 *  Everything that merely VALIDATES an icon (the store's hydration, the
 *  settings PATCH, feature B's frontmatter) would otherwise drag four
 *  kilobytes of path data behind it into every chunk that touches it: the
 *  first version validated against the path table and put all twenty drawings
 *  in the entry bundle, where the anonymous blog reader downloads them to
 *  render a page that has no folder glyphs on it. The path table now has
 *  exactly one importer (FolderGlyph.tsx) and tree-shakes out of the rest. */
const NAMES = new Set<string>(FOLDER_ICONS);

/** How many folders may carry a mark. The number `excludeTags`/`tagLabels`
 *  argue for (settings.ts:1108-1119): settings.json is read on every request
 *  and GET /api/settings is fetched every time the panel opens, so a map with
 *  no ceiling is a self-inflicted 400 kB response waiting to happen. Two
 *  hundred marked folders is far past the point where a mark still MEANS
 *  anything — a tree where every row has a glyph has no glyphs. */
export const FOLDER_ICONS_MAX = 200;

/** Read-side cleaner for a stored `folderIcons` map: keeps the rows this
 *  build can draw and DROPS the rest in silence.
 *
 *  Silence is the same call `cleanTagLabels` makes, for the same reason: this
 *  is a bulk map, a hand-edited settings.json naming one glyph that does not
 *  exist must not cost the other nineteen folders their marks, and a read
 *  that throws takes the instance down. The PATCH handler is where a bad row
 *  is a 400 — a write is a person making a claim, a read is a file. */
export function cleanFolderIcons(value: unknown): Record<string, FolderIcon> {
  const out: Record<string, FolderIcon> = Object.create(null) as Record<string, FolderIcon>;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ...out };
  let kept = 0;
  for (const [rawKey, icon] of Object.entries(value as Record<string, unknown>)) {
    if (kept >= FOLDER_ICONS_MAX) break;
    const key = folderIconKey(rawKey);
    if (key === null || !isFolderIcon(icon)) continue;
    out[key] = icon;
    kept++;
  }
  return { ...out };
}

/** A stored key normalized to the vault-relative folder path it claims to be,
 *  or null when it cannot be one. Shape only — whether that folder EXISTS is
 *  not asked, here or anywhere: a folder can be renamed by any means the
 *  owner likes (git pull, Finder, another editor), and a map that pruned
 *  itself on every read would lose a mark to a five-second outage. */
export function folderIconKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // A TRAILING slash is punctuation — `TreeNode.path` never carries one, and a
  // reader typing "notes/games/" means the folder either way. A LEADING one is
  // not: stripping it is exactly the silent rewrite `vaultRel()` exists to
  // refuse (settings.ts:705-720). `{"/etc": "book"}` must be an error, not a
  // mark quietly placed on `etc`. Same for a backslash and a drive letter:
  // a path that cannot mean what it says is an error, not a hint.
  const key = raw.trim().replace(/\/+$/, "");
  if (key === "" || key.length > 400) return null;
  if (key.startsWith("/") || key.includes("\\") || /^[A-Za-z]:/.test(key)) return null;
  // No `..`, no empty or `.` segment — the shape half of what `vaultRel()`
  // refuses; the other half (ignored-dir rejection) needs the vault root and
  // stays server-side. Checked here as well so the picker and the blog bundle
  // share ONE definition of a legal key rather than trusting what got through.
  if (key.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  return key;
}
