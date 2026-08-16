// THE DESIGN'S COLOUR, CHOSEN BY LOOKING AT IT.
//
// This control used to be a `<Select>` whose options were `["", ...customThemes]`
// — the instance's HAND-BUILT themes and nothing else. On a fresh instance
// there are none, so the menu opened with exactly one row ("Site default"),
// the control's own value rendered as a raw slug (`iron-gall`) with no label
// and no colour, and not one of the fifteen built-in themes was reachable.
// The field decides what EVERY first-time visitor sees; it was inoperable.
//
// Two rules, and the product already states both:
//
//  1. A THEME IS CHOSEN BY LOOKING AT IT (CONTRACTS: ThemeBuilder). Fifteen
//     pigment nouns in a dropdown say nothing about what any of them looks
//     like, and a native popover cannot be painted anyway. So: cards, each in
//     ITS OWN palette, from the CONSTANT `--swatch-<id>-*` tokens — the same
//     `[data-theme-swatch]` hook the theme picker and the builder use, so a
//     retuned theme moves here with no second table to update.
//  2. "SITE DEFAULT" IS A REAL CHOICE, not an empty row. A design that names
//     no theme lets the reader's own preference through untouched, which is a
//     decision an author makes on purpose — so it is the first card, drawn as
//     the room the app is standing in rather than as a blank.
//
// Custom themes appear after the fifteen, painted from their OWN overrides
// where they set one and from their base's swatch where they do not — a custom
// theme is a sparse layer over a built-in (shared/customTheme.ts), and that is
// exactly what its card should say.

import type { CSSProperties } from "react";
import type { CustomTheme } from "../../../shared/customTheme.ts";
import { THEMES, type Theme } from "../../../shared/themes.ts";
import { t } from "../../i18n.ts";
import { THEME_LABELS } from "../../themes.ts";

export interface DesignThemeCardsProps {
  /** The design's theme: a built-in id, `custom:<slug>`, or null for "let the
   *  reader's own preference through". */
  value: string | null;
  onChange: (theme: string | null) => void;
  /** The instance's own custom themes, from the admin overview. */
  custom: readonly CustomTheme[];
  disabled?: boolean;
}

/** A custom theme's card colours: its own overrides where it has them, its
 *  base's swatch where it does not. `var(--swatch-<base>-…)` is a constant in
 *  tokens.css, so the fallback is the base's identity rather than whatever
 *  theme the operator happens to be wearing. */
function customSwatch(theme: CustomTheme): CSSProperties {
  const pick = (token: string, fallback: string): string =>
    theme.tokens[token] ?? `var(--swatch-${theme.base}-${fallback})`;
  return {
    "--sw-bg": pick("--bg", "bg"),
    "--sw-text": pick("--text", "text"),
    "--sw-accent": pick("--accent", "accent"),
  } as CSSProperties;
}

function Card({
  on,
  label,
  note,
  swatch,
  style,
  disabled,
  onClick,
}: {
  on: boolean;
  label: string;
  note?: string;
  /** Built-in id for `[data-theme-swatch]`, or undefined when `style` paints
   *  the trio directly (a custom theme, or the inherit card). */
  swatch?: Theme;
  style?: CSSProperties;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      className={`s-dsgtc__card${on ? " s-dsgtc__card--on" : ""}`}
      onClick={onClick}
    >
      <span className="s-dsgtc__paint" data-theme-swatch={swatch} style={style} aria-hidden="true">
        <span className="s-dsgtc__rule" />
        <span className="s-dsgtc__chip" />
      </span>
      <span className="s-dsgtc__name" dir="auto">
        {label}
      </span>
      {note !== undefined && <span className="s-dsgtc__note">{note}</span>}
    </button>
  );
}

export default function DesignThemeCards({
  value,
  onChange,
  custom,
  disabled = false,
}: DesignThemeCardsProps) {
  return (
    <div className="s-dsgtc" role="radiogroup" aria-label={t("designTheme")}>
      {/* The inherit card carries NO swatch attribute, so `--sw-*` fall
          through to the live document's own tokens: "whatever the reader
          already chose", drawn as the room this panel is standing in. */}
      <Card
        on={value === null || value === ""}
        label={t("designThemeInherit")}
        note={t("designThemeInheritNote")}
        style={
          {
            "--sw-bg": "var(--bg)",
            "--sw-text": "var(--text)",
            "--sw-accent": "var(--accent)",
          } as CSSProperties
        }
        disabled={disabled}
        onClick={() => onChange(null)}
      />
      {THEMES.map((id) => (
        <Card
          key={id}
          on={value === id}
          label={t(THEME_LABELS[id].name)}
          swatch={id}
          disabled={disabled}
          onClick={() => onChange(id)}
        />
      ))}
      {custom.map((theme) => (
        <Card
          key={theme.id}
          on={value === `custom:${theme.id}`}
          label={theme.name}
          note={t(THEME_LABELS[theme.base].name)}
          style={customSwatch(theme)}
          disabled={disabled}
          onClick={() => onChange(`custom:${theme.id}`)}
        />
      ))}
    </div>
  );
}
