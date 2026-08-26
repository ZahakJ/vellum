// "Set banner…" modal (admin): give the open note a hero image — paste a URL,
// pick from the vault's image attachments, or upload a file (drag/drop or
// picker). Writes ride POST /api/frontmatter via the store's setBanner; the
// editor/reading pane reloads itself through the store's usual choreography.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useDialog } from "../a11y.ts";
import { getNote, listAttachments, uploadAttachment } from "../api.ts";
import { confirmDeleteAttachment } from "./deleteFlow.ts";
import { bannerFromContent, bannerSrc } from "../banner.ts";
import { useBannerSrc } from "./BannerImg.tsx";
import { localeNum, t, tf } from "../i18n.ts";
import { UPLOAD_MAX_MB } from "../../shared/limits.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";
import { noteTitleOf } from "../../shared/noteFormat.ts";

function titleOf(path: string): string {
  return noteTitleOf(path);
}

/** The note's banner as it stands. The value is whatever the author TYPED, so
 *  it goes down the resolution ladder — and when it names nothing, this modal
 *  is the one surface that must say so out loud: the reader opened it to fix
 *  exactly this. */
function CurrentBanner({ value, notePath }: { value: string; notePath: string }) {
  const { src, missing } = useBannerSrc(value, notePath);
  return (
    <div className={`s-bmodal__current${missing ? " s-bmodal__current--missing" : ""}`}>
      {src ? <img src={src} alt="" /> : <span className="s-bmodal__missing">{t("bannerMissing")}</span>}
      <span className="s-bmodal__currentpath" dir="auto">
        {value}
      </span>
    </div>
  );
}

export default function BannerModal() {
  const openPath = useStore((s) => s.openPath);
  const setOpen = useStore((s) => s.setBannerModalOpen);
  useStore((s) => s.language); // re-render the chrome strings on language change

  const [url, setUrl] = useState("");
  const [filter, setFilter] = useState("");
  const [attachments, setAttachments] = useState<string[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const close = useCallback(() => setOpen(false), [setOpen]);

  // Esc closes (capture phase so the editor doesn't swallow it first), Tab
  // stays inside the modal, and closing hands focus back to whatever opened
  // it. The URL field takes focus itself in the load effect below.
  useDialog(panelRef, { manualFocus: true, onEscape: close });

  // Load the picker list + the note's current banner.
  useEffect(() => {
    let disposed = false;
    listAttachments()
      .then((list) => {
        if (!disposed) setAttachments(list);
      })
      .catch(() => {
        // null-with-error, not empty: "no attachments" and "list failed"
        // must not read the same in the picker.
        if (!disposed) { setAttachments([]); setListFailed(true); }
      });
    if (openPath) {
      getNote(openPath)
        .then((note) => {
          if (!disposed) setCurrent(bannerFromContent(note.content));
        })
        .catch(() => {
          /* current banner is a garnish — modal still works */
        });
    }
    requestAnimationFrame(() => urlInputRef.current?.focus());
    return () => {
      disposed = true;
    };
  }, [openPath]);

  const apply = useCallback(
    (value: string | null) => {
      if (!openPath || busy) return;
      setBusy(true);
      useStore
        .getState()
        .setBanner(openPath, value)
        .finally(() => {
          setBusy(false);
          close();
        });
    },
    [openPath, busy, close],
  );

  const upload = useCallback(
    (file: File) => {
      if (!openPath || busy) return;
      setBusy(true);
      uploadAttachment(file)
        .then((res) => {
          setBusy(false);
          apply(res.path);
        })
        .catch((err: unknown) => {
          setBusy(false);
          console.error("vellum: upload failed", err);
          toast(err instanceof Error ? err.message : t("uploadFailed"));
        });
    },
    [openPath, busy, apply],
  );

  if (!openPath) return null;

  const filtered = (attachments ?? []).filter((p) =>
    p.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="s-palette-overlay" onMouseDown={close}>
      <div
        ref={panelRef}
        className="s-bmodal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="s-bmodal__head">
          <span className="s-bmodal__title" id={titleId}>
            {t("bannerTitle")} — <em>{titleOf(openPath)}</em>
          </span>
          <button type="button" className="s-bmodal__close" onClick={close} aria-label={t("close")}>
            ×
          </button>
        </div>

        {current && <CurrentBanner value={current} notePath={openPath} />}

        <div className="s-bmodal__row">
          <input
            ref={urlInputRef}
            className="s-bmodal__input"
            type="text"
            placeholder={t("bannerUrlPlaceholder")}
            aria-label={t("bannerUrlPlaceholder")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && url.trim()) apply(url.trim());
            }}
            spellCheck={false}
          />
          <button
            type="button"
            className="s-btn s-btn--accent"
            disabled={!url.trim() || busy}
            onClick={() => apply(url.trim())}
          >
            {t("use")}
          </button>
        </div>

        {/* A <div onClick> that opens a file picker is a control no keyboard
            can reach. It is a button; the drag handlers ride along on it. */}
        <button
          type="button"
          className={`s-bmodal__drop${dragOver ? " s-bmodal__drop--over" : ""}`}
          aria-label={t("chooseImageFile")}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) upload(file);
          }}
        >
          {t(busy ? "working" : "dropImage")}
          <span className="s-bmodal__drophint">{tf("dropHint", { max: localeNum(UPLOAD_MAX_MB) })}</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
        </button>

        <div className="s-bmodal__pick">
          <input
            className="s-bmodal__input"
            type="text"
            placeholder={t("searchAttachments")}
            aria-label={t("searchAttachments")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            spellCheck={false}
          />
          <div className="s-bmodal__list">
            {attachments === null && <div className="s-bmodal__empty">{t("loading")}</div>}
            {attachments !== null && filtered.length === 0 && (
              <div className="s-bmodal__empty">
                {t(
                  attachments.length > 0
                    ? "noMatchesDot"
                    : listFailed
                      ? "attachmentsFailed"
                      : "noAttachments",
                )}
                {/* A VAULT WITH NO PICTURES IN IT IS THE COMMONEST CASE ON A
                    FIRST BANNER, and the picker answered it with a dead
                    sentence (v1.8 UX audit F41) — while the uploader that
                    fixes it sat above the list, past a URL field, looking like
                    a decorative dashed box. The empty case surfaces it: same
                    input, same handler, one press. */}
                {attachments.length === 0 && !listFailed && (
                  <button
                    type="button"
                    className="s-btn s-btn--accent s-bmodal__emptydoor"
                    disabled={busy}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {t("chooseImageFile")}
                  </button>
                )}
              </div>
            )}
            {filtered.slice(0, 200).map((p) => (
              // Row, not a lone button: the picker is where the vault's
              // attachments are actually browsed, so it is where deleting one
              // belongs — and a delete button nested inside the pick button
              // would be an invalid (and unreachable) control.
              <div key={p} className="s-attach-row">
                <button
                  type="button"
                  className="s-bmodal__item"
                  onClick={() => apply(p)}
                  disabled={busy}
                >
                  <img className="s-bmodal__thumb" src={bannerSrc(p)} alt="" loading="lazy" />
                  <span className="s-bmodal__itempath" dir="ltr">
                    {p}
                  </span>
                </button>
                <button
                  type="button"
                  className="s-attach-del"
                  title={t("delete")}
                  aria-label={tf("deleteAttachmentTitle", { name: p })}
                  disabled={busy}
                  onClick={() => {
                    // The confirm names every note that still embeds this
                    // file: deleting one is exactly as quiet as deleting the
                    // folder it lives in, and just as breaking.
                    void confirmDeleteAttachment(p).then((gone: boolean) => {
                      if (gone) setAttachments((list) => (list ?? []).filter((x) => x !== p));
                    });
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>

        {current && (
          <div className="s-bmodal__foot">
            <button
              type="button"
              className="s-btn s-btn--danger"
              disabled={busy}
              onClick={() => apply(null)}
            >
              {t("removeBanner")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
