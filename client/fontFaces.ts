// The font picker's own faces, loaded on demand.
//
// A picker that lists twenty-seven family NAMES in the interface font is not a
// picker: "Literata" and "Source Serif 4" are two words, not two typefaces,
// and nobody can choose between them by reading them. So every option row is
// drawn in the face it names — which means the panel has to have those faces.
//
// Loading all of them at once would be a megabyte of downloads to draw a menu
// (and, for a family the instance has never used, twenty-seven cold fetches
// from the server's cache-filling path). So they load a GROUP at a time, the
// first time that group is on screen: opening the Arabic picker fetches the
// naskh and kufi faces, and nothing fetches the monospace ones until the Code
// picker is opened.
//
// `GET /api/font-faces.css?ids=…` answers with one `@font-face` per id under
// its `VellumOpt-…` family (shared/fonts.ts names it for both sides). Each
// batch gets its own <link>, all of them tagged, so the panel can take them
// all away again when it closes: these families exist to draw a menu, and the
// app renders in the saved stylesheet.

import { optionFamily } from "../shared/fonts.ts";

const LINK_ATTR = "data-vellum-fontfaces";

/** Ids whose faces have been asked for in this session of the panel. */
const requested = new Set<string>();

/** Ask for any of `ids` that has not been asked for yet. Failures are silent
 *  by design (the same rule /api/font-preview.css follows): an option row
 *  falling back to the panel's own type is a legible row; a toast per
 *  keystroke is not. */
export function loadFontFaces(ids: string[]): void {
  const wanted = ids.filter((id) => id !== "" && !requested.has(id));
  if (wanted.length === 0) return;
  for (const id of wanted) requested.add(id);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.setAttribute(LINK_ATTR, "");
  link.href = `/api/font-faces.css?ids=${wanted.map((id) => encodeURIComponent(id)).join(",")}`;
  document.head.appendChild(link);
}

/** Drop every loaded batch (the settings panel unmounting). */
export function clearFontFaces(): void {
  requested.clear();
  for (const link of document.head.querySelectorAll(`link[${LINK_ATTR}]`)) link.remove();
}

/** The `font-family` value for one option row: the loaded face first, then the
 *  system stack its slot would otherwise use — so a row is legible before its
 *  face arrives, and stays legible if it never does. */
export function faceStack(id: string, fallback: string): string {
  return `"${optionFamily(id)}", ${fallback}`;
}
