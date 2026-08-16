// The strip an admin sees while previewing the public site.
//
// It is a STRIP AT THE TOP that takes up layout space, not a floating pill.
// Preview exists so the owner can judge his own site, and a bar hovering over
// the layout — top or bottom — hides the very thing being judged: a sticky
// masthead behind it, a footer or a comment box under it. So in the app shell
// it is a grid row above the panes, and in the blog shell it is the first
// element in the flow, sticky at the top with the blog nav parked beneath it
// (app.css offsets .s-blog-nav while the strip is up).
//
// Exit hands the session back to the full admin app on the same note; Esc
// does the same (App owns that key), and a reload does it too — preview is
// never persisted.

import { t } from "../i18n.ts";
import { useStore } from "../state.ts";

export default function PreviewBanner() {
  const preview = useStore((s) => s.previewVisitor);
  useStore((s) => s.language); // re-render the chrome strings on language change
  if (!preview) return null;
  return (
    <div className="s-preview-strip" role="status">
      <span className="s-preview-strip__icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </span>
      <span className="s-preview-strip__text">{t("previewingPublicSite")}</span>
      <span className="s-preview-strip__hint">{t("previewStripHint")}</span>
      <button
        type="button"
        className="s-preview-strip__exit"
        onClick={() => void useStore.getState().setPreviewVisitor(false)}
        title={t("exitPreviewTitle")}
      >
        {t("exitPreview")}
        <kbd className="s-kbd s-preview-strip__kbd">Esc</kbd>
      </button>
    </div>
  );
}
