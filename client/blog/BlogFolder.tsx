// A PUBLIC FOLDER page — `/folder/<slug>`, the owner's own collection.
//
// The sibling of BlogTopic.tsx, and the differences are the whole feature. A
// topic page is DISCOVERED: its heading is a tag, its slug is that tag, and an
// unknown one still renders an honest empty list because some note may carry
// it tomorrow. A folder page is DECLARED: it exists because settings.json says
// so, it has a title, a glyph and a description the owner wrote, and a slug
// nobody declared is not an empty collection — it is a URL this site does not
// serve, so it gets the missing page the shell gives every other dead link.
//
// The posts are filtered client-side over the list the shell already holds,
// exactly as the topic page filters by tag: the folder membership rides on
// PostMeta.folders, so this page costs no request of its own.

import { useMemo } from "react";
import type { PostMeta } from "../../shared/types.ts";
import FolderGlyph from "../components/FolderGlyph.tsx";
import { countPhrase, t } from "../i18n.ts";
import { useStore } from "../state.ts";
import { NavLink } from "./util.tsx";
import PostList from "./PostList.tsx";

export default function BlogFolder({
  slug,
  posts,
  locale,
}: {
  slug: string;
  posts: PostMeta[] | null;
  locale: string;
}) {
  useStore((s) => s.language); // re-render chrome strings on a live language switch
  const folders = useStore((s) => s.publicFolders);
  const folder = folders.find((f) => f.slug === slug) ?? null;

  const filtered = useMemo(
    () => (posts ?? []).filter((p) => p.folders?.includes(slug)),
    [posts, slug],
  );

  // NO SUCH FOLDER. Deliberately the shell's own missing page rather than an
  // empty list: a hidden folder, a deleted one and a mistyped URL are the same
  // event to a reader, and inventing a heading out of the slug would tell them
  // this collection exists and happens to be empty.
  if (folder === null) {
    return (
      <div className="s-blog-page s-blog-locked">
        <div className="s-blog-locked__glyph" aria-hidden="true">
          ✦
        </div>
        <p className="s-blog-locked__title">{t("blogNoPage")}</p>
        <NavLink url="/" className="s-blog-locked__home">
          <span className="s-blog-backarrow" aria-hidden="true">
            ←
          </span>
          {t("blogBackToWritings")}
        </NavLink>
      </div>
    );
  }

  return (
    <div className="s-blog-page">
      <header className="s-blog-folderhead">
        {/* The glyph is DECORATION beside a title that is always present, so it
            carries no name of its own (map-vault §5). */}
        <span className="s-blog-folderhead__glyph">
          <FolderGlyph icon={folder.icon} size={32} />
        </span>
        <div className="s-blog-folderhead__text">
          {/* h1 — the page's own title, like the topic page's. */}
          <h1 className="s-blog-folderhead__title" dir="auto">
            {folder.title}
          </h1>
          {folder.description && (
            <p className="s-blog-folderhead__desc" dir="auto">
              {folder.description}
            </p>
          )}
          {/* The count comes from the list ON THIS PAGE, not from the card's
              server-side number: the two agree, and when they ever do not, the
              honest one is the one the reader can count. */}
          <p className="s-blog-folderhead__count">
            {countPhrase(filtered.length, "publishedNotes")}
          </p>
        </div>
      </header>
      {posts === null ? (
        <p className="s-blog-empty">…</p>
      ) : filtered.length === 0 ? (
        // An empty DECLARED folder is not an error and not a filtered list —
        // the owner made the room and has not moved anything into it yet.
        <p className="s-blog-empty">{t("blogFolderEmpty")}</p>
      ) : (
        <PostList posts={filtered} locale={locale} />
      )}
    </div>
  );
}
