// Pure note-metadata helpers (tag regex, frontmatter properties parser)
// shared by the live-preview plugin (editor chunk) and the reading-view
// renderer (first-paint chunk). No CodeMirror imports here.

import { bannerSrc, resolveBanner } from "../banner.ts";
import { localeNum, t, tf } from "../i18n.ts";
import { layoutBadge, siteTextLayout } from "../textLayout.ts";
import { parseNoteLayout, resolveNoteLayout } from "../../shared/textLayout.ts";

export interface BannerElOpts {
  /** The note the value was written in — the third rung of the resolution
   *  ladder ("cover.png beside the note"). Null for a value that belongs to
   *  no note (a settings image). */
  notePath?: string | null;
  /** True for a session that may EDIT this note. It decides what a banner
   *  that resolves to nothing looks like, and it is the whole rule below. */
  admin?: boolean;
}

/** Frontmatter `banner:` → hero image element (editor + reading view share the
 *  DOM shape; callers pass their prefix class).
 *
 *  A BANNER THAT CANNOT LOAD MUST NOT ERASE ITSELF. This function used to do
 *  exactly that — `img.onerror → wrap.remove()` — which made a typo'd path and
 *  no banner at all render identically: the author sets `banner: cover.png`,
 *  sees nothing appear, and has no way to tell whether the feature is broken,
 *  the file is missing, or the value never took. Silent failure on the one
 *  surface whose whole job is to show you your own file.
 *
 *  So the rule is split by audience, the same way the broken-embed placeholder
 *  is: an ADMIN gets the dashed "missing image" card naming the value that
 *  failed, with "Set banner…" beside it — the fix is one click from the
 *  symptom. A VISITOR gets nothing, because a stranger cannot act on it and a
 *  dashed box on a published article is the author's mess on the reader's
 *  page. */
export function buildBannerEl(
  value: string,
  className: string,
  opts: BannerElOpts = {},
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = className;
  const admin = opts.admin === true;
  const missing = (): void => {
    if (!admin) {
      wrap.remove();
      return;
    }
    wrap.classList.add(`${className}--missing`);
    wrap.replaceChildren(missingBannerCard(value, className));
  };
  const paint = (path: string | null): void => {
    if (path === null) {
      missing();
      return;
    }
    const img = document.createElement("img");
    img.className = `${className}__img`;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    // The resolution said the file EXISTS; a load failure here is a byte-level
    // problem (a truncated upload, a 403) and gets the same honest card.
    img.addEventListener("error", () => missing(), { once: true });
    img.src = bannerSrc(path);
    wrap.replaceChildren(img);
  };
  const hit = resolveBanner(value, opts.notePath ?? null);
  if (typeof hit === "string" || hit === null) paint(hit);
  else void hit.then(paint); // in flight: the hero appears when it lands
  return wrap;
}

/** The admin-only "this banner names nothing" card: the same dashed language
 *  as the broken-embed placeholder, the failing value spelled out (it is the
 *  one fact the author needs — usually a typo they can see the moment it is on
 *  screen), and the button that fixes it. */
function missingBannerCard(value: string, className: string): HTMLElement {
  const box = document.createElement("div");
  box.className = `${className}__missing`;
  const icon = document.createElement("span");
  icon.className = `${className}__missingicon`;
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
  const label = document.createElement("span");
  label.className = `${className}__missinglabel`;
  label.textContent = t("bannerMissing");
  const which = document.createElement("span");
  which.className = `${className}__missingname`;
  // Note-derived text inside chrome takes its OWN direction.
  which.dir = "auto";
  which.textContent = value;
  which.title = tf("bannerMissingTitle", { value });
  const action = document.createElement("button");
  action.type = "button";
  action.className = `${className}__missingaction`;
  action.dataset.action = "set-banner";
  action.textContent = t("setBannerAction");
  action.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    window.dispatchEvent(new CustomEvent("vellum:set-banner"));
  });
  box.append(icon, label, which, action);
  return box;
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

  // The header ROW is the click target, but it is not the control: it also
  // carries tag pills and the "Set banner…" button, and a role="button" with
  // focusable things inside it is a widget a screen reader cannot describe
  // (and a keyboard cannot get past). So the row stays a plain container and
  // the chevron+label — the part that actually means "expand" — is the
  // control. Clicking anywhere on the row still toggles, as before.
  const head = document.createElement("div");
  head.className = `${p}__head`;
  head.title = t("toggleProperties");

  const chevron = document.createElement("span");
  chevron.className = `${p}__chevron`;
  chevron.setAttribute("aria-hidden", "true");
  chevron.innerHTML =
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';
  const label = document.createElement("span");
  label.className = `${p}__label`;
  label.textContent = `${t("properties")} · ${localeNum(rows.length)}`;
  const trigger = document.createElement("span");
  trigger.className = `${p}__trigger`;
  trigger.setAttribute("role", "button");
  trigger.tabIndex = 0;
  trigger.setAttribute("aria-expanded", String(!collapsed));
  trigger.append(chevron, label);
  head.append(trigger);

  // A NOTE THAT LAYS ITSELF OUT DIFFERENTLY SAYS SO, HERE FIRST.
  // `dir:` and `align:` are frontmatter keys, so the properties card is where
  // a reader looks for them — and the expanded card already lists them as raw
  // rows. What the raw rows cannot say is that the value is IN FORCE and that
  // it disagrees with the site: the chip is that sentence, it survives the
  // collapsed state (which is the default), and its tooltip names the source
  // of both halves. The status bar prints the same words from the same
  // module. Nothing is drawn when the note agrees with the site default —
  // a badge that is always lit is a badge nobody reads.
  const badge = layoutBadge(resolveNoteLayout(siteTextLayout(), parseNoteLayout(yaml)));
  if (badge) {
    const chip = document.createElement("span");
    chip.className = `${p}__layout`;
    chip.textContent = badge.text;
    chip.title = badge.title;
    // Outside the isolate rule's remit: these are localized chrome WORDS, not
    // note-derived text, so they take the chrome's direction like every other
    // label in the card's header.
    head.appendChild(chip);
  }

  if (tags.length > 0) {
    const inline = document.createElement("span");
    inline.className = `${p}__headtags`;
    for (const value of tags) inline.appendChild(opts.makeTag(value));
    head.appendChild(inline);
  }
  if (opts.action) head.appendChild(opts.action);

  const toggle = (): void => {
    const nowCollapsed = box.classList.toggle(`${p}--collapsed`);
    trigger.setAttribute("aria-expanded", String(!nowCollapsed));
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
    // Key and values are note-derived text inside chrome, so each takes its
    // OWN direction (CONTRACTS, "Localization & RTL") — and each value is a
    // separate isolate, because `aliases: [مقال, Essay]` is a list of runs,
    // not one string: joined into a single text node an RTL base direction
    // reorders the runs around the commas and the list stops matching what
    // the file says.
    k.dir = "auto";
    k.textContent = key;
    row.appendChild(k);
    const v = document.createElement("span");
    v.className = `${p}__value`;
    if (key.toLowerCase() === "tags") {
      for (const value of values) v.appendChild(opts.makeTag(value));
    } else {
      values.forEach((value, i) => {
        if (i > 0) v.appendChild(document.createTextNode(", "));
        const one = document.createElement("bdi");
        one.textContent = value;
        v.appendChild(one);
      });
    }
    row.appendChild(v);
    body.appendChild(row);
  }
  box.appendChild(body);
  return box;
}
