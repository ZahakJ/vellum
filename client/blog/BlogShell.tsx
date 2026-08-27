// The blog shell — what visitors of a PUBLIC_LAYOUT=blog instance see instead
// of the app: masthead (site name + tagline), a sticky nav of topic categories
// with inline search and a theme toggle, the routed page (home / topic /
// article), and a quiet footer. Owns the address bar in blog mode: pushState
// navigation, popstate, per-page document.title.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stripBidiControls } from "../../shared/bidi.ts";
import type { PostMeta, PublicFolderCard } from "../../shared/types.ts";
import { getNote, getPosts } from "../api.ts";
import { useBannerSrc } from "../components/BannerImg.tsx";
import { installHoverCards } from "../hovercard.ts";
import { t, tf } from "../i18n.ts";
import LoginModal from "../components/LoginModal.tsx";
import { renderNoteContent } from "../reading/renderNote.ts";
import { texPreviewSource } from "../reading/texRender.ts";
import { isTexPath, noteTitleOf } from "../../shared/noteFormat.ts";
import { notePathToUrl, urlToNoteGuess, urlToNotePath } from "../router.ts";
import { useStore } from "../state.ts";
import { choiceGroup, counterpartChoice } from "../themes.ts";
import BackToTop from "./BackToTop.tsx";
import BlogArticle from "./BlogArticle.tsx";
import BlogDashboard from "./BlogDashboard.tsx";
import BlogFolder from "./BlogFolder.tsx";
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
import Ambient from "../ambient.tsx";

/** Basename of a note path, bidi controls stripped — the card header and the
 *  duplicate-H1 trim both key off it. */
function noteTitle(path: string): string {
  return stripBidiControls(noteTitleOf(path));
}

/** What the nav gets when the "show in navigation" sub-option is off. A shared
 *  frozen array, not a fresh `[]`: NavTopics measures its row in a layout
 *  effect keyed on this list, and a new identity per render would re-measure
 *  the nav on every keystroke in the search box. */
const NO_FOLDERS: PublicFolderCard[] = Object.freeze([]) as unknown as PublicFolderCard[];

type Route =
  | { kind: "home" }
  | { kind: "topic"; tag: string }
  // A PUBLIC FOLDER page — the owner's own collection (settings.publicFolders).
  | { kind: "folder"; slug: string }
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
  // Public folders sit AFTER the note check with the topics, under the same
  // rule: a published note at `folder/games.md` keeps its own deep link, and
  // only when nothing in the vault answers does /folder/ mean the collection.
  if (pathname.startsWith("/folder/")) {
    try {
      const slug = decodeURIComponent(pathname.slice("/folder/".length)).replace(/\/+$/, "");
      if (slug !== "") return { kind: "folder", slug };
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
      // differently" — with twenty-one themes, stepping to the next one in the
      // list means walking a visitor through the whole dark half to reach daylight.
      // counterpartChoice() names the pair for each theme instead — and it
      // answers for a custom theme too, by way of the built-in it was built on.
      onClick={() => useStore.getState().setTheme(counterpartChoice(theme))}
    >
      {choiceGroup(theme) === "light" ? (
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
  // Set when the server served every language because the one this reader is
  // reading in has nothing published in it (shared/types.ts::MeData).
  const languageFallback = useStore((s) => s.languageFallback);
  const tree = useStore((s) => s.tree);
  const homeMode = useStore((s) => s.home?.mode ?? "note");
  // The owner's own collections. Read here rather than inside NavTopics so the
  // document title can name one, and so the nav's measurement twin re-runs
  // when the list changes (NavTopics.tsx:191-205 — the known trap).
  const folders = useStore((s) => s.publicFolders);
  const foldersInNav = useStore((s) => s.publicFoldersNav);
  const logo = useStore((s) => s.logo);
  // Same ladder as every other typed image reference (client/banner.ts): an
  // unresolvable value leaves the masthead on its wordmark rather than on a
  // broken image icon.
  const logoSrc = useBannerSrc(logo).src;
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
        (next.kind !== "topic" || next.tag === (r as { tag: string }).tag) &&
        (next.kind !== "folder" || next.slug === (r as { slug: string }).slug);
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
    } else if (route.kind === "folder") {
      // The folder's TITLE, not its slug — the slug is an address and the
      // title is what the owner called the room. An unknown slug has no title
      // to print, so the address is the honest fallback.
      const folder = folders.find((f) => f.slug === route.slug);
      document.title = `${folder ? folder.title : route.slug} · ${siteName}`;
    } else {
      document.title = tagline ? `${siteName} — ${tagline}` : siteName;
    }
  }, [route, siteName, tagline, folders]);

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

  // NAV CHIPS ARE NAVIGATION; THE HOME BAND IS AN INVITATION (v1.8 UX audit
  // F29). An empty collection still draws its card on the home band — it says
  // "0 published notes" on its face, and a room the owner made and has not
  // filled is a promise the reader can see the shape of. A NAV CHIP says none
  // of that: it is the same pill as a topic that leads somewhere, it costs the
  // row a slot that a topic with posts behind it could have had, and on a
  // phone (where the collections now stay unfolded, F38) that slot is the
  // scarcest thing in the shell. So the row carries the collections that have
  // something in them. docs/blog-mode.md says so.
  const navFolders = useMemo(() => {
    if (!foldersInNav) return NO_FOLDERS;
    const filled = folders.filter((f) => f.count > 0);
    return filled.length === folders.length ? folders : filled;
  }, [folders, foldersInNav]);

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
  // The masthead carries the page's h1 only on the home route (see below).
  // `locked` is deliberately included: the private-vault card is a notice, not
  // a page with sections, and the site's name is still the only title it has.
  const routeIsHome = route.kind === "home";

  return (
    <div className="s-blog" ref={attachScroll}>
      {/* First tab stop: past the masthead and the topic nav, into the piece
          the reader came for. */}
      <a className="s-skip" href="#s-blog-main">
        {t("skipToContent")}
      </a>
      {!dashboardHome && (
        <header className="s-blog-mast">
          {/* The optional atmosphere, behind everything in this header and
              reachable by nothing (client/ambient.tsx). Null unless the owner
              turned it on, and unless the room in force has an air. */}
          <Ambient />
          {!logoSrc && (
            <div className="s-blog-mast__star" aria-hidden="true">
              ✦
            </div>
          )}
          {/* THE HOME PAGE'S OWN TITLE IS THE SITE'S NAME. Moving the
              Collections band above the writings (F27) left the note-mode home
              with a section heading (h2 "Collections") standing in front of
              its h1 ("Writings") — an outline that opens at level 2 and then
              climbs. The dashboard home already answers this the right way
              (BlogDashboard's hero name is its h1 and its sections are h2), so
              the classic masthead does the same on the home route: the site
              name is the page's heading, the three bands under it are its
              sections. Everywhere else the masthead is chrome and the page's
              own h1 is the article, the topic or the collection. */}
          {routeIsHome ? (
            <h1 className="s-blog-mast__title">
              <NavLink url="/" className="s-blog-mast__name" dir="auto">
                {logoSrc ? (
                  <img className="s-blog-mast__logo" src={logoSrc} alt={siteName} />
                ) : (
                  siteName
                )}
              </NavLink>
            </h1>
          ) : (
            <NavLink url="/" className="s-blog-mast__name" dir="auto">
              {logoSrc ? (
                <img className="s-blog-mast__logo" src={logoSrc} alt={siteName} />
              ) : (
                siteName
              )}
            </NavLink>
          )}
          {tagline && (
            <p className="s-blog-mast__tagline" dir="auto">
              {tagline}
            </p>
          )}
        </header>
      )}

      {/* Two navs on this page (this one and the article's prev/next), so
          both have to say which is which. */}
      <nav
        className={`s-blog-nav${menuOpen ? " s-blog-nav--open" : ""}`}
        aria-label={t("siteNav")}
      >
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
            {/* The word is in a span so the narrowest phones can drop it: the
                button keeps its aria-label, and at 390 with a collections row
                beside it (F38) sixty pixels of "TOPICS" is sixty pixels the
                collections do not get. */}
            <span className="s-blog-nav__burgerlabel">{t("blogTopics")}</span>
          </button>
          <NavTopics
            topics={topics}
            folders={navFolders}
            activeFolder={route.kind === "folder" ? route.slug : null}
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

      {/* tabIndex -1 so the skip link above can actually land focus here. */}
      <main className="s-blog-main" id="s-blog-main" tabIndex={-1}>
        {/* The quiet note. Under `languageFilter: "follow"` (or a pinned mode)
            the server stands the filter down when the language in force
            matches no published note, and serves the whole collection rather
            than an empty site — this is the one line that says why the reader
            is seeing both languages. Quiet on purpose: it explains a mercy,
            not an error, and the LOUD version of the same fact belongs to the
            admin (status bar + settings panel), who is the only person who can
            do anything about it. */}
        {!locked && languageFallback && (
          <p className="s-blog-langnote">{t("langFallbackNote")}</p>
        )}
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
        ) : route.kind === "folder" ? (
          <BlogFolder slug={route.slug} posts={posts} locale={locale} />
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
