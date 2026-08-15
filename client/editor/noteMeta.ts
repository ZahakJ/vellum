// Pure note-metadata helpers (tag regex, frontmatter properties parser)
// shared by the live-preview plugin (editor chunk) and the reading-view
// renderer (first-paint chunk). No CodeMirror imports here.

import { bannerSrc } from "../banner.ts";

/** Frontmatter `banner:` → hero image element (editor + reading view share
 *  the DOM shape; callers pass their prefix class). Unloadable images remove
 *  themselves — no broken-image furniture above a note. */
export function buildBannerEl(value: string, className: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = className;
  const img = document.createElement("img");
  img.className = `${className}__img`;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("error", () => wrap.remove(), { once: true });
  img.src = bannerSrc(value);
  wrap.appendChild(img);
  return wrap;
}

/** Inline #tag matcher (unicode letters, digits, _, /, -). */
export const TAG_RE = /(^|[\s([{])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

/** Parse simple `key: value` / list frontmatter into display rows. */
export function parseProps(yaml: string): { key: string; values: string[] }[] {
  const rows: { key: string; values: string[] }[] = [];
  const lines = yaml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^([\w-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = m[2].trim();
    const values: string[] = [];
    const clean = (s: string) => s.trim().replace(/^["'#]+|["']+$/g, "");
    if (inline.startsWith("[")) {
      for (const part of inline.replace(/^\[|\]$/g, "").split(",")) {
        if (clean(part)) values.push(clean(part));
      }
    } else if (inline) {
      values.push(clean(inline));
    } else {
      for (let j = i + 1; j < lines.length; j++) {
        const item = /^[ \t]*-[ \t]+(.+)$/.exec(lines[j]);
        if (!item) break;
        if (clean(item[1])) values.push(clean(item[1]));
      }
    }
    rows.push({ key: m[1], values });
  }
  return rows;
}

// ── Properties card (shared DOM builder: live preview + reading view) ───────

const PROPS_KEY = "vellum.properties";

/** Card expand/collapse preference (collapsed unless the user expanded). */
export function propsExpanded(): boolean {
  try {
    return localStorage.getItem(PROPS_KEY) === "expanded";
  } catch {
    return false;
  }
}

export function setPropsExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(PROPS_KEY, expanded ? "expanded" : "collapsed");
  } catch {
    // storage unavailable — the preference just won't persist
  }
}

/** Machine bookkeeping keys (publish tooling, dg-* sync fields, numeric ids,
 *  uuid values) — sorted after the human keys and rendered faint. */
export function isMachineKey(key: string, values: string[]): boolean {
  if (/^dg[-_]/i.test(key)) return true;
  if (/^(publish|published|permalink|uuid|guid|id|created-ts|updated-ts)$/i.test(key)) return true;
  if (/^\d+$/.test(key)) return true;
  if (values.length === 1 && /^\d{8,}$/.test(values[0])) return true;
  if (
    values.length === 1 &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values[0])
  ) {
    return true;
  }
  return false;
}

export interface PropsCardOpts {
  /** BEM block prefix: "cm-s-props" (editor) / "s-rv-props" (reading view). */
  prefix: string;
  /** Build one clickable #tag pill (both callers style/wire their own).
   *  The returned element must carry a `data-tag` attribute so header
   *  clicks on a pill don't also toggle the card. */
  makeTag: (value: string) => HTMLElement;
  /** Optional trailing header action (the editor's "Set banner…" button).
   *  Must carry `data-tag` (or stop propagation) so it doesn't toggle. */
  action?: HTMLElement;
}

/** Frontmatter → collapsible properties card. Collapsed (the default) it is a
 *  slim single row: chevron + "Properties · N" + the tags inline; expanded it
 *  lists every key, machine keys last and faint. The preference persists in
 *  localStorage ("vellum.properties"). Returns null for empty frontmatter. */
export function buildPropsCard(yaml: string, opts: PropsCardOpts): HTMLElement | null {
  const rows = parseProps(yaml);
  if (rows.length === 0) return null;
  const p = opts.prefix;
  const ordered = [
    ...rows.filter((r) => !isMachineKey(r.key, r.values)),
    ...rows.filter((r) => isMachineKey(r.key, r.values)),
  ];
  const tags = rows.find((r) => r.key.toLowerCase() === "tags")?.values ?? [];

  const box = document.createElement("div");
  const collapsed = !propsExpanded();
  box.className = collapsed ? `${p} ${p}--collapsed` : p;

  const head = document.createElement("div");
  head.className = `${p}__head`;
  head.setAttribute("role", "button");
  head.tabIndex = 0;
  head.setAttribute("aria-expanded", String(!collapsed));
  head.title = "Toggle properties";

  const chevron = document.createElement("span");
  chevron.className = `${p}__chevron`;
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML =
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  const label = document.createElement("span");
  label.className = `${p}__label`;
  label.textContent = `Properties · ${rows.length}`;
  head.append(chevron, label);

  if (tags.length > 0) {
    const inline = document.createElement("span");
    inline.className = `${p}__headtags`;
    for (const value of tags) inline.appendChild(opts.makeTag(value));
    head.appendChild(inline);
  }
  if (opts.action) head.appendChild(opts.action);

  const toggle = (): void => {
    const nowCollapsed = box.classList.toggle(`${p}--collapsed`);
    head.setAttribute("aria-expanded", String(!nowCollapsed));
    setPropsExpanded(!nowCollapsed);
  };
  head.addEventListener("click", (ev) => {
    if ((ev.target as HTMLElement).closest("[data-tag], [data-action]")) return; // pill/action wins
    ev.preventDefault();
    ev.stopPropagation();
    toggle();
  });
  head.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      ev.stopPropagation();
      toggle();
    }
  });
  box.appendChild(head);

  const body = document.createElement("div");
  body.className = `${p}__body`;
  for (const { key, values } of ordered) {
    const row = document.createElement("div");
    row.className = isMachineKey(key, values)
      ? `${p}__row ${p}__row--machine`
      : `${p}__row`;
    const k = document.createElement("span");
    k.className = `${p}__key`;
    k.textContent = key;
    row.appendChild(k);
    const v = document.createElement("span");
    v.className = `${p}__value`;
    if (key.toLowerCase() === "tags") {
      for (const value of values) v.appendChild(opts.makeTag(value));
    } else {
      v.textContent = values.join(", ");
    }
    row.appendChild(v);
    body.appendChild(row);
  }
  box.appendChild(body);
  return box;
}
