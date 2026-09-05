// The designed public shell — the SECOND renderer, beside the stock blog and
// never inside it.
//
// It owns its own routing (home / topic / article), composes its chrome from
// `design.site`, and draws its page from `design.sections`. The stock blog is
// imported for exactly one purpose: to BE the fallback. `<BlogShell />` is
// rendered here unmodified, with no props, no wrapper class and no
// pre-mounting side effect — which is what makes "drop to stock" a real
// rescue rather than a second designed page wearing the base's name.
//
// The fallback rule, in one place:
//   · this session is a plain VISITOR → any failure renders <BlogShell />;
//   · this session is the OWNER inspecting their own site (preview mode) →
//     the designed page stays up with the failing section replaced by a named
//     card, under a strip offering one click back to stock.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stripBidiControls } from "../../shared/bidi.ts";
import {
  DesignError,
  validateDesign,
  type DesignDoc,
  type HeroSection,
  type Section,
} from "../../shared/design.ts";
import type { PageMeta, PostMeta } from "../../shared/types.ts";
import { getPosts } from "../api.ts";
import BlogSearchOverlay from "../blog/BlogSearchOverlay.tsx";
import BlogShell from "../blog/BlogShell.tsx";
import { go, setNavHandler, topicUrl } from "../blog/nav.ts";
import { NavLink } from "../blog/util.tsx";
import LoginModal from "../components/LoginModal.tsx";
import { t, tf } from "../i18n.ts";
import { notePathToUrl, urlToNoteGuess, urlToNotePath } from "../router.ts";
import { useStore } from "../state.ts";
import { choiceGroup, counterpartChoice } from "../themes.ts";
import { getPublicDesign, type DesignNotice } from "./api.ts";
import { applyThemeChoice } from "./customThemes.ts";
import { DesignBoundary, type SectionFailure } from "./DesignBoundary.tsx";
// The CHROME — header, nav, footer — and the page layout for a static page.
// These are the design's frame; the sections below are what it frames.
import DesignFooter from "./DesignFooter.tsx";
import DesignHeader from "./DesignHeader.tsx";
import PageView from "./PageView.tsx";
import { typographyVars } from "../../shared/designChrome.ts";
import DesignedArticle from "./DesignedArticle.tsx";
import { RenderSection, sectionKindLabel } from "./Sections.tsx";
import "../styles/design.css";

type Route =
  | { kind: "home" }
  | { kind: "topic"; tag: string }
  | { kind: "article"; path: string }
  | { kind: "missing" };

function parseRoute(pathname: string): Route {
  if (pathname === "/") return { kind: "home" };
  // Notes first, exactly as the stock shell does it: a published note named
  // `topic.md` must not be shadowed by the reserved topic route.
  const notePath = urlToNotePath(pathname, useStore.getState().tree);
  if (notePath) return { kind: "article", path: notePath };
  if (pathname.startsWith("/topic/")) {
    try {
      const tag = decodeURIComponent(pathname.slice("/topic/".length)).replace(/\/+$/, "");
      if (tag !== "") return { kind: "topic", tag };
    } catch {
      // malformed percent-encoding — nothing to show
    }
  }
  // The tree is a DISCOVERY surface and is filtered; "not in the tree" is not
  // "not there". Hand the URL to /api/note rather than 404ing on a list that
  // was never meant to answer this (CONTRACTS: permalinks must keep working).
  const guess = urlToNoteGuess(pathname);
  if (guess !== null) return { kind: "article", path: guess };
  return { kind: "missing" };
}

/** THE THREE SHELLS THAT PUT THE CHROME BESIDE THE PAGE rather than above it.
 *  They wear a second class as well as their own, because the grid, the
 *  catch-all that lands every other child in the content column, and the whole
 *  business of turning a menu-row into a menu-LIST are one arrangement that
 *  three rooms share — and a stylesheet that repeated it three times would be
 *  three places for it to drift. `design.css` reads `.s-dsg-rail` for the
 *  shared half and `.s-dsg-shell--<name>` for what makes each one itself. */
const RAILED = new Set(["rail", "split", "console"]);

export default function DesignedSite() {
  const siteName = useStore((s) => s.siteName);
  const tagline = useStore((s) => s.tagline);
  const footerLine = useStore((s) => s.footerLine);
  const locale = useStore((s) => s.blogLocale);
  const authProtected = useStore((s) => s.authProtected);
  const loginOpen = useStore((s) => s.loginOpen);
  const locked = useStore((s) => !s.admin && !s.publicReads);
  const tree = useStore((s) => s.tree);
  // The OWNER is the session that turned preview on. In preview `me.admin` is
  // false by construction (the payload is visitor-shaped, which is the point),
  // so this flag — set by the store, never by the server — is what separates
  // "show me what is broken" from "show them the site that works".
  const owner = useStore((s) => s.previewVisitor);
  const language = useStore((s) => s.language);
  const logo = useStore((s) => s.logo);

  const [design, setDesign] = useState<DesignDoc | null>(null);
  const [notice, setNotice] = useState<DesignNotice | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [posts, setPosts] = useState<PostMeta[] | null>(null);
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));
  /** Every section that has failed since the design last changed. */
  const [failures, setFailures] = useState<SectionFailure[]>([]);
  /** The burger drawer, on a narrow screen. Chrome state, not design state. */
  const [menuOpen, setMenuOpen] = useState(false);
  /** Published notes carrying `page: true`. They ride on the same payload as
   *  the design because they are part of what "designed" means: which URLs
   *  are pages rather than articles. */
  const [pages, setPages] = useState<PageMeta[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const onFail = useCallback((failure: SectionFailure) => {
    setFailures((list) => (list.some((f) => f.id === failure.id) ? list : [...list, failure]));
  }, []);

  // Load the design. Validated AGAIN, client-side, with the shared validator
  // the server used — defence in depth against a designs.json edited by hand
  // past the API (a documented way to configure this product) and against a
  // server one build ahead of this bundle. A refusal is a failure like any
  // other: visitors get the stock blog.
  useEffect(() => {
    let disposed = false;
    getPublicDesign()
      .then((payload) => {
        if (disposed) return;
        setNotice(payload.notice);
        setPages(payload.pages ?? []);
        if (!payload.design) {
          setDesign(null);
          return;
        }
        try {
          setDesign(validateDesign(payload.design));
          setConfigError(null);
        } catch (err) {
          setDesign(null);
          setConfigError(
            err instanceof DesignError ? err.message : err instanceof Error ? err.message : String(err),
          );
        }
      })
      .catch((err: unknown) => {
        if (disposed) return;
        console.error("vellum: loading the design failed", err);
        setDesign(null);
        setConfigError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      disposed = true;
    };
  }, []);

  // A design may force a theme on readers who have not chosen one — the same
  // rule DEFAULT_THEME follows, and for the same reason: a stored preference
  // is a person's choice and outranks the site's.
  useEffect(() => {
    if (!design?.theme) return;
    if (localStorage.getItem("vellum.theme")) return;
    applyThemeChoice(design.theme);
  }, [design?.theme]);

  // Posts feed every list section and the topics nav.
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

  // Routing: the nav singleton, popstate, and store-driven navigation
  // (a wikilink click inside a rendered note calls openNote).
  useEffect(() => {
    const navigate = (url: string): void => {
      if (location.pathname + location.hash === url) return;
      history.pushState(null, "", url);
      setRoute(parseRoute(location.pathname));
      setMenuOpen(false);
      scrollRef.current?.scrollTo(0, 0);
    };
    setNavHandler(navigate);
    const onPop = (): void => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", onPop);
    const onSearch = (ev: Event): void => {
      const tag = ((ev as CustomEvent<string>).detail ?? "").replace(/^#/, "").trim();
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
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("vellum:search", onSearch);
      unsubscribe();
    };
  }, []);

  // A route parsed before the tree landed can be wrong (a deep link on a slow
  // boot, a login unlocking a private vault).
  useEffect(() => setRoute(parseRoute(location.pathname)), [tree]);

  useEffect(() => {
    if (route.kind === "article") {
      const title = stripBidiControls(route.path.split("/").pop()!.replace(/\.md$/i, ""));
      document.title = `${title} · ${siteName}`;
    } else if (route.kind === "topic") {
      document.title = `${route.tag} · ${siteName}`;
    } else {
      document.title = tagline ? `${siteName} — ${tagline}` : siteName;
    }
  }, [route, siteName, tagline]);

  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of posts ?? []) {
      for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([tag]) => tag);
  }, [posts]);

  // ── The fallback decision ────────────────────────────────────────────────
  // One expression, evaluated the same way for every kind of failure.
  const broken = configError !== null || design === null || failures.length > 0;
  if (broken && !owner) {
    // A VISITOR never learns any of this happened. The stock blog renders
    // from here exactly as it renders from App.tsx — same component, same
    // props (none), same CSS.
    if (configError) console.error("vellum: design config rejected —", configError);
    return <BlogShell />;
  }
  // The owner, with nothing renderable at all: the notice is all there is.
  if (design === null) {
    return (
      <div className="s-dsn" ref={scrollRef}>
        <OwnerNotice
          failures={failures}
          notice={notice}
          configError={configError}
          designName={null}
        />
        <BlogShell />
      </div>
    );
  }

  const site = design.site;
  const chrome = design.chrome;
  const sections = design.sections.filter((section) => !section.hidden);
  const sticky = chrome.header.sticky;
  // The section column is measured in px; the reading measure and the whole
  // type scale come from the chrome, as CSS variables on this one root. Both
  // are inline because both are per-DESIGN, and a stylesheet cannot be.
  const style = {
    "--dsn-width": `${site.width}px`,
    ...typographyVars(chrome.typography),
  } as React.CSSProperties;
  // The topics list is a FALLBACK: it fills the nav only while the author has
  // built no menu of their own, and `fallback: "none"` declines even that.
  const navTopics = chrome.nav.items.length === 0 && chrome.nav.fallback === "topics" ? topics : [];
  /* A `cover` hero prints the site's name across a full-width photograph, so
     the masthead above it may be nameless without being empty. Computed from
     the VISIBLE sections and only on the home route: the same design on an
     article page has no hero, and a masthead that dropped its wordmark there
     would be a site that forgets what it is called two clicks in. */
  const namedElsewhere =
    route.kind === "home" &&
    sections.some((s) => s.kind === "hero" && (s as HeroSection).treatment === "cover");
  const pageSet = new Set(pages.map((page) => page.path));

  return (
    <div
      // THE SURFACE IS ON THE SCROLLPORT, which is this element — so the
      // pattern is the paper the WHOLE site is printed on (masthead, page and
      // footer alike) rather than a texture that stops at the top of the
      // writing and gives the header a seam. `flat` emits the class too and
      // draws nothing, so the five values are five rules and none of them is
      // "the absence of a rule".
      className={`s-dsn s-dsg s-dsn--${site.density} s-dsg-surf--${chrome.surface} s-dsg-sky--${chrome.scenery} s-dsg-orn--${chrome.ornament} s-dsg-shell--${chrome.shell}${RAILED.has(chrome.shell) ? " s-dsg-rail" : ""} s-dsg-frame--${chrome.frame}${sticky !== "none" ? " s-dsn--sticky" : ""}`}
      style={style}
      ref={scrollRef}
      // Chrome copy inside re-renders on a live language switch; keeping the
      // subscription on the root is enough because every child re-renders with
      // it.
      data-lang={language}
    >
      {/* THE SKY IS THE FIRST CHILD, and that is load-bearing rather than
          tidy: it is a zero-height `sticky` box, and a sticky box pins to the
          top of the scrollport only from the position it occupies in flow.
          Below the masthead it would pin one masthead down and the world would
          begin under the site's own name. It is empty, `aria-hidden` and
          `pointer-events: none` — decoration in the 1.4.3 sense, which is the
          only footing on which a moving thing belongs near a page of prose —
          and it is absent entirely when the design stands in no world, so the
          designs that had no sky do not grow a node. */}
      {chrome.scenery !== "none" && (
        <>
          {/* TWO LAYERS, AND THEY ARE SIBLINGS RATHER THAN NESTED. The marks
              carry value and are bounded by a measured ratio; the light carries
              hue and is not. They cannot be one element because they blend
              differently, and they cannot be parent and child because a layer
              with `z-index: -1` is a stacking context and therefore an isolated
              group — a blend inside one sees no backdrop and paints raw. Both
              are empty, `aria-hidden` and `pointer-events: none`. */}
          <div className="s-dsn-sky s-dsn-sky--ink" aria-hidden="true" />
          <div className="s-dsn-sky s-dsn-sky--hue" aria-hidden="true" />
        </>
      )}

      {owner && (failures.length > 0 || notice) && (
        <OwnerNotice
          failures={failures}
          notice={notice}
          configError={configError}
          designName={design.name}
        />
      )}

      {/* Header, nav and footer are each their OWN boundary. A nav item
          pointing at something that has gone must cost the visitor the nav,
          not the page — and the owner is told which of the three it was. */}
      <div className={`s-dsg-top${sticky === "header" ? " s-dsg-top--sticky" : sticky === "nav" ? " s-dsg-top--stickynav" : ""}`}>
        <DesignBoundary
          key={`${design.updatedMs}:header`}
          id="header"
          kind="header"
          onFail={onFail}
          fallback={(failure) => <FailedSection failure={failure} />}
        >
          <DesignHeader
            header={chrome.header}
            items={chrome.nav.items}
            navStyle={chrome.nav.style}
            namedElsewhere={namedElsewhere}
            topics={navTopics}
            pathname={route.kind === "article" ? notePathToUrl(route.path) : location.pathname}
            siteName={siteName}
            tagline={chrome.header.showTagline ? tagline : null}
            logo={logo}
            menuOpen={menuOpen}
            onToggleMenu={() => setMenuOpen((open) => !open)}
            tools={
              <>
                {chrome.nav.showSearch && (
                  <button
                    type="button"
                    className="s-dsn-nav__tool"
                    onClick={() => window.dispatchEvent(new Event("vellum:quicksearch"))}
                  >
                    {t("scSearch")}
                  </button>
                )}
                {chrome.nav.showThemeToggle && <DesignThemeButton />}
              </>
            }
          />
        </DesignBoundary>
      </div>

      <main className="s-dsn-main">
        {locked ? (
          <div className="s-dsn-page s-dsn-locked">
            <p className="s-dsn-locked__title">{t("blogPrivate")}</p>
            <button
              type="button"
              className="s-btn s-btn--accent"
              onClick={() => useStore.getState().setLoginOpen(true)}
            >
              {t("signIn")}
            </button>
          </div>
        ) : route.kind === "home" ? (
          <div className="s-dsn-page">
            {sections.map((section) => (
              <DesignBoundary
                // Keyed on the design's own stamp as well as the section id:
                // a fixed design clears every failure card without a reload.
                key={`${design.updatedMs}:${section.id}`}
                id={section.id}
                kind={section.kind}
                onFail={onFail}
                fallback={(failure) => <FailedSection failure={failure} />}
              >
                <RenderSection section={section as Section} posts={posts} locale={locale} />
              </DesignBoundary>
            ))}
          </div>
        ) : route.kind === "topic" ? (
          <div className="s-dsn-page">
            <TopicPage tag={route.tag} posts={posts} locale={locale} />
          </div>
        ) : route.kind === "article" ? (
          <div className="s-dsn-page">
            <DesignBoundary
              key={`${design.updatedMs}:article:${route.path}`}
              id={route.path}
              kind="page"
              onFail={onFail}
              fallback={(failure) => <FailedSection failure={failure} />}
            >
              {/* A static page is an ordinary note wearing `page: true`; it
                  gets title-and-prose instead of the article furniture. */}
              {pageSet.has(route.path) ? (
                <PageView path={route.path} />
              ) : (
                <DesignedArticle
                  path={route.path}
                  posts={posts}
                  locale={locale}
                  options={design.article}
                />
              )}
            </DesignBoundary>
          </div>
        ) : (
          <div className="s-dsn-page s-dsn-locked">
            <p className="s-dsn-locked__title">{t("blogNoPage")}</p>
            <NavLink url="/" className="s-dsn-back">
              {t("blogBackToWritings")}
            </NavLink>
          </div>
        )}
      </main>

      <DesignBoundary
        key={`${design.updatedMs}:footer`}
        id="footer"
        kind="footer"
        onFail={onFail}
        fallback={(failure) => <FailedSection failure={failure} />}
      >
        <DesignFooter
          footer={chrome.footer}
          siteName={siteName}
          instanceFooter={footerLine}
          authProtected={authProtected}
          onSignIn={() => useStore.getState().setLoginOpen(true)}
        />
      </DesignBoundary>
      {/* THE SEARCH OVERLAY IS SHARED, and deliberately so. It is a modal, not
          a piece of page composition: it is opened by Ctrl/Cmd+K (App
          dispatches `vellum:quicksearch` for every non-app shell) and by the
          nav's own button, it draws over the site rather than in it, and its
          results are the visitor's published hits either way. Mounting it here
          is COMPOSING a self-contained overlay, not extending the stock page —
          and the alternative was a second search UI, or a nav button that
          dispatched an event nobody was listening for. */}
      <BlogSearchOverlay />
      {loginOpen && <LoginModal />}
    </div>
  );
}

/** The ☾/☀ button, in the designed shell's own markup. Same behaviour as the
 *  stock one and none of its CSS. */
function DesignThemeButton() {
  const theme = useStore((s) => s.theme);
  useStore((s) => s.language);
  return (
    <button
      type="button"
      className="s-dsn-nav__tool"
      aria-label={t("blogSwitchTheme")}
      onClick={() => useStore.getState().setTheme(counterpartChoice(theme))}
    >
      {choiceGroup(theme) === "light" ? "☀" : "☾"}
    </button>
  );
}

function TopicPage({
  tag,
  posts,
  locale,
}: {
  tag: string;
  posts: PostMeta[] | null;
  locale: string;
}) {
  const wanted = tag.toLowerCase();
  const list = (posts ?? []).filter((post) =>
    post.tags.some((entry) => entry.toLowerCase() === wanted),
  );
  return (
    <section className="s-dsn-block">
      <h1 className="s-dsn-head">
        <bdi>#{tag}</bdi>
      </h1>
      {list.length === 0 ? (
        <p className="s-dsn-empty">{t("dsnNoPosts")}</p>
      ) : (
        <RenderSection
          section={{
            id: "topic",
            kind: "postList",
            heading: "",
            limit: 200,
            tag,
            showExcerpt: true,
            showDate: true,
            // A topic archive is a river and stays one: the page is the
            // product's own, not a section the design composed, and a
            // dateline on it would be a layout nobody chose.
            layout: "river",
          }}
          posts={posts}
          locale={locale}
        />
      )}
    </section>
  );
}

/** What the OWNER sees in a failed section's place. A visitor never reaches
 *  this component: by the time it would render, the page has already handed
 *  over to the stock blog. */
function FailedSection({ failure }: { failure: SectionFailure }) {
  const name = sectionKindLabel(failure.kind);
  return (
    <div className="s-dsn-failed" role="status">
      <p className="s-dsn-failed__title">
        {tf("dsnSectionFailed", { section: name, id: failure.id })}
      </p>
      <p className="s-dsn-failed__why">
        {failure.key === "dsnNoteMissing"
          ? tf("dsnNoteMissing", { note: failure.detail ?? "" })
          : failure.key === "dsnNoteUnavailable"
            ? t("dsnNoteUnavailable")
            : failure.key === "dsnUnknownKind"
              ? (failure.detail ?? t("dsnUnknownKind"))
              : failure.message}
      </p>
    </div>
  );
}

/** The strip across the top of the OWNER's view: what is wrong, and one click
 *  back to the stock blog. That click is `PATCH /api/settings
 *  {publicLayout:"blog"}` and nothing else — the design file is not touched,
 *  so flipping forward again restores the site exactly as it was. */
function OwnerNotice({
  failures,
  notice,
  configError,
  designName,
}: {
  failures: SectionFailure[];
  notice: DesignNotice | null;
  configError: string | null;
  designName: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const first = failures[0];
  const line = first
    ? tf("dsnSectionFailed", { section: sectionKindLabel(first.kind), id: first.id })
    : configError
      ? tf("dsnConfigInvalid", { detail: configError })
      : notice?.reason === "corrupt"
        ? t("dsnCorruptStore")
        : notice?.reason === "quarantined"
        ? tf("dsnQuarantined", { design: notice.design ?? designName ?? "", detail: notice.detail ?? "" })
        : t("dsnNoDesign");

  const revert = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicLayout: "blog" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      location.reload();
    } catch (err) {
      console.error("vellum: reverting to the stock blog failed", err);
      setBusy(false);
    }
  };

  return (
    <div className="s-dsn-notice" role="alert">
      <span className="s-dsn-notice__dot" aria-hidden="true" />
      <span className="s-dsn-notice__text">
        <strong className="s-dsn-notice__head">{t("dsnBrokenTitle")}</strong> {line}
      </span>
      <button type="button" className="s-dsn-notice__action" onClick={() => void revert()} disabled={busy}>
        {t("dsnRevertStock")}
      </button>
    </div>
  );
}
