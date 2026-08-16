// Article page: a centered reading column — serif title, meta line, the note
// rendered by the reading renderer, then tag chips, a quiet share row,
// prev/next links by date, related posts (wikilinked from/to this one), and
// Marginalia (reader comments) at the end.

import { useEffect, useMemo, useRef } from "react";
import { stripBidiControls } from "../../shared/bidi.ts";
import type { PostMeta } from "../../shared/types.ts";
import { getNote } from "../api.ts";
import { bannerSrc, generatedBannerCss } from "../banner.ts";
import { useNoteNeighborhood } from "../graphCache.ts";
import { countPhrase, t, tf } from "../i18n.ts";
import { MetaSep } from "../metaSep.tsx";
import Marginalia from "../components/Marginalia.tsx";
import { renderNoteContent } from "../reading/renderNote.ts";
import { applyNoteLayoutTo } from "../textLayout.ts";
import { notePathToUrl } from "../router.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { TagChips } from "./PostList.tsx";
import { formatDate, isRtlText, NavLink } from "./util.tsx";
import { numberRendered } from "../reading/headingNumbers.ts";
import "../reading/reading.css";
import { noteTitleOf } from "../../shared/noteFormat.ts";

/** Notes often open with "# <their own title>" — the page already shows it
 *  as the article title, so drop the duplicate from the rendered body. */
function dropDuplicateTitle(root: HTMLElement, title: string): void {
  const h1 = root.querySelector(".s-rv-h1");
  if (h1 && (h1.textContent ?? "").trim().toLowerCase() === title.trim().toLowerCase()) {
    h1.remove();
  }
}

function scrollToHeading(host: HTMLElement, text: string): void {
  const want = text.trim().toLowerCase();
  const target = [...host.querySelectorAll<HTMLElement>(".s-rv-h")].find(
    (h) => (h.textContent ?? "").trim().toLowerCase() === want,
  );
  target?.scrollIntoView({ block: "start" });
}

function shareLinks(title: string): { name: string; href: string }[] {
  const url = encodeURIComponent(location.href);
  const text = encodeURIComponent(title);
  return [
    { name: "X", href: `https://twitter.com/intent/tweet?text=${text}&url=${url}` },
    { name: "WhatsApp", href: `https://wa.me/?text=${text}%20${url}` },
    {
      name: "LinkedIn",
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${url}`,
    },
  ];
}

function copyLink(): void {
  navigator.clipboard
    .writeText(location.href)
    .then(() => toast(t("blogLinkCopied")))
    .catch(() => toast(t("blogCopyFailed")));
}

export default function BlogArticle({
  path,
  posts,
  locale,
}: {
  path: string;
  posts: PostMeta[] | null;
  locale: string;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const tree = useStore((s) => s.tree);
  const pendingHeading = useStore((s) => s.pendingHeading);
  const bannerFallback = useStore((s) => s.bannerFallback);
  const shareButtons = useStore((s) => s.shareButtons);
  // Re-render chrome strings on a live language switch. The value is also a
  // dependency of the body render below: the rendered markdown carries t()
  // chrome (properties card, transclusion cards) built as imperative DOM.
  const language = useStore((s) => s.language);

  // Bidi controls out: the H1 is the note's own filename, and an RLO in it
  // reorders the headline. Same normalization the server applies to the title
  // it puts in /api/posts, RSS and the og: tags.
  const title = stripBidiControls(noteTitleOf(path));
  const meta = posts?.find((p) => p.path === path) ?? null;

  // The post's server-filtered tag list (EXCLUDE_TAGS already applied) is
  // the allowlist for inline #tag pills in the body — an excluded workflow
  // tag ("Status: #child") renders as plain text, not a styled pill.
  const visibleTags = useMemo(
    () => (meta ? new Set(meta.tags.map((t) => t.toLowerCase())) : null),
    [meta],
  );

  // Keep the store's notion of "the open note" in sync — same-note heading
  // links and other store consumers rely on it.
  useEffect(() => {
    useStore.setState({ openPath: path });
  }, [path]);

  // Load + render the note body.
  useEffect(() => {
    const host = bodyRef.current;
    if (!host) return;
    let disposed = false;
    getNote(path)
      .then((note) => {
        if (disposed || !bodyRef.current) return;
        const el = renderNoteContent(note.content, {
          notePath: path,
          tree: useStore.getState().tree,
          // Blog readers get no broken-link furniture: unresolvable
          // wikilinks read as plain text, missing images become a faint
          // card (or vanish when the filename is machine noise).
          brokenLinks: "plain",
          missingImages: "card",
          ...(visibleTags ? { visibleTags } : {}),
        });
        el.classList.add("s-reading__content");
        // Same call, same element, same module as the reading view — see
        // client/textLayout.ts for why this is not three implementations.
        applyNoteLayoutTo(el, note.content);
        dropDuplicateTitle(el, title);
        // Auto-numbered headings, frontmatter ONLY on the public page: a
        // visitor has no preference of ours to read, so a numbered post is
        // numbered because its author said `numbered: true` in the file.
        numberRendered(el, note.content, { frontmatterOnly: true });
        bodyRef.current.replaceChildren(el);
        // [[Note#Heading]] deep links land on the requested heading.
        const pending = useStore.getState().pendingHeading;
        if (pending !== null) {
          useStore.getState().setPendingHeading(null);
          scrollToHeading(bodyRef.current, pending);
        }
      })
      .catch((err: unknown) => {
        console.error(`vellum: failed to open ${path}`, err);
        toast(tf("openFailed", { path: title }));
      });
    return () => {
      disposed = true;
    };
  }, [path, tree, visibleTags, language]);

  // A wikilink to a heading of the note already on screen: openPath doesn't
  // change, only pendingHeading does — consume it here.
  useEffect(() => {
    if (pendingHeading === null || !bodyRef.current) return;
    useStore.getState().setPendingHeading(null);
    scrollToHeading(bodyRef.current, pendingHeading);
  }, [pendingHeading]);

  // [[#Heading]] within the same note dispatches this event (reading renderer).
  useEffect(() => {
    const onGoto = (ev: Event): void => {
      const host = bodyRef.current;
      if (!host) return;
      const detail = (ev as CustomEvent<{ text?: string }>).detail ?? {};
      if (detail.text) scrollToHeading(host, detail.text);
    };
    window.addEventListener("vellum:goto-heading", onGoto);
    return () => window.removeEventListener("vellum:goto-heading", onGoto);
  }, []);

  // Related: published notes wikilinked from/to this one (the blog's stand-in
  // for the app's local graph). The visitor graph contains published notes
  // only, so every neighbor is linkable. It asks the server for this note's
  // neighborhood rather than the whole graph, and the answer is cached per
  // path — a reader walking six articles used to refetch the entire link
  // graph six times.
  const graph = useNoteNeighborhood(path);

  const related = useMemo(() => {
    if (!graph) return [];
    const neighbors = new Set<string>();
    for (const e of graph.edges) {
      if (e.source === path) neighbors.add(e.target);
      if (e.target === path) neighbors.add(e.source);
    }
    neighbors.delete(path);
    const byPath = new Map((posts ?? []).map((p) => [p.path, p]));
    return [...neighbors]
      .map((p) => byPath.get(p) ?? null)
      .filter((p): p is PostMeta => p !== null);
  }, [graph, posts, path]);

  // Prev/next by date (posts arrive newest first).
  const index = posts?.findIndex((p) => p.path === path) ?? -1;
  const newer = index > 0 ? posts![index - 1] : null;
  const older = index >= 0 && index < posts!.length - 1 ? posts![index + 1] : null;

  return (
    // <article>, not <div>: the piece is the page's one self-contained thing,
    // and the element is what lets a screen reader jump straight to it.
    <article className="s-blog-page s-blog-article">
      <header
        className={`s-blog-article__head${isRtlText(title) ? " s-blog-article__head--rtl" : ""}`}
      >
        <h1 className="s-blog-article__title" dir="auto">
          {title}
        </h1>
        {meta && (
          <div className="s-blog-meta s-blog-article__meta">
            <time className="s-blog-meta__date" dateTime={meta.date}>
              {formatDate(meta.date, locale)}
            </time>
            <MetaSep className="s-blog-meta__dot" />
            <span>{countPhrase(meta.words, "words")}</span>
            <MetaSep className="s-blog-meta__dot" />
            <span>{countPhrase(meta.readingMinutes, "readMinutes")}</span>
          </div>
        )}
      </header>

      {meta?.banner ? (
        <div className="s-blog-hero">
          <img
            className="s-blog-hero__img"
            src={bannerSrc(meta.banner)}
            alt=""
            onLoad={(e) => {
              // Portrait-ish banners (tall screenshots): object-fit cover
              // would decapitate them — switch to a letterboxed contain.
              const img = e.currentTarget;
              const tall = img.naturalHeight > 0 && img.naturalWidth / img.naturalHeight < 4 / 3;
              img.classList.toggle("s-blog-hero__img--tall", tall);
            }}
            onError={(e) => {
              // Unloadable banner: no broken-image furniture above an article.
              const wrap = e.currentTarget.parentElement;
              if (wrap) wrap.style.display = "none";
            }}
          />
        </div>
      ) : bannerFallback === "generated" ? (
        <div
          className="s-blog-hero s-blog-hero--gen"
          style={{ background: generatedBannerCss(title) }}
          aria-hidden="true"
        />
      ) : null}

      <div className="s-blog-article__body" ref={bodyRef} />

      <footer className="s-blog-article__foot">
        {meta && meta.tags.length > 0 && (
          <div className="s-blog-article__tags">
            <TagChips tags={meta.tags} />
          </div>
        )}

        {shareButtons && (
        <div className="s-blog-share">
          <span className="s-blog-share__label">{t("blogShare")}</span>
          {shareLinks(title).map((s) => (
            <a
              key={s.name}
              className="s-blog-share__link"
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {s.name}
            </a>
          ))}
          <button type="button" className="s-blog-share__link" onClick={copyLink}>
            {t("blogCopyLink")}
          </button>
        </div>
        )}

        {(newer || older) && (
          <nav className="s-blog-pn" aria-label={t("blogMoreWritings")}>
            {older ? (
              <NavLink url={notePathToUrl(older.path)} className="s-blog-pn__card">
                <span className="s-blog-pn__label">
                  <span className="s-blog-pn__arrow" aria-hidden="true">
                    ←
                  </span>
                  {t("blogOlder")}
                </span>
                <span className="s-blog-pn__title" dir="auto">
                  {older.title}
                </span>
              </NavLink>
            ) : (
              <span className="s-blog-pn__spacer" />
            )}
            {newer ? (
              <NavLink
                url={notePathToUrl(newer.path)}
                className="s-blog-pn__card s-blog-pn__card--next"
              >
                <span className="s-blog-pn__label">
                  {t("blogNewer")}
                  <span className="s-blog-pn__arrow" aria-hidden="true">
                    →
                  </span>
                </span>
                <span className="s-blog-pn__title" dir="auto">
                  {newer.title}
                </span>
              </NavLink>
            ) : (
              <span className="s-blog-pn__spacer" />
            )}
          </nav>
        )}

        {related.length > 0 && (
          <section className="s-blog-related" aria-label={t("blogRelatedWritings")}>
            <h2 className="s-blog-heading">
              <span>{t("blogRelated")}</span>
            </h2>
            <ul className="s-blog-related__list">
              {related.map((p) => (
                <li key={p.path}>
                  <NavLink
                    url={notePathToUrl(p.path)}
                    className="s-blog-related__link"
                    dir="auto"
                  >
                    <span className="s-blog-related__star" aria-hidden="true">
                      ✦
                    </span>
                    {p.title}
                  </NavLink>
                  <span className="s-blog-related__date">
                    {formatDate(p.date, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <Marginalia path={path} />
      </footer>
    </article>
  );
}
