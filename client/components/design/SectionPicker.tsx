// ADD A SECTION — a picker of pictures, not a menu of nouns.
//
// The list this opens over is eight kinds long and the names are the least
// informative thing about them: "Post grid", "Post list" and "Topics" are three
// words that describe three shapes, and an author choosing between them is
// choosing a shape. So every option is drawn — the same wireframe language the
// row glyphs and the gallery miniatures use — with the name under it and the
// one line that says what it is FOR beside that.
//
// It stays a POPOVER rather than becoming a modal for the reason the settings
// panel gives about native chrome: adding a section is a small decision taken
// in the middle of a bigger one, and a dialog that dims the page the author is
// composing makes them lose the thread to gain a title bar.
//
// Keyboard: the button says `aria-expanded`, the first option takes focus when
// the sheet opens, Tab walks the options, and Esc closes and hands focus BACK
// to the button — a picker that dumps focus at the top of the document is a
// picker a keyboard reader pays for every time they use it.

import { useEffect, useRef, useState } from "react";
import { t } from "../../i18n.ts";
import SectionGlyph from "./SectionGlyph.tsx";

export interface SectionPickerProps {
  /** The kinds this build can add, from the schema's own list — a section kind
   *  added to shared/design.ts is reachable here without a second edit. */
  kinds: string[];
  label: (kind: string) => string;
  hint: (kind: string) => string;
  onAdd: (kind: string) => void;
  /** The design is already holding as many sections as it may. The button
   *  stays visible and says why, rather than vanishing and leaving the author
   *  to guess whether they broke something. */
  full?: boolean;
  disabled?: boolean;
}

/**
 * IS A PICKER OPEN — the same question `isSelectOpen()` answers for the
 * Select popover, and it is here for exactly the same reason.
 *
 * Esc is claimed by every layer at once: the sheet wants to close, the panel
 * wants to close, and both listen in the CAPTURE phase on `window`. Capture
 * order is registration order, so the panel (mounted first) wins and one Esc
 * closes the whole designer — measured, before this existed. `stopPropagation`
 * inside the sheet cannot fix that; it runs second. So the OUTER surface asks
 * whether an inner one owns the key, which is the precedence the settings
 * panel and the theme picker already keep.
 */
let openPickers = 0;
export function isSectionPickerOpen(): boolean {
  return openPickers > 0;
}

export default function SectionPicker({
  kinds,
  label,
  hint,
  onAdd,
  full = false,
  disabled = false,
}: SectionPickerProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);

  // Focus lands on the first option, so the sheet can be used without a
  // pointer from the keystroke that opened it.
  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLElement>(".s-dsnc-addcard")?.focus();
  }, [open]);

  // Esc closes, a click outside closes, and both return the reader to where
  // they were. Capture phase for the key, like every other layered surface in
  // this product, so an open picker answers Esc before the panel does.
  useEffect(() => {
    if (!open) return;
    openPickers++;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    const onDown = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      openPickers--;
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  return (
    <div className="s-dsnc-addwrap" ref={wrap}>
      <button
        type="button"
        ref={button}
        className={`s-dsnc-addbtn${open ? " s-dsnc-addbtn--on" : ""}`}
        aria-expanded={open}
        disabled={disabled || full}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="s-dsnc-addbtn__plus" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M8 3.5v9M3.5 8h9" />
          </svg>
        </span>
        {t("dsoAddSection")}
      </button>
      {full && <p className="s-dsnc-note">{t("dsnFull")}</p>}
      {open && (
        <div className="s-dsnc-add" ref={sheet} role="group" aria-label={t("dsoAddSection")}>
          <p className="s-dsnc-add__lead">{t("dsnPickerLead")}</p>
          <div className="s-dsnc-add__grid">
            {kinds.map((kind) => (
              <button
                key={kind}
                type="button"
                className="s-dsnc-addcard"
                onClick={() => {
                  onAdd(kind);
                  setOpen(false);
                  button.current?.focus();
                }}
              >
                <span className="s-dsnc-addcard__art" aria-hidden="true">
                  <SectionGlyph kind={kind} size="card" />
                </span>
                <span className="s-dsnc-addcard__text">
                  <span className="s-dsnc-addcard__name">{label(kind)}</span>
                  <span className="s-dsnc-addcard__desc">{hint(kind)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
