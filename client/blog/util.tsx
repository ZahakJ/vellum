// Small shared pieces of the blog shell: date formatting in the instance's
// BLOG_LOCALE and the intercepted <a> used for every internal link (real href
// for middle-click / copy-link semantics, client-side navigation on plain click).

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { siteDate } from "../dates.ts";
import { t } from "../i18n.ts";
import { go } from "./nav.ts";

/** ISO date → localized long date ("14 August 2026", "14 أغسطس 2026",
 *  "2 صفر 1448 هـ"…) in the chrome language, in whatever calendar the
 *  instance is set to.
 *
 *  The formatting itself moved to `client/dates.ts` — the ONE place a date is
 *  rendered for a human — when the calendar became a setting: the blog card,
 *  the moderation row and the backup badge each holding their own
 *  `Intl.DateTimeFormat` call was survivable with one calendar and is not
 *  survivable with three. A bad BCP47 tag (and an ICU build with no Umm
 *  al-Qura data) still falls back rather than throwing at render time. */
export function formatDate(iso: string, locale: string): string {
  // UTC keeps date-only frontmatter honest: "2026-08-02" is UTC midnight and
  // must never render as August 1 for readers west of Greenwich.
  return siteDate(iso, locale, { dateStyle: "long", timeZone: "UTC" });
}

/** True when the text's first letter belongs to a right-to-left script
 *  (Arabic/Hebrew blocks) — mirrors what dir="auto" decides for the title. */
export function isRtlText(text: string): boolean {
  const first = /\p{L}/u.exec(text)?.[0] ?? "";
  return /[\u0590-\u08FF\uFB1D-\uFEFC]/.test(first);
}

/** Internal link: plain left-click navigates client-side; modified clicks
 *  (new tab, middle click) keep native anchor behavior. */
export function NavLink({
  url,
  className,
  dir,
  title,
  style,
  tabIndex,
  "aria-hidden": ariaHidden,
  children,
}: {
  url: string;
  className?: string;
  dir?: string;
  title?: string;
  style?: CSSProperties;
  tabIndex?: number;
  "aria-hidden"?: boolean | "true" | "false";
  children?: ReactNode;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(url);
  };
  return (
    <a
      href={url}
      className={className}
      dir={dir}
      title={title}
      style={style}
      tabIndex={tabIndex}
      aria-hidden={ariaHidden}
      onClick={onClick}
    >
      {children}
    </a>
  );
}

/** THE BLOG'S LOADING STATE.
 *
 *  Both public homes drew a literal "…" in serif italic while the post list
 *  was in flight (v1.8 UX audit F41) — the same element and the same styling
 *  the EMPTY state uses, so the one thing a reader could not tell from it was
 *  which of the two they were looking at: a site still arriving, or a site
 *  with nothing on it.
 *
 *  Quiet bars in the shape of what is coming, and no animation on the bars
 *  themselves beyond one slow breath — a shimmer sweeping a public home page
 *  is a busier thing than the page it stands in for. `aria-hidden`, with the
 *  status said once in words: a screen reader wants "loading", not seven
 *  rectangles. */
export function BlogSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="s-blog-skel" role="status" aria-live="polite" aria-busy="true">
      <span className="s-sr-only">{t("loading")}</span>
      <span className="s-blog-skel__rows" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          <span key={i} className="s-blog-skel__row">
            <span className="s-blog-skel__title" />
            <span className="s-blog-skel__meta" />
          </span>
        ))}
      </span>
    </div>
  );
}
