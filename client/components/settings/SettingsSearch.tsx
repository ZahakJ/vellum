// Search the whole panel, from any tab.
//
// Eight tabs and eighty-eight rows is a map a reader has to learn before they
// can use it — and the commonest question about a settings panel is not "what
// is on the Publishing tab", it is "where is the thing that does X". The rail
// answers the first question and could never answer the second.
//
// It matches the LABEL, the one-sentence help, and the environment variable
// behind the row's ⓘ. That last one is the operator's half: someone reading a
// deployment script types `SITE_LANG`, and the row it belongs to is the answer.
//
// It searches the WORDS, not the keys, resolved through `t()` at the moment the
// search runs — so an Arabic instance searches Arabic and an English one
// searches English, from one index. Arabic matching folds the harakat a reader
// will not type and the alef family they may spell either way; without that,
// searching "الغة" for "اللغة" finds nothing and the panel looks broken.

import { useEffect, useMemo, useRef, useState } from "react";
import { t } from "../../i18n.ts";
import { searchSettings } from "./searchSettings.ts";
import type { SettingEntry } from "./settingsIndex.ts";

export default function SettingsSearch({
  tabName,
  onGo,
}: {
  /** Human name of a tab id, for the result's second line. */
  tabName: (id: string) => string;
  onGo: (entry: SettingEntry, label: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const hits = useMemo(() => searchSettings(query), [query]);

  useEffect(() => setCursor(0), [query]);

  return (
    <div className="s-smodal__search">
      <input
        ref={inputRef}
        type="search"
        className="s-smodal__searchinput"
        value={query}
        placeholder={t("settingsSearchPlaceholder")}
        aria-label={t("settingsSearchPlaceholder")}
        // A settings name is content in the reader's own language, so the field
        // takes its direction from what is typed rather than from the shell.
        dir="auto"
        spellCheck={false}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (hits.length === 0) return;
            const step = e.key === "ArrowDown" ? 1 : -1;
            setCursor((c) => (c + step + hits.length) % hits.length);
          } else if (e.key === "Enter") {
            const hit = hits[cursor];
            if (hit === undefined) return;
            e.preventDefault();
            onGo(hit.entry, hit.label);
            setQuery("");
          } else if (e.key === "Escape" && query !== "") {
            // Clear before closing: the first Escape belongs to the innermost
            // thing that is open, and a filled search field is one of them.
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
          }
        }}
      />
      {query.trim() !== "" && (
        <div className="s-smodal__results" role="listbox" aria-label={t("settingsSearchPlaceholder")}>
          {hits.length === 0 ? (
            <p className="s-smodal__noresults">{t("settingsSearchNone")}</p>
          ) : (
            hits.map((hit, i) => (
              <button
                key={`${hit.entry.tab}/${hit.entry.label}`}
                type="button"
                role="option"
                aria-selected={i === cursor}
                className={`s-smodal__result${i === cursor ? " s-smodal__result--on" : ""}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  onGo(hit.entry, hit.label);
                  setQuery("");
                }}
              >
                <span className="s-smodal__resultname" dir="auto">{hit.label}</span>
                <span className="s-smodal__resultwhere">
                  {tabName(hit.entry.tab)}
                  {hit.entry.env !== undefined && (
                    // The variable, in the row it belongs to — the operator's
                    // half of this search.
                    <code className="s-smodal__resultenv" dir="ltr">{hit.entry.env}</code>
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
