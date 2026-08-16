// The designed HEADER: site identity (logo and/or wordmark, tagline) plus the
// navigation bar, arranged by the header config.
//
// Three layouts, and they are three shapes rather than three paddings:
//   stacked      — the classic masthead: identity centred, nav on its own bar
//   stackedStart — the same block flushed to the reading direction's leading
//                  edge (which is the RIGHT edge in Arabic — the whole header
//                  is built from logical properties, so this is one rule, not
//                  two)
//   inline       — identity and navigation share one row: the compact header
//                  a site with six pages and no tagline wants
//
// Stickiness is a THIRD axis and is deliberately not folded into the layout:
// "the nav follows me down the page" is a reading decision, not a look.

import type { ReactNode } from "react";
import type { HeaderDesign, NavItem } from "../../shared/designChrome.ts";
import { bannerSrc } from "../banner.ts";
import { t } from "../i18n.ts";
import { NavLink } from "../blog/util.tsx";
import DesignNav from "./DesignNav.tsx";

export default function DesignHeader({
  header,
  items,
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
    <DesignNav items={items} topics={topics} pathname={pathname} expanded={menuOpen} />
  );

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
  ]
    .filter(Boolean)
    .join(" ");

  if (inline) {
    return (
      <header className={`${headClass}${menuOpen ? " s-dsg-head--menu" : ""}`}>
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
        {identity}
        {header.showTagline && tagline && (
          <p className="s-dsg-head__tagline" dir="auto">
            {tagline}
          </p>
        )}
      </header>
      <nav className={`s-dsg-nav${menuOpen ? " s-dsg-nav--open" : ""}`}>
        <div className="s-dsg-nav__inner">
          {burger}
          {nav}
          <div className="s-dsg-nav__tools">{tools}</div>
        </div>
      </nav>
    </>
  );
}
