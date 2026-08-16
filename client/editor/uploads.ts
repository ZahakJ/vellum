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

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { uploadAttachment } from "../api.ts";
import { droppedFiles, refuseFiles, sortFiles } from "../attachments.ts";
import { getLang, t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";

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

/** Current position of an in-flight upload's placeholder widget. */
function placeholderPos(view: EditorView, id: number): number | null {
  let found: number | null = null;
  const iter = view.state.field(uploadField).iter();
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

/** The vault folder the editor's uploads happen in — the open note's own
 *  folder. It is what the "same folder"/"subfolder" attachment-location modes
 *  are relative to; the other modes ignore it. */
function contextDir(): string {
  const open = useStore.getState().openPath;
  if (!open) return "";
  const i = open.lastIndexOf("/");
  return i === -1 ? "" : open.slice(0, i);
}

function startUploads(
  view: EditorView,
  files: File[],
  from: number,
  to: number,
): void {
  const ids = files.map(() => nextId++);
  files.forEach((file, i) => labelById.set(ids[i], uploadName(file)));
  view.dispatch({
    changes: { from, to, insert: "" },
    effects: ids.map((id) => addUpload.of({ id, pos: from })),
    userEvent: "input.paste",
  });

  files.forEach((file, i) => {
    const id = ids[i];
    const named = new File([file], uploadName(file), { type: file.type });
    uploadAttachment(named, false, contextDir())
      .then((result) => {
        labelById.delete(id);
        if (!view.dom.isConnected) return;
        const pos = placeholderPos(view, id);
        if (pos === null) return;
        const basename = result.path.split("/").pop() ?? result.path;
        const embed = `![[${basename}]]` + (files.length > 1 ? "\n" : "");
        view.dispatch({
          changes: { from: pos, insert: embed },
          effects: endUpload.of({ id }),
          userEvent: "input.complete",
        });
      })
      .catch((err: unknown) => {
        labelById.delete(id);
        console.error("vellum: image upload failed", err);
        toast(err instanceof Error ? err.message : t("uploadFailed"));
        if (!view.dom.isConnected) return;
        view.dispatch({ effects: endUpload.of({ id }) });
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
