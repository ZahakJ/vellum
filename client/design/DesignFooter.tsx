// The designed FOOTER: up to four columns of links, text and social accounts,
// then the copyright line and the site's own meta row (RSS, the search hint,
// "powered by", and the sign-in door on a protected instance).
//
// THE META ROW IS NOT A COLUMN. Those four entries are facts about the
// INSTANCE, not about the design: the RSS feed exists because the server
// serves it, and the sign-in link is the only way back into a locked vault.
// They stay in the shell's hands, each behind its own switch, so a design
// that empties every column still leaves a site an operator can get into.
//
// The copyright is a TEMPLATE with the same two placeholders settings.footer
// has ({year}, {siteName}) — an operator who has written one has written the
// other — and an empty template inherits the instance's own footer line
// rather than printing nothing.

import type { FooterDesign, FooterEntry, SocialNetwork } from "../../shared/designChrome.ts";
import { getNumerals, t } from "../i18n.ts";
import { toNumerals } from "../../shared/numerals.ts";
import { NavLink } from "../blog/util.tsx";

/** {year} / {siteName} substituted — the same substitution server-side
 *  footerLine() does, including the numeral rule: a year printed beside an
 *  Arabic-Indic date must be in the same numerals as the date. */
export function renderCopyright(template: string, siteName: string): string {
  const year = toNumerals(String(new Date().getFullYear()), getNumerals());
  return template.replaceAll("{year}", year).replaceAll("{siteName}", siteName);
}

const SOCIAL_PATHS: Record<SocialNetwork, string> = {
  // Simple, legible marks at 15px — recognisable silhouettes rather than
  // brand-exact logos (which cannot be shipped without their licences).
  mastodon: "M12 2c4.4 0 8 2.2 8 6.2v5.3c0 3.2-2.6 4.6-5.6 4.9-2.4.2-4.6.1-6.9-.3v1.2c.3 1.4 1.6 1.6 3 1.7 1.9.1 3.6-.1 5.3-.4l.1 2c-1.9.5-3.9.7-5.9.5-3.3-.3-5-2-5-5.2V8.2C5 4.2 8.6 2 12 2z",
  x: "M4 4h4.2l4 5.6L16.9 4H20l-6.4 7.7L20.4 20h-4.2l-4.3-6-5 6H4l6.8-8.1z",
  github:
    "M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10 10 0 0 0 12 2z",
  linkedin:
    "M5.5 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM4 9h3v11H4zM10 9h2.9v1.5c.5-.9 1.6-1.8 3.3-1.8 3 0 3.8 1.9 3.8 4.6V20h-3v-5.9c0-1.5-.5-2.5-1.8-2.5-1 0-1.6.7-1.9 1.4-.1.2-.1.6-.1.9V20h-3z",
  rss: "M5 17.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM4 10.5a10.5 10.5 0 0 1 10.5 10.5h-3A7.5 7.5 0 0 0 4 13.5zM4 4a17 17 0 0 1 17 17h-3A14 14 0 0 0 4 7z",
  email: "M3 6h18v12H3zm1.6 1.5L12 12.8l7.4-5.3",
};

function SocialIcon({ network }: { network: SocialNetwork }) {
  return (
    <svg
      className="s-dsg-foot__icon"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill={network === "email" ? "none" : "currentColor"}
      stroke={network === "email" ? "currentColor" : "none"}
      strokeWidth="1.6"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={SOCIAL_PATHS[network]} />
    </svg>
  );
}

function Entry({ entry }: { entry: FooterEntry }) {
  if (entry.kind === "text") {
    return (
      <p className="s-dsg-foot__text" dir="auto">
        {entry.label}
      </p>
    );
  }
  const url = entry.target ?? "";
  const inner = (
    <>
      {entry.kind === "social" && entry.network && <SocialIcon network={entry.network} />}
      <span dir="auto">{entry.label}</span>
    </>
  );
  if (url.startsWith("/")) {
    return (
      <NavLink url={url} className="s-dsg-foot__link">
        {inner}
      </NavLink>
    );
  }
  return (
    <a className="s-dsg-foot__link" href={url} target="_blank" rel="noopener noreferrer">
      {inner}
    </a>
  );
}

export default function DesignFooter({
  footer,
  siteName,
  instanceFooter,
  authProtected,
  onSignIn,
}: {
  footer: FooterDesign;
  siteName: string;
  /** The instance's own resolved footer line (settings.footer / SITE_FOOTER),
   *  used when the design's copyright template is empty. */
  instanceFooter: string | null;
  authProtected: boolean;
  onSignIn: () => void;
}) {
  const copyright = footer.copyright
    ? renderCopyright(footer.copyright, siteName)
    : (instanceFooter ?? "");
  const columns = footer.columns.filter((c) => c.title !== "" || c.entries.length > 0);
  return (
    <footer className={`s-dsg-foot s-dsg-foot--${footer.align}`}>
      {columns.length > 0 && (
        <div className="s-dsg-foot__cols">
          {columns.map((col) => (
            <div className="s-dsg-foot__col" key={col.id}>
              {col.title && (
                <h2 className="s-dsg-foot__title" dir="auto">
                  {col.title}
                </h2>
              )}
              {col.entries.map((entry) => (
                <Entry key={entry.id} entry={entry} />
              ))}
            </div>
          ))}
        </div>
      )}
      {footer.showCopyright && copyright && (
        <p className="s-dsg-foot__line" dir="auto">
          {copyright}
        </p>
      )}
      <p className="s-dsg-foot__meta">
        {footer.showSearchHint && (
          <span className="s-dsg-foot__hint">
            <kbd>Ctrl K</kbd> {t("blogSearchHint")}
          </span>
        )}
        {footer.showRss && (
          <a className="s-dsg-foot__metalink" href="/feed.xml">
            RSS
          </a>
        )}
        {authProtected && (
          <button type="button" className="s-dsg-foot__metalink" onClick={onSignIn}>
            {t("signIn")}
          </button>
        )}
        {footer.showPoweredBy && (
          <span className="s-dsg-foot__powered">
            {t("blogPoweredBy")}{" "}
            <a href="https://github.com/ZahakJ/vellum" target="_blank" rel="noopener noreferrer">
              Vellum
            </a>
          </span>
        )}
      </p>
    </footer>
  );
}
