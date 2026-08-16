// Vault: filesystem layer. Root resolution, safe paths, CRUD on notes/folders,
// and a chokidar watcher that broadcasts debounced VaultEvents.

import { promises as fs, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { AttachmentInfo, AttachmentKind, NoteData, TreeNode, VaultEvent } from "../shared/types.ts";
import { isNotePath, noteExtOf } from "../shared/noteFormat.ts";

export class VaultError extends Error {
  status: number;
  /** A STABLE machine name for this failure, echoed to the client as
   *  `{ error, code }`.
   *
   *  `message` is English prose written for a log and for `curl`; it is not a
   *  string any UI should print. It was being printed: `client/api.ts` wraps
   *  every failure body in an `Error` carrying exactly this text, so an
   *  Arabic-only operator rejecting a mistyped font file read "Not a
   *  recognized font file (woff2, woff, ttf, otf)" in an otherwise fully
   *  Arabic panel — and the `fontUploadFailed` translation that existed for
   *  the purpose was dead code. A code lets the client say it in the
   *  reader's language and fall back to the prose for anything unnamed. */
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "VaultError";
    this.status = status;
    this.code = code;
  }
}

let vaultRoot = "";
/** vaultRoot with its own symlinks resolved — the yardstick every containment
 *  check measures against. Pointing VELLUM_VAULT at a symlink (`~/notes` →
 *  `/mnt/vault`) is normal, so the ROOT may legitimately be a link; what may
 *  not happen is a path inside it resolving somewhere else entirely. */
let vaultRootReal = "";

export function initVault(root: string): void {
  vaultRoot = path.resolve(root);
  try {
    vaultRootReal = realpathSync.native(vaultRoot);
  } catch {
    vaultRootReal = vaultRoot; // not created yet: lexical root until it is
  }
}

export function getVaultRoot(): string {
  return vaultRoot;
}

/** Resolve the vault directory: `--vault <dir>` arg, then env, then ./vault. */
export function resolveVaultRoot(argv: string[], env: NodeJS.ProcessEnv): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--vault" && argv[i + 1]) return path.resolve(argv[i + 1]);
    if (arg.startsWith("--vault=")) return path.resolve(arg.slice("--vault=".length));
  }
  if (env.VELLUM_VAULT) return path.resolve(env.VELLUM_VAULT);
  return path.resolve("vault");
}

/** Canonical vault-relative POSIX path ("" allowed for root). */
export function normalizeRel(rel: string): string {
  const cleaned = rel.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/\/+$/, "");
  if (cleaned === "" || cleaned === ".") return "";
  return path.posix.normalize(cleaned);
}

/** True when `abs` is inside the vault AFTER symlinks are resolved.
 *
 *  The lexical check in safeAbs() answers "does this STRING stay inside the
 *  vault", which is a different question from "does this FILE". Every fs call
 *  below it (`stat`, `readFile`, `writeFile`, `createReadStream`) follows
 *  links, so a single `ln -s /etc evil` inside the vault turned `/api/file
 *  ?path=evil/passwd` into a filesystem reader and `note-link.md → /etc/passwd`
 *  into a readable — and WRITABLE — note. Nothing in the API can create such a
 *  link, but the vault directory is exactly the directory Obsidian, Syncthing,
 *  Dropbox and `git pull` all write into: this is the one place in the app
 *  whose contents are not ours.
 *
 *  A path that does not exist yet (a note about to be created) is answered by
 *  its deepest EXISTING ancestor — the missing segments are plain names, and a
 *  name that is not on disk cannot be a link. A dangling symlink is refused
 *  rather than treated as missing: `realpath` reports ENOENT for both, and
 *  following one on a WRITE would create the file wherever it points. */
function resolvesInsideVault(abs: string): boolean {
  let probe = abs;
  for (;;) {
    try {
      const real = realpathSync.native(probe);
      return real === vaultRootReal || real.startsWith(vaultRootReal + path.sep);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // ELOOP, EACCES, ENAMETOOLONG…: unresolvable is not containable.
      if (code !== "ENOENT" && code !== "ENOTDIR") return false;
      // ENOENT means "absent" OR "a symlink pointing at something absent".
      try {
        lstatSync(probe);
        return false; // the name IS there — it is a dangling link. Refuse.
      } catch {
        /* genuinely absent: ask the parent */
      }
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
}

/** Map a client-supplied relative path to an absolute path strictly inside the vault.
 *  Traversal (`..` as a whole segment — "Jr..md" is a legal name) is a 400;
 *  ignored paths (.obsidian, .trash, dotfiles…) are a 404 so their existence
 *  is never revealed and they can be neither read nor written through any API.
 *  A path that leaves the vault through a SYMLINK is a 404 for the same reason
 *  — the answer must not tell a caller which of their guesses planted a link. */
export function safeAbs(rel: string): string {
  const normalized = normalizeRel(rel);
  if (
    normalized.split("/").includes("..") ||
    path.isAbsolute(normalized) ||
    normalized.includes("\0")
  ) {
    throw new VaultError(400, `Invalid path: ${rel}`);
  }
  if (isIgnoredRel(normalized)) {
    throw new VaultError(404, `Not found: ${rel}`);
  }
  const abs = path.resolve(vaultRoot, normalized);
  if (abs !== vaultRoot && !abs.startsWith(vaultRoot + path.sep)) {
    throw new VaultError(400, `Path escapes vault: ${rel}`);
  }
  if (!resolvesInsideVault(abs)) throw new VaultError(404, `Not found: ${rel}`);
  return abs;
}

/** Assert that `rel` names a NOTE — `.md`, `.tex` or `.latex` — and return it
 *  normalized. Every CRUD entry point below funnels through this one check, so
 *  widening it here is what makes a `.tex` file a first-class note everywhere
 *  rather than in one route at a time. */
export function assertNotePath(rel: string): string {
  const normalized = normalizeRel(rel);
  if (!normalized || !isNotePath(normalized)) {
    throw new VaultError(400, `Not a note path: ${rel}`);
  }
  return normalized;
}

/** The name every caller in the tree already uses. Kept as an alias rather
 *  than renamed at ~10 call sites in a file four agents are editing; the
 *  honest name is `assertNotePath` above. */
export const assertMarkdown = assertNotePath;

// Names never listed, indexed, watched, or served: dotfiles (covers .obsidian,
// .git) plus a few well-known junk dirs that may not be dot-prefixed everywhere.
const IGNORED_NAMES = new Set([".obsidian", ".git", ".trash", "node_modules"]);

/** Where deleted folders go (vault root). Dot-prefixed, so it is already
 *  invisible to the tree, the indexer and the watcher via isIgnoredSegment. */
export const TRASH_DIR = ".trash";

/** True for a single path segment that must be invisible to the whole app. */
export function isIgnoredSegment(name: string): boolean {
  return name.startsWith(".") || IGNORED_NAMES.has(name.toLowerCase());
}

/** True when any segment of a vault-relative path is ignored. */
export function isIgnoredRel(rel: string): boolean {
  if (rel === "") return false;
  return rel.split("/").some(isIgnoredSegment);
}

// ---------------------------------------------------------------- tree & CRUD

/** Extension → attachment kind. Anything not listed is "other" (offered as a
 *  download); the list is deliberately the same family the /api/file MIME
 *  table serves, so what the tree promises is what the viewer can open. */
const ATTACHMENT_KINDS: Record<string, AttachmentKind> = {
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  avif: "image", svg: "image", bmp: "image", ico: "image", tif: "image", tiff: "image",
  pdf: "pdf",
  mp3: "audio", m4a: "audio", wav: "audio", ogg: "audio", oga: "audio", flac: "audio", aac: "audio", opus: "audio",
  mp4: "video", webm: "video", mov: "video", mkv: "video", m4v: "video",
};

/** The extension of a vault-relative path, lowercase and without the dot
 *  ("" when the basename carries none). */
export function fileExt(rel: string): string {
  const base = rel.slice(rel.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** What a non-markdown file IS, for the tree marker and the viewer. */
export function attachmentInfo(rel: string, size: number): AttachmentInfo {
  const ext = fileExt(rel);
  return { kind: ATTACHMENT_KINDS[ext] ?? "other", ext, size };
}

/** The full vault tree (ADMIN surface): folders, notes, and — new — every
 *  other file as an `attachment` node. A vault's `Media/` folder holding a
 *  thousand images used to expand to nothing at all, which reads as data loss
 *  rather than as a filter. Notes and attachments are separated in the sort
 *  so a folder still opens onto its writing, with the files beneath it.
 *
 *  Attachments cost one `stat` each (for the size the viewer prints); notes
 *  cost none, and the stats of one directory run concurrently.
 *
 *  SYMLINKS ARE SKIPPED, here and in listVaultFiles() below — stated rather
 *  than implied, because it is load-bearing: `readdir` reports the LINK's own
 *  type, so a link is neither `isFile()` nor `isDirectory()` and was already
 *  falling through both branches. That is what keeps escaping links out of
 *  the index, and therefore out of the publish allowlist `/api/file` checks
 *  before it serves a byte to an anonymous visitor. */
export async function buildTree(): Promise<TreeNode> {
  async function walk(relDir: string): Promise<TreeNode[]> {
    const absDir = relDir === "" ? vaultRoot : path.join(vaultRoot, relDir);
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const nodes: TreeNode[] = [];
    const attachments: { name: string; path: string }[] = [];
    for (const entry of entries) {
      if (isIgnoredSegment(entry.name) || entry.isSymbolicLink()) continue;
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        nodes.push({ name: entry.name, path: relPath, type: "folder", children: await walk(relPath) });
      } else if (entry.isFile()) {
        if (isNotePath(entry.name)) {
          nodes.push({ name: entry.name, path: relPath, type: "file" });
        } else {
          attachments.push({ name: entry.name, path: relPath });
        }
      }
    }
    const sizes = await Promise.all(
      attachments.map((a) =>
        fs.stat(path.join(vaultRoot, a.path)).then(
          (s) => s.size,
          () => 0, // vanished mid-walk (or unreadable): list it, size unknown
        ),
      ),
    );
    attachments.forEach((a, i) => {
      nodes.push({
        name: a.name,
        path: a.path,
        type: "file",
        attachment: attachmentInfo(a.path, sizes[i]),
      });
    });
    // Folders, then notes, then attachments; alphabetical within each band.
    nodes.sort((a, b) => rank(a) - rank(b) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return nodes;
  }
  return { name: path.basename(vaultRoot), path: "", type: "folder", children: await walk("") };
}

function rank(node: TreeNode): number {
  if (node.type === "folder") return 0;
  return node.attachment ? 2 : 1;
}

/** One walk over the whole vault (ignore rules applied) listing notes and
 *  attachments separately — used by the indexer at boot so it never walks twice. */
export async function listVaultFiles(): Promise<{ notes: string[]; attachments: string[] }> {
  const notes: string[] = [];
  const attachments: string[] = [];
  async function walk(relDir: string): Promise<void> {
    const absDir = relDir === "" ? vaultRoot : path.join(vaultRoot, relDir);
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (isIgnoredSegment(entry.name) || entry.isSymbolicLink()) continue;
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) await walk(relPath);
      else if (entry.isFile()) {
        (isNotePath(entry.name) ? notes : attachments).push(relPath);
      }
    }
  }
  await walk("");
  return { notes, attachments };
}

export interface AttachmentStat {
  rel: string;
  abs: string;
  size: number;
  mtimeMs: number;
}

/** Validate + stat a non-markdown vault file for /api/file. Dotfiles and
 *  ignored dirs are denied as 404 (their existence is not revealed). */
export async function statAttachment(rel: string): Promise<AttachmentStat> {
  const relPath = normalizeRel(rel);
  if (!relPath) throw new VaultError(400, "File path required");
  if (isNotePath(relPath)) {
    // Notes of EVERY format are served by /api/note, which is publish-gated;
    // /api/file is the attachment door and must never become a second, ungated
    // way to read a `.tex` note's source.
    throw new VaultError(400, "Notes are served via /api/note");
  }
  const abs = safeAbs(relPath);
  if (isIgnoredRel(relPath)) throw new VaultError(404, `File not found: ${relPath}`);
  try {
    // lstat, NOT stat — the same rule the two font routes already follow
    // (api.ts). safeAbs() has already refused anything that resolves outside
    // the vault, so this is the second lock on the same door: a link is not a
    // file, and this route hands its bytes to anonymous callers whenever a
    // published note embeds the name.
    const stat = await fs.lstat(abs);
    if (!stat.isFile()) throw new VaultError(404, `File not found: ${relPath}`);
    return { rel: relPath, abs, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch (err) {
    if (err instanceof VaultError) throw err;
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VaultError(404, `File not found: ${relPath}`);
    }
    throw err;
  }
}

export async function readNote(rel: string): Promise<NoteData> {
  const relPath = assertMarkdown(rel);
  const abs = safeAbs(relPath);
  try {
    const [content, stat] = await Promise.all([fs.readFile(abs, "utf8"), fs.stat(abs)]);
    return { path: relPath, content, mtimeMs: stat.mtimeMs };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new VaultError(404, `Note not found: ${relPath}`);
    }
    throw err;
  }
}

export async function writeNote(rel: string, content: string): Promise<NoteData> {
  const relPath = assertMarkdown(rel);
  const abs = safeAbs(relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  const stat = await fs.stat(abs);
  return { path: relPath, content, mtimeMs: stat.mtimeMs };
}

/** True when `rel` names an existing note file. Callers that emit their own
 *  synthetic event for a write need it to say "created" or "changed". */
export async function noteExists(rel: string): Promise<boolean> {
  return exists(safeAbs(assertMarkdown(rel)));
}

export async function createNote(rel: string): Promise<NoteData> {
  const relPath = assertMarkdown(rel);
  const abs = safeAbs(relPath);
  if (await exists(abs)) throw new VaultError(409, `Note already exists: ${relPath}`);
  return writeNote(relPath, "");
}

export async function renameNote(rel: string, toRel: string): Promise<void> {
  const fromPath = assertMarkdown(rel);
  const toPath = assertMarkdown(toRel);
  const fromAbs = safeAbs(fromPath);
  const toAbs = safeAbs(toPath);
  if (!(await exists(fromAbs))) throw new VaultError(404, `Note not found: ${fromPath}`);
  if (await exists(toAbs)) throw new VaultError(409, `Target already exists: ${toPath}`);
  await fs.mkdir(path.dirname(toAbs), { recursive: true });
  suppress(fromPath);
  suppress(toPath);
  await fs.rename(fromAbs, toAbs);
  emit({ kind: "renamed", path: fromPath, toPath });
}

export interface DeleteNoteResult {
  /** Vault-relative path the note now lives at under `.trash/`
   *  (absent when `permanent` removed it outright). */
  trashPath?: string;
}

/** Delete ONE note. Default is the same move to `.trash/` a folder delete
 *  gets; `permanent: true` removes it outright.
 *
 *  The default used to be the opposite way round, and it was the safety
 *  gradient running backwards: deleting a FOLDER — rare, two dialogs deep,
 *  1,214 notes at a time — was recoverable, while deleting ONE note — the
 *  high-frequency, one-click operation on a tree row and in the palette — was
 *  an unconditional `fs.rm` with no undo anywhere in the product. Obsidian
 *  itself trashes single files by default. The ceremony now matches the
 *  consequence in both directions. */
export async function deleteNote(
  rel: string,
  opts?: { permanent?: boolean },
): Promise<DeleteNoteResult> {
  const relPath = assertMarkdown(rel);
  const abs = safeAbs(relPath);
  if (!(await exists(abs))) throw new VaultError(404, `Note not found: ${relPath}`);

  // THE DELETE ANNOUNCES ITSELF, exactly as deleteFolder does, and for a
  // sharper reason than symmetry: leaving it to the watcher made the removal
  // LOSABLE. `suppress()` is keyed on the path alone and holds for a second,
  // so any write to this note in the preceding second — the editor's own
  // 600ms-debounced autosave, a publish toggle, /api/note's PUT — swallowed
  // the `unlink` that was the only thing telling the indexer the note was
  // gone. Measured: PUT then DELETE on one path, 0–200ms apart, left a note
  // in the index, the graph and the search results with no file behind it,
  // resolvable by `[[wikilink]]` and unremovable (a second DELETE 404s).
  // Reachable by hand in one gesture: type a word, then delete the note.
  // Suppressing the echo FIRST is what keeps the two from arriving twice.
  suppress(relPath);
  let trashPath: string | undefined;
  if (opts?.permanent) {
    await fs.rm(abs);
  } else {
    const base = path.posix.basename(relPath);
    const ext = noteExtOf(base);
    const destAbs = await trashDestination(base.slice(0, base.length - ext.length), ext);
    try {
      await fs.rename(abs, destAbs);
    } catch (err) {
      // Same EXDEV fallback deleteFolder() carries: VELLUM_VAULT and its own
      // `.trash` are normally one filesystem, but a bind-mounted sub-tree is not.
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      await fs.cp(abs, destAbs);
      await fs.rm(abs);
    }
    trashPath = `${TRASH_DIR}/${path.basename(destAbs)}`;
  }
  emit({ kind: "deleted", path: relPath });
  return trashPath ? { trashPath } : {};
}

export async function createFolder(rel: string): Promise<void> {
  const relPath = normalizeRel(rel);
  if (!relPath) throw new VaultError(400, "Folder path required");
  await fs.mkdir(safeAbs(relPath), { recursive: true });
}

export interface DeleteFolderResult {
  /** How many `.md` files were inside the folder (recursively) — the UI
   *  phrases its confirm/toast with this ("Move folder to .trash (N notes)?"). */
  notes: number;
  /** Vault-relative path the folder now lives at under `.trash/`
   *  (absent when `permanent` deleted it outright). */
  trashPath?: string;
}

/** Everything under a folder, ignore rules applied: the vault-relative paths
 *  of its files and sub-folders (deepest first) plus the markdown count. */
async function collectFolder(relFolder: string): Promise<{ paths: string[]; notes: number }> {
  const paths: string[] = [];
  let notes = 0;
  async function walk(relDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(path.join(vaultRoot, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (isIgnoredSegment(entry.name) || entry.isSymbolicLink()) continue;
      const relPath = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(relPath);
        paths.push(relPath);
      } else if (entry.isFile()) {
        if (isNotePath(entry.name)) notes++;
        paths.push(relPath);
      }
    }
  }
  await walk(relFolder);
  paths.push(relFolder);
  return { paths, notes };
}

/** Free name for something moved into `.trash/`: "guides", then "guides-2", …
 *  The counter goes BEFORE the extension ("draft.md", "draft-2.md") so a
 *  trashed note is still a `.md` file the operator can open, sort and restore
 *  with a `mv`; folders pass `ext = ""` and keep the old shape exactly. */
async function trashDestination(stem: string, ext = ""): Promise<string> {
  const trashAbs = path.join(vaultRoot, TRASH_DIR);
  await fs.mkdir(trashAbs, { recursive: true });
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`;
    const abs = path.join(trashAbs, candidate);
    if (!(await exists(abs))) return abs;
  }
}

/** Delete a folder, Obsidian-style: by default MOVE it to `.trash/` at the
 *  vault root (recoverable; `.trash` is ignored by the watcher, indexer and
 *  tree, so the notes simply vanish from the app). `permanent: true` removes
 *  it outright. Emits one synthetic `{kind:"deleted", dir:true}` event and
 *  suppresses the watcher's per-file echo of the same removal. */
export async function deleteFolder(
  rel: string,
  opts?: { permanent?: boolean },
): Promise<DeleteFolderResult> {
  const relPath = normalizeRel(rel);
  if (!relPath) throw new VaultError(400, "Folder path required");
  // Ignored trees (.trash, .obsidian, .git, node_modules…) are not deletable
  // through the API. A 400 on the *name* — not the 404 safeAbs uses for reads —
  // reveals nothing about what exists: the rule is static.
  if (isIgnoredRel(relPath)) throw new VaultError(400, `Invalid folder path: ${rel}`);
  const abs = safeAbs(relPath);
  let stat;
  try {
    // lstat, not stat. safeAbs() has already 404'd any link that resolves
    // outside the vault, so what reaches here is a link pointing back INSIDE
    // it — and a symlinked folder is still a LINK: the delete that
    // follows unlinks it without touching the target (fs.rename/fs.rm both
    // operate on the link itself). Counting through it would answer with the
    // size of a tree outside the vault — "1,214 notes will be erased from
    // disk" about files this call will not touch is the one number in the
    // dialog that must never lie.
    stat = await fs.lstat(abs);
  } catch {
    throw new VaultError(404, `Folder not found: ${relPath}`);
  }
  if (stat.isSymbolicLink()) {
    const linkStat = await fs.stat(abs).catch(() => null);
    if (!linkStat?.isDirectory()) throw new VaultError(400, `Not a folder: ${relPath}`);
  } else if (!stat.isDirectory()) {
    throw new VaultError(400, `Not a folder: ${relPath}`);
  }

  const { paths, notes } = stat.isSymbolicLink()
    ? { paths: [relPath], notes: 0 }
    : await collectFolder(relPath);
  // The synthetic event below is the whole story; swallow the watcher's
  // unlink/unlinkDir storm for the same removal.
  for (const p of paths) suppress(p);

  let trashPath: string | undefined;
  if (opts?.permanent) {
    await fs.rm(abs, { recursive: true, force: true });
  } else {
    const destAbs = await trashDestination(path.posix.basename(relPath));
    try {
      await fs.rename(abs, destAbs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
      await fs.cp(abs, destAbs, { recursive: true });
      await fs.rm(abs, { recursive: true, force: true });
    }
    trashPath = `${TRASH_DIR}/${path.basename(destAbs)}`;
  }
  emit({ kind: "deleted", path: relPath, dir: true });
  return trashPath ? { notes, trashPath } : { notes };
}

/** Every file under a folder, ignore rules and the symlink skip applied,
 *  notes and attachments kept apart — the shape `listVaultFiles()` returns for
 *  the whole vault, scoped to one subtree. A folder move needs it twice: to
 *  suppress the watcher's per-file echo of a move it is about to announce in
 *  one event, and to reindex exactly the subtree that moved instead of walking
 *  1,388 notes again. */
export async function listFolderFiles(
  relFolder: string,
): Promise<{ notes: string[]; attachments: string[]; dirs: string[] }> {
  const notes: string[] = [];
  const attachments: string[] = [];
  const dirs: string[] = [];
  async function walk(relDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(path.join(vaultRoot, relDir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (isIgnoredSegment(entry.name) || entry.isSymbolicLink()) continue;
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        dirs.push(relPath);
        await walk(relPath);
      } else if (entry.isFile()) {
        (isNotePath(entry.name) ? notes : attachments).push(relPath);
      }
    }
  }
  await walk(normalizeRel(relFolder));
  return { notes, attachments, dirs };
}

export interface MoveFolderResult {
  /** How many `.md` files travelled with the folder — the toast's number. */
  notes: number;
  /** Every file that moved, old path → new path, for the link rewrite. */
  moved: { from: string; to: string }[];
}

/** Move a folder (and everything under it) to a new vault-relative PATH — the
 *  same `path` → `toPath` shape `/api/rename` uses for a note, so the drop in
 *  the tree and the "Move to…" command speak one language.
 *
 *  The refusals are the feature. A drag is a gesture the hand can make by
 *  accident, so every way this could quietly destroy a vault is a 4xx before a
 *  single byte moves:
 *   - **into its own descendant** (`Ideas` → `Ideas/2026/Ideas`) is the classic
 *     recursive-move foot-gun: `fs.rename` answers EINVAL on some platforms and
 *     happily builds an unreachable loop on others. Checked on the STRING, both
 *     as written and lowercased, so a case-insensitive filesystem cannot slip
 *     past it.
 *   - **onto an existing name** is a 409, never a merge and never an overwrite.
 *     `fs.rename` over a non-empty directory fails, but over an EMPTY one it
 *     succeeds — silently swallowing the folder that was there.
 *   - **a symlinked folder** is a link, not a tree: `fs.rename` would move the
 *     link and every count and rewrite below would describe files outside the
 *     vault. Refused, exactly as `deleteFolder` refuses to count through one.
 *
 *  One `fs.rename` does the work — atomic within a filesystem, and nothing is
 *  removed from the source until the copy succeeded in the EXDEV fallback, so a
 *  failure at any point leaves the vault as it was.
 *
 *  Emits exactly ONE `{kind:"renamed", dir:true}` event and suppresses the
 *  watcher's per-file storm for the same move — the pattern the folder DELETE
 *  established, for the same reason: 715 events describing one gesture is not a
 *  description, it is noise the client has to de-duplicate. */
export async function moveFolder(rel: string, toRel: string): Promise<MoveFolderResult> {
  const fromPath = normalizeRel(rel);
  const toPath = normalizeRel(toRel);
  if (!fromPath) throw new VaultError(400, "Folder path required", "move_no_source");
  if (!toPath) throw new VaultError(400, "Destination path required", "move_no_target");
  // Static rules, so a 400 on the NAME reveals nothing about what exists. Each
  // side names ITSELF: "Invalid folder path: <source>" for a bad destination is
  // the message that sends an operator to read the wrong half of their request.
  if (isIgnoredRel(fromPath) || looksAbsolute(rel)) {
    throw new VaultError(400, `Invalid folder path: ${fromPath}`, "move_invalid");
  }
  if (isIgnoredRel(toPath) || looksAbsolute(toRel)) {
    throw new VaultError(400, `Invalid destination path: ${toPath}`, "move_invalid_target");
  }
  if (fromPath === toPath) {
    throw new VaultError(400, `Folder is already at ${toPath}`, "move_same");
  }
  const lowerFrom = fromPath.toLowerCase();
  const lowerTo = toPath.toLowerCase();
  if (lowerTo === lowerFrom || lowerTo.startsWith(`${lowerFrom}/`)) {
    throw new VaultError(400, `Cannot move ${fromPath} into itself`, "move_into_self");
  }

  const fromAbs = safeAbs(fromPath);
  const toAbs = safeAbs(toPath);
  let stat;
  try {
    stat = await fs.lstat(fromAbs);
  } catch {
    throw new VaultError(404, `Folder not found: ${fromPath}`, "move_missing");
  }
  if (stat.isSymbolicLink()) {
    throw new VaultError(400, `Not a folder: ${fromPath}`, "move_not_folder");
  }
  if (!stat.isDirectory()) {
    throw new VaultError(400, `Not a folder: ${fromPath}`, "move_not_folder");
  }
  if (await exists(toAbs)) {
    throw new VaultError(409, `Target already exists: ${toPath}`, "move_conflict");
  }

  const { notes, attachments, dirs } = await listFolderFiles(fromPath);
  const moved = [...notes, ...attachments].map((from) => ({
    from,
    to: `${toPath}${from.slice(fromPath.length)}`,
  }));

  try {
    await fs.mkdir(path.dirname(toAbs), { recursive: true });
  } catch {
    throw new VaultError(400, `Destination is not a folder: ${toPath}`, "move_bad_parent");
  }

  // The synthetic event below is the whole story; swallow the watcher's
  // add/unlink/addDir/unlinkDir storm for the same move, on both sides. The
  // SUB-DIRECTORIES matter as much as the files: without them a move of a
  // folder holding one sub-folder still leaked an `unlinkDir` + `addDir` pair
  // after the event that had already said the same thing.
  const window = Math.max(5_000, (moved.length + dirs.length) * 10);
  suppress(fromPath, window);
  suppress(toPath, window);
  for (const dir of dirs) {
    suppress(dir, window);
    suppress(`${toPath}${dir.slice(fromPath.length)}`, window);
  }
  for (const m of moved) {
    suppress(m.from, window);
    suppress(m.to, window);
  }

  try {
    await fs.rename(fromAbs, toAbs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EXDEV") {
      // The `mkdir -p` above ran for a move that did not happen; take its
      // empty directories back out before answering.
      await pruneEmptyParents(toAbs, vaultRoot);
      if (code === "ENOTEMPTY" || code === "EEXIST") {
        throw new VaultError(409, `Target already exists: ${toPath}`, "move_conflict");
      }
      throw err;
    }
    // A bind-mounted sub-tree: copy first, and only remove the source once the
    // copy is whole. A half-copy is cleaned up rather than left as a second,
    // partial folder next to the original.
    try {
      await fs.cp(fromAbs, toAbs, { recursive: true, errorOnExist: true, force: false });
    } catch (copyErr) {
      await fs.rm(toAbs, { recursive: true, force: true }).catch(() => {});
      throw copyErr;
    }
    await fs.rm(fromAbs, { recursive: true, force: true });
  }
  emit({ kind: "renamed", path: fromPath, toPath, dir: true });
  return { notes: notes.length, moved };
}

/** Does a NAME exist at `abs` — `lstat`, not `access`.
 *
 *  `fs.access` follows symlinks, so a DANGLING link sitting at the
 *  destination name answered "no" and the rename that followed replaced it
 *  without a word. The source side already refuses symlinks by `lstat`; the
 *  destination side asks the same question about the same kind of thing. */
async function exists(abs: string): Promise<boolean> {
  try {
    await fs.lstat(abs);
    return true;
  } catch {
    return false;
  }
}

/** Remove the (empty) directories a failed move created on its way to the
 *  destination, stopping at the first one that is not empty and never leaving
 *  the vault. `mkdir -p` before a `rename` that then throws used to leave the
 *  half-built path behind as a folder the reader never asked for. */
async function pruneEmptyParents(abs: string, stopAt: string): Promise<void> {
  let dir = path.dirname(abs);
  while (dir.startsWith(`${stopAt}${path.sep}`)) {
    try {
      await fs.rmdir(dir); // fails with ENOTEMPTY, which is the stop condition
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/** True when `rel` was WRITTEN as an absolute path (POSIX or Windows).
 *
 *  `normalizeRel` strips the leading slash, so `toPath:"/tmp/escaped"` used to
 *  answer 200 and invent a top-level `tmp/` folder inside the vault. Nothing
 *  escaped — but a request that reads as "put this at /tmp" and succeeds by
 *  meaning something else is a success nobody asked for. */
export function looksAbsolute(rel: string): boolean {
  return /^[/\\]/.test(rel) || /^[a-zA-Z]:[/\\]/.test(rel);
}

// ------------------------------------------------------------------- watcher

type EventListener = (event: VaultEvent) => void;

const listeners = new Set<EventListener>();
const pending = new Map<string, { kind: VaultEvent["kind"]; timer: NodeJS.Timeout }>();
const suppressed = new Map<string, number>();
let watcher: FSWatcher | null = null;

export function onEvent(listener: EventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Broadcast a synthetic event (e.g. after a publish toggle) to all listeners
 *  without waiting for the watcher debounce. */
export function emitEvent(event: VaultEvent): void {
  emit(event);
}

function emit(event: VaultEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error("vault event listener failed:", err);
    }
  }
}

/** Ignore imminent watcher noise for a path we mutate deliberately (renames).
 *
 *  `ms` is the window. One second is plenty for a single file, and far too
 *  little for a folder MOVE: chokidar re-walks the arriving subtree, so a
 *  715-note folder produces ~1,500 add/addDir events that trickle in for
 *  several seconds — every one of them after the window closed, i.e. exactly
 *  the storm the single synthetic event exists to replace. Callers moving a
 *  tree scale the window to its size. */
function suppress(relPath: string, ms = 1000): void {
  suppressed.set(relPath, Date.now() + ms);
}

/** Public wrapper: a route that writes a file AND emits its own synthetic
 *  event (publish toggle) calls this first, so listeners don't receive the
 *  watcher's redundant echo of the same write a debounce later. */
export function suppressWatcherEcho(relPath: string): void {
  suppress(normalizeRel(relPath));
}

function isSuppressed(relPath: string): boolean {
  const until = suppressed.get(relPath);
  if (until === undefined) return false;
  if (Date.now() > until) {
    suppressed.delete(relPath);
    return false;
  }
  return true;
}

function queueEvent(kind: VaultEvent["kind"], relPath: string, dir?: boolean): void {
  if (isSuppressed(relPath)) return;
  const prev = pending.get(relPath);
  if (prev) {
    clearTimeout(prev.timer);
    if (prev.kind === "created" && kind === "changed") kind = "created";
  }
  const timer = setTimeout(() => {
    pending.delete(relPath);
    emit(dir ? { kind, path: relPath, dir: true } : { kind, path: relPath });
  }, 100);
  pending.set(relPath, { kind, timer });
}

export function startWatcher(): void {
  if (watcher) return;
  watcher = watch(vaultRoot, {
    ignoreInitial: true,
    // The THIRD way a symlink got in. chokidar follows links by default, so a
    // `ln -s /etc evil` in the vault made it descend into /etc — verified: the
    // log filled with `EACCES: permission denied, watch '…/evil/gshadow'` —
    // and every readable file under the target arrived as a `created` event,
    // which registers it as an attachment and hands it to the publish
    // allowlist. The tree and index walks skip links; the watcher must agree,
    // or the two disagree about what the vault contains.
    followSymlinks: false,
    ignored: (p) => {
      if (p === vaultRoot) return false;
      const rel = path.relative(vaultRoot, p);
      if (!rel || rel.startsWith("..")) return true;
      return rel.split(path.sep).some(isIgnoredSegment);
    },
  });
  watcher.on("all", (event, absPath) => {
    const relPath = path.relative(vaultRoot, absPath).split(path.sep).join("/");
    if (!relPath || relPath.startsWith("..") || isIgnoredRel(relPath)) return;
    switch (event) {
      case "add":
        queueEvent("created", relPath);
        break;
      case "change":
        queueEvent("changed", relPath);
        break;
      case "unlink":
        queueEvent("deleted", relPath);
        break;
      case "addDir":
        queueEvent("created", relPath, true);
        break;
      case "unlinkDir":
        queueEvent("deleted", relPath, true);
        break;
    }
  });
  watcher.on("error", (err) => console.error("vault watcher error:", err));
}
