// The NAME of each folder glyph, in the reader's language.
//
// Its own module, and not part of FolderGlyph.tsx, for two reasons. The glyph
// component is deliberately dependency-free so the blog chunk can render a
// mark without pulling the dictionary in behind it; and the settings panel
// (feature B's public-folders editor) wants the names WITHOUT the popover
// that the tree's picker wraps them in.
//
// The table is spelled out rather than derived (`folderIcon${cap(icon)}`)
// because check-i18n counts a key as USED by finding its quoted token in a
// source file. A computed key is invisible to that scan, so twenty live
// strings would be reported as dead keys — and the honest fix is the literal
// table, not a `// eslint`-shaped silence.

import type { FolderIcon } from "../shared/folderIcons.ts";
import { t, type I18nKey } from "./i18n.ts";

const FOLDER_ICON_LABEL_KEYS: Record<FolderIcon, I18nKey> = {
  book: "folderIconBook",
  quill: "folderIconQuill",
  flask: "folderIconFlask",
  star: "folderIconStar",
  compass: "folderIconCompass",
  map: "folderIconMap",
  leaf: "folderIconLeaf",
  moon: "folderIconMoon",
  heart: "folderIconHeart",
  music: "folderIconMusic",
  camera: "folderIconCamera",
  code: "folderIconCode",
  scroll: "folderIconScroll",
  gamepad: "folderIconGamepad",
  film: "folderIconFilm",
  telescope: "folderIconTelescope",
  archive: "folderIconArchive",
  sparkle: "folderIconSparkle",
  globe: "folderIconGlobe",
  chess: "folderIconChess",
};

/** The localized name of one glyph — a button's accessible name, a select
 *  row's text. Read at call time, never cached: the chrome language can
 *  change under a mounted component. */
export function folderIconLabel(icon: FolderIcon): string {
  return t(FOLDER_ICON_LABEL_KEYS[icon]);
}
