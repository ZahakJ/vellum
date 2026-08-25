// PUBLIC FOLDERS — the owner's OWN collections on the public site.
//
// A tag is something a note says about itself; a public folder is something
// the OWNER says about a group of notes. The two are deliberately separate
// systems: tags come out of the vault and are discovered, folders are declared
// in settings.json and are curated. That is why a folder has a title, a glyph
// and a description while a tag has none of those — a folder is a page the
// owner designed, and its slug is the URL they chose for it.
//
// WHY A SHARED MODULE. Three places have to agree on what a legal folder row
// is: the PATCH handler (server/settings.ts), the settings editor's inline
// validation (client/components/SettingsModal.tsx) and the read-side cleaner
// that drops rows a hand-edited file left behind. When those three drift, the
// panel shows a green field beside a 400 — the failure `shared/attachments.ts`
// and `shared/tagLabels.ts` were both split out to prevent.
//
// The SHAPES live in shared/types.ts beside every other wire type; only the
// rules live here.

import { isFolderIcon, type FolderIcon } from "./folderIcons.ts";
import type { PublicFolderRef } from "./types.ts";

/** How many folders a site may declare. Twelve, and the number is a design
 *  statement rather than a storage one: the band on the home page is a grid of
 *  cards a reader takes in at a glance, and the nav row that can carry them is
 *  ONE LINE (NavTopics.tsx). A site with thirty collections has a taxonomy,
 *  and a taxonomy is what the tag system already is. */
export const PUBLIC_FOLDERS_MAX = 12;
export const FOLDER_SLUG_MAX = 60;
export const FOLDER_TITLE_MAX = 60;
export const FOLDER_DESC_MAX = 200;

/** The slug shape: lowercase, starts alphanumeric, hyphens inside. It is a URL
 *  segment (`/folder/<slug>`) AND the value an author types into frontmatter,
 *  so it stays in the one character set that survives both without escaping. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** A candidate slug normalized (trim + lowercase, a leading `/folder/` or `/`
 *  forgiven) — or null when it cannot be a slug at all.
 *
 *  Lowercasing is a coercion and not a rewrite for the reason `defaultTheme`
 *  gives (settings.ts): the set is lowercase by construction, so "Games" has
 *  exactly one thing it can mean. A `..`, a slash in the middle or a space
 *  does NOT have one thing it can mean, and comes back null. */
export function folderSlug(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw.trim().replace(/^\/?(?:folder\/)?/, "").replace(/\/+$/, "").toLowerCase();
  if (slug === "" || slug.length > FOLDER_SLUG_MAX || !SLUG_RE.test(slug)) return null;
  return slug;
}

/** A title turned into the slug it suggests — the settings editor's "you typed
 *  a title and left the slug empty" convenience, never applied server-side. A
 *  title made entirely of characters the slug set cannot hold (an Arabic
 *  title, which is the common case on this instance) suggests nothing, and the
 *  field stays empty rather than filling with mojibake. */
export function suggestSlug(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, FOLDER_SLUG_MAX)
    .replace(/-+$/, "");
  return SLUG_RE.test(slug) ? slug : "";
}

/** Why one folder row was refused, as the tail of a 400 (and the key of the
 *  editor's inline error). `null` means the row is good. */
export type FolderProblem = "slug" | "title" | "icon" | "description";

export function folderRowError(entry: unknown): FolderProblem | null {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return "slug";
  const row = entry as Record<string, unknown>;
  if (folderSlug(row.slug) === null) return "slug";
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (title === "" || title.length > FOLDER_TITLE_MAX) return "title";
  if (!isFolderIcon(row.icon)) return "icon";
  const desc = row.description;
  if (desc !== undefined && desc !== null && desc !== "") {
    if (typeof desc !== "string" || desc.trim().length > FOLDER_DESC_MAX) return "description";
  }
  return null;
}

/** One stored row, cleaned — or null when it is unusable. Shared by the read
 *  path (drop the row in silence, like cleanAuthorSite) and the PATCH path
 *  (refuse it out loud, naming which field). */
export function cleanPublicFolder(entry: unknown, fallbackId: () => string): PublicFolderRef | null {
  if (folderRowError(entry) !== null) return null;
  const row = entry as Record<string, unknown>;
  const out: PublicFolderRef = {
    id: typeof row.id === "string" && ID_RE.test(row.id) ? row.id : fallbackId(),
    slug: folderSlug(row.slug) as string,
    title: (row.title as string).trim(),
    icon: row.icon as FolderIcon,
  };
  const desc = typeof row.description === "string" ? row.description.trim() : "";
  if (desc !== "") out.description = desc;
  // LOSSLESS TAKE-DOWN, the NavItem rule (shared/designChrome.ts): hiding a
  // folder must not cost the owner its title, its glyph or the notes that name
  // its slug — they publish it again by unticking one box.
  if (row.hidden === true) out.hidden = true;
  return out;
}

const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** A short, URL-safe, collision-unlikely row id — React keys and reorder, and
 *  nothing else: the SLUG is the identity the site and the frontmatter use.
 *  Mirrors `designId()` deliberately rather than importing it: this module is
 *  loaded by the blog chunk, and shared/designChrome.ts is the designed site's
 *  entire schema. */
export function folderId(): string {
  const bytes = new Uint8Array(6);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 10);
}
