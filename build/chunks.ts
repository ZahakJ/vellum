// Chunk policy for the client build (used by vite.config.ts).
//
// The rule this file enforces: **nobody downloads code for a surface they are
// not on.** An anonymous reader of a blog article must not pay for the vault
// sidebar, the force-directed graph engine, the settings/moderation modals or
// CodeMirror; an admin opening the vault must not pay for the blog shell.
//
// Two mechanisms cooperate, and BOTH are required:
//
//   1. `client/App.tsx` reaches the heavy surfaces through `React.lazy()`, so
//      rollup sees a dynamic import boundary and never hoists them into the
//      entry. That alone is what keeps them out of the first request.
//   2. This function then GROUPS what crossed the boundary, so the ten lazy
//      components of one surface arrive as one request instead of ten. Without
//      it a cold admin paint costs a waterfall of tiny chunks.
//
// Grouping alone would not help (rollup would still hoist a statically
// imported module into the entry chunk and merely name the group), and lazy
// imports alone would shatter each surface into per-component chunks — so a
// change to either half needs a look at the other.
//
// Anything not named here keeps rollup's automatic placement: the CodeMirror
// language modes, the vim keymap and KaTeX are already reached only through
// dynamic imports inside the editor/renderer and split themselves correctly.

const rx = {
  // Both shells and the reading renderer live under client/.
  blog: /[\\/]client[\\/]blog[\\/]/,
  reading: /[\\/]client[\\/]reading[\\/]/,
  /** Components BOTH shells render. They must not sit in `app-shell`: the
   *  blog chunk statically imports them, which would make an anonymous
   *  article reader download the sidebar, the palette and the settings modal
   *  as a transitive dependency. `reading` is where they belong — every
   *  surface that renders one already needs the markdown renderer. */
  sharedUi: /[\\/]client[\\/]components[\\/](Marginalia\.tsx|snippet\.tsx)$/,
  graph: /[\\/]client[\\/]components[\\/](GraphView|LocalGraph)\.tsx$/,
  editor: /[\\/]client[\\/](editor[\\/]|components[\\/]Editor\.tsx$)/,
  appShell: /[\\/]client[\\/]components[\\/]/,
  react: /[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/,
};

/**
 * `manualChunks` in function form: module id → chunk name (or undefined to
 * leave rollup's own decision alone).
 */
export function chunkFor(id: string): string | undefined {
  const path = id.replace(/\\/g, "/");
  // Vendors first: a node_modules path can never be one of ours. Only React
  // is named — CodeMirror, its language modes, the vim keymap and KaTeX are
  // reached exclusively through dynamic imports and already split themselves
  // correctly, and NAMING them would be actively wrong: it would fuse ~60
  // per-language grammars that load one at a time into a single chunk.
  if (path.includes("/node_modules/")) {
    return rx.react.test(path) ? "vendor-react" : undefined;
  }
  return undefined;
}
