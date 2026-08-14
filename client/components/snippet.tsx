// Shared renderer for server search snippets (Sidebar + CommandPalette).
// Server snippets arrive HTML-escaped with matches wrapped in literal
// <mark>…</mark> tags; render them as React nodes — never innerHTML —
// undoing the escaping for the plain-text parts.

import type { ReactNode } from "react";

function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Defense-in-depth: the server already strips markdown, but drop any
 *  syntax that slips through (e.g. wikilink halves cut by a <mark>). */
function stripMdSyntax(text: string): string {
  return text
    .replace(
      // ![[embeds]] first: show the file/note basename, never a numeric
      // width alias like |220 and never the leading "!".
      /!\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g,
      (_m, target: string) => (target.split("/").pop() ?? target).trim(),
    )
    .replace(
      /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
      (_m, target: string, alias?: string) => (alias ?? target).trim(),
    )
    .replace(/!?\[\[|\]\]/g, "")
    .replace(/\*\*|__|~~/g, "")
    .replace(/`/g, "");
}

/** True when a server snippet carries no visible prose (empty note body,
 *  media-only note…) — callers skip the snippet row instead of rendering a
 *  blank line under the title. */
export function snippetIsEmpty(snippet: string): boolean {
  const text = stripMdSyntax(unescapeHtml(snippet.replace(/<\/?mark>/g, "")));
  return text.replace(/[\s…·—–-]+/g, "") === "";
}

export function renderSnippet(snippet: string): ReactNode {
  const parts = snippet.split(/<mark>(.*?)<\/mark>/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i}>{stripMdSyntax(unescapeHtml(part))}</mark>
    ) : (
      stripMdSyntax(unescapeHtml(part))
    ),
  );
}
