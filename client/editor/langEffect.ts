// The chrome-language change signal for the CodeMirror layer.
//
// i18n.ts asks components that render t() strings to subscribe to the store's
// `language` field so a live settings change re-renders them. The editor is
// not a React tree: its chrome (the properties card, fold chevrons, upload
// pills, transclusion cards) is DOM built by CM6 widgets, which re-render only
// when a transaction makes their decorations rebuild AND their eq() reports a
// different widget. So the editor subscribes the only way it can: Editor.tsx
// watches `language` and dispatches this effect, the decoration builders
// rebuild because the transaction carries an effect, and every widget that
// renders copy carries getLang() in its eq() so the DOM is actually replaced.
//
// Its own module (rather than livePreview.ts) so folding.ts can import it
// without pulling the live-preview graph in.

import { StateEffect } from "@codemirror/state";

/** Dispatched into every live view when the chrome language changes. */
export const languageChanged = StateEffect.define<null>();
