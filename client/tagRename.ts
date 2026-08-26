// "Rename tag…" — the eighth-year answer to Obsidian's forum request #6.
//
// A tag is the one piece of a vault's vocabulary its keeper changes their mind
// about, and until now the only way to change one was find-and-replace over
// YAML in another editor. The gesture here is the one people already reach for:
// right-click the pill in the sidebar.
//
// TWO DIALOGS, and the second one is the point. The first asks for a name and
// checks it as it is typed — the rule, and the merge warning, are shown before
// anything is pressed. The second states what the server actually found: how
// many notes will be rewritten, whether the tag's own page is coming along.
// That is the `delete-preview` idiom one noun over (client/components/
// deleteFlow.ts argues it), and it is here for the same reason: a bulk edit
// that reports its scope only afterwards is a bulk edit nobody presses twice.

import { previewTagRename, renameTag } from "./api.ts";
import { bulkDoneToast } from "./bulkEdit.ts";
import { confirmModal, promptModal, type PromptCheck } from "./components/Confirm.tsx";
import { countPhrase, t, tf } from "./i18n.ts";
import { useStore } from "./state.ts";
import { toast } from "./toast.ts";
import { isTagName, tagKey } from "../shared/tagLabels.ts";

/** A tag as it is SAID: `#` and name together, so `tf()`'s bidi isolate wraps
 *  both. The hash is part of the name — the sidebar pill states the same rule
 *  with one `<bdi>` around the pair — and left outside the isolate it drifts to
 *  the wrong end of an Arabic tag. */
function hash(tag: string): string {
  return `#${tag}`;
}

/** What the FIELD says while it is being typed, from the tag list the sidebar
 *  already holds — no round trip, so the rule and the merge are visible on the
 *  first keystroke rather than after a submit. The exact counts come from the
 *  server a step later; these are the two facts a name alone can settle. */
function check(from: string, known: readonly string[], raw: string): PromptCheck {
  const typed = tagKey(raw.replace(/\s+/g, "-"));
  if (typed === "") return { value: "" };
  if (!isTagName(typed)) return { value: "", error: t("tagRenameBadName") };
  if (typed === from) return { value: "", error: t("tagRenameSameName") };
  if (typed.startsWith(`${from}/`) || from.startsWith(`${typed}/`)) {
    return { value: "", error: t("tagRenameNested") };
  }
  // Renaming ONTO a tag that exists is a merge — allowed, and said plainly,
  // because merging `#ml` into `#machine-learning` is half of what this
  // feature is for. It is the one outcome renaming back does not undo.
  if (known.some((tag) => tag === typed || tag.startsWith(`${typed}/`))) {
    return { value: typed, note: tf("tagRenameMerges", { tag: hash(typed) }) };
  }
  return {
    value: typed,
    note: typed === tagKey(raw) ? undefined : tf("tagRenameCreates", { tag: hash(typed) }),
  };
}

/** Ask, preview, apply, and hand back an undo. `known` is every canonical tag
 *  the sidebar is showing, used only for the live merge hint. */
export async function promptTagRename(from: string, known: readonly string[]): Promise<void> {
  const tag = tagKey(from);
  if (tag === "") return;
  const to = await promptModal({
    title: t("tagRenameTitle"),
    body: tf("tagRenameBody", { tag: hash(tag) }),
    value: tag,
    placeholder: tag,
    confirmLabel: t("rename"),
    check: (raw) => check(tag, known, raw),
  });
  if (to === null || to === tag) return;

  let preview;
  try {
    preview = await previewTagRename(tag, to);
  } catch (err) {
    console.error("vellum: previewing a tag rename failed", err);
    toast(t("tagRenameFailed"), "error");
    return;
  }
  if (preview.notes === 0) {
    // The index counted the tag (it reads `#define` inside a shell fence as
    // one — a known over-count) and the writer refuses to edit code. Saying
    // "0 notes" and stopping is the honest end of that: nothing to do.
    toast(tf("tagRenameNothing", { tag: hash(tag) }));
    return;
  }

  const lines = [
    tf("tagRenameConfirmBody", {
      count: countPhrase(preview.notes, "notes"),
      from: hash(tag),
      to: hash(to),
    }),
  ];
  if (preview.page !== null) lines.push(tf("tagRenamePage", { path: preview.page }));
  const ok = await confirmModal({
    title: preview.merge ? t("tagMergeTitle") : t("tagRenameTitle"),
    body: lines.join(" "),
    confirmLabel: preview.merge ? t("tagMergeAction") : t("rename"),
    // A merge is the one route here that renaming back does not reverse: the
    // two topics are one afterwards and nothing recorded which note carried
    // which. The undo bundle covers it while it lives; the warning covers the
    // reader who lets the toast fade.
    warn: preview.merge ? tf("tagMergeWarn", { to: hash(to) }) : undefined,
  });
  if (!ok) return;

  try {
    const result = await renameTag(tag, to);
    const store = useStore.getState();
    void store.loadTree();
    void store.refreshBacklinks();
    void store.loadPublished();
    bulkDoneToast(
      tf(preview.merge ? "tagMergedToast" : "tagRenamedToast", {
        from: hash(tag),
        to: hash(to),
        count: countPhrase(result.notes, "notes"),
      }),
      result,
    );
  } catch (err) {
    console.error("vellum: renaming a tag failed", err);
    toast(t("tagRenameFailed"), "error");
  }
}
