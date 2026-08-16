// THE FOOTER DESIGNER — up to four columns, each holding links, plain text
// and social accounts.
//
// The three entry kinds are three different objects, not one object with a
// checkbox: a TEXT entry has no destination (an address, a licence line), a
// LINK is a label and a URL, and a SOCIAL entry is a link that also carries a
// mark. Offering one shape for all three would mean a URL field on a postal
// address and an icon picker on a link to the archive.
//
// The social list is CLOSED (mastodon, x, github, linkedin, rss, email). An
// open "icon name" field is a promise to ship every icon in the world, and it
// fails silently for the operator who types "bluesky".

import {
  type FooterColumn,
  type FooterEntry,
  type FooterEntryKind,
  type SocialNetwork,
  designId,
  FOOTER_LIMITS,
  isSafeLinkTarget,
  SOCIAL_NETWORKS,
} from "../../../shared/designChrome.ts";
import { t, type I18nKey } from "../../i18n.ts";
import { Select } from "../controls/Select.tsx";
import { TextInput } from "../controls/Fields.tsx";

const KIND_LABEL: Record<FooterEntryKind, I18nKey> = {
  link: "designEntryLink",
  text: "designEntryText",
  social: "designEntrySocial",
};

const NETWORK_LABEL: Record<SocialNetwork, string> = {
  mastodon: "Mastodon",
  x: "X",
  github: "GitHub",
  linkedin: "LinkedIn",
  rss: "RSS",
  email: "Email",
};

export default function FooterBuilder({
  columns,
  onChange,
}: {
  columns: FooterColumn[];
  onChange: (columns: FooterColumn[]) => void;
}) {
  const clone = (): FooterColumn[] =>
    columns.map((col) => ({ ...col, entries: col.entries.map((e) => ({ ...e })) }));

  const addColumn = (): void => {
    if (columns.length >= FOOTER_LIMITS.columns) return;
    onChange([...clone(), { id: designId(), title: "", entries: [] }]);
  };

  const moveColumn = (index: number, delta: -1 | 1): void => {
    const next = clone();
    const to = index + delta;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };

  const addEntry = (index: number, kind: FooterEntryKind): void => {
    const next = clone();
    if (next[index].entries.length >= FOOTER_LIMITS.entries) return;
    const entry: FooterEntry = { id: designId(), kind, label: t("designNewItem") };
    if (kind === "social") entry.network = "mastodon";
    next[index].entries.push(entry);
    onChange(next);
  };

  const updateEntry = (col: number, at: number, entry: FooterEntry): void => {
    const next = clone();
    next[col].entries[at] = entry;
    onChange(next);
  };

  return (
    <div className="s-dsgr-foot">
      {columns.length === 0 && <p className="s-dsgr-empty">{t("designFooterEmpty")}</p>}

      {columns.map((col, index) => (
        <div className="s-dsgr-col" key={col.id}>
          <div className="s-dsgr-row__head">
            <span className="s-dsgr-row__kind">{t("designColumn")}</span>
            <div className="s-dsgr-row__tools">
              <button
                type="button"
                className="s-dsgr-iconbtn"
                title={t("designMoveUp")}
                aria-label={t("designMoveUp")}
                disabled={index === 0}
                onClick={() => moveColumn(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="s-dsgr-iconbtn"
                title={t("designMoveDown")}
                aria-label={t("designMoveDown")}
                disabled={index === columns.length - 1}
                onClick={() => moveColumn(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="s-dsgr-iconbtn"
                title={t("designRemoveColumn")}
                aria-label={t("designRemoveColumn")}
                onClick={() => onChange(clone().filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </div>
          </div>

          <label className="s-dsgr-field">
            <span className="s-dsgr-field__label">{t("designColumnTitle")}</span>
            <TextInput
              value={col.title}
              onChange={(value) => {
                const next = clone();
                next[index].title = value;
                onChange(next);
              }}
              label={t("designColumnTitle")}
              maxLength={FOOTER_LIMITS.title}
            />
          </label>

          {col.entries.map((entry, at) => {
            const badUrl = entry.kind !== "text" && !isSafeLinkTarget(entry.target ?? "");
            return (
              <div className="s-dsgr-entry" key={entry.id}>
                <div className="s-dsgr-row__head">
                  <span className="s-dsgr-row__kind">{t(KIND_LABEL[entry.kind])}</span>
                  <div className="s-dsgr-row__tools">
                    <button
                      type="button"
                      className="s-dsgr-iconbtn"
                      title={t("designMoveUp")}
                      aria-label={t("designMoveUp")}
                      disabled={at === 0}
                      onClick={() => {
                        const next = clone();
                        const list = next[index].entries;
                        [list[at - 1], list[at]] = [list[at], list[at - 1]];
                        onChange(next);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="s-dsgr-iconbtn"
                      title={t("designRemoveItem")}
                      aria-label={t("designRemoveItem")}
                      onClick={() => {
                        const next = clone();
                        next[index].entries.splice(at, 1);
                        onChange(next);
                      }}
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <label className="s-dsgr-field">
                  <span className="s-dsgr-field__label">{t("designItemLabel")}</span>
                  <TextInput
                    value={entry.label}
                    onChange={(value) => updateEntry(index, at, { ...entry, label: value })}
                    label={t("designItemLabel")}
                    maxLength={FOOTER_LIMITS.label}
                  />
                </label>

                {entry.kind === "social" && (
                  <label className="s-dsgr-field">
                    <span className="s-dsgr-field__label">{t("designNetwork")}</span>
                    <Select
                      value={entry.network ?? "mastodon"}
                      onChange={(value) =>
                        updateEntry(index, at, { ...entry, network: value as SocialNetwork })
                      }
                      options={SOCIAL_NETWORKS.map((n) => ({ value: n, label: NETWORK_LABEL[n] }))}
                      label={t("designNetwork")}
                    />
                  </label>
                )}

                {entry.kind !== "text" && (
                  <label className="s-dsgr-field">
                    <span className="s-dsgr-field__label">{t("designUrl")}</span>
                    <TextInput
                      value={entry.target ?? ""}
                      onChange={(value) => updateEntry(index, at, { ...entry, target: value })}
                      label={t("designUrl")}
                      dir="ltr"
                      placeholder="https://"
                      invalid={badUrl}
                      maxLength={FOOTER_LIMITS.target}
                    />
                  </label>
                )}

                {badUrl && <p className="s-dsgr-warn">{t("designItemBadUrl")}</p>}
              </div>
            );
          })}

          <div className="s-dsgr-add">
            <span className="s-dsgr-add__label">{t("designAddEntry")}</span>
            {(["link", "text", "social"] as FooterEntryKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                className="s-dsgr-add__btn"
                disabled={col.entries.length >= FOOTER_LIMITS.entries}
                onClick={() => addEntry(index, kind)}
              >
                {t(KIND_LABEL[kind])}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="s-dsgr-add">
        <button
          type="button"
          className="s-dsgr-add__btn"
          disabled={columns.length >= FOOTER_LIMITS.columns}
          onClick={addColumn}
        >
          {t("designAddColumn")}
        </button>
      </div>
    </div>
  );
}
