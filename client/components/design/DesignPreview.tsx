// THE LIVE PREVIEW — the designed chrome, drawn from the DRAFT config, next
// to the controls that change it.
//
// It renders the REAL components (DesignHeader, DesignNav, DesignFooter) with
// the REAL derived tokens (typographyVars), inside the REAL `.s-dsg` scope. A
// preview built out of a second, simplified rendition of the same design is a
// preview of the rendition, and every difference between the two is a bug the
// operator finds after publishing.
//
// What it deliberately does NOT do is route. The site owns the address bar in
// designed mode; a preview inside the app shell must not. So clicks are
// swallowed at the container, no nav handler is registered, and the body is a
// SPECIMEN — a heading ladder and a paragraph of the site's own prose — which
// is also the honest thing to show a typography control: the sizes, the
// measure, the rhythm and the case, all at once, without waiting on a fetch.

import type { CSSProperties, MouseEvent } from "react";
import type { DesignChrome } from "../../../shared/designChrome.ts";
import { typographyVars } from "../../../shared/designChrome.ts";
import { t } from "../../i18n.ts";
import { useStore } from "../../state.ts";
import DesignFooter from "../../design/DesignFooter.tsx";
import DesignHeader from "../../design/DesignHeader.tsx";
import "../../styles/design.css";

export default function DesignPreview({ chrome }: { chrome: DesignChrome }) {
  const siteName = useStore((s) => s.siteName);
  const tagline = useStore((s) => s.tagline);
  const footerLine = useStore((s) => s.footerLine);
  const logo = useStore((s) => s.logo);

  // Every link in here points at the real site; inside the panel it must go
  // nowhere. One capture-phase swallow at the container covers the header,
  // the whole menu (including submenus) and the footer at once.
  const swallow = (e: MouseEvent): void => {
    const target = e.target as HTMLElement;
    if (target.closest("a")) e.preventDefault();
  };

  return (
    <div
      className="s-dsgr-preview"
      onClickCapture={swallow}
      style={typographyVars(chrome.typography) as CSSProperties}
    >
      <div className="s-dsg s-dsgr-preview__site">
        <DesignHeader
          header={chrome.header}
          items={chrome.nav.items}
          topics={[t("designSampleTopic")]}
          pathname="/"
          siteName={siteName}
          tagline={tagline}
          logo={logo}
          // Inert stand-ins for the three instance tools: a preview that
          // dropped them would leave their switches with no visible effect,
          // and a live search box inside the panel would open the site's own
          // overlay over the designer.
          tools={
            <>
              {chrome.nav.showSearch && (
                <span className="s-blog-iconbtn" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.6-3.6" />
                  </svg>
                </span>
              )}
              {chrome.nav.showLangSwitch && (
                <span className="s-blog-iconbtn" aria-hidden="true">
                  ع
                </span>
              )}
              {chrome.nav.showThemeToggle && (
                <span className="s-blog-iconbtn" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
                  </svg>
                </span>
              )}
            </>
          }
          menuOpen={false}
          onToggleMenu={() => undefined}
        />

        <main className="s-blog-main">
          <article className="s-blog-page">
            <h1 className="s-dsg-page__title" dir="auto">
              {t("designSpecimenTitle")}
            </h1>
            <div className="s-rv s-reading__content">
              <p className="s-rv-p" dir="auto">
                {t("designSpecimenLead")}
              </p>
              <h2 className="s-rv-h s-rv-h2" dir="auto">
                {t("designSpecimenH2")}
              </h2>
              <p className="s-rv-p" dir="auto">
                {t("designSpecimenBody")}
              </p>
              <h3 className="s-rv-h s-rv-h3" dir="auto">
                {t("designSpecimenH3")}
              </h3>
              <p className="s-rv-p" dir="auto">
                {t("designSpecimenBody")}
              </p>
            </div>
          </article>
        </main>

        <DesignFooter
          footer={chrome.footer}
          siteName={siteName}
          instanceFooter={footerLine}
          authProtected={false}
          onSignIn={() => undefined}
        />
      </div>
    </div>
  );
}
