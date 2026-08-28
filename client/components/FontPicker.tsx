// The font picker: the Select, specialized for the one list in the product
// whose options ARE their own appearance.
//
// Three things make it different from every other list in the panel:
//
//   1. EACH OPTION IS DRAWN IN ITS OWN FACE, and the Arabic ones carry an
//      Arabic sample, because "Amiri" and "Lateef" set in the interface font
//      are two words a reader cannot choose between. The faces arrive from
//      /api/font-faces.css, a group at a time, as the picker opens (see
//      client/fontFaces.ts) — nothing is fetched to draw a menu until that
//      menu is on screen.
//   2. IT IS GROUPED and FILTERABLE. Twenty-seven catalog families plus the
//      operator's own uploads is past the length where a flat list is
//      readable, so: Text serif / Sans-serif / Monospace / Arabic / Your
//      fonts, with a filter field that types down the list.
//   3. "YOUR FONTS" IS OFFERED IN EVERY SLOT. The catalog's slot rules encode
//      knowledge about faces we chose; we have none about a file uploaded
//      this morning, and refusing an operator his own naskh face in the
//      Arabic slot because we could not prove it covers Arabic would be a
//      guess overruling the person who owns the font. The specimen block
//      above the pickers is the honest judge.

import { useCallback, useMemo } from "react";
import type { CustomFontInfo, FontCatalogEntry } from "../../shared/types.ts";
import { faceStack, loadFontFaces } from "../fontFaces.ts";
import { t } from "../i18n.ts";
import { Select, type SelectGroup, type SelectOption } from "./controls/Select.tsx";

/** The "no webfont" choice — the built-in system stacks (server SYSTEM). */
export const SYSTEM_FONT = "system";

// Specimens, deliberately NOT in i18n.ts, for the reason the panel's big
// specimen block gives: a Latin sample must stay Latin in an Arabic UI and an
// Arabic sample Arabic in an English one, or the row stops previewing the
// thing it is there to preview.
const ROW_LATIN = "The vault is open — 0123";
const ROW_ARABIC = "خَطُّ النَّسْخِ ١٢٣";
/** An uploaded face could be either script (or both), so its row shows both
 *  and lets the face answer for whichever it has. */
const ROW_MIXED = "Vellum — نموذج ١٢٣";

/** Which faces the picker offers.
 *  - `text` / `mono` / `arabic` are the INSTANCE's three slot rules
 *    (server/fonts.ts slotAllows), one picker per slot in Settings.
 *  - `any` is the DESIGN's rule, and it is deliberately looser. The instance's
 *    mono slot dresses CODE, so a proportional face in it is never what was
 *    meant; a design's heading has no such contract — its family control has
 *    already said which stack it stands in, and "set this console site's
 *    headings in JetBrains Mono" is precisely the design this release exists
 *    to make possible. The Arabic faces are offered for the same reason they
 *    are offered anywhere: a design written for an Arabic vault names naskh. */
type Slot = "text" | "mono" | "arabic" | "any";

interface FontPickerProps {
  slot: Slot;
  value: string;
  onChange: (id: string) => void;
  catalog: FontCatalogEntry[];
  custom: CustomFontInfo[];
  /** The row's label — the picker's accessible name. */
  label: string;
  /** What the "no webfont" row says. Defaults to the instance's own wording;
   *  a DESIGN means something different by it ("whatever this instance calls
   *  serif"), and a row that lies about what clearing it does is worse than no
   *  row. */
  systemLabel?: string;
}

/** The fallback stack behind each group's faces, so a row is legible before
 *  its face lands and stays legible if the fetch never succeeds. */
const FALLBACK: Record<string, string> = {
  serif: "var(--font-serif-system)",
  sans: "var(--font-ui-system)",
  mono: "var(--font-mono-system)",
  naskh: "var(--font-serif-system)",
  kufi: "var(--font-ui-system)",
  custom: "var(--font-ui-system)",
};

function catalogOption(font: FontCatalogEntry, group: string): SelectOption {
  const arabic = font.scripts.includes("arabic");
  return {
    value: font.id,
    // Family names are proper nouns: untranslated, like the theme ids.
    label: font.family,
    labelDir: "ltr",
    sample: arabic ? ROW_ARABIC : ROW_LATIN,
    sampleDir: arabic ? "rtl" : "ltr",
    face: faceStack(font.id, FALLBACK[group] ?? "var(--font-ui-system)"),
  };
}

function customOption(font: CustomFontInfo): SelectOption {
  return {
    value: font.id,
    label: font.family,
    labelDir: "ltr",
    note: font.format,
    sample: ROW_MIXED,
    face: faceStack(font.id, "var(--font-ui-system)"),
  };
}

export function FontPicker({ slot, value, onChange, catalog, custom, label, systemLabel }: FontPickerProps) {
  const groups: SelectGroup[] = useMemo(() => {
    const latin = catalog.filter((font) => !font.scripts.includes("arabic"));
    const arabic = catalog.filter((font) => font.scripts.includes("arabic"));
    const out: SelectGroup[] = [
      // No heading: it is the default, and a heading over one row that says
      // "no webfont" is a heading over nothing.
      { id: "system", label: "", options: [{ value: SYSTEM_FONT, label: systemLabel ?? t("fontSystem") }] },
    ];
    if (slot === "mono") {
      out.push({
        id: "mono",
        label: t("fontGroupMono"),
        options: latin.filter((font) => font.category === "mono").map((font) => catalogOption(font, "mono")),
      });
    } else if (slot === "any") {
      out.push(
        {
          id: "serif",
          label: t("fontGroupSerif"),
          options: latin.filter((font) => font.category === "serif").map((font) => catalogOption(font, "serif")),
        },
        {
          id: "sans",
          label: t("fontGroupSans"),
          options: latin.filter((font) => font.category === "sans").map((font) => catalogOption(font, "sans")),
        },
        {
          id: "mono",
          label: t("fontGroupMono"),
          options: latin.filter((font) => font.category === "mono").map((font) => catalogOption(font, "mono")),
        },
        {
          id: "naskh",
          label: t("fontGroupArabicNaskh"),
          options: arabic.filter((font) => font.category === "serif").map((font) => catalogOption(font, "naskh")),
        },
        {
          id: "kufi",
          label: t("fontGroupArabicModern"),
          options: arabic.filter((font) => font.category === "sans").map((font) => catalogOption(font, "kufi")),
        },
      );
    } else if (slot === "arabic") {
      out.push(
        {
          id: "naskh",
          label: t("fontGroupArabicNaskh"),
          options: arabic.filter((font) => font.category === "serif").map((font) => catalogOption(font, "naskh")),
        },
        {
          id: "kufi",
          label: t("fontGroupArabicModern"),
          options: arabic.filter((font) => font.category === "sans").map((font) => catalogOption(font, "kufi")),
        },
      );
    } else {
      out.push(
        {
          id: "serif",
          label: t("fontGroupSerif"),
          options: latin.filter((font) => font.category === "serif").map((font) => catalogOption(font, "serif")),
        },
        {
          id: "sans",
          label: t("fontGroupSans"),
          options: latin.filter((font) => font.category === "sans").map((font) => catalogOption(font, "sans")),
        },
      );
    }
    if (custom.length > 0) {
      out.push({ id: "custom", label: t("fontGroupCustom"), options: custom.map(customOption) });
    }
    return out.filter((group) => group.options.length > 0);
  }, [catalog, custom, slot, systemLabel]);

  /** A group's faces are fetched the first time that group is on screen —
   *  opening this picker, or filtering down to a group that was scrolled
   *  past. `loadFontFaces` de-duplicates, so this is safe to call freely. */
  const onVisibleGroups = useCallback(
    (ids: string[]) => {
      const wanted: string[] = [];
      for (const group of groups) {
        if (!ids.includes(group.id) || group.id === "system") continue;
        for (const option of group.options) wanted.push(option.value);
      }
      loadFontFaces(wanted);
    },
    [groups],
  );

  const current = useMemo(
    () => groups.flatMap((group) => group.options).find((option) => option.value === value),
    [groups, value],
  );

  return (
    <Select
      value={value}
      onChange={onChange}
      groups={groups}
      label={label}
      filter
      filterPlaceholder={t("fontFilter")}
      onVisibleGroups={onVisibleGroups}
      valueDir={value === SYSTEM_FONT ? undefined : "ltr"}
      // The trigger shows the CHOSEN face in itself too — the answer to "what
      // is set here" should not need the list to be reopened.
      valueFace={value === SYSTEM_FONT ? undefined : current?.face}
      triggerClass="s-ctl-select--face"
      // A grid of specimen cards, not a column of rows. Each option is two
      // lines tall — it has to be, the specimen IS the option — so against a
      // 340px popover a twenty-seven family catalog was judged three and a
      // half faces at a time. Two columns of specimen-led cards put a dozen on
      // screen at once, which is the difference between choosing a typeface
      // and scrolling past one.
      grid
    />
  );
}
