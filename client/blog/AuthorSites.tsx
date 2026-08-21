// "More from the author" — the authorSites setting rendered as cards, each
// wearing its site's own og:image and description (enriched server-side, see
// server/authorSites.ts). One component because the blog has TWO homes — the
// stock writings page and the dashboard — and the author's other homes belong
// under both.

import { t } from "../i18n.ts";
import { useStore } from "../state.ts";

export default function AuthorSites() {
  const sites = useStore((s) => s.authorSites);
  useStore((s) => s.language); // live language switch re-renders the heading
  if (sites.length === 0) return null;
  return (
    <section className="s-blog-sites" aria-label={t("blogAuthorSites")}>
      <h2 className="s-blog-heading s-blog-heading--sites">
        <span>{t("blogAuthorSites")}</span>
      </h2>
      <div className="s-blog-sites__grid">
        {sites.map((site) => (
          <a
            key={site.url}
            className="s-blog-sites__card"
            href={site.url}
            target="_blank"
            rel="noopener"
          >
            {site.image && (
              <span className="s-blog-sites__cover">
                {/* The site's own og:image, hotlinked. A broken cover marks
                    the CARD bare — the stylesheet then reflows the text onto
                    the raised panel instead of leaving a floating scrim. */}
                <img
                  src={site.image}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.closest(".s-blog-sites__card")?.classList.add("s-blog-sites__card--bare");
                  }}
                />
              </span>
            )}
            <span className="s-blog-sites__body">
              <span className="s-blog-sites__title">{site.title}</span>
              {site.description && (
                <span className="s-blog-sites__desc">{site.description}</span>
              )}
              <span className="s-blog-sites__domain" dir="ltr">
                {site.domain} ↗
              </span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}
