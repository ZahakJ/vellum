// Vault: filesystem layer. Root resolution, safe paths, CRUD on notes/folders,
// and a chokidar watcher that broadcasts debounced VaultEvents.

import { promises as fs, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type {
  AttachmentInfo,
  AttachmentKind,
  NoteData,
  TrashEntry,
  TreeNode,
  VaultEvent,
} from "../shared/types.ts";
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
export async function listVaultFiles(
  relRoot = "",
): Promise<{ notes: string[]; attachments: string[] }> {
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
  // `relRoot` scopes the walk to one subtree — what a folder restored out of
  // `.trash/` needs so the index catches up before the response returns,
  // rather than after the watcher's debounce. "" is the whole vault, which is
  // what boot passes.
  await walk(normalizeRel(relRoot));
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

/** fsync the DIRECTORY, so the rename that published the file is itself on the
 *  disk. Without it a crash can lose the rename while keeping the bytes, which
 *  is the same lost save by a longer road. Best-effort on purpose: opening a
 *  directory for reading is a POSIX affordance, and Windows refuses it — a
 *  platform that cannot promise this must still be able to save a note. */
async function syncDir(dir: string): Promise<void> {
  try {
    const handle = await fs.open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    /* not fatal: the bytes are already fsynced and the rename already ran */
  }
}

/** Write a file the way a vault deserves: into a temp file beside it, then
 *  `rename` over the target. A crash, a full disk or a `kill -9` mid-save then
 *  leaves either the old note or the new one — never the empty file a bare
 *  `writeFile` produces.
 *
 *  That empty file was not hypothetical. `fs.writeFile` opens with `O_TRUNC`:
 *  the note is zero bytes from that call until the last byte lands, and every
 *  mutating path in this product comes through here — the 600ms autosave in
 *  `client/components/Editor.tsx` most of all, plus `createNote`, the publish
 *  toggle, the frontmatter routes and the rename link-rewrite. The window is
 *  small and it is opened hundreds of times an hour, on files whose whole
 *  promise is that they are safe to keep for ten years.
 *
 *  Four details are load-bearing, and each one is a bug that a naive
 *  write-then-rename would have introduced:
 *
 *  - **Same directory.** `rename` is only atomic within one filesystem, and a
 *    vault subfolder can be a mount point. The temp file is always a sibling
 *    of its target, never in `/tmp`.
 *  - **Dot-prefixed.** `isIgnoredName` skips every name starting with "." for
 *    the tree walk, the indexer and the chokidar watcher alike, so a save never
 *    flickers a ghost note through the sidebar or the search index.
 *  - **The target is realpath'd first.** `safeAbs` returns a LEXICAL path and
 *    `fs.writeFile` follows a symlink; renaming over the link itself would
 *    replace it with a regular file and silently break a vault that keeps a
 *    note as a link to somewhere else inside the vault. Containment was already
 *    proven by `safeAbs` → `resolvesInsideVault`, so following it here widens
 *    nothing.
 *  - **The mode is carried across.** `writeFile` on an existing file leaves its
 *    permissions alone; a rename hands over the temp file's. Without the chmod
 *    a note the owner had set to 0600 would quietly widen to whatever the umask
 *    says the next time they typed in it.
 *
 *  Returns the published file's mtime, which is what `NoteData` carries and
 *  what a future write precondition will compare against. */
/** Serial number for temp names. The pid alone is NOT unique enough: two
 *  concurrent writes to ONE note inside this one process — the autosave timer
 *  firing while an explicit Ctrl+S is in flight — would share a temp path, and
 *  the interleaving (A opens, B opens and truncates, A renames B's half-written
 *  bytes over the note) splices the two writes into a file that is neither.
 *  The very corruption the atomic dance exists to prevent, reintroduced by its
 *  own scratch file. */
let tmpSeq = 0;

async function writeFileAtomic(abs: string, content: string): Promise<number> {
  let target = abs;
  try {
    target = await fs.realpath(abs);
  } catch {
    /* absent: a new file at the lexical path is exactly right */
  }
  const dir = path.dirname(target);
  tmpSeq += 1;
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.${tmpSeq}.tmp`);
  let mode: number | undefined;
  try {
    mode = (await fs.stat(target)).mode & 0o777;
  } catch {
    /* new file: let the umask decide, exactly as writeFile would have */
  }
  try {
    const handle = await fs.open(tmp, "w");
    try {
      await handle.writeFile(content, "utf8");
      // The bytes reach the disk BEFORE the rename publishes them. A rename
      // over unsynced content is durable metadata pointing at nothing.
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (mode !== undefined) await fs.chmod(tmp, mode);
    await fs.rename(tmp, target);
  } catch (err) {
    // Never leave the temp file behind: it is invisible to the app by design,
    // so nothing else would ever clean it up.
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  await syncDir(dir);
  return (await fs.stat(target)).mtimeMs;
}

/** Write a note.
 *
 *  `baseMtimeMs` is the OPTIONAL write precondition: the mtime the caller was
 *  last handed for this file. When given and the file's current mtime differs,
 *  the write is refused with `409 stale` and nothing is touched.
 *
 *  `NoteData` has carried `mtimeMs` since the beginning and no writer had ever
 *  read it back, so saving was unconditional last-write-wins. That was fine
 *  while exactly one editor existed; it stops being fine the moment a second
 *  pane, a second window, Obsidian or a `git pull` can reach the same file,
 *  because the loser's paragraphs went with nothing said — and `.trash/`
 *  catches deletes, not overwrites.
 *
 *  Checked HERE rather than in the route so the gap between reading the mtime
 *  and replacing the file is as small as this process can make it, and so it is
 *  testable without standing a server up.
 *
 *  STRICT equality: the value compared against is one this server produced from
 *  its own `stat`, so a tolerance would only serve to accept a real conflict on
 *  filesystems whose mtime granularity is coarse — which is the wrong direction
 *  to fail. It remains a net rather than a lock: two writes inside one tick of
 *  a coarse clock are genuinely indistinguishable, and the contract says so. */
export async function writeNote(
  rel: string,
  content: string,
  baseMtimeMs?: number,
): Promise<NoteData> {
  const relPath = assertMarkdown(rel);
  const abs = safeAbs(relPath);
  if (baseMtimeMs !== undefined) {
    let current: number | null = null;
    try {
      current = (await fs.stat(abs)).mtimeMs;
    } catch {
      // Gone since the caller read it. Writing recreates it, which is kinder
      // than refusing to save work into a file somebody else deleted — and the
      // caller hears about the deletion from the watcher either way.
    }
    if (current !== null && current !== baseMtimeMs) {
      throw new VaultError(409, `Note changed on disk: ${relPath}`, "stale");
    }
  }
  await fs.mkdir(path.dirname(abs), { recursive: true });
  return { path: relPath, content, mtimeMs: await writeFileAtomic(abs, content) };
}

/** True when `rel` names an existing note file. Callers that emit their own
 *  synthetic event for a write need it to say "created" or "changed". */
export async function noteExists(rel: string): Promise<boolean> {
  return exists(safeAbs(assertMarkdown(rel)));
}

/** The mtime of one note, or null when it is not there.
 *
 *  `readNote` is the wrong tool for the question "is the copy I am holding
 *  still the file?": it ships the body back, and the caller asking already has
 *  a body. Revalidation asks this about every open tab at once, on every wake,
 *  so it must cost a `stat` and not a read. */
export async function noteMtime(rel: string): Promise<number | null> {
  const abs = safeAbs(assertMarkdown(rel));
  try {
    return (await fs.stat(abs)).mtimeMs;
  } catch {
    return null;
  }
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
    // Where it came from, so the trash browser can put it back rather than
    // dumping it at the vault root. Never throws into the delete.
    await recordTrashed(path.basename(destAbs), relPath, "note");
  }
  emit({ kind: "deleted", path: relPath });
  return trashPath ? { trashPath } : {};
}

/** Everything that is NOT a note: the images, PDFs and recordings the tree
 *  lists under a folder's writing. Rejects markdown so the two verbs stay
 *  distinct (a note has backlinks and a publish flag; an attachment has
 *  embedders), and rejects the empty path so nothing can aim this at a
 *  folder. */
export function assertAttachment(rel: string): string {
  const normalized = normalizeRel(rel);
  if (!normalized) throw new VaultError(400, "File path required");
  if (isNotePath(normalized)) {
    throw new VaultError(400, `Not an attachment path: ${rel}`);
  }
  return normalized;
}

/** Delete ONE attachment, at the same two speeds as a note and a folder.
 *
 *  There used to be no way to delete one at all: the tree listed a vault's
 *  1,176 images and offered no verb on any of them, so the only route to
 *  removing a stale upload was deleting the folder around it — which is the
 *  gesture that lost the owner an essay. The safety here is the same as
 *  everywhere else, and so is the honesty: the caller is expected to have
 *  asked `deletePreview()` first, because an attachment a published note
 *  embeds is the one file in a vault whose removal is visible to strangers.
 *
 *  `lstat` + `isFile()`, not `stat`: a symlink is not an attachment, and the
 *  rename below would move the LINK while the dialog described the target. */
export async function deleteAttachment(
  rel: string,
  opts?: { permanent?: boolean },
): Promise<DeleteNoteResult> {
  const relPath = assertAttachment(rel);
  const abs = safeAbs(relPath);
  let stat;
  try {
    stat = await fs.lstat(abs);
  } catch {
    throw new VaultError(404, `File not found: ${relPath}`);
  }
  if (!stat.isFile()) throw new VaultError(404, `File not found: ${relPath}`);
  // One synthetic event tells the whole story and lands before the response;
  // the watcher's own debounced unlink for the same removal is swallowed.
  suppress(relPath);
  if (opts?.permanent) {
    await fs.rm(abs);
    emit({ kind: "deleted", path: relPath });
    return {};
  }
  const base = path.posix.basename(relPath);
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  const destAbs = await trashDestination(stem, ext);
  try {
    await fs.rename(abs, destAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fs.cp(abs, destAbs);
    await fs.rm(abs);
  }
  await recordTrashed(path.basename(destAbs), relPath, "attachment");
  emit({ kind: "deleted", path: relPath });
  return { trashPath: `${TRASH_DIR}/${path.basename(destAbs)}` };
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
    await recordTrashed(path.basename(destAbs), relPath, "folder");
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

// ------------------------------------------------------------------- trash
//
// Every delete dialog in this product promises the same thing — "recoverable
// from disk" — and until this section existed the product itself could not
// keep it: `.trash/` is a dot-dir, invisible to the tree, the indexer and the
// watcher by design, so the only way to act on the promise was a terminal and
// a `mv`. An owner who deleted the wrong folder had to be told to go and use
// the filesystem. The bin is now a surface: list it, restore from it, empty
// it.
//
// It stays flat at its top level (one entry per delete) and it stays ignored
// everywhere else, so nothing here changes what the rest of the app can see.

/** Where a trashed thing came from, so restore is a restore rather than a
 *  dump at the vault root. Lives INSIDE `.trash/`, which `.gitignore` already
 *  covers (gitSync.ts) — it is local bookkeeping and must never reach a
 *  remote. Dot-prefixed, so `trashEntryAbs()` refuses to treat it as an entry
 *  and `listTrash()` never lists it. */
const TRASH_MANIFEST = ".vellum-trash.json";

interface TrashRecord {
  origin: string;
  deletedMs: number;
  kind: "folder" | "note" | "attachment";
}

/** Manifest writes are serialized on this chain: two deletes landing in the
 *  same tick would otherwise read the same file, and the second write would
 *  drop the first entry — losing the origin of a folder somebody is about to
 *  need back. */
let manifestChain: Promise<void> = Promise.resolve();

async function readManifest(): Promise<Record<string, TrashRecord>> {
  try {
    const raw = await fs.readFile(path.join(vaultRoot, TRASH_DIR, TRASH_MANIFEST), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const entries = (parsed as { entries?: unknown }).entries;
    return entries && typeof entries === "object" ? (entries as Record<string, TrashRecord>) : {};
  } catch {
    // Absent, unreadable or corrupt: the trash still WORKS without it. Every
    // entry simply reports origin null and restores to the vault root, which
    // is exactly the pre-manifest behaviour and is stated in the dialog.
    return {};
  }
}

async function writeManifest(entries: Record<string, TrashRecord>): Promise<void> {
  const dir = path.join(vaultRoot, TRASH_DIR);
  await fs.mkdir(dir, { recursive: true });
  // Same treatment as a note, for a smaller but identical reason: a torn
  // manifest is how a restore forgets where an entry came from. The reader
  // above already degrades gracefully on a corrupt file, which is exactly the
  // outcome this stops the writer from causing.
  await writeFileAtomic(
    path.join(dir, TRASH_MANIFEST),
    `${JSON.stringify({ version: 1, entries }, null, 2)}\n`,
  );
}

/** Note where a just-trashed entry came from. Never throws into the delete:
 *  losing the manifest must not lose the file, so a failed write degrades the
 *  entry to "origin unknown" and is logged, not raised. */
function recordTrashed(
  name: string,
  origin: string,
  kind: TrashRecord["kind"],
): Promise<void> {
  manifestChain = manifestChain.then(async () => {
    const entries = await readManifest();
    entries[name] = { origin, deletedMs: Date.now(), kind };
    await writeManifest(entries);
  }).catch((err: unknown) => {
    console.warn("vellum: could not record trash origin —", err);
  });
  return manifestChain;
}

function forgetTrashed(name: string): Promise<void> {
  manifestChain = manifestChain.then(async () => {
    const entries = await readManifest();
    if (!(name in entries)) return;
    delete entries[name];
    await writeManifest(entries);
  }).catch((err: unknown) => {
    console.warn("vellum: could not update trash manifest —", err);
  });
  return manifestChain;
}

/** A trash entry's absolute path. The name is an ID, not a path: separators,
 *  `..`, NULs and dot-prefixes are all refused up front (a real vault entry
 *  can never start with a dot — `isIgnoredSegment` keeps those out of the
 *  vault in the first place — so the rule costs nothing and it is what keeps
 *  the manifest itself from being restorable or purgeable through the API).
 *  Containment is then re-checked against the resolved string, and the caller
 *  lstats: a symlink inside the trash is not an entry. */
function trashEntryAbs(name: string): string {
  const clean = name.trim();
  if (
    !clean ||
    clean.startsWith(".") ||
    clean.includes("/") ||
    clean.includes("\\") ||
    clean.includes("\0")
  ) {
    throw new VaultError(400, `Invalid trash entry: ${name}`);
  }
  const trashRoot = path.join(vaultRoot, TRASH_DIR);
  const abs = path.resolve(trashRoot, clean);
  if (!abs.startsWith(trashRoot + path.sep)) {
    throw new VaultError(400, `Invalid trash entry: ${name}`);
  }
  return abs;
}

/** Recursive tally of one trash entry: markdown, everything else, and bytes.
 *  Bounded — a bin holding a 1,176-image folder must not cost an unbounded
 *  walk on every open of the browser — and symlinks are counted as nothing,
 *  never followed. */
const TRASH_WALK_MAX = 20_000;

async function tallyTrash(abs: string): Promise<{ notes: number; attachments: number; bytes: number }> {
  let notes = 0;
  let attachments = 0;
  let bytes = 0;
  let seen = 0;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (seen++ > TRASH_WALK_MAX) return;
      if (entry.isSymbolicLink()) continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (entry.isFile()) {
        if (isNotePath(entry.name)) notes++;
        else attachments++;
        bytes += await fs.stat(child).then((s) => s.size, () => 0);
      }
    }
  }
  // Vanished between the listing's own lstat and this one: report nothing
  // rather than throwing, or one racing entry takes the whole browser down.
  const stat = await fs.lstat(abs).catch(() => null);
  if (stat === null) return { notes: 0, attachments: 0, bytes: 0 };
  if (stat.isDirectory()) await walk(abs);
  else if (isNotePath(abs)) {
    notes = 1;
    bytes = stat.size;
  } else {
    attachments = 1;
    bytes = stat.size;
  }
  return { notes, attachments, bytes };
}

/** Paths inside a trash folder, relative to it — what a restore is about to
 *  drop into the vault, and therefore what the watcher must be told to keep
 *  quiet about. Bounded by the same walk cap the tally uses; symlinks are
 *  skipped, as everywhere else. */
async function trashChildren(abs: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length > TRASH_WALK_MAX || entry.isSymbolicLink()) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      out.push(rel);
      if (entry.isDirectory()) await walk(path.join(dir, entry.name), rel);
    }
  }
  await walk(abs, "");
  return out;
}

/** Everything currently in `.trash/`, newest first. */
export async function listTrash(): Promise<TrashEntry[]> {
  const trashRoot = path.join(vaultRoot, TRASH_DIR);
  let names;
  try {
    names = await fs.readdir(trashRoot, { withFileTypes: true });
  } catch {
    return []; // no trash directory yet: an empty bin, not an error
  }
  const manifest = await readManifest();
  const out: TrashEntry[] = [];
  for (const entry of names) {
    // Dotfiles (the manifest) and symlinks are not entries.
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const abs = path.join(trashRoot, entry.name);
    let stat;
    try {
      stat = await fs.lstat(abs);
    } catch {
      continue; // vanished mid-listing
    }
    const record = manifest[entry.name];
    const kind: TrashEntry["kind"] = stat.isDirectory()
      ? "folder"
      : isNotePath(entry.name)
        ? "note"
        : "attachment";
    const { notes, attachments, bytes } = await tallyTrash(abs);
    const origin = record?.origin ?? null;
    out.push({
      name: entry.name,
      origin,
      kind,
      deletedMs: record?.deletedMs ?? stat.mtimeMs,
      notes,
      attachments,
      bytes,
      originTaken: origin ? await originOccupied(origin) : false,
    });
  }
  return out.sort((a, b) => b.deletedMs - a.deletedMs || a.name.localeCompare(b.name));
}

/** True when something already sits at a recorded origin — a note recreated
 *  under the old name, a folder rebuilt. The browser says so BEFORE the
 *  restore, because "restored" landing beside the file it was supposed to be
 *  is the kind of surprise this whole section exists to avoid. */
async function originOccupied(origin: string): Promise<boolean> {
  try {
    return await exists(safeAbs(origin));
  } catch {
    return false; // an origin the path rules refuse is handled at restore time
  }
}

export interface RestoreResult {
  /** Where it actually landed — which is NOT always the origin: a taken
   *  origin gets the same counter the trash itself uses, and an entry with no
   *  recorded origin lands at the vault root. */
  path: string;
  /** True when the origin was taken (or unknown) and the name had to move. */
  renamed: boolean;
  /** Folder restores need a subtree reindex; the caller does that. */
  dir: boolean;
}

/** Move one entry out of `.trash/` and back into the vault — at its recorded
 *  origin when that is still free, beside it under a counter when it is not,
 *  and at the vault root for an entry no manifest covers (trashed by hand, or
 *  by a build older than the manifest).
 *
 *  The restore is deliberately NOT silent about which of those three happened:
 *  it answers with the path it used and whether that differs from the ask, and
 *  the client says so in the toast. */
export async function restoreFromTrash(name: string): Promise<RestoreResult> {
  const abs = trashEntryAbs(name);
  let stat;
  try {
    stat = await fs.lstat(abs);
  } catch {
    throw new VaultError(404, `Trash entry not found: ${name}`);
  }
  if (stat.isSymbolicLink()) throw new VaultError(400, `Invalid trash entry: ${name}`);
  const manifest = await readManifest();
  const recorded = manifest[name]?.origin;
  // An origin that no longer passes the path rules (it named an ignored tree,
  // or the vault moved under it) is treated as no origin at all.
  let target = "";
  if (recorded) {
    try {
      safeAbs(recorded);
      target = normalizeRel(recorded);
    } catch {
      target = "";
    }
  }
  if (!target) target = name;
  const wanted = target;
  const dir = path.posix.dirname(target) === "." ? "" : path.posix.dirname(target);
  const base = path.posix.basename(target);
  const dot = stat.isDirectory() ? -1 : base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext = dot > 0 ? base.slice(dot) : "";
  let rel = "";
  let destAbs = "";
  for (let n = 1; n <= 500; n++) {
    const candidate = normalizeRel(
      `${dir ? `${dir}/` : ""}${n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`}`,
    );
    const candidateAbs = safeAbs(candidate);
    if (!(await exists(candidateAbs))) {
      rel = candidate;
      destAbs = candidateAbs;
      break;
    }
  }
  if (!rel) throw new VaultError(409, `No free name to restore ${name} into`);
  // Swallow the watcher's per-file `add` storm for this move: the route emits
  // ONE synthetic event and reindexes the subtree itself, exactly as
  // deleteFolder() does on the way out. Without this, restoring a 1,214-note
  // folder fans 1,214 debounced events onto every open SSE stream to say
  // something the single created event already said.
  suppress(rel);
  if (stat.isDirectory()) {
    for (const child of await trashChildren(abs)) suppress(`${rel}/${child}`);
  }
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  try {
    await fs.rename(abs, destAbs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    await fs.cp(abs, destAbs, { recursive: true });
    await fs.rm(abs, { recursive: true, force: true });
  }
  await forgetTrashed(name);
  return { path: rel, renamed: rel !== wanted, dir: stat.isDirectory() };
}

/** Erase one entry from `.trash/` for good — the bin's own permanent delete,
 *  and the only delete in the product with nothing behind it. */
export async function purgeFromTrash(name: string): Promise<void> {
  const abs = trashEntryAbs(name);
  try {
    await fs.lstat(abs);
  } catch {
    throw new VaultError(404, `Trash entry not found: ${name}`);
  }
  await fs.rm(abs, { recursive: true, force: true });
  await forgetTrashed(name);
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
