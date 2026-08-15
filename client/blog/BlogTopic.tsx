// Topic page: the post list filtered to one tag, with a "Writings — topic"
// header. Unknown topics render an honest empty state rather than a 404.

import { useMemo } from "react";
import type { PostMeta } from "../../shared/types.ts";
import { t } from "../i18n.ts";
import { useStore } from "../state.ts";
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
  const filtered = useMemo(
    () => (posts ?? []).filter((p) => p.tags.includes(tag)),
    [posts, tag],
  );
  return (
    <div className="s-blog-page">
      <h2 className="s-blog-heading">
        <span>
          {t("blogWritings")}
          <span className="s-blog-heading__topic" dir="auto">
            {" — "}
            {tag}
          </span>
        </span>
      </h2>
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
