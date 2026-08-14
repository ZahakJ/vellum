// Pure callout definitions (type→group map, icons, title regex) shared by the
// live-preview plugin (editor chunk) and the reading-view renderer
// (first-paint chunk). No CodeMirror imports here.

/** Obsidian type/alias → color-token group. */
const TYPE_GROUP: Record<string, string> = {
  note: "note",
  abstract: "abstract",
  summary: "abstract",
  tldr: "abstract",
  info: "info",
  todo: "todo",
  tip: "tip",
  hint: "tip",
  important: "tip",
  success: "success",
  check: "success",
  done: "success",
  question: "question",
  help: "question",
  faq: "question",
  warning: "warning",
  caution: "warning",
  attention: "warning",
  failure: "failure",
  fail: "failure",
  missing: "failure",
  danger: "danger",
  error: "danger",
  bug: "bug",
  example: "example",
  quote: "quote",
  cite: "quote",
};

/** 14px stroke icons per group (lucide-style paths, stroke=currentColor). */
const GROUP_ICON: Record<string, string> = {
  note: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  abstract: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  todo: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  tip: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  success: '<path d="M20 6 9 17l-5-5"/>',
  question: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
  warning: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3z"/><path d="M12 9v4M12 17h.01"/>',
  failure: '<path d="M18 6 6 18M6 6l12 12"/>',
  danger: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  bug: '<path d="m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6z"/><path d="M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  example: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  quote: '<path d="M17 6H3M21 12H8M21 18H8"/>',
};

const TITLE_RE = /^(\s*>\s*)\[!(\w+)\]([+-]?)\s*(.*)$/;

// ── Shared with the reading-view renderer (client/reading/render.ts) ────────

/** Matches a callout title line INCLUDING its "> " prefix. No `g` flag. */
export const CALLOUT_TITLE_RE = TITLE_RE;

/** Obsidian callout type (or alias) → color/icon group name. */
export function calloutGroup(type: string): string {
  return TYPE_GROUP[type.toLowerCase()] ?? "note";
}

/** Inner SVG path markup for a callout group's icon. */
export function calloutIconSvg(group: string): string {
  return GROUP_ICON[group] ?? GROUP_ICON.note;
}

