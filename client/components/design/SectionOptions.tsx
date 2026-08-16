// The per-section field editors: one branch per section kind, each returning
// the rows that kind actually has.
//
// It is a SWITCH rather than a field-descriptor table on purpose. The union in
// shared/design.ts has no `default` here, so adding a ninth section kind is a
// compile error in this file until it is given an editor — which is the whole
// reason the schema is a discriminated union. A descriptor table would have
// made a new kind reachable from the store and invisible in the panel.
//
// Every control is BOUNDED by the same numbers the server validates against
// (shared/design.ts), so the panel physically cannot compose a section the
// PUT would refuse. A designer that lets its owner build something the server
// rejects on save is a designer that teaches its owner not to trust Save.

import type { ReactNode } from "react";
import {
  HEADING_MAX,
  MARKDOWN_MAX,
  SUB_MAX,
  URL_MAX,
  type Section,
} from "../../../shared/design.ts";
import type { PostMeta } from "../../../shared/types.ts";
import { t } from "../../i18n.ts";
import { NumberInput, SegmentedControl, TextInput, Toggle } from "../controls/Fields.tsx";
import { Select, type SelectOption } from "../controls/Select.tsx";

/** The hero image field's placeholder. NOT copy and therefore not a dictionary
 *  entry: it is the two SHAPES the field accepts, and it must render exactly
 *  as it has to be typed — in both languages. Same argument as the settings
 *  panel's footer template. */
const IMAGE_PLACEHOLDER = "https:// or attachments/hero.jpg";

export interface SectionContext {
  /** Every published note, for the note picker. */
  notes: { title: string; path: string }[];
  /** Tags that actually occur, for the topic filter. */
  tags: string[];
  posts: PostMeta[];
}

/** One line under a section's name in the list — what the kind is FOR, not
 *  what it is called. */
export function sectionKindHint(kind: string): string {
  switch (kind) {
    case "hero":
      return t("dsoHintHero");
    case "richText":
      return t("dsoHintRichText");
    case "note":
      return t("dsoHintNote");
    case "postGrid":
      return t("dsoHintPostGrid");
    case "postList":
      return t("dsoHintPostList");
    case "topics":
      return t("dsoHintTopics");
    case "cta":
      return t("dsoHintCta");
    case "divider":
      return t("dsoHintDivider");
    default:
      return "";
  }
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="s-dsnc-opt">
      <div className="s-dsnc-opt__label">
        {label}
        {hint && <span className="s-dsnc-opt__hint">{hint}</span>}
      </div>
      <div className="s-dsnc-opt__ctl">{children}</div>
    </div>
  );
}

/** The one control the shared set does not have. Same classes as the shared
 *  input so it inherits the focus ring rather than growing its own. */
function TextArea({
  value,
  onChange,
  label,
  placeholder,
  maxLength,
  rows = 6,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  maxLength: number;
  rows?: number;
}) {
  return (
    <textarea
      className="s-ctl s-ctl-input s-dsnc-area"
      value={value}
      rows={rows}
      dir="auto"
      aria-label={label}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** A bounded integer. Non-numeric input is DROPPED rather than written as
 *  NaN, and the value is clamped to the schema's own bounds. */
function Count({
  value,
  onChange,
  label,
  unit,
  min,
  max,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  unit: string;
  min: number;
  max: number;
}) {
  return (
    <NumberInput
      value={String(value)}
      label={label}
      unit={unit}
      min={min}
      max={max}
      onChange={(raw) => {
        const n = Number(raw);
        if (raw.trim() === "" || !Number.isFinite(n)) return;
        onChange(Math.min(max, Math.max(min, Math.round(n))));
      }}
    />
  );
}

function noteOptions(ctx: SectionContext): SelectOption[] {
  return ctx.notes.map((note) => ({ value: note.path, label: note.title, note: note.path }));
}

function tagOptions(ctx: SectionContext): SelectOption[] {
  return [
    { value: "", label: t("dsoAllPosts") },
    ...ctx.tags.map((tag) => ({ value: tag, label: `#${tag}` })),
  ];
}

/** The heading row six kinds share. Empty means "no heading", which is a real
 *  choice and not a missing value — so the placeholder says so. */
function HeadingRow({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Row label={t("dsoHeading")} hint={t("dsoHeadingHint")}>
      <TextInput
        value={value}
        onChange={onChange}
        label={t("dsoHeading")}
        dir="auto"
        maxLength={HEADING_MAX}
        placeholder={t("dsoNoHeading")}
      />
    </Row>
  );
}

export function SectionOptions({
  section,
  ctx,
  onChange,
}: {
  section: Section;
  ctx: SectionContext;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  switch (section.kind) {
    case "hero": {
      const o = section;
      return (
        <>
          <Row label={t("dsoHeading")} hint={t("dsoHeroHeadingHint")}>
            <TextInput
              value={o.heading}
              onChange={(heading) => onChange({ heading })}
              label={t("dsoHeading")}
              dir="auto"
              maxLength={HEADING_MAX}
              placeholder={t("dsoHeroSiteName")}
            />
          </Row>
          <Row label={t("dsoSub")}>
            <TextInput
              value={o.sub}
              onChange={(sub) => onChange({ sub })}
              label={t("dsoSub")}
              dir="auto"
              maxLength={SUB_MAX}
            />
          </Row>
          <Row label={t("dsoImage")} hint={t("dsoImageHint")}>
            <TextInput
              value={o.image ?? ""}
              onChange={(v) => onChange({ image: v.trim() === "" ? null : v })}
              label={t("dsoImage")}
              dir="ltr"
              maxLength={URL_MAX}
              placeholder={IMAGE_PLACEHOLDER}
            />
          </Row>
          <Row label={t("dsoAlign")}>
            <SegmentedControl
              value={o.align}
              onChange={(align) => onChange({ align })}
              label={t("dsoAlign")}
              segments={[
                { value: "start", label: t("dsoAlignStart") },
                { value: "center", label: t("dsoAlignCenter") },
              ]}
            />
          </Row>
          <Row label={t("dsoHeight")}>
            <SegmentedControl
              value={o.height}
              onChange={(height) => onChange({ height })}
              label={t("dsoHeight")}
              segments={[
                { value: "short", label: t("dsoHeightShort") },
                { value: "tall", label: t("dsoHeightTall") },
              ]}
            />
          </Row>
        </>
      );
    }

    case "richText": {
      const o = section;
      return (
        <>
          <Row label={t("dsoMarkdown")} hint={t("dsoMarkdownHint")}>
            <TextArea
              value={o.markdown}
              onChange={(markdown) => onChange({ markdown })}
              label={t("dsoMarkdown")}
              maxLength={MARKDOWN_MAX}
            />
          </Row>
          <Row label={t("dsoAlign")}>
            <SegmentedControl
              value={o.align}
              onChange={(align) => onChange({ align })}
              label={t("dsoAlign")}
              segments={[
                { value: "start", label: t("dsoAlignStart") },
                { value: "center", label: t("dsoAlignCenter") },
              ]}
            />
          </Row>
        </>
      );
    }

    case "note": {
      const o = section;
      return (
        <>
          <Row label={t("dsoNote")} hint={t("dsoNoteHint")}>
            <Select
              value={o.note}
              onChange={(note) => onChange({ note })}
              options={noteOptions(ctx)}
              label={t("dsoNote")}
              filter={ctx.notes.length > 8}
              filterPlaceholder={t("dsoFilterNotes")}
            />
          </Row>
          <HeadingRow value={o.heading} onChange={(heading) => onChange({ heading })} />
          <Row label={t("dsoExcerpt")} hint={t("dsoExcerptHint")}>
            <Toggle
              value={o.excerpt}
              onChange={(excerpt) => onChange({ excerpt })}
              label={t("dsoExcerpt")}
              onLabel={t("dsoOn")}
              offLabel={t("dsoOff")}
            />
          </Row>
        </>
      );
    }

    case "postGrid": {
      const o = section;
      return (
        <>
          <HeadingRow value={o.heading} onChange={(heading) => onChange({ heading })} />
          <Row label={t("dsoTag")}>
            <Select
              value={o.tag}
              onChange={(tag) => onChange({ tag })}
              options={tagOptions(ctx)}
              label={t("dsoTag")}
              filter={ctx.tags.length > 8}
              filterPlaceholder={t("dsoFilterTags")}
            />
          </Row>
          <Row label={t("dsoLimit")}>
            <Count
              value={o.limit}
              onChange={(limit) => onChange({ limit })}
              label={t("dsoLimit")}
              unit={t("dsoPosts")}
              min={1}
              max={60}
            />
          </Row>
          <Row label={t("dsoColumns")}>
            <SegmentedControl
              value={String(o.columns)}
              onChange={(v) => onChange({ columns: Number(v) })}
              label={t("dsoColumns")}
              segments={[
                { value: "1", label: "1" },
                { value: "2", label: "2" },
                { value: "3", label: "3" },
                { value: "4", label: "4" },
              ]}
            />
          </Row>
          <Row label={t("dsoShowBanner")}>
            <Toggle
              value={o.showBanner}
              onChange={(showBanner) => onChange({ showBanner })}
              label={t("dsoShowBanner")}
              onLabel={t("dsoOn")}
              offLabel={t("dsoOff")}
            />
          </Row>
          <Row label={t("dsoShowExcerpt")}>
            <Toggle
              value={o.showExcerpt}
              onChange={(showExcerpt) => onChange({ showExcerpt })}
              label={t("dsoShowExcerpt")}
              onLabel={t("dsoOn")}
              offLabel={t("dsoOff")}
            />
          </Row>
          <Row label={t("dsoShowDate")}>
            <Toggle
              value={o.showDate}
              onChange={(showDate) => onChange({ showDate })}
              label={t("dsoShowDate")}
              onLabel={t("dsoOn")}
              offLabel={t("dsoOff")}
            />
          </Row>
        </>
      );
    }

    case "postList": {
      const o = section;
      return (
        <>
          <HeadingRow value={o.heading} onChange={(heading) => onChange({ heading })} />
          <Row label={t("dsoTag")}>
            <Select
              value={o.tag}
              onChange={(tag) => onChange({ tag })}
              options={tagOptions(ctx)}
              label={t("dsoTag")}
              filter={ctx.tags.length > 8}
              filterPlaceholder={t("dsoFilterTags")}
            />
          </Row>
          <Row label={t("dsoLimit")}>
            <Count
              value={o.limit}
              onChange={(limit) => onChange({ limit })}
              label={t("dsoLimit")}
              unit={t("dsoPosts")}
              min={1}
              max={200}
            />
          </Row>
          <Row label={t("dsoShowExcerpt")}>
            <Toggle
              value={o.showExcerpt}
              onChange={(showExcerpt) => onChange({ showExcerpt })}
              label={t("dsoShowExcerpt")}
              onLabel={t("dsoOn")}
              offLabel={t("dsoOff")}
            />
          </Row>
          <Row label={t("dsoShowDate")}>
            <Toggle
              value={o.showDate}
              onChange={(showDate) => onChange({ showDate })}
              label={t("dsoShowDate")}
              onLabel={t("dsoOn")}
              offLabel={t("dsoOff")}
            />
          </Row>
        </>
      );
    }

    case "topics": {
      const o = section;
      return (
        <>
          <HeadingRow value={o.heading} onChange={(heading) => onChange({ heading })} />
          <Row label={t("dsoLimit")}>
            <Count
              value={o.limit}
              onChange={(limit) => onChange({ limit })}
              label={t("dsoLimit")}
              unit={t("dsoTopics")}
              min={1}
              max={40}
            />
          </Row>
        </>
      );
    }

    case "cta": {
      const o = section;
      return (
        <>
          <HeadingRow value={o.heading} onChange={(heading) => onChange({ heading })} />
          <Row label={t("dsoBody")}>
            <TextArea
              value={o.body}
              onChange={(body) => onChange({ body })}
              label={t("dsoBody")}
              maxLength={SUB_MAX}
              rows={3}
            />
          </Row>
          <Row label={t("dsoButton")}>
            <TextInput
              value={o.label}
              onChange={(label) => onChange({ label })}
              label={t("dsoButton")}
              dir="auto"
              maxLength={HEADING_MAX}
            />
          </Row>
          <Row label={t("dsoUrl")} hint={t("dsoUrlHint")}>
            <TextInput
              value={o.url}
              onChange={(url) => onChange({ url })}
              label={t("dsoUrl")}
              dir="ltr"
              maxLength={URL_MAX}
              // The schema takes site-relative or https only; anything else is
              // refused on save, so the field says what it takes.
              invalid={o.url !== "" && !/^(\/|https:\/\/)/.test(o.url)}
              placeholder="/topic/essays"
            />
          </Row>
        </>
      );
    }

    case "divider": {
      const o = section;
      return (
        <>
          <Row label={t("dsoStyle")}>
            <SegmentedControl
              value={o.style}
              onChange={(style) => onChange({ style })}
              label={t("dsoStyle")}
              segments={[
                { value: "rule", label: t("dsoStyleRule") },
                { value: "dots", label: t("dsoStyleDots") },
                { value: "blank", label: t("dsoStyleBlank") },
              ]}
            />
          </Row>
          <Row label={t("dsoSpace")}>
            <Count
              value={o.space}
              onChange={(space) => onChange({ space })}
              label={t("dsoSpace")}
              unit="px"
              min={0}
              max={240}
            />
          </Row>
        </>
      );
    }
  }
}
