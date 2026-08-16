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
import { isNoteVisibleToVisitor, pages, posts } from "./indexer.ts";
import { DESIGN_SCHEMA, SECTION_KINDS, type DesignDoc } from "../shared/design.ts";
import type { NavItem } from "../shared/designChrome.ts";
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
function navSafe(items: NavItem[]): NavItem[] {
  const keep = (item: NavItem): boolean => {
    if (item.kind !== "note" && item.kind !== "page") return true;
    if (!item.target) return false;
    try {
      return isNoteVisibleToVisitor(normalizeRel(item.target));
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

function visitorSafe(design: DesignDoc): DesignDoc {
  const sections = design.sections.map((section) => {
    if (section.kind !== "note" || section.note === "") return section;
    let visible = false;
    try {
      visible = isNoteVisibleToVisitor(normalizeRel(section.note));
    } catch {
      visible = false;
    }
    return visible ? section : { ...section, note: "" };
  });
  return {
    ...design,
    sections,
    chrome: { ...design.chrome, nav: { ...design.chrome.nav, items: navSafe(design.chrome.nav.items) } },
  };
}

// ── Public: what the designed site renders from ─────────────────────────────

designRoutes.get("/public", (c) => {
  const limited = isPublishLimited(c);
  const { design, notice } = activeDesign();
  return c.json({
    schema: DESIGN_SCHEMA,
    design: design ? (limited ? visitorSafe(design) : design) : null,
    themes: customThemes(),
    // The notice names a design and quotes the store's own diagnosis; it is
    // admin copy and never travels to a visitor (or to an admin who asked to
    // be treated as one).
    notice: limited ? null : notice,
    // Which URLs this session may reach as PAGES rather than as articles.
    // Visitor-scoped by the same languageFilter as every other public list.
    pages: pages(limited),
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
    pages: pages(false),
    visible: [...posts(true).map((post) => post.path), ...pages(true).map((page) => page.path)],
  });
});

designRoutes.post("/docs", async (c) => {
  const body = (await jsonBody(c)) as Record<string, unknown>;
  const name = typeof body?.name === "string" ? body.name : "";
  const from = typeof body?.from === "string" && body.from !== "" ? body.from : undefined;
  return c.json(createDesign(name, from));
});

designRoutes.post("/docs/import", async (c) => c.json(importDesign(await jsonBody(c))));

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

designRoutes.put("/docs/:id", async (c) => c.json(putDesign(c.req.param("id"), await jsonBody(c))));

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
