// Assembles the CodeMirror EditorState for a note: markdown language, history,
// search, conditional vim (in a Compartment so it can be toggled live), the
// Vellum theme, live preview, and wikilink autocomplete.

import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  placeholder,
  rectangularSelection,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  moveLineDown,
  moveLineUp,
} from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import {
  markdown,
  markdownLanguage,
  pasteURLAsLink,
} from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { autoLineDirection } from "./bidi.ts";
import { layoutFallback } from "./layoutKeys.ts";
import { noteLayoutExtension } from "./noteLayout.ts";
import { editorTheme, vellumHighlighting } from "./theme.ts";
import { livePreview } from "./livePreview.ts";
import { pointerSelection } from "./pointer.ts";
import { searchPhrases } from "./searchPhrases.ts";
import { formatKeymap } from "./commands.ts";
import { selectionMenu } from "../components/SelectionMenu.tsx";
import { wikilinkAutocomplete } from "./autocomplete.ts";
import { imageUploads } from "./uploads.ts";
import { hoverPreviews } from "./hoverPreview.ts";
import { headingFolds } from "./folding.ts";
import { sectioning } from "./sectioning.ts";
import { attachVimStatus, detachVimStatus } from "./vimStatus.ts";
import { getLang, t } from "../i18n.ts";
import { isTexPath } from "../../shared/noteFormat.ts";
import { texFolds, texHighlighting, texLanguage } from "./tex/lang.ts";
import { texPreview } from "./tex/preview.ts";
import { texAutocomplete } from "./tex/complete.ts";

export interface EditorSetupOptions {
  doc: string;
  /** Vault-relative path of the note (embeds resolve against its folder). */
  path: string;
  vimMode: boolean;
  /** Fired on every document change (Editor.tsx debounces the autosave). */
  onDocChanged: (view: EditorView) => void;
  /** Fired on Ctrl/Cmd+S. */
  onSave: (view: EditorView) => void;
}

const vimCompartment = new Compartment();

// @replit/codemirror-vim is heavy and most sessions never enable it: load it
// on demand and cache the built extension for later editors.
type VimExtension = ReturnType<typeof import("@replit/codemirror-vim").vim>;
let vimExt: VimExtension | null = null;

async function loadVim(): Promise<VimExtension> {
  if (!vimExt) {
    const { vim } = await import("@replit/codemirror-vim");
    // `status: true` is not decoration. It mounts vim's own panel at the foot
    // of the editor, and that panel is what draws `-- INSERT --` / `-- VISUAL --`
    // AND hosts the `:` / `/` command line. Without it the extension shipped
    // with no on-screen state at all: the VIM pill told the reader the
    // extension was loaded, never that the keys under their fingers were
    // currently COMMANDS — which is the actual trap, and the one the owner
    // named ("same with vim mode"). vimStatus.ts forwards the same signal to
    // the status-bar pill.
    vimExt = vim({ status: true });
  }
  return vimExt;
}

export function buildEditorState(options: EditorSetupOptions): EditorState {
  return EditorState.create({
    doc: options.doc,
    extensions: [
      // Vim must precede other key handling; the compartment lets the store's
      // vimMode flag reconfigure it on a live view without a rebuild. When the
      // module has not arrived yet, setVim() patches it in async after mount.
      vimCompartment.of(options.vimMode && vimExt ? vimExt : []),
      // NON-LATIN KEYBOARDS. Every keymap below resolves through `e.key` —
      // what the LAYOUT produced — so on the owner's Arabic keyboard the
      // physical B key reports the two-code-point ligature "لا" and Ctrl+B
      // bolds nothing. This re-runs those same keymaps with the physical key
      // when, and only when, the layout produced no Latin character. It binds
      // nothing of its own; see layoutKeys.ts and client/keys.ts.
      layoutFallback,
      Prec.high(
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: (view) => {
              options.onSave(view);
              return true;
            },
          },
        ]),
      ),
      // MULTIPLE SELECTIONS, and this one flag is the whole feature. Every
      // other piece was already here and had never once been exercised:
      // `pointer.ts` implements add-a-range and remove-a-range on Mod+click,
      // `livePreview.ts`'s `activeLines` reveals the raw markdown around EVERY
      // range rather than the main one, and the formatting commands map over
      // `state.selection.ranges` and carry `mainIndex` through the dispatch.
      // Without this facet `EditorState` funnels every multi-range selection
      // through `asSingle()`, so all of that code ran exactly once per
      // keystroke on exactly one range and looked, from the outside, like a
      // product that had simply chosen not to have multi-cursor.
      EditorState.allowMultipleSelections.of(true),
      // The find panel, the go-to-line panel and the completion list are built
      // inside CodeMirror from English literals, so on an Arabic instance
      // Ctrl+F opened the one piece of chrome in the product that had never
      // been translated — and `check-i18n` could not see it, because its scan
      // root is `client/` and those strings live in node_modules. See
      // searchPhrases.ts: this facet is the library's own door for it.
      EditorState.phrases.of(searchPhrases()),
      // SPELLCHECK, WHICH THIS EDITOR HAS NEVER HAD. CodeMirror's own default
      // content attributes set `spellcheck: "false"`, and nothing here ever
      // overrode it — so the only appearances of the attribute in the whole
      // client were `spellCheck={false}` on chrome inputs, and the reader's
      // right-click menu offered no spelling and no dictionary. CONTRACTS
      // already declined to put a formatting menu on an empty selection on the
      // grounds that "the browser's own menu (spelling, paste, the dictionary)
      // is the better answer and taking it would be theft" — a menu that, with
      // this off, had none of those things in it.
      //
      // `lang` is the INSTANCE's language and it is only the floor: bidi.ts
      // stamps a narrower one per line, so an Arabic paragraph inside an
      // English note is checked in Arabic. Autocorrect and autocapitalize stay
      // off — a markdown note is not a message box, and a capitalized `iOS` or
      // a "corrected" `[[wikilink]]` is a silent edit to somebody's file.
      EditorView.contentAttributes.of({
        spellcheck: "true",
        autocorrect: "off",
        autocapitalize: "off",
        lang: getLang(),
      }),
      history(),
      drawSelection(),
      dropCursor(),
      highlightSpecialChars(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      // A fresh (daily) note is an empty pane — give it a quiet cue.
      placeholder(t("startWriting")),
      EditorView.lineWrapping,
      // Each line takes its direction from its own content (dir="auto" line
      // decorations), so Arabic/Hebrew paragraphs read right-to-left while
      // the rest of the note stays LTR; perLineTextDirection makes CodeMirror
      // honor that per-line direction for cursor movement.
      EditorView.perLineTextDirection.of(true),
      autoLineDirection,
      // …and the SITE (or the note's own frontmatter) may pin both the
      // direction and the ALIGNMENT of that prose. bidi.ts above already
      // resolves the direction into the per-line attribute; this paints the
      // alignment onto `.cm-content` and marks the lines that must never take
      // it — a centred code fence stops lining up with itself. Format-blind
      // like everything else at this level: a `.tex` note takes the direction
      // and refuses the measure, one branch inside the plugin.
      noteLayoutExtension(options.path),
      // THE ONE BRANCH IN THE EXTENSION LIST. Everything above and below it is
      // format-blind — the theme, the vim compartment, the save keymap, the
      // caret handling, the uploads. What differs between a `.md` and a `.tex`
      // note is the language, the folding and what live preview MEANS, and
      // those three are exactly what the tex extensions swap.
      //
      // The FORMATTING is the exception, and it is not a fourth entry here: it
      // branches one layer down, on `notePathFacet`, because the extension is
      // the same in both notes and only its VOCABULARY changes (commands.ts's
      // `syntaxOf`). `**bold**` typed into a `.tex` file is two pairs of
      // asterisks nothing renders, so bold is `\textbf{…}` there, a heading is
      // `\section{…}`, and strikethrough — which LaTeX cannot spell without a
      // package a note may not load — is not offered at all.
      ...(isTexPath(options.path)
        ? [texLanguage, texFolds, texHighlighting(), texPreview(options.path), editorTheme(), vellumHighlighting()]
        : [
            markdown({ base: markdownLanguage, codeLanguages: languages }),
            editorTheme(),
            vellumHighlighting(),
            livePreview(options.path),
          ]),
      // Caret placement resolved through the DOM rather than CodeMirror's
      // `posAtCoords`, which mis-maps every row carrying a replaced inline
      // widget (rendered math, an image, a hidden wikilink bracket) — see
      // pointer.ts, and scripts/check-caret.mjs, which is the gate.
      // ABOVE pointerSelection, and the order is the whole reason it works.
      // `EditorView.mouseSelectionStyle` takes the FIRST style that answers,
      // and pointerSelection answers every primary-button press — including
      // one with Alt held. rectangularSelection's own filter is `altKey`, so
      // putting it first means Alt-drag becomes a column selection and every
      // other drag still goes through pointer.ts's DOM-resolved caret. The
      // crosshair is the affordance: hold Alt and the pointer says what the
      // next drag will do.
      rectangularSelection(),
      crosshairCursor(),
      pointerSelection,
      // Bold/italic/underline/strikethrough/highlight. Above defaultKeymap,
      // below the vim compartment — see commands.ts for every number. Bound in
      // BOTH formats: each key resolves its own spelling from the note, and
      // the two LaTeX cannot spell decline rather than writing markdown.
      formatKeymap,
      // Right-click (and Shift+F10) over a selection opens the formatting
      // menu; a floating toolbar follows every selection unless the reader
      // has turned it off. Both run the same commands as the keystrokes, and
      // both list only the rows the open note's language can carry.
      selectionMenu(),
      // `[[` is markdown's link syntax; a `.tex` note completes `\note{…}`,
      // `\ref{…}`, `\cite{…}` and `\begin{…}` instead.
      isTexPath(options.path) ? texAutocomplete() : wikilinkAutocomplete(),
      // Editing delight: paste/drop image uploads, pasting a URL over a
      // selection makes a markdown link, wikilink/footnote hover previews,
      // heading-section folding.
      imageUploads(),
      pasteURLAsLink,
      hoverPreviews(),
      // Markdown's heading folds are markdown's; a `.tex` note folds
      // environments and sections through texFolds above.
      ...(isTexPath(options.path) ? [] : [headingFolds()]),
      // The section affordances: the ⋯ beside each heading's chevron, the
      // heading context menu, jump-to-heading / focus-section / select-section,
      // fold state that survives a reload, and the bridge the outline panel
      // writes its drags through. Markdown only, for the same reason folding
      // is: a `.tex` note's structure is `\section{…}` and texFolds owns it.
      ...(isTexPath(options.path) ? [] : [sectioning()]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) options.onDocChanged(update.view);
      }),
      keymap.of([
        { key: "Mod-ArrowUp", run: moveLineUp },
        { key: "Mod-ArrowDown", run: moveLineDown },
        ...closeBracketsKeymap,
        ...completionKeymap,
        ...searchKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ]),
    ],
  });
}

/** Toggle vim on a live view without recreating state (undo history survives).
 *  First activation loads the vim module on demand. */
export function setVim(view: EditorView, on: boolean): void {
  if (!on) {
    view.dispatch({ effects: vimCompartment.reconfigure([]) });
    detachVimStatus(view);
    return;
  }
  void loadVim().then((ext) => {
    if (!view.dom.isConnected) return; // editor unmounted while loading
    view.dispatch({ effects: vimCompartment.reconfigure(ext) });
    // The plugin builds its CodeMirror adapter during that dispatch, so the
    // listener can go on immediately after it.
    attachVimStatus(view);
  });
}
