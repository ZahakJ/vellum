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
import { BlogSkeleton, NavLink } from "./util.tsx";
import PostList, { TagChips } from "./PostList.tsx";

/** How many topics the empty state offers. Six is a row of doors; twenty is a
 *  second navigation, and this page is not the place for one. */
const EMPTY_TOPICS_MAX = 6;

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

  // The doors for an empty room (F29): the site's busiest topics, by the same
  // frequency order the nav row uses, so the chips a reader meets here are the
  // ones they already met at the top of the page.
  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of posts ?? []) {
      for (const tag of p.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, EMPTY_TOPICS_MAX)
      .map(([tag]) => tag);
  }, [posts]);

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
        // The same skeleton the two homes draw, for the same reason (F41): a
        // list still arriving and a list with nothing in it were both a "…".
        <BlogSkeleton rows={3} />
      ) : filtered.length === 0 ? (
        // An empty DECLARED folder is not an error and not a filtered list —
        // the owner made the room and has not moved anything into it yet.
        //
        // BUT AN EMPTY ROOM NEEDS A DOOR (v1.8 UX audit F29). This page is
        // reachable from the home band, from an article's folder chip and from
        // a bare URL, and it used to answer all three with one italic sentence
        // and no way onward but the browser's Back button. So the sentence
        // keeps its honesty and gains the two exits a reader actually wants:
        // the whole list, and the topics the site is really about.
        <div className="s-blog-empty">
          <p>{t("blogFolderEmpty")}</p>
          <div className="s-blog-empty__doors">
            <NavLink url="/" className="s-blog-empty__door">
              {t("blogBrowseAll")}
              {/* The arrow points the way the reader reads (blog.css mirrors
                  it under RTL, like every other directional glyph here). */}
              <span className="s-blog-fwdarrow" aria-hidden="true">
                →
              </span>
            </NavLink>
            {topics.length > 0 && (
              <div className="s-blog-empty__topics">
                <span className="s-blog-empty__topicslabel">{t("blogTopics")}</span>
                <TagChips tags={topics} />
              </div>
            )}
          </div>
        </div>
      ) : (
        <PostList posts={filtered} locale={locale} />
      )}
    </div>
  );
}
