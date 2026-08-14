// Topic page: the post list filtered to one tag, with a "Writings — topic"
// header. Unknown topics render an honest empty state rather than a 404.

import { useMemo } from "react";
import type { PostMeta } from "../../shared/types.ts";
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
  const filtered = useMemo(
    () => (posts ?? []).filter((p) => p.tags.includes(tag)),
    [posts, tag],
  );
  return (
    <div className="s-blog-page">
      <h2 className="s-blog-heading">
        <span>
          Writings
          <span className="s-blog-heading__topic" dir="auto">
            {" — "}
            {tag}
          </span>
        </span>
      </h2>
      {posts === null ? (
        <p className="s-blog-empty">…</p>
      ) : filtered.length === 0 ? (
        <p className="s-blog-empty">No writings under this topic.</p>
      ) : (
        <PostList posts={filtered} locale={locale} />
      )}
    </div>
  );
}
