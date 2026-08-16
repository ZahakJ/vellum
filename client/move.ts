// Moving things around the vault: the one place that knows what a move MEANS,
// wherever the gesture came from.
//
// Three surfaces call in here and none of them owns a rule: a drag in the tree,
// "Move to…" in the row menu, and "Move to…" in the command palette. That is
// deliberate — a drag is mouse-only and touch-hostile, so the keyboard route
// must not be a second implementation that drifts. Everything below (the
// validity rule, the conflict dialog, the tab remap, the toast, the undo) runs
// identically for all three.
//
// The API split is the server's, not the reader's: a NOTE moves through
// /api/rename (a move IS a rename to another folder) and a FOLDER through
// /api/folder/move. `apply()` is the only function that knows which.

import * as api from "./api.ts";
import { ApiError } from "./api.ts";
import { promptModal, type PromptCheck } from "./components/Confirm.tsx";
import { countPhrase, t, tf } from "./i18n.ts";
import { useStore } from "./state.ts";
import { toast } from "./toast.ts";
import { actionToast } from "./undoToast.ts";
import { noteLabelOf } from "../shared/noteFormat.ts";
import type { TreeNode } from "../shared/types.ts";

/** What is being moved. `name` is the basename as it sits on disk (a note keeps
 *  its `.md`; the tree LABEL drops it, which is why this is not the label). */
export interface MoveItem {
  path: string;
  name: string;
  isFolder: boolean;
}

export function itemOf(node: TreeNode): MoveItem {
  return { path: node.path, name: node.name, isFolder: node.type === "folder" };
}

/** How an item is NAMED to the reader — the tree's own label, not the disk's.
 *
 *  The tree drops `.md` (noteLabelOf); the gesture that STARTS on a tree row
 *  did not, so the drag ghost read "Welcome.md" while the row it had just left
 *  read "Welcome", and the same disk name went on to the Move-to dialog and
 *  the error toasts. One label rule, every surface — `name` stays the byte the
 *  API is called with. */
export function itemLabel(item: MoveItem): string {
  return item.isFolder ? item.name : noteLabelOf(item.name);
}

export function parentDir(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** How a destination is NAMED to the reader. The vault root has no path, and
 *  printing "" in a sentence about where a file went says nothing at all. */
export function folderLabel(dir: string): string {
  return dir === "" ? t("moveVaultRoot") : dir;
}

/** The item's own extension (".md", ".png", ""), so the conflict dialog can put
 *  it back when the reader types a bare name. Deliberately derived from the
 *  file rather than from a list of known note formats: this has to keep working
 *  for `.tex` notes and for every attachment kind at once. */
function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

// ---------------------------------------------------------------- tree lookup

/** The node at `path` in the loaded tree ("" is the root node itself). */
export function nodeAt(tree: TreeNode | null, path: string): TreeNode | null {
  if (!tree) return null;
  if (path === "") return tree;
  let current: TreeNode | null = tree;
  for (const segment of path.split("/")) {
    const next: TreeNode | undefined = (current?.children ?? []).find((c) => c.name === segment);
    if (!next) return null;
    current = next;
  }
  return current;
}

/** True when `dir` already holds something called `name`. Case-INSENSITIVE:
 *  macOS and Windows would let `Notes.md` land on `notes.md` and the loser
 *  would be gone, so the dialog asks on both. */
function nameTaken(tree: TreeNode | null, dir: string, name: string): boolean {
  const folder = nodeAt(tree, dir);
  if (!folder || folder.type !== "folder") return false;
  const key = name.toLowerCase();
  return (folder.children ?? []).some((child) => child.name.toLowerCase() === key);
}

/** Every folder in the vault, depth-first, root first — the "Move to…" list. */
export function allFolders(tree: TreeNode | null): string[] {
  const out: string[] = [];
  if (!tree) return out;
  const walk = (node: TreeNode): void => {
    for (const child of node.children ?? []) {
      if (child.type !== "folder") continue;
      out.push(child.path);
      walk(child);
    }
  };
  walk(tree);
  return out;
}

// --------------------------------------------------------------- the rule

/** Can `item` land in `dir`? The same predicate paints the drop target and
 *  filters the picker, so what the tree highlights and what the list offers can
 *  never disagree.
 *
 *  Three refusals, and the third is the one that eats vaults: a folder dropped
 *  into its own descendant. The server refuses it too — this is the copy that
 *  makes the refusal VISIBLE, on the row, before the mouse button comes up. */
export function canDrop(item: MoveItem | null, dir: string): boolean {
  if (!item) return false;
  if (dir === parentDir(item.path)) return false; // already there
  if (!item.isFolder) return true;
  return dir !== item.path && !dir.startsWith(`${item.path}/`);
}

// ------------------------------------------------------------- drag state
//
// Module-level, not React state. A drag crosses hundreds of rows and the tree
// renders 1.4k of them; putting the dragged item in state would re-render the
// whole tree on dragstart and again on dragend, twice per gesture, for
// information only the handlers need. The rows read this synchronously.

let dragged: MoveItem | null = null;

export function beginDrag(item: MoveItem): void {
  dragged = item;
}

export function endDrag(): void {
  dragged = null;
  stopAutoScroll();
}

export function draggedItem(): MoveItem | null {
  return dragged;
}

/** The floating label under the cursor while dragging: the item's own name, in
 *  its own direction. Browsers snapshot the element at `setDragImage` time, so
 *  it has to be in the document and painted — it is parked off-screen and
 *  removed on the next frame. */
export function makeDragGhost(item: MoveItem): HTMLElement {
  const ghost = document.createElement("div");
  ghost.className = `s-dragghost${item.isFolder ? " s-dragghost--folder" : ""}`;
  ghost.setAttribute("dir", "auto");
  ghost.textContent = itemLabel(item);
  document.body.appendChild(ghost);
  requestAnimationFrame(() => ghost.remove());
  return ghost;
}

// ------------------------------------------------------------- auto-scroll
//
// The owner's vault is 1,375 notes. Without this, dragging from the bottom of
// the tree to a folder at the top is "drop it somewhere, scroll, drag again" —
// the pointer cannot leave the viewport and HTML5 drag suppresses wheel scroll
// in some browsers. Speed ramps with how deep into the edge band the pointer
// is, so a slow approach creeps and a hard push races.

const SCROLL_BAND = 56; // px from each edge where auto-scroll starts
const SCROLL_MAX = 22; // px per frame at the very edge

let scrollFrame = 0;
let scrollVelocity = 0;
let scrollTarget: HTMLElement | null = null;

function scrollStep(): void {
  scrollFrame = 0;
  if (!scrollTarget || scrollVelocity === 0) return;
  scrollTarget.scrollTop += scrollVelocity;
  scrollFrame = requestAnimationFrame(scrollStep);
}

/** Called from `dragover` anywhere in the tree. `clientY` is the pointer. */
export function autoScroll(container: HTMLElement, clientY: number): void {
  const box = container.getBoundingClientRect();
  const above = clientY - box.top;
  const below = box.bottom - clientY;
  let velocity = 0;
  if (above < SCROLL_BAND) velocity = -Math.ceil(((SCROLL_BAND - above) / SCROLL_BAND) * SCROLL_MAX);
  else if (below < SCROLL_BAND) velocity = Math.ceil(((SCROLL_BAND - below) / SCROLL_BAND) * SCROLL_MAX);
  scrollVelocity = velocity;
  scrollTarget = container;
  if (velocity !== 0 && scrollFrame === 0) scrollFrame = requestAnimationFrame(scrollStep);
  if (velocity === 0) stopAutoScroll();
}

export function stopAutoScroll(): void {
  if (scrollFrame !== 0) cancelAnimationFrame(scrollFrame);
  scrollFrame = 0;
  scrollVelocity = 0;
  scrollTarget = null;
}

// -------------------------------------------------------------- the move

/** Resolve once nothing under `path` is dirty — the editor autosaves 600ms
 *  after the last keystroke, and a save that lands AFTER the move writes the
 *  old path back into existence as a ghost copy. Bounded, because a save that
 *  is failing must not make the move unreachable. */
function whenSaved(path: string, timeoutMs = 2000): Promise<void> {
  const prefix = `${path}/`;
  const stillDirty = (dirty: Record<string, boolean>): boolean =>
    Object.entries(dirty).some(([p, d]) => d && (p === path || p.startsWith(prefix)));
  if (!stillDirty(useStore.getState().dirty)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      unsubscribe();
      resolve();
    }, timeoutMs);
    const unsubscribe = useStore.subscribe((s) => {
      if (stillDirty(s.dirty)) return;
      window.clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

/** Server failure codes → the line the reader gets. Per CONTRACTS: prefer the
 *  CODE, never `err.message` (it is English prose written for a log), and keep
 *  the generic localized line for anything the server has not named. */
const MOVE_ERROR_KEYS: Record<string, "moveIntoSelfError" | "moveConflictError" | "moveGoneError" | "moveNotAllowed"> = {
  move_into_self: "moveIntoSelfError",
  move_conflict: "moveConflictError",
  move_missing: "moveGoneError",
  move_same: "moveNotAllowed",
  move_not_folder: "moveNotAllowed",
  move_invalid: "moveNotAllowed",
  move_invalid_target: "moveNotAllowed",
  move_bad_parent: "moveNotAllowed",
};

function moveErrorMessage(err: unknown, name: string): string {
  const code = err instanceof ApiError ? err.code : undefined;
  const key = code ? MOVE_ERROR_KEYS[code] : undefined;
  if (key === "moveIntoSelfError") return t(key);
  if (key) return tf(key, { name });
  // A 409 with no code is the rename route's own "target already exists".
  if (err instanceof ApiError && err.status === 409) return tf("moveConflictError", { name });
  if (err instanceof ApiError && err.status === 404) return tf("moveGoneError", { name });
  return tf("moveFailed", { name });
}

function apply(item: MoveItem, toPath: string): Promise<unknown> {
  return item.isFolder
    ? api.moveFolder(item.path, toPath)
    : api.renameNote(item.path, toPath);
}

/** Do the move and tell the reader — including how to take it back.
 *
 *  `undoTo` is the path this move should return the item to, or null when THIS
 *  call already is an undo (which then confirms rather than offering a third
 *  round of the same gesture).
 *
 *  The order matters. `remapPath` runs BEFORE `loadTree`, so the open tabs and
 *  the active note follow the file rather than blinking out while the tree
 *  reloads underneath them: the note you were reading is still the note you are
 *  reading, at its new address. A failure returns before any of it, so a vault
 *  the server refused to touch is a UI that did not move either. */
async function run(item: MoveItem, toPath: string, undoTo: string | null): Promise<void> {
  const store = useStore.getState();
  await whenSaved(item.path);
  try {
    await apply(item, toPath);
  } catch (err) {
    console.error(`vellum: moving ${item.path} to ${toPath} failed`, err);
    toast(moveErrorMessage(err, itemLabel(item)), "error");
    return;
  }
  store.remapPath(item.path, toPath);
  await store.loadTree();
  void store.refreshBacklinks();
  // A published note that changed address changes the public site.
  void store.loadPublished();

  const landedName = itemLabel({
    path: toPath,
    name: toPath.slice(toPath.lastIndexOf("/") + 1),
    isFolder: item.isFolder,
  });
  if (undoTo === null) {
    toast(tf("moveUndoneToast", { name: landedName, folder: folderLabel(parentDir(toPath)) }));
    return;
  }
  actionToast(
    // The LANDED name, not the name it set off with: when a collision made the
    // reader rename it, "Moved “Notes.md”" would name a file that is not there.
    tf("movedToast", {
      name: landedName,
      from: folderLabel(parentDir(item.path)),
      to: folderLabel(parentDir(toPath)),
    }),
    t("undo"),
    () => {
      void run({ path: toPath, name: landedName, isFolder: item.isFolder }, undoTo, null);
    },
  );
}

// ------------------------------------------------- files from the desktop

/** The images in an OS drag. Same filter the editor's paste/drop uses: the
 *  server sniffs magic bytes and refuses anything else, so screening here is
 *  what turns "a red toast per PDF" into "nothing happened, and the folder
 *  never lit up". */
export function droppedImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((f) => f.type.startsWith("image/"));
}

/** True when an OS drag is carrying files at all — readable during `dragover`,
 *  where the file LIST is not (the browser withholds it until the drop). */
export function dragHasFiles(data: DataTransfer | null): boolean {
  return data !== null && Array.from(data.types).includes("Files");
}

/** Upload files dropped from the desktop into `dir`.
 *
 *  Conflicts are handled the way an upload must handle them and a move must
 *  not: the server takes the first FREE filename (`shot.png`, `shot-2.png`, …)
 *  rather than asking, because there is nothing to decide — nothing is at risk
 *  of being overwritten and the reader has not named anything yet. The toast
 *  names what actually landed, so a counter is visible rather than silent.
 *
 *  There is deliberately no undo here, unlike a move: an upload only ADDS a
 *  file, and taking it back would need a delete route for attachments that the
 *  API does not have. The destructive gesture is the one that carries undo. */
export async function uploadInto(files: File[], dir: string): Promise<void> {
  const store = useStore.getState();
  if (!store.admin || files.length === 0) return;
  const landed: string[] = [];
  for (const file of files) {
    try {
      const result = await api.uploadAttachment(file, false, dir);
      landed.push(result.path.slice(result.path.lastIndexOf("/") + 1));
    } catch (err) {
      console.error(`vellum: uploading ${file.name} into ${dir} failed`, err);
      const code = err instanceof ApiError ? err.code : undefined;
      toast(
        code === "upload_not_image"
          ? tf("uploadNotImage", { name: file.name })
          : tf("uploadIntoFailed", { name: file.name }),
        "error",
      );
    }
  }
  if (landed.length === 0) return;
  await store.loadTree();
  toast(
    landed.length === 1
      ? tf("uploadedOneToast", { name: landed[0], folder: folderLabel(dir) })
      : tf("uploadedManyToast", {
          count: countPhrase(landed.length, "files"),
          folder: folderLabel(dir),
        }),
  );
}

/** The conflict dialog's naming rule, shown live under the field. */
function checkName(item: MoveItem, dir: string, raw: string): PromptCheck {
  const typed = raw.trim().replace(/\\/g, "/");
  if (!typed) return { value: "" };
  if (typed.includes("/")) return { value: "", error: t("moveNameSlash") };
  if (typed.startsWith(".")) return { value: "", error: t("moveNameDot") };
  const ext = extOf(item.name);
  const named = ext && !typed.toLowerCase().endsWith(ext.toLowerCase()) ? `${typed}${ext}` : typed;
  const tree = useStore.getState().tree;
  if (nameTaken(tree, dir, named)) return { value: "", error: t("moveNameTaken") };
  const value = joinPath(dir, named);
  return { value, note: tf("moveLands", { path: value }) };
}

/** Move `item` into `dir`. The single entry point for every surface.
 *
 *  A name collision NEVER overwrites: the reader is asked for another name and
 *  can cancel, and cancelling means nothing at all happened. (The server refuses
 *  the collision too — this dialog is the difference between "your drop did
 *  nothing, here is a red toast" and "your drop needs a name".) */
export async function moveTo(item: MoveItem, dir: string): Promise<void> {
  const store = useStore.getState();
  if (!store.admin) return;
  if (!canDrop(item, dir)) {
    toast(tf("moveNotAllowed", { name: itemLabel(item) }), "error");
    return;
  }
  let name = item.name;
  if (nameTaken(store.tree, dir, name)) {
    // Named to the reader the way the tree names it; `checkName` puts the
    // extension back on whatever they type.
    const shown = itemLabel(item);
    const picked = await promptModal({
      title: tf("moveConflictTitle", { name: shown }),
      body: tf("moveConflictBody", { folder: folderLabel(dir), name: shown }),
      value: shown,
      confirmLabel: t("moveAction"),
      check: (raw) => checkName(item, dir, raw),
    });
    if (!picked) return; // cancelled: the vault is untouched and stays untouched
    name = picked.slice(picked.lastIndexOf("/") + 1);
  }
  await run(item, joinPath(dir, name), item.path);
}
