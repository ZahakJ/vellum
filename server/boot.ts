// THE FIRST PAINT IS THE RIGHT PAINT — what the served shell already knows.
//
// A visitor's page used to boot as an APP: the store's `publicLayout` started
// at "app", `data-theme` was whatever `readTheme()` fell back to, and the
// browser learned it was on a DESIGNED site only when /api/me answered and
// learned what the design WAS a fetch later still. Measured on the owner's own
// site: the stock blog's masthead and menu painted at ~204ms and the designed
// console replaced them at ~259ms — a whole other site, for a twentieth of a
// second, on every refresh. The owner saw it and called it "a page that is not
// the layout I have".
//
// None of that was unknowable. The server is already rewriting the shell
// (`serveShell`: title, meta, lang/dir, preloads), the layout is configuration,
// the session is a cookie it is reading anyway, and the design document is in
// memory. So the shell carries a boot payload: the layout, the theme the page
// will land on, and — when the site is designed — the document itself,
// scrubbed and language-scoped exactly as /api/design/public scrubs it, by the
// same function. The client boots into the right room and the designed site
// renders its first frame with the design in hand.
//
// ONLY FOR SESSIONS THAT ARE SHOWN THE PUBLIC SITE. An admin's shell keeps the
// app and their own stored theme; the payload is omitted rather than sent and
// ignored, so the rule "the owner's editor is not the public site" holds in
// the HTML as it does in /api/me.
//
// IT IS A HINT THE CLIENT RE-VERIFIES, not a second source of truth: the
// client still validates the document with the shared validator and still
// obeys /api/me. A stale payload costs one wasted first frame, which is the
// failure the whole file exists to prevent and is therefore the one it can
// afford.

import type { Context } from "hono";
import { isPublishLimited, servedLayout } from "./auth.ts";
import { activeDesign } from "./designs.ts";
import { visitorSafe } from "./designRoutes.ts";
import { languageScope } from "./language.ts";
import { visitorTheme } from "./site.ts";
import { hasThemeChoice } from "./designs.ts";

export interface BootPayload {
  layout: "blog" | "designed";
  /** The language the document was scoped to; absent when the instance
   *  filters by none, in which case the document is the same in both. */
  lang?: string;
  theme?: string;
  design?: unknown;
}

/** The payload for this request, or null for a session that mounts the app. */
export function bootPayload(c: Context): BootPayload | null {
  if (!isPublishLimited(c)) return null;
  const layout = servedLayout();
  if (layout === "app") return null;
  const lang = languageScope(c, true).lang;
  const out: BootPayload = { layout };
  if (lang) out.lang = lang;
  if (layout === "designed") {
    const { design } = activeDesign();
    if (design) {
      out.design = visitorSafe(design, lang);
      // Same precedence /api/me applies: the design's theme outranks the
      // instance default, and the client's stored choice outranks both.
      if (design.theme && hasThemeChoice(design.theme)) out.theme = design.theme;
    }
  }
  if (!out.theme) {
    const site = visitorTheme();
    if (site && hasThemeChoice(site)) out.theme = site;
  }
  return out;
}

/** `data-theme` on the <html> tag and the payload as a JSON block, spliced into
 *  a shell that `injectHead` has already rewritten.
 *
 *  `<script type="application/json">`, NOT an executing script. The public
 *  site is served under `script-src 'self'` (server/api.ts), which is right
 *  and is not being weakened for a boot hint: the first cut of this file
 *  wrote `<script>window.__vellum=…</script>` and every browser refused it —
 *  shoot-design's console assertion caught it, the payload never existed,
 *  and the store fell back to iron-gall for a frame before /api/me while the
 *  <html> tag beside it said phosphor. A JSON block is data the page reads,
 *  not code the page runs, so the policy has nothing to say about it. Every
 *  `<` in the JSON is escaped, so a design whose text carries `</script>`
 *  cannot close the block it is travelling in. */
export function injectBoot(html: string, boot: BootPayload | null): string {
  if (!boot) return html;
  let out = html;
  if (boot.theme) {
    out = out.replace(/<html\b/, `<html data-theme="${boot.theme.replace(/"/g, "&quot;")}"`);
  }
  const json = JSON.stringify(boot).replace(/</g, "\\u003c");
  const at = out.indexOf("</head>");
  if (at < 0) return out;
  return `${out.slice(0, at)}    <script type="application/json" id="vellum-boot">${json}</script>\n  ${out.slice(at)}`;
}
