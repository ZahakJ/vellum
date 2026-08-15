// Dashboard "Change banner…" modal — the home-page cousin of the note
// BannerModal (same s-bmodal chrome): paste a URL, pick a vault attachment,
// or upload; saves to settings.home.banner via PATCH /api/settings. Reached
// only from inside visitor preview, so every call here rides asAdmin (the
// preview header would make the server treat the admin as a stranger).

import { useCallback, useEffect, useRef, useState } from "react";
import { listAttachments, patchSettings, uploadAttachment } from "../api.ts";
import { bannerSrc } from "../banner.ts";
import { useStore } from "../state.ts";
import { toast } from "../toast.ts";

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
          toast(value === null ? "Home banner removed" : "Home banner set");
          onClose();
        })
        .catch((err: unknown) => {
          console.error("vellum: saving home banner failed", err);
          toast(err instanceof Error ? err.message : "Saving the banner failed");
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
          toast(err instanceof Error ? err.message : "Upload failed");
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
        aria-label="Change home banner"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="s-bmodal__head">
          <span className="s-bmodal__title">
            Home banner — <em>dashboard hero</em>
          </span>
          <button type="button" className="s-bmodal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {current && (
          <div className="s-bmodal__current">
            <img src={bannerSrc(current)} alt="" />
            <span className="s-bmodal__currentpath" dir="ltr">
              {current}
            </span>
          </div>
        )}

        <div className="s-bmodal__row">
          <input
            ref={urlInputRef}
            className="s-bmodal__input"
            type="text"
            placeholder="Paste an image URL (https://…) or a vault path"
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
            Use
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
          {busy ? "Working…" : "Drop an image here, or click to choose a file"}
          <span className="s-bmodal__drophint">png · jpeg · webp · gif · svg — 10 MB max</span>
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
            placeholder="Search vault attachments…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            spellCheck={false}
          />
          <div className="s-bmodal__list">
            {attachments === null && <div className="s-bmodal__empty">Loading…</div>}
            {attachments !== null && filtered.length === 0 && (
              <div className="s-bmodal__empty">
                {attachments.length === 0 ? "No image attachments in the vault yet." : "No matches."}
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
              Remove banner
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
