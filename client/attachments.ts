// Attachments, client side: what a drag is carrying, which of those files the
// server would take, where they land, and what a delete is really about to
// destroy. Everything here is shared by the three surfaces that upload
// (editor paste/drop, the tree's file drop, the banner/settings picker) and by
// the two that delete (folder rows, single attachments).
//
// Two rules the whole module exists to keep:
//
//   1. REFUSE BEFORE UPLOADING. A file whose type the server will reject must
//      be turned away while the drop is still in the reader's hand, naming the
//      kinds that are welcome — not after a round-trip that ends in a red
//      toast with the file already gone from the cursor.
//   2. NEVER UNDER-REPORT A DELETE. The vault tree holds markdown only, so a
//      folder holding four images and no notes truthfully answered "0 notes"
//      and silently took four figures out of a published essay with it. Every
//      delete confirmation here asks the server what is actually inside.

import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_TYPES,
  extensionOf,
  isAcceptedAttachment,
} from "../shared/attachments.ts";
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_MB } from "../shared/limits.ts";
import type { DeleteImpact } from "../shared/types.ts";
import { deleteAttachment, getDeleteImpact, uploadAttachment } from "./api.ts";
import { confirmModal, confirmModalEx } from "./components/Confirm.tsx";
import { countPhrase, isolate, localeNum, t, tf } from "./i18n.ts";
import "./styles/attachments.css";
import { dismissToasts, toast } from "./toast.ts";

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

/** A toast carrying one action (Undo). Same `.s-toast` element and lifetime as
 *  the plain one — it just holds a button, and stays up longer because an
 *  action nobody had time to click is decoration. */
export function actionToast(message: string, label: string, onAction: () => void): void {
  dismissToasts();
  const el = document.createElement("div");
  el.className = "s-toast s-toast--action";
  el.setAttribute("role", "status");
  const text = document.createElement("span");
  text.textContent = message;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "s-toast__action";
  button.textContent = label;
  button.addEventListener("click", () => {
    el.remove();
    onAction();
  });
  el.append(text, button);
  document.body.appendChild(el);
  window.setTimeout(() => {
    if (!el.isConnected) return;
    el.classList.add("s-toast--leaving");
    window.setTimeout(() => el.remove(), 300);
  }, 8000);
}

// ── What a delete really takes ──────────────────────────────────────────────

/** Ask the server; a failure answers null and the caller falls back to the
 *  counts it can see itself. Never let this block a delete outright — but
 *  never let a dialog invent an answer either. */
export async function deleteImpact(
  path: string,
  kind: "folder" | "attachment" = "folder",
): Promise<DeleteImpact | null> {
  try {
    return await getDeleteImpact(path, kind);
  } catch (err) {
    console.error("vellum: could not measure the delete", err);
    return null;
  }
}

/** The surviving notes that still embed what is about to go: named outright
 *  while they are few enough to read ("“Field”, “Power Electronics”"), and a
 *  plain count once they are not — "…and 43 more" is a list nobody finishes,
 *  and the number is the part that decides. Each title is bidi-isolated on
 *  its own: they are note-derived and may run either direction in one line. */
function referencingNames(impact: DeleteImpact): string {
  if (impact.referencingNotes > impact.referencing.length) {
    return countPhrase(impact.referencingNotes, "notes");
  }
  return impact.referencing.map((note) => `“${isolate(note.title)}”`).join(t("listSep"));
}

/** The one line that answers "what is in this folder, really". Attachments are
 *  named whenever there are any, and the reference clause is added only when
 *  a note that SURVIVES the delete still points at them — the case that
 *  broke a published essay. */
export function impactSentence(impact: DeleteImpact): string {
  const counts =
    impact.attachments === 0
      ? countPhrase(impact.notes, "notes")
      : tf("countsWithAttachments", {
          notes: countPhrase(impact.notes, "notes"),
          attachments: countPhrase(impact.attachments, "attachments"),
        });
  if (impact.referenced === 0) return counts;
  // A bare number here, not another "N attachments": the clause is already
  // inside the attachment count it qualifies ("60 attachments — 53 of them…").
  return `${counts} — ${tf("referencedBy", {
    count: localeNum(impact.referenced),
    notes: referencingNames(impact),
  })}`;
}

/** Delete one attachment, with the two speeds folders already have: `.trash/`
 *  by default, a second and graver dialog for erasing it from disk. Returns
 *  true when the file is gone. */
export async function confirmDeleteAttachment(path: string): Promise<boolean> {
  const impact = await deleteImpact(path, "attachment");
  const name = path.split("/").pop() ?? path;
  const warning =
    impact && impact.referenced > 0
      ? `${tf("attachmentStillEmbedded", { notes: referencingNames(impact) })} `
      : "";
  const result = await confirmModalEx({
    title: tf("deleteAttachmentTitle", { name }),
    body: `${warning}${tf("attachmentTrashBody", { path })}`,
    confirmLabel: t("moveToTrash"),
    extraLabel: t("deletePermanently"),
  });
  if (result === "cancel") return false;
  const permanent = result === "extra";
  if (permanent) {
    const ok = await confirmModal({
      title: tf("deleteAttachmentPermTitle", { name }),
      body: `${warning}${tf("attachmentPermBody", { path })}`,
      confirmLabel: t("deletePermanently"),
      grave: true,
    });
    if (!ok) return false;
  }
  try {
    await deleteAttachment(path, permanent);
    toast(
      permanent
        ? tf("attachmentDeletedToast", { name })
        : tf("attachmentTrashedToast", { name }),
    );
    return true;
  } catch (err) {
    console.error("vellum: deleting the attachment failed", err);
    toast(err instanceof Error ? err.message : t("deleteFailed"));
    return false;
  }
}

/** The extensions a drop-zone hint names — a representative handful, not the
 *  whole table (the full list lives in shared/attachments.ts and is what the
 *  file input's `accept` carries). */
export const HINT_EXTENSIONS: string = ["png", "jpeg", "svg", "pdf", "mp3", "mp4"]
  .filter((ext) => Object.prototype.hasOwnProperty.call(ATTACHMENT_TYPES, ext))
  .join(" · ");
