// Dashboard "Change banner…" modal — the home-page cousin of the note
// BannerModal (same s-bmodal chrome): paste a URL, pick a vault attachment,
// or upload; saves to settings.home.banner via PATCH /api/settings. Reached
// only from inside visitor preview, so every call here rides asAdmin (the
// preview header would make the server treat the admin as a stranger).

import { useCallback, useEffect, useRef, useState } from "react";
import { listAttachments, patchSettings, uploadAttachment } from "../api.ts";
import { bannerSrc } from "../banner.ts";
import { useBannerSrc } from "../components/BannerImg.tsx";
import { localeNum, t, tf } from "../i18n.ts";
import { UPLOAD_MAX_MB } from "../../shared/limits.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";

/** The hero as it stands. The stored value is whatever the admin typed, so it
 *  goes down the same resolution ladder a note's `banner:` does — and this
 *  modal, the one place the value can be fixed, says outright when it names
 *  nothing rather than showing a blank frame. */
function CurrentHomeBanner({ value }: { value: string }) {
  const { src, missing } = useBannerSrc(value);
  return (
    <div className={`s-bmodal__current${missing ? " s-bmodal__current--missing" : ""}`}>
      {src ? <img src={src} alt="" /> : <span className="s-bmodal__missing">{t("bannerMissing")}</span>}
      <span className="s-bmodal__currentpath" dir="auto">
        {value}
      </span>
    </div>
  );
}

export default function HomeBannerModal({ onClose }: { onClose: () => void }) {
  const current = useStore((s) => s.home?.banner ?? null);

  const [url, setUrl] = useState("");
  const [filter, setFilter] = useState("");
  const [attachments, setAttachments] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Esc closes (capture phase — nothing below may swallow it first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    let disposed = false;
    listAttachments(true)
      .then((list) => {
        if (!disposed) setAttachments(list);
      })
      .catch(() => {
        if (!disposed) setAttachments([]);
      });
    requestAnimationFrame(() => urlInputRef.current?.focus());
    return () => {
      disposed = true;
    };
  }, []);

  const apply = useCallback(
    (value: string | null) => {
      if (busy) return;
      setBusy(true);
      patchSettings({ home: { banner: value } })
        .then((settings) => {
          useStore.getState().setHome(settings.home ?? null);
          toast(value === null ? t("homeBannerRemoved") : t("homeBannerSet"));
          onClose();
        })
        .catch((err: unknown) => {
          console.error("vellum: saving home banner failed", err);
          toast(err instanceof Error ? err.message : t("homeBannerFailed"));
        })
        .finally(() => setBusy(false));
    },
    [busy, onClose],
  );

  const upload = useCallback(
    (file: File) => {
      if (busy) return;
      setBusy(true);
      uploadAttachment(file, true)
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
    [busy, apply],
  );

  const filtered = (attachments ?? []).filter((p) =>
    p.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div className="s-palette-overlay" onMouseDown={onClose}>
      <div
        className="s-bmodal"
        role="dialog"
        aria-label={t("homeBannerAria")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="s-bmodal__head">
          <span className="s-bmodal__title">
            {t("homeBannerTitle")} — <em>{t("homeBannerSubtitle")}</em>
          </span>
          <button type="button" className="s-bmodal__close" onClick={onClose} aria-label={t("close")}>
            ×
          </button>
        </div>

        {current && <CurrentHomeBanner value={current} />}

        <div className="s-bmodal__row">
          <input
            ref={urlInputRef}
            className="s-bmodal__input"
            type="text"
            placeholder={t("bannerUrlPlaceholder")}
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

        <div
          className={`s-bmodal__drop${dragOver ? " s-bmodal__drop--over" : ""}`}
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
          {busy ? t("working") : t("dropImage")}
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
        </div>

        <div className="s-bmodal__pick">
          <input
            className="s-bmodal__input"
            type="text"
            placeholder={t("searchAttachments")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            spellCheck={false}
          />
          <div className="s-bmodal__list">
            {attachments === null && <div className="s-bmodal__empty">{t("loading")}</div>}
            {attachments !== null && filtered.length === 0 && (
              <div className="s-bmodal__empty">
                {attachments.length === 0 ? t("noAttachments") : t("noMatchesDot")}
              </div>
            )}
            {filtered.slice(0, 200).map((p) => (
              <button
                key={p}
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
