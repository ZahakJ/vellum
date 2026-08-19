// "This device" — the six preferences that were never part of the Save button.
//
// THE PANEL'S WORST CONFUSION, GIVEN ITS OWN TAB. Theme, editor language and
// the sidebar's edge commit on click and are stored in localStorage; they sat
// among thirty-seven server settings under a footer reading "Unsaved changes"
// and a Save button that does not apply to them. Two rows apart, in one
// column, in one visual rank: one kind of row saves itself and the other kind
// waits for a button. Nothing on screen said which was which, and the sentence
// under the tab could not say it either, because it was true of three rows out
// of eighteen.
//
// So the boundary is the TAB now, which is the one piece of chrome a reader
// reads before they read a row: everything here is this browser's own, it
// takes effect the moment it is clicked, and the Save button in the footer
// belongs to the other seven tabs. That also lets vim, reading-view numbering
// and the floating toolbar come in from the cold — three device preferences
// that lived only on a status-bar pill, an outline button and a palette row,
// where a reader who did not already know they existed could not find them.
//
// Every row here is a preference of the PERSON, never of the site: none of
// them travels to a co-author, none of them changes what a visitor sees, and
// none of them needs the server to answer.

import { useEffect, useState } from "react";
import { t } from "../../i18n.ts";
import { defaultSide, useStore, type SidebarSidePref } from "../../state.ts";
import { choiceBase, choiceLabel } from "../../themes.ts";
import { headingNumbersPref, setHeadingNumbersPref } from "../../reading/headingNumbers.ts";
import { selectionToolbarEnabled, setSelectionToolbarEnabled } from "../SelectionMenu.tsx";
import { SegmentedControl, Toggle } from "../controls/Fields.tsx";
import { openThemePicker } from "../ThemePicker.tsx";
import { Row } from "./Row.tsx";

/** A localStorage preference that is NOT in the store, kept live the way its
 *  own module already publishes it: a window event. Both of these have a
 *  second switch elsewhere in the app (the outline's "1.", the toolbar's own
 *  last row), and a settings row that goes stale the moment someone uses the
 *  other switch is a settings row that lies. */
function useEventPref(event: string, read: () => boolean): boolean {
  const [on, setOn] = useState(read);
  useEffect(() => {
    const sync = (): void => setOn(read());
    window.addEventListener(event, sync);
    return () => window.removeEventListener(event, sync);
  }, [event, read]);
  return on;
}

export default function DeviceTab() {
  /** The reader's OWN theme — a live subscription, so a pick made in the
   *  picker on top of this panel updates the row underneath it. */
  const theme = useStore((s) => s.theme);
  /** The notes sidebar's edge. Both halves are read: the three-state
   *  preference drives the control, and the resolved edge names what "Auto"
   *  is doing right now, because an "Auto" that does not say which edge it
   *  landed on is the invisible state this control exists to end. */
  const sidebarSidePref = useStore((s) => s.sidebarSidePref);
  /** The edge *Auto* would resolve to — `defaultSide(language)`, NOT the
   *  store's `sidebarSide`. The resolved side already has any pin folded into
   *  it, so on an Arabic instance with the pane pinned left it reads "left"
   *  while picking Auto would move the pane right: the note would describe the
   *  pin instead of the option it sits under. */
  const autoSide = useStore((s) => defaultSide(s.language));
  const setSidebarSidePref = useStore((s) => s.setSidebarSidePref);
  /** The stored PREFERENCE drives the control (a pin to English and a follow
   *  of an English site are different states that resolve alike), and the
   *  site's own language names what "Follow site" is currently doing.
   *  `siteLanguage` is deliberately the store's site value rather than
   *  `language`, which for this very admin may be the other one. */
  const editorLangPref = useStore((s) => s.editorLangPref);
  const setEditorLang = useStore((s) => s.setEditorLang);
  const siteLanguage = useStore((s) => s.siteLanguage);
  const vimMode = useStore((s) => s.vimMode);
  const toggleVim = useStore((s) => s.toggleVim);
  const numbered = useEventPref("vellum:heading-numbers", headingNumbersPref);
  const toolbar = useEventPref("vellum:seltoolbar", selectionToolbarEnabled);

  return (
    <section data-section="device">
      <Row label={t("rowYourTheme")} hint={t("hintYourTheme")}>
        {/* TWO ROWS THAT ANSWER THE SAME QUESTION WEAR THE SAME FACE. This one
            used to be a 58px swatch and a "Browse themes…" text link flung to
            opposite ends of the control column with ~280px of nothing between
            them — the least finished-looking row in the panel, in both
            languages. It is ONE trigger, built on `.s-ctl-select` like the
            default-theme row it is now a whole tab away from: same measure,
            same border, same chevron. What it opens is a browsing panel rather
            than a list, and that is the honest difference — fifteen rooms are
            chosen by looking at them, which is why the trigger carries the
            miniature the picker itself draws. */}
        <button
          type="button"
          className="s-ctl s-ctl-select s-smodal__themebtn"
          aria-haspopup="dialog"
          aria-label={t("rowYourTheme")}
          onClick={openThemePicker}
        >
          {/* The swatch tokens are keyed on the fifteen built-in ids and are
              CONSTANT by design, so a custom theme shows the room it was built
              on — under its OWN name, beside it. */}
          <span className="s-tpick__card" data-theme-swatch={choiceBase(theme)} aria-hidden="true">
            <span className="s-tpick__card-rule" />
            <span className="s-tpick__card-line" />
            <span className="s-tpick__card-foot">
              <span className="s-tpick__card-chip" />
              <span className="s-tpick__card-line s-tpick__card-line--short" />
            </span>
          </span>
          <bdi className="s-ctl-select__value s-smodal__themename">{choiceLabel(theme)}</bdi>
          <span className="s-ctl-select__note">{t("browseThemes")}</span>
          <svg className="s-ctl-select__chev" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              d="M4 6.5 L8 10.5 L12 6.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </Row>

      {/* THE ROW THAT UNWELDS THE TWO LANGUAGES. Language & dates decides what
          this site PUBLISHES in; this decides what the person looking at the
          screen reads. One value used to do both jobs, so one tap on the
          public ع rewrote the owner's editor. Three states, not two, for the
          same reason the sidebar row below has three: the default has to stay
          reachable, and "Follow site" names the language it landed on rather
          than being a silent state. */}
      <Row label={t("rowEditorLanguage")} hint={t("hintEditorLanguage")}>
        <SegmentedControl
          label={t("rowEditorLanguage")}
          value={editorLangPref ?? ""}
          onChange={(v) => setEditorLang(v === "" ? null : (v as "en" | "ar"))}
          segments={[
            {
              value: "",
              label: t("editorLangFollow"),
              note: siteLanguage === "ar" ? "العربية" : "English",
            },
            { value: "en", label: "English" },
            { value: "ar", label: "العربية" },
          ]}
        />
      </Row>

      {/* Directly under the language row, because it is that row that moves
          it: "auto" means the reading direction's leading edge, so an editor
          set to Arabic carries the notes sidebar to the right. Naming the edge
          it resolved to is the whole point of the note. Segment labels name a
          PHYSICAL edge in both languages, exactly as the palette commands do. */}
      <Row label={t("rowSidebarSide")} hint={t("hintSidebarSide")}>
        <SegmentedControl
          label={t("rowSidebarSide")}
          value={sidebarSidePref}
          onChange={(v) => setSidebarSidePref(v as SidebarSidePref)}
          segments={[
            {
              value: "auto",
              label: t("sideAuto"),
              note: t(autoSide === "left" ? "sideLeft" : "sideRight"),
            },
            { value: "left", label: t("sideLeft") },
            { value: "right", label: t("sideRight") },
          ]}
        />
      </Row>

      {/* THE LABEL IS THE STATE. A two-state preference is a Toggle and its
          label says what being ON does — never "Vim: on/off", which asks the
          reader to hold the sentence together themselves. The status bar's
          pill and the palette row still flip the same store value; this is
          simply the place a reader who has not met either can find it. */}
      <div className="s-smodal__sub">{t("groupEditing")}</div>
      <Row label={t("rowVimKeys")} hint={t("hintVimKeys")}>
        <Toggle
          label={t("rowVimKeys")}
          onLabel={t("on")}
          offLabel={t("off")}
          value={vimMode}
          onChange={() => toggleVim()}
        />
      </Row>
      <Row label={t("selToolbarLabel")} hint={t("hintSelToolbar")}>
        <Toggle
          label={t("selToolbarLabel")}
          onLabel={t("on")}
          offLabel={t("off")}
          value={toolbar}
          onChange={setSelectionToolbarEnabled}
        />
      </Row>
      <Row label={t("rowHeadingNumbers")} hint={t("hintHeadingNumbers")}>
        <Toggle
          label={t("rowHeadingNumbers")}
          onLabel={t("on")}
          offLabel={t("off")}
          value={numbered}
          onChange={setHeadingNumbersPref}
        />
      </Row>
    </section>
  );
}
