// STATIC PAGES — About, Contact, Colophon: notes that are part of the SITE
// rather than part of the feed.
//
// THE MECHANISM IS A FRONTMATTER FLAG, `page: true`, and it was chosen over a
// designated folder deliberately:
//
//   - A page is an ORDINARY NOTE. It keeps its place in the vault next to the
//     writing it belongs with, keeps its wikilinks and backlinks, and is
//     edited in the same editor. A designated folder would force a filing
//     decision ("move About.md into /pages/") that rewrites every
//     [[wikilink]] pointing at it and breaks its permalink — for a property
//     that has nothing to do with where the file lives.
//   - It is the same shape the vault already uses for the same kind of fact:
//     `publish: true` decides visibility, `page: true` decides KIND. An
//     operator who has met one has met the other, and Obsidian shows both in
//     its properties table.
//   - It is reversible in one keystroke and leaves no empty folder behind.
//
// A page is still just a note, so:
//   - it lives at its own clean URL (`About.md` → `/About`) — the router,
//     the head injection and every [[wikilink]] to it keep working unchanged;
//   - it must still be `publish: true` to be visible to anyone. `page: true`
//     alone publishes nothing.
//
// What the flag CHANGES is two things, and only in designed mode
// (`settings.publicLayout === "designed"`), so the stock blog's behaviour is
// bit-for-bit what it was:
//   - the page leaves the post feed: /api/posts, the home list, topic lists
//     and RSS. A Contact page is not an article and must not be the newest
//     thing on the front page;
//   - it becomes offerable in the navigation builder and renders through the
//     designed shell's page layout (no date, no reading time, no prev/next,
//     no related posts) rather than the article layout.

import { publicLayout } from "./site.ts";

/** Frontmatter `page` is exactly true / "true" — the same tolerance
 *  publishFlag() gives `publish`, for the same reason (YAML that came back
 *  from a round-trip through a plugin often quotes its booleans). */
export function pageFlag(fm: Record<string, unknown>): boolean {
  return fm.page === true || fm.page === "true";
}

/** True when static pages are a live concept on this instance — i.e. the
 *  public site is a DESIGNED one.
 *
 *  This gate is what keeps the promise that the stock blog is a pristine,
 *  always-working base: with `publicLayout` at "app" or "blog" this answers
 *  false, `posts()` is called exactly as it always was, and a vault full of
 *  `page: true` notes behaves precisely as it did before this feature
 *  existed. Switching to designed mode is what gives the flag meaning —
 *  and switching back gives it up again, losing nothing. */
export function staticPagesActive(): boolean {
  return publicLayout() === "designed";
}
