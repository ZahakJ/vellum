// Topic page: the post list filtered to one tag, with a "Writings — topic"
// header. Unknown topics render an honest empty state rather than a 404.
//
// THE URL IS CANONICAL AND THE HEADING IS LOCALISED. `/topic/software` is the
// address the site draws, links to, and puts in a reader's history; «برمجيات»
// is what the chip that led here said. Both have to work, because a reader
// copies the word they can SEE — so a localised segment is accepted and
// quietly rewritten to its canonical form (replaceState, not a push: a
// history entry that immediately redirects turns Back into a loop).

import { useEffect, useMemo } from "react";
import type { PostMeta } from "../../shared/types.ts";
import { t } from "../i18n.ts";
import { useStore } from "../state.ts";
import { canonical, isLabelled as tagIsLabelled, label as tagLabel, useTagLabels } from "../tagLabels.ts";
import { topicUrl } from "./nav.ts";
import PostList from "./PostList.tsx";

export default function BlogTopic({
  tag,
  posts,
  locale,
}: {
  tag: string;
  posts: PostMeta[] | null;
  locale: string;
}) {
  useStore((s) => s.language); // re-render chrome strings on a live language switch
  const labelsVersion = useTagLabels();

  // The tag this page is actually about. `canonical()` answers for a value
  // that is already canonical too, so this is one lookup, not a branch — and
  // it falls back to the segment as given, which is what keeps an unknown
  // topic rendering its honest empty state instead of a blank page.
  const resolved = useMemo(
    () => canonical(tag) ?? tag,
    // The map arrives asynchronously: a deep link opened before it lands must
    // re-resolve when it does.
    [tag, labelsVersion],
  );

  // A localised address becomes the canonical one, in place. Nothing else is
  // re-routed: the page is already rendering the right posts.
  useEffect(() => {
    if (resolved === tag) return;
    try {
      history.replaceState(history.state, "", topicUrl(resolved));
    } catch {
      // A browser refusing replaceState is not a reason to lose the page.
    }
  }, [resolved, tag]);

  const filtered = useMemo(
    () => (posts ?? []).filter((p) => p.tags.includes(resolved)),
    [posts, resolved],
  );
  return (
    <div className="s-blog-page">
      {/* h1 — the topic page's own title (see BlogHome). */}
      <h1 className="s-blog-heading">
        <span>
          {t("blogWritings")}
          {/* The heading names the topic in the reader's language and keeps
              the canonical tag in the tooltip — the same pairing every chip
              on the site uses. */}
          <span
            className="s-blog-heading__topic"
            dir="auto"
            title={tagIsLabelled(resolved) ? `#${resolved}` : undefined}
          >
            {" — "}
            {tagLabel(resolved)}
          </span>
        </span>
      </h1>
      {posts === null ? (
        <p className="s-blog-empty">…</p>
      ) : filtered.length === 0 ? (
        <p className="s-blog-empty">{t("blogNoTopicWritings")}</p>
      ) : (
        <PostList posts={filtered} locale={locale} />
      )}
    </div>
  );
}
