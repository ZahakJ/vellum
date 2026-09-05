// Attachment policy — the one place client and server agree on WHAT may be
// uploaded and WHERE it lands. Both halves need it: the server enforces
// (bytes are sniffed, paths are re-validated), the client refuses locally so a
// file the server would reject is never put on the wire and the reader hears
// why while the drop is still in their hand.

// ── Where new attachments go ────────────────────────────────────────────────
// The four modes are Obsidian's "Default location for new attachments", named
// the same way so a migrating vault owner finds what they expect:
//
//   vault-root   → the vault's top level
//   same-folder  → beside the note being edited
//   subfolder    → a named subfolder OF the note's folder ("assets")
//   specified    → one fixed vault-relative folder ("attachments") — the
//                  behaviour every Vellum instance had before this setting,
//                  and therefore the default.
//
// Nothing already on disk moves when this changes: it decides where the NEXT
// upload is written, and existing embeds keep resolving by basename anyway.

export type AttachmentMode = "vault-root" | "same-folder" | "subfolder" | "specified";

export const ATTACHMENT_MODES: readonly AttachmentMode[] = [
  "vault-root",
  "same-folder",
  "subfolder",
  "specified",
];

export function isAttachmentMode(value: unknown): value is AttachmentMode {
  return typeof value === "string" && (ATTACHMENT_MODES as readonly string[]).includes(value);
}

/** The resolved policy: a mode plus the folder name the two folder-bearing
 *  modes use ("attachments" by default — i.e. ATTACHMENTS_DIR). */
export interface AttachmentLocation {
  mode: AttachmentMode;
  folder: string;
}

/** True when a mode reads the `folder` value at all (the UI greys the field
 *  out for the other two rather than pretending it matters). */
export function modeUsesFolder(mode: AttachmentMode): boolean {
  return mode === "subfolder" || mode === "specified";
}

/** Canonical vault-relative form of a folder value: backslashes to slashes,
 *  leading/trailing slashes trimmed, "." segments dropped. Cheap and total —
 *  it never throws; `folderError` is what judges the result. */
export function normalizeFolder(value: string): string {
  return value
    .replace(/\\/g, "/")
    .split("/")
    .map((seg) => seg.trim())
    .filter((seg) => seg !== "" && seg !== ".")
    .join("/");
}

/** Why a folder value is unusable, or null when it is fine. The reasons are
 *  keys, not sentences: the client maps them to localized copy, the server to
 *  a 400 message. Empty is allowed and means "the vault root". */
export type FolderProblem = "traversal" | "absolute" | "dotfolder" | "control" | "tooLong";

export function folderError(value: string): FolderProblem | null {
  const raw = value.trim();
  if (raw === "") return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "control";
  if (raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw)) return "absolute";
  const rel = normalizeFolder(raw);
  if (rel.length > 180) return "tooLong";
  const segments = rel.split("/");
  if (segments.includes("..")) return "traversal";
  // Dot-folders are invisible to the tree, the indexer and the watcher, so an
  // attachment written into one would silently never resolve again.
  if (segments.some((seg) => seg.startsWith("."))) return "dotfolder";
  return null;
}

/** The vault-relative directory an upload lands in, given the policy and the
 *  folder the upload happened IN (the open note's folder, the tree row that
 *  was dropped on). `contextDir` is "" for the vault root, and an unknown
 *  context degrades gracefully to the root rather than guessing. */
/**
 * WHERE AN UPLOAD LANDS, given what it is and where it was dropped.
 *
 * `resolveAttachmentDir` below answers for an ATTACHMENT: the location setting
 * has the last word and the drop target is only context — right for an image
 * that belongs to a note and is embedded from wherever it lives. A BOOK is not
 * that. A PDF in the tree IS a document (client/books/door.ts opens one as a
 * book), and a reader who drags one onto `Library/` is FILING it there, not
 * attaching it to anything. The owner did exactly that and watched it land in
 * `attachments/` — the default mode is "specified", so the folder they aimed
 * at was ignored by design, and the design was wrong for this file.
 *
 * So a book dropped on a folder is filed in that folder, and everything else
 * keeps the setting. `filed` is the CLIENT's statement that the drop was a
 * filing (a tree drop, as opposed to a paste into a note); `ext` is the
 * SERVER's sniffed type, so a renamed image cannot ride into a folder the
 * setting would have kept it out of.
 */
export function uploadDestination(
  loc: AttachmentLocation,
  contextDir: string,
  ext: string,
  filed: boolean,
): string {
  if (filed && ext === "pdf") return normalizeFolder(contextDir);
  return resolveAttachmentDir(loc, contextDir);
}

export function resolveAttachmentDir(loc: AttachmentLocation, contextDir: string): string {
  const context = normalizeFolder(contextDir);
  const folder = normalizeFolder(loc.folder);
  switch (loc.mode) {
    case "vault-root":
      return "";
    case "same-folder":
      return context;
    case "subfolder":
      return folder === "" ? context : context === "" ? folder : `${context}/${folder}`;
    case "specified":
      return folder;
  }
}

// ── What may be uploaded ────────────────────────────────────────────────────
// Obsidian's vault holds more than images — a PDF of the paper being annotated,
// the interview recording a note transcribes — and `![[file.pdf]]` already
// renders and downloads through /api/file. The wire list below is what the
// uploader accepts; the server still sniffs the BYTES (extension and
// Content-Type are attacker-controlled), so this list bounds the client's
// optimism, never the server's trust.

/** Accepted extension → the MIME type an <input accept=…> should advertise.
 *  Aliases (jpeg, m4v, oga) map to the same family and are kept as typed. */
export const ATTACHMENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  heic: "image/heic",
  bmp: "image/bmp",
  pdf: "application/pdf",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

/** The `accept` attribute for a file input — extensions AND mime types, since
 *  browsers disagree about which they honour for exotic kinds. */
export const ATTACHMENT_ACCEPT: string = [
  ...Object.keys(ATTACHMENT_TYPES).map((ext) => `.${ext}`),
  ...new Set(Object.values(ATTACHMENT_TYPES)),
].join(",");

/** Lower-cased extension of a filename, without the dot ("" when there is none). */
export function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}

/** Every MIME type the table advertises, for the type-only fallback below. */
const ACCEPTED_MIME = new Set(Object.values(ATTACHMENT_TYPES));

/** True when the uploader will even try this file. The extension decides
 *  first — a browser hands us `application/octet-stream` for half of these
 *  types — but a file with NO usable extension is judged by its MIME instead:
 *  an image pasted from the clipboard often arrives as a nameless blob, and
 *  refusing that would break the oldest upload path in the app. The server's
 *  byte sniff is the real gate either way. */
export function isAcceptedAttachment(name: string, type = ""): boolean {
  const ext = extensionOf(name);
  if (ext !== "") return Object.prototype.hasOwnProperty.call(ATTACHMENT_TYPES, ext);
  return ACCEPTED_MIME.has(type.trim().toLowerCase());
}
