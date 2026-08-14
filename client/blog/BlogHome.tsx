// Blog home: an optional intro section (HOME_NOTE rendered by the reading
// renderer) above "Writings" — the reverse-chronological post list. The intro
// note itself is left out of the list; it is already on the page.

import { useEffect, useMemo, useRef } from "react";
import type { PostMeta } from "../../shared/types.ts";
import { getNote } from "../api.ts";
import { resolveLink } from "../editor/links.ts";
import { renderMarkdown } from "../reading/render.ts";
import { useStore } from "../state.ts";
import PostList from "./PostList.tsx";
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
  const introRef = useRef<HTMLDivElement | null>(null);

  // HOME_NOTE resolves like a wikilink against the visitor tree — so only a
  // published note can become the intro (an unpublished one simply resolves
  // to nothing and the page opens straight onto the writings).
  const introPath = useMemo(
    () => (homeNote ? resolveLink(homeNote, tree) : null),
    [homeNote, tree],
  );

  useEffect(() => {
    const host = introRef.current;
    if (!host || !introPath) return;
    let disposed = false;
    getNote(introPath)
      .then((note) => {
        if (disposed || !introRef.current) return;
        const el = renderMarkdown(note.content, {
          notePath: introPath,
          tree: useStore.getState().tree,
          // Same reader-facing polish as the article page.
          brokenLinks: "plain",
          missingImages: "card",
        });
        el.classList.add("s-reading__content");
        introRef.current.replaceChildren(el);
      })
      .catch(() => {
        // Intro is decoration — a failed load just leaves the list.
      });
    return () => {
      disposed = true;
    };
  }, [introPath]);

  const listed = useMemo(
    () => (posts ?? []).filter((p) => p.path !== introPath),
    [posts, introPath],
  );

  return (
    <div className="s-blog-page">
      {introPath && <section className="s-blog-intro" ref={introRef} />}
      <h2 className="s-blog-heading">
        <span>Writings</span>
      </h2>
      {posts === null ? (
        <p className="s-blog-empty">…</p>
      ) : (
        <PostList posts={listed} locale={locale} />
      )}
    </div>
  );
}
