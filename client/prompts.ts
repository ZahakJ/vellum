// The vault's two creation dialogs, in one place because four surfaces open
// them: Ctrl/Cmd+N, the sidebar header's New note, the tree's "New note here"
// and "New folder". Every one of them used to draw a native window.prompt() —
// the last window.* box in the product, and the only chrome on an Arabic
// instance whose buttons stayed in English.
//
// The rule these dialogs enforce is written once, here, and — the point —
// SHOWN. `check()` runs on every keystroke, and whatever it makes of the text
// ("ideas/Untitled.md" from a typed "Untitled") is printed under the field
// before anything is created. The old flow appended ".md" in silence and
// joined the folder in silence; a reader who typed "Ideas" learned what they
// had actually made by finding it in the tree.

import { createFolder } from "./api.ts";
import { promptModal, type PromptCheck } from "./components/Confirm.tsx";
import { t, tf } from "./i18n.ts";
import { useStore } from "./state.ts";
import { toast } from "./toast.ts";
import { isNotePath } from "../shared/noteFormat.ts";

/** Everything a typed path arrives decorated with: whitespace, backslashes
 *  (a Windows paste), leading/trailing and doubled slashes. */
function clean(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/** The naming rule for both dialogs. `dir` is the folder the surface is
 *  creating into ("" = vault root); `md` asks for the note suffix. */
function check(dir: string, md: boolean, raw: string): PromptCheck {
  const typed = clean(raw);
  // Nothing typed yet is not a mistake — it greys Create and says nothing.
  if (!typed) return { value: "" };
  const segments = typed.split("/");
  // The server answers `..` with a 400 and a dotfile with a 404 (it must never
  // admit that .obsidian/ exists). Both are better said here, before the
  // reader has committed, than as a toast reading "Not found".
  if (segments.includes("..")) return { value: "", error: t("promptNoTraversal") };
  if (segments.some((seg) => seg.startsWith("."))) return { value: "", error: t("promptNoDotName") };
  // An extension the reader TYPED is kept: "Paper.tex" must create a LaTeX
  // note, not "Paper.tex.md". Anything else gets `.md`, which is what the new-
  // note prompt has always meant.
  const named = md && !isNotePath(typed) ? `${typed}.md` : typed;
  const value = dir ? `${dir}/${named}` : named;
  // Quiet when the text IS the path; explicit the moment we added anything.
  return { value, note: value === typed ? undefined : tf("promptCreates", { path: value }) };
}

/** "In ideas/2024" — or, at the vault root, the fact that it is the root. A
 *  creation dialog that does not name its destination is how a note ends up
 *  three folders from where its author was looking. */
function destination(dir: string): string {
  return dir ? tf("promptInFolder", { folder: dir }) : t("promptAtRoot");
}

/** Ask for a note path in `dir` ("" = vault root) and hand it back WITHOUT
 *  creating anything. The naming rule — the extension, the folder join, the
 *  `..`/dotfile refusals, the "creates ideas/Untitled.md" line under the
 *  field — is the one above, so a second creation flow cannot drift from the
 *  first. Null when the reader cancelled. */
export function promptNotePath(dir: string, title: string): Promise<string | null> {
  return promptModal({
    title,
    body: destination(dir),
    value: "Untitled.md",
    placeholder: "Untitled.md",
    check: (raw) => check(dir, true, raw),
  });
}

/** New note in `dir` ("" = vault root). Creates it, opens it, and leaves the
 *  caret in the editor — the store's createNote owns all three. */
export async function promptNewNote(dir: string): Promise<void> {
  const path = await promptNotePath(dir, t("newNote"));
  if (path) await useStore.getState().createNote(path);
}

/** New folder in `dir` ("" = vault root). */
export async function promptNewFolder(dir: string): Promise<void> {
  const path = await promptModal({
    title: t("newFolder"),
    body: destination(dir),
    placeholder: t("phFolderName"),
    check: (raw) => check(dir, false, raw),
  });
  if (!path) return;
  try {
    await createFolder(path);
    await useStore.getState().loadTree();
  } catch (err) {
    console.error("vellum: creating folder failed", err);
    toast(err instanceof Error ? err.message : t("creatingFolderFailed"));
  }
}
