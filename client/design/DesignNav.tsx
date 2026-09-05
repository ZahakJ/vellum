// THE HAND-BUILT MENU. The stock blog's nav is "the busiest published tags,
// in count order" — a good default and a terrible menu: it cannot hold an
// About page, cannot hold an external link, cannot be ordered, and changes
// under the operator's feet as they write. This renders the menu the operator
// actually built, and falls back to the stock RULE (not the stock component)
// when they have not built one yet.
//
// One level of nesting, by contract. A submenu opens on click (not hover: a
// hover menu is unreachable on a touch device and unusable next to it), keeps
// the keyboard, and closes on Escape, on an outside click and on navigation.

import { useEffect, useRef, useState } from "react";
import type { NavItem, NavStyle } from "../../shared/designChrome.ts";
import { t } from "../i18n.ts";
import { topicUrl } from "../blog/nav.ts";
import { isLabelled as tagIsLabelled, label as tagLabel } from "../tagLabels.ts";
import { NavLink } from "../blog/util.tsx";
import { notePathToUrl } from "../router.ts";

/** Where one item points. `null` for a group — a group is a label, and the
 *  label is not a link (a control that both opens a menu and navigates is a
 *  control that does the wrong one of those half the time). */
export function itemUrl(item: NavItem): string | null {
  switch (item.kind) {
    case "home":
      return "/";
    case "note":
    case "page":
      return item.target ? notePathToUrl(item.target) : null;
    case "topic":
      return item.target ? topicUrl(item.target) : null;
    case "url":
      return item.target ?? null;
    case "group":
      return null;
  }
}

/** True when this item names the page the reader is on. Site-relative URLs
 *  only: an external link is never "active". */
function isActive(item: NavItem, pathname: string): boolean {
  const url = itemUrl(item);
  if (!url || !url.startsWith("/")) return false;
  if (url === "/") return pathname === "/";
  return pathname === url;
}

function anyActive(item: NavItem, pathname: string): boolean {
  return isActive(item, pathname) || (item.children ?? []).some((c) => isActive(c, pathname));
}

function ExternalMark() {
  return (
    <svg
      className="s-dsg-nav__ext"
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function Leaf({ item, pathname }: { item: NavItem; pathname: string }) {
  const url = itemUrl(item);
  if (url === null) return null;
  const active = isActive(item, pathname);
  const cls = `s-dsg-nav__link${active ? " s-dsg-nav__link--active" : ""}`;
  // An authored label is the author's word. A topic item that has none (the
  // generated collection menu leaves it blank) reads the tag's localised
  // label, so an Arabic instance's menu says «برمجيات» and not "software".
  const topic = item.kind === "topic" ? (item.target ?? "") : "";
  const text = item.label || (topic ? tagLabel(topic) : item.label);
  const hint = !item.label && topic && tagIsLabelled(topic) ? `#${topic}` : undefined;
  // An external link is a REAL anchor: the client-side router has nothing to
  // say about another origin, and target=_blank carries the noopener pair.
  if (!url.startsWith("/")) {
    return (
      <a
        className={cls}
        href={url}
        {...(item.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        dir="auto"
      >
        {text}
        {item.newTab && <ExternalMark />}
      </a>
    );
  }
  return (
    <NavLink url={url} className={cls} dir="auto" title={hint}>
      {text}
    </NavLink>
  );
}

function Submenu({
  item,
  pathname,
  expanded,
}: {
  item: NavItem;
  pathname: string;
  /** The burger panel expands every submenu: on a phone a dropdown inside a
   *  drawer is a second layer of hiding for no gain. */
  expanded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Outside click / Escape close. Capture phase, like every other overlay in
  // the product, so a click that lands on a link still navigates.
  useEffect(() => {
    if (!open || expanded) return;
    const onDown = (e: MouseEvent): void => {
      if (!hostRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setOpen(false);
        hostRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, expanded]);

  // Navigation closes the menu — the reader has arrived.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const active = anyActive(item, pathname);
  const url = itemUrl(item);
  const show = expanded || open;
  return (
    <div className={`s-dsg-nav__group${show ? " s-dsg-nav__group--open" : ""}`} ref={hostRef}>
      <button
        type="button"
        className={`s-dsg-nav__link s-dsg-nav__trigger${active ? " s-dsg-nav__link--active" : ""}`}
        aria-expanded={show}
        onClick={() => {
          // A group has no destination; an item WITH children and its own
          // destination gets both — the label navigates, the chevron opens —
          // which is why the chevron is a separate hit area below.
          if (url === null || show) setOpen(!show);
          else setOpen(true);
        }}
        dir="auto"
      >
        {item.label}
        <svg
          className="s-dsg-nav__chev"
          viewBox="0 0 24 24"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <div className="s-dsg-nav__menu" role="group">
        {url !== null && (
          <NavLink url={url} className="s-dsg-nav__sublink" dir="auto">
            {item.label}
          </NavLink>
        )}
        {(item.children ?? []).map((child) => {
          const childUrl = itemUrl(child);
          if (childUrl === null) return null;
          const cls = `s-dsg-nav__sublink${isActive(child, pathname) ? " s-dsg-nav__sublink--active" : ""}`;
          return !childUrl.startsWith("/") ? (
            <a
              key={child.id}
              className={cls}
              href={childUrl}
              {...(child.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              dir="auto"
            >
              {child.label}
              {child.newTab && <ExternalMark />}
            </a>
          ) : (
            <NavLink key={child.id} url={childUrl} className={cls} dir="auto">
              {child.label}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}

export default function DesignNav({
  items,
  topics,
  pathname,
  expanded,
  style = "plain",
}: {
  items: NavItem[];
  /** The fallback list (busiest published tags) — used only when the operator
   *  has built no menu AND left the fallback on. Passed in already resolved
   *  so this component never has to know what a post is. */
  topics: string[];
  pathname: string;
  expanded: boolean;
  /**
   * How each item is drawn — pills, an accent rail, terminal brackets, or the
   * plain run this bar has always been.
   *
   * IT IS ONE CLASS ON THE RUN, not a class per link, and every treatment is
   * drawn on `.s-dsg-nav__link` from inside it. The submenu's own links are
   * deliberately LEFT PLAIN: a dropped card of pills is a control panel, and
   * brackets inside a floating menu read as syntax rather than as a menu. The
   * style dresses the BAR.
   *
   * Defaulted here as well as in the validator, because a preset's chrome
   * reaches the gallery canvas without passing `normalizeChrome` — the same
   * road `Sections.tsx` restates its own defaults for.
   */
  style?: NavStyle;
}) {
  const shown = items.filter((item) => !item.hidden);
  if (shown.length === 0 && topics.length === 0) return null;
  return (
    <div
      className={`s-dsg-nav__links s-dsg-nav__links--${style}`}
      role="navigation"
      aria-label={t("designNavLabel")}
    >
      {shown.length > 0
        ? shown.map((item) =>
            item.children && item.children.length > 0 ? (
              <Submenu key={item.id} item={item} pathname={pathname} expanded={expanded} />
            ) : (
              <Leaf key={item.id} item={item} pathname={pathname} />
            ),
          )
        : topics.map((tag) => (
            <NavLink
              key={tag}
              url={topicUrl(tag)}
              className={`s-dsg-nav__link${pathname === topicUrl(tag) ? " s-dsg-nav__link--active" : ""}`}
              dir="auto"
              title={tagIsLabelled(tag) ? `#${tag}` : undefined}
            >
              {tagLabel(tag)}
            </NavLink>
          ))}
    </div>
  );
}
