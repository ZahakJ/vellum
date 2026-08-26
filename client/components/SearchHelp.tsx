// THE OPERATOR CARD — because a grammar nobody can guess is a grammar nobody
// uses.
//
// v1.8 gave the search box `tag:`, `path:`, `is:`, `before:`/`after:` and
// `linkto:`/`linkfrom:` (shared/searchQuery.ts). Every one of them is invisible:
// the box looks exactly as it did, and a reader who never reads a changelog
// will type words into it for ever. So the box grows one quiet `?` and this
// card is what it opens — seven rows, one line each, an example on the left and
// what it does on the right.
//
// It is a POPOVER and not a settings page for the same reason the palette's
// hints are on the rows: the answer belongs beside the question. It closes on
// Escape, on a click outside and on the button that opened it, and it takes no
// focus away from the field — a reader reading the card usually wants to keep
// typing.
//
// The examples are written out here rather than generated from
// SEARCH_OPERATORS: an operator's name is not its shape (`is:` takes two
// values, the dates take three forms), and a generated list would have said
// `is:<value>` where the reader needs to see `is:published`. What the shared
// module guarantees instead is that every one of these parses — tests/
// search.test.ts walks SEARCH_OPERATORS and asserts exactly that, so a row
// here can never advertise something the parser dropped.

import { useEffect, useRef } from "react";
import { t } from "../i18n.ts";
import "../styles/replace.css";

/** One row: what you type, and what it means. */
const ROWS: { example: string; key: Parameters<typeof t>[0] }[] = [
  { example: "tag:recipes", key: "searchOpTag" },
  { example: "path:Journal", key: "searchOpPath" },
  { example: "is:published", key: "searchOpIs" },
  { example: "after:2024-06", key: "searchOpDate" },
  { example: "linkto:Ledger", key: "searchOpLink" },
  { example: "-tag:draft", key: "searchOpNot" },
  { example: 'path:"Reading notes"', key: "searchOpQuote" },
];

export default function SearchHelp({ onClose }: { onClose: () => void }): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        onClose();
      }
    };
    // Pointerdown, not click: a reader dismissing the card by reaching for the
    // tree should not also open the row they landed on.
    const onDown = (ev: PointerEvent): void => {
      const target = ev.target as Node | null;
      if (box.current && target && !box.current.contains(target)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose]);

  return (
    <div className="s-searchhelp" ref={box} role="dialog" aria-label={t("searchHelpTitle")}>
      <h2 className="s-searchhelp__title">{t("searchHelpTitle")}</h2>
      <dl className="s-searchhelp__rows">
        {ROWS.map((row) => (
          <div key={row.example} className="s-searchhelp__row">
            {/* The example is a query, not prose: LTR and monospace in both
                chrome languages, because `tag:recipes` typed into an Arabic
                sidebar is still the same seven ASCII characters. */}
            <dt className="s-searchhelp__ex" dir="ltr">{row.example}</dt>
            <dd className="s-searchhelp__what">{t(row.key)}</dd>
          </div>
        ))}
      </dl>
      <p className="s-searchhelp__note">{t("searchOpAnd")}</p>
      {/* The fold has no chrome anywhere else in the product — it just works —
          so this is the only place a reader can learn that it is happening. */}
      <p className="s-searchhelp__note" dir="auto">{t("searchHelpFold")}</p>
    </div>
  );
}
