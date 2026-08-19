// The words CodeMirror renders itself.
//
// The find panel, the go-to-line panel, the completion list and the fold
// placeholders are built inside `@codemirror/search`, `/autocomplete`,
// `/language` and `/view`, from English string literals. So on an Arabic
// instance — where every other pixel of the interface mirrors and translates —
// pressing Ctrl+F opened a panel reading "Find / next / previous / match case /
// regexp / by word", in English, left-to-right, inside the editor.
//
// `check-i18n` could not have caught it: its scan root is `client/`, and these
// strings are in `node_modules`. That is not a hole to widen, it is a hole with
// a door — `EditorState.phrases` is CodeMirror's own translation hook, and this
// module is the door. Every string below now has a dictionary key, which means
// the gate counts it, the parity check holds it to having an Arabic side, and a
// future CodeMirror upgrade that adds a phrase shows up as an English word in
// an Arabic panel rather than as nothing at all.
//
// Keys are CodeMirror's own English source strings — that is the contract of
// the facet, so they are literals here and must not be "tidied".

import { t } from "../i18n.ts";

/** Built per editor rather than held as a module constant: the instance's
 *  language can change without a reload, and a frozen table would keep serving
 *  the language the first note happened to open in. */
export function searchPhrases(): Record<string, string> {
  return {
    // @codemirror/search — the find panel
    "Find": t("cmFind"),
    // One Arabic word for both: the placeholder in the replace field and the
    // button beside it are the same verb, and CodeMirror spells them with
    // different capitals only because English does.
    "Replace": t("cmReplace"),
    "replace": t("cmReplace"),
    "next": t("cmNext"),
    "previous": t("cmPrevious"),
    "all": t("cmAll"),
    "match case": t("cmMatchCase"),
    "regexp": t("cmRegexp"),
    "by word": t("cmByWord"),
    "replace all": t("cmReplaceAll"),
    "current match": t("cmCurrentMatch"),
    "replaced $ matches": t("cmReplacedMatches"),
    "replaced match on line $": t("cmReplacedOnLine"),
    // @codemirror/search — go to line
    "Go to line": t("cmGoToLine"),
    "go": t("cmGo"),
    "on line": t("cmOnLine"),
    // Shared: the search panel's ✕ and the completion tooltip's own close.
    "close": t("cmClose"),
    // @codemirror/autocomplete, /view, /language
    "Completions": t("cmCompletions"),
    "Control character": t("cmControlChar"),
    "folded code": t("cmFoldedCode"),
    "to": t("cmFoldTo"),
    "unfold": t("cmUnfold"),
  };
}
