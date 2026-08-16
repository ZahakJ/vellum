// Note text direction and alignment — the site default, and the per-note
// frontmatter override that beats it.
//
// Shared because three surfaces have to agree byte for byte (the editor's
// prose, the reading view and the blog article), and because the SERVER
// validates the same two enums the client renders. A fourth consumer is the
// broadcast: when a note disagrees with the site default the properties card
// and the status bar say so, and they name the SOURCE, so the resolution has
// to answer "where did this value come from" and not only "what is it".
//
// Direction is not alignment. `dir` decides the base direction of the
// paragraph (which end a line starts at, how neutral characters resolve, where
// a bidi run breaks); `text-align` decides where the line sits inside its box.
// `auto`/`start` — the defaults — are the pair that keeps today's behaviour:
// each block takes its own direction from its first strong character and
// starts at that direction's leading edge.

export type TextDirection = "auto" | "ltr" | "rtl";
export type TextAlign = "start" | "left" | "right" | "center" | "justify";

export const TEXT_DIRECTIONS: readonly TextDirection[] = ["auto", "ltr", "rtl"];
export const TEXT_ALIGNS: readonly TextAlign[] = ["start", "left", "right", "center", "justify"];

export const DEFAULT_TEXT_DIRECTION: TextDirection = "auto";
export const DEFAULT_TEXT_ALIGN: TextAlign = "start";

export function isTextDirection(value: unknown): value is TextDirection {
  return value === "auto" || value === "ltr" || value === "rtl";
}

export function isTextAlign(value: unknown): value is TextAlign {
  return (
    value === "start" || value === "left" || value === "right" || value === "center" || value === "justify"
  );
}

/** What a note asked for in its own frontmatter (absent keys stay undefined —
 *  "not stated" is a third state and must not collapse into the default). */
export interface NoteLayoutOverride {
  dir?: TextDirection;
  align?: TextAlign;
}

/** The pair in force for one note, plus where each half came from. */
export interface NoteLayout {
  dir: TextDirection;
  align: TextAlign;
  /** The note's own frontmatter set this, not the site setting. */
  dirFromNote: boolean;
  alignFromNote: boolean;
}

/** Frontmatter TEXT of a note, whichever fence it uses. Markdown's `---` block
 *  and LaTeX's `%--- … %---%` comment block (shared/tex.ts's spelling, with the
 *  inner `%` optional per line), so one caller covers both formats without
 *  importing the whole TeX reader into the client's first paint. */
export function frontmatterText(content: string): string {
  const src = content.replace(/\r\n/g, "\n");
  const md = /^---\n([\s\S]*?)\n(?:---|\.\.\.)(?:\n|$)/.exec(src);
  if (md) return md[1];
  const tex = /^%---\n([\s\S]*?)\n%---%?(?:\n|$)/.exec(src);
  if (tex) return tex[1].replace(/^[ \t]*%[ \t]?/gm, "");
  return "";
}

/** `dir:` / `align:` out of frontmatter TEXT. A deliberately tiny reader: both
 *  values are closed enums of bare words, so anything that is not one of them
 *  is IGNORED rather than coerced — a note that says `align: middle` gets the
 *  site default, not a guess. */
export function parseNoteLayout(fmText: string): NoteLayoutOverride {
  const out: NoteLayoutOverride = {};
  const dir = /^[ \t]*(?:dir|direction)[ \t]*:[ \t]*["']?([A-Za-z]+)["']?[ \t]*$/m.exec(fmText);
  if (dir) {
    const value = dir[1].toLowerCase();
    if (isTextDirection(value)) out.dir = value;
  }
  const align = /^[ \t]*(?:align|text-align|textAlign)[ \t]*:[ \t]*["']?([A-Za-z]+)["']?[ \t]*$/m.exec(fmText);
  if (align) {
    const value = align[1].toLowerCase();
    if (isTextAlign(value)) out.align = value;
    // "justified" and "centre" are what people type; accept them rather than
    // silently falling back to the site default on a value whose intent is
    // unambiguous.
    else if (value === "justified") out.align = "justify";
    else if (value === "centre" || value === "centered" || value === "centred") out.align = "center";
  }
  return out;
}

/** Site defaults + the note's own override → the pair in force, with sources. */
export function resolveNoteLayout(
  site: { dir: TextDirection; align: TextAlign },
  note: NoteLayoutOverride,
): NoteLayout {
  return {
    dir: note.dir ?? site.dir,
    align: note.align ?? site.align,
    dirFromNote: note.dir !== undefined && note.dir !== site.dir,
    alignFromNote: note.align !== undefined && note.align !== site.align,
  };
}

/** The note DIFFERS from the site default — the one question the broadcast
 *  asks. A note that spells out the value the site already uses is not a
 *  disagreement and must not light anything up. */
export function layoutDiffers(layout: NoteLayout): boolean {
  return layout.dirFromNote || layout.alignFromNote;
}

