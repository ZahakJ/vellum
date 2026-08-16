// The article page of a designed site.
//
// The stock blog's own BlogArticle is not reused, subclassed or configured —
// it is left exactly where it is, doing exactly what it does, because that is
// the base a broken design falls back to and a base with a `designed` prop
// threaded through it is not a base any more. This is the second renderer, and
// what it renders is what `design.article` says: five toggles over the same
// pieces, drawn with `s-dsn-*` classes.
//
// The markdown body is the SHARED reading renderer, for the reason
// Sections.tsx gives: one sanitizer and one wikilink resolver for the whole
// product, or the designed site becomes the place where an XSS fix does not
// land.

import { useEffect, useMemo, useRef, useState } from "react";
import { stripBidiControls } from "../../shared/bidi.ts";
import type { DesignArticle } from "../../shared/design.ts";
import type { PostMeta } from "../../shared/types.ts";
import { getNote } from "../api.ts";
import { bannerSrc, bannerFromContent, generatedBannerCss } from "../banner.ts";
import { formatDate, isRtlText, NavLink } from "../blog/util.tsx";
import { topicUrl } from "../blog/nav.ts";
import { countPhrase, t } from "../i18n.ts";
import { renderMarkdown } from "../reading/render.ts";
import { notePathToUrl } from "../router.ts";
import { useStore } from "../state.ts";
import { SectionError } from "./DesignBoundary.tsx";

export default function DesignedArticle({
  path,
  posts,
  locale,
  options,
}: {
  path: string;
  posts: PostMeta[] | null;
  locale: string;
  options: DesignArticle;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const tree = useStore((s) => s.tree);
  const bannerFallback = useStore((s) => s.bannerFallback);
  const language = useStore((s) => s.language);
  const [content, setContent] = useState<string | null>(null);
  const [failure, setFailure] = useState<SectionError | null>(null);

  // Bidi controls out of the headline — the H1 is a filename, and an RLO in
  // one reorders every word after it.
  const title = stripBidiControls(path.split("/").pop()!.replace(/\.md$/i, ""));
  const meta = posts?.find((post) => post.path === path) ?? null;

  // Raised after every hook has run — see the note in Sections.tsx::NoteBlock.
  useEffect(() => {
    useStore.setState({ openPath: path });
  }, [path]);

  useEffect(() => {
    let disposed = false;
    setContent(null);
    getNote(path)
      .then((data) => {
        if (!disposed) setContent(data.content);
      })
      .catch(() => {
        if (disposed) return;
        // A permalink that 404s is the ROUTER's problem, not the design's —
        // but reaching it through a designed page still has to be honest, so
        // it comes through the boundary like everything else.
        setFailure(
          new SectionError(`article not found: ${path}`, "dsnNoteMissing", path),
        );
      });
    return () => {
      disposed = true;
    };
  }, [path]);

  const visibleTags = useMemo(
    () => (meta ? new Set(meta.tags.map((tag) => tag.toLowerCase())) : undefined),
    [meta],
  );

  useEffect(() => {
    const el = host.current;
    if (!el || content === null) return;
    el.textContent = "";
    const body = renderMarkdown(content, {
      notePath: path,
      tree,
      brokenLinks: "plain",
      missingImages: "card",
      ...(visibleTags ? { visibleTags } : {}),
    });
    // Notes usually open with "# <their own title>", and this page has already
    // printed that title as the article heading — so the body would say it
    // twice. Exactly what the stock article does, for exactly that reason.
    const h1 = body.querySelector(".s-rv-h1");
    if (h1 && (h1.textContent ?? "").trim().toLowerCase() === title.trim().toLowerCase()) {
      h1.remove();
    }
    el.appendChild(body);
  }, [content, path, tree, visibleTags, language, title]);

  const banner = meta?.banner ?? (content ? bannerFromContent(content) : null);
  const related = useMemo(() => {
    if (!options.showRelated || !meta || !posts) return [];
    const tags = new Set(meta.tags.map((tag) => tag.toLowerCase()));
    if (tags.size === 0) return [];
    return posts
      .filter((post) => post.path !== path && post.tags.some((tag) => tags.has(tag.toLowerCase())))
      .slice(0, 4);
  }, [options.showRelated, meta, posts, path]);

  if (failure) throw failure;

  return (
    <article className="s-dsn-article">
      {options.showBackLink && (
        <NavLink url="/" className="s-dsn-back">
          <span className="s-dsn-back__arrow" aria-hidden="true">
            ←
          </span>
          {t("blogBackToWritings")}
        </NavLink>
      )}
      {options.showBanner && (banner || bannerFallback === "generated") && (
        <div
          className="s-dsn-article__banner"
          style={
            banner
              ? { backgroundImage: `url(${JSON.stringify(bannerSrc(banner))})` }
              : { background: generatedBannerCss(title) }
          }
          aria-hidden="true"
        />
      )}
      {/* THE BYLINE FOLLOWS THE TITLE'S SCRIPT, NOT THE CHROME'S — the rule the
          stock blog states, restated here because this is a second renderer
          and not a reuse of the first. The h1 aligns itself with dir="auto",
          so on an Arabic instance an English-titled post would otherwise put
          the title hard left and its own date hard right: one heading split
          across the width of the column. */}
      <div
        className={`s-dsn-article__head${isRtlText(title) ? " s-dsn-article__head--rtl" : ""}`}
      >
        <h1 className="s-dsn-article__title" dir="auto">
          {title}
        </h1>
        {options.showMeta && meta && (
          <p className="s-dsn-meta s-dsn-article__meta">
            <span>{formatDate(meta.date, locale)}</span>
            <span className="s-dsn-meta__sep" aria-hidden="true" />
            <span>{countPhrase(meta.readingMinutes, "readMinutes")}</span>
          </p>
        )}
      </div>
      <div className="s-dsn-rich s-dsn-article__body" ref={host} />
      {options.showTags && meta && meta.tags.length > 0 && (
        <nav className="s-dsn-topics s-dsn-article__tags" aria-label={t("tags")}>
          {meta.tags.map((tag) => (
            <NavLink key={tag} url={topicUrl(tag)} className="s-dsn-topic">
              <bdi>#{tag}</bdi>
            </NavLink>
          ))}
        </nav>
      )}
      {related.length > 0 && (
        <section className="s-dsn-block s-dsn-article__related">
          <h2 className="s-dsn-head">{t("dsnRelated")}</h2>
          <ol className="s-dsn-list">
            {related.map((post) => (
              <li key={post.path} className="s-dsn-list__item">
                <NavLink url={notePathToUrl(post.path)} className="s-dsn-list__link">
                  <span className="s-dsn-list__title" dir="auto">
                    {post.title}
                  </span>
                </NavLink>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
