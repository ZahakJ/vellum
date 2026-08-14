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
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from "@codemirror/autocomplete";
import { vim } from "@replit/codemirror-vim";
import { editorTheme } from "./theme.ts";
import { livePreview } from "./livePreview.ts";
import { wikilinkAutocomplete } from "./autocomplete.ts";

export interface EditorSetupOptions {
  doc: string;
  vimMode: boolean;
  /** Fired on every document change (Editor.tsx debounces the autosave). */
  onDocChanged: (view: EditorView) => void;
  /** Fired on Ctrl/Cmd+S. */
  onSave: (view: EditorView) => void;
}

const vimCompartment = new Compartment();

export function buildEditorState(options: EditorSetupOptions): EditorState {
  return EditorState.create({
    doc: options.doc,
    extensions: [
      // Vim must precede other key handling; the compartment lets the store's
      // vimMode flag reconfigure it on a live view without a rebuild.
      vimCompartment.of(options.vimMode ? vim() : []),
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
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage }),
      editorTheme(),
      livePreview(),
      wikilinkAutocomplete(),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) options.onDocChanged(update.view);
      }),
      keymap.of([
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

/** Toggle vim on a live view without recreating state (undo history survives). */
export function setVim(view: EditorView, on: boolean): void {
  view.dispatch({
    effects: vimCompartment.reconfigure(on ? vim() : []),
  });
}
