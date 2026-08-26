// Paste / drop attachment uploads. Pasting a file from the clipboard (or
// dropping files onto the editor) uploads it through POST /api/upload and
// inserts `![[name.png]]` where the cursor (or drop point) was. While the
// request is in flight a small "Uploading name…" widget holds the spot — its
// position is a decoration in a StateField, so it rides along correctly even
// if the author keeps typing around it.
//
// Every type /api/upload accepts is welcome here, not images alone (a PDF and
// an interview recording are attachments too — see shared/attachments.ts).
// Anything the server would refuse is refused HERE, before the upload, with a
// toast naming the kinds that are welcome; and the upload carries the open
// note's folder, which is what the "same folder" / "subfolder" attachment
// locations are relative to.

import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { deleteAttachment, uploadAttachment } from "../api.ts";
import { applyToBuffer, bufferOf, bufferWide, pathForView } from "./buffers.ts";
import { notePathFacet } from "./livePreview.ts";
import { droppedFiles, refuseFiles, sortFiles } from "../attachments.ts";
import { countPhrase, getLang, t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { actionToast } from "../undoToast.ts";

let nextId = 1;

const addUpload = StateEffect.define<{ id: number; pos: number }>({
  map: (value, mapping) => ({ ...value, pos: mapping.mapPos(value.pos) }),
});
const endUpload = StateEffect.define<{ id: number }>();

class UploadingWidget extends WidgetType {
  constructor(
    readonly id: number,
    readonly label: string,
  ) {
    super();
  }
  // Language is part of the identity — see ChevronWidget in folding.ts.
  readonly lang = getLang();
  override eq(other: UploadingWidget): boolean {
    return other.id === this.id && other.label === this.label && other.lang === this.lang;
  }
  toDOM(): HTMLElement {
    const pill = document.createElement("span");
    pill.className = "cm-s-uploading";
    const spin = document.createElement("span");
    spin.className = "cm-s-uploading__spinner";
    spin.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = tf("uploadingImage", { name: this.label });
    pill.append(spin, text);
    return pill;
  }
}

const uploadField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decos, tr) {
    decos = decos.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(addUpload)) {
        decos = decos.update({
          add: [
            // side -1: the caret rests AFTER the placeholder, so an author
            // who keeps typing writes after the (future) embed — Obsidian's
            // behavior after pasting an image.
            Decoration.widget({
              widget: new UploadingWidget(
                effect.value.id,
                labelById.get(effect.value.id) ?? "image",
              ),
              side: -1,
            }).range(effect.value.pos),
          ],
        });
      } else if (effect.is(endUpload)) {
        const id = effect.value.id;
        decos = decos.update({
          filter: (_from, _to, deco) =>
            !(deco.spec.widget instanceof UploadingWidget) ||
            (deco.spec.widget as UploadingWidget).id !== id,
        });
      }
    }
    return decos;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// Widget labels are passed out-of-band so the effect stays a plain position.
const labelById = new Map<number, string>();

/** Current position of an in-flight upload's placeholder widget — asked of a
 *  STATE, not a view. The decoration lives in the note's EditorState, which
 *  the buffer registry keeps across an unmount; the view is just one window
 *  onto it, and by the time an upload resolves there may be none. */
function placeholderPos(state: EditorState, id: number): number | null {
  let found: number | null = null;
  const iter = state.field(uploadField).iter();
  while (iter.value) {
    const widget = iter.value.spec.widget;
    if (widget instanceof UploadingWidget && widget.id === id) {
      found = iter.from;
      break;
    }
    iter.next();
  }
  return found;
}

/** Clipboard files named "image.png" get a dated Obsidian-style name. */
function uploadName(file: File): string {
  if (file.name && !/^image\.\w+$/i.test(file.name)) return file.name;
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const ext = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf("."))
    : ".png";
  return `Pasted image ${stamp}${ext}`;
}

/** The files of a paste/drop the server would take. Anything else is left to
 *  CodeMirror (a text paste is still a text paste) unless it is a FILE we had
 *  to turn away — then the reader is told why, before anything is uploaded.
 *  Returns null when the event is not about files at all. */
function attachableFiles(data: DataTransfer | null): File[] | null {
  const files = droppedFiles(data);
  if (files.length === 0) return null;
  const sorted = sortFiles(files);
  if (sorted.ok.length === 0 && sorted.wrongType.length + sorted.tooBig.length > 0) {
    void refuseFiles(sorted);
    return [];
  }
  if (sorted.wrongType.length + sorted.tooBig.length > 0) void refuseFiles(sorted);
  return sorted.ok;
}

/** The vault folder the editor's uploads happen in — THIS editor's note's own
 *  folder. It is what the "same folder"/"subfolder" attachment-location modes
 *  are relative to; the other modes ignore it.
 *
 *  Read off the view's own `notePathFacet` rather than the store's `openPath`:
 *  with two panes open, `openPath` names the FOCUSED pane's note, so a paste
 *  into the other pane filed its picture beside a note it has nothing to do
 *  with. The store is still the fallback for an editor built without the facet
 *  (nothing in the app does, but the facet's own default is the empty string,
 *  and silently filing at the vault root is the worse of the two guesses). */
function contextDir(view: EditorView): string {
  const open = view.state.facet(notePathFacet) || useStore.getState().openPath;
  if (!open) return "";
  const i = open.lastIndexOf("/");
  return i === -1 ? "" : open.slice(0, i);
}

/** The note an upload belongs to, captured while the view is still attached.
 *  Asked at START, never at resolution: `detach()` takes the view out of the
 *  buffer's set before destroying it, so a lookup afterwards finds nothing. */
function uploadTarget(view: EditorView): string | null {
  return pathForView(view) ?? (view.state.facet(notePathFacet) || null);
}

/** Land an upload's result. The BUFFER is the target, not the view: the
 *  placeholder decoration lives in the note's preserved EditorState, so a
 *  reader who switched tabs mid-upload must still get their embed — and, more
 *  urgently, must not be left with a pill nothing can remove (v1.8 audit B3).
 *
 *  `make` is handed the state the transaction will apply to, because the
 *  placeholder's position has to be read from THAT state: a sibling pane may
 *  have typed while the bytes were in flight. */
function resolveUpload(
  path: string | null,
  view: EditorView,
  make: (state: EditorState) => TransactionSpec | null,
): void {
  const buf = path === null ? null : bufferOf(path);
  if (buf === null) {
    // No registry entry — an editor built outside the buffer registry, or a
    // note closed and disposed while the bytes were in flight. Only the live
    // view is left to answer to, and if it is gone there is nothing to fix.
    if (!view.dom.isConnected) return;
    const spec = make(view.state);
    if (spec !== null) view.dispatch(spec);
    return;
  }
  const spec = make(buf.state);
  if (spec !== null) applyToBuffer(buf.path, spec);
}

/** Take back a paste/drop that landed in the editor.
 *
 *  Two halves, because the gesture had two effects: the embed comes out of the
 *  note and the bytes go to `.trash/` — recoverable, like every other undo in
 *  the product (an undo that erased from disk would be a worse accident than
 *  the paste it is undoing).
 *
 *  The embed is found by TEXT, not by a remembered position: the reader has
 *  had nine seconds to type around it, and a position mapped through their
 *  edits is a guess about a document that has moved. `![[name.png]]` is
 *  distinctive enough to find, and if it is already gone — undone by hand,
 *  cut out with the paragraph — there is simply nothing to remove. */
function undoEditorUploads(
  path: string | null,
  view: EditorView,
  landed: { file: string; embed: string }[],
): void {
  for (const item of landed) {
    resolveUpload(path, view, (state) => {
      const at = state.doc.toString().indexOf(item.embed);
      if (at === -1) return null;
      return {
        changes: { from: at, to: at + item.embed.length, insert: "" },
        userEvent: "delete",
        annotations: bufferWide.of(true),
      };
    });
  }
  void (async () => {
    let removed = 0;
    for (const item of landed) {
      try {
        await deleteAttachment(item.file);
        removed++;
      } catch (err) {
        console.error("vellum: undoing a pasted upload failed", err);
      }
    }
    toast(
      removed === landed.length
        ? tf("uploadUndone", { files: countPhrase(removed, "files") })
        : t("uploadUndoFailed"),
    );
  })();
}

/** What a paste/drop says once the bytes are in the vault.
 *
 *  Pasting a screenshot into a note was the one upload path in the product
 *  that said NOTHING (v1.8 UX audit F13): the pill turned into an embed and
 *  the reader was left to work out that a file had been created, where it had
 *  been filed — the attachment-location setting may have sent it somewhere
 *  else entirely — and what it had been named, since a clipboard image arrives
 *  as "image.png" and is stored as "Pasted image 20260824…". The tree-drop
 *  path has answered all three with one sentence and an Undo since it shipped
 *  (attachments.ts); this is the same sentence. */
function reportEditorUploads(
  path: string | null,
  view: EditorView,
  landed: { file: string; embed: string }[],
): void {
  if (landed.length === 0) return;
  const first = landed[0].file;
  const cut = first.lastIndexOf("/");
  const folder = cut === -1 ? t("vaultRoot") : first.slice(0, cut);
  // ONE file gets its stored name, which is the fact a paste hides; a batch
  // gets a count, because five names do not fit in a toast.
  const message =
    landed.length === 1
      ? tf("fileAdded", { name: first.slice(cut + 1), folder })
      : tf("filesAdded", { files: countPhrase(landed.length, "files"), folder });
  actionToast(message, t("undo"), () => undoEditorUploads(path, view, landed));
}

function startUploads(
  view: EditorView,
  files: File[],
  from: number,
  to: number,
): void {
  const ids = files.map(() => nextId++);
  files.forEach((file, i) => labelById.set(ids[i], uploadName(file)));
  const path = uploadTarget(view);
  view.dispatch({
    changes: { from, to, insert: "" },
    effects: ids.map((id) => addUpload.of({ id, pos: from })),
    userEvent: "input.paste",
    // The placeholder is a fact about the NOTE, so every pane showing it gets
    // one — and, more importantly, so does the buffer's canonical state, which
    // is what the answer is resolved against when this pane is gone.
    annotations: bufferWide.of(true),
  });

  // What actually landed, in the order the files arrived — the batch's own
  // receipt, and what its Undo takes back.
  const landed: { file: string; embed: string }[] = [];
  let settled = 0;
  const settle = (): void => {
    if (++settled === files.length) reportEditorUploads(path, view, landed);
  };

  files.forEach((file, i) => {
    const id = ids[i];
    const named = new File([file], uploadName(file), { type: file.type });
    uploadAttachment(named, false, contextDir(view))
      .then((result) => {
        labelById.delete(id);
        const basename = result.path.split("/").pop() ?? result.path;
        const embed = `![[${basename}]]` + (files.length > 1 ? "\n" : "");
        landed.push({ file: result.path, embed });
        resolveUpload(path, view, (state) => {
          const pos = placeholderPos(state, id);
          // The pill is gone (the reader undid the paste, or took the
          // paragraph out). The file is uploaded and stays uploaded — it is in
          // the vault, and inventing a position for it would drop an embed
          // somewhere nobody asked for.
          if (pos === null) return null;
          return {
            changes: { from: pos, insert: embed },
            effects: endUpload.of({ id }),
            userEvent: "input.complete",
            annotations: bufferWide.of(true),
          };
        });
        settle();
      })
      .catch((err: unknown) => {
        labelById.delete(id);
        console.error("vellum: image upload failed", err);
        toast(err instanceof Error ? err.message : t("uploadFailed"));
        // The pill comes off whatever happens — THIS is the branch that used
        // to bail on `!view.dom.isConnected` and leave it there for the life
        // of the session. No `changes`, so the note does not go dirty over a
        // failed upload.
        resolveUpload(path, view, () => ({
          effects: endUpload.of({ id }),
          annotations: bufferWide.of(true),
        }));
        // A failure is still a settled file. The batch's receipt names what
        // landed; the toast above already named what did not.
        settle();
      });
  });
}

const handlers = EditorView.domEventHandlers({
  paste(event, view) {
    if (!useStore.getState().admin) return false;
    const files = attachableFiles(event.clipboardData);
    if (files === null) return false;
    // Files were on the clipboard, so this paste is ours even when every one
    // of them was refused — falling through would paste their NAMES as text.
    event.preventDefault();
    if (files.length === 0) return true;
    const { from, to } = view.state.selection.main;
    startUploads(view, files, from, to);
    return true;
  },
  drop(event, view) {
    if (!useStore.getState().admin) return false;
    const files = attachableFiles(event.dataTransfer);
    if (files === null) return false;
    event.preventDefault();
    if (files.length === 0) return true;
    const pos =
      view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
      view.state.selection.main.head;
    startUploads(view, files, pos, pos);
    return true;
  },
});

export function imageUploads(): Extension {
  return [uploadField, handlers];
}
