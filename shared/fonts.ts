// The two font-id facts both sides need to agree on, in one file so they
// cannot drift: what an option-preview family is called, and how a custom id
// is spelled.
//
// The settings panel renders EVERY option of the font picker in its own
// typeface, which means the client has to name a family that the server's
// generated stylesheet defined. One sanitizer, imported by both.

/** The `@font-face` family name that `GET /api/font-faces.css` gives one font
 *  id, and that the picker's option rows set as their `font-family`. */
export function optionFamily(id: string): string {
  return `VellumOpt-${id.replace(/[^A-Za-z0-9-]+/g, "-")}`;
}

/** Uploaded faces are named `custom:<file>` wherever a catalog id can appear
 *  (settings.fonts, the picker, /api/font-faces.css). */
export const CUSTOM_FONT_PREFIX = "custom:";

export function isCustomFontId(id: string): boolean {
  return id.startsWith(CUSTOM_FONT_PREFIX);
}
