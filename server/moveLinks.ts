// Link rewriting for MOVES — the half of "rename" that a rename-in-place never
// needed.
//
// `/api/rename` has always rewritten [[wikilinks]] in the notes that pointed AT
// a renamed note. That is the whole story when a file keeps its folder and
// changes its name. It is not the whole story when a file changes FOLDER, which
// is what a drag in the tree does:
//
//   1. Standard-markdown destinations — `![alt](Media/x.png)`, `[see](../Ideas/Note.md)`
//      — resolve against the note's OWN directory (client/editor/embeds.ts
//      `resolveRelative()`, and its server twin `parseAssets()` in indexer.ts).
//      Move the note one folder up and every one of them points somewhere else.
//      The admin sees a broken image; a published note serves a 404 to visitors,
//      because the publish allowlist is built from the same resolution.
//   2. PATH-form wikilinks (`[[Folder/Note]]`) name a vault path. Move the note
//      and they dangle. Basename-form links (`[[Note]]`) resolve by name and
//      survive a move untouched, so this module deliberately never touches them.
//
// Everything here is pure string work over one note's content: no fs, no index.
// The caller decides WHICH notes to run it over and does the reading, writing
// and reindexing (server/api.ts).

import { isNotePath, stripNoteExt } from "../shared/noteFormat.ts";
import { wikilinkRegex } from "./indexer.ts";

/** The folder part of a vault-relative path ("" at the vault root). */
export function dirOf(relPath: string): string {
  const cut = relPath.lastIndexOf("/");
  return cut === -1 ? "" : relPath.slice(0, cut);
}

/** A move table: old vault-relative path → new vault-relative path. Notes and
 *  attachments alike (a folder move carries both). */
export type MoveMap = ReadonlyMap<string, string>;

// ------------------------------------------------------------- wikilink paths

/** Rewrite PATH-form `[[Folder/Note]]` targets that name a moved note.
 *
 *  Basename-form targets (`[[Note]]`) are skipped on purpose: they resolve by
 *  name, so a move cannot break them and rewriting them would turn a portable
 *  link into a brittle one. Headings and aliases are carried through untouched. */
export function rewriteWikilinkPaths(content: string, moved: MoveMap): string {
  if (moved.size === 0) return content;
  // Lowercased old path, with and without the extension → new path, no extension
  // (which is how a wikilink names a note).
  const table = new Map<string, string>();
  for (const [from, to] of moved) {
    if (!isNotePath(from) || !isNotePath(to)) continue;
    const newNoExt = stripNoteExt(to);
    table.set(stripNoteExt(from).toLowerCase(), newNoExt);
    table.set(from.toLowerCase(), newNoExt);
  }
  if (table.size === 0) return content;
  return content.replace(
    wikilinkRegex(),
    (whole: string, target: string, heading?: string, alias?: string) => {
      const key = target.trim().replace(/\\/g, "/").replace(/^\.?\/+/, "").toLowerCase();
      if (!key.includes("/")) return whole; // basename form: a move cannot break it
      const hit = table.get(key);
      return hit === undefined ? whole : `[[${hit}${heading ?? ""}${alias ?? ""}]]`;
    },
  );
}

// -------------------------------------------------- standard-markdown targets

// `[label](dest "title")` and its `!` image form. The destination half is the
// SAME shape indexer.ts's MD_IMAGE_RE matches — runs to the first whitespace or
// `)` — plus the `<…>` form, which is the only way a destination can legally
// carry a space. Four groups so the replacement can put back everything it did
// not touch: the label + `(`, leading space, the destination, the optional
// title + `)`.
const MD_DEST_RE =
  /(!?\[[^\]]*\]\()(\s*)(<[^<>\n]*>|[^)\s]+)((?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\))/g;

interface Dest {
  /** The vault-relative file the destination resolves to. */
  target: string;
  /** Written from the vault root (`/Media/x.png`) rather than relatively. */
  rooted: boolean;
  /** The original was percent-encoded, so the replacement must be too. */
  encoded: boolean;
  /** The original was wrapped in `<…>`. */
  angled: boolean;
  /** The destination EXACTLY as it was written, minus the `<…>` wrapper and
   *  the `?`/`#` tail. `encodeURIComponent` is not the inverse of
   *  `decodeURIComponent`: it does not produce `%2E` for `.`, so a note that
   *  said `Media/pic%2Epng` came back as `Media/pic.png` — a byte the
   *  round-trip promise says should survive. When the destination resolves to
   *  the same file it always did, the ORIGINAL spelling is reprinted rather
   *  than a re-encoded equivalent of it. */
  text: string;
  /** `#heading` / `?query` tail, carried through verbatim. */
  suffix: string;
}

/** Resolve one markdown destination against `dir`, the folder of the note it
 *  was written in. null for anything a move cannot affect: external schemes,
 *  protocol-relative URLs, bare fragments, and paths that climb above the vault
 *  root (dropped rather than clamped, exactly as `parseAssets()` drops them). */
function parseDest(raw: string, dir: string): Dest | null {
  const angled = raw.startsWith("<") && raw.endsWith(">");
  let text = angled ? raw.slice(1, -1) : raw;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) || text.startsWith("//") || text.startsWith("#")) {
    return null;
  }
  const suffix = /[?#].*$/.exec(text)?.[0] ?? "";
  text = text.slice(0, text.length - suffix.length);
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // A stray '%' is not an encoding — take the destination literally.
  }
  const encoded = decoded !== text;
  decoded = decoded.replace(/\\/g, "/");
  if (!decoded) return null;
  const rooted = decoded.startsWith("/");
  const parts = rooted ? [] : dir ? dir.split("/") : [];
  for (const seg of decoded.replace(/^\/+/, "").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null; // climbs out of the vault
      parts.pop();
    } else parts.push(seg);
  }
  if (parts.length === 0) return null;
  return { target: parts.join("/"), rooted, encoded, angled, suffix, text };
}

/** `target` expressed relative to `dir` ("Media/x.png" seen from "Ideas" is
 *  "../Media/x.png"; seen from "" it is itself). */
function relativeTo(dir: string, target: string): string {
  const from = dir ? dir.split("/") : [];
  const to = target.split("/");
  let same = 0;
  while (same < from.length && same < to.length - 1 && from[same] === to[same]) same++;
  const up = from.length - same;
  return [...Array<string>(up).fill(".."), ...to.slice(same)].join("/");
}

/** Decoded segment → the segment exactly as the author wrote it. */
function writtenSegments(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const seg of text.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === "." || seg === "..") continue;
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      /* a stray '%' is not an encoding: the segment IS its own decoding */
    }
    if (!out.has(decoded)) out.set(decoded, seg);
  }
  return out;
}

/** Do two destination spellings name the same path? Percent-encoding is a
 *  spelling, not an address, so `pic%2Epng` and `pic.png` are one file. */
function sameDest(a: string, b: string): boolean {
  const plain = (s: string): string => {
    try {
      return decodeURIComponent(s).replace(/\\/g, "/");
    } catch {
      return s.replace(/\\/g, "/");
    }
  };
  return plain(a) === plain(b);
}

/** Print a resolved destination the way the original was written: rooted stays
 *  rooted, angle brackets stay angle brackets, and percent-encoding is restored
 *  whenever it was there OR the new text needs it. Angle brackets are never
 *  ADDED — `parseAssets()` (the publish allowlist) does not read that form, so
 *  inventing it would allowlist nothing and 404 the image to every visitor. */
function printDest(target: string, dir: string, dest: Dest): string {
  let out = dest.rooted ? `/${target}` : relativeTo(dir, target);
  if (dest.encoded || /[\s()<>]/.test(out)) {
    // A segment the move did not rename keeps the SPELLING it was written
    // with. `encodeURIComponent` is not the inverse of `decodeURIComponent` —
    // it does not produce `%2E` for `.` — so re-encoding from the resolved
    // path silently rewrites bytes the round-trip promise says survive.
    const written = writtenSegments(dest.text);
    out = out
      .split("/")
      .map((seg) =>
        seg === ".." || seg === "" ? seg : written.get(seg) ?? encodeURIComponent(seg),
      )
      .join("/");
    if (dest.rooted) out = out.startsWith("/") ? out : `/${out}`;
  }
  // Same file, same route to it: give back the author's own bytes. Anything
  // else re-spells a destination the move did not touch.
  if (sameDest(out, dest.text)) out = dest.text;
  out += dest.suffix;
  return dest.angled ? `<${out}>` : out;
}

/** Rewrite the standard-markdown destinations of ONE note so they keep pointing
 *  at the same files after a move.
 *
 *  Two independent reasons a destination changes, and this handles both in one
 *  pass because both are "resolve, remap, re-print":
 *   - the NOTE moved (`oldDir` ≠ `newDir`), so every relative destination has to
 *     be re-expressed from the new folder;
 *   - the FILE it points at moved (it is in `moved`), which is what happens to
 *     every note outside a folder that pointed into it.
 *
 *  Rooted destinations (`/Media/x.png`) only ever change for the second reason. */
export function rewriteDestinations(
  content: string,
  oldDir: string,
  newDir: string,
  moved: MoveMap,
): string {
  if (oldDir === newDir && moved.size === 0) return content;
  return content.replace(
    MD_DEST_RE,
    (whole: string, head: string, gap: string, raw: string, tail: string) => {
      const dest = parseDest(raw, oldDir);
      if (!dest) return whole;
      const target = moved.get(dest.target) ?? dest.target;
      const next = printDest(target, newDir, dest);
      return next === raw ? whole : `${head}${gap}${next}${tail}`;
    },
  );
}

/** Everything one note needs after a move: path-form wikilinks remapped, then
 *  markdown destinations re-resolved. `fromPath`/`toPath` are the note's own
 *  old and new paths — equal for a note that merely POINTED at something that
 *  moved. */
export function rewriteForMove(
  content: string,
  fromPath: string,
  toPath: string,
  moved: MoveMap,
): string {
  return rewriteDestinations(
    rewriteWikilinkPaths(content, moved),
    dirOf(fromPath),
    dirOf(toPath),
    moved,
  );
}
