// WHAT A PREVIEW IS MADE OF — the one seam between "render this design" and
// "render this design against the live vault".
//
// THE PROBLEM, stated once. The section renderers in Sections.tsx are the REAL
// ones and must stay the real ones: a preview built from a second, simplified
// rendition of the same design is a preview of the rendition, and every
// difference between the two is a bug the operator finds after publishing.
// But two of those renderers reach outside the design for their content — a
// `note` section FETCHES a note, and `postGrid` asks the STORE whether missing
// banners should be generated — and a preset gallery must do neither: a
// shipped preset names no note (shared/presets.ts, rule 2), and a fresh
// install with no banners anywhere must still look like something.
//
// THE SEAM, therefore, is a CONTEXT rather than a fork. One provider, read by
// exactly the two components that would otherwise leave the design, and
// `null` — the default — means "behave exactly as the live site does". So the
// live site is not paying for the preview, the preview is not a second
// renderer, and a reviewer can find every place a preview differs from
// production by grepping for `usePreviewContent`.
//
// WHERE THE CONTENT COMES FROM, and this is the half that makes a fresh
// install compelling:
//
//   · THE OWNER'S OWN POSTS FIRST. Real titles, real dates, real banners, real
//     reading times, in real order. A preset previewed against six of your own
//     essays is a decision you can actually make; the same preset previewed
//     against "Lorem ipsum dolor" is a screenshot.
//   · GENERATED ARTWORK WHERE A BANNER IS MISSING. `generatedBannerCss()` is
//     already the product's answer to a banner-less post, it is already
//     deterministic per title, and it is already painted out of the ACTIVE
//     theme's own tokens — so a preview fills with pictures that belong to the
//     room rather than with grey rectangles, and it repaints when the theme
//     changes without anybody re-rendering anything.
//   · SAMPLE POSTS ONLY TO MAKE UP THE NUMBERS. An instance with two published
//     notes cannot show what a three-across grid does, so the shortfall is
//     padded with sample rows whose copy comes from the dictionary (en + ar,
//     like all chrome) and whose banners are generated. They are MARKED, and
//     the gallery says so once, quietly — an author who cannot tell which two
//     of the six posts are theirs has been lied to about their own site.

import { createContext, useContext, useMemo } from "react";
import type { PageMeta, PostMeta } from "../../shared/types.ts";
import { t } from "../i18n.ts";

/** The sample rows' path prefix. Chosen to be a path no vault can hold (a
 *  leading `__` folder is legal on disk but the indexer never surfaces one,
 *  and nothing in the preview navigates anyway) so a sample row can never be
 *  confused for a real note by anything reading `post.path`. */
export const SAMPLE_PREFIX = "__vellum-sample__/";

export function isSamplePost(post: PostMeta): boolean {
  return post.path.startsWith(SAMPLE_PREFIX);
}

export interface PreviewContent {
  /** What every list, grid and topics section reads. The instance's own posts
   *  first, in their own order, padded with samples only if there are not
   *  enough of them to fill a composed page. */
  posts: PostMeta[];
  /** Static pages, so a design's page routing resolves the same way it will
   *  on the live site. */
  pages: PageMeta[];
  /** Markdown a `note` section renders INSTEAD of fetching, by path. The
   *  designer's preview of the author's OWN design leaves this empty, so a
   *  note section previews the real note. */
  notes: Map<string, string>;
  /**
   * What a `note` section does when its path is not in `notes`.
   *   · `"fetch"`   — the live behaviour: GET the note, fail loudly if it is
   *                   gone. This is the designer previewing a real design.
   *   · `"sample"`  — render the sample prose and never touch the network.
   *                   This is the preset gallery, where fetching would be a
   *                   request per card for a note the preset never named.
   */
  noteMode: "fetch" | "sample";
  /** Paint a generated banner wherever a post has none, regardless of the
   *  instance's `bannerFallback` setting. On in every preview: an author who
   *  turned generated banners OFF for their live site still has to be able to
   *  see what a banner grid does before they choose one. */
  forceGeneratedBanners: boolean;
  /** True when any row in `posts` was invented. The gallery shows one quiet
   *  line when it is; nothing when it is not. */
  synthetic: boolean;
}

const Ctx = createContext<PreviewContent | null>(null);

/** Wrap a subtree so the real section renderers draw from `content` instead of
 *  from the live vault. Absent = the live site, unchanged. */
export const PreviewContentProvider = Ctx.Provider;

/** The active preview content, or null on the live site. The ONLY way a
 *  section renderer learns it is inside a preview. */
export function usePreviewContent(): PreviewContent | null {
  return useContext(Ctx);
}

/** What a `note` section should render, or null to fetch it for real. */
export function usePreviewNote(path: string): string | null {
  const content = useContext(Ctx);
  if (!content) return null;
  const stored = content.notes.get(path);
  if (stored !== undefined) return stored;
  return content.noteMode === "sample" ? t("pvNoteBody") : null;
}

// ── Sample rows ─────────────────────────────────────────────────────────────

/** Six titles, three bodies and four tags — enough to fill a three-across grid
 *  twice over without the same words appearing side by side. Dictionary keys,
 *  quoted literally so `check-i18n` can see them used. */
const SAMPLE_TITLES = ["pvTitle1", "pvTitle2", "pvTitle3", "pvTitle4", "pvTitle5", "pvTitle6"] as const;
const SAMPLE_BODIES = ["pvExcerpt1", "pvExcerpt2", "pvExcerpt3"] as const;
const SAMPLE_TAGS = ["pvTag1", "pvTag2", "pvTag3", "pvTag4"] as const;

/** One sample row. Deterministic in `index` — the same slot is the same post
 *  on every render, so hovering a card does not reshuffle its own preview, and
 *  the generated artwork (hashed from the title) is stable with it. */
function samplePost(index: number, epoch: number): PostMeta {
  const title = t(SAMPLE_TITLES[index % SAMPLE_TITLES.length]);
  const excerpt = t(SAMPLE_BODIES[index % SAMPLE_BODIES.length]);
  const words = 320 + ((index * 137) % 900);
  return {
    path: `${SAMPLE_PREFIX}${index + 1}.md`,
    title,
    // A week apart, walking backwards from the day the preview opened, so the
    // dates read as a plausible archive rather than as six copies of today.
    date: new Date(epoch - index * 7 * 86_400_000).toISOString(),
    excerpt,
    words,
    readingMinutes: Math.max(1, Math.ceil(words / 200)),
    tags: [
      t(SAMPLE_TAGS[index % SAMPLE_TAGS.length]),
      t(SAMPLE_TAGS[(index + 2) % SAMPLE_TAGS.length]),
    ],
  };
}

/** How many rows a composed page needs before every section kind has
 *  something to show. Eight fills a two-across grid of eight, a three-across
 *  grid of three with a river under it, and a list that looks like a list. */
export const PREVIEW_MIN_POSTS = 8;

export interface BuildPreviewOptions {
  /** The instance's real published posts, as `getPosts()` returned them. */
  posts: PostMeta[] | null;
  pages?: PageMeta[];
  /** `"fetch"` for the designer previewing a real design, `"sample"` for the
   *  preset gallery. */
  noteMode?: PreviewContent["noteMode"];
  /** Pre-rendered note bodies by path (the designer may pass what it already
   *  loaded; nothing does yet, and the field exists so it can). */
  notes?: Map<string, string>;
  minPosts?: number;
  /** Injectable so a screenshot gate can freeze the dates. */
  now?: number;
}

/**
 * Assemble the content a preview draws from.
 *
 * The padding rule is "top up", never "replace": real posts keep their real
 * order and their real position, and samples are appended after them. A
 * preview that put invented rows FIRST would show an author a front page whose
 * lead story is a fiction, which is the one thing a design preview may not do.
 */
export function buildPreviewContent(opts: BuildPreviewOptions): PreviewContent {
  const real = opts.posts ?? [];
  const want = opts.minPosts ?? PREVIEW_MIN_POSTS;
  const epoch = opts.now ?? Date.now();
  const padding: PostMeta[] = [];
  for (let i = real.length; i < want; i++) padding.push(samplePost(i, epoch));
  return {
    posts: [...real, ...padding],
    pages: opts.pages ?? [],
    notes: opts.notes ?? new Map(),
    noteMode: opts.noteMode ?? "fetch",
    forceGeneratedBanners: true,
    synthetic: padding.length > 0,
  };
}

/** The hook the designer and the gallery both use: memoized on the inputs, so
 *  a slider drag does not rebuild eight sample posts sixty times a second. */
export function usePreviewBuild(opts: BuildPreviewOptions): PreviewContent {
  const { posts, pages, noteMode, notes, minPosts } = opts;
  return useMemo(
    () => buildPreviewContent({ posts, pages, noteMode, notes, minPosts }),
    [posts, pages, noteMode, notes, minPosts],
  );
}
