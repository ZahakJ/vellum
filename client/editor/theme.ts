// CodeMirror theme for Vellum. Every color reads a CSS custom property
// from tokens.css, so the editor follows the iron-gall / parchment themes for
// free — no colors are hard-coded here.

import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

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
      fontFamily: "var(--font-ui)",
      lineHeight: "1.6",
      overflow: "auto",
      scrollbarWidth: "thin",
      scrollbarColor: "var(--border) transparent",
    },
    ".cm-content": {
      maxWidth: "46rem",
      margin: "0 auto",
      padding: "1.5rem 2rem 45vh",
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
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "3px 10px" },
    ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
      background: "var(--accent-soft)",
      color: "var(--text)",
    },
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
    ".cm-s-h1": { fontSize: "1.9rem", paddingTop: "0.5rem" },
    ".cm-s-h2": { fontSize: "1.5rem", paddingTop: "0.4rem" },
    ".cm-s-h3": { fontSize: "1.25rem", paddingTop: "0.3rem" },
    ".cm-s-h4": { fontSize: "1.1rem" },
    ".cm-s-h5": { fontSize: "1rem" },
    ".cm-s-h6": {
      fontSize: "0.9rem",
      color: "var(--text-muted)",
      letterSpacing: "0.04em",
    },

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
    },
    ".cm-s-hr": {
      color: "var(--text-faint)",
      letterSpacing: "0.2em",
    },
    ".cm-s-bullet": { color: "var(--accent)" },
    "input.cm-s-task": {
      accentColor: "var(--accent)",
      cursor: "pointer",
      margin: "0 0.15em 0 0",
      verticalAlign: "-0.1em",
    },
    ".cm-s-task-done": {
      color: "var(--text-muted)",
      textDecoration: "line-through",
    },
    ".cm-s-wikilink": {
      color: "var(--accent)",
      cursor: "pointer",
    },
    ".cm-s-wikilink:hover": { textDecoration: "underline" },
    ".cm-s-tag": {
      color: "var(--accent)",
      background: "var(--accent-soft)",
      borderRadius: "999px",
      padding: "0.05em 0.5em",
      fontSize: "0.85em",
    },
    ".cm-s-link, .cm-s-url": {
      color: "var(--accent)",
      textDecoration: "underline",
      textDecorationColor: "var(--accent-soft)",
      cursor: "pointer",
    },
  });
}
