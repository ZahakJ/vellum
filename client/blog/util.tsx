// Small shared pieces of the blog shell: date formatting in the instance's
// BLOG_LOCALE and the intercepted <a> used for every internal link (real href
// for middle-click / copy-link semantics, client-side navigation on plain click).

import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { localeDigits } from "../i18n.ts";
import { go } from "./nav.ts";

/** ISO date → localized long date ("14 August 2026", "١٤ أغسطس ٢٠٢٦"…).
 *  A bad BCP47 tag falls back to "en" rather than throwing at render time. */
export function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  // UTC keeps date-only frontmatter honest: "2026-08-02" is UTC midnight and
  // must never render as August 1 for readers west of Greenwich.
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "long",
    timeZone: "UTC",
    ...localeDigits(locale),
  };
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).format(date);
  }
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
