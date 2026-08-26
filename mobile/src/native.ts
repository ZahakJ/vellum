import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

/** What a share sent us. Android hands over EXTRA_TEXT (the URL or the
 *  selection) and, for a page share, EXTRA_SUBJECT (its title). Either can be
 *  absent; a share with neither is not a capture and the sheet says so. */
export interface PendingShare {
  text?: string;
  subject?: string;
}

export interface VellumNativePlugin {
  /** The share this ACTIVITY was started with, if it was started by one. Read
   *  off the activity's own Intent rather than a static, so the connection
   *  screen and the capture sheet cannot ever see each other's launch. */
  pendingShare(): Promise<PendingShare>;

  /** A SECOND share, arriving at a sheet that is already up. The native side
   *  pushes it rather than reloading the page, because a reload asked for
   *  inside the activity's new-intent turn never happens — see
   *  ShareActivity.onNewIntent for the whole of that story. */
  addListener(eventName: "share", listener: (share: PendingShare) => void): Promise<PluginListenerHandle>;

  /** Trust this origin and go there. The host is remembered natively because
   *  the gate that uses it (`shouldOverrideLoad`) runs on pages where no
   *  Capacitor bridge exists — the served app is not our code. */
  connect(options: { url: string }): Promise<void>;

  /** Dismiss the capture sheet's activity. */
  closeShare(): Promise<void>;
}

export const VellumNative = registerPlugin<VellumNativePlugin>("Vellum");
