// Attachments, client side: what a drag is carrying, which of those files the
// server would take, and where they land. Shared by the three surfaces that
// upload — editor paste/drop, the tree's file drop, the banner/settings
// picker.
//
// The rule the whole module exists to keep: REFUSE BEFORE UPLOADING. A file
// whose type the server will reject must be turned away while the drop is
// still in the reader's hand, naming the kinds that are welcome — not after a
// round-trip that ends in a red toast with the file already gone from the
// cursor.
//
// DELETING is deliberately not here. This module was written with its own
// "delete impact" half — ask the server what a folder really holds, because
// the tree carries markdown only and a folder of four images answered "0
// notes". That question now has a better answer of its own: `/api/delete-
// preview` and `client/components/deleteFlow.ts`, which cover notes, folders
// AND single attachments and feed the same dialogs. Two implementations of one
// question is how the two dialogs come to disagree, so this one gave way.

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_TYPES,
  extensionOf,
  isAcceptedAttachment,
} from "../shared/attachments.ts";
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_MB } from "../shared/limits.ts";
import { deleteAttachment, uploadAttachment } from "./api.ts";
import { confirmModal } from "./components/Confirm.tsx";
import { countPhrase, localeNum, t, tf } from "./i18n.ts";
import "./styles/attachments.css";
// The undo toast is `undoToast.ts`'s, not a second copy: that one already
// guards against a double click, isolates the direction of spliced-in names,
// and clears its own timer. A drop's undo and a move's undo are the same
// object and must never stack.
import { actionToast } from "./undoToast.ts";
import { toast } from "./toast.ts";

/** The `accept` attribute every file input in the app should carry. */
export const UPLOAD_ACCEPT = ATTACHMENT_ACCEPT;

// ── What a drag is carrying ─────────────────────────────────────────────────

/** True when a drag carries OS files (as opposed to text, a link, or one of
 *  our own tree rows). Valid during dragenter/dragover, where the file LIST is
 *  deliberately unreadable — only `types` is. */
export function dragHasFiles(data: DataTransfer | null): boolean {
  if (!data) return false;
  return Array.from(data.types).includes("Files");
}

/** How many files a drag is carrying, for the drop affordance. During a drag
 *  the browser exposes only `items` (each with kind "file" but no name), so
 *  this is a count and nothing more — which is exactly what the affordance
 *  needs. 0 when the drag is not files at all. */
export function dragFileCount(data: DataTransfer | null): number {
  if (!data) return 0;
  if (data.items && data.items.length > 0) {
    return Array.from(data.items).filter((item) => item.kind === "file").length;
  }
  return dragHasFiles(data) ? 1 : 0;
}

/** Every file of a drop (or paste), whatever its type — the filtering happens
 *  in `sortFiles` so the refusal can be explained rather than silent. */
export function droppedFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files);
}

// ── What the server will take ───────────────────────────────────────────────

export interface SortedFiles {
  /** Files worth putting on the wire. */
  ok: File[];
  /** Refused because the type is not one /api/upload accepts. */
  wrongType: File[];
  /** Refused because they exceed the upload cap, checked here so a 40 MB
   *  video is not uploaded for ten seconds only to be rejected at the end. */
  tooBig: File[];
}

export function sortFiles(files: File[]): SortedFiles {
  const ok: File[] = [];
  const wrongType: File[] = [];
  const tooBig: File[] = [];
  for (const file of files) {
    if (!isAcceptedAttachment(file.name, file.type)) wrongType.push(file);
    else if (file.size > UPLOAD_MAX_BYTES) tooBig.push(file);
    else ok.push(file);
  }
  return { ok, wrongType, tooBig };
}

/** The kinds a reader is allowed to attach, as a short readable list —
 *  "png, jpeg, svg, pdf, mp3, mp4…" is noise, "images, audio, video, PDF" is
 *  an answer. */
function acceptedKinds(): string {
  return t("attachKinds");
}

/** The distinct extensions of a refused batch, for the refusal copy
 *  (".exe, .zip"); a file with no extension shows as its own name. */
function refusedExtensions(files: File[]): string {
  const seen: string[] = [];
  for (const file of files) {
    const ext = extensionOf(file.name);
    // No extension: name what we DO know — the browser's type, or the file
    // itself. An empty pair of quotes explains nothing.
    const label = ext !== "" ? `.${ext}` : file.type || file.name || t("unknownType");
    if (!seen.includes(label)) seen.push(label);
  }
  return seen.slice(0, 6).join(", ");
}

/** Why files were turned away, in one sentence — or null when none were.
 *  Written from the sorted batch rather than per file: "3 files can't be
 *  attached (.zip, .exe)" is one thing to read, three toasts are noise. */
export function refusalMessage(sorted: SortedFiles): string | null {
  const refused = sorted.wrongType.length + sorted.tooBig.length;
  if (refused === 0) return null;
  const typePart =
    sorted.wrongType.length > 0
      ? tf("refuseType", {
          files: countPhrase(sorted.wrongType.length, "files"),
          exts: refusedExtensions(sorted.wrongType),
          kinds: acceptedKinds(),
        })
      : "";
  const sizePart =
    sorted.tooBig.length > 0
      ? tf("refuseSize", {
          files: countPhrase(sorted.tooBig.length, "files"),
          max: localeNum(UPLOAD_MAX_MB),
        })
      : "";
  return [typePart, sizePart].filter(Boolean).join(" ");
}

/** Say it and move on — the editor's paste/drop path, where the accepted
 *  files are already being inserted at the caret. */
export function refuseFiles(sorted: SortedFiles): void {
  const reason = refusalMessage(sorted);
  if (reason) toast(reason);
}

/** Tell the reader what was turned away and why. Returns false when NOTHING
 *  is left to upload (the caller stops), true when the accepted remainder
 *  should proceed — and when it is a MIX, that is a question, not a notice:
 *  a half-completed drop nobody agreed to is its own small surprise. */
async function reportRefusals(sorted: SortedFiles): Promise<boolean> {
  const reason = refusalMessage(sorted);
  if (reason === null) return true;
  if (sorted.ok.length === 0) {
    toast(reason);
    return false;
  }
  return confirmModal({
    title: t("someFilesRefused"),
    body: `${reason} ${tf("uploadTheRest", { files: countPhrase(sorted.ok.length, "files") })}`,
    confirmLabel: t("upload"),
  });
}

// ── Uploading ───────────────────────────────────────────────────────────────

export interface UploadOutcome {
  /** Vault paths of everything that landed, in drop order. */
  paths: string[];
  /** Files whose stored name differs from the one they arrived with — either
   *  the folder already held that name (the server takes the first free
   *  `name-2.ext`) or the name needed sanitizing. Reported rather than
   *  pre-empted, and worded for both cases: the reader's question is only
   *  ever "what is it called now". */
  renamed: { from: string; to: string }[];
  failed: number;
}

/** Upload a batch into the folder `dir` (the vault folder the drop happened
 *  in — the attachment-location setting decides what that means, and may
 *  ignore it entirely). Sequential on purpose: a dropped folder of 30 images
 *  should not open 30 sockets, and the order of the resulting embeds is the
 *  order they were dropped in. */
export async function uploadFiles(files: File[], dir: string): Promise<UploadOutcome> {
  const outcome: UploadOutcome = { paths: [], renamed: [], failed: 0 };
  for (const file of files) {
    try {
      const result = await uploadAttachment(file, true, dir);
      outcome.paths.push(result.path);
      const landed = result.path.split("/").pop() ?? result.path;
      if (landed !== file.name) outcome.renamed.push({ from: file.name, to: landed });
    } catch (err) {
      console.error("vellum: upload failed", err);
      outcome.failed++;
      toast(err instanceof Error ? err.message : t("uploadFailed"));
    }
  }
  return outcome;
}

/** The whole tree-drop path: refuse what cannot be uploaded, upload the rest,
 *  then say where it went — with one click to take it back. */
export async function uploadDroppedFiles(files: File[], dir: string): Promise<string[]> {
  const sorted = sortFiles(files);
  if (!(await reportRefusals(sorted))) return [];
  if (sorted.ok.length === 0) return [];
  const outcome = await uploadFiles(sorted.ok, dir);
  if (outcome.paths.length === 0) return [];
  // Where they LANDED, not where they were dropped: the attachment-location
  // setting may have sent them somewhere else entirely, and the toast is the
  // only place a reader finds that out.
  const landed = outcome.paths[0].slice(0, Math.max(0, outcome.paths[0].lastIndexOf("/")));
  let message = tf("filesAdded", {
    files: countPhrase(outcome.paths.length, "files"),
    folder: landed === "" ? t("vaultRoot") : landed,
  });
  if (outcome.renamed.length > 0) {
    const first = outcome.renamed[0];
    message += ` ${tf("savedAsName", { from: first.from, to: first.to })}`;
  }
  actionToast(message, t("undo"), () => void undoUploads(outcome.paths));
  return outcome.paths;
}

/** Undo a just-landed drop: every uploaded file goes to the vault's `.trash/`,
 *  where it stays recoverable — an undo that erased from disk would be a
 *  worse accident than the drop it is undoing. */
async function undoUploads(paths: string[]): Promise<void> {
  let removed = 0;
  for (const path of paths) {
    try {
      await deleteAttachment(path);
      removed++;
    } catch (err) {
      console.error("vellum: undoing an upload failed", err);
    }
  }
  toast(
    removed === paths.length
      ? tf("uploadUndone", { files: countPhrase(removed, "files") })
      : t("uploadUndoFailed"),
  );
}

/** The extensions a drop-zone hint names — a representative handful, not the
 *  whole table (the full list lives in shared/attachments.ts and is what the
 *  file input's `accept` carries). */
export const HINT_EXTENSIONS: string = ["png", "jpeg", "svg", "pdf", "mp3", "mp4"]
  .filter((ext) => Object.prototype.hasOwnProperty.call(ATTACHMENT_TYPES, ext))
  .join(" · ");
