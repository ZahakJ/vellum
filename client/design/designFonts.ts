// THE DESIGNER'S OWN FACES — one <link> in <head>, at the union of every face
// the panel is currently drawing.
//
// A published design's faces reach a visitor through /api/site-fonts.css: the
// server reads the ACTIVE design, and /api/me's font signature makes the client
// link the sheet. That answers the site and nothing else. Inside the designer
// there are two more surfaces drawing designs that are not the active one:
//
//   · THE PREVIEW, drawing an unsaved draft. The author picks EB Garamond and
//     the pane has to show EB Garamond before Save, or the control is a
//     promise instead of a preview.
//   · THE GALLERY, drawing fifty-nine preset cards at once — real
//     `<DesignCanvas>` renders, each with its own typography. A card that sells
//     "the letterpress salon" in the instance's default serif is selling the
//     wrong design.
//
// ONE LINK SERVES BOTH, AND IT LIVES IN document.head, which is the load-
// bearing detail. The gallery's cards are drawn in the app's own document, so
// a sheet in <head> reaches them with nothing added. The preview is an
// `about:blank` iframe that CLONES `document.head`'s stylesheets and keeps them
// in sync with a MutationObserver (client/design/PreviewFrame.tsx) — so the
// same link reaches the frame for free, at the same href, defining the same
// families the live site will define. Three surfaces, one stylesheet, no
// per-surface plumbing.
//
// WHY THE NODE IS REPLACED RATHER THAN RE-POINTED. `PreviewFrame` watches
// `document.head` for CHILD LIST changes (deliberately: a diffed sync is what
// stops a flash of raw HTML on every edit). Setting `href` on a link already in
// the head is an attribute change, which that observer does not see — the frame
// would keep yesterday's families while the outer document had today's. So a
// changed URL is a removed node and an added one, which is a change the frame
// can see. The cost is one re-fetch of a `no-cache` admin stylesheet, on the
// rare event of an author choosing a different typeface.

import { designFontRefSpec, type DesignFontRef } from "../../shared/fontCatalog.ts";

const ATTR = "data-vellum-design-fonts";

/** What each surface is asking for, by key. Two live at once — the draft and
 *  the gallery — and they come and go independently (opening the gallery
 *  unmounts the preview stage but not the draft), so the link is the UNION and
 *  never the last writer's answer. */
const wanted = new Map<string, DesignFontRef[]>();

/** The cap the route enforces anyway, mirrored here so the URL cannot grow
 *  without bound. Sixty presets share a handful of faces in practice; if a
 *  future catalog genuinely names more than this, the cards past the cap paint
 *  in the instance's stacks, which is the same graceful nothing a face that
 *  will not download produces. */
const MAX_REFS = 24;

/**
 * Declare the faces one surface needs. Pass `[]` on unmount — a key with no
 * refs contributes nothing, and when every key is empty the link is removed
 * entirely rather than left asking for nothing.
 */
export function setDesignFonts(key: string, refs: DesignFontRef[]): void {
  if (refs.length === 0) wanted.delete(key);
  else wanted.set(key, refs);
  syncLink();
}

function syncLink(): void {
  const spec = designFontRefSpec([...wanted.values()].flat().slice(0, MAX_REFS));
  const existing = document.head.querySelector<HTMLLinkElement>(`link[${ATTR}]`);
  if (spec === "") {
    existing?.remove();
    return;
  }
  const href = `/api/design/fonts.css?ids=${encodeURIComponent(spec)}`;
  if (existing?.getAttribute("href") === href) return;
  existing?.remove();
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.setAttribute(ATTR, "");
  // After the instance's own /api/site-fonts.css, so where both define a
  // family (the active design's, while it is also the one being edited) the
  // later definition is the one the draft asked for. Before custom.css for the
  // same reason the site sheet is: an operator's hand-written override
  // outranks everything generated.
  const custom = document.head.querySelector("link[data-vellum-custom]");
  if (custom) document.head.insertBefore(link, custom);
  else document.head.appendChild(link);
}
