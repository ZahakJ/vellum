// The PUBLIC FOLDERS band — the owner's own collections on the blog home.
//
// One component because the blog has TWO homes (the writings page and the
// dashboard) and a collection belongs under both, exactly as AuthorSites does.
// It sits BESIDE that band and deliberately does not look like it: the author's
// other sites are cover-forward tiles, because a site is a picture; a folder is
// a DOOR, and a door is a label, a mark and a count. So this band is drawn in
// theme colors on the raised panel with no scrim, no cover art and no literal
// colours anywhere in its stylesheet.
//
// Empty folders still render. A collection the owner declared and has not
// filled is an invitation, and a card that vanishes at zero is a navigation
// that changes shape as posts come and go. HIDDEN folders never render — the
// server does not send them at all.

import FolderGlyph from "../components/FolderGlyph.tsx";
import { countPhrase, t } from "../i18n.ts";
import { useStore } from "../state.ts";
import { folderUrl } from "./nav.ts";
import { NavLink } from "./util.tsx";

export default function PublicFolders() {
  const folders = useStore((s) => s.publicFolders);
  const onHome = useStore((s) => s.publicFoldersHome);
  useStore((s) => s.language); // live language switch re-renders the heading
  if (!onHome || folders.length === 0) return null;
  return (
    <section className="s-blog-folders" aria-label={t("blogFolders")}>
      <h2 className="s-blog-heading s-blog-heading--folders">
        <span>{t("blogFolders")}</span>
      </h2>
      <div className="s-blog-folders__grid">
        {folders.map((folder) => (
          <NavLink key={folder.id} url={folderUrl(folder.slug)} className="s-blog-folders__card">
            {/* Decoration beside a title that is always there. */}
            <span className="s-blog-folders__glyph" aria-hidden="true">
              <FolderGlyph icon={folder.icon} size={28} />
            </span>
            <span className="s-blog-folders__body">
              <span className="s-blog-folders__title" dir="auto">
                {folder.title}
              </span>
              {folder.description && (
                <span className="s-blog-folders__desc" dir="auto">
                  {folder.description}
                </span>
              )}
              {/* countPhrase carries localeNum, so the number matches the
                  numerals every date on the same page is printed in. */}
              <span className="s-blog-folders__count">
                {countPhrase(folder.count, "publishedNotes")}
              </span>
            </span>
          </NavLink>
        ))}
      </div>
    </section>
  );
}
