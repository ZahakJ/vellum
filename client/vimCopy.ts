// Copy for a vim sub-mode: the pill word, its tooltip and the zen strip
// sentence all come from ONE table so they can never disagree.
//
// This lives apart from StatusBar, which owns the pill, because App owns the
// zen strip and StatusBar is loaded lazily. A named import out of a lazy
// component's module is a static import of that module — App reaching in for
// `vimSubCopy` would have pulled StatusBar, and behind it the designer, the
// theme picker and the sync badge, straight back into the first-paint bundle.
// The table is four lines of key names; the module that holds it is free.

export const VIM_SUB = {
  normal: { pill: "vimNormal", title: "vimNormalTitle", strip: "vimStripNormal" },
  insert: { pill: "vimInsert", title: "vimInsertTitle", strip: "vimStripInsert" },
  visual: { pill: "vimVisual", title: "vimVisualTitle", strip: "vimStripVisual" },
  replace: { pill: "vimReplace", title: "vimReplaceTitle", strip: "vimStripReplace" },
} as const;

export function vimSubCopy(mode: keyof typeof VIM_SUB | null) {
  return mode ? VIM_SUB[mode] : null;
}
