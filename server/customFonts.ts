// Typography, second half: the operator's OWN faces.
//
// The catalog (fonts.ts) answers "pick one of the twenty-seven we know about".
// This module answers "use the one I bought / licensed / made", which is the
// only honest answer for a manuscript product: a serious Arabic instance runs
// on a face nobody publishes on a CDN.
//
// Everything here is uploaded bytes, so every rule is written for bytes that
// arrived over HTTP:
//
//   · the FORMAT is sniffed from the magic bytes (wOF2 / wOFF / 0x00010000 /
//     "true" / OTTO), never from the filename and never from the multipart
//     content-type — the extension is caller-controlled text;
//   · the stored NAME is a sanitized slug this module builds, plus a
//     collision counter, so nothing the caller sends is ever joined into a
//     path;
//   · the FAMILY name is read from the font's own `name` table when the file
//     lets us (sfnt directly, woff1 per-table zlib, woff2 through one brotli
//     pass), and falls back to the filename stem — a face called
//     "upload-3.woff2" in a picker is not a picker.
//
// The files live in VELLUM_DATA/fonts/custom/ — outside the vault, gitignored
// with the rest of VELLUM_DATA — and are served by GET /api/fonts/custom/:file
// exactly like the catalog cache: self-hosted, no external host, ever.

import { randomBytes } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { brotliDecompressSync, inflateSync } from "node:zlib";
import { FONT_UPLOAD_MAX_BYTES } from "../shared/limits.ts";
import type { CustomFontInfo, FontFormat } from "../shared/types.ts";
import { fontsDir } from "./site.ts";
import { VaultError } from "./vault.ts";

/** VELLUM_DATA/fonts/custom — every uploaded face lives here and nowhere else. */
export function customDir(): string {
  return path.join(fontsDir(), "custom");
}

/** ~5 MB. A woff2 text face is tens of KB; a full unhinted Arabic OTF with
 *  every mark position is the far end of "reasonable", and it is still under
 *  this. The route ALSO caps the wire body (bodyLimit) — this is the check on
 *  the decoded bytes. */
export const CUSTOM_FONT_MAX_BYTES = FONT_UPLOAD_MAX_BYTES;

/** Stored ids are `custom:<file>`; `<file>` is a name THIS module generated
 *  (lowercase slug + known extension), and every entry point re-checks the
 *  shape before it touches the disk. */
const CUSTOM_PREFIX = "custom:";
const FILE_RE = /^[a-z0-9][a-z0-9-]{0,79}\.(woff2|woff|ttf|otf)$/;

export function isCustomId(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX) && FILE_RE.test(id.slice(CUSTOM_PREFIX.length));
}

export function customIdFor(file: string): string {
  return `${CUSTOM_PREFIX}${file}`;
}

/** The basename an id names, or null when the id is not a well-formed custom
 *  id. Callers join the RESULT, never the id. */
export function customFileOf(id: string): string | null {
  return isCustomId(id) ? id.slice(CUSTOM_PREFIX.length) : null;
}

export function isCustomFileName(file: string): boolean {
  return FILE_RE.test(file);
}

/** Extension → the `format()` token and MIME type the routes serve with. */
const FORMAT_MIME: Record<FontFormat, string> = {
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

export function customMime(file: string): string {
  const ext = file.slice(file.lastIndexOf(".") + 1) as FontFormat;
  return FORMAT_MIME[ext] ?? "application/octet-stream";
}

export function formatOf(file: string): FontFormat {
  const ext = file.slice(file.lastIndexOf(".") + 1);
  return (ext === "woff" || ext === "ttf" || ext === "otf" ? ext : "woff2") as FontFormat;
}

/** The CSS `format()` token. `truetype`/`opentype` rather than the extension:
 *  that is what the descriptor takes. */
export function cssFormat(file: string): string {
  const fmt = formatOf(file);
  return fmt === "ttf" ? "truetype" : fmt === "otf" ? "opentype" : fmt;
}

// ------------------------------------------------------------------- sniffing

/** The format the BYTES say they are. The extension and the multipart
 *  content-type are both caller-controlled strings and neither is consulted:
 *  a PNG renamed .woff2 answers null here and the upload is a 400.
 *
 *  · `wOF2` / `wOFF` — the two WOFF wrappers;
 *  · `0x00010000` / `true` — TrueType outlines (the second is the old Mac
 *    spelling, still emitted by some tools);
 *  · `OTTO` — CFF (PostScript) outlines in an sfnt.
 *
 *  `ttcf` (a collection) is deliberately NOT accepted: @font-face cannot name
 *  one face inside a collection, so the file would be dead weight on disk. */
export function sniffFontFormat(buf: Buffer): FontFormat | null {
  if (buf.length < 16) return null;
  const tag = buf.subarray(0, 4).toString("latin1");
  if (tag === "wOF2") return "woff2";
  if (tag === "wOFF") return "woff";
  if (tag === "OTTO") return "otf";
  if (tag === "true" || buf.readUInt32BE(0) === 0x00010000) return "ttf";
  return null;
}

/** MAGIC BYTES SAY "CLAIMS TO BE A FONT", NOT "A BROWSER CAN USE THIS".
 *
 *  A 4.9 MB file of the literal `wOF2` followed by 4,900,000 zero bytes passed
 *  `sniffFontFormat`, was stored, was served with a font MIME, and rendered
 *  nothing — a permanently dead face on disk and a picker row that silently
 *  never draws, which the operator has no way to diagnose. This is one cheap
 *  structural read, not a validator: the table count has to be plausible and
 *  the table directory has to fit inside the file that carries it. Anything
 *  that survives here is still only *probably* a font — the browser remains
 *  the authority — but a file that fails here cannot possibly be one, so it is
 *  a 400 at upload time instead of a mystery afterwards.
 *
 *  No decompression happens here. The bomb ceiling above is what guards that,
 *  and this runs on the raw header either way. */
export function hasPlausibleTableDirectory(buf: Buffer, format: FontFormat): boolean {
  // A real face has cmap/head/hhea/hmtx/maxp/name/OS2/post at the very least;
  // the sfnt format tops out at 4096 tables and nothing ships near it.
  const plausible = (n: number): boolean => n >= 1 && n <= 512;
  try {
    if (format === "ttf" || format === "otf") {
      const numTables = buf.readUInt16BE(4);
      return plausible(numTables) && 12 + numTables * 16 <= buf.length;
    }
    if (format === "woff") {
      const numTables = buf.readUInt16BE(12);
      if (!plausible(numTables) || 44 + numTables * 20 > buf.length) return false;
      // Every entry's compressed extent must live inside the file.
      for (let i = 0; i < numTables; i++) {
        const rec = 44 + i * 20;
        const offset = buf.readUInt32BE(rec + 4);
        const compLength = buf.readUInt32BE(rec + 8);
        if (offset + compLength > buf.length) return false;
      }
      return true;
    }
    // woff2: the directory is variable-length, so "plausible" means "it parses
    // and leaves room for the brotli stream it says follows".
    const numTables = buf.readUInt16BE(12);
    if (!plausible(numTables)) return false;
    let at = 48;
    for (let i = 0; i < numTables; i++) {
      if (at >= buf.length) return false;
      const flags = buf[at++];
      if ((flags & 0x3f) === 0x3f) at += 4;
      const orig = readBase128(buf, at);
      if (!orig) return false;
      at = orig.next;
      const version = (flags >> 6) & 0x03;
      const tag = (flags & 0x3f) === 0x3f ? "" : (WOFF2_KNOWN_TAGS[flags & 0x3f] ?? "");
      const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
      if (transformed) {
        const trans = readBase128(buf, at);
        if (!trans) return false;
        at = trans.next;
      }
    }
    return at < buf.length;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- name table

/** The 63 known table tags, in the order the WOFF2 spec's 6-bit table-index
 *  field numbers them. Index 63 means "an explicit 4-byte tag follows". */
const WOFF2_KNOWN_TAGS = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm",
  "glyf", "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern",
  "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC",
  "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty",
  "just", "lcar", "mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat",
  "Gloc", "Feat", "Sill",
];

/** WOFF2's UIntBase128: 1–5 bytes, 7 bits each, high bit = "more follows". */
function readBase128(buf: Buffer, at: number): { value: number; next: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (at + i >= buf.length) return null;
    const byte = buf[at + i];
    if (i === 0 && byte === 0x80) return null; // leading zeros are invalid
    if (value > 0x01ffffff) return null; // would overflow 32 bits
    value = (value << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value: value >>> 0, next: at + i + 1 };
  }
  return null;
}

/** EVERY decompression here is a DECOMPRESSION BOMB until it is bounded.
 *
 *  `brotliDecompressSync`/`inflateSync` allocate whatever the stream expands
 *  to, synchronously, on the event loop, from bytes a caller uploaded. An
 *  800-byte file whose header claims one `name` table and whose brotli stream
 *  holds 900 MB of zeros drove this server's RSS from 189 MB to 2.96 GB and
 *  answered 200 — a ~1.9-million-to-one amplification that the 5 MB body cap
 *  does nothing about, and a handful in parallel is an OOM kill on any 1–2 GB
 *  VPS. The woff1 path was the same class: `origLength` is caller-controlled
 *  and was never used as a bound, so a 917 KB `.woff` expanded to 900 MB.
 *
 *  Both calls are bounded now, and bounded by the file's OWN arithmetic first:
 *  a WOFF2 stream is exactly the concatenation of its tables, so the directory
 *  we just parsed says how long it may be; a WOFF1 table entry states its own
 *  `origLength`. Whichever the file claims is then clamped by this ceiling.
 *  Node throws `ERR_BUFFER_TOO_LARGE` the moment the output would pass the
 *  limit — before the allocation, not after — and both calls already sit
 *  inside `nameTableBytes()`'s try/catch, so a bomb degrades to exactly what
 *  an unreadable font has always degraded to: the filename-derived family. */
const MAX_DECOMPRESSED_BYTES = 32 * 1024 * 1024;

/** Slack over the directory's own total, so a real encoder that pads or
 *  aligns its stream is not refused for a few bytes. */
const DECOMPRESS_SLACK = 64 * 1024;

/** The `name` table's bytes, from whichever container holds them. Returns null
 *  rather than throwing on anything malformed — a font we cannot introspect is
 *  a font that gets its filename as a family name, not a failed upload. */
function nameTableBytes(buf: Buffer, format: FontFormat): Buffer | null {
  try {
    if (format === "ttf" || format === "otf") return sfntTable(buf, 0, "name");
    if (format === "woff") return woffTable(buf, "name");
    return woff2Table(buf, "name");
  } catch {
    return null;
  }
}

function sfntTable(buf: Buffer, base: number, want: string): Buffer | null {
  const numTables = buf.readUInt16BE(base + 4);
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    if (rec + 16 > buf.length) return null;
    const tag = buf.subarray(rec, rec + 4).toString("latin1");
    if (tag !== want) continue;
    const offset = buf.readUInt32BE(rec + 8);
    const length = buf.readUInt32BE(rec + 12);
    if (offset + length > buf.length) return null;
    return buf.subarray(offset, offset + length);
  }
  return null;
}

/** WOFF1: a 44-byte header, then 20-byte directory entries carrying each
 *  table's own (optionally zlib-compressed) extent. */
function woffTable(buf: Buffer, want: string): Buffer | null {
  const numTables = buf.readUInt16BE(12);
  for (let i = 0; i < numTables; i++) {
    const rec = 44 + i * 20;
    if (rec + 20 > buf.length) return null;
    const tag = buf.subarray(rec, rec + 4).toString("latin1");
    if (tag !== want) continue;
    const offset = buf.readUInt32BE(rec + 4);
    const compLength = buf.readUInt32BE(rec + 8);
    const origLength = buf.readUInt32BE(rec + 12);
    if (offset + compLength > buf.length) return null;
    const slice = buf.subarray(offset, offset + compLength);
    if (compLength >= origLength) return slice;
    // `origLength` is the caller's claim about the decompressed size. Refuse an
    // absurd claim outright, and hold zlib to the claim it made either way.
    if (origLength > MAX_DECOMPRESSED_BYTES) return null;
    return Buffer.from(inflateSync(slice, { maxOutputLength: origLength }));
  }
  return null;
}

/** WOFF2: one brotli stream holding every table back to back, in directory
 *  order. Only glyf/loca are ever transformed, so `name` sits at the sum of
 *  the preceding tables' stored lengths and is read verbatim. */
function woff2Table(buf: Buffer, want: string): Buffer | null {
  const numTables = buf.readUInt16BE(12);
  let at = 48;
  const entries: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    if (at >= buf.length) return null;
    const flags = buf[at++];
    const index = flags & 0x3f;
    let tag: string;
    if (index === 0x3f) {
      if (at + 4 > buf.length) return null;
      tag = buf.subarray(at, at + 4).toString("latin1");
      at += 4;
    } else {
      tag = WOFF2_KNOWN_TAGS[index] ?? "????";
    }
    const orig = readBase128(buf, at);
    if (!orig) return null;
    at = orig.next;
    // The transform-version bits mean the OPPOSITE thing for glyf/loca: 0 is
    // the transformed form there and 3 is the null transform, while every
    // other table is untransformed at 0.
    const version = (flags >> 6) & 0x03;
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    let length = orig.value;
    if (transformed) {
      const trans = readBase128(buf, at);
      if (!trans) return null;
      at = trans.next;
      length = trans.value;
    }
    entries.push({ tag, length });
  }
  if (entries.length === 0) return null;
  // The stream IS the tables, back to back, so the directory states its own
  // decompressed length — which is both the tightest possible bound and one
  // the file cannot inflate without also claiming an absurd table.
  let total = 0;
  for (const entry of entries) {
    total += entry.length;
    if (total > MAX_DECOMPRESSED_BYTES) return null;
  }
  const stream = Buffer.from(
    brotliDecompressSync(buf.subarray(at), {
      maxOutputLength: Math.min(total + DECOMPRESS_SLACK, MAX_DECOMPRESSED_BYTES),
    }),
  );
  let offset = 0;
  for (const entry of entries) {
    if (entry.tag === want) {
      if (offset + entry.length > stream.length) return null;
      return stream.subarray(offset, offset + entry.length);
    }
    offset += entry.length;
    // Tables in the decompressed stream are 4-byte aligned in the reconstructed
    // sfnt, but NOT in the stream itself — no padding is added here on purpose.
  }
  return null;
}

/** Name records worth reading, best first: typographic family (16) beats the
 *  legacy family (1), because a face called "Amiri Quran Colored Bold" stores
 *  the useful half in 16. */
const NAME_IDS = [16, 1];

/** The family name inside a `name` table, or null. Windows/Unicode records are
 *  UTF-16BE; the Macintosh platform's are (near enough) latin1. */
function familyFromNameTable(table: Buffer): string | null {
  if (table.length < 6) return null;
  const count = table.readUInt16BE(2);
  const stringOffset = table.readUInt16BE(4);
  let best: { rank: number; text: string } | null = null;
  for (let i = 0; i < count; i++) {
    const rec = 6 + i * 12;
    if (rec + 12 > table.length) break;
    const platform = table.readUInt16BE(rec);
    const encoding = table.readUInt16BE(rec + 2);
    const language = table.readUInt16BE(rec + 4);
    const nameId = table.readUInt16BE(rec + 6);
    const length = table.readUInt16BE(rec + 8);
    const offset = table.readUInt16BE(rec + 10);
    const idRank = NAME_IDS.indexOf(nameId);
    if (idRank < 0) continue;
    const start = stringOffset + offset;
    if (start + length > table.length) continue;
    const raw = table.subarray(start, start + length);
    // A Windows/Unicode record is UTF-16BE; Node has no such decoder, so the
    // bytes are pair-swapped into UTF-16LE. Macintosh records are latin1.
    const utf16 = platform === 3 || platform === 0;
    const decoded = utf16 ? decodeUtf16BE(raw) : raw.toString("latin1");
    // Control characters and quotes never belong in a family name, and this
    // string is about to land in a CSS descriptor.
    const clean = decoded.replace(/[\u0000-\u001f\u007f"\\]/g, "").trim();
    if (!clean) continue;
    // Prefer a Windows-English record, then any Unicode one, then Mac.
    const platformRank = platform === 3 && language === 0x0409 ? 0 : platform === 3 ? 1 : platform === 0 ? 2 : 3;
    const rank = idRank * 10 + platformRank;
    if (!best || rank < best.rank) best = { rank, text: clean };
  }
  return best ? best.text.slice(0, 60) : null;
}

function decodeUtf16BE(raw: Buffer): string {
  const swapped = Buffer.from(raw);
  if (swapped.length % 2 !== 0) return raw.toString("latin1");
  swapped.swap16();
  return swapped.toString("utf16le");
}

/** The family name the browser will know this file by, best effort. */
export function readFamilyName(buf: Buffer, format: FontFormat): string | null {
  const table = nameTableBytes(buf, format);
  return table ? familyFromNameTable(table) : null;
}

// ------------------------------------------------------------------- storage

/** Client filename → the slug this module stores under. Everything outside
 *  [a-z0-9-] becomes a hyphen, so the stored name is a subset of FILE_RE by
 *  construction and no caller string is ever joined into a path.
 *
 *  Returns "" when nothing survives — see `storedStem()` for what happens
 *  then, which is the whole reason this no longer answers "font" itself. */
function slugify(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const stem = base.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  return stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** THE ARABIC OPERATOR MUST NOT END UP WITH `font-3.otf`.
 *
 *  `slugify` keeps ASCII and nothing else, which is deliberate and stays: the
 *  stored name is joined into a filesystem path, into a route param and — raw,
 *  unencoded — into a `url()` inside the generated stylesheet, and "URL-safe
 *  ASCII by construction" is what makes all three of those safe without a
 *  single escaping rule. The cost was paid by exactly the reader this feature
 *  exists for: `خط-عربي.otf` kept nothing, fell to the literal "font", and the
 *  next two uploads became `font-2.otf` / `font-3.otf`. The picker survived on
 *  the name table; the About tab's fonts folder and the disk did not.
 *
 *  So when the filename yields nothing, the FONT'S OWN family name is asked
 *  next — `خط-عربي.otf` carrying "Amiri" is stored `amiri.otf`, which is the
 *  name the operator will see in the picker anyway. "font" is the third
 *  answer, not the first. */
function storedStem(originalName: string, family: string | null): string {
  return slugify(originalName) || (family ? slugify(family) : "") || "font";
}

/** The sidecar index: file → { family, uploaded }. The DIRECTORY is the source
 *  of truth for what exists (a face dropped in by hand still shows up); this
 *  only remembers what the bytes told us at upload time. */
interface CustomIndex {
  [file: string]: { family?: string; uploaded?: string };
}

const INDEX_FILE = "index.json";

async function readIndex(): Promise<CustomIndex> {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(customDir(), INDEX_FILE), "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    return raw as CustomIndex;
  } catch {
    return {};
  }
}

/** The tmp file is per WRITER, never a fixed `index.json.tmp`.
 *
 *  Two concurrent uploads used to write the SAME temporary path and then both
 *  rename it: the first rename moved the file, the second found nothing there
 *  and threw `ENOENT: rename index.json.tmp -> index.json`, which the route
 *  turned into a 500 — while that upload's BYTES were already on disk. The
 *  admin was told the upload failed and the face appeared anyway on the next
 *  refresh. Measured with four parallel POSTs: three 500s. */
async function writeIndex(index: CustomIndex): Promise<void> {
  const file = path.join(customDir(), INDEX_FILE);
  const tmp = `${file}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`;
  try {
    await fsp.writeFile(tmp, `${JSON.stringify(index, null, 2)}\n`, "utf8");
    await fsp.rename(tmp, file);
  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

/** EVERY write to this directory goes through here, one at a time.
 *
 *  A unique tmp name stops the crash but not the LOSS: `saveCustomFont` reads
 *  the index, awaits (the family read, the byte write), then writes the whole
 *  object back, so a writer that read before a neighbour's rename overwrites
 *  that neighbour's row — the name table is discarded and the face falls back
 *  to a filename-derived family, which is the entire point of the sidecar.
 *  The filename allocation is the same shape and worse: `access`-then-`write`
 *  let four uploads pick the same free name and clobber each other's bytes.
 *  Four parallel POSTs of four distinct faces, all named `race.ttf`, left TWO
 *  files on disk, one of them labelled with a different font's family.
 *
 *  Uploads are admin-only and rare, so the whole critical section — pick a
 *  free name, write the bytes, merge the index row — is serialized behind one
 *  promise chain rather than being made cleverly atomic. The chain never
 *  rejects (a failed job's error goes to its own caller), so one bad upload
 *  cannot wedge the next. Callers must not nest: everything inside runs on
 *  the RAW `readIndex`/`writeIndex`. */
let indexQueue: Promise<unknown> = Promise.resolve();

function serialized<T>(job: () => Promise<T>): Promise<T> {
  const run = indexQueue.then(job, job);
  indexQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Every uploaded face on disk, newest first. Files whose names do not match
 *  the generated shape are ignored rather than listed — the CSS generator and
 *  the file route would refuse them anyway, and a row that cannot be picked is
 *  worse than no row. */
export async function listCustomFonts(): Promise<CustomFontInfo[]> {
  let names: string[];
  try {
    names = await fsp.readdir(customDir());
  } catch {
    return [];
  }
  const index = await readIndex();
  const out: CustomFontInfo[] = [];
  for (const file of names) {
    if (!isCustomFileName(file)) continue;
    let size = 0;
    let mtime = 0;
    try {
      // lstat: a symlink is not an uploaded face. The GET route refuses one
      // (see api.ts), so listing it would advertise a row that 404s.
      const stat = await fsp.lstat(path.join(customDir(), file));
      if (!stat.isFile()) continue;
      size = stat.size;
      mtime = stat.mtimeMs;
    } catch {
      continue;
    }
    const meta = index[file] ?? {};
    out.push({
      id: customIdFor(file),
      file,
      family: meta.family && meta.family.trim() !== "" ? meta.family : fallbackFamily(file),
      format: formatOf(file),
      size,
      uploaded: meta.uploaded ?? new Date(mtime).toISOString(),
    });
  }
  out.sort((a, b) => (a.uploaded < b.uploaded ? 1 : a.uploaded > b.uploaded ? -1 : 0));
  return out;
}

/** "my-naskh-regular.woff2" → "My Naskh Regular" — the last resort when the
 *  file carries no readable name table. */
function fallbackFamily(file: string): string {
  const stem = file.slice(0, file.lastIndexOf("."));
  return stem
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** One uploaded face, already sniffed. Writes bytes first, then the index
 *  entry — a crash between the two leaves a usable font with a filename-derived
 *  family, never an index row pointing at nothing. The whole thing runs inside
 *  `serialized()`: see its comment for what concurrent uploads did without it. */
export async function saveCustomFont(
  originalName: string,
  format: FontFormat,
  bytes: Buffer,
): Promise<CustomFontInfo> {
  return serialized(async () => {
    const dir = customDir();
    await fsp.mkdir(dir, { recursive: true });
    // The name table is read BEFORE the filename is chosen: it is the fallback
    // when the client's filename slugs to nothing (see storedStem).
    const nameTableFamily = readFamilyName(bytes, format);
    const slug = storedStem(originalName, nameTableFamily);
    let file = `${slug}.${format}`;
    for (let i = 2; i <= 200; i++) {
      try {
        await fsp.access(path.join(dir, file));
      } catch {
        break; // free
      }
      file = `${slug}-${i}.${format}`;
      if (i === 200) throw new VaultError(409, "Could not find a free filename for the font", "font_no_free_name");
    }
    if (!isCustomFileName(file)) throw new VaultError(400, "Could not build a safe filename for the font", "font_bad_name");
    // wx: the name was free a tick ago and nothing else may claim it now, but
    // a face dropped in by hand is not this module's to overwrite.
    await fsp.writeFile(path.join(dir, file), bytes, { flag: "wx" });
    const family = nameTableFamily ?? fallbackFamily(file);
    const uploaded = new Date().toISOString();
    const index = await readIndex();
    index[file] = { family, uploaded };
    await writeIndex(index);
    return { id: customIdFor(file), file, family, format, size: bytes.byteLength, uploaded };
  });
}

/** Remove one uploaded face. In-use protection is the CALLER's (the route
 *  checks the slots), because this module never reads settings.json. */
export async function deleteCustomFont(file: string): Promise<void> {
  if (!isCustomFileName(file)) throw new VaultError(400, "Invalid font file name", "font_bad_name");
  // Same chain as the uploader: a delete that read the index while an upload
  // held it would write the neighbour's new row straight back out.
  return serialized(async () => {
    try {
      await fsp.unlink(path.join(customDir(), file));
    } catch {
      throw new VaultError(404, `Font not found: ${file}`, "font_not_found");
    }
    const index = await readIndex();
    if (Object.prototype.hasOwnProperty.call(index, file)) {
      delete index[file];
      await writeIndex(index);
    }
  });
}

/** True when the id names a file that is actually on disk. */
export async function customFontExists(id: string): Promise<boolean> {
  const file = customFileOf(id);
  if (!file) return false;
  try {
    const stat = await fsp.lstat(path.join(customDir(), file));
    return stat.isFile();
  } catch {
    return false;
  }
}
