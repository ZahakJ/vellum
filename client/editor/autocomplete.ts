// Wikilink autocomplete: typing "[[" offers every note title in the vault,
// read live from the zustand store's tree, plus every frontmatter ALIAS those
// notes declare; typing "#" inside the brackets offers the headings of the
// target note ([[Note#…]] / [[#…]] for the current note). Typing "#" in
// PROSE offers the vault's existing tags (tagSource below).
//
// The note-title list is RANKED, not tree-ordered. Priority is lexicographic:
// how well the typed text matches the title (exact > prefix > substring >
// subsequence), then frecency (client/recents.ts — the same ledger the
// palette's empty state reads), then whether the open note already links the
// candidate. Match quality outranks frecency on purpose: typing a note's
// exact name must surface that note even if you live in a different one.

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { SyntaxNode } from "@lezer/common";
import { createNote, getNote, getTags } from "../api.ts";
import type { TagCount } from "../../shared/types.ts";
import { Lru } from "../lru.ts";
import { useStore } from "../state.ts";
import { installRecents, recentScores } from "../recents.ts";

// The SECOND installer, and why there are two: the palette owns the recents
// feature and installs the ledger when its chunk loads — but App mounts the
// palette only while it is OPEN, so in a session where Ctrl+P comes late,
// every visit before it would go unrecorded and the evening's trail would be
// missing exactly the notes it was for. This module loads with the editor —
// i.e. the moment an admin opens their first note — so the trail starts when
// the visiting starts. installRecents is idempotent; whichever chunk arrives
// first wins and the other call is a no-op.
installRecents(useStore);
import { toast } from "../toast.ts";
import { applyDefaultTemplate } from "../templateActions.ts";
import { isLabelled, label as tagDisplayLabel } from "../tagLabels.ts";
import {
  aliasCompletions,
  collectNotes,
  parseWikilink,
  resolveLink,
  WIKILINK_RE,
} from "./links.ts";
import { noteAnchors } from "../../shared/anchors.ts";
import { foldTerm } from "../../shared/fold.ts";
import { isNotePath, stripNoteExt } from "../../shared/noteFormat.ts";
import { notePathFacet } from "./livePreview.ts";
import { t, tf } from "../i18n.ts";
import {
  calloutIconRender,
  calloutTypeSource,
  fenceLanguageSource,
  slashSource,
} from "./slashMenu.ts";

/** Insert `label`, then "]]" unless the brackets are already closed. */
function applyInner(
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
): void {
  const alreadyClosed = view.state.sliceDoc(to, to + 2) === "]]";
  const insert = completion.label + (alreadyClosed ? "" : "]]");
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + completion.label.length + 2 },
    userEvent: "input.complete",
  });
}

// Tiny read-through cache so heading completion doesn't refetch the target
// note on every keystroke. Bounded (client/lru.ts) as well as expiring: the
// 5-second window makes the text fresh, it never made the Map small, and this
// one is keyed by whatever the author types inside `[[…#`, so its ceiling was
// the vault.
const noteCache = new Lru<string>({ max: 16, ttlMs: 5000 });

async function noteContent(path: string): Promise<string | null> {
  const cached = noteCache.get(path);
  if (cached !== undefined) return cached;
  try {
    const note = await getNote(path);
    noteCache.set(path, note.content);
    return note.content;
  } catch {
    return null;
  }
}

/** ANCHORS of the wikilink's target note, offered after "#" inside [[ ]].
 *
 *  Anchors, not headings: a markdown heading and a LaTeX `\label` are the same
 *  kind of thing, so `[[Heat Equation#` completes `eq:fourier` and `fig:bar`
 *  exactly as `[[Notes#` completes `Derivation`. Without this the `#` half of
 *  autocomplete was silently markdown-only, and the one link form the whole
 *  cross-format design turns on was the one you could not complete. */
async function headingOptions(
  context: CompletionContext,
  target: string,
): Promise<string[] | null> {
  if (!target.trim()) {
    // [[#…]] — the note being edited.
    return noteAnchors(hostPath(context), context.state.doc.toString()).map((a) => a.id);
  }
  const path = resolveLink(target, useStore.getState().tree);
  if (!path) return null;
  const content = await noteContent(path);
  return content === null ? null : noteAnchors(path, content).map((a) => a.id);
}

/** The path of the note being edited, for anchor extraction on the open doc. */
function hostPath(context: CompletionContext): string {
  return context.state.facet(notePathFacet);
}

// ── Ranking ────────────────────────────────────────────────────────────────

/** Match tiers, best first. Zero is "no match at all" — the row is dropped. */
const TIER_EXACT = 4;
const TIER_PREFIX = 3;
const TIER_SUBSTRING = 2;
const TIER_SUBSEQUENCE = 1;

/** How well lowercase `typed` matches lowercase `name`. The four tiers are
 *  the whole story — WITHIN a tier the order is frecency's business, because
 *  "which of the eight notes starting with 'me' do I mean" is a question
 *  about the writer's habits, not about string distance.
 *
 *  BOTH SIDES ARE FOLDED (shared/fold.ts). This popup has its own matcher — it
 *  runs off the store's tree, never off the server's index — so v1.8's
 *  diacritic folding had to be wired in twice or it would have been a search
 *  box that finds «الْمُقَدِّمَة» beside a `[[` popup that does not, which is
 *  worse than neither: the reader would conclude the note is gone. Ignorables
 *  are dropped on both sides here (no offsets are reported), so a plain query
 *  reaches an EXACT tier on a pointed title rather than limping in as a
 *  subsequence under every note that merely contains the letters. */
function matchTier(rawTyped: string, rawName: string): number {
  const typed = foldTerm(rawTyped);
  const name = foldTerm(rawName);
  if (name === typed) return TIER_EXACT;
  if (name.startsWith(typed)) return TIER_PREFIX;
  if (name.includes(typed)) return TIER_SUBSTRING;
  // Subsequence: every typed character appears, in order ("mlrn" finds
  // "Machine Learning") — the net the old CodeMirror filter cast, kept so
  // ranking never OFFERS LESS than the unranked list did.
  let i = 0;
  for (const ch of name) {
    if (ch === typed[i]) i++;
    if (i === typed.length) return TIER_SUBSEQUENCE;
  }
  return 0;
}

/** Paths the open note already wikilinks to, resolved against the tree. The
 *  third-rank signal: among equally-matched, equally-visited candidates, the
 *  note this document already talks about is the likelier target. Scanned per
 *  popup — cheap next to everything else the keystroke does. */
function linkedFromDoc(state: EditorState): Set<string> {
  const tree = useStore.getState().tree;
  // Dedupe targets BEFORE resolving: resolveLink walks the tree per call, and
  // a long note says [[Same Note]] many times — the popup runs per keystroke.
  const targets = new Set<string>();
  for (const match of state.doc.toString().matchAll(WIKILINK_RE)) {
    const target = parseWikilink(match[1]).target;
    if (target) targets.add(target);
  }
  const out = new Set<string>();
  for (const target of targets) {
    const path = resolveLink(target, tree);
    if (path !== null) out.add(path);
  }
  return out;
}

interface RankedRow {
  option: Completion;
  tier: number;
  frecency: number;
  linked: boolean;
  /** Final alphabetical tie-break, so the order is total and stable. */
  name: string;
}

function byRank(a: RankedRow, b: RankedRow): number {
  return (
    b.tier - a.tier ||
    b.frecency - a.frecency ||
    Number(b.linked) - Number(a.linked) ||
    a.name.localeCompare(b.name)
  );
}

// ── The create row ─────────────────────────────────────────────────────────

/** Where "Create «typed»" will put the file: beside the note being edited,
 *  or exactly where a typed path says. SAID ON THE ROW (promptCreates), and
 *  that is the point — the row exists to make a note without leaving the
 *  sentence, and a create row that scatters files somewhere unstated is worse
 *  than none. The click-a-dashed-link path (livePreview) still creates at the
 *  vault root; this row is the one that both chooses better and says so. */
function createDestination(typed: string, host: string): string {
  const named = isNotePath(typed) ? typed : `${typed}.md`;
  if (typed.includes("/")) return named; // an explicit path is obeyed, root-relative
  const cut = host.lastIndexOf("/");
  return cut === -1 ? named : `${host.slice(0, cut)}/${named}`;
}

/** Insert the link as typed, then create the file at `dest` WITHOUT opening
 *  it: the writer is mid-sentence, and the whole value of creating from the
 *  popup is staying there. The tree reload makes the fresh link render
 *  resolved instead of dashed. */
function applyCreate(typed: string, dest: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number): void => {
    const alreadyClosed = view.state.sliceDoc(to, to + 2) === "]]";
    view.dispatch({
      changes: { from, to, insert: typed + (alreadyClosed ? "" : "]]") },
      selection: { anchor: from + typed.length + 2 },
      userEvent: "input.complete",
    });
    void (async () => {
      try {
        await createNote(dest);
        // Same courtesy store.createNote extends (it never throws — a
        // template failure leaves the note empty, which is what it was).
        await applyDefaultTemplate(dest);
        await useStore.getState().loadTree();
      } catch (err) {
        console.error("autocomplete: create failed", err);
        toast(t("couldNotCreateNote"));
      }
    })();
  };
}

// ── The [[ source ──────────────────────────────────────────────────────────

async function wikilinkSource(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  // Heading mode: "[[Target#… " (cursor after the #).
  const headingMatch = context.matchBefore(/\[\[([^[\]#|]*)#[^[\]#|]*$/);
  if (headingMatch) {
    const target = /^\[\[([^[\]#|]*)#/.exec(headingMatch.text)?.[1] ?? "";
    const headings = await headingOptions(context, target);
    if (!headings || headings.length === 0) return null;
    const seen = new Set<string>();
    const options: Completion[] = [];
    for (const heading of headings) {
      if (seen.has(heading)) continue;
      seen.add(heading);
      options.push({ label: heading, type: "text", apply: applyInner });
    }
    return {
      from: headingMatch.from + headingMatch.text.lastIndexOf("#") + 1,
      options,
      validFor: /^[^[\]#|]*$/,
    };
  }

  // Note-title mode: "[[…".
  const match = context.matchBefore(/\[\[[^[\]]*$/);
  if (!match) return null;
  const typedRaw = match.text.slice(2);
  // Past the pipe the author is writing DISPLAY text ("[[Note|shown as…"),
  // and completing a title over it would eat the alias they are typing.
  if (typedRaw.includes("|")) return null;
  const typed = typedRaw.trim().toLowerCase();

  const notes = collectNotes(useStore.getState().tree);
  // The alias table travels with the tree (state.loadTree), so this is a read,
  // not a fetch: the popup opens at the same speed it always did.
  const aliases = aliasCompletions();
  if (notes.length === 0 && aliases.length === 0) return null;

  // We rank, so WE filter: `filter: false` below hands CodeMirror a finished
  // list, because its own scorer re-sorts by string distance and would undo
  // the frecency order this source exists to impose.
  const frecency = recentScores();
  const linked = linkedFromDoc(context.state);

  const rows: RankedRow[] = [];
  let exactExists = false;
  // THE NOTE YOU ARE IN is not a destination (v1.8 audit, F4). It carries the
  // highest frecency there is — you are typing in it — so it sorted to the top
  // of every "[[" popup in the vault, offering a link from a note to itself as
  // the first and most obvious answer. It stays out of the list; it does NOT
  // stay out of `exactExists`, because a note whose own name is typed still
  // exists, and offering to CREATE it would be worse than offering to link it.
  const host = hostPath(context);
  for (const note of notes) {
    const name = note.title.toLowerCase();
    const tier = typed === "" ? TIER_SUBSEQUENCE : matchTier(typed, name);
    if (tier === 0) continue;
    if (tier === TIER_EXACT) exactExists = true;
    if (note.path === host) continue;
    rows.push({
      option: {
        label: note.title,
        detail: stripNoteExt(note.path) === note.title ? undefined : note.path,
        type: "text",
        apply: applyInner,
      },
      tier,
      frecency: frecency.get(note.path) ?? 0,
      linked: linked.has(note.path),
      name,
    });
  }

  // …and the note's OTHER names. An alias that merely repeats a filename is
  // dropped: it would complete to the same link twice, and the second row
  // would say something different about where it goes.
  const titles = new Set(notes.map((note) => note.title.toLowerCase()));
  // ONE ROW PER ALIAS, not one per claimant. Both rows would insert the same
  // `[[Alias]]`, and `resolveLink` then resolves that text to its single
  // deterministic winner — so with two notes claiming `ML`, the row labelled
  // "alias of Meta Learning" could land the reader on Machine Learning: a
  // completion whose own description lies about where it goes. The table
  // arrives sorted, and the sort puts each alias's WINNING claimant first
  // (the same pickShortest rule resolution uses), so keeping the first row is
  // keeping the honest one.
  const seenAlias = new Set<string>();
  for (const entry of aliases) {
    const key = entry.alias.toLowerCase();
    if (titles.has(key) || seenAlias.has(key)) continue;
    seenAlias.add(key);
    const tier = typed === "" ? TIER_SUBSEQUENCE : matchTier(typed, key);
    if (tier === 0) continue;
    if (tier === TIER_EXACT) exactExists = true;
    // …and the host note's own OTHER names are not destinations either (F4):
    // "[[Ledger]]" and "[[The Ledger]]" are the same self-link.
    if (entry.path === host) continue;
    rows.push({
      option: {
        // The detail says whose alias it is, because the label alone is a name
        // the reader may not recognise as belonging to that note yet — and when
        // two notes claim it, this row names the one the link will actually
        // reach.
        label: entry.alias,
        detail: tf("aliasCompletionDetail", { title: entry.title }),
        type: "text",
        apply: applyInner,
      },
      tier,
      // The alias ranks by ITS NOTE's frecency and linkedness: the name is a
      // door, and the door is as familiar as the room behind it.
      frecency: frecency.get(entry.path) ?? 0,
      linked: linked.has(entry.path),
      name: key,
    });
  }

  rows.sort(byRank);
  const options = rows.map((row) => row.option);

  // The "Create «typed»" row, LAST: it is the fallback, never the reflex
  // Enter lands on when a real note matches. Only when nothing already
  // answers to the typed name exactly (else it would offer a duplicate),
  // and only for a session that may write.
  const typedName = typedRaw.trim();
  if (typedName !== "" && !exactExists && !typedName.includes("#") && useStore.getState().admin) {
    const dest = createDestination(typedName, host);
    options.push({
      label: tf("linkCreateNote", { name: typedName }),
      // Where the file will LAND, spelled out — path, extension and all.
      detail: tf("promptCreates", { path: dest }),
      type: "keyword",
      apply: applyCreate(typedName, dest),
    });
  }

  if (options.length === 0) return null;
  return {
    from: match.from + 2, // just past "[["
    options,
    // filter:false forbids validFor; the source simply re-runs per keystroke,
    // which is what keeps the ranking honest as the typed text narrows.
    filter: false,
  };
}

// ── The #tag source ────────────────────────────────────────────────────────

/** GET /api/tags, cached for a minute. The SSE tree reload does not reach
 *  this module, so a TTL stands in: a tag created seconds ago appears within
 *  the minute, and a popup never waits on the network twice in one thought.
 *  Failures serve the stale list — an old tag list beats no popup. */
const TAGS_TTL_MS = 60_000;
let tagCache: { at: number; tags: TagCount[] } | null = null;

async function cachedTags(): Promise<TagCount[]> {
  if (tagCache !== null && Date.now() - tagCache.at < TAGS_TTL_MS) return tagCache.tags;
  try {
    tagCache = { at: Date.now(), tags: await getTags() };
  } catch {
    // keep the stale list, if any — and retry on the next popup
  }
  return tagCache?.tags ?? [];
}

/** Is `pos` somewhere prose rules don't apply — code, or a link/URL? A `#`
 *  inside a fence is a comment or a color, inside a URL it is a fragment;
 *  offering tags there would be autocomplete firing on syntax. */
function inCodeOrLink(state: EditorState, pos: number): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node;
    node = node.parent
  ) {
    if (/Code|URL|Autolink|Link|HTML|Math/.test(node.name)) return true;
  }
  return false;
}

/** The tag shape, kept in step with noteMeta.ts's TAG_RE (first char stricter
 *  than the rest). Only the "rest" half matters here — the popup follows the
 *  `#` the author already typed. */
const TAG_TAIL = /#[\p{L}\p{N}_/-]*$/u;

async function tagSource(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const match = context.matchBefore(TAG_TAIL);
  if (!match) return null;
  // Inside "[[…" the # means an anchor and wikilinkSource owns it.
  if (context.matchBefore(/\[\[[^\]]*$/)) return null;
  const line = context.state.doc.lineAt(match.from);
  const before = context.state.sliceDoc(line.from, match.from);
  // A `#` that opens the line is a HEADING being typed (`# Title`), not a
  // tag — at the moment of typing the two are indistinguishable, so the
  // popup yields. Mid-prose is the tag's home and the popup's.
  if (/^\s*$/.test(before)) return null;
  // TAG_RE's own opener class: whitespace or ( [ {. Anything else glued to
  // the # — `https://a/#frag`, `C#`, `a#b` — is not a tag site.
  if (!/[\s([{]/.test(before[before.length - 1])) return null;
  if (inCodeOrLink(context.state, match.from)) return null;

  const tags = await cachedTags();
  if (tags.length === 0) return null;

  const options: Completion[] = tags.map(({ tag, count }) => ({
    label: tag,
    // The LOCALISED label beside the canonical tag, when the instance names
    // one (client/tagLabels.ts): the popup inserts what the file stores and
    // shows what the chips will say — the same bargain every labelled chip
    // makes, made at the moment of writing.
    detail: isLabelled(tag) ? tagDisplayLabel(tag) : undefined,
    type: "keyword",
    // Well-used tags first among equal matches. Log-scaled: a tag used 400
    // times should beat one used 4 times, but not bury a better string match
    // (CodeMirror adds boost to its own match score).
    boost: Math.min(9, Math.round(Math.log2(count + 1))),
  }));
  return {
    from: match.from + 1, // just past "#" — the popup completes the name
    options,
    validFor: /^[\p{L}\p{N}_/-]*$/u,
  };
}

export function wikilinkAutocomplete(): Extension {
  return autocompletion({
    override: [
      wikilinkSource,
      tagSource,
      calloutTypeSource,
      fenceLanguageSource,
      slashSource,
    ],
    icons: false,
    activateOnTyping: true,
    addToOptions: [{ render: calloutIconRender, position: 20 }],
  });
}
