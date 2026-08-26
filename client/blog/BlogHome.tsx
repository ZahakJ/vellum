// Blog home: an optional intro section (HOME_NOTE rendered by the reading
// renderer) above "Writings" — the reverse-chronological post list. The intro
// note itself is left out of the list; it is already on the page.

import { useEffect, useMemo, useRef } from "react";
import type { PostMeta } from "../../shared/types.ts";
import { getNote } from "../api.ts";
import { t } from "../i18n.ts";
import { resolveLink } from "../editor/links.ts";
import { renderNoteContent } from "../reading/renderNote.ts";
import { applyNoteLayoutTo } from "../textLayout.ts";
import { useStore } from "../state.ts";
import PostList from "./PostList.tsx";
import AuthorSites from "./AuthorSites.tsx";
import { BlogSkeleton } from "./util.tsx";
import PublicFolders from "./PublicFolders.tsx";
import "../reading/reading.css";

export default function BlogHome({
  posts,
  locale,
}: {
  posts: PostMeta[] | null;
  locale: string;
}) {
  const tree = useStore((s) => s.tree);
  const homeNote = useStore((s) => s.homeNote);
  useStore((s) => s.language); // re-render chrome strings on a live language switch
  const introRef = useRef<HTMLDivElement | null>(null);

  // HOME_NOTE resolves like a wikilink against the visitor tree — so only a
  // published note can become the intro (an unpublished one simply resolves
  // to nothing and the page opens straight onto the writings).
  const introPath = useMemo(
    () => (homeNote ? resolveLink(homeNote, tree) : null),
    [homeNote, tree],
  );

  // Inline #tag pill allowlist for the intro note (see BlogArticle):
  // excluded workflow tags render as plain text, not pills.
  const introTags = useMemo(() => {
    const meta = introPath ? (posts ?? []).find((p) => p.path === introPath) : null;
    return meta ? new Set(meta.tags.map((t) => t.toLowerCase())) : null;
  }, [posts, introPath]);

  useEffect(() => {
    const host = introRef.current;
    if (!host || !introPath) return;
    let disposed = false;
    getNote(introPath)
      .then((note) => {
        if (disposed || !introRef.current) return;
        const el = renderNoteContent(note.content, {
          notePath: introPath,
          tree: useStore.getState().tree,
          // Same reader-facing polish as the article page.
          brokenLinks: "plain",
          missingImages: "card",
          ...(introTags ? { visibleTags: introTags } : {}),
        });
        el.classList.add("s-reading__content");
        // The home note is a note: it takes the site's direction/alignment and
        // its own frontmatter override, like every other rendered note.
        applyNoteLayoutTo(el, note.content);
        introRef.current.replaceChildren(el);
      })
      .catch(() => {
        // Intro is decoration — a failed load just leaves the list.
      });
    return () => {
      disposed = true;
    };
  }, [introPath, introTags]);

  const listed = useMemo(
    () => (posts ?? []).filter((p) => p.path !== introPath),
    [posts, introPath],
  );

  return (
    <div className="s-blog-page">
      {introPath && <section className="s-blog-intro" ref={introRef} />}
      {/* THE COLLECTIONS COME BEFORE THE WRITINGS (v1.8 UX audit F27). The
          band used to be mounted after PostList, which put the site's own
          declared structure at y=2490 on a 1440 desktop and y=2834 on a
          390 phone — below every post the reader had to scroll past to learn
          the collections existed at all. A list is browsing; a collection is
          navigation, and navigation goes above the thing it navigates.
          AuthorSites stays where it is: another author's site is a way OFF
          this page, and a door out belongs at the end. */}
      <PublicFolders />
      {/* h2, and the masthead's site name is now the h1 (BlogShell): with the
          Collections band above this list, the page's first heading is no
          longer "Writings", and an outline that opens at level 2 and then
          climbs to 1 is the same fragment the old h2 was. Three peer sections,
          one page title — the shape the dashboard home has always had.
          Styling is entirely on the class, so nothing moves. */}
      <h2 className="s-blog-heading">
        <span>{t("blogWritings")}</span>
      </h2>
      {/* Not a "…" (F41): a loading state and an empty state that render the
          same mark in the same italic tell the reader nothing. */}
      {posts === null ? (
        <BlogSkeleton rows={4} />
      ) : (
        <PostList posts={listed} locale={locale} />
      )}

      <AuthorSites />
    </div>
  );
}
