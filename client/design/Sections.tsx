// The section renderers — the composed tree "designed" mode builds instead of
// the stock blog's fixed one.
//
// NOTHING HERE TOUCHES client/blog/. Not a component, not a class name, not a
// rule in blog.css. What it does reuse is the product's shared, pure
// machinery: the reading renderer (one sanitizer, one wikilink resolver, one
// callout vocabulary for the whole product), the banner helpers, the nav
// singleton and the date formatter. Reusing a pure function is not forking a
// component, and writing a second markdown renderer would be the actual
// architectural sin.
//
// Every class here is `s-dsn-*` and lives in client/styles/design.css, so a
// reviewer can confirm from the diff that stock rendering is untouched by
// looking at which files changed.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PostMeta } from "../../shared/types.ts";
import type {
  CtaSection,
  DividerSection,
  HeroSection,
  NoteSection,
  PostGridSection,
  PostListSection,
  Section,
  TopicsSection,
} from "../../shared/design.ts";
import { getNote } from "../api.ts";
import { bannerSrc, generatedBannerCss } from "../banner.ts";
import { formatDate, NavLink } from "../blog/util.tsx";
import { topicUrl } from "../blog/nav.ts";
import { countPhrase, localeNum, t, tf } from "../i18n.ts";
import { renderMarkdown } from "../reading/render.ts";
import { notePathToUrl } from "../router.ts";
import { useStore } from "../state.ts";
import { SectionError } from "./DesignBoundary.tsx";
// THE PREVIEW SEAM. Two renderers below reach outside the design for their
// content — `note` fetches a note, `postGrid` asks the store whether a missing
// banner should be generated — and a preview must be able to answer for both
// without a second copy of either component. `usePreviewContent()` is null on
// the live site, which is every path this file had before; see
// client/design/previewContent.tsx for why it is a context and not a fork.
import { usePreviewContent, usePreviewNote } from "./previewContent.tsx";

export interface SectionProps {
  posts: PostMeta[] | null;
  locale: string;
}

/** The localized name of a section KIND — what the failure notice and the
 *  designer both call it. */
export function sectionKindLabel(kind: string): string {
  switch (kind) {
    case "hero":
      return t("secHero");
    case "richText":
      return t("secRichText");
    case "note":
      return t("secNote");
    case "postGrid":
      return t("secPostGrid");
    case "postList":
      return t("secPostList");
    case "topics":
      return t("secTopics");
    case "cta":
      return t("secCta");
    case "divider":
      return t("secDivider");
    case "config":
      return t("secConfig");
    case "header":
      return t("designSecHeader");
    case "footer":
      return t("designSecFooter");
    default:
      return t("secPage");
  }
}

/** Posts matching a section's tag filter, newest first, capped. */
function pick(posts: PostMeta[] | null, tag: string, limit: number): PostMeta[] {
  const all = posts ?? [];
  const wanted = tag.trim().toLowerCase().replace(/^#/, "");
  const filtered =
    wanted === "" ? all : all.filter((p) => p.tags.some((x) => x.toLowerCase() === wanted));
  return filtered.slice(0, limit);
}

/** A section's optional heading. Chrome copy in the operator's own words, so
 *  it picks its own direction with <bdi> and keeps the row's alignment. */
function Heading({ text }: { text: string }) {
  if (text === "") return null;
  return (
    <h2 className="s-dsn-head">
      <bdi>{text}</bdi>
    </h2>
  );
}

// ── hero ────────────────────────────────────────────────────────────────────

function Hero({ section }: { section: HeroSection }) {
  const siteName = useStore((s) => s.siteName);
  const tagline = useStore((s) => s.tagline);
  const heading = section.heading || siteName;
  const sub = section.sub || tagline || "";
  return (
    <header
      className={`s-dsn-hero s-dsn-hero--${section.height} s-dsn-hero--${section.align}`}
      style={section.image ? undefined : { background: generatedBannerCss(heading, "hero") }}
    >
      {section.image && (
        <img className="s-dsn-hero__img" src={bannerSrc(section.image)} alt="" aria-hidden="true" />
      )}
      <div className="s-dsn-hero__inner">
        <h1 className="s-dsn-hero__title" dir="auto">
          {heading}
        </h1>
        {sub !== "" && (
          <p className="s-dsn-hero__sub" dir="auto">
            {sub}
          </p>
        )}
      </div>
    </header>
  );
}

// ── richText ────────────────────────────────────────────────────────────────

/** Markdown authored in the designer, rendered by the reading renderer — the
 *  same sanitizer, wikilinks, callouts and KaTeX the rest of the product uses.
 *  The rendered element is imperative DOM (that is what renderMarkdown
 *  returns), so it is adopted into a ref rather than dangerously set. */
function RichText({ section }: { section: Section & { markdown: string; align: string } }) {
  const host = useRef<HTMLDivElement | null>(null);
  const tree = useStore((s) => s.tree);
  const language = useStore((s) => s.language);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.textContent = "";
    if (section.markdown.trim() === "") return;
    el.appendChild(
      renderMarkdown(section.markdown, {
        notePath: "",
        tree,
        brokenLinks: "plain",
        missingImages: "card",
      }),
    );
  }, [section.markdown, tree, language]);
  return <div className={`s-dsn-rich s-dsn-rich--${section.align}`} ref={host} />;
}

// ── note ────────────────────────────────────────────────────────────────────

/**
 * A vault note rendered into the page.
 *
 * THE section that can go wrong through no fault of the config: the note it
 * names can be deleted, unpublished, or hidden by the language filter, all of
 * them long after the design was saved and none of them visible from the
 * design itself. It is therefore where the error boundary earns its keep.
 *
 * Two failure shapes, one outcome:
 *   · `note === ""` — the server BLANKED the path because this session may not
 *     read it (server/designRoutes.ts::visitorSafe). It never travelled, so no
 *     path is leaked, and the section refuses to render.
 *   · the fetch 404s — the note is gone, or gone from this session's view.
 * Both throw a SectionError, which the boundary turns into the stock blog for
 * a visitor and a named card for the owner. Throwing from an EFFECT would be
 * invisible to React, so the failure is stored and re-thrown during render.
 */
function NoteBlock({ section }: { section: NoteSection }) {
  const host = useRef<HTMLDivElement | null>(null);
  const tree = useStore((s) => s.tree);
  const language = useStore((s) => s.language);
  const [failure, setFailure] = useState<SectionError | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  // Non-null inside a preview that supplies this note's prose (or that has
  // declared no note may be fetched at all). The live site always gets null,
  // and everything below is exactly what it was.
  const supplied = usePreviewNote(section.note);

  // The throw is at the BOTTOM of this component, never here. A `throw` between
  // two hook calls leaves React with a shorter hook list than the previous
  // render, and while React unwinds to the boundary before it can complain,
  // "it happens to work" is not a thing to build a rescue path on. Both fatal
  // conditions are computed here and raised once, after every hook has run.
  //
  // A preview that SUPPLIED the prose is never fatal: it did not fetch, so it
  // cannot have 404'd, and a blanked path inside a preview means "there is no
  // vault here to read from" rather than "this session may not read it".
  const fatal =
    supplied !== null
      ? null
      : section.note === ""
        ? new SectionError(
            `design section "${section.id}" names a note this session cannot read`,
            "dsnNoteUnavailable",
          )
        : failure;

  useEffect(() => {
    if (supplied !== null) {
      setMarkdown(supplied);
      return;
    }
    if (section.note === "") return;
    let disposed = false;
    setMarkdown(null);
    getNote(section.note)
      .then((data) => {
        if (disposed) return;
        setMarkdown(section.excerpt ? firstBlock(strip(data.content)) : strip(data.content));
      })
      .catch(() => {
        if (disposed) return;
        setFailure(
          new SectionError(
            `design section "${section.id}" points at a note that is not there: ${section.note}`,
            "dsnNoteMissing",
            section.note,
          ),
        );
      });
    return () => {
      disposed = true;
    };
  }, [section.note, section.excerpt, section.id, supplied]);

  useEffect(() => {
    const el = host.current;
    if (!el || markdown === null) return;
    el.textContent = "";
    el.appendChild(
      renderMarkdown(markdown, {
        notePath: section.note,
        tree,
        brokenLinks: "plain",
        missingImages: "card",
      }),
    );
  }, [markdown, section.note, tree, language]);

  if (fatal) throw fatal;

  return (
    <section className="s-dsn-note">
      <Heading text={section.heading} />
      <div className="s-dsn-rich" ref={host} />
      {section.excerpt && markdown !== null && (
        <NavLink url={notePathToUrl(section.note)} className="s-dsn-more">
          {t("dsnReadMore")}
        </NavLink>
      )}
    </section>
  );
}

/** Frontmatter off — the homepage shows prose, not YAML. */
function strip(content: string): string {
  if (!content.startsWith("---")) return content;
  const nl = content.startsWith("---\r\n") ? "\r\n" : "\n";
  const close = content.indexOf(`${nl}---`, 3 + nl.length);
  return close === -1 ? content : content.slice(close + nl.length + 3).replace(/^\r?\n/, "");
}

/** The first real paragraph — the excerpt mode. */
function firstBlock(md: string): string {
  for (const block of md.split(/\r?\n\s*\r?\n/)) {
    const trimmed = block.trim();
    if (trimmed !== "" && !trimmed.startsWith("#")) return trimmed;
  }
  return md.trim().slice(0, 400);
}

// ── postGrid / postList ─────────────────────────────────────────────────────

function PostMeta_({ post, locale, showDate }: { post: PostMeta; locale: string; showDate: boolean }) {
  if (!showDate) return null;
  return (
    <p className="s-dsn-meta">
      <span>{formatDate(post.date, locale)}</span>
      <span className="s-dsn-meta__sep" aria-hidden="true" />
      <span>{countPhrase(post.readingMinutes, "readMinutes")}</span>
    </p>
  );
}

function PostGrid({ section, posts, locale }: { section: PostGridSection } & SectionProps) {
  const stored = useStore((s) => s.bannerFallback);
  // A PREVIEW ALWAYS GENERATES. An author who turned generated banners off for
  // their live site still has to see what a banner grid does before choosing
  // one, and a fresh install with no banners anywhere would otherwise judge
  // every image-forward preset by a column of empty rectangles.
  const preview = usePreviewContent();
  const bannerFallback = preview?.forceGeneratedBanners ? "generated" : stored;
  const chosen = pick(posts, section.tag, section.limit);
  return (
    <section className="s-dsn-block">
      <Heading text={section.heading} />
      {chosen.length === 0 ? (
        <p className="s-dsn-empty">{t("dsnNoPosts")}</p>
      ) : (
        <div className="s-dsn-grid" style={{ "--dsn-cols": section.columns } as React.CSSProperties}>
          {chosen.map((post) => (
            <NavLink key={post.path} url={notePathToUrl(post.path)} className="s-dsn-card">
              {section.showBanner && (post.banner || bannerFallback === "generated") && (
                <span
                  className="s-dsn-card__banner"
                  style={
                    post.banner
                      ? { backgroundImage: `url(${JSON.stringify(bannerSrc(post.banner))})` }
                      : { background: generatedBannerCss(post.title, "thumb") }
                  }
                  aria-hidden="true"
                />
              )}
              <span className="s-dsn-card__body">
                <span className="s-dsn-card__title" dir="auto">
                  {post.title}
                </span>
                <PostMeta_ post={post} locale={locale} showDate={section.showDate} />
                {section.showExcerpt && post.excerpt !== "" && (
                  <span className="s-dsn-card__excerpt" dir="auto">
                    {post.excerpt}
                  </span>
                )}
              </span>
            </NavLink>
          ))}
        </div>
      )}
    </section>
  );
}

function PostListBlock({ section, posts, locale }: { section: PostListSection } & SectionProps) {
  const chosen = pick(posts, section.tag, section.limit);
  return (
    <section className="s-dsn-block">
      <Heading text={section.heading} />
      {chosen.length === 0 ? (
        <p className="s-dsn-empty">{t("dsnNoPosts")}</p>
      ) : (
        <ol className="s-dsn-list">
          {chosen.map((post) => (
            <li key={post.path} className="s-dsn-list__item">
              <NavLink url={notePathToUrl(post.path)} className="s-dsn-list__link">
                <span className="s-dsn-list__title" dir="auto">
                  {post.title}
                </span>
              </NavLink>
              <PostMeta_ post={post} locale={locale} showDate={section.showDate} />
              {section.showExcerpt && post.excerpt !== "" && (
                <p className="s-dsn-list__excerpt" dir="auto">
                  {post.excerpt}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ── topics ──────────────────────────────────────────────────────────────────

function Topics({ section, posts }: { section: TopicsSection } & SectionProps) {
  const chips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of posts ?? []) {
      for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, section.limit);
  }, [posts, section.limit]);
  if (chips.length === 0) return null;
  return (
    <section className="s-dsn-block">
      <Heading text={section.heading} />
      <div className="s-dsn-topics">
        {chips.map(([tag, count]) => (
          <NavLink key={tag} url={topicUrl(tag)} className="s-dsn-topic">
            {/* The chip IS its content, so the isolate goes on the chip — the
                same rule the editor's #tag pills follow. */}
            <bdi>#{tag}</bdi>
            {/* Through localeNum, never a bare {count}: numerals are ONE system
                per instance, chosen by the date locale, and the date beside
                this chip on every card is already Arabic-Indic. */}
            <span className="s-dsn-topic__count">{localeNum(count)}</span>
          </NavLink>
        ))}
      </div>
    </section>
  );
}

// ── cta ─────────────────────────────────────────────────────────────────────

function Cta({ section }: { section: CtaSection }) {
  const external = /^https:\/\//i.test(section.url);
  const label = section.label || t("dsnReadMore");
  return (
    <section className="s-dsn-cta">
      {section.heading !== "" && (
        <p className="s-dsn-cta__head" dir="auto">
          {section.heading}
        </p>
      )}
      {section.body !== "" && (
        <p className="s-dsn-cta__body" dir="auto">
          {section.body}
        </p>
      )}
      {external ? (
        <a className="s-dsn-cta__btn" href={section.url} target="_blank" rel="noopener noreferrer">
          <bdi>{label}</bdi>
        </a>
      ) : (
        <NavLink url={section.url} className="s-dsn-cta__btn">
          <bdi>{label}</bdi>
        </NavLink>
      )}
    </section>
  );
}

// ── divider ─────────────────────────────────────────────────────────────────

function Divider({ section }: { section: DividerSection }) {
  return (
    <div
      className={`s-dsn-div s-dsn-div--${section.style}`}
      style={{ "--dsn-space": `${section.space}px` } as React.CSSProperties}
      aria-hidden="true"
    />
  );
}

// ── the switch ──────────────────────────────────────────────────────────────

/** Render one section. An unknown kind THROWS rather than rendering nothing:
 *  a section silently missing from a public homepage is exactly the invisible
 *  failure the boundary exists to make loud. (Validation makes this
 *  unreachable through the API — it is reachable through a hand-edited
 *  designs.json, which is a supported way to break this file.) */
export function RenderSection({
  section,
  posts,
  locale,
}: { section: Section } & SectionProps): JSX.Element {
  switch (section.kind) {
    case "hero":
      return <Hero section={section} />;
    case "richText":
      return <RichText section={section} />;
    case "note":
      return <NoteBlock section={section} />;
    case "postGrid":
      return <PostGrid section={section} posts={posts} locale={locale} />;
    case "postList":
      return <PostListBlock section={section} posts={posts} locale={locale} />;
    case "topics":
      return <Topics section={section} posts={posts} locale={locale} />;
    case "cta":
      return <Cta section={section} />;
    case "divider":
      return <Divider section={section} />;
    default:
      throw new SectionError(
        `design section has an unknown kind: ${String((section as { kind?: unknown }).kind)}`,
        "dsnUnknownKind",
        tf("dsnUnknownKindDetail", { kind: String((section as { kind?: unknown }).kind) }),
      );
  }
}
