// `vellum://` links and the `.md` file association — the two ways something
// OUTSIDE the app asks it to open something inside a vault.
//
// Both are hostile input, and the distinction is easy to lose: a `vellum://`
// URL can be triggered by ANY web page the reader visits, with no prompt and no
// origin the app can inspect. So this file parses, and refuses; it decides
// nothing. The two rules it enforces are the two that matter:
//
//   1. A note reference is vault-RELATIVE and stays inside the vault. `..`,
//      a leading `/`, a drive letter and a NUL are all refused rather than
//      cleaned, because "cleaned" is how `vellum://note?path=../../.ssh/id_rsa`
//      becomes a note the app opens and the indexer reads.
//   2. A vault reference is a NAME OF A VAULT THE READER HAS ALREADY OPENED,
//      resolved against the recent list by the caller (`knownVault` below) —
//      never a directory taken on the URL's word. Vellum serves its vault over
//      loopback and indexes every file in it; a link that could choose that
//      directory would be a one-click "index and serve my home folder".
//
// Pure and electron-free, so `tests/desktop.test.ts` drives exactly this code
// and the root `npm run typecheck` covers it.

import path from "node:path";
import { isNotePath, stripNoteExt } from "../shared/noteFormat.ts";

/** What a link asks for. Both halves are optional: `vellum://open?vault=…`
 *  names a window, `vellum://note?path=…` names a place in whichever window is
 *  focused, and a link with both names a place in a named window. */
export interface DeepLink {
  /** Absolute path as WRITTEN in the link — not yet trusted. Callers must run
   *  it through `knownVault()` before opening anything. */
  vault: string | null;
  /** Vault-relative note path, already proven to stay inside the vault. */
  note: string | null;
}

export const PROTOCOL = "vellum";

/** A vault-relative note path, or null when the string is not one.
 *
 *  Deliberately not a normalizer. `path.posix.normalize` would happily turn
 *  `a/../../b` into `../b` and hand back a string that LOOKS relative; the
 *  check therefore runs after normalization and rejects the result, so no
 *  amount of nesting produces an escape. Backslashes are folded first: a
 *  Windows-shaped link (`notes\Idea.md`) is an honest reference, and
 *  `..\..\etc` must not slip past a check that only knows about `/`. */
export function noteRef(raw: string): string | null {
  if (!raw || raw.includes("\0")) return null;
  const folded = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (folded.startsWith("/") || /^[A-Za-z]:/.test(folded)) return null;
  const normalized = path.posix.normalize(folded);
  if (normalized === "" || normalized === "." ) return null;
  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) return null;
  // Only a NOTE. The app can open an attachment, but nothing off-machine gets
  // to name the file the app reads — the note extensions are the closed set
  // the rest of the product already agrees on (shared/noteFormat.ts).
  return isNotePath(normalized) ? normalized : null;
}

/** A note reference as the app's OWN address bar spells it.
 *
 *  `client/router.ts::notePathToUrl` is the rule — "a/b.md" → "/a/b", extension
 *  stripped, each segment encoded — and the desktop has to spell it the same
 *  way or a deep link lands the reader on a URL the router treats as a
 *  different note and the address bar immediately rewrites. That module cannot
 *  be imported here (it pulls the store, the tree and the toast host behind
 *  it), so the two share the piece that matters: `shared/noteFormat.ts`.
 *  `tests/desktop.test.ts` asserts the two spellings agree. */
export function routeForNote(rel: string): string {
  return "/" + stripNoteExt(rel).split("/").map(encodeURIComponent).join("/");
}

/** Parse a `vellum://…` URL. Returns null for anything that is not one, and
 *  for a well-formed one whose payload does not survive `noteRef`. */
export function parseDeepLink(raw: string): DeepLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== `${PROTOCOL}:`) return null;
  // `vellum://open?…` parses with host "open" and an empty path; `vellum:///…`
  // parses with an empty host. Accept the two spellings a link in the wild
  // actually has, and treat the verb as the first non-empty segment of either.
  const verb = (url.hostname || url.pathname.replace(/^\/+/, "").split("/")[0] || "").toLowerCase();
  if (verb !== "open" && verb !== "note") return null;
  const vaultParam = url.searchParams.get("vault");
  const noteParam = url.searchParams.get("note") ?? url.searchParams.get("path");
  const vault = vaultParam && path.isAbsolute(vaultParam) ? path.normalize(vaultParam) : null;
  const note = noteParam ? noteRef(noteParam) : null;
  if (vault === null && note === null) return null;
  return { vault, note };
}

/** The one gate between a link and a directory: a vault reference is honored
 *  only when it is a vault the READER has already opened, compared as resolved
 *  absolute paths (and case-insensitively on the two platforms whose file
 *  systems are). Returns the canonical entry from `known`, so the rest of the
 *  app works with the path it stored rather than the one the link spelled. */
export function knownVault(ref: string, known: readonly string[]): string | null {
  const want = canonicalDir(ref);
  for (const entry of known) if (canonicalDir(entry) === want) return entry;
  return null;
}

/** True when `file` lies inside `vault` — the file-association question.
 *  A prefix test on strings answers `/vault-notes` for `/vault`, so the
 *  separator is part of the comparison. */
export function containsFile(vault: string, file: string): boolean {
  const root = canonicalDir(vault);
  const target = canonicalDir(file);
  return target !== root && target.startsWith(root + "/");
}

/** `vault` + an absolute file inside it → the vault-relative note path, or
 *  null when the file is elsewhere or is not a note. */
export function relativeNote(vault: string, file: string): string | null {
  if (!containsFile(vault, file)) return null;
  return noteRef(path.relative(path.resolve(vault), path.resolve(file)));
}

/** Which of `vaults` holds `file` — the DEEPEST one, because a reader who has
 *  opened both a vault and a sub-folder of it as vaults meant the sub-folder
 *  when they double-clicked a file inside it. */
export function vaultForFile(file: string, vaults: readonly string[]): string | null {
  let best: string | null = null;
  for (const vault of vaults) {
    if (!containsFile(vault, file)) continue;
    if (best === null || canonicalDir(vault).length > canonicalDir(best).length) best = vault;
  }
  return best;
}

/** One spelling of a directory for comparison: resolved, separators folded to
 *  `/`, no trailing slash, and case-folded on macOS and Windows — where two
 *  spellings of one directory are one directory and treating them as two means
 *  a second window, a second server and a second port for the same vault. */
function canonicalDir(dir: string): string {
  const resolved = path.resolve(dir).replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "linux" ? resolved : resolved.toLowerCase();
}
