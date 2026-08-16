// The blog shell — what visitors of a PUBLIC_LAYOUT=blog instance see instead
// of the app: masthead (site name + tagline), a sticky nav of topic categories
// with inline search and a theme toggle, the routed page (home / topic /
// article), and a quiet footer. Owns the address bar in blog mode: pushState
// navigation, popstate, per-page document.title.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stripBidiControls } from "../../shared/bidi.ts";
import type { PostMeta } from "../../shared/types.ts";
import { getNote, getPosts } from "../api.ts";
import { bannerSrc } from "../banner.ts";
import { installHoverCards } from "../hovercard.ts";
import { t, tf } from "../i18n.ts";
import LoginModal from "../components/LoginModal.tsx";
import { renderNoteContent } from "../reading/renderNote.ts";
import { texPreviewSource } from "../reading/texRender.ts";
import { isTexPath, noteTitleOf } from "../../shared/noteFormat.ts";
import { notePathToUrl, urlToNoteGuess, urlToNotePath } from "../router.ts";
import { useStore } from "../state.ts";
import { counterpartTheme, themeGroup } from "../themes.ts";
import BackToTop from "./BackToTop.tsx";
import BlogArticle from "./BlogArticle.tsx";
import BlogDashboard from "./BlogDashboard.tsx";
import BlogHome from "./BlogHome.tsx";
import BlogSearch from "./BlogSearch.tsx";
import BlogSearchOverlay from "./BlogSearchOverlay.tsx";
import BlogTopic from "./BlogTopic.tsx";
import LangSwitch from "./LangSwitch.tsx";
import NavTopics from "./NavTopics.tsx";
import { go, setNavHandler, topicUrl } from "./nav.ts";
import { previewExcerpt, previewPath } from "./postPreview.ts";
import { NavLink } from "./util.tsx";
import "../styles/blog.css";

/** Basename of a note path, bidi controls stripped — the card header and the
 *  duplicate-H1 trim both key off it. */
function noteTitle(path: string): string {
  return stripBidiControls(noteTitleOf(path));
}

type Route =
  | { kind: "home" }
  | { kind: "topic"; tag: string }
  | { kind: "article"; path: string }
  // A path the tree cannot answer, waiting on /api/note (see parseRoute).
  | { kind: "probe"; path: string }
  // `pathname` records which URL was found missing, so re-parsing on a tree
  // change does not send the same dead link round the probe again.
  | { kind: "missing"; pathname: string };

function parseRoute(pathname: string): Route {
  if (pathname === "/") return { kind: "home" };
  // Notes first: reserved routes must never shadow a published note's deep
  // link (a root note named graph.md lives at /graph; a note in a "topic"
  // folder lives under /topic/…). Only when no note matches do the reserved
  // routes get their meaning.
  const notePath = urlToNotePath(pathname, useStore.getState().tree);
  if (notePath) return { kind: "article", path: notePath };
  if (pathname === "/graph") return { kind: "home" }; // app-URL courtesy
  if (pathname.startsWith("/topic/")) {
    try {
      const tag = decodeURIComponent(pathname.slice("/topic/".length)).replace(/\/+$/, "");
      if (tag !== "") return { kind: "topic", tag };
    } catch {
      // malformed percent-encoding — nothing to show
    }
  }
  // The tree is a DISCOVERY surface — publishedNotes() prunes it for the
  // languageFilter — so "not in the tree" is not "not there": every published
  // note stays reachable by its own URL (CONTRACTS: /api/note is never
  // filtered). Hand the URL to the server rather than 404ing on a list that
  // was never meant to answer this question.
  const guess = urlToNoteGuess(pathname);
  if (guess !== null) return { kind: "probe", path: guess };
  return { kind: "missing", pathname };
}

function ThemeButton() {
  const theme = useStore((s) => s.theme);
  // Subscribe to the language so a live settings change re-renders the labels.
  useStore((s) => s.language);
  return (
    <button
      type="button"
      className="s-blog-iconbtn"
      title={tf("cmdTheme", { t: theme })}
      aria-label={t("blogSwitchTheme")}
      // A ☾/☀ button on a public page means "the same site, lit
      // differently" — with fifteen themes, stepping to the next one in the
      // list means walking a visitor through ten dark rooms to reach daylight.
      // counterpartTheme() names the pair for each theme instead.
      onClick={() => useStore.getState().setTheme(counterpartTheme(theme))}
    >
      {themeGroup(theme) === "light" ? (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
        </svg>
      )}
    </button>
  );
}

export default function BlogShell() {
  const siteName = useStore((s) => s.siteName);
  const tagline = useStore((s) => s.tagline);
  const footerLine = useStore((s) => s.footerLine);
  const locale = useStore((s) => s.blogLocale);
  const authProtected = useStore((s) => s.authProtected);
  const loginOpen = useStore((s) => s.loginOpen);
  const locked = useStore((s) => !s.admin && !s.publicReads);
  const tree = useStore((s) => s.tree);
  const homeMode = useStore((s) => s.home?.mode ?? "note");
  const logo = useStore((s) => s.logo);
  // Chrome strings come from t(); subscribing to the language re-renders the
  // shell when the admin switches it in settings (loadMe → store), or when a
  // visitor flips the EN/ع switch — no reload either way.
  const language = useStore((s) => s.language);

  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));
  const [posts, setPosts] = useState<PostMeta[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The scroll container as STATE as well as a ref: BackToTop and the hover
  // cards both need the element itself, and a ref alone is still null on the
  // render that mounts them.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const attachScroll = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);

  // Map the current location into the route (initial load, popstate, nav).
  const apply = (): void => {
    const next = parseRoute(location.pathname);
    if ((next.kind === "article" || next.kind === "probe") && location.hash) {
      try {
        useStore.getState().setPendingHeading(decodeURIComponent(location.hash.slice(1)));
      } catch {
        // bad hash encoding — ignore
      }
    }
    setRoute(next);
  };

  // Routing: register the nav singleton, wire popstate, and mirror
  // store-driven navigation (wikilink clicks in rendered notes call
  // openNote → openPath changes) into the address bar.
  useEffect(() => {
    const navigate = (url: string): void => {
      if (location.pathname + location.hash === url) return;
      history.pushState(null, "", url);
      apply();
      scrollRef.current?.scrollTo(0, 0);
    };
    setNavHandler(navigate);

    const onPopState = (): void => {
      apply();
    };
    window.addEventListener("popstate", onPopState);

    // Tag pills inside rendered notes dispatch "vellum:search" with "#tag" —
    // in blog mode that means the topic page.
    const onSearch = (ev: Event): void => {
      const detail = (ev as CustomEvent<string>).detail ?? "";
      const tag = detail.replace(/^#/, "").trim();
      if (tag) go(topicUrl(tag));
    };
    window.addEventListener("vellum:search", onSearch);

    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.openPath && s.openPath !== prev.openPath) {
        const url = notePathToUrl(s.openPath);
        if (location.pathname !== url) navigate(url);
      }
    });

    return () => {
      setNavHandler(null);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("vellum:search", onSearch);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Posts feed the list pages and the nav's topics. Refetched when the tree
  // changes — SSE keeps the tree fresh, so publish toggles reach the blog live.
  useEffect(() => {
    if (locked) return;
    let disposed = false;
    getPosts()
      .then((list) => {
        if (!disposed) setPosts(list);
      })
      .catch((err: unknown) => console.error("vellum: loading posts failed", err));
    return () => {
      disposed = true;
    };
  }, [tree, locked]);

  // A route parsed before the tree was in can be wrong (deep link on a slow
  // boot, login unlocking a locked vault, or a reserved-looking URL that is
  // really a note — /graph with a published graph.md): re-parse on tree
  // changes, keeping the current route object when nothing differs.
  useEffect(() => {
    setRoute((r) => {
      // A URL already answered "no such note" by the server stays answered:
      // re-probing it on every tree change would only ask again.
      if (r.kind === "missing" && r.pathname === location.pathname) return r;
      const next = parseRoute(location.pathname);
      const same =
        next.kind === r.kind &&
        (next.kind !== "article" || next.path === (r as { path: string }).path) &&
        (next.kind !== "topic" || next.tag === (r as { tag: string }).tag);
      return same ? r : next;
    });
  }, [tree]);

  // Resolve a probe route: the note exists (and is published) iff /api/note
  // answers. Nothing renders in between — one request, no flash of a 404 page
  // in front of an article that is about to load.
  useEffect(() => {
    if (route.kind !== "probe") return;
    const pathname = location.pathname;
    let disposed = false;
    getNote(route.path)
      .then(() => {
        if (!disposed) setRoute({ kind: "article", path: route.path });
      })
      .catch(() => {
        if (!disposed) setRoute({ kind: "missing", pathname });
      });
    return () => {
      disposed = true;
    };
  }, [route]);

  // Per-page document title.
  useEffect(() => {
    if (route.kind === "article") {
      const title = stripBidiControls(noteTitleOf(route.path));
      document.title = `${title} · ${siteName}`;
    } else if (route.kind === "topic") {
      document.title = `${route.tag} · ${siteName}`;
    } else {
      document.title = tagline ? `${siteName} — ${tagline}` : siteName;
    }
  }, [route, siteName, tagline]);

  // Route change closes the burger row (NavTopics closes its own menu off the
  // routeKey below).
  useEffect(() => {
    setMenuOpen(false);
  }, [route]);

  // Topic categories: published tags by frequency.
  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of posts ?? []) {
      for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag]) => tag);
  }, [posts]);
  const activeTag = route.kind === "topic" ? route.tag : null;

  // Hover previews for every post link the shell renders — one delegated
  // install on the scroll container covers dashboard cards, post lists, topic
  // pages, related, prev/next and search results, so no component below has
  // to know the feature exists. Reinstalled (and thus re-cached) when the
  // language changes, because the rendered note chrome carries t() strings.
  //
  // Read through a ref rather than a dependency: `posts` and `tree` refresh on
  // every SSE event, and re-installing on those would tear down a card the
  // reader is in the middle of reading.
  const postTags = useRef(new Map<string, string[]>());
  postTags.current = useMemo(
    () => new Map((posts ?? []).map((p) => [p.path, p.tags])),
    [posts],
  );
  useEffect(() => {
    if (!scrollEl || locked) return;
    return installHoverCards({
      root: scrollEl,
      scroller: scrollEl,
      resolve: previewPath,
      title: noteTitle,
      render: async (path) => {
        let content: string;
        try {
          // The ordinary visitor-scoped fetch: a note this session may not
          // read 401/404s here, and no card is ever built for it.
          content = (await getNote(path)).content;
        } catch {
          return null;
        }
        const md = isTexPath(path)
          ? texPreviewSource(content, null)
          : previewExcerpt(content, noteTitle(path));
        if (!md) return null;
        const tags = postTags.current.get(path);
        return renderNoteContent(md, {
          notePath: path,
          tree: useStore.getState().tree,
          embedded: true,
          // Same reading-renderer settings the article page uses: no
          // broken-link furniture, no ⌀ chips, and only the post's
          // server-filtered tags may render as pills.
          brokenLinks: "plain",
          missingImages: "card",
          ...(tags ? { visibleTags: new Set(tags.map((x) => x.toLowerCase())) } : {}),
        });
      },
    });
  }, [scrollEl, locked, language]);

  // Dashboard home carries the site identity inside its own hero — rendering
  // the masthead above it would say the site name twice. Every other page
  // (article, topic, note-mode home) keeps the classic masthead.
  const dashboardHome = homeMode === "dashboard" && route.kind === "home" && !locked;

  return (
    <div className="s-blog" ref={attachScroll}>
      {!dashboardHome && (
        <header className="s-blog-mast">
          {!logo && (
            <div className="s-blog-mast__star" aria-hidden="true">
              ✦
            </div>
          )}
          <NavLink url="/" className="s-blog-mast__name" dir="auto">
            {logo ? (
              <img className="s-blog-mast__logo" src={bannerSrc(logo)} alt={siteName} />
            ) : (
              siteName
            )}
          </NavLink>
          {tagline && (
            <p className="s-blog-mast__tagline" dir="auto">
              {tagline}
            </p>
          )}
        </header>
      )}

      <nav className={`s-blog-nav${menuOpen ? " s-blog-nav--open" : ""}`}>
        <div className="s-blog-nav__inner">
          <button
            type="button"
            className="s-blog-nav__burger"
            aria-label={t("blogTopics")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
            {t("blogTopics")}
          </button>
          <NavTopics
            topics={topics}
            activeTag={activeTag}
            isHome={route.kind === "home"}
            expandAll={menuOpen}
            routeKey={`${route.kind}:${activeTag ?? location.pathname}`}
          />
          <div className="s-blog-nav__tools">
            <BlogSearch />
            <LangSwitch />
            <ThemeButton />
          </div>
        </div>
      </nav>

      <main className="s-blog-main">
        {locked ? (
          <div className="s-blog-page s-blog-locked">
            <div className="s-blog-locked__glyph" aria-hidden="true">
              ✦
            </div>
            <p className="s-blog-locked__title">{t("blogPrivate")}</p>
            <button
              type="button"
              className="s-btn s-btn--accent"
              onClick={() => useStore.getState().setLoginOpen(true)}
            >
              {t("signIn")}
            </button>
          </div>
        ) : route.kind === "home" ? (
          homeMode === "dashboard" ? (
            <BlogDashboard posts={posts} locale={locale} />
          ) : (
            <BlogHome posts={posts} locale={locale} />
          )
        ) : route.kind === "topic" ? (
          <BlogTopic tag={route.tag} posts={posts} locale={locale} />
        ) : route.kind === "article" ? (
          <BlogArticle key={route.path} path={route.path} posts={posts} locale={locale} />
        ) : route.kind === "probe" ? null : (
          <div className="s-blog-page s-blog-locked">
            <div className="s-blog-locked__glyph" aria-hidden="true">
              ✦
            </div>
            <p className="s-blog-locked__title">{t("blogNoPage")}</p>
            <NavLink url="/" className="s-blog-locked__home">
              <span className="s-blog-backarrow" aria-hidden="true">
                ←
              </span>
              {t("blogBackToWritings")}
            </NavLink>
          </div>
        )}
      </main>

      <footer className="s-blog-footer">
        {footerLine && (
          <p className="s-blog-footer__line" dir="auto">
            {footerLine}
          </p>
        )}
        <p className="s-blog-footer__meta">
          <span className="s-blog-footer__hint">
            <kbd>Ctrl K</kbd> {t("blogSearchHint")}
          </span>
          <a className="s-blog-footer__link" href="/feed.xml">
            RSS
          </a>
          {authProtected && (
            <button
              type="button"
              className="s-blog-footer__link"
              onClick={() => useStore.getState().setLoginOpen(true)}
            >
              {t("signIn")}
            </button>
          )}
          <span className="s-blog-powered">
            {t("blogPoweredBy")}{" "}
            <a href="https://github.com/ZahakJ/vellum" target="_blank" rel="noopener noreferrer">
              Vellum
            </a>
          </span>
        </p>
      </footer>

      <BackToTop scroller={scrollEl} />
      <BlogSearchOverlay />
      {loginOpen && <LoginModal />}
    </div>
  );
}
