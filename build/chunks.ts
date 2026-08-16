// Chunk policy for the client build (used by vite.config.ts).
//
// The rule this file enforces: **nobody downloads code for a surface they are
// not on.** An anonymous reader of a blog article must not pay for the vault
// sidebar, the force-directed graph engine, the settings/moderation modals or
// CodeMirror; an admin opening the vault must not pay for the blog shell.
//
// What actually does that work is `client/App.tsx`: it reaches every heavy
// surface through `React.lazy()`, so rollup sees a dynamic import boundary and
// never hoists them into the entry chunk. Rollup's own splitting then groups
// what crossed the boundary — a shared module reached by one surface lands in
// that surface's chunk, one reached by two becomes a shared chunk — and
// `npm run check-bundle` measures the result per surface on every build.
//
// THIS FILE NAMES EXACTLY ONE GROUP: React. Everything else is left to rollup
// on purpose. An earlier version carried a table of per-surface regexes
// (blog / reading / sharedUi / graph / editor / appShell) that `chunkFor` never
// consulted — every non-node_modules module returned `undefined` — so the
// documented half of a "BOTH required" mechanism had never run, and the
// budgets it was supposed to defend were being met without it. A policy table
// nothing reads is worse than no table: it is a description of the build that
// is not true. If per-surface grouping is ever needed, add it here AND read it
// in `chunkFor` in the same change.
//
// The CodeMirror language modes, the vim keymap and KaTeX are reached only
// through dynamic imports inside the editor/renderer and split themselves
// correctly.

/** React and the runtime that must not be duplicated across chunks. */
const REACT = /[\\/]node_modules[\\/](react|react-dom|scheduler|use-sync-external-store)[\\/]/;

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
    return REACT.test(path) ? "vendor-react" : undefined;
  }
  return undefined;
}
