// Slim floating banner shown while an admin previews the public site.
// Rendered above BOTH visitor shells (blog and app view); fixed bottom-center
// so it never collides with the blog masthead or sticky nav. Exit hands the
// session back to the full admin app on the same note.

import { t } from "../i18n.ts";
import { useStore } from "../state.ts";

export default function PreviewBanner() {
  const preview = useStore((s) => s.previewVisitor);
  useStore((s) => s.language); // re-render the chrome strings on language change
  if (!preview) return null;
  return (
    <div className="s-preview-banner" role="status">
      <span className="s-preview-banner__icon" aria-hidden="true">
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
      <span className="s-preview-banner__text">{t("previewingPublicSite")}</span>
      <button
        type="button"
        className="s-preview-banner__exit"
        onClick={() => void useStore.getState().setPreviewVisitor(false)}
      >
        {t("exitPreview")}
      </button>
    </div>
  );
}
