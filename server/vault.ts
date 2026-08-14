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

/** Map a client-supplied relative path to an absolute path strictly inside the vault. */
export function safeAbs(rel: string): string {
  const normalized = normalizeRel(rel);
  if (normalized.includes("..") || path.isAbsolute(normalized) || normalized.includes("\0")) {
    throw new VaultError(400, `Invalid path: ${rel}`);
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

function isHidden(name: string): boolean {
  return name.startsWith(".");
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
      if (isHidden(entry.name)) continue;
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

export async function listMarkdownFiles(): Promise<string[]> {
  const files: string[] = [];
  const collect = (nodes: TreeNode[]): void => {
    for (const node of nodes) {
      if (node.type === "file") files.push(node.path);
      else if (node.children) collect(node.children);
    }
  };
  collect((await buildTree()).children ?? []);
  return files;
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

function queueEvent(kind: VaultEvent["kind"], relPath: string): void {
  if (isSuppressed(relPath)) return;
  const prev = pending.get(relPath);
  if (prev) {
    clearTimeout(prev.timer);
    if (prev.kind === "created" && kind === "changed") kind = "created";
  }
  const timer = setTimeout(() => {
    pending.delete(relPath);
    emit({ kind, path: relPath });
  }, 100);
  pending.set(relPath, { kind, timer });
}

export function startWatcher(): void {
  if (watcher) return;
  watcher = watch(vaultRoot, {
    ignoreInitial: true,
    ignored: (p) => p !== vaultRoot && isHidden(path.basename(p)),
  });
  watcher.on("all", (event, absPath) => {
    const relPath = path.relative(vaultRoot, absPath).split(path.sep).join("/");
    if (!relPath || relPath.startsWith("..")) return;
    const isMarkdown = relPath.toLowerCase().endsWith(".md");
    switch (event) {
      case "add":
        if (isMarkdown) queueEvent("created", relPath);
        break;
      case "change":
        if (isMarkdown) queueEvent("changed", relPath);
        break;
      case "unlink":
        if (isMarkdown) queueEvent("deleted", relPath);
        break;
      case "addDir":
        queueEvent("created", relPath);
        break;
      case "unlinkDir":
        queueEvent("deleted", relPath);
        break;
    }
  });
  watcher.on("error", (err) => console.error("vault watcher error:", err));
}
