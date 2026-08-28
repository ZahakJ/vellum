// The section renderers — the composed tree "designed" mode builds instead of
// the stock blog's fixed one.
//
// NOTHING HERE TOUCHES client/blog/. Not a component, not a class name, not a
// rule in blog.css. What it does reuse is the product's shared, pure
// machinery: the reading renderer (one sanitizer, one wikilink resolver, one
// callout vocabulary for the whole product), the banner helpers, the nav
// singleton and the date formatter. Reusing a pure function is not forking a
// component, and writing a second markdown renderer would be the actual
// architectural sin.
//
// Every class here is `s-dsn-*` and lives in client/styles/design.css, so a
// reviewer can confirm from the diff that stock rendering is untouched by
// looking at which files changed.

import { useEffect, useMemo, useRef, useState } from "react";
import type { PostMeta } from "../../shared/types.ts";
import type {
  CtaSection,
  DividerSection,
  HeroSection,
  NoteSection,
  PostGridSection,
  PostListSection,
  Section,
  TopicsSection,
} from "../../shared/design.ts";
import { getNote } from "../api.ts";
import { bannerSrc, generatedBannerCss } from "../banner.ts";
import { formatDate, NavLink } from "../blog/util.tsx";
import { siteDate } from "../dates.ts";
import { topicUrl } from "../blog/nav.ts";
import { countPhrase, localeNum, t, tf } from "../i18n.ts";
import { renderMarkdown } from "../reading/render.ts";
import { notePathToUrl } from "../router.ts";
import { useStore } from "../state.ts";
import { SectionError } from "./DesignBoundary.tsx";
// THE PREVIEW SEAM. Two renderers below reach outside the design for their
// content — `note` fetches a note, `postGrid` asks the store whether a missing
// banner should be generated — and a preview must be able to answer for both
// without a second copy of either component. `usePreviewContent()` is null on
// the live site, which is every path this file had before; see
// client/design/previewContent.tsx for why it is a context and not a fork.
import { usePreviewContent, usePreviewNote } from "./previewContent.tsx";

export interface SectionProps {
  posts: PostMeta[] | null;
  locale: string;
}

/** The localized name of a section KIND — what the failure notice and the
 *  designer both call it. */
export function sectionKindLabel(kind: string): string {
  switch (kind) {
    case "hero":
      return t("secHero");
    case "richText":
      return t("secRichText");
    case "note":
      return t("secNote");
    case "postGrid":
      return t("secPostGrid");
    case "postList":
      return t("secPostList");
    case "topics":
      return t("secTopics");
    case "cta":
      return t("secCta");
    case "divider":
      return t("secDivider");
    case "config":
      return t("secConfig");
    case "header":
      return t("designSecHeader");
    case "footer":
      return t("designSecFooter");
    default:
      return t("secPage");
  }
}

/** Posts matching a section's tag filter, newest first, capped. */
function pick(posts: PostMeta[] | null, tag: string, limit: number): PostMeta[] {
  const all = posts ?? [];
  const wanted = tag.trim().toLowerCase().replace(/^#/, "");
  const filtered =
    wanted === "" ? all : all.filter((p) => p.tags.some((x) => x.toLowerCase() === wanted));
  return filtered.slice(0, limit);
}

/** A section's optional heading. Chrome copy in the operator's own words, so
 *  it picks its own direction with <bdi> and keeps the row's alignment. */
function Heading({ text }: { text: string }) {
  if (text === "") return null;
  return (
    <h2 className="s-dsn-head">
      <bdi>{text}</bdi>
    </h2>
  );
}

// ── the arrangement fields, resolved ────────────────────────────────────────
//
// WHY EVERY ONE OF THESE HAS A DEFAULT RESTATED AT THE SEAM. A section reaches
// a renderer down two roads: through `validateSection`, which fills every key
// it did not find, and — for the preset gallery — through `presetDesignDoc`,
// which CLONES a preset's literal sections and hands them straight to a canvas.
// So an arrangement field added after the shelf was written arrives undefined
// on the second road, and `s-dsn-list--undefined` is a card that draws nothing.
// Fifty-nine mechanical edits is the alternative, and mechanical edits are
// where a typo hides — the same argument `presetDesignPart` makes for the
// article block.

function listLayout(section: PostListSection): PostListSection["layout"] {
  return section.layout ?? "river";
}

function cardShape(section: PostGridSection): PostGridSection["card"] {
  return section.card ?? "boxed";
}

function heroTreatment(section: HeroSection): HeroSection["treatment"] {
  return section.treatment ?? "panel";
}

// ── hero ────────────────────────────────────────────────────────────────────

function Hero({ section, posts }: { section: HeroSection } & SectionProps) {
  const siteName = useStore((s) => s.siteName);
  const tagline = useStore((s) => s.tagline);
  const heading = section.heading || siteName;
  const sub = section.sub || tagline || "";
  const treatment = heroTreatment(section);
  const words = (
    <div className="s-dsn-hero__inner">
      <h1 className="s-dsn-hero__title" dir="auto">
        {heading}
      </h1>
      {sub !== "" && (
        <p className="s-dsn-hero__sub" dir="auto">
          {sub}
        </p>
      )}
    </div>
  );
  const shell = `s-dsn-hero s-dsn-hero--${treatment} s-dsn-hero--${section.height} s-dsn-hero--${section.align}`;

  // SPLIT SETS THE WORDS BESIDE THE PICTURE, so the picture cannot be the
  // absolutely-positioned backdrop the other two use — it is a real cell of a
  // real two-column grid, and it stacks under 700px like everything else here.
  //
  // A COVER SHOWS THE COVER STORY. A preset may not name an image — a shipped
  // design cannot know what is in a stranger's vault — so the split's plate
  // opened on a generated gradient on every fresh install, which put a
  // placeholder in the one cell the whole treatment exists for. The newest
  // post's own banner is the picture this arrangement was always asking for:
  // it is the author's, it changes when they publish, and it is the same
  // photograph the first card underneath is carrying, which is what a cover
  // IS. An image the author DID name still wins, and where there is no
  // photograph anywhere the generated field comes back — half a split is a
  // hero with a hole in it.
  //
  // Only the split borrows. A panel and a band put their picture BEHIND the
  // words, and a real photograph under a headline is a contrast argument this
  // engine cannot win against a vault it has never seen; a picture BESIDE the
  // words carries no type at all.
  if (treatment === "split") {
    const borrowed = section.image ?? posts?.find((p) => p.banner)?.banner ?? null;
    return (
      <header className={shell}>
        {words}
        <div
          className="s-dsn-hero__plate"
          style={borrowed ? undefined : { background: generatedBannerCss(heading, "hero") }}
          aria-hidden="true"
        >
          {borrowed && <img className="s-dsn-hero__img" src={bannerSrc(borrowed)} alt="" />}
        </div>
      </header>
    );
  }

  // A BAND IS GROUND AND TYPE, and that is the whole point of it: the opening
  // for a site with no photograph, which today got a generated abstract it did
  // not ask for. So a band NEVER generates artwork — it paints `--bg-raised`
  // and sets the words large. An image the author did supply is still honoured
  // (throwing away authored content to make a point is not a treatment), it
  // simply is not invented.
  return (
    <header
      className={shell}
      style={
        section.image || treatment === "band"
          ? undefined
          : { background: generatedBannerCss(heading, "hero") }
      }
    >
      {section.image && (
        <img className="s-dsn-hero__img" src={bannerSrc(section.image)} alt="" aria-hidden="true" />
      )}
      {words}
    </header>
  );
}

// ── richText ────────────────────────────────────────────────────────────────

/** Markdown authored in the designer, rendered by the reading renderer — the
 *  same sanitizer, wikilinks, callouts and KaTeX the rest of the product uses.
 *  The rendered element is imperative DOM (that is what renderMarkdown
 *  returns), so it is adopted into a ref rather than dangerously set. */
function RichText({ section }: { section: Section & { markdown: string; align: string } }) {
  const host = useRef<HTMLDivElement | null>(null);
  const tree = useStore((s) => s.tree);
  const language = useStore((s) => s.language);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.textContent = "";
    if (section.markdown.trim() === "") return;
    el.appendChild(
      renderMarkdown(section.markdown, {
        notePath: "",
        tree,
        brokenLinks: "plain",
        missingImages: "card",
      }),
    );
  }, [section.markdown, tree, language]);
  return <div className={`s-dsn-rich s-dsn-rich--${section.align}`} ref={host} />;
}

// ── note ────────────────────────────────────────────────────────────────────

/**
 * A vault note rendered into the page.
 *
 * THE section that can go wrong through no fault of the config: the note it
 * names can be deleted, unpublished, or hidden by the language filter, all of
 * them long after the design was saved and none of them visible from the
 * design itself. It is therefore where the error boundary earns its keep.
 *
 * Two failure shapes, one outcome:
 *   · `note === ""` — the server BLANKED the path because this session may not
 *     read it (server/designRoutes.ts::visitorSafe). It never travelled, so no
 *     path is leaked, and the section refuses to render.
 *   · the fetch 404s — the note is gone, or gone from this session's view.
 * Both throw a SectionError, which the boundary turns into the stock blog for
 * a visitor and a named card for the owner. Throwing from an EFFECT would be
 * invisible to React, so the failure is stored and re-thrown during render.
 */
function NoteBlock({ section }: { section: NoteSection }) {
  const host = useRef<HTMLDivElement | null>(null);
  const tree = useStore((s) => s.tree);
  const language = useStore((s) => s.language);
  const [failure, setFailure] = useState<SectionError | null>(null);
  const [markdown, setMarkdown] = useState<string | null>(null);
  // Non-null inside a preview that supplies this note's prose (or that has
  // declared no note may be fetched at all). The live site always gets null,
  // and everything below is exactly what it was.
  const supplied = usePreviewNote(section.note);

  // The throw is at the BOTTOM of this component, never here. A `throw` between
  // two hook calls leaves React with a shorter hook list than the previous
  // render, and while React unwinds to the boundary before it can complain,
  // "it happens to work" is not a thing to build a rescue path on. Both fatal
  // conditions are computed here and raised once, after every hook has run.
  //
  // A preview that SUPPLIED the prose is never fatal: it did not fetch, so it
  // cannot have 404'd, and a blanked path inside a preview means "there is no
  // vault here to read from" rather than "this session may not read it".
  const fatal =
    supplied !== null
      ? null
      : section.note === ""
        ? new SectionError(
            `design section "${section.id}" names a note this session cannot read`,
            "dsnNoteUnavailable",
          )
        : failure;

  useEffect(() => {
    if (supplied !== null) {
      setMarkdown(supplied);
      return;
    }
    if (section.note === "") return;
    let disposed = false;
    setMarkdown(null);
    getNote(section.note)
      .then((data) => {
        if (disposed) return;
        setMarkdown(section.excerpt ? firstBlock(strip(data.content)) : strip(data.content));
      })
      .catch(() => {
        if (disposed) return;
        setFailure(
          new SectionError(
            `design section "${section.id}" points at a note that is not there: ${section.note}`,
            "dsnNoteMissing",
            section.note,
          ),
        );
      });
    return () => {
      disposed = true;
    };
  }, [section.note, section.excerpt, section.id, supplied]);

  useEffect(() => {
    const el = host.current;
    if (!el || markdown === null) return;
    el.textContent = "";
    el.appendChild(
      renderMarkdown(markdown, {
        notePath: section.note,
        tree,
        brokenLinks: "plain",
        missingImages: "card",
      }),
    );
  }, [markdown, section.note, tree, language]);

  if (fatal) throw fatal;

  return (
    <section className="s-dsn-note">
      <Heading text={section.heading} />
      <div className="s-dsn-rich" ref={host} />
      {section.excerpt && markdown !== null && (
        <NavLink url={notePathToUrl(section.note)} className="s-dsn-more">
          {t("dsnReadMore")}
        </NavLink>
      )}
    </section>
  );
}

/** Frontmatter off — the homepage shows prose, not YAML. */
function strip(content: string): string {
  if (!content.startsWith("---")) return content;
  const nl = content.startsWith("---\r\n") ? "\r\n" : "\n";
  const close = content.indexOf(`${nl}---`, 3 + nl.length);
  return close === -1 ? content : content.slice(close + nl.length + 3).replace(/^\r?\n/, "");
}

/** The first real paragraph — the excerpt mode. */
function firstBlock(md: string): string {
  for (const block of md.split(/\r?\n\s*\r?\n/)) {
    const trimmed = block.trim();
    if (trimmed !== "" && !trimmed.startsWith("#")) return trimmed;
  }
  return md.trim().slice(0, 400);
}

// ── postGrid / postList ─────────────────────────────────────────────────────

/** The line under a title: the date and the reading time, or nothing.
 *
 *  THERE WAS A THIRD MODE AND IT WAS THE WRONG ANSWER. A dateline row used to
 *  print the reading time alone, on the argument that the kicker above had
 *  already taken the date. What that drew was twenty-eight headlines each
 *  followed by "1 min read" — a figure nobody asked a newspaper for, repeated
 *  down the whole file, under a kicker that is the only meta a dateline wants.
 *  A dateline row is a HEADLINE. The day is printed above it; there is nothing
 *  else to say on the line. */
function PostMeta_({
  post,
  locale,
  show,
}: {
  post: PostMeta;
  locale: string;
  show: "none" | "full";
}) {
  if (show === "none") return null;
  // EACH ITEM IS AN ISOLATE, the same rule the topic chip follows. The ORDER
  // of the two follows the card, which now resolves its direction from the
  // title — so an Arabic entry prints its date at the reading start like
  // everything else on the card. What must NOT follow the card is what is
  // INSIDE them: "1 min read" is the interface's own phrase, and dropped
  // unisolated into an Arabic paragraph the bidi algorithm reorders it to
  // "min read 1". `<bdi>` resolves each one on its own contents and leaves the
  // line's direction to the line.
  return (
    <p className="s-dsn-meta">
      <bdi>{formatDate(post.date, locale)}</bdi>
      <span className="s-dsn-meta__sep" aria-hidden="true" />
      <bdi>{countPhrase(post.readingMinutes, "readMinutes")}</bdi>
    </p>
  );
}

/** THE STAMP a ledger hangs in its start column and an index sets after its
 *  leader. `formatDate()` asks for the "long" style, which is the right answer
 *  for a byline and the wrong one for a fixed 9em gutter — "12 February 2026"
 *  wraps to two lines in half the locales this ships in, and a date column
 *  that wraps is not a column. It goes through `siteDate()` like every other
 *  date in the product rather than reaching for `Intl` here, so a Hijri
 *  instance stamps Hijri and the numerals stay the instance's own. */
function stamp(iso: string, locale: string): string {
  return siteDate(iso, locale, { dateStyle: "medium", timeZone: "UTC" });
}

function PostGrid({ section, posts, locale }: { section: PostGridSection } & SectionProps) {
  const stored = useStore((s) => s.bannerFallback);
  // A PREVIEW ALWAYS GENERATES. An author who turned generated banners off for
  // their live site still has to see what a banner grid does before choosing
  // one, and a fresh install with no banners anywhere would otherwise judge
  // every image-forward preset by a column of empty rectangles.
  const preview = usePreviewContent();
  const bannerFallback = preview?.forceGeneratedBanners ? "generated" : stored;
  const chosen = pick(posts, section.tag, section.limit);
  const card = cardShape(section);
  return (
    <section className="s-dsn-block">
      <Heading text={section.heading} />
      {chosen.length === 0 ? (
        <p className="s-dsn-empty">{t("dsnNoPosts")}</p>
      ) : (
        <div
          className={`s-dsn-grid s-dsn-grid--${card}`}
          style={{ "--dsn-cols": section.columns } as React.CSSProperties}
        >
          {chosen.map((post) => {
            // A PLATE BOOK DOES NOT FAKE A PHOTOGRAPH, AND NEITHER DOES A WALL
            // LABEL. `masonry` and `overlay` are the two shapes whose whole
            // subject is the picture — a plate at full width, a title on a
            // scrim — and both used to insist on artwork, inventing a gradient
            // wherever a post had none. That is the right trade for a 128px
            // strip above a title and the wrong one here: five synthetic
            // fields printed at plate size among nineteen real photographs is
            // the first thing a reader's eye lands on in a monograph, and two
            // saturated tiles in a hang of eight is a gallery showing work it
            // does not have.
            //
            // So these two shapes take NO artwork rather than invented
            // artwork, and what they draw instead is a LEAF OF TYPE — the
            // title set at size on the page (see `.s-dsn-card--plateless`),
            // which is what a plate book prints where there is no plate and
            // what a wall carries where there is no picture. The three other
            // shapes still obey the operator's toggle exactly.
            //
            // THE GALLERY CANVAS STILL GENERATES, and that is the one place it
            // must: a preset card is 200px of an unknown vault, and judging an
            // image-forward design by a column of type is judging the wrong
            // thing. `forceGeneratedBanners` is the preview's own flag.
            const plate = card === "masonry" || card === "overlay";
            const wantsArt = plate
              ? !!post.banner || preview?.forceGeneratedBanners === true
              : section.showBanner && (post.banner || bannerFallback === "generated");
            // MASONRY ASKS THE PICTURE HOW TALL IT IS, which a background-image
            // cannot answer. A real <img> ragged-bottoms the columns the way a
            // plate book does; generated artwork has no natural proportion, so
            // it keeps a stated one and stays a span.
            const photo = card === "masonry" && post.banner ? post.banner : null;
            return (
              <NavLink
                key={post.path}
                url={notePathToUrl(post.path)}
                className={`s-dsn-card s-dsn-card--${card}${wantsArt ? "" : " s-dsn-card--plateless"}`}
              >
                {wantsArt &&
                  (photo ? (
                    <img
                      className="s-dsn-card__photo"
                      src={bannerSrc(photo)}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                    />
                  ) : (
                    <span
                      className="s-dsn-card__banner"
                      style={
                        post.banner
                          ? { backgroundImage: `url(${JSON.stringify(bannerSrc(post.banner))})` }
                          : { background: generatedBannerCss(post.title, "thumb") }
                      }
                      aria-hidden="true"
                    />
                  ))}
                {/* THE DIRECTION IS RESOLVED ONCE, FOR THE WHOLE BODY. Per
                    child it drew a zigzag: an Arabic card set its title flush
                    to the card's end and its date flush to the card's start,
                    which on a wall of twelve mixed-script titles alternates
                    down the page and reads as a broken grid. */}
                <span className="s-dsn-card__body" dir="auto">
                  <span className="s-dsn-card__title">{post.title}</span>
                  <PostMeta_ post={post} locale={locale} show={section.showDate ? "full" : "none"} />
                  {/* An overlay's words sit in a band of scrim at the foot of a
                      picture; an excerpt there is four lines of body copy over
                      a photograph, which is the arrangement that makes the
                      title unfindable. The title and the date are the card. */}
                  {section.showExcerpt && card !== "overlay" && post.excerpt !== "" && (
                    <span className="s-dsn-card__excerpt" dir="auto">
                      {post.excerpt}
                    </span>
                  )}
                </span>
              </NavLink>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** One entry of a river, a numbered run or a dateline group — the three
 *  layouts that keep the river's anatomy (title, meta, excerpt) and differ in
 *  what is set beside it. `ordinal` is null unless the run is counting. */
function ListRow({
  post,
  locale,
  ordinal,
  meta,
  excerpt,
}: {
  post: PostMeta;
  locale: string;
  ordinal: number | null;
  meta: "none" | "full";
  excerpt: boolean;
}) {
  return (
    <li className="s-dsn-list__item">
      {ordinal !== null && (
        // Through localeNum, never a bare {ordinal}: numerals are ONE system
        // per instance and the date on the line below is already keeping to
        // it. aria-hidden because the <ol> already tells a screen reader this
        // is the nth of n — the numeral here is the typography of that fact.
        <span className="s-dsn-list__ord" aria-hidden="true">
          {localeNum(ordinal)}
        </span>
      )}
      {/* A div, not a span: the excerpt below is a <p>, and phrasing content
          is the only thing a <span> may carry.

          `dir="auto"` SITS ON THE BLOCK AND NOT ON THE TITLE, which is one
          attribute fixing a zigzag. With the direction resolved per child, an
          Arabic entry set its title flush to the row's end and its date flush
          to the row's start — two halves of one entry at opposite edges,
          alternating down a mixed-script run. Resolved once, on the block, the
          whole entry takes the direction of the words in it. */}
      <div className="s-dsn-list__main" dir="auto">
        <NavLink url={notePathToUrl(post.path)} className="s-dsn-list__link">
          <span className="s-dsn-list__title" dir="auto">
            {post.title}
          </span>
        </NavLink>
        <PostMeta_ post={post} locale={locale} show={meta} />
        {excerpt && post.excerpt !== "" && (
          <p className="s-dsn-list__excerpt" dir="auto">
            {post.excerpt}
          </p>
        )}
      </div>
    </li>
  );
}

/** A ledger row: the date hangs in a column of its own at the start and the
 *  title takes one line, however long it is. The whole row is the target —
 *  a dense run of 40px rows with a 6-word hit area is a phone site nobody can
 *  use, and the row is already a single semantic unit. */
function LedgerRow({
  post,
  locale,
  showDate,
  showExcerpt,
}: {
  post: PostMeta;
  locale: string;
  showDate: boolean;
  showExcerpt: boolean;
}) {
  return (
    <li className="s-dsn-list__item">
      <NavLink url={notePathToUrl(post.path)} className="s-dsn-list__row">
        {showDate && <span className="s-dsn-list__stamp">{stamp(post.date, locale)}</span>}
        <span className="s-dsn-list__title" dir="auto">
          {post.title}
        </span>
        {showExcerpt && post.excerpt !== "" && (
          <span className="s-dsn-list__excerpt" dir="auto">
            {post.excerpt}
          </span>
        )}
      </NavLink>
    </li>
  );
}

/** An index row: title, a leader of dots, the date. No excerpt — an index that
 *  summarises is a river with dots in it, and the leader only reads as a
 *  leader when there is exactly one line for it to cross. */
function IndexRow({
  post,
  locale,
  showDate,
}: {
  post: PostMeta;
  locale: string;
  showDate: boolean;
}) {
  return (
    <li className="s-dsn-list__item">
      <NavLink url={notePathToUrl(post.path)} className="s-dsn-list__toc">
        <span className="s-dsn-list__title" dir="auto">
          {post.title}
        </span>
        <span className="s-dsn-list__leader" aria-hidden="true" />
        {showDate && <span className="s-dsn-list__stamp">{stamp(post.date, locale)}</span>}
      </NavLink>
    </li>
  );
}

function PostListBlock({ section, posts, locale }: { section: PostListSection } & SectionProps) {
  const chosen = pick(posts, section.tag, section.limit);
  const layout = listLayout(section);
  // A DATELINE GROUPS BY THE DAY IT PRINTS, not by the day it parses: the key
  // is the formatted string, so the run breaks where the reader sees it break
  // — in this instance's own calendar, Hijri included, and never on a UTC
  // boundary the page does not show. Order is the feed's, so the groups come
  // out newest-first with the posts inside them in the order they arrived.
  const days = useMemo(() => {
    if (layout !== "dateline") return [];
    const out: { day: string; posts: PostMeta[] }[] = [];
    for (const post of chosen) {
      const day = formatDate(post.date, locale);
      const last = out[out.length - 1];
      if (last && last.day === day) last.posts.push(post);
      else out.push({ day, posts: [post] });
    }
    return out;
  }, [chosen, layout, locale]);

  const body = () => {
    if (layout === "dateline") {
      return (
        <ol className="s-dsn-list s-dsn-list--dateline">
          {days.map((group) => (
            <li key={group.day} className="s-dsn-list__group">
              {/* The kicker carries the date for every post under it, and it
                  carries the whole meta line with it: the rows under a
                  dateline print a HEADLINE and nothing else. That repetition
                  is exactly what a paper's dateline exists to delete, and a
                  reading time under every headline is the web furniture
                  version of the same repetition. */}
              {section.showDate && (
                <p className="s-dsn-list__kicker" dir="auto">
                  {group.day}
                </p>
              )}
              <ol className="s-dsn-list__run">
                {group.posts.map((post) => (
                  <ListRow
                    key={post.path}
                    post={post}
                    locale={locale}
                    ordinal={null}
                    meta="none"
                    excerpt={section.showExcerpt}
                  />
                ))}
              </ol>
            </li>
          ))}
        </ol>
      );
    }
    return (
      <ol className={`s-dsn-list s-dsn-list--${layout}`}>
        {chosen.map((post, i) => {
          if (layout === "ledger") {
            return (
              <LedgerRow
                key={post.path}
                post={post}
                locale={locale}
                showDate={section.showDate}
                showExcerpt={section.showExcerpt}
              />
            );
          }
          if (layout === "index") {
            return (
              <IndexRow key={post.path} post={post} locale={locale} showDate={section.showDate} />
            );
          }
          return (
            <ListRow
              key={post.path}
              post={post}
              locale={locale}
              ordinal={layout === "numbered" ? i + 1 : null}
              meta={section.showDate ? "full" : "none"}
              excerpt={section.showExcerpt}
            />
          );
        })}
      </ol>
    );
  };

  return (
    <section className="s-dsn-block">
      <Heading text={section.heading} />
      {chosen.length === 0 ? <p className="s-dsn-empty">{t("dsnNoPosts")}</p> : body()}
    </section>
  );
}

// ── topics ──────────────────────────────────────────────────────────────────

function Topics({ section, posts }: { section: TopicsSection } & SectionProps) {
  const chips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of posts ?? []) {
      for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, section.limit);
  }, [posts, section.limit]);
  if (chips.length === 0) return null;
  return (
    <section className="s-dsn-block">
      <Heading text={section.heading} />
      <div className="s-dsn-topics">
        {chips.map(([tag, count]) => (
          <NavLink key={tag} url={topicUrl(tag)} className="s-dsn-topic">
            {/* The chip IS its content, so the isolate goes on the chip — the
                same rule the editor's #tag pills follow. */}
            <bdi>#{tag}</bdi>
            {/* Through localeNum, never a bare {count}: numerals are ONE system
                per instance, chosen by the date locale, and the date beside
                this chip on every card is already Arabic-Indic. */}
            <span className="s-dsn-topic__count">{localeNum(count)}</span>
          </NavLink>
        ))}
      </div>
    </section>
  );
}

// ── cta ─────────────────────────────────────────────────────────────────────

function Cta({ section }: { section: CtaSection }) {
  const external = /^https:\/\//i.test(section.url);
  const label = section.label || t("dsnReadMore");
  return (
    <section className="s-dsn-cta">
      {section.heading !== "" && (
        <p className="s-dsn-cta__head" dir="auto">
          {section.heading}
        </p>
      )}
      {section.body !== "" && (
        <p className="s-dsn-cta__body" dir="auto">
          {section.body}
        </p>
      )}
      {external ? (
        <a className="s-dsn-cta__btn" href={section.url} target="_blank" rel="noopener noreferrer">
          <bdi>{label}</bdi>
        </a>
      ) : (
        <NavLink url={section.url} className="s-dsn-cta__btn">
          <bdi>{label}</bdi>
        </NavLink>
      )}
    </section>
  );
}

// ── divider ─────────────────────────────────────────────────────────────────

function Divider({ section }: { section: DividerSection }) {
  return (
    <div
      className={`s-dsn-div s-dsn-div--${section.style}`}
      style={{ "--dsn-space": `${section.space}px` } as React.CSSProperties}
      aria-hidden="true"
    />
  );
}

// ── the switch ──────────────────────────────────────────────────────────────

/** Render one section. An unknown kind THROWS rather than rendering nothing:
 *  a section silently missing from a public homepage is exactly the invisible
 *  failure the boundary exists to make loud. (Validation makes this
 *  unreachable through the API — it is reachable through a hand-edited
 *  designs.json, which is a supported way to break this file.) */
export function RenderSection({
  section,
  posts,
  locale,
}: { section: Section } & SectionProps): JSX.Element {
  switch (section.kind) {
    case "hero":
      return <Hero section={section} posts={posts} locale={locale} />;
    case "richText":
      return <RichText section={section} />;
    case "note":
      return <NoteBlock section={section} />;
    case "postGrid":
      return <PostGrid section={section} posts={posts} locale={locale} />;
    case "postList":
      return <PostListBlock section={section} posts={posts} locale={locale} />;
    case "topics":
      return <Topics section={section} posts={posts} locale={locale} />;
    case "cta":
      return <Cta section={section} />;
    case "divider":
      return <Divider section={section} />;
    default:
      throw new SectionError(
        `design section has an unknown kind: ${String((section as { kind?: unknown }).kind)}`,
        "dsnUnknownKind",
        tf("dsnUnknownKindDetail", { kind: String((section as { kind?: unknown }).kind) }),
      );
  }
}
