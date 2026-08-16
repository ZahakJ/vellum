// The rest of the set: the four controls that are not a list.
//
// One rule holds them together, and it is the reason they live in one file
// instead of being typed inline where they are used: **a control's DISABLED
// state is drawn by us, not by the user agent.** With Backup and sync switched
// off, the panel used to show three greyed native selects beside two text
// fields that were not greyed at all — the browser dims a disabled select and
// leaves a disabled input alone, so one state wore two faces in one column and
// "main" in the branch field read as a live value. Every control below takes
// `disabled` through the SAME class, and `.s-ctl:disabled` in controls.css is
// the single place that decides what "off" looks like.

import type { ChangeEvent } from "react";

// ---------------------------------------------------------------- Toggle

interface ToggleProps {
  /** Two-state only. A control with an "inherit" third state is a
   *  SegmentedControl — a switch that can be neither on nor off is a lie. */
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
  /** The words beside the switch ("On" / "Off"), so the state is readable and
   *  not only visible: a lit track is a convention, a word is not. */
  onLabel: string;
  offLabel: string;
}

export function Toggle({ value, onChange, disabled, label, onLabel, offLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-label={label}
      disabled={disabled}
      className={`s-ctl s-ctl-toggle${value ? " s-ctl-toggle--on" : ""}`}
      onClick={() => onChange(!value)}
    >
      <span className="s-ctl-toggle__track" aria-hidden="true">
        <span className="s-ctl-toggle__knob" />
      </span>
      <span className="s-ctl-toggle__label">{value ? onLabel : offLabel}</span>
    </button>
  );
}

// ------------------------------------------------------- SegmentedControl

export interface Segment {
  value: string;
  label: string;
  /** Muted second line inside the segment — "(on)" under "Default". */
  note?: string;
}

interface SegmentedProps {
  value: string;
  onChange: (value: string) => void;
  segments: Segment[];
  disabled?: boolean;
  label: string;
}

/** Two or three mutually exclusive choices, all worth showing at once. This is
 *  what carries the panel's inherit/on/off rows: a list you must open to learn
 *  it holds three items is the wrong shape for three words. */
export function SegmentedControl({ value, onChange, segments, disabled, label }: SegmentedProps) {
  return (
    <div className="s-ctl-seg" role="radiogroup" aria-label={label}>
      {segments.map((segment) => {
        const on = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            tabIndex={on || (value === "" && segment.value === "") ? 0 : -1}
            className={`s-ctl s-ctl-seg__btn${on ? " s-ctl-seg__btn--on" : ""}`}
            onClick={() => onChange(segment.value)}
            onKeyDown={(e) => {
              // The HORIZONTAL arrows name a physical direction and the
              // segments are laid out by the inline one, so in an Arabic
              // panel ArrowRight walks BACKWARD — the reader's finger and the
              // highlight must move the same way. The vertical pair is
              // direction-free and always means next/previous. (Same rule the
              // attachment viewer's arrows already follow one level up.)
              // `closest("[dir]")` and not the <html> attribute, so a control
              // inside an explicitly LTR island (the NumberInput's field) is
              // read by the direction it is actually drawn in.
              const rtl = e.currentTarget.closest("[dir]")?.getAttribute("dir") === "rtl";
              const step =
                e.key === "ArrowDown" ? 1
                : e.key === "ArrowUp" ? -1
                : e.key === "ArrowRight" ? (rtl ? -1 : 1)
                : e.key === "ArrowLeft" ? (rtl ? 1 : -1)
                : 0;
              if (step === 0) return;
              e.preventDefault();
              const at = segments.findIndex((s) => s.value === value);
              const next = segments[(at + step + segments.length) % segments.length];
              onChange(next.value);
            }}
          >
            <span className="s-ctl-seg__label">{segment.label}</span>
            {segment.note && <span className="s-ctl-seg__note">{segment.note}</span>}
          </button>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------- TextInput

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
  /** Machine text (a URL, a branch, a vault path) keeps its own direction.
   *  `"auto"` is for a field that is BOTH — a template of machine tokens the
   *  operator may also write prose around — and lets the content decide; see
   *  the footer row in SettingsModal. Alignment never follows this attribute:
   *  controls.css flushes every field to the PANEL's start edge whatever its
   *  own direction is. */
  dir?: "ltr" | "rtl" | "auto";
  type?: "text" | "password";
  maxLength?: number;
  autoComplete?: string;
  spellCheck?: boolean;
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled,
  invalid,
  label,
  dir,
  type = "text",
  maxLength,
  autoComplete,
  spellCheck = false,
}: TextInputProps) {
  return (
    <input
      className={`s-ctl s-ctl-input${invalid ? " s-ctl-input--invalid" : ""}`}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      aria-invalid={invalid || undefined}
      dir={dir}
      maxLength={maxLength}
      autoComplete={autoComplete}
      spellCheck={spellCheck}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}

// ------------------------------------------------------------ NumberInput

interface NumberInputProps {
  /** Empty string = the field is cleared, which is a different thing from
   *  zero and the caller decides what it means. */
  value: string;
  onChange: (value: string) => void;
  /** The UNIT, printed inside the field after the number ("%", "minutes").
   *  A number whose unit lives in a hint under the row — "Every [0] minutes;
   *  0 = manual only" — makes the reader assemble the sentence themselves. */
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  invalid?: boolean;
  label: string;
  /** Printed in place of the number when the field is empty. */
  placeholder?: string;
}

/** A number with its unit inside the field, plus −/+ steppers. Not
 *  `<input type="number">`: its spinners are the browser's own chrome (they
 *  are also invisible until hover, and absent on touch), which is the exact
 *  thing this control set exists to stop rendering. */
export function NumberInput({
  value,
  onChange,
  unit,
  min,
  max,
  step = 1,
  disabled,
  invalid,
  label,
  placeholder,
}: NumberInputProps) {
  const clamp = (n: number): number =>
    Math.max(min ?? Number.NEGATIVE_INFINITY, Math.min(max ?? Number.POSITIVE_INFINITY, n));
  const nudge = (delta: number): void => {
    const at = Number(value);
    const base = value.trim() === "" || !Number.isFinite(at) ? (min ?? 0) : at;
    onChange(String(clamp(base + delta)));
  };
  return (
    <div className={`s-ctl-num${disabled ? " s-ctl-num--off" : ""}${invalid ? " s-ctl-num--invalid" : ""}`}>
      <button
        type="button"
        className="s-ctl s-ctl-num__step"
        disabled={disabled}
        aria-label={`${label} −`}
        onClick={() => nudge(-step)}
      >
        −
      </button>
      {/* The field is LTR as a whole, not just its input: the unit is
          positioned with a logical inset and the input's padding is logical
          too, so in an Arabic panel one resolved to the left and the other to
          the right and the "%" landed on top of the digits. A number and its
          unit are one object and they are read left-to-right in both
          languages here (Western digits, a percent sign). */}
      <span className="s-ctl-num__field" dir="ltr">
        <input
          className="s-ctl s-ctl-input s-ctl-num__input"
          type="text"
          inputMode="numeric"
          // Digits are digits in both directions; an Arabic panel must not
          // right-align a number away from the unit that qualifies it.
          dir="ltr"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={label}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value.replace(/[^\d-]/g, ""))}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              nudge(e.key === "ArrowUp" ? step : -step);
            }
          }}
        />
        {/* The unit is part of the value's sentence, so it sits inside the
            field's frame rather than under the row as a hint. */}
        <span className="s-ctl-num__unit" aria-hidden="true">
          {unit}
        </span>
      </span>
      <button
        type="button"
        className="s-ctl s-ctl-num__step"
        disabled={disabled}
        aria-label={`${label} +`}
        onClick={() => nudge(step)}
      >
        +
      </button>
    </div>
  );
}
