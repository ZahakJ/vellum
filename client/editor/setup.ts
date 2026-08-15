// Assembles the CodeMirror EditorState for a note: markdown language, history,
// search, conditional vim (in a Compartment so it can be toggled live), the
// Vellum theme, live preview, and wikilink autocomplete.

import { Compartment, EditorState, Prec } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightSpecialChars,
  keymap,
  placeholder,
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
import { editorTheme, vellumHighlighting } from "./theme.ts";
import { livePreview } from "./livePreview.ts";
import { wikilinkAutocomplete } from "./autocomplete.ts";
import { imageUploads } from "./uploads.ts";
import { hoverPreviews } from "./hoverPreview.ts";
import { headingFolds } from "./folding.ts";

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
    vimExt = vim();
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
      history(),
      drawSelection(),
      dropCursor(),
      highlightSpecialChars(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightSelectionMatches(),
      // A fresh (daily) note is an empty pane — give it a quiet cue.
      placeholder("Start writing…"),
      EditorView.lineWrapping,
      // Each line takes its direction from its own content (dir="auto" line
      // decorations), so Arabic/Hebrew paragraphs read right-to-left while
      // the rest of the note stays LTR; perLineTextDirection makes CodeMirror
      // honor that per-line direction for cursor movement.
      EditorView.perLineTextDirection.of(true),
      autoLineDirection,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      editorTheme(),
      vellumHighlighting(),
      livePreview(options.path),
      wikilinkAutocomplete(),
      // Editing delight: paste/drop image uploads, pasting a URL over a
      // selection makes a markdown link, wikilink/footnote hover previews,
      // heading-section folding.
      imageUploads(),
      pasteURLAsLink,
      hoverPreviews(),
      headingFolds(),
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
    return;
  }
  void loadVim().then((ext) => {
    if (!view.dom.isConnected) return; // editor unmounted while loading
    view.dispatch({ effects: vimCompartment.reconfigure(ext) });
  });
}
