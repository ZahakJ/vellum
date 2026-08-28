// The designed HEADER: site identity (logo and/or wordmark, tagline) plus the
// navigation bar, arranged by the header config.
//
// Five layouts, and they are five shapes rather than five paddings:
//   stacked      — the classic masthead: identity centred, nav on its own bar
//   stackedStart — the same block flushed to the reading direction's leading
//                  edge (which is the RIGHT edge in Arabic — the whole header
//                  is built from logical properties, so this is one rule, not
//                  two)
//   inline       — identity and navigation share one row: the compact header
//                  a site with six pages and no tagline wants
//   rule         — the newspaper: a hairline over the wordmark and a hairline
//                  under it, the menu centred in the band beneath
//   banner       — the magazine: the whole header is a field of `--bg-raised`
//                  running the full width behind a centred block
//
// FOUR OF THE FIVE ARE ONE TREE. `rule` and `banner` add no markup at all —
// they are the stacked tree wearing two more classes — and that is the test a
// new masthead has to pass to be a LAYOUT rather than a component: if it needs
// its own elements it is not arranging what is here, it is drawing something
// else. Only `inline` earns a second tree, because it genuinely reorders the
// nav into the identity's row.
//
// THE NAV CARRIES THE LAYOUT TOO. `s-dsg-nav--<layout>` goes on the nav element
// itself rather than being reached from the header with a sibling selector,
// because the two are siblings in one arrangement and nested in the other, and
// a stylesheet that has to know which is a stylesheet that breaks when the tree
// moves.
//
// Stickiness is a THIRD axis and is deliberately not folded into the layout:
// "the nav follows me down the page" is a reading decision, not a look.

import type { ReactNode } from "react";
import type { HeaderDesign, NavItem, NavStyle } from "../../shared/designChrome.ts";
import { bannerSrc } from "../banner.ts";
import { t } from "../i18n.ts";
import { NavLink } from "../blog/util.tsx";
import DesignNav from "./DesignNav.tsx";
import Ambient from "../ambient.tsx";

export default function DesignHeader({
  header,
  items,
  navStyle,
  topics,
  pathname,
  siteName,
  tagline,
  logo,
  tools,
  menuOpen,
  onToggleMenu,
}: {
  header: HeaderDesign;
  items: NavItem[];
  /** How the menu's items are drawn (`chrome.nav.style`). It arrives here
   *  rather than being read off a config this component does not take, because
   *  the header is the only thing that mounts the nav. */
  navStyle: NavStyle;
  topics: string[];
  pathname: string;
  siteName: string;
  tagline: string | null;
  logo: string | null;
  /** Search / theme / language — the shell owns them, because they are
   *  instance features rather than design ones. */
  tools: ReactNode;
  menuOpen: boolean;
  onToggleMenu: () => void;
}) {
  const inline = header.layout === "inline";
  const showLogo = header.showLogo && !!logo;
  const showName = header.showName || !showLogo; // never an empty identity
  const identity = (
    <NavLink url="/" className="s-dsg-head__id" dir="auto">
      {showLogo && <img className="s-dsg-head__logo" src={bannerSrc(logo!)} alt={siteName} />}
      {showName && <span className="s-dsg-head__name">{siteName}</span>}
    </NavLink>
  );

  const nav = (
    <DesignNav
      items={items}
      topics={topics}
      pathname={pathname}
      expanded={menuOpen}
      style={navStyle}
    />
  );

  // A BAR WITH NO LINKS IS NOT A BAR. `DesignNav` renders null when the
  // operator has built no menu and switched the topic fallback off — which is
  // a real design (an essayist with fourteen pieces on the front page does not
  // need a navigation) and used to arrive as a bug: the empty `<nav>` kept its
  // hairline, its padding and its 1100px row, and pushed the search box to the
  // far end of two hundred pixels of nothing. That reads as a menu that failed
  // to load, which is the opposite of the refusal it is meant to be. So when
  // there is nothing to navigate the bar does not exist, and the tools — which
  // belong to the instance rather than to the menu — ride under the identity
  // where a masthead's own furniture goes. The same predicate the nav uses,
  // stated once here: a component that renders null cannot be asked whether it
  // did.
  const hasMenu = items.some((item) => !item.hidden) || topics.length > 0;

  const burger = (
    <button
      type="button"
      className="s-dsg-nav__burger"
      aria-label={t("designMenu")}
      aria-expanded={menuOpen}
      onClick={onToggleMenu}
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
      {t("designMenu")}
    </button>
  );

  const headClass = [
    "s-dsg-head",
    `s-dsg-head--${header.layout}`,
    `s-dsg-head--${header.density}`,
    header.divider ? "s-dsg-head--divider" : "",
    hasMenu ? "" : "s-dsg-head--nomenu",
  ]
    .filter(Boolean)
    .join(" ");

  if (inline) {
    return (
      <header className={`${headClass}${menuOpen ? " s-dsg-head--menu" : ""}`}>
        <Ambient />
        <div className="s-dsg-head__row">
          <div className="s-dsg-head__block">
            {identity}
            {header.showTagline && tagline && (
              <p className="s-dsg-head__tagline" dir="auto">
                {tagline}
              </p>
            )}
          </div>
          {burger}
          {nav}
          <div className="s-dsg-nav__tools">{tools}</div>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className={headClass}>
        {/* The same optional atmosphere the stock masthead carries — one
            component, one stylesheet, both public shells. It is decoration, so
            it is not a design-config field: a design decides arrangement, and
            an owner's "should my site shimmer" is an instance setting. */}
        <Ambient />
        {identity}
        {header.showTagline && tagline && (
          <p className="s-dsg-head__tagline" dir="auto">
            {tagline}
          </p>
        )}
        {!hasMenu && <div className="s-dsg-nav__tools s-dsg-head__tools">{tools}</div>}
      </header>
      {hasMenu && (
        <nav
          className={`s-dsg-nav s-dsg-nav--${header.layout}${menuOpen ? " s-dsg-nav--open" : ""}`}
        >
          <div className="s-dsg-nav__inner">
            {burger}
            {nav}
            <div className="s-dsg-nav__tools">{tools}</div>
          </div>
        </nav>
      )}
    </>
  );
}
