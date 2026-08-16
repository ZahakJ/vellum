// Templates — Obsidian's core Templates plugin, in Vellum.
//
// THE COMPATIBILITY PROMISE. A vault dragged over from Obsidian arrives with a
// Templates folder full of files written against that plugin's syntax, and
// those files must work here UNMODIFIED. So the placeholder set is Obsidian's:
// {{date}}, {{time}}, {{title}}, and the `{{date:FORMAT}}` / `{{time:FORMAT}}`
// forms with moment-style format tokens. Nothing here invents a syntax where
// one already exists, and an UNKNOWN placeholder is left exactly as written —
// `{{cursor}}`, `{{VALUE:x}}`, a Templater expression — because blanking a
// token this product does not implement destroys text the author typed and
// hides the fact that the template is doing something we did not do.
//
// TWO ADDITIONS, both because this product has a Hijri calendar setting that
// Obsidian does not: {{hdate}} and {{date:hijri}} render the Umm al-Qura date
// (shared/dates.ts owns the calendar choice, so a template and a blog card can
// never print two different calendars). {{Title}} is the title in Title Case —
// the one placeholder Obsidian's core plugin lacks and every template in the
// wild reaches for.
//
// FRONTMATTER HYGIENE is the other half of this module, and it is a fix, not a
// feature. A template whose frontmatter carries `id:` handed the SAME id to
// every note ever created from it — a duplicate-key bug that spreads silently
// through a vault and only shows up when something downstream keys on it. So:
// applying a template MINTS a fresh identifier rather than copying one, merges
// the template's frontmatter with whatever the target already has (the
// TARGET's own values win — its `publish:`, its `date:`, its `tags:` are facts
// about the note, not defaults), and never emits a key twice or a second `---`
// block.

import { getSettings } from "./api.ts";
import { getNumerals } from "./i18n.ts";
import { formatCalendarDate, HIJRI_CALENDAR, type DateCalendar } from "../shared/dates.ts";
import { toNumerals } from "../shared/numerals.ts";
import { noteTitleOf } from "../shared/noteFormat.ts";

// ── Settings ────────────────────────────────────────────────────────────────

/** What the template commands need from the instance. Fetched from
 *  /api/settings (admin-only, like the commands themselves) and cached — the
 *  picker opens on a keystroke and must not wait on a round trip it already
 *  made. `refreshTemplateSettings()` drops it after a settings save. */
export interface TemplateSettings {
  folder: string | null;
  /** True when `folder` was auto-detected rather than configured. */
  detected: boolean;
  defaultTemplate: string | null;
  locale: string;
  calendar: DateCalendar;
  lang: "en" | "ar";
}

let cached: TemplateSettings | null = null;
let inFlight: Promise<TemplateSettings> | null = null;

export async function templateSettings(): Promise<TemplateSettings> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = getSettings()
    .then((res) => {
      cached = {
        folder: res.effective.templatesFolder,
        detected: res.effective.templatesFolderDetected,
        defaultTemplate: res.effective.defaultTemplate,
        locale: res.effective.blogLocale,
        calendar: res.effective.dateCalendar,
        lang: res.effective.language,
      };
      inFlight = null;
      return cached;
    })
    .catch((err: unknown) => {
      inFlight = null;
      throw err;
    });
  return inFlight;
}

/** A settings save (or a vault event that could change auto-detection) may
 *  have moved the folder — ask again next time. */
export function refreshTemplateSettings(): void {
  cached = null;
}

// ── Placeholders ────────────────────────────────────────────────────────────

/** Everything a placeholder can be filled from. */
export interface TemplateVars {
  /** The note's title — its filename without the extension. For "New note
   *  from template…" that is the name just typed; for "Insert template…" it
   *  is the open note's own name. */
  title: string;
  /** When the template is being applied. Injectable so the same input always
   *  produces the same output in a test. */
  now: Date;
  locale: string;
  calendar: DateCalendar;
  lang: "en" | "ar";
}

/** Obsidian's defaults, and they are the compatibility contract: a template
 *  that writes `{{date}}` into a `date:` frontmatter line expects an ISO day,
 *  not a localized sentence. */
const DEFAULT_DATE_FORMAT = "YYYY-MM-DD";
const DEFAULT_TIME_FORMAT = "HH:mm";

/** `{{name}}` / `{{name:argument}}` — the argument runs to the closing braces,
 *  so a format may contain colons ("HH:mm:ss") and spaces ("D MMMM YYYY"). */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z][A-Za-z0-9_-]*)\s*(?::([^}]*))?\}\}/g;

/** Fill the placeholders in `text`. Unknown names come back verbatim. */
export function applyPlaceholders(text: string, vars: TemplateVars): string {
  return text.replace(PLACEHOLDER_RE, (whole, rawName: string, rawArg?: string) => {
    const name = rawName.toLowerCase();
    const arg = rawArg?.trim() ?? "";
    switch (name) {
      case "title":
        // `{{title}}` is the name as typed; `{{Title}}` is it in Title Case.
        // The distinction is the CASE THE AUTHOR WROTE, so it is read from
        // the raw name rather than the lowercased one.
        return rawName === "Title" ? titleCase(vars.title) : vars.title;
      case "date":
        return formatDateToken(vars, arg === "" ? DEFAULT_DATE_FORMAT : arg, "date");
      case "time":
        return formatDateToken(vars, arg === "" ? DEFAULT_TIME_FORMAT : arg, "time");
      case "hdate":
        // The Hijri date on its own, whatever the site calendar is set to —
        // a template that names the calendar is asking for it. Default shape
        // is the prose one, because that is what a Hijri date is FOR.
        return formatDateToken(vars, arg === "" ? "long" : arg, "date", "hijri");
      default:
        return whole as string; // not ours: leave the author's text alone
    }
  });
}

/** Title Case that leaves already-capitalized words alone ("iOS notes" →
 *  "iOS Notes", never "Ios Notes") and skips the small words English does. */
const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on",
  "or", "per", "the", "to", "vs", "via",
]);

function titleCase(value: string): string {
  const words = value.split(/(\s+)/);
  // THE LAST WORD IS EXEMPT TOO, and it is not a nicety — it is the rule every
  // style that has one (Chicago, AP, the New York Times) states in the same
  // breath as the first word. Without it a note the reader named "From
  // Template A" came back as "From Template a": the trailing "A" is not an
  // article there, it is the name of the thing, and `{{Title}}` had quietly
  // downcased a capital the author typed. Interior small words still fall —
  // "The Lord Of The Rings" → "The Lord of the Rings" is the whole point of
  // the list.
  const total = words.filter((w) => w !== "" && !/^\s+$/.test(w)).length;
  let index = 0;
  return words
    .map((word) => {
      if (/^\s+$/.test(word) || word === "") return word;
      const position = index++;
      const lower = word.toLowerCase();
      if (position > 0 && position < total - 1 && SMALL_WORDS.has(lower)) return lower;
      // Already carrying an inner capital? The author meant it.
      if (/[A-Z]/.test(word.slice(1))) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("");
}

/** Named formats, for readers who would rather not spell moment tokens. */
const NAMED_FORMATS: Record<string, { style: Intl.DateTimeFormatOptions; hijri?: boolean }> = {
  long: { style: { dateStyle: "long" } },
  full: { style: { dateStyle: "full" } },
  medium: { style: { dateStyle: "medium" } },
  short: { style: { dateStyle: "short" } },
  hijri: { style: { dateStyle: "long" }, hijri: true },
};

/**
 * WHERE THE SITE'S DATE SETTINGS APPLY, AND WHERE THEY DELIBERATELY DO NOT.
 *
 * A template's date lands in TWO kinds of place, and they want opposite
 * things. `{{date}}` in a `date:` frontmatter line or a daily-note heading is
 * a MACHINE VALUE: the indexer parses it, `YYYY-MM-DD` is what Obsidian means
 * by the token, and rendering it as `١٤٤٨-٠٢-١٣` (Eastern digits, Hijri year)
 * would leave the note with a date field nothing can read and a year off by
 * six centuries. `{{date:long}}` in a sentence is PROSE, and there the
 * instance's calendar and numerals are exactly the point.
 *
 * So: token formats are Gregorian and Western-digit, always — that is the
 * Obsidian compatibility contract. The NAMED formats (`long`, `full`,
 * `medium`, `short`) follow `settings.dateCalendar` and the numeral policy
 * through the same `formatCalendarDate()` the blog cards use. `{{hdate}}` and
 * `{{date:hijri}}` are Hijri whatever the setting says, because a template
 * that names the calendar is asking for it. A token format that includes a
 * month or weekday NAME is prose by construction, so its digits follow the
 * numeral policy too.
 */
function formatDateToken(
  vars: TemplateVars,
  format: string,
  kind: "date" | "time",
  /** The calendar a TOKEN format renders in. Gregorian for `{{date}}` and
   *  friends (the machine-value case above); Hijri only when the placeholder
   *  named it (`{{hdate}}`). */
  tokenCalendar: DateCalendar = "gregorian",
): string {
  const named = NAMED_FORMATS[format.toLowerCase()];
  if (named) {
    const calendar: DateCalendar = named.hijri || tokenCalendar === "hijri" ? "hijri" : vars.calendar;
    const style: Intl.DateTimeFormatOptions =
      kind === "time" ? { timeStyle: named.style.dateStyle } : named.style;
    return formatCalendarDate(vars.now, vars.locale, calendar, vars.lang, style);
  }
  const parts = dateParts(vars.now, tokenCalendar);
  const out = formatTokens(format, parts, vars.now, vars.locale, tokenCalendar);
  // A month or weekday NAME makes the output prose, and prose follows the
  // instance's numbering system. A pure numeric shape does not — see above.
  const prose = /MMMM|MMM|dddd|ddd/.test(format) || tokenCalendar === "hijri";
  return prose ? toNumerals(out, getNumerals()) : out;
}

interface DateFields {
  year: number;
  month: number; // 1-12
  day: number;
  hours: number;
  minutes: number;
  seconds: number;
  weekday: number; // 0 = Sunday
}

/** The date's fields in `calendar`. Gregorian reads them off the Date directly
 *  (local time, like Obsidian); Hijri asks Intl, because nothing in this
 *  codebase hand-rolls a lunar calendar (shared/dates.ts). */
function dateParts(now: Date, calendar: DateCalendar): DateFields {
  const base: DateFields = {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    day: now.getDate(),
    hours: now.getHours(),
    minutes: now.getMinutes(),
    seconds: now.getSeconds(),
    weekday: now.getDay(),
  };
  if (calendar === "gregorian") return base;
  try {
    const fmt = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
      calendar: HIJRI_CALENDAR,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      numberingSystem: "latn",
    });
    const fields: Record<string, string> = {};
    for (const part of fmt.formatToParts(now)) fields[part.type] = part.value;
    const year = Number.parseInt(fields.year ?? "", 10);
    const month = Number.parseInt(fields.month ?? "", 10);
    const day = Number.parseInt(fields.day ?? "", 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return base;
    return { ...base, year, month, day };
  } catch {
    return base; // an ICU build with no Umm al-Qura data: Gregorian, not blank
  }
}

/** Month / weekday names in the instance's locale and calendar. */
function name(
  now: Date,
  locale: string,
  calendar: DateCalendar,
  options: Intl.DateTimeFormatOptions,
): string {
  const opts: Intl.DateTimeFormatOptions = {
    ...options,
    ...(calendar === "gregorian" ? {} : { calendar: HIJRI_CALENDAR }),
  };
  try {
    return new Intl.DateTimeFormat(locale, opts).format(now);
  } catch {
    return new Intl.DateTimeFormat("en", options).format(now);
  }
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** moment-style tokens, longest first so `MMMM` never matches as `MM` + `MM`.
 *  `[literal text]` passes through untouched, exactly as moment does it. */
function formatTokens(
  format: string,
  parts: DateFields,
  source: Date,
  locale: string,
  calendar: DateCalendar,
): string {
  const hour12 = parts.hours % 12 === 0 ? 12 : parts.hours % 12;
  const table: [RegExp, () => string][] = [
    [/^YYYY/, () => String(parts.year).padStart(4, "0")],
    [/^YY/, () => pad(parts.year % 100)],
    [/^MMMM/, () => name(source, locale, calendar, { month: "long" })],
    [/^MMM/, () => name(source, locale, calendar, { month: "short" })],
    [/^MM/, () => pad(parts.month)],
    [/^M/, () => String(parts.month)],
    [/^DD/, () => pad(parts.day)],
    [/^D/, () => String(parts.day)],
    [/^dddd/, () => name(source, locale, calendar, { weekday: "long" })],
    [/^ddd/, () => name(source, locale, calendar, { weekday: "short" })],
    [/^HH/, () => pad(parts.hours)],
    [/^H/, () => String(parts.hours)],
    [/^hh/, () => pad(hour12)],
    [/^h/, () => String(hour12)],
    [/^mm/, () => pad(parts.minutes)],
    [/^m/, () => String(parts.minutes)],
    [/^ss/, () => pad(parts.seconds)],
    [/^s/, () => String(parts.seconds)],
    [/^A/, () => (parts.hours < 12 ? "AM" : "PM")],
    [/^a/, () => (parts.hours < 12 ? "am" : "pm")],
  ];
  let rest = format;
  let out = "";
  while (rest.length > 0) {
    if (rest.startsWith("[")) {
      const close = rest.indexOf("]");
      if (close > 0) {
        out += rest.slice(1, close);
        rest = rest.slice(close + 1);
        continue;
      }
    }
    let matched = false;
    for (const [re, render] of table) {
      const m = re.exec(rest);
      if (!m) continue;
      out += render();
      rest = rest.slice(m[0].length);
      matched = true;
      break;
    }
    if (!matched) {
      out += rest[0];
      rest = rest.slice(1);
    }
  }
  return out;
}

// ── Frontmatter ─────────────────────────────────────────────────────────────

export interface SplitNote {
  /** The frontmatter block's inner YAML, or null when there is none. */
  yaml: string | null;
  /** Everything after the block (or the whole file when there is none). */
  body: string;
}

/** Split a leading `---` frontmatter block off a markdown note. Tolerates CRLF
 *  and a `...` terminator, like every other frontmatter reader here. */
export function splitFrontmatter(src: string): SplitNote {
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { yaml: null, body: src };
  return { yaml: m[1], body: src.slice(m[0].length) };
}

/** One frontmatter entry, kept as RAW LINES. Values are not parsed and not
 *  re-serialized: a list, a nested map, a quoted string with a colon in it and
 *  a multi-line block scalar all survive a merge byte for byte, which a
 *  round-trip through a YAML parser would not guarantee. */
interface FmEntry {
  key: string;
  lines: string[];
}

/** Frontmatter YAML → ordered top-level entries. Anything before the first
 *  key (a stray comment) rides along on the entry that follows it. */
function parseEntries(yaml: string): FmEntry[] {
  const entries: FmEntry[] = [];
  let current: FmEntry | null = null;
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_][\w .-]*)\s*:(.*)$/.exec(line);
    if (m) {
      current = { key: m[1], lines: [line] };
      entries.push(current);
    } else if (current) {
      current.lines.push(line); // continuation: list item, block scalar, comment
    } else if (line.trim() !== "") {
      current = { key: "", lines: [line] };
      entries.push(current);
    }
  }
  return entries;
}

function serializeEntries(entries: FmEntry[]): string {
  return entries.flatMap((e) => e.lines).join("\n");
}

/** Keys whose value IDENTIFIES the note rather than describing it. Copying one
 *  from a template is the bug this module was written to fix: the owner's
 *  template carried `id:` and every note made from it inherited the same
 *  value. They are re-minted, not dropped — the template's author put the key
 *  there because their tooling wants it present. */
const IDENTITY_KEYS = /^(id|uuid|guid|permalink|slug)$/i;

/** A fresh identifier SHAPED LIKE THE ONE IT REPLACES. A template carrying a
 *  uuid gets a uuid; one carrying a 21-character nanoid gets 21 characters;
 *  one carrying a number gets a number. Guessing the shape matters: the whole
 *  reason the key is in the template is that something downstream parses it. */
export function mintIdentity(previous: string): string {
  const value = previous.trim().replace(/^["']|["']$/g, "");
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return randomUuid();
  }
  if (/^\d+$/.test(value)) {
    // A numeric id is almost always a timestamp at some resolution — the
    // template this was measured against carries a 16-digit one — so the
    // fresh value keeps the LENGTH: same sort order, same column width,
    // same thing whatever downstream is parsing it expects.
    const stamp = String(Date.now());
    if (value.length <= stamp.length) return stamp.slice(0, value.length);
    let out = stamp;
    while (out.length < value.length) out += String(Math.floor(Math.random() * 10));
    return out;
  }
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const length = value.length >= 6 && value.length <= 64 ? value.length : 16;
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Re-mint every identity key in a template's entries. A single-line `id: x`
 *  is rewritten in place, keeping its exact spacing and quoting style. */
function freshenIdentities(entries: FmEntry[]): FmEntry[] {
  return entries.map((entry) => {
    if (!IDENTITY_KEYS.test(entry.key) || entry.lines.length !== 1) return entry;
    const m = /^([A-Za-z0-9_][\w .-]*\s*:\s*)(.*)$/.exec(entry.lines[0]);
    if (!m) return entry;
    const raw = m[2].trim();
    if (raw === "") return entry; // an empty id: is a placeholder, not a value
    const quote = /^(["']).*\1$/.exec(raw)?.[1] ?? "";
    return { ...entry, lines: [`${m[1]}${quote}${mintIdentity(raw)}${quote}`] };
  });
}

/** Merge a template's frontmatter INTO a target's.
 *
 *  Three rules, and each one is a bug that would otherwise ship:
 *   - THE TARGET WINS on a shared key. Its `publish: true`, its `date:`, its
 *     `tags:` are facts about that note; the template's are defaults.
 *   - NO KEY TWICE. Emitting both copies produces YAML whose meaning depends
 *     on which parser reads it.
 *   - IDENTITY KEYS ARE MINTED, never copied.
 *
 *  Returns the merged inner YAML. */
export function mergeFrontmatter(targetYaml: string | null, templateYaml: string): string {
  const fromTemplate = freshenIdentities(parseEntries(templateYaml));
  if (targetYaml === null || targetYaml.trim() === "") return serializeEntries(fromTemplate);
  const target = parseEntries(targetYaml);
  const taken = new Set(target.map((e) => e.key.toLowerCase()).filter((k) => k !== ""));
  const added = fromTemplate.filter((e) => e.key !== "" && !taken.has(e.key.toLowerCase()));
  return serializeEntries([...target, ...added]);
}

/** One frontmatter key as the picker shows it: the key, and its value in
 *  plain reading form (no brackets, no quotes, a list as "a, b"). */
export interface TemplateProperty {
  key: string;
  value: string;
  /** `publish: true` — the one property that puts a note on a public site. */
  publishes: boolean;
}

/** A template's frontmatter, as rows for the picker's preview.
 *
 *  THE PICKER PREVIEWED THE BODY ONLY, and this module's own header says why
 *  that was the wrong half: "the difference between two of them is often three
 *  lines of frontmatter". Two templates whose bodies are both `# {{title}}`
 *  and whose blocks are `publish: true` and `publish: false` previewed
 *  IDENTICALLY — one line — so picking the wrong row silently published a note
 *  to a public website and the panel had shown nothing that could warn anyone.
 *
 *  Rows, not raw YAML: the picker is outside the editor, where DESIGN.md
 *  forbids rendering markup at the reader. */
export function templateProperties(yaml: string | null): TemplateProperty[] {
  if (yaml === null) return [];
  return parseEntries(yaml)
    .filter((e) => e.key !== "")
    .map((e) => {
      const first = e.lines[0];
      const colon = first.indexOf(":");
      let value = colon === -1 ? "" : first.slice(colon + 1).trim();
      if (value === "") {
        // A block list ("tags:" then "  - a") reads as "a, b".
        value = e.lines
          .slice(1)
          .map((l) => l.trim().replace(/^-\s*/, ""))
          .filter((l) => l !== "" && !l.startsWith("#"))
          .join(", ");
      }
      value = value.replace(/^\[(.*)\]$/s, "$1").trim(); // inline list → its items
      value = value.replace(/^(["'])(.*)\1$/s, "$2"); // quoted scalar → the scalar
      return {
        key: e.key,
        value,
        publishes: e.key.toLowerCase() === "publish" && /^(true|yes|on)$/i.test(value),
      };
    });
}

export interface AppliedTemplate {
  /** The full text to insert at the cursor (frontmatter never appears here —
   *  it is merged into the note's own block instead). */
  insert: string;
  /** The note's new full content, when the caller is replacing a whole file. */
  content: string;
}

/** Apply `templateSrc` to a note whose current content is `targetSrc`.
 *
 *  INSERTING INTO A NOTE THAT ALREADY HAS FRONTMATTER MUST MERGE, NOT STACK.
 *  A second `---` block halfway down a file is not frontmatter — it is a
 *  horizontal rule followed by text that looks like YAML — so the template's
 *  keys are folded into the note's existing block and only the template's BODY
 *  reaches the cursor. */
export function applyTemplate(
  templateSrc: string,
  targetSrc: string,
  vars: TemplateVars,
): AppliedTemplate {
  const filled = applyPlaceholders(templateSrc.replace(/\r\n/g, "\n"), vars);
  const template = splitFrontmatter(filled);
  // THE TARGET'S LINE ENDINGS ARE THE TARGET'S. This used to normalize
  // `targetSrc` to LF and hand that back as the note's new `content`, which
  // templateActions.ts writes straight to disk — so inserting a template into
  // an ordinary Windows or git-synced note silently rewrote every ending in
  // it. Nothing was lost, and the whole file was in the next diff.
  const nl = dominantNewline(targetSrc);
  const target = splitFrontmatter(targetSrc); // splitFrontmatter already tolerates CRLF
  const insert = toNewline(template.body, nl);
  if (template.yaml === null) {
    return { insert, content: targetSrc };
  }
  const merged = mergeFrontmatter(target.yaml, template.yaml);
  const block = merged.trim() === "" ? "" : toNewline(`---\n${merged}\n---\n`, nl);
  return { insert, content: `${block}${target.body}` };
}

/** The line ending a note is written in — the MAJORITY one, so a note with a
 *  single stray CRLF is still an LF note. An empty note (a fresh file) gets
 *  the platform-neutral LF this product writes everywhere else. */
function dominantNewline(src: string): string {
  const crlf = (src.match(/\r\n/g) ?? []).length;
  const lf = (src.match(/(?<!\r)\n/g) ?? []).length;
  return crlf > lf ? "\r\n" : "\n";
}

/** Re-end every line of `text` (which is LF throughout) with `nl`. */
function toNewline(text: string, nl: string): string {
  return nl === "\n" ? text : text.replace(/\r?\n/g, nl);
}

/** The title a template's `{{title}}` should see for a note at `path`. */
export function titleFor(path: string): string {
  return noteTitleOf(path);
}
