// A CODE-SPLIT SURFACE THAT CANNOT BE FETCHED IS NOT A BLANK APP.
//
// v1.8 client-solidity audit, finding B2. Every surface in this client arrives
// through `lazy(() => import("..."))`, and vite stamps a content hash into
// every chunk filename. Redeploy the server while a reader has the app open —
// which is exactly what a `git pull && npm start` does — and the next surface
// they reach requests a filename that no longer exists. The import rejects,
// React's `lazy` rethrows the rejection at the boundary, and with no error
// boundary above it (there was none) the whole tree unmounted: a white page,
// mid-sentence, from pressing Ctrl+G.
//
// The boundary above (client/ErrorBoundary.tsx) would now catch it, but a
// crash card is the wrong answer for this one. Nothing is broken; a FILE moved.
// So the chunk failure is caught HERE, at the one seam that knows which surface
// failed, and resolves — successfully — into a small card that says so and
// offers the reload that fixes it. The rest of the app stays on screen and the
// buffers stay in memory.

import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import { t } from "./i18n.ts";

/** The card a missing chunk becomes. Sized to sit inside whatever slot the
 *  surface would have filled — a modal's hole, a pane, the sidebar — so it
 *  never has an opinion about the layout it lands in. */
function ChunkGone(): React.JSX.Element {
  return (
    <div className="s-chunkgone" role="alert">
      <p className="s-chunkgone__body">{t("chunkGone")}</p>
      <button
        type="button"
        className="s-chunkgone__action"
        onClick={() => location.reload()}
      >
        {t("crashReload")}
      </button>
    </div>
  );
}

/** `lazy()`, with the failure handled.
 *
 *  ONE retry before giving up, and it is not superstition: the common causes
 *  are a dropped connection and a redeploy, and the first of those succeeds on
 *  a second attempt while the second cannot (the browser has cached the 404
 *  and the file is genuinely gone). Distinguishing them costs a round trip and
 *  a reader who is already waiting; taking the round trip once is the cheaper
 *  of the two wrong answers.
 *
 *  Note what this does NOT do: it never rejects. React caches a rejected lazy
 *  promise forever, so a surface that failed once would keep failing for the
 *  life of the session even after the network came back — resolving into a
 *  card keeps that damage to the mount that actually failed. */
export function lazySurface<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(async () => {
    try {
      return await load();
    } catch (first) {
      try {
        return await load();
      } catch (err) {
        console.error("vellum: a surface chunk could not be loaded", first, err);
        return { default: ChunkGone as unknown as ComponentType<P> };
      }
    }
  });
}
