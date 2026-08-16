// CodeMirror theme for Vellum. Every color reads a CSS custom property
// from tokens.css, so the editor follows the iron-gall / parchment themes for
// free — no colors are hard-coded here.

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/** Code-fence syntax colors — every color is a --syn-* token from tokens.css,
 *  so highlighting follows the iron-gall / parchment themes. Markdown's own
 *  inline styling stays with livePreview.ts; only code-ish tags are defined. */
export function vellumHighlighting(): Extension {
  return syntaxHighlighting(
    HighlightStyle.define([
      {
        tag: [
          t.keyword,
          t.modifier,
          t.operatorKeyword,
          t.controlKeyword,
          t.moduleKeyword,
          t.definitionKeyword,
          t.self,
        ],
        color: "var(--syn-keyword)",
      },
      {
        tag: [t.string, t.special(t.string), t.regexp, t.character],
        color: "var(--syn-string)",
      },
      {
        tag: [t.number, t.bool, t.atom, t.null, t.unit],
        color: "var(--syn-number)",
      },
      {
        tag: [t.comment, t.blockComment, t.lineComment, t.docComment],
        color: "var(--syn-comment)",
        fontStyle: "italic",
      },
      {
        tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName],
        color: "var(--syn-func)",
      },
      {
        tag: [t.typeName, t.className, t.namespace, t.standard(t.tagName), t.tagName],
        color: "var(--syn-type)",
      },
      {
        tag: [t.propertyName, t.attributeName, t.labelName],
        color: "var(--syn-prop)",
      },
      { tag: [t.operator, t.derefOperator], color: "var(--syn-operator)" },
    ]),
  );
}

export function editorTheme(): Extension {
  return EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "var(--bg)",
      color: "var(--text)",
      fontSize: "1rem",
    },
    "&.cm-focused": { outline: "none" },
    ".cm-scroller": {
      paddingInline: "var(--prose-gutter)",
      fontFamily: "var(--font-serif)",
      fontSize: "calc(var(--font-prose, 1.161rem) * var(--prose-scale, 1))",
      lineHeight: "1.7",
      overflow: "auto",
      scrollbarWidth: "thin",
      scrollbarColor: "var(--border) transparent",
    },
    // The horizontal gutter lives on the SCROLLER (see app.css): CodeMirror's
    // own selection rects are drawn against the content box, so a padded
    // content box paints the selection into the prose margin.
    ".cm-content": {
      maxWidth: "648px",
      margin: "0 auto",
      padding: "48px 0 120px",
      caretColor: "var(--accent)",
    },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    ".cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground":
      { background: "var(--accent-soft)" },
    ".cm-selectionMatch": {
      background: "var(--accent-soft)",
      borderRadius: "2px",
    },

    // Search panel.
    ".cm-panels": {
      backgroundColor: "var(--bg-raised)",
      color: "var(--text)",
    },
    ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
    ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
    ".cm-panel.cm-search label": { color: "var(--text-muted)" },

    // Vim's status line (vim({ status: true })). It is the modal editor's own
    // `-- INSERT --` readout AND the host for the `:` / `/` command line, so
    // it is the one piece of chrome that must stay legible even in zen, where
    // the status bar and its pills are at zero height. The library ships a
    // bare unstyled div; this gives it the accent, the mono face and enough
    // weight to read as a mode line rather than as a stray caption.
    ".cm-vim-panel": {
      padding: "3px 12px",
      background: "color-mix(in srgb, var(--accent) 10%, var(--bg-raised))",
      color: "var(--accent)",
      fontFamily: "var(--font-mono)",
      fontSize: "0.786rem",
      fontWeight: "600",
      letterSpacing: "0.04em",
      minHeight: "1.6rem",
      // Vim's own words are ASCII and its command line is a terminal line, so
      // the RUN is ltr on an Arabic instance too — the same treatment
      // CONTRACTS gives git's verbatim error text ("its OWN dir=ltr block").
      // `start` rather than `left`: no physical value in the stylesheet; under
      // this block's own ltr direction it resolves to the left, where a vim
      // mode line belongs.
      direction: "ltr",
      textAlign: "start",
    },
    ".cm-vim-panel input": {
      background: "transparent",
      border: "none",
      outline: "none",
      color: "var(--text)",
      fontFamily: "var(--font-mono)",
      fontSize: "0.786rem",
      width: "100%",
    },
    ".cm-textfield": {
      background: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      color: "var(--text)",
    },
    ".cm-button": {
      background: "var(--bg-hover)",
      backgroundImage: "none",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      color: "var(--text)",
    },

    // Tooltips + autocomplete.
    ".cm-tooltip": {
      background: "var(--bg-raised)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      color: "var(--text)",
      overflow: "hidden",
    },
    // Wikilink/heading autocomplete: same finish as the command palette —
    // UI font (not CM's default monospace), raised panel, gold selection bar.
    ".cm-tooltip.cm-tooltip-autocomplete": {
      borderRadius: "8px",
      boxShadow: "0 16px 40px rgba(0, 0, 0, 0.35)",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul": {
      fontFamily: "var(--font-ui)",
      fontSize: "0.929rem",
      maxHeight: "18em",
      padding: "4px",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
      padding: "5px 10px",
      lineHeight: "1.45",
      borderRadius: "4px",
      borderLeft: "2px solid transparent",
      color: "var(--text)",
      transition: "background 150ms ease",
    },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      background: "var(--accent-soft)",
      borderLeftColor: "var(--accent)",
      color: "var(--text)",
    },
    ".cm-completionLabel": { fontFamily: "var(--font-ui)" },
    ".cm-completionMatchedText": {
      textDecoration: "none",
      color: "var(--accent)",
      fontWeight: "600",
    },
    ".cm-completionDetail": {
      color: "var(--text-faint)",
      fontStyle: "normal",
      marginLeft: "0.75em",
      fontSize: "0.85em",
    },

    // Vim block cursor.
    ".cm-fat-cursor": {
      background: "var(--accent) !important",
      color: "var(--bg) !important",
    },
    "&:not(.cm-focused) .cm-fat-cursor": {
      background: "transparent !important",
      outline: "1px solid var(--accent) !important",
    },

    // ── Live-preview classes (applied by livePreview.ts) ──────────────────
    ".cm-s-h1, .cm-s-h2, .cm-s-h3, .cm-s-h4, .cm-s-h5, .cm-s-h6": {
      fontFamily: "var(--font-serif)",
      fontWeight: "700",
      lineHeight: "1.3",
    },
    ".cm-s-h1": {
      fontSize: "1.9em",
      paddingTop: "0.5em",
      paddingBottom: "0.2em",
      borderBottom: "1px solid var(--border)",
      color: "color-mix(in srgb, var(--accent) 15%, var(--text))",
    },
    ".cm-s-h2": { fontSize: "1.5em", paddingTop: "0.4em" },
    ".cm-s-h3": { fontSize: "1.25em", paddingTop: "0.3em" },
    ".cm-s-h4": { fontSize: "1.1em" },
    ".cm-s-h5": { fontSize: "1em" },
    ".cm-s-h6": {
      fontSize: "0.9em",
      color: "var(--text-muted)",
      letterSpacing: "0.04em",
    },
    // Formatting marks left visible on the active line read as faint ink.
    ".cm-s-syntax": { color: "var(--text-faint)", fontWeight: "400" },

    ".cm-s-strong": { fontWeight: "700" },
    ".cm-s-em": { fontStyle: "italic" },
    ".cm-s-strike": {
      textDecoration: "line-through",
      color: "var(--text-muted)",
    },
    ".cm-s-inline-code": {
      fontFamily: "var(--font-mono)",
      fontSize: "0.875em",
      background: "var(--bg-raised)",
      border: "1px solid var(--border)",
      borderRadius: "4px",
      padding: "0.05em 0.3em",
    },
    ".cm-s-codeblock": {
      fontFamily: "var(--font-mono)",
      fontSize: "0.875em",
      background: "var(--bg-raised)",
    },
    ".cm-s-quote": {
      borderLeft: "3px solid var(--accent)",
      paddingLeft: "0.9em",
      color: "var(--text-muted)",
      fontStyle: "italic",
    },
    // The SOURCE line, shown only while the cursor is on it. The rendered
    // divider is a block widget (livePreview.ts) styled in preview.css — this
    // is what `---` looks like when you are editing it, nothing more.
    ".cm-s-hr": {
      color: "var(--text-faint)",
      letterSpacing: "0.2em",
    },
    ".cm-s-bullet": { color: "var(--accent)" },
    ".cm-s-task-done": {
      color: "var(--text-faint)",
      textDecoration: "line-through",
    },
    ".cm-s-wikilink": {
      color: "var(--accent)",
      cursor: "pointer",
    },
    ".cm-s-wikilink:hover": { textDecoration: "underline" },
    // "›" between note and heading in a rendered [[Note#Heading]].
    ".cm-s-wikilink-sep": {
      color: "var(--accent)",
      opacity: "0.65",
      padding: "0 0.22em",
      cursor: "pointer",
    },
    ".cm-s-wikilink--broken": {
      color: "color-mix(in srgb, var(--danger) 70%, var(--text))",
      textDecoration: "underline dashed",
      textDecorationColor: "color-mix(in srgb, var(--danger) 55%, transparent)",
      textUnderlineOffset: "3px",
    },
    // Smaller than the sidebar pill (DESIGN.md: "same pill style as sidebar,
    // smaller"), and the same size as the reading view's own chip.
    ".cm-s-tag": {
      color: "var(--accent)",
      background: "var(--accent-soft)",
      borderRadius: "999px",
      padding: "0.05em 0.5em",
      fontSize: "0.72em",
    },
    ".cm-s-link, .cm-s-url": {
      color: "var(--accent)",
      textDecoration: "underline",
      textDecorationColor: "var(--accent-soft)",
      cursor: "pointer",
    },
  });
}
