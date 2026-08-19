// The settings panel's row scaffolding, and the ⓘ that keeps the environment
// out of the reader's face without hiding it from an operator.
//
// It lives here rather than in SettingsModal.tsx because "This device" is its
// own module now (DeviceTab.tsx) and rows are what both are made of: one
// shape, wired once, is the only reason a label in one tab and a label in the
// next can be trusted to name their control the same way.

import { Children, cloneElement, isValidElement, useId, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { t } from "../../i18n.ts";

/** `SITE_LANG=en`, ready to paste into a .env file or a shell.
 *
 *  Quoted when the value carries whitespace or any character a dotenv parser
 *  reads as syntax: `SITE_NAME=My Vault` sets the name to "My", and a line
 *  that silently truncates is worse than no line at all — the operator copied
 *  it precisely because they did not want to compose it themselves. */
export function envLine(name: string, value: string): string {
  const v = value.trim();
  if (v === "") return `${name}=`;
  return /[\s"'#$`\\]/.test(v) ? `${name}="${v.replace(/(["\\$`])/g, "\\$1")}"` : `${name}=${v}`;
}

/** The environment variable behind a row: its NAME, the value in force, and
 *  whether the row is inheriting it right now (its field is empty). */
export interface EnvVar {
  name: string;
  value: string;
  inherits: boolean;
}

/** THE .ENV LINE, UNDER THE CONTROL, ONCE THE READER ASKS FOR IT.
 *
 *  Every row with an environment variable used to print "inherited from
 *  SITE_LANG" under its control and an `inherited` badge beside its label:
 *  two pieces of chrome, in the first place the eye lands, about a mechanism
 *  most owners of this product will never touch. The variable still has to be
 *  REACHABLE — someone scripting a deployment needs its exact spelling, and
 *  guessing it from the label is not a plan — so it moved behind a ⓘ, and what
 *  sits behind the ⓘ now says more than the badge did: the line itself, ready
 *  to copy, and one sentence naming which of the two sources is winning.
 *
 *  It is a DISCLOSURE, not a popover and not a hover card. A hover card is
 *  unreachable by touch and by keyboard. A positioned popover would be a
 *  fourth transient surface in an Esc chain already three deep (ThemePicker →
 *  an open Select → ImagePicker → the panel), which is how this panel starts
 *  closing itself out from under a reader who meant to dismiss one list. An
 *  `aria-expanded` button and a region in the flow cost the Esc chain nothing.
 */
function EnvPanel({ env, id, labelledBy, open }: { env: EnvVar; id: string; labelledBy: string; open: boolean }) {
  const [copied, setCopied] = useState(false);
  const line = envLine(env.name, env.value);
  // The env NAME is a literal to be typed into a shell, so it keeps the mono
  // face and its own isolate rather than being interpolated into one text run
  // — which is what tf() would do: correct for direction, unable to style half
  // a string.
  // The row NAMES WHICH SOURCE IS WINNING, because the .env line alone cannot:
  // an operator reading `SITE_NAME=Vellum` under a field that holds its own
  // value would take the variable for the answer, and settings.json outranks
  // it. So the two states get two DIFFERENT sentences rather than one and a
  // silence: an inheriting row says where its value comes from, an overridden
  // one says the variable is being ignored and how to hand control back. Both
  // isolate the variable name in its own <bdi> — it is a literal to be typed
  // into a shell, so it stays LTR inside an Arabic sentence.
  const sentence = env.inherits ? t("envDecidedBy") : t("envOverridden");
  const [before, after = ""] = sentence.split("{env}");
  return (
    // Rendered whether or not it is open, hidden with the attribute: the
    // button's `aria-controls` has to point at an element that EXISTS, and
    // `hidden` takes the region and its copy button out of the tab order
    // without a second rule saying so.
    <div className="s-smodal__env" id={id} role="region" aria-labelledby={labelledBy} hidden={!open}>
      <p className="s-smodal__envnote">
        {before}
        <bdi className="s-smodal__envname">{env.name}</bdi>
        {after}
      </p>
      <div className="s-smodal__envrow">
        <code className="s-smodal__envline" dir="ltr">
          {line}
        </code>
        <button
          type="button"
          className="s-btn s-smodal__envcopy"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(line)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {/* The label swaps to "Copied" — SyncBadge's idiom. A clipboard
              write is silent, and a toast for a two-word action is louder
              than the action. */}
          {t(copied ? "syncCopied" : "envCopyLine")}
        </button>
      </div>
    </div>
  );
}

/** A settings row: label on the left, one control on the right.
 *
 *  The label used to be a <div>, which meant twenty inputs and selects in this
 *  panel had NO accessible name at all — a screen reader read "edit text,
 *  blank" twenty times down the page. It is a real <label> now, and the row
 *  wires the id/`aria-describedby`/`aria-invalid` onto its single control
 *  child so no call site has to remember to.
 *
 *  The HINT is a persistent sub-label and it is ONE SENTENCE. The copy pass
 *  that produced this rule found forty- and fifty-word explanations under rows
 *  whose labels were already the answer — "Which calendar every date a reader
 *  sees is printed in — post dates, comment timestamps, the backup badge.
 *  Hijri dates use Umm al-Qura, the calendar printed on the calendars people
 *  own." A reader who must finish a paragraph to learn what a switch does is
 *  doing the label's work for it. */
export function Row({
  label,
  hint,
  error,
  wide,
  off,
  env,
  after,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  /** The control is the widest, most typographic thing in the panel (the type
   *  specimen) — it spans both columns with the label above it, instead of
   *  being squeezed into the control column beside the word "Preview". */
  wide?: boolean;
  /** The row is inert because a master switch above it is off. */
  off?: boolean;
  /** The environment variable this row answers to, behind the ⓘ. */
  env?: EnvVar;
  /** A SECOND LINE under the control, in the control column — not a second
   *  control. The row owns exactly one control (the label is wired onto it),
   *  so a row that also has something to SAY about its value says it here:
   *  the default-theme row's "Visitors see Cinnabar — following your editor
   *  theme". Passing it as a second child would break the label wiring for
   *  every row in the panel. */
  after?: ReactNode;
  children: ReactNode;
}) {
  const cls = [
    "s-smodal__row",
    wide ? "s-smodal__row--wide" : "",
    off ? "s-smodal__row--off" : "",
    error ? "s-smodal__row--invalid" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-err`;
  const envBtnId = `${id}-envbtn`;
  const envId = `${id}-env`;
  const [envOpen, setEnvOpen] = useState(false);
  const described = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");
  // The row owns ONE control, so it can wire the name and the descriptions on
  // without every call site remembering to. A row whose child is not a single
  // element (the wide type specimen, or a control followed by its consequence
  // lines) PASSES THROUGH UNTOUCHED — there is nothing there for a label to
  // point at, and this comment already said so while the code did not: bare
  // `Children.only(children)` THROWS on an array rather than declining it, and
  // the language-filter row hands it a control plus two conditional
  // consequences, so opening that tab took the whole panel down with
  // "React.Children.only expected to receive a single React element child".
  // Rows that want a second line without spending their one control child use
  // `after` instead.
  const kids = Children.toArray(children);
  const only = kids.length === 1 ? kids[0] : null;
  const control =
    only !== null && isValidElement(only)
      ? cloneElement(only as ReactElement<Record<string, unknown>>, {
          id,
          "aria-describedby": described || undefined,
          "aria-invalid": error ? true : undefined,
        })
      : children;
  return (
    // `data-setting` carries the row's RESOLVED label, which is how a search
    // result finds it: the index holds the label KEY, the result resolves the
    // same key through `t()`, and the two meet here. Deriving it from the label
    // the row already has means no call site had to learn about the index —
    // eighty-eight of them would have had to grow an id otherwise.
    <div className={cls} data-setting={label}>
      <label className="s-smodal__label" htmlFor={id}>
        <span className="s-smodal__labeltext">
          {label}
          {/* The ⓘ sits in the label's own text line, where a footnote mark
              sits — and inside the <label> on purpose: a click on interactive
              content inside a label does NOT forward to the labelled control
              (HTML's own rule), so the disclosure opens without also moving
              focus into the field it annotates. Only the BUTTON is in here;
              the region it opens is a block, and a block inside a <label> is
              neither valid nor readable beside a 14rem label column. */}
          {env && (
            <button
              type="button"
              id={envBtnId}
              className="s-smodal__envbtn"
              aria-expanded={envOpen}
              aria-controls={envId}
              aria-label={t("envDisclose")}
              title={t("envDisclose")}
              onClick={() => setEnvOpen((o) => !o)}
            >
              ⓘ
            </button>
          )}
        </span>
        {hint && (
          <span className="s-smodal__hint" id={hintId}>
            {hint}
          </span>
        )}
      </label>
      <div className="s-smodal__control">
        {control}
        {after}
        {/* role="alert" so a validation failure is spoken when it appears,
            not only when the reader happens to tab back onto the field. */}
        {error && (
          <span className="s-smodal__error" id={errorId} role="alert">
            {error}
          </span>
        )}
        {env && <EnvPanel env={env} id={envId} labelledBy={envBtnId} open={envOpen} />}
      </div>
    </div>
  );
}
