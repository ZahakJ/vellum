// The blog shell — what visitors of a PUBLIC_LAYOUT=blog instance see instead
// of the app: masthead (site name + tagline), a sticky nav of topic categories
// with inline search and a theme toggle, the routed page (home / topic /
// article), and a quiet footer. Owns the address bar in blog mode: pushState
// navigation, popstate, per-page document.title.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PostMeta } from "../../shared/types.ts";
import { getPosts } from "../api.ts";
import { bannerSrc } from "../banner.ts";
import LoginModal from "../components/LoginModal.tsx";
import { notePathToUrl, urlToNotePath } from "../router.ts";
import { nextTheme, useStore } from "../state.ts";
import BlogArticle from "./BlogArticle.tsx";
import BlogDashboard from "./BlogDashboard.tsx";
import BlogHome from "./BlogHome.tsx";
import BlogSearch from "./BlogSearch.tsx";
import BlogSearchOverlay from "./BlogSearchOverlay.tsx";
import BlogTopic from "./BlogTopic.tsx";
import { go, setNavHandler, topicUrl } from "./nav.ts";
import { NavLink } from "./util.tsx";
import "../styles/blog.css";

const NAV_TOPICS_MAX = 7;

type Route =
  | { kind: "home" }
  | { kind: "topic"; tag: string }
  | { kind: "article"; path: string }
  | { kind: "missing" };

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
  return { kind: "missing" };
}

function ThemeButton() {
  const theme = useStore((s) => s.theme);
  return (
    <button
      type="button"
      className="s-blog-iconbtn"
      title={`Theme: ${theme}`}
      aria-label="Switch theme"
      onClick={() => useStore.getState().setTheme(nextTheme(theme))}
    >
      {theme === "parchment" ? (
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

  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));
  const [posts, setPosts] = useState<PostMeta[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const moreRef = useRef<HTMLDetailsElement | null>(null);

  // Map the current location into the route (initial load, popstate, nav).
  const apply = (): void => {
    const next = parseRoute(location.pathname);
    if (next.kind === "article" && location.hash) {
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
      const next = parseRoute(location.pathname);
      const same =
        next.kind === r.kind &&
        (next.kind !== "article" || next.path === (r as { path: string }).path) &&
        (next.kind !== "topic" || next.tag === (r as { tag: string }).tag);
      return same ? r : next;
    });
  }, [tree]);

  // Per-page document title.
  useEffect(() => {
    if (route.kind === "article") {
      const title = route.path.split("/").pop()!.replace(/\.md$/i, "");
      document.title = `${title} · ${siteName}`;
    } else if (route.kind === "topic") {
      document.title = `${route.tag} · ${siteName}`;
    } else {
      document.title = tagline ? `${siteName} — ${tagline}` : siteName;
    }
  }, [route, siteName, tagline]);

  // Route change closes the burger row and the "More ▾" menu.
  useEffect(() => {
    setMenuOpen(false);
    if (moreRef.current) moreRef.current.open = false;
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
  const shown = topics.slice(0, NAV_TOPICS_MAX);
  const overflow = topics.slice(NAV_TOPICS_MAX);

  const activeTag = route.kind === "topic" ? route.tag : null;

  const navItem = (tag: string) => (
    <NavLink
      key={tag}
      url={topicUrl(tag)}
      className={`s-blog-nav__link${tag === activeTag ? " s-blog-nav__link--active" : ""}`}
      dir="auto"
    >
      {tag}
    </NavLink>
  );

  // Dashboard home carries the site identity inside its own hero — rendering
  // the masthead above it would say the site name twice. Every other page
  // (article, topic, note-mode home) keeps the classic masthead.
  const dashboardHome = homeMode === "dashboard" && route.kind === "home" && !locked;

  return (
    <div className="s-blog" ref={scrollRef}>
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
            aria-label="Topics"
            aria-expanded={menuOpen}
            onClick={() =>
              setMenuOpen((v) => {
                const next = !v;
                // The burger row shows every topic — including the ones that
                // live in the (closed) "More ▾" details on wide screens.
                if (moreRef.current) moreRef.current.open = next;
                return next;
              })
            }
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
            Topics
          </button>
          <div className="s-blog-nav__links">
            <NavLink
              url="/"
              className={`s-blog-nav__link${route.kind === "home" ? " s-blog-nav__link--active" : ""}`}
            >
              Home
            </NavLink>
            {shown.map(navItem)}
            {overflow.length > 0 && (
              <details className="s-blog-more" ref={moreRef}>
                <summary className="s-blog-nav__link s-blog-more__summary">
                  More <span aria-hidden="true">▾</span>
                </summary>
                <div className="s-blog-more__menu">{overflow.map(navItem)}</div>
              </details>
            )}
          </div>
          <div className="s-blog-nav__tools">
            <BlogSearch />
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
            <p className="s-blog-locked__title">This journal is private.</p>
            <button
              type="button"
              className="s-btn s-btn--accent"
              onClick={() => useStore.getState().setLoginOpen(true)}
            >
              Sign in
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
        ) : (
          <div className="s-blog-page s-blog-locked">
            <div className="s-blog-locked__glyph" aria-hidden="true">
              ✦
            </div>
            <p className="s-blog-locked__title">There is no page here.</p>
            <NavLink url="/" className="s-blog-locked__home">
              ← Back to the writings
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
            <kbd>Ctrl K</kbd> search
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
              Sign in
            </button>
          )}
          <span className="s-blog-powered">
            powered by{" "}
            <a href="https://github.com/ZahakJ/vellum" target="_blank" rel="noopener noreferrer">
              Vellum
            </a>
          </span>
        </p>
      </footer>

      <BlogSearchOverlay />
      {loginOpen && <LoginModal />}
    </div>
  );
}
