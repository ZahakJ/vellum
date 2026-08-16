// THE NAVIGATION BUILDER — the menu, built by hand.
//
// What it replaces: "the N busiest published tags, in count order". That is a
// sensible default and an impossible menu — it cannot hold an About page, it
// cannot hold a link off the site, it cannot be ordered, and it changes under
// the operator's feet as they write. Everything here exists because one of
// those four was needed.
//
// ORDERING IS BUTTONS, NOT DRAG. Drag-and-drop is a mouse gesture with a
// keyboard story that has to be built anyway, and this list is at most twenty
// rows: ↑/↓ move an item among its siblings, → nests it under the item above,
// ← lifts it back out. Every one of those is reachable by Tab, works on a
// phone, and says what it will do before it does it.
//
// ONE LEVEL. → is disabled when the item above is already a child, when the
// submenu is full, and on the first row — the shape is enforced by the
// controls, not explained in a validation message after the fact.

import { useMemo, type ReactNode } from "react";
import {
  type NavItem,
  type NavKind,
  designId,
  isSafeLinkTarget,
  NAV_LIMITS,
} from "../../../shared/designChrome.ts";
import type { PageMeta } from "../../../shared/types.ts";
import { t, type I18nKey } from "../../i18n.ts";
import { Select } from "../controls/Select.tsx";
import { TextInput, Toggle } from "../controls/Fields.tsx";

export interface NavBuilderProps {
  items: NavItem[];
  onChange: (items: NavItem[]) => void;
  /** Every note in the vault (admin tree) — a menu may point at a note that
   *  is not published yet; the SITE then simply does not render that item
   *  until it is, and this panel says so. */
  notes: { title: string; path: string }[];
  pages: PageMeta[];
  tags: string[];
  /** Paths the public site can actually reach right now. An item pointing
   *  outside this set gets a "not visible yet" note — the one thing a builder
   *  must never do is look fine while shipping a dead link. */
  visible: Set<string>;
}

/** Flattened view: every item with where it sits, so the row controls can be
 *  written once instead of twice (top level and children). */
interface Row {
  item: NavItem;
  parent: number | null; // index into items[] when this is a child
  index: number; // index among its own siblings
  depth: 0 | 1;
}

function flatten(items: NavItem[]): Row[] {
  const rows: Row[] = [];
  items.forEach((item, i) => {
    rows.push({ item, parent: null, index: i, depth: 0 });
    (item.children ?? []).forEach((child, j) => {
      rows.push({ item: child, parent: i, index: j, depth: 1 });
    });
  });
  return rows;
}

const KIND_LABEL: Record<NavKind, I18nKey> = {
  home: "designKindHome",
  note: "designKindNote",
  page: "designKindPage",
  topic: "designKindTopic",
  url: "designKindUrl",
  group: "designKindGroup",
};

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="s-dsgr-iconbtn"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export default function NavBuilder({
  items,
  onChange,
  notes,
  pages,
  tags,
  visible,
}: NavBuilderProps) {
  const rows = useMemo(() => flatten(items), [items]);

  /** Replace one item, wherever it sits. */
  const update = (row: Row, next: NavItem): void => {
    const copy: NavItem[] = items.map((item) => ({ ...item, children: item.children?.map((c) => ({ ...c })) }));
    if (row.parent === null) copy[row.index] = next;
    else copy[row.parent].children![row.index] = next;
    onChange(copy);
  };

  const remove = (row: Row): void => {
    const copy: NavItem[] = items.map((item) => ({ ...item, children: item.children?.map((c) => ({ ...c })) }));
    if (row.parent === null) copy.splice(row.index, 1);
    else {
      copy[row.parent].children!.splice(row.index, 1);
      if (copy[row.parent].children!.length === 0) {
        // A group is a label with children; with none left it is not an item.
        if (copy[row.parent].kind === "group") copy.splice(row.parent, 1);
        else delete copy[row.parent].children;
      }
    }
    onChange(copy);
  };

  const move = (row: Row, delta: -1 | 1): void => {
    const copy: NavItem[] = items.map((item) => ({ ...item, children: item.children?.map((c) => ({ ...c })) }));
    const list = row.parent === null ? copy : copy[row.parent].children!;
    const to = row.index + delta;
    if (to < 0 || to >= list.length) return;
    [list[row.index], list[to]] = [list[to], list[row.index]];
    onChange(copy);
  };

  /** → : become a child of the item above. */
  const indent = (row: Row): void => {
    if (row.depth !== 0 || row.index === 0) return;
    const copy: NavItem[] = items.map((item) => ({ ...item, children: item.children?.map((c) => ({ ...c })) }));
    const parent = copy[row.index - 1];
    const kids = parent.children ?? [];
    if (kids.length >= NAV_LIMITS.children) return;
    const [moved] = copy.splice(row.index, 1);
    // Nesting flattens its own children: one level, always.
    parent.children = [...kids, { ...moved, children: undefined }];
    onChange(copy);
  };

  /** ← : leave the submenu, landing directly after the parent. */
  const outdent = (row: Row): void => {
    if (row.parent === null) return;
    const copy: NavItem[] = items.map((item) => ({ ...item, children: item.children?.map((c) => ({ ...c })) }));
    const parent = copy[row.parent];
    const [moved] = parent.children!.splice(row.index, 1);
    if (parent.children!.length === 0) {
      if (parent.kind === "group") {
        copy.splice(row.parent, 1, moved);
        onChange(copy);
        return;
      }
      delete parent.children;
    }
    copy.splice(row.parent + 1, 0, moved);
    onChange(copy);
  };

  const add = (kind: NavKind): void => {
    if (items.length >= NAV_LIMITS.items) return;
    const label =
      kind === "home"
        ? t("designHomeLabel")
        : kind === "group"
          ? t("designGroupLabel")
          : t("designNewItem");
    const item: NavItem = { id: designId(), kind, label };
    if (kind === "group") item.children = [];
    onChange([...items, item]);
  };

  const noteOptions = useMemo(
    () => notes.map((n) => ({ value: n.path, label: n.title, note: n.path })),
    [notes],
  );
  const pageOptions = useMemo(
    () => pages.map((p) => ({ value: p.path, label: p.title, note: p.path })),
    [pages],
  );
  const tagOptions = useMemo(() => tags.map((tag) => ({ value: tag, label: tag })), [tags]);

  return (
    <div className="s-dsgr-nav">
      {rows.length === 0 && <p className="s-dsgr-empty">{t("designNavEmpty")}</p>}

      {rows.map((row) => {
        const { item } = row;
        const targetMissing =
          (item.kind === "note" || item.kind === "page") &&
          (!item.target || !visible.has(item.target));
        const badUrl = item.kind === "url" && (!item.target || !isSafeLinkTarget(item.target));
        const siblings = row.parent === null ? items : (items[row.parent].children ?? []);
        return (
          <div
            className={`s-dsgr-row${row.depth === 1 ? " s-dsgr-row--child" : ""}${item.hidden ? " s-dsgr-row--hidden" : ""}`}
            key={item.id}
          >
            <div className="s-dsgr-row__head">
              <span className="s-dsgr-row__kind">{t(KIND_LABEL[item.kind])}</span>
              <div className="s-dsgr-row__tools">
                <IconButton label={t("designMoveUp")} disabled={row.index === 0} onClick={() => move(row, -1)}>
                  ↑
                </IconButton>
                <IconButton
                  label={t("designMoveDown")}
                  disabled={row.index === siblings.length - 1}
                  onClick={() => move(row, 1)}
                >
                  ↓
                </IconButton>
                <IconButton
                  label={t("designNest")}
                  disabled={
                    row.depth === 1 ||
                    row.index === 0 ||
                    (items[row.index - 1]?.children?.length ?? 0) >= NAV_LIMITS.children
                  }
                  onClick={() => indent(row)}
                >
                  →
                </IconButton>
                <IconButton label={t("designUnnest")} disabled={row.depth === 0} onClick={() => outdent(row)}>
                  ←
                </IconButton>
                <IconButton
                  label={item.hidden ? t("designShowItem") : t("designHideItem")}
                  onClick={() => update(row, { ...item, hidden: item.hidden ? undefined : true })}
                >
                  {item.hidden ? "◌" : "●"}
                </IconButton>
                <IconButton label={t("designRemoveItem")} onClick={() => remove(row)}>
                  ✕
                </IconButton>
              </div>
            </div>

            <div className="s-dsgr-row__fields">
              <label className="s-dsgr-field">
                <span className="s-dsgr-field__label">{t("designItemLabel")}</span>
                <TextInput
                  value={item.label}
                  onChange={(value) => update(row, { ...item, label: value })}
                  label={t("designItemLabel")}
                  maxLength={NAV_LIMITS.label}
                />
              </label>

              {(item.kind === "note" || item.kind === "page") && (
                <label className="s-dsgr-field">
                  <span className="s-dsgr-field__label">
                    {t(item.kind === "page" ? "designPickPage" : "designPickNote")}
                  </span>
                  <Select
                    value={item.target ?? ""}
                    onChange={(value) => update(row, { ...item, target: value })}
                    options={item.kind === "page" ? pageOptions : noteOptions}
                    label={t(item.kind === "page" ? "designPickPage" : "designPickNote")}
                    filter
                    filterPlaceholder={t("designFilterNotes")}
                  />
                </label>
              )}

              {item.kind === "topic" && (
                <label className="s-dsgr-field">
                  <span className="s-dsgr-field__label">{t("designPickTopic")}</span>
                  <Select
                    value={item.target ?? ""}
                    onChange={(value) => update(row, { ...item, target: value })}
                    options={tagOptions}
                    label={t("designPickTopic")}
                    filter
                    filterPlaceholder={t("designFilterTopics")}
                  />
                </label>
              )}

              {item.kind === "url" && (
                <>
                  <label className="s-dsgr-field">
                    <span className="s-dsgr-field__label">{t("designUrl")}</span>
                    <TextInput
                      value={item.target ?? ""}
                      onChange={(value) => update(row, { ...item, target: value })}
                      label={t("designUrl")}
                      dir="ltr"
                      placeholder="https://"
                      invalid={badUrl}
                      maxLength={NAV_LIMITS.target}
                    />
                  </label>
                  <label className="s-dsgr-field">
                    <span className="s-dsgr-field__label">{t("designNewTab")}</span>
                    <Toggle
                      value={item.newTab === true}
                      onChange={(on) => update(row, { ...item, newTab: on || undefined })}
                      label={t("designNewTab")}
                      onLabel={t("on")}
                      offLabel={t("off")}
                    />
                  </label>
                </>
              )}
            </div>

            {targetMissing && <p className="s-dsgr-warn">{t("designItemUnpublished")}</p>}
            {badUrl && <p className="s-dsgr-warn">{t("designItemBadUrl")}</p>}
            {item.hidden && <p className="s-dsgr-note">{t("designItemHidden")}</p>}
          </div>
        );
      })}

      <div className="s-dsgr-add">
        <span className="s-dsgr-add__label">{t("designAddItem")}</span>
        {(["page", "note", "topic", "url", "group", "home"] as NavKind[]).map((kind) => (
          <button
            key={kind}
            type="button"
            className="s-dsgr-add__btn"
            disabled={items.length >= NAV_LIMITS.items}
            onClick={() => add(kind)}
          >
            {t(KIND_LABEL[kind])}
          </button>
        ))}
      </div>
    </div>
  );
}
