// Vault: filesystem layer. Root resolution, safe paths, CRUD on notes/folders,
// and a chokidar watcher that broadcasts debounced VaultEvents.

import { promises as fs } from "node:fs";
import path from "node:path";
import { watch, type FSWatcher } from "chokidar";
import type { NoteData, TreeNode, VaultEvent } from "../shared/types.ts";

export class VaultError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "VaultError";
    this.status = status;
  }
}

let vaultRoot = "";

export function initVault(root: string): void {
  vaultRoot = path.resolve(root);
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

/** Map a client-supplied relative path to an absolute path strictly inside the vault.
 *  Traversal (`..` as a whole segment — "Jr..md" is a legal name) is a 400;
 *  ignored paths (.obsidian, .trash, dotfiles…) are a 404 so their existence
 *  is never revealed and they can be neither read nor written through any API. */
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
  return abs;
}

export function assertMarkdown(rel: string): string {
  const normalized = normalizeRel(rel);
  if (!normalized || !normalized.toLowerCase().endsWith(".md")) {
    throw new VaultError(400, `Not a markdown path: ${rel}`);
  }
  return normalized;
}

// Names never listed, indexed, watched, or served: dotfiles (covers .obsidian,
// .git) plus a few well-known junk dirs that may not be dot-prefixed everywhere.
const IGNORED_NAMES = new Set([".obsidian", ".git", ".trash", "node_modules"]);

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
    for (const entry of entries) {
      if (isIgnoredSegment(entry.name)) continue;
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        nodes.push({ name: entry.name, path: relPath, type: "folder", children: await walk(relPath) });
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        nodes.push({ name: entry.name, path: relPath, type: "file" });
      }
    }
    nodes.sort((a, b) =>
      a.type !== b.type
        ? a.type === "folder" ? -1 : 1
        : a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    return nodes;
  }
  return { name: path.basename(vaultRoot), path: "", type: "folder", children: await walk("") };
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
      if (isIgnoredSegment(entry.name)) continue;
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) await walk(relPath);
      else if (entry.isFile()) {
        (entry.name.toLowerCase().endsWith(".md") ? notes : attachments).push(relPath);
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
  if (relPath.toLowerCase().endsWith(".md")) {
    throw new VaultError(400, "Markdown is served via /api/note");
  }
  const abs = safeAbs(relPath);
  if (isIgnoredRel(relPath)) throw new VaultError(404, `File not found: ${relPath}`);
  try {
    const stat = await fs.stat(abs);
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

export async function deleteNote(rel: string): Promise<void> {
  const relPath = assertMarkdown(rel);
  const abs = safeAbs(relPath);
  if (!(await exists(abs))) throw new VaultError(404, `Note not found: ${relPath}`);
  await fs.rm(abs);
}

export async function createFolder(rel: string): Promise<void> {
  const relPath = normalizeRel(rel);
  if (!relPath) throw new VaultError(400, "Folder path required");
  await fs.mkdir(safeAbs(relPath), { recursive: true });
}

async function exists(abs: string): Promise<boolean> {
  try {
    await fs.access(abs);
    return true;
  } catch {
    return false;
  }
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

function emit(event: VaultEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error("vault event listener failed:", err);
    }
  }
}

/** Ignore imminent watcher noise for a path we mutate deliberately (renames). */
function suppress(relPath: string): void {
  suppressed.set(relPath, Date.now() + 1000);
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
