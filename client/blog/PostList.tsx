// The post list — home's "Writings" and every topic page. Each entry: big
// serif title link, localized meta line (date · reading time · tag chips),
// excerpt. Arabic/Hebrew posts right-align themselves via dir="auto".

import type { PostMeta } from "../../shared/types.ts";
import { bannerSrc, generatedBannerCss } from "../banner.ts";
import { countPhrase, t } from "../i18n.ts";
import { MetaSep } from "../metaSep.tsx";
import { notePathToUrl } from "../router.ts";
import { useStore } from "../state.ts";
import { topicUrl } from "./nav.ts";
import { isLabelled as tagIsLabelled, label as tagLabel, useTagLabels } from "../tagLabels.ts";
import { formatDate, NavLink } from "./util.tsx";

export function TagChips({ tags }: { tags: string[] }) {
  // Subscribe so a label edited in Settings repaints every chip on the page
  // without a reload — the map arrives asynchronously and may change under a
  // long-lived blog session.
  useTagLabels();
  if (tags.length === 0) return null;
  return (
    <span className="s-blog-chips">
      {/* Canonical URL, localised word: `topicUrl(tag)` keeps the slug the
          site has always used, and the `title` names the canonical tag so a
          reader of a labelled chip can still learn what to type. */}
      {tags.map((tag) => (
        <NavLink
          key={tag}
          url={topicUrl(tag)}
          className="s-blog-chip"
          dir="auto"
          title={tagIsLabelled(tag) ? `#${tag}` : undefined}
        >
          <span className="s-blog-chip__hash">#</span>
          {tagLabel(tag)}
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
      <MetaSep className="s-blog-meta__dot" />
      <span>{countPhrase(post.readingMinutes, "readMinutes")}</span>
      {/* No `·` before the chips, and the reason is a phone: the meta line
          WRAPS, and at 390 the chips went to their own line while the
          separator stayed behind — every tagged card ending its meta line
          with a bare tick, the "separator with nothing on its far side"
          DESIGN.md forbids, on the public marketing surface. A pill is
          already its own boundary; the dashboard card (BlogDashboard.tsx)
          made the same call and puts its chips on a row of their own with no
          tick at all. */}
      {post.tags.length > 0 && <TagChips tags={post.tags} />}
    </div>
  );
}

/** Entry thumbnail on the inline-end edge (right in LTR, left in RTL): the
 *  post's banner, or (BANNER_FALLBACK=
 *  generated) a deterministic gradient from the title. Unloadable banner
 *  images hide themselves — the layout is elegant without a thumb too. */
function EntryThumb({ post }: { post: PostMeta }) {
  const fallback = useStore((s) => s.bannerFallback);
  if (post.banner) {
    return (
      <NavLink
        url={notePathToUrl(post.path)}
        className="s-blog-entry__thumb"
        aria-hidden="true"
        tabIndex={-1}
      >
        <img
          src={bannerSrc(post.banner)}
          alt=""
          loading="lazy"
          onError={(e) => {
            const wrap = e.currentTarget.closest<HTMLElement>(".s-blog-entry__thumb");
            if (wrap) wrap.style.display = "none";
          }}
        />
      </NavLink>
    );
  }
  if (fallback !== "generated") return null;
  return (
    <NavLink
      url={notePathToUrl(post.path)}
      className="s-blog-entry__thumb s-blog-entry__thumb--gen"
      style={{ background: generatedBannerCss(post.title, "thumb") }}
      aria-hidden="true"
      tabIndex={-1}
    />
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
    // AN EMPTY LIST IS NOT AN EMPTY SITE. With the languageFilter on, this
    // page carries only the notes written in the site language's script, and
    // "Nothing published here yet." was a true sentence about the list and a
    // false one about the vault behind it. The filter's own contract forbids
    // saying HOW MANY notes it hid — that is exactly the existence it exists
    // to withhold — so the second line names the rule, not the count.
    return (
      <div className="s-blog-empty">
        <p>{t("blogNothingPublished")}</p>
        {useStore.getState().languageFilter !== "off" && (
          <p className="s-blog-empty__why">{t("blogFilteredByLanguage")}</p>
        )}
      </div>
    );
  }
  return (
    <div className="s-blog-list">
      {posts.map((post) => (
        <article key={post.path} className="s-blog-entry">
          <div className="s-blog-entry__text">
            {/* h2 under the page's h1 — this list is only ever rendered by
                BlogHome and BlogTopic, both of which now head their page at
                level 1, and a jump from 1 straight to 3 is a hole in the
                outline a screen reader reads as a missing section. */}
            <h2 className="s-blog-entry__title" dir="auto">
              <NavLink url={notePathToUrl(post.path)}>{post.title}</NavLink>
            </h2>
            <PostMetaLine post={post} locale={locale} />
            {post.excerpt !== "" && (
              <p className="s-blog-entry__excerpt" dir="auto">
                {post.excerpt}
              </p>
            )}
          </div>
          <EntryThumb post={post} />
        </article>
      ))}
    </div>
  );
}
