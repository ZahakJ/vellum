// The post list — home's "Writings" and every topic page. Each entry: big
// serif title link, localized meta line (date · reading time · tag chips),
// excerpt. Arabic/Hebrew posts right-align themselves via dir="auto".

import type { PostMeta } from "../../shared/types.ts";
import { notePathToUrl } from "../router.ts";
import { topicUrl } from "./nav.ts";
import { formatDate, NavLink } from "./util.tsx";

export function TagChips({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="s-blog-chips">
      {tags.map((tag) => (
        <NavLink key={tag} url={topicUrl(tag)} className="s-blog-chip" dir="auto">
          <span className="s-blog-chip__hash">#</span>
          {tag}
        </NavLink>
      ))}
    </span>
  );
}

export function PostMetaLine({ post, locale }: { post: PostMeta; locale: string }) {
  return (
    <div className="s-blog-meta">
      <time className="s-blog-meta__date" dateTime={post.date}>
        {formatDate(post.date, locale)}
      </time>
      <span className="s-blog-meta__dot" aria-hidden="true">
        ·
      </span>
      <span>{post.readingMinutes} min read</span>
      {post.tags.length > 0 && (
        <>
          <span className="s-blog-meta__dot" aria-hidden="true">
            ·
          </span>
          <TagChips tags={post.tags} />
        </>
      )}
    </div>
  );
}

export default function PostList({
  posts,
  locale,
}: {
  posts: PostMeta[];
  locale: string;
}) {
  if (posts.length === 0) {
    return <p className="s-blog-empty">Nothing published here yet.</p>;
  }
  return (
    <div className="s-blog-list">
      {posts.map((post) => (
        <article key={post.path} className="s-blog-entry">
          <h3 className="s-blog-entry__title" dir="auto">
            <NavLink url={notePathToUrl(post.path)}>{post.title}</NavLink>
          </h3>
          <PostMetaLine post={post} locale={locale} />
          {post.excerpt !== "" && (
            <p className="s-blog-entry__excerpt" dir="auto">
              {post.excerpt}
            </p>
          )}
        </article>
      ))}
    </div>
  );
}
