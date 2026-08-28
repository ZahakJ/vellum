// HTTP surface for the design store and the custom theme builder.
//
// Mounted under /api/design from server/api.ts, BELOW `api.use("*", authGuard)`
// — so every mutation here is already 401 to a visitor and to an admin session
// wearing the preview header, exactly like every other non-GET route. What the
// guard cannot do is gate a GET, so every admin GET below says
// `assertAdminRead(c)` in its first line.
//
// Two routes are deliberately NOT admin-only, and both are the public site's
// own styling rather than its configuration:
//   · GET /api/design/public     — the active design as a VISITOR may see it
//   · GET /api/design/themes.css — the custom-theme override stylesheet
// The first is scrubbed per session (see visitorSafe); the second contains
// nothing but hex colours out of a closed allowlist.

import { Hono } from "hono";
import type { Context } from "hono";
import { isPublishLimited } from "./auth.ts";
import {
  activeDesign,
  activeDesignFontRefs,
  activeDesignId,
  createDesign,
  customThemes,
  customThemesStylesheet,
  deleteCustomTheme,
  deleteDesign,
  designSummaries,
  duplicateDesign,
  exportDesign,
  getDesign,
  importDesign,
  putCustomTheme,
  putDesign,
  resetDesign,
  setActiveDesign,
} from "./designs.ts";
import { isNoteVisibleToVisitor, pages, posts, type FilterLang } from "./indexer.ts";
import { languageScope } from "./language.ts";
import { DESIGN_SCHEMA, SECTION_KINDS, type DesignDoc } from "../shared/design.ts";
import { designFontRefs, type NavItem } from "../shared/designChrome.ts";
import { parseDesignFontRefs } from "../shared/fontCatalog.ts";
import { buildDesignFontCss, designCatalogIds, ensureFontsCached } from "./fonts.ts";
import { fontSlots } from "./settings.ts";
import { THEME_TOKENS } from "../shared/customTheme.ts";
import { normalizeRel, VaultError } from "./vault.ts";

export const designRoutes = new Hono();

/** Admin-eyes-only READ. 401 rather than 404: the whole point of the preview
 *  header is that an admin asked to be treated as a visitor, and the honest
 *  answer to "may I read the design panel while pretending not to be admin" is
 *  "not with that header on". Mutations never reach here — authGuard 401s them
 *  one layer up. */
function assertAdminRead(c: Context): void {
  if (isPublishLimited(c)) throw new VaultError(401, "Admin session required");
}

async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new VaultError(400, "Invalid JSON body");
  }
}

/**
 * The design as a session that may not read the whole vault is allowed to see
 * it.
 *
 * Exactly one field is session-dependent: a `note` section's PATH. Everything
 * else in a design is styling the visitor is about to look at anyway. A
 * section pointing at a note this session cannot read has its path blanked
 * rather than the section dropped, and that is the load-bearing choice:
 *   · the path never travels, so the design cannot become a
 *     "does this note exist" oracle for the publish set or the language
 *     filter — the leak every visitor surface in CONTRACTS is written to
 *     avoid;
 *   · the section still ARRIVES, so the client's renderer meets a section it
 *     cannot render, throws, and the error boundary does what it does for
 *     every other broken design: visitors fall to the stock blog, and the
 *     admin (whose own copy carries the real path) is told which section and
 *     which note.
 * Dropping the section instead would have shown visitors a silently shorter
 * homepage, which is the invisible-state failure this product keeps refusing.
 */
/**
 * A nav item's target, as a visitor may see it — and here the answer is the
 * OPPOSITE of a section's, on purpose.
 *
 * A section is CONTENT: blanking its path leaves a section the client cannot
 * render, the boundary fires, and the visitor falls to the stock blog (see
 * visitorSafe below). A nav item is a LINK, and a menu is chrome: the honest
 * failure for a link whose target this session cannot read is to not offer the
 * link. Blanking it would ship a menu row pointing at "/" under an unrelated
 * label; keeping it would ship a guaranteed 404 and name an unpublished note
 * in the markup. So it is dropped — and a `group` left with no children is
 * dropped after it, because an empty submenu is a dead affordance.
 *
 * This leaks nothing a visitor could read as an oracle: they have no admin
 * copy to compare a shorter menu against.
 */
function navSafe(items: NavItem[], lang: FilterLang): NavItem[] {
  const keep = (item: NavItem): boolean => {
    if (item.kind !== "note" && item.kind !== "page") return true;
    if (!item.target) return false;
    try {
      return isNoteVisibleToVisitor(normalizeRel(item.target), lang);
    } catch {
      return false;
    }
  };
  const out: NavItem[] = [];
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      const children = item.children.filter(keep);
      if (item.kind === "group" && children.length === 0) continue;
      out.push({ ...item, children });
      continue;
    }
    if (keep(item)) out.push(item);
  }
  return out;
}

function visitorSafe(design: DesignDoc, lang: FilterLang): DesignDoc {
  const sections = design.sections.map((section) => {
    if (section.kind !== "note" || section.note === "") return section;
    let visible = false;
    try {
      visible = isNoteVisibleToVisitor(normalizeRel(section.note), lang);
    } catch {
      visible = false;
    }
    return visible ? section : { ...section, note: "" };
  });
  return {
    ...design,
    sections,
    chrome: {
      ...design.chrome,
      nav: { ...design.chrome.nav, items: navSafe(design.chrome.nav.items, lang) },
    },
  };
}

// ── Public: what the designed site renders from ─────────────────────────────

designRoutes.get("/public", (c) => {
  const limited = isPublishLimited(c);
  const { design, notice } = activeDesign();
  const lang = languageScope(c, limited).lang;
  return c.json({
    schema: DESIGN_SCHEMA,
    design: design ? (limited ? visitorSafe(design, lang) : design) : null,
    themes: customThemes(),
    // The notice names a design and quotes the store's own diagnosis; it is
    // admin copy and never travels to a visitor (or to an admin who asked to
    // be treated as one).
    notice: limited ? null : notice,
    // Which URLs this session may reach as PAGES rather than as articles.
    // Visitor-scoped by the same languageFilter as every other public list.
    pages: pages(limited, lang),
  });
});

/** The custom-theme override stylesheet. Open for custom.css's reason: it is
 *  pure styling, it names no vault content, and the login page of a
 *  PUBLIC=false instance should render in the instance's own colours.
 *  `immutable` is safe because the link carries a content signature as `?v=`
 *  — a changed theme is a changed URL. */
designRoutes.get("/themes.css", (c) =>
  c.body(customThemesStylesheet(), 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "public, max-age=31536000, immutable",
  }),
);

// ── Admin: the designer's own faces ─────────────────────────────────────────

/**
 * THE DRAFT FACES, AND THE GALLERY'S.
 *
 * `/api/site-fonts.css` serves the faces the ACTIVE design names, because that
 * is what a visitor's page needs. The designer needs three more things that
 * route cannot give it: the faces of a draft that has not been saved, the
 * faces of the fifty-nine presets whose cards paint real designs, and both of
 * them WITHOUT a save. So the panel keeps one `<link>` at the union of what it
 * is currently drawing and this answers it.
 *
 * THE FAMILY NAMES ARE THE LIVE SITE'S, not a "preview" prefix. The settings
 * panel's own preview sheet uses `VellumPreview…` because it has to sit BESIDE
 * the saved families and show something different from them; here the whole
 * point is that the pane shows exactly what will ship, and the design's
 * `--dsg-head-font` names one family whether it is drawn in the preview frame,
 * on a gallery card or on the public site. Two sheets defining the same family
 * from the same cached files is a duplicate `@font-face`, which is free.
 *
 * ADMIN-ONLY, for /api/font-preview.css's reason: it can trigger a download.
 * And just as forgiving — a family that will not cache is skipped, the design
 * falls back to the instance's stack, and nobody gets a toast per keystroke.
 * `parseDesignFontRefs` caps what one request may ask for.
 */
designRoutes.get("/fonts.css", async (c) => {
  assertAdminRead(c);
  const refs = parseDesignFontRefs(c.req.query("ids") ?? "");
  const slots = fontSlots();
  for (const id of designCatalogIds(refs, slots)) {
    try {
      await ensureFontsCached([id]);
    } catch (err) {
      console.warn(`vellum: the designer could not cache ${id}:`, err);
    }
  }
  return c.body(await buildDesignFontCss(refs, slots), 200, {
    "Content-Type": "text/css; charset=utf-8",
    "Cache-Control": "no-cache",
  });
});

/**
 * Pull down the faces a design just started naming.
 *
 * The catalog cache is filled by an ADMIN's save and never by a visitor's
 * page, and until now the only admin save that named a face was PATCH
 * /api/settings. A design is the second one — and unlike the settings panel,
 * a design can arrive whole: an import, a duplicate, a preset applied. So
 * every write that can put a new font id into the store warms it here.
 *
 * FIRE AND FORGET, ON PURPOSE. A save must not fail, or even wait, because
 * fonts.googleapis.com is slow: the design is already stored and correct, and
 * a face that has not landed yet simply falls back to the instance's stack
 * until it has. The panel's own draft-face route is usually ahead of this
 * anyway — an author who picked the face watched it render.
 */
function warmDesignFaces(doc: DesignDoc | null): void {
  const refs = doc ? designFontRefs(doc.chrome.typography) : activeDesignFontRefs();
  if (refs.length === 0) return;
  void ensureFontsCached(designCatalogIds(refs, fontSlots())).catch((err: unknown) => {
    console.warn("vellum: could not cache a design's faces:", err);
  });
}

// ── Admin: the store ────────────────────────────────────────────────────────

designRoutes.get("/", (c) => {
  assertAdminRead(c);
  return c.json({
    schema: DESIGN_SCHEMA,
    activeId: activeDesignId(),
    designs: designSummaries(),
    themes: customThemes(),
    // The panel builds its "add a section" menu and its token editor from
    // these rather than from a hand-kept copy: a kind or a token added to
    // shared/ must not need a second edit in the client to become reachable.
    sectionKinds: SECTION_KINDS,
    tokens: THEME_TOKENS,
    // What the nav builder offers, and what it warns about: every static page,
    // and every path a VISITOR can actually reach — so an item pointing at an
    // unpublished note is flagged while the admin is still building it,
    // instead of silently vanishing from the public menu later.
    pages: pages(false, null),
    visible: [
      ...posts(true, null).map((post) => post.path),
      ...pages(true, null).map((page) => page.path),
    ],
    // WHAT THE DESIGN'S FEED WILL ACTUALLY HOLD — the designer's preview reads
    // this rather than `/api/posts`, and the difference is the whole point.
    //
    // `/api/posts` answers for the SESSION and for the layout that is live: to
    // an admin it is unscoped, and `staticPagesActive()` is false while
    // `publicLayout` is still "blog" — which is exactly the state an operator
    // is in while building their FIRST design, before they switch. So the pane
    // that is supposed to show the designed site drew a front page whose lead
    // stories were the author's own Contact and Colophon PAGES (and any note
    // the language filter hides from every visitor), in every preview and on
    // all fifty-nine gallery cards, on a brand-new instance.
    //
    // Three arguments, all fixed rather than session-derived, because the
    // question is not "what may this session read" but "what will the designed
    // site print": VISITOR scope, the visitor's own language scope, and pages
    // excluded unconditionally — a designed site never lists a page as an
    // article, whatever `publicLayout` says today.
    posts: posts(true, languageScope(c, true).lang, true),
  });
});

designRoutes.post("/docs", async (c) => {
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const name = typeof body?.name === "string" ? body.name : "";
  const from = typeof body?.from === "string" && body.from !== "" ? body.from : undefined;
  const doc = createDesign(name, from);
  warmDesignFaces(doc);
  return c.json(doc);
});

// The APPLY flow — a preset becomes a design through this route — so it is the
// one write most likely to name a face the instance has never fetched.
designRoutes.post("/docs/import", async (c) => {
  const doc = importDesign(await jsonBody(c));
  warmDesignFaces(doc);
  return c.json(doc);
});

designRoutes.get("/docs/:id", (c) => {
  assertAdminRead(c);
  const design = getDesign(c.req.param("id"));
  if (!design) throw new VaultError(404, `No such design: ${c.req.param("id")}`);
  return c.json(design);
});

designRoutes.get("/docs/:id/export", (c) => {
  assertAdminRead(c);
  return c.json(exportDesign(c.req.param("id")));
});

designRoutes.put("/docs/:id", async (c) => {
  const doc = putDesign(c.req.param("id"), await jsonBody(c));
  warmDesignFaces(doc);
  return c.json(doc);
});

designRoutes.post("/docs/:id/duplicate", (c) => c.json(duplicateDesign(c.req.param("id"))));

designRoutes.post("/docs/:id/reset", (c) => c.json(resetDesign(c.req.param("id"))));

designRoutes.delete("/docs/:id", (c) => {
  deleteDesign(c.req.param("id"));
  return c.json({ ok: true });
});

designRoutes.put("/active", async (c) => {
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const id = body?.id;
  if (id !== null && typeof id !== "string") {
    throw new VaultError(400, 'Body field "id" must be a design id or null');
  }
  setActiveDesign(id === null || id === "" ? null : id);
  // The public site's typography just changed to whatever the newly active
  // design names — which may be a face nothing has fetched yet.
  warmDesignFaces(null);
  return c.json({ activeId: activeDesignId() });
});

// ── Admin: custom themes ────────────────────────────────────────────────────

designRoutes.post("/themes", async (c) => c.json(putCustomTheme(null, await jsonBody(c))));

designRoutes.put("/themes/:id", async (c) =>
  c.json(putCustomTheme(c.req.param("id"), await jsonBody(c))),
);

designRoutes.delete("/themes/:id", (c) => {
  deleteCustomTheme(c.req.param("id"));
  return c.json({ ok: true });
});
