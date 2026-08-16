// The post list — home's "Writings" and every topic page. Each entry: big
// serif title link, localized meta line (date · reading time · tag chips),
// excerpt. Arabic/Hebrew posts right-align themselves via dir="auto".

import type { PostMeta } from "../../shared/types.ts";
import { bannerSrc, generatedBannerCss } from "../banner.ts";
import { countPhrase, t } from "../i18n.ts";
import { notePathToUrl } from "../router.ts";
import { useStore } from "../state.ts";
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
        {useStore.getState().languageFilter && (
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
            <h3 className="s-blog-entry__title" dir="auto">
              <NavLink url={notePathToUrl(post.path)}>{post.title}</NavLink>
            </h3>
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
