// The notice an admin sees IN THE APP when `publicLayout` is "designed" and
// the design is not being served.
//
// The designed site's own notice (DesignedSite's OwnerNotice) only exists on
// the page it is describing, and the owner is not usually on that page: they
// are in the editor, where nothing about the public site is visible at all.
// So the fallback has a second, quieter surface here — one line, the reason,
// and the same one-click rescue.
//
// This renders NOTHING unless `/api/me` carried `designNotice`, which the
// server sends only to a real admin session (never to a visitor, never to an
// admin wearing the preview header). A healthy designed instance never draws
// it, and no other layout can.

import { useState } from "react";
import { t, tf } from "../i18n.ts";
import { useStore } from "../state.ts";
import { patchSettings } from "../api.ts";
import { toast } from "../toast.ts";

export default function DesignStatus() {
  const notice = useStore((s) => s.designNotice);
  useStore((s) => s.language);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (!notice || dismissed) return null;

  const line =
    notice.reason === "quarantined"
      ? tf("dsnQuarantined", { design: notice.design ?? "", detail: notice.detail ?? "" })
      : notice.reason === "section"
        ? tf("dsnNoticeSection", { detail: notice.detail ?? "" })
        : // "Could not be read" is not "not made yet": the file is still on
          // disk, untouched, and the fix is to repair or re-import it — not to
          // start again over the top of it.
          notice.reason === "corrupt"
          ? t("dsnCorruptStore")
          : t("dsnNoDesign");

  const revert = async (): Promise<void> => {
    setBusy(true);
    try {
      await patchSettings({ publicLayout: "blog" });
      // Losslessly: designs.json is untouched, so flipping back to "designed"
      // returns the site exactly as it was. That is what makes this a rescue
      // rather than a decision.
      useStore.setState({ designNotice: null, publicLayout: "blog" });
      toast(t("dsnRevertedToast"));
    } catch (err) {
      console.error("vellum: reverting to the stock blog failed", err);
      toast(err instanceof Error ? err.message : t("dsnRevertFailed"), "error");
      setBusy(false);
    }
  };

  return (
    <div className="s-dsn-status" role="status">
      <span className="s-dsn-status__dot" aria-hidden="true" />
      <span className="s-dsn-status__text">
        <strong>{t("dsnBrokenTitle")}</strong> {line} {t("dsnFellBack")}
      </span>
      <button
        type="button"
        className="s-dsn-status__action"
        onClick={() => void revert()}
        disabled={busy}
      >
        {t("dsnRevertStock")}
      </button>
      <button
        type="button"
        className="s-dsn-status__close"
        onClick={() => setDismissed(true)}
        aria-label={t("close")}
        title={t("close")}
      >
        ×
      </button>
    </div>
  );
}
