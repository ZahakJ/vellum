// The two template commands, and the only two doors into client/templates.ts
// from the UI. Four surfaces open them — the palette, two keybindings, the
// tree's folder menu — and they all land here, so "insert a template" means
// one thing in this product.

import { createNote, getNote, putNote } from "./api.ts";
import { pickTemplate } from "./components/TemplatePicker.tsx";
import { t, tf } from "./i18n.ts";
import { noteTitleOf } from "../shared/noteFormat.ts";
import { promptNotePath } from "./prompts.ts";
import { useStore } from "./state.ts";
import { applyTemplate, templateSettings, type TemplateVars } from "./templates.ts";
import { toast } from "./toast.ts";

/** The event the mounted editor answers: "put this template in, at the
 *  caret". The editor owns the transaction because it owns the document —
 *  merging the frontmatter and inserting the body must be ONE undo step, and
 *  only the view knows where the caret is. */
export interface InsertTemplateDetail {
  /** The template file's raw text, placeholders NOT yet filled (the editor
   *  fills them against the note it is actually holding). */
  source: string;
  vars: TemplateVars;
  /** Set to true by the editor that handles it — see waitForEditor(). */
  handled: { value: boolean };
}

export const INSERT_TEMPLATE_EVENT = "vellum:insert-template";

/** Everything the placeholders need, for a note called `title`. */
async function varsFor(title: string): Promise<TemplateVars> {
  const settings = await templateSettings();
  return {
    title,
    now: new Date(),
    locale: settings.locale,
    calendar: settings.calendar,
    lang: settings.lang,
  };
}

/** "Insert template…" — pick one, then drop its body at the caret and fold its
 *  frontmatter into the note's own block. */
export async function insertTemplateCommand(): Promise<void> {
  const store = useStore.getState();
  const path = store.openPath;
  if (!store.admin || !path) return;
  const chosen = await pickTemplate(t("cmdInsertTemplate"), noteTitleOf(path));
  if (!chosen) return;
  try {
    const [template, vars] = await Promise.all([getNote(chosen), varsFor(noteTitleOf(path))]);
    // Reading view has no caret and no editor. Switch first — an "insert at
    // the cursor" command that silently does nothing because the reader is in
    // reading mode is the invisible-failure this codebase keeps hunting.
    if (useStore.getState().readingMode) useStore.getState().setReadingMode(false);
    const delivered = await deliverToEditor(template.content, vars);
    if (delivered) return;
    // No editor came up (the note failed to open, the tab changed under us):
    // fall back to the file itself rather than dropping the reader's request.
    const note = await getNote(path);
    const applied = applyTemplate(template.content, note.content, vars);
    await putNote(path, `${applied.content}${applied.insert}`);
    useStore.getState().bumpReload();
    toast(tf("templateInserted", { name: noteTitleOf(chosen) }));
  } catch (err) {
    console.error("vellum: inserting template failed", err);
    toast(t("templateFailed"));
  }
}

/** Dispatch the insert to whichever editor is mounted, giving a just-switched
 *  reading→editing pane a moment to arrive. Resolves false if none answers. */
function deliverToEditor(source: string, vars: TemplateVars): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + 1500;
    const attempt = (): void => {
      const handled = { value: false };
      const detail: InsertTemplateDetail = { source, vars, handled };
      window.dispatchEvent(new CustomEvent(INSERT_TEMPLATE_EVENT, { detail }));
      if (handled.value) {
        resolve(true);
        return;
      }
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      window.setTimeout(attempt, 60);
    };
    attempt();
  });
}

/** "New note from template…" — name it, pick a template, create it with the
 *  template already applied, open it. `dir` is the folder the surface is
 *  creating into ("" = vault root; the tree's folder menu passes its own). */
export async function newNoteFromTemplateCommand(dir = ""): Promise<void> {
  const store = useStore.getState();
  if (!store.admin) return;
  // THE NAME COMES FIRST, and that ordering is the feature: `{{title}}` is
  // filled from the filename, so the picker's preview can only show what will
  // actually land once the name exists.
  const path = await promptNotePath(dir, t("cmdNewFromTemplate"));
  if (!path) return;
  const title = noteTitleOf(path);
  const chosen = await pickTemplate(t("cmdNewFromTemplate"), title);
  if (!chosen) return;
  try {
    const [template, vars] = await Promise.all([getNote(chosen), varsFor(title)]);
    // A fresh note has no frontmatter of its own, so the merge is the
    // template's block with its identity keys re-minted (client/templates.ts).
    const applied = applyTemplate(template.content, "", vars);
    await createNote(path);
    await putNote(path, `${applied.content}${applied.insert}`);
    await useStore.getState().loadTree();
    useStore.getState().openNote(path);
    if (useStore.getState().readingMode) useStore.getState().setReadingMode(false);
  } catch (err) {
    console.error("vellum: creating note from template failed", err);
    toast(err instanceof Error && /exists/i.test(err.message) ? t("couldNotCreateNote") : t("templateFailed"));
  }
}

/** The default template, applied to a note that was just created empty. Off
 *  unless `settings.defaultTemplate` names one — a product that silently puts
 *  text in every new note is a product that has to be fought. */
export async function applyDefaultTemplate(path: string): Promise<void> {
  let settings;
  try {
    settings = await templateSettings();
  } catch {
    return; // settings unreachable: a new note is empty, as it always was
  }
  if (!settings.defaultTemplate || settings.defaultTemplate === path) return;
  try {
    const [template, vars] = await Promise.all([
      getNote(settings.defaultTemplate),
      varsFor(noteTitleOf(path)),
    ]);
    const applied = applyTemplate(template.content, "", vars);
    const content = `${applied.content}${applied.insert}`;
    if (content.trim() === "") return;
    await putNote(path, content);
    useStore.getState().bumpReload();
  } catch (err) {
    // A missing/renamed default template must not break note creation — the
    // note is already there and empty, which is the pre-feature behaviour.
    console.error("vellum: applying the default template failed", err);
    toast(t("defaultTemplateFailed"));
  }
}
