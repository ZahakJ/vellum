// Magazine home (settings.home.mode === "dashboard"): a full-width hero
// carrying the site identity (settings banner image or a generated gradient
// seeded from the site name, with the name/logo + tagline overlaid on a
// scrim), a responsive card grid of the latest posts, and — when readers have
// been talking — a slim "Most discussed" row ranked by comment count.
// Admins looking through visitor preview get a hover "Change banner…"
// affordance that writes settings.home.banner via PATCH /api/settings.

import { useEffect, useMemo, useRef, useState } from "react";
import AuthorSites from "./AuthorSites.tsx";
import PublicFolders from "./PublicFolders.tsx";
import type { PostMeta } from "../../shared/types.ts";
import { bannerSrc, generatedBannerCss } from "../banner.ts";
import { useBannerSrc } from "../components/BannerImg.tsx";
import { countPhrase, localeNum, t } from "../i18n.ts";
import { MetaSep } from "../metaSep.tsx";
import { notePathToUrl } from "../router.ts";
import { useStore } from "../state.ts";
import HomeBannerModal from "./HomeBannerModal.tsx";
import { TagChips } from "./PostList.tsx";
import { BlogSkeleton, formatDate, NavLink } from "./util.tsx";

const HOTTEST_MAX = 6;

function CardThumb({ post }: { post: PostMeta }) {
  const fallback = useStore((s) => s.bannerFallback);
  if (post.banner) {
    return (
      <NavLink
        url={notePathToUrl(post.path)}
        className="s-dash-card__thumb"
        aria-hidden="true"
        tabIndex={-1}
      >
        <img
          src={bannerSrc(post.banner)}
          alt=""
          loading="lazy"
          onError={(e) => {
            // Unloadable banner image: fall back to the generated gradient
            // rather than a broken-image glyph on the card.
            const wrap = e.currentTarget.closest<HTMLElement>(".s-dash-card__thumb");
            if (wrap) {
              e.currentTarget.remove();
              wrap.style.background = generatedBannerCss(post.title, "thumb");
            }
          }}
        />
      </NavLink>
    );
  }
  if (fallback !== "generated") return null;
  return (
    <NavLink
      url={notePathToUrl(post.path)}
      className="s-dash-card__thumb"
      style={{ background: generatedBannerCss(post.title, "thumb") }}
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}

function Card({ post, locale }: { post: PostMeta; locale: string }) {
  return (
    <article className="s-dash-card">
      <CardThumb post={post} />
      <div className="s-dash-card__body">
        <h3 className="s-dash-card__title" dir="auto">
          <NavLink url={notePathToUrl(post.path)}>{post.title}</NavLink>
        </h3>
        <div className="s-blog-meta s-dash-card__meta">
          <time className="s-blog-meta__date" dateTime={post.date}>
            {formatDate(post.date, locale)}
          </time>
          <MetaSep className="s-blog-meta__dot" />
          <span>{countPhrase(post.readingMinutes, "readMinutes")}</span>
        </div>
        {post.excerpt !== "" && (
          <p className="s-dash-card__excerpt" dir="auto">
            {post.excerpt}
          </p>
        )}
        {post.tags.length > 0 && (
          <div className="s-dash-card__tags">
            <TagChips tags={post.tags} />
          </div>
        )}
      </div>
    </article>
  );
}

function CommentBubble() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-4-.9L3 20l1-4.6a8.4 8.4 0 1 1 17-3.9z" />
    </svg>
  );
}

export default function BlogDashboard({
  posts,
  locale,
}: {
  posts: PostMeta[] | null;
  locale: string;
}) {
  const siteName = useStore((s) => s.siteName);
  const tagline = useStore((s) => s.tagline);
  const home = useStore((s) => s.home);
  const logo = useStore((s) => s.logo);
  // The affordance shows for admins looking through visitor preview — the
  // only way an admin ever sees the dashboard (the app is their home view).
  const previewing = useStore((s) => s.previewVisitor);
  useStore((s) => s.language); // re-render chrome strings on a live language switch
  const [pickerOpen, setPickerOpen] = useState(false);
  const [bannerBroken, setBannerBroken] = useState(false);

  // The hero image and the logo are values an ADMIN TYPED into settings, so
  // both climb the resolution ladder (client/banner.ts): "mark.svg" is allowed
  // to mean brand/mark.svg, exactly as it does in a note's `banner:`. A hero
  // that resolves to nothing falls through to the generated gradient — the
  // page's own designed fallback, and the right answer on a page full of
  // strangers.
  const heroBanner = useBannerSrc(home?.banner ?? null);
  const logoSrc = useBannerSrc(logo);
  const banner = heroBanner.src;

  // Most-discussed row: a right-edge fade signals "more cards this way" while
  // there is horizontal overflow left to scroll — and disappears at the end
  // of the row (and entirely when everything fits).
  const hotRowRef = useRef<HTMLDivElement | null>(null);
  const [hotMore, setHotMore] = useState(false);
  useEffect(() => {
    const el = hotRowRef.current;
    if (!el) return;
    const update = (): void => {
      // In RTL the browser reports scrollLeft as a negative offset from the
      // start edge — abs() makes "distance scrolled" direction-agnostic.
      setHotMore(el.scrollWidth - el.clientWidth - Math.abs(el.scrollLeft) > 8);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [posts]);

  // Most discussed: posts with visible comments, busiest first. The section
  // vanishes entirely when nobody has commented (or comments are off —
  // commentCount is absent then and every count reads 0).
  const hottest = useMemo(
    () =>
      (posts ?? [])
        .filter((p) => (p.commentCount ?? 0) > 0)
        .sort(
          (a, b) =>
            (b.commentCount ?? 0) - (a.commentCount ?? 0) ||
            b.date.localeCompare(a.date),
        )
        .slice(0, HOTTEST_MAX),
    [posts],
  );

  return (
    <div className="s-dash">
      <section
        className={`s-dash-hero${banner && !bannerBroken ? "" : " s-dash-hero--gen"}`}
        style={
          banner && !bannerBroken
            ? undefined
            : { background: generatedBannerCss(siteName, "thumb") }
        }
      >
        {banner && !bannerBroken && (
          <img
            className="s-dash-hero__img"
            src={banner}
            alt=""
            onError={() => setBannerBroken(true)}
          />
        )}
        <div className="s-dash-hero__scrim" aria-hidden="true" />
        <div className="s-dash-hero__inner">
          {logo && logoSrc.src ? (
            <NavLink url="/" className="s-dash-hero__logolink" aria-hidden={false}>
              <img className="s-dash-hero__logo" src={logoSrc.src} alt={siteName} />
            </NavLink>
          ) : (
            <h1 className="s-dash-hero__name" dir="auto">
              <NavLink url="/">{siteName}</NavLink>
            </h1>
          )}
          {tagline && (
            <p className="s-dash-hero__tagline" dir="auto">
              {tagline}
            </p>
          )}
        </div>
        {previewing && (
          <button
            type="button"
            className="s-dash-hero__change"
            onClick={() => setPickerOpen(true)}
          >
            {t("blogChangeBanner")}
          </button>
        )}
      </section>

      <div className="s-dash-body">
        {/* COLLECTIONS FIRST, AND INSIDE THE COLUMN (v1.8 UX audit F27). The
            band was mounted after `.s-dash-body` — so it sat below the whole
            card grid AND outside the page's only measure, drawing its cards
            edge-to-edge on a surface where every other row keeps 24px
            gutters. Moved to the head of the body it gets both fixes at once:
            the site's declared structure is the first thing under the hero,
            and it shares the column with the grid it leads. AuthorSites stays
            outside and below — a link off the site is a way out, not a way
            in. */}
        <PublicFolders />

        <section aria-label={t("blogLatestWritings")}>
          <h2 className="s-blog-heading">
            <span>{t("blogLatest")}</span>
          </h2>
          {posts === null ? (
            // A LOADING STATE IS NOT A SENTENCE. This was a literal "…" in
            // serif italic, which reads as content that failed rather than as
            // a page still arriving (v1.8 UX audit F41). Three cards' worth of
            // quiet bars, shaped like what is coming.
            <BlogSkeleton rows={3} />
          ) : posts.length === 0 ? (
            <div className="s-blog-empty">
              <p>{t("blogNothingPublished")}</p>
              {/* THE OWNER IS THE ONLY PERSON WHO EVER SEES THIS PAGE EMPTY —
                  the dashboard reaches an admin through visitor preview, and a
                  visitor of a vault with nothing published has no link to it.
                  So the empty state says the one thing that fixes it, in the
                  same second-line idiom PostList uses for the language filter
                  (F41). */}
              {previewing && <p className="s-blog-empty__why">{t("blogPublishHow")}</p>}
            </div>
          ) : (
            <div className="s-dash-grid">
              {posts.map((post) => (
                <Card key={post.path} post={post} locale={locale} />
              ))}
            </div>
          )}
        </section>

        {hottest.length > 0 && (
          <section className="s-dash-hot" aria-label={t("blogMostDiscussed")}>
            <h2 className="s-blog-heading">
              <span>{t("blogMostDiscussed")}</span>
            </h2>
            <div className="s-dash-hot__scroll">
              <div className="s-dash-hot__row" ref={hotRowRef}>
                {hottest.map((post) => (
                  <NavLink
                    key={post.path}
                    url={notePathToUrl(post.path)}
                    className="s-dash-hot__card"
                  >
                    <span className="s-dash-hot__count">
                      <CommentBubble />
                      {localeNum(post.commentCount ?? 0)}
                    </span>
                    <span className="s-dash-hot__title" dir="auto">
                      {post.title}
                    </span>
                    <span className="s-dash-hot__date">{formatDate(post.date, locale)}</span>
                  </NavLink>
                ))}
              </div>
              {hotMore && <div className="s-dash-hot__fade" aria-hidden="true" />}
            </div>
          </section>
        )}

        {/* Inside the column for the same reason the Collections band moved
            into it: on the note-mode home this section lives in
            `.s-blog-page`, which sets a measure and 24px gutters; here it sat
            outside `.s-dash-body` and drew its cards edge-to-edge — at 390 a
            cover photograph touching both sides of the phone. One page, one
            column (DESIGN.md). */}
        <AuthorSites />
      </div>

      {pickerOpen && <HomeBannerModal onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
