// The attachment viewer: what a click on a non-note file in the sidebar tree
// opens. Dark scrim, the file centered at its NATURAL size capped to the
// viewport, and one caption line that answers the three questions a reader has
// about a file they had lost track of — what is it called, how big is it (in
// pixels and in bytes), and where does it sit among its neighbors ("3 / 47").
//
// It is rendered through a portal onto <body>: the opener is the sidebar,
// which is a grid pane that animates its own width and clips its overflow, and
// a lightbox must not be trapped inside it.
//
// Scope: the viewer only ever fetches /api/file?path=, the same gated route
// every embed uses — a visitor's request for a file outside the published
// allowlist 404s there exactly like a file that does not exist. Nothing here
// widens that; the viewer cannot show what the server will not serve.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AttachmentKind, TreeNode } from "../../shared/types.ts";
import { getNumerals, localeNum, t } from "../i18n.ts";
import { metaSepText } from "../metaSep.tsx";
import { toNumerals } from "../../shared/numerals.ts";
import "../styles/attachments.css";

/** Kinds the viewer displays itself. PDFs are not among them: browsers render
 *  them far better in their own tab, which is where a click sends them, so
 *  they never enter the carousel either. */
const VIEWABLE: ReadonlySet<AttachmentKind> = new Set<AttachmentKind>([
  "image",
  "audio",
  "video",
  "other",
]);

export function isViewable(node: TreeNode): boolean {
  return node.attachment !== undefined && VIEWABLE.has(node.attachment.kind);
}

export function fileUrl(path: string): string {
  return `/api/file?path=${encodeURIComponent(path)}`;
}

/** "1.4 MB" in the instance's numeral system. Numbers in the chrome go through
 *  localeNum(); the one decimal here needs the Arabic decimal separator too
 *  (U+066B), or an Arabic instance prints Eastern digits around a Latin dot. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${localeNum(bytes)} ${t("unitBytes")}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${localeNum(Math.round(kb))} ${t("unitKB")}`;
  const mb = (kb / 1024).toFixed(1);
  const num = getNumerals() === "arab" ? toNumerals(mb, "arab").replace(".", "٫") : mb;
  return `${num} ${t("unitMB")}`;
}

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function IconExternal() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 19h16" />
    </svg>
  );
}

interface Props {
  /** The viewable attachments of ONE folder, in tree order. */
  items: TreeNode[];
  index: number;
  onIndex(next: number): void;
  onClose(): void;
}

export default function AttachmentViewer({ items, index, onIndex, onClose }: Props) {
  const item = items[index];
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<Element | null>(null);

  const step = useCallback(
    (delta: number) => {
      if (items.length < 2) return;
      onIndex((index + delta + items.length) % items.length); // wraps
    },
    [index, items.length, onIndex],
  );

  // A new file means new intrinsic dimensions and a fresh error state.
  useEffect(() => {
    setDims(null);
    setFailed(false);
  }, [item?.path]);

  // Focus the panel so the arrow keys have somewhere to land, and hand focus
  // back to the tree row when the viewer closes (the same courtesy Confirm
  // pays; without it the reader's next Tab starts from the top of the page).
  useEffect(() => {
    restoreRef.current = document.activeElement;
    panelRef.current?.focus();
    return () => {
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    };
  }, []);

  // Neighbors are prefetched so arrowing through a folder of scans does not
  // flash an empty frame between them. Images only — no one wants a video
  // fetched they have not asked to watch.
  useEffect(() => {
    if (items.length < 2) return;
    for (const delta of [1, -1]) {
      const neighbor = items[(index + delta + items.length) % items.length];
      if (neighbor?.attachment?.kind === "image") new Image().src = fileUrl(neighbor.path);
    }
  }, [index, items]);

  // Capture phase, like the confirm dialog: while the viewer is open it owns
  // Esc and the arrows, ahead of zen's Esc and of any editor binding.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      // The arrows are physical keys, so they answer the physical layout: in
      // an RTL shell the NEXT file is the one to the left.
      const rtl = getComputedStyle(document.documentElement).direction === "rtl";
      const forward = e.key === (rtl ? "ArrowLeft" : "ArrowRight");
      step(forward ? 1 : -1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, step]);

  const meta = useMemo(() => {
    if (!item?.attachment) return "";
    const parts: string[] = [];
    if (item.attachment.ext) parts.push(item.attachment.ext.toUpperCase());
    if (dims) parts.push(`${localeNum(dims.w)} × ${localeNum(dims.h)}`);
    if (item.attachment.size > 0) parts.push(formatSize(item.attachment.size));
    return parts.join(metaSepText());
  }, [item?.attachment, dims]);

  if (!item) return null;
  const kind = item.attachment?.kind ?? "other";
  const src = fileUrl(item.path);

  // A file the browser cannot decode still gets the card, not a bare sentence
  // on the scrim: the reader's next move is the download button beside it.
  const body = failed ? (
    <div className="s-att-view__blank">
      <span className="s-att-view__ext" aria-hidden="true">
        {item.attachment?.ext.toUpperCase() || "?"}
      </span>
      <p className="s-att-view__empty">{t("fileLoadFailed")}</p>
    </div>
  ) : kind === "image" ? (
    <img
      className="s-att-view__img"
      src={src}
      alt={item.name}
      onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      onError={() => setFailed(true)}
    />
  ) : kind === "audio" ? (
    <audio className="s-att-view__audio" src={src} controls onError={() => setFailed(true)} />
  ) : kind === "video" ? (
    <video className="s-att-view__video" src={src} controls onError={() => setFailed(true)} />
  ) : (
    <div className="s-att-view__blank">
      <span className="s-att-view__ext" aria-hidden="true">
        {item.attachment?.ext.toUpperCase() || "?"}
      </span>
      <p className="s-att-view__empty">{t("noPreviewFor")}</p>
    </div>
  );

  return createPortal(
    <div className="s-att-scrim" onMouseDown={onClose}>
      <div
        ref={panelRef}
        className="s-att-view"
        role="dialog"
        aria-modal="true"
        aria-label={t("attachmentViewer")}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="s-att-view__stage">{body}</div>

        <div className="s-att-view__bar">
          <span className="s-att-view__name" dir="auto">{item.name}</span>
          <span className="s-att-view__meta">{meta}</span>
          {items.length > 1 && (
            <span className="s-att-view__pos">
              {localeNum(index + 1)} / {localeNum(items.length)}
            </span>
          )}
          <a
            className="s-att-view__act"
            href={src}
            target="_blank"
            rel="noopener noreferrer"
            title={t("openInNewTab")}
            aria-label={t("openInNewTab")}
          >
            <IconExternal />
          </a>
          <a
            className="s-att-view__act"
            href={src}
            download={item.name}
            title={t("downloadFile")}
            aria-label={t("downloadFile")}
          >
            <IconDownload />
          </a>
          <button
            type="button"
            className="s-att-view__act s-att-view__act--close"
            onClick={onClose}
            title={t("closeViewer")}
            aria-label={t("closeViewer")}
          >
            <IconClose />
          </button>
        </div>

        {items.length > 1 && (
          <>
            {/* ‹ and › are Bidi_Mirrored: the browser flips the GLYPH under
                dir="rtl" on its own, and the buttons sit on logical edges, so
                the pair keeps pointing the way the reader travels with no
                RTL rule at all (CONTRACTS, "Do not mirror a directional
                glyph"). */}
            <button
              type="button"
              className="s-att-view__nav s-att-view__nav--prev"
              onClick={() => step(-1)}
              title={t("previousFile")}
              aria-label={t("previousFile")}
            >
              <span aria-hidden="true">‹</span>
            </button>
            <button
              type="button"
              className="s-att-view__nav s-att-view__nav--next"
              onClick={() => step(1)}
              title={t("nextFile")}
              aria-label={t("nextFile")}
            >
              <span aria-hidden="true">›</span>
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
