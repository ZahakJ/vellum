import { SplashScreen } from "@capacitor/splash-screen";
import "./styles.css";
import { dir, lang } from "./i18n.ts";
import { VellumNative, type PendingShare } from "./native.ts";
import { mountCapture } from "./capture.ts";
import { mountConnect } from "./connect.ts";

/**
 * One bundled page, two screens.
 *
 * There is no second HTML file, and that is load-bearing rather than tidy: the
 * share sheet runs in its own Activity with its own Bridge, and a Bridge always
 * loads `index.html` first. A `capture.html` would mean every share showed the
 * connection screen for a frame before being replaced. Asking the Activity's
 * own Intent which screen this is costs one bridge call and no flash.
 */
async function boot(): Promise<void> {
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;

  const root = document.getElementById("app");
  if (!root) return;

  let share: PendingShare = {};
  try {
    share = await VellumNative.pendingShare();
  } catch {
    // Running outside the app (a browser, a preview): there is no Intent to
    // read and the connection screen is the right answer.
  }

  if ("text" in share || "subject" in share) {
    await mountCapture(root, share);
    // A second share landing on a sheet that is already up. Only the capture
    // screen listens: the connection screen lives in the other task and a share
    // handed to the sheet is none of its business.
    await VellumNative.addListener("share", (next) => {
      void mountCapture(root, next);
    }).catch(() => {
      // Older shell, or no bridge at all. The first share is still on screen;
      // this only costs the owner the second one, which the sheet's own task
      // will show the next time it is opened.
    });
  } else {
    // `?pick=1` is set by MainActivity when the back gesture brought the owner
    // OUT of a connected instance — see VellumPlugin / MainActivity.
    const pick = new URLSearchParams(location.search).has("pick");
    await mountConnect(root, { pick });
  }

  // Held until here on purpose (`launchAutoHide: false`): the splash is the
  // same gold star on the same ground as the screen underneath it, so hiding it
  // after the first paint is a dissolve rather than a cut.
  await SplashScreen.hide().catch(() => {});
}

void boot();
