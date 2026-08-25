// Slash commands + structural autocompletes:
//
//   - "/" at the start of a line opens a fuzzy menu of block inserts
//     (callout, code fence, table, task list, math block, divider, date,
//     daily-note link) — arrow keys + Enter, Esc, all via CM autocomplete;
//   - "> [!" completes Obsidian callout types, each row showing the callout's
//     icon in its color;
//   - "```lang" completes fence languages from @codemirror/language-data.
//
// All three are extra sources for the autocompletion() instance assembled in
// autocomplete.ts, so they share the palette-grade tooltip styling.

import {
  snippet,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { languages } from "@codemirror/language-data";
import { dailyNotePath } from "../daily.ts";
import { t, type I18nKey } from "../i18n.ts";
import { CALLOUT_TYPES, calloutGroup, calloutIconSvg } from "./calloutDefs.ts";

// ── Slash menu ──────────────────────────────────────────────────────────────

function isoToday(): string {
  return dailyNotePath().replace(/^daily\/|\.md$/g, "");
}

/** Insert plain text, cursor at `text.length - back`. */
function insertText(text: string, back = 0) {
  return (view: EditorView, _c: Completion, from: number, to: number): void => {
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length - back },
      userEvent: "input.complete",
    });
  };
}

/** snippet(), then pop the follow-up completion (fence language search). */
function snippetThenComplete(template: string) {
  const apply = snippet(template);
  return (view: EditorView, c: Completion, from: number, to: number): void => {
    apply(view, c, from, to);
    window.setTimeout(() => startCompletion(view), 0);
  };
}

interface SlashItem {
  /** ASCII match key — what "/tab" filters against. Never localized: the menu
   *  is opened by typing "/" into a markdown document, so its filter alphabet
   *  has to be the one already under the writer's fingers. */
  label: string;
  /** Localized row title (CM renders displayLabel and matches on label). */
  displayLabel: I18nKey;
  /** Literal syntax preview ("- [ ]", "---", an ISO date) — never localized. */
  detail?: string;
  /** …or, for the rows whose detail is prose, the dictionary key for it. */
  detailKey?: I18nKey;
  boost: number;
  apply: (view: EditorView, c: Completion, from: number, to: number) => void;
}

function slashItems(): SlashItem[] {
  return [
    {
      label: "Callout",
      displayLabel: "slashCallout",
      detail: "> [!note]",
      boost: 9,
      apply: snippet("> [!${note}] ${}"),
    },
    {
      label: "Code block",
      displayLabel: "slashCodeBlock",
      detailKey: "slashCodeBlockDetail",
      boost: 8,
      apply: snippetThenComplete("```${}\n${}\n```"),
    },
    {
      label: "Table",
      displayLabel: "slashTable",
      detailKey: "slashTableDetail",
      boost: 7,
      // 2×2, and exactly ONE snippet field: the old three-field skeleton fed
      // Tab to the snippet walker, which collides with the table keymap's own
      // Tab (tables.ts walks cells and grows rows — from the last field the
      // snippet walker swallowed the keystroke that should have grown one).
      // A single field selects the first header cell; from there every Tab
      // is the table's.
      apply: snippet("| ${Column 1} | Column 2 |\n| --- | --- |\n|  |  |"),
    },
    {
      // A tracker sits above the task list on purpose: it is the row someone
      // opens this menu hoping to find, and its skeleton is the documentation
      // (the fence's keys are the fields, in the order the card reads them).
      label: "Tracker",
      displayLabel: "slashTracker",
      detail: "```tracker",
      boost: 6.5,
      apply: snippet(
        "```tracker\ntitle: ${Title}\nkind: ${book}\nprogress: ${0}/${100}\nstatus: ${active}\n```",
      ),
    },
    {
      label: "Tracker board",
      displayLabel: "slashTrackerBoard",
      detailKey: "slashTrackerBoardDetail",
      boost: 6.4,
      apply: snippet("```tracker-board\nstatus: ${active}\n```"),
    },
    {
      label: "Task list",
      displayLabel: "slashTaskList",
      detail: "- [ ]",
      boost: 6,
      apply: snippet("- [ ] ${}"),
    },
    {
      label: "Math block",
      displayLabel: "slashMathBlock",
      detailKey: "slashMathDetail",
      boost: 5,
      apply: snippet("$$\n${}\n$$"),
    },
    {
      label: "Divider",
      displayLabel: "slashDivider",
      detail: "---",
      boost: 4,
      apply: insertText("---\n"),
    },
    {
      label: "Date",
      displayLabel: "slashDate",
      detail: isoToday(),
      boost: 3,
      apply: insertText(isoToday()),
    },
    {
      label: "Daily note link",
      displayLabel: "slashDailyLink",
      detail: `[[daily/${isoToday()}]]`,
      boost: 2,
      apply: insertText(`[[daily/${isoToday()}]]`),
    },
  ];
}

export function slashSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const match = /^(\s*)\/([\w -]*)$/.exec(before);
  if (!match) return null;
  const slashPos = line.from + match[1].length;
  const options: Completion[] = slashItems().map((item) => ({
    label: item.label,
    displayLabel: t(item.displayLabel),
    detail: item.detailKey ? t(item.detailKey) : item.detail,
    boost: item.boost,
    // The match region starts after "/" (so typing filters by label), but the
    // insert must also swallow the slash itself.
    apply: (view, c, from, to) => item.apply(view, c, Math.min(slashPos, from - 1), to),
  }));
  return { from: slashPos + 1, options, validFor: /^[\w -]*$/ };
}

// ── Callout-type autocomplete ("> [!") ──────────────────────────────────────

interface CalloutCompletion extends Completion {
  calloutGroup: string;
}

function applyCalloutType(
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
): void {
  // closeBrackets means "[" usually arrived with its "]" — step over it.
  const closed = view.state.sliceDoc(to, to + 1) === "]";
  if (closed) {
    view.dispatch({
      changes: [
        { from, to, insert: completion.label },
        { from: to + 1, to: to + 1, insert: " " },
      ],
      selection: { anchor: from + completion.label.length + 2 },
      userEvent: "input.complete",
    });
  } else {
    const insert = `${completion.label}] `;
    view.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      userEvent: "input.complete",
    });
  }
}

export function calloutTypeSource(
  context: CompletionContext,
): CompletionResult | null {
  const match = context.matchBefore(/>\s*\[!\w*$/);
  if (!match) return null;
  const typed = /\w*$/.exec(match.text)?.[0] ?? "";
  const options: CalloutCompletion[] = CALLOUT_TYPES.map((type, i) => ({
    label: type,
    calloutGroup: calloutGroup(type),
    apply: applyCalloutType,
    boost: CALLOUT_TYPES.length - i, // keep canonical order, not alphabetical
  }));
  return { from: context.pos - typed.length, options, validFor: /^\w*$/ };
}

/** addToOptions renderer: callout rows get their icon in the callout color. */
export function calloutIconRender(completion: Completion): Node | null {
  const group = (completion as Partial<CalloutCompletion>).calloutGroup;
  if (!group) return null;
  const span = document.createElement("span");
  span.className = "cm-s-complete-callout";
  span.dataset.group = group;
  span.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${calloutIconSvg(group)}</svg>`;
  return span;
}

// ── Fence language search ("```lang") ───────────────────────────────────────

let langOptions: Completion[] | null = null;

function fenceLanguages(): Completion[] {
  if (langOptions) return langOptions;
  const seen = new Set<string>();
  langOptions = [];
  for (const desc of languages) {
    const label = (desc.alias[0] ?? desc.name).toLowerCase();
    if (seen.has(label)) continue;
    seen.add(label);
    langOptions.push({
      label,
      detail: desc.name.toLowerCase() === label ? undefined : desc.name,
      type: "text",
    });
  }
  langOptions.sort((a, b) => a.label.localeCompare(b.label));
  return langOptions;
}

export function fenceLanguageSource(
  context: CompletionContext,
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  // Allow quote prefixes: fences also live inside callouts ("> ```py").
  const match = /^\s*(?:>\s*)*(?:```|~~~)([\w+#-]*)$/.exec(before);
  if (!match) return null;
  return {
    from: context.pos - match[1].length,
    options: fenceLanguages(),
    validFor: /^[\w+#-]*$/,
  };
}
