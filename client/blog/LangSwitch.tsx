// The visitor's EN/ع switch — shown only when the instance opted in
// (settings.languageToggle; off by default, so nothing about the public site
// changes for anyone who leaves it alone).
//
// It shows the language it would switch TO, in that language's own script,
// the way a language picker reads to the person who needs it. The words go in
// title/aria-label, because two letters of gold in a nav is as loud as this
// should ever be.

import { otherLang } from "../langPref.ts";
import { t } from "../i18n.ts";
import { useStore } from "../state.ts";

export default function LangSwitch() {
  const enabled = useStore((s) => s.languageToggle);
  const language = useStore((s) => s.language);
  if (!enabled) return null;
  const target = otherLang(language);
  return (
    <button
      type="button"
      className="s-blog-lang"
      lang={target}
      // The target label is always in the target's script, so it keeps its
      // own direction regardless of which way the shell is facing.
      dir={target === "ar" ? "rtl" : "ltr"}
      title={t("blogSwitchLanguage")}
      aria-label={t("blogSwitchLanguage")}
      onClick={() => useStore.getState().setVisitorLang(target)}
    >
      {/* The label is its own box so the naskh ain can be nudged up off its
          overshooting baseline without moving the button around it. */}
      <span className="s-blog-lang__label" aria-hidden="true">
        {target === "ar" ? "ع" : "EN"}
      </span>
    </button>
  );
}
