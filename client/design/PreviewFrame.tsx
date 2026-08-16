// THE FRAME — a real viewport for the preview, inside the panel.
//
// `DesignCanvas` answers "draw this design"; this answers "draw it somewhere a
// reader's browser would". They are different questions and only the second one
// can be answered by a document of its own.
//
// WHY AN IFRAME AND NOT A DIV, in the three places a div is a LIE:
//
//  1. MEDIA QUERIES ANSWER THE WINDOW, NEVER THE BOX. `design.css` carries
//     `@media (max-width: 700px)` — the rule that drops the designed grid to
//     one column and lifts every target to 44px. A 390px-wide div inside a
//     1440px window matches none of it, so a "phone" preview built from a
//     narrow div shows the DESKTOP design squeezed into a phone's width: the
//     one picture of a phone that is guaranteed wrong. Inside a frame the
//     query resolves against the frame's own viewport and the phone preview is
//     the phone.
//  2. THE APP'S CASCADE REACHES INTO THE PANE. The designed site is a visitor
//     surface and the panel is admin chrome; in one document they share
//     `:root`, the scrollbar rules, the `button { font: inherit }` reset and
//     every future selector anybody writes for the designer. The frame has its
//     own document and inherits the app's stylesheets DELIBERATELY, by the
//     clone below — the site's styles, not the panel's accidents.
//  3. `position: sticky` AND `100vh` NEED A SCROLLPORT. A sticky header
//     resolves against the nearest scroll container; in the panel that is a div
//     the reader cannot see the top of, so the canvas had to drop stickiness
//     altogether. The frame's own document IS the scrollport, so a sticky
//     header pins where a reader would see it pin, and the author can finally
//     judge the switch that turns it on.
//
// WHY `about:blank` AND NOT `srcdoc` OR A ROUTE. The shell's CSP is
// `frame-src 'none'` (server/index.ts) and it stays that way: it is what stops
// a stray injection from framing something. That directive is checked on frame
// NAVIGATIONS — `srcdoc` and any URL are refused — while a frame with no `src`
// is the initial `about:blank`, which is not a navigation and inherits the
// parent's origin AND the parent's policy. So this costs nothing in the
// header, the portal can reach into the document (same origin), and everything
// inside runs under exactly the restrictions the app itself runs under. A
// route (`/?preview=…`) would have meant a second page load, a second React
// bundle and a second copy of the store per keystroke.
//
// WHY THE STYLESHEETS ARE CLONED rather than re-linked from a manifest: there
// is exactly one place that knows what CSS this build has, and it is
// `document.head`. Cloning it means the frame gets the theme sheet, the
// generated custom-theme sheet, an operator's `custom.css`, the uploaded
// `@font-face` blocks and Vite's dev-mode injected styles, in that order,
// forever, with no list to keep in sync. `<link>` clones hit the HTTP cache,
// so it is not a second download either.

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/** Root attributes the app paints its theme and its language with. Mirrored on
 *  every change: a theme switch behind the panel repaints the preview, and an
 *  Arabic instance previews an RTL site. `data-custom-theme` matters most —
 *  a custom theme is keyed at the root and can be defined nowhere else. */
const ROOT_ATTRS = ["data-theme", "data-custom-theme", "dir", "lang"] as const;

/** The two attributes a theme choice IS (client/design/customThemes.ts). */
export interface FrameTheme {
  theme: string;
  custom: string | null;
}

/** The frame's own reset. Four rules, and each one is the difference between a
 *  document and a component: the body is the page's ground, the canvas's
 *  BOX chrome (its radius, its clip, its fade) belongs to a card in a gallery
 *  and not to a viewport, and the page inside a real viewport is live rather
 *  than a picture. Colours are tokens — the cloned sheets bring them. */
const FRAME_RESET = `
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--text); }
  /* NO FLASH OF RAW HTML. This block is an inline <style> and applies at once;
     the cloned <link>s do not, even from cache. The page is therefore hidden
     until they have answered (or a second has passed, so a sheet that 404s
     never leaves an empty pane), which is the difference between a preview
     that opens and one that blinks. */
  body { visibility: hidden; }
  html[data-vellum-ready] body { visibility: visible; }
  .s-dsgf-mount { height: 100%; }
  /* The canvas fills the frame instead of being a card in a grid: no rounded
     corner, no clip, no fade at a cut that does not exist. */
  .s-dsgv.s-dsgv--live {
    height: 100%;
    border-radius: 0;
    overflow: visible;
    background: transparent;
  }
  .s-dsgv.s-dsgv--live::after { content: none; }
  /* THE SCROLLER IS PUT BACK WHERE THE LIVE SITE KEEPS IT. app.css clips
     html/body/#root — the app grid owns all scrolling — and the visitor's
     designed page scrolls inside .s-dsn itself. Both of those sheets are
     cloned in here, so a frame that let the DOCUMENT scroll would be a frame
     nothing could scroll (clipped html) or one whose sticky header resolved
     against a scrollport the real site does not have. Restoring .s-dsn as the
     scrollport makes the frame the visitor's arrangement exactly: same
     scroller, same sticky, same overscroll. */
  .s-dsgv.s-dsgv--live .s-dsgv__page.s-dsn {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    /* A frame is somewhere you can hover. Turning pointer events off is right
       for a picture of a page in a gallery card and wrong for the pane an
       author is using to judge their own link colours. */
    pointer-events: auto;
    user-select: text;
  }
`;

export interface PreviewFrameProps {
  /** The frame's accessible name. It is a real nested document and browsers
   *  announce it; an unnamed frame is announced as "frame". */
  title: string;
  /**
   * THE DESIGN'S OWN THEME, WHEN IT NAMES ONE.
   *
   * A design carries a theme and it is FORCED on every reader who has not
   * chosen one — so the pane an author spends the whole session in has to be
   * painted in it. Without this the frame mirrored the OPERATOR's `data-theme`
   * and the session held a three-way disagreement: the gallery card sold the
   * design in its own palette, the editor then drew it in yours, and the
   * shipped site was a third thing.
   *
   * The frame is the one preview surface that can honour a `custom:` choice
   * too: the generated stylesheet keys `:root[data-custom-theme]`, and the
   * frame's document has a root of its own. `null` means the design inherits,
   * which is a real answer — mirror the app.
   */
  ownTheme?: FrameTheme | null;
  className?: string;
  style?: CSSProperties;
  /** Rendered INTO the frame's document, by portal — same React tree, same
   *  store, same hooks, another document. */
  children: ReactNode;
  /** The frame's document, once it exists. The stage uses it to keep the
   *  reader's scroll position honest across a device switch. */
  onReady?: (doc: Document) => void;
}

export default function PreviewFrame({
  title,
  ownTheme = null,
  className,
  style,
  children,
  onReady,
}: PreviewFrameProps) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  // Read through a ref by the observer below, so changing the design's theme
  // repaints the frame WITHOUT tearing down a document, its clones, its
  // observers and the author's scroll position.
  const themeRef = useRef(ownTheme);
  themeRef.current = ownTheme;

  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    // The initial `about:blank` is present synchronously in Chromium and
    // arrives with `load` in others — and a frame that is moved in the DOM
    // gets a FRESH document, which is why `prepare` is idempotent and the
    // listener stays attached for the pane's whole life.
    const prepare = (): void => {
      const doc = frame.contentDocument;
      if (disposed || !doc || !doc.body) return;
      if (doc.documentElement.hasAttribute("data-vellum-frame")) return;
      doc.documentElement.setAttribute("data-vellum-frame", "");
      cleanup?.();
      cleanup = dress(doc, themeRef, () => {
        if (!disposed) setMount(null);
      });
      const host = doc.createElement("div");
      host.className = "s-dsgf-mount";
      doc.body.appendChild(host);
      readyRef.current?.(doc);
      setMount(host);
    };

    prepare();
    frame.addEventListener("load", prepare);
    return () => {
      disposed = true;
      frame.removeEventListener("load", prepare);
      cleanup?.();
      setMount(null);
    };
  }, []);

  // A THEME CHANGE IS A REPAINT, NEVER A REBUILD. Applying a preset or
  // pressing a card in the theme grid changes two attributes on the frame's
  // root; tearing the document down for it would drop the clones, the
  // observers and the author's place in their own page.
  useEffect(() => {
    refreshFrameTheme(ref.current?.contentDocument ?? null);
  }, [ownTheme?.theme, ownTheme?.custom, mount]);

  return (
    <>
      <iframe
        ref={ref}
        title={title}
        className={className}
        style={style}
        // Sequential focus never enters the preview. Everything inside is a
        // copy of a control the panel already offers, one that goes nowhere by
        // design, so a keyboard reader tabbing through the designer must not
        // have to walk a whole site's navigation to reach the Save button. The
        // pointer still hovers, clicks still land (and are swallowed), and the
        // page inside stays `aria-hidden` for the same reason.
        tabIndex={-1}
      />
      {/* ONE React tree across two documents. The children are reconciled in
          place, so a keystroke repaints a heading rather than remounting a
          site — and the frame's scroll position, which is the author's place
          in their own page, survives every edit. */}
      {mount !== null && createPortal(children, mount)}
    </>
  );
}

/**
 * Furnish a fresh frame document: the app's stylesheets, the app's theme, the
 * app's language, and one rule about navigation. Returns the teardown.
 */
function dress(
  doc: Document,
  theme: { current: FrameTheme | null },
  onGone: () => void,
): () => void {
  const root = document.documentElement;

  // NO `<base>` ELEMENT, and the reason is worth keeping. Relative URLs — the
  // cloned `<link href>`s, and every `/api/file?path=…` a banner renders —
  // have to resolve against the app's origin rather than against
  // `about:blank`, and the first instinct is to write one. Two facts make that
  // both wrong and unnecessary: an `about:blank` document INHERITS its
  // creator's base URL by spec (measured: banners resolve to
  // `http://host/api/file?path=Media%2Fkyoto.jpg` with no base element
  // present), and the shell's CSP is `base-uri 'none'`, so the element is
  // refused and logs a violation on every open. A rule that says "this
  // document's base cannot be moved" is a rule this preview has no business
  // arguing with.
  const reset = doc.createElement("style");
  reset.textContent = FRAME_RESET;

  // THE SYNC IS A DIFF, NOT A REBUILD, and that is not an optimisation. A
  // cloned `<link>` applies ASYNCHRONOUSLY — even straight out of the HTTP
  // cache — so a sync that re-clones the whole head hands the frame a moment
  // with a removed sheet and an unapplied one: a flash of raw HTML in the
  // middle of the panel, caught in a screenshot the first time the head
  // changed while the designer was open. Nodes that are still there are LEFT
  // ALONE (never re-appended either — re-inserting a link re-runs its fetch);
  // only genuine arrivals are cloned and only genuine departures removed.
  const clones = new Map<string, HTMLElement>();
  // The frame's own reset goes in FIRST and stays LAST in the head: it
  // overrides the canvas's card chrome, and every clone is inserted before it.
  doc.head.appendChild(reset);

  const syncStyles = (): void => {
    const wanted = [
      ...document.head.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style'),
    ];
    const keys = new Set<string>();
    for (const node of wanted) {
      const key = styleKey(node);
      keys.add(key);
      if (clones.has(key)) continue;
      const copy = node.cloneNode(true) as HTMLElement;
      copy.setAttribute("data-vellum-clone", "");
      doc.head.insertBefore(copy, reset);
      clones.set(key, copy);
    }
    for (const [key, node] of clones) {
      if (keys.has(key)) continue;
      node.remove();
      clones.delete(key);
    }
  };

  // THE DESIGN'S THEME WINS OVER THE OPERATOR'S, and only over the two
  // attributes that carry it: `dir` and `lang` are the INSTANCE's and are
  // mirrored whatever the design says, because a design does not choose the
  // language its site is written in.
  const syncRoot = (): void => {
    const own = theme.current;
    for (const name of ROOT_ATTRS) {
      const value =
        own && name === "data-theme"
          ? own.theme
          : own && name === "data-custom-theme"
            ? own.custom
            : root.getAttribute(name);
      if (value === null) doc.documentElement.removeAttribute(name);
      else doc.documentElement.setAttribute(name, value);
    }
  };

  syncStyles();
  syncRoot();
  // The design's theme can change under a live frame (a card in the theme
  // grid, a preset applied) and that is not a document rebuild — the stage
  // calls this back through the handle below.
  themeSyncs.set(doc, syncRoot);

  // Reveal once the first set of sheets has answered — or after a second,
  // whichever comes first.
  const links = [...clones.values()].filter(
    (node): node is HTMLLinkElement => node instanceof HTMLLinkElement,
  );
  const reveal = (): void => doc.documentElement.setAttribute("data-vellum-ready", "");
  if (links.length === 0) reveal();
  else {
    let left = links.length;
    const settle = (): void => {
      if (--left <= 0) reveal();
    };
    for (const link of links) {
      if (link.sheet) settle();
      else {
        link.addEventListener("load", settle, { once: true });
        link.addEventListener("error", settle, { once: true });
      }
    }
  }
  const revealTimer = setTimeout(reveal, 1000);

  const headWatch = new MutationObserver(syncStyles);
  headWatch.observe(document.head, { childList: true, subtree: true, characterData: true });
  const rootWatch = new MutationObserver(syncRoot);
  rootWatch.observe(root, { attributes: true, attributeFilter: [...ROOT_ATTRS] });

  // NOTHING INSIDE A PREVIEW ACTS. Every link in there points at the real
  // site, and following one would replace the pane with a page that has no way
  // back. Capture-phase and on the frame's own document, because React's
  // synthetic events do not cross a document boundary: a portal's listeners
  // live on the root container in the OUTER document, and an event in here
  // bubbles to `about:blank`'s window and stops. The canvas's own swallow is
  // therefore correct and inert in this one place, and this is its stand-in.
  const swallow = (e: Event): void => {
    e.preventDefault();
    e.stopPropagation();
  };
  const guardKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter" || e.key === " ") swallow(e);
  };
  doc.addEventListener("click", swallow, true);
  doc.addEventListener("auxclick", swallow, true);
  doc.addEventListener("submit", swallow, true);
  doc.addEventListener("dragstart", swallow, true);
  doc.addEventListener("keydown", guardKey, true);

  const win = doc.defaultView;
  const onUnload = (): void => onGone();
  win?.addEventListener("pagehide", onUnload);

  return () => {
    clearTimeout(revealTimer);
    themeSyncs.delete(doc);
    headWatch.disconnect();
    rootWatch.disconnect();
    doc.removeEventListener("click", swallow, true);
    doc.removeEventListener("auxclick", swallow, true);
    doc.removeEventListener("submit", swallow, true);
    doc.removeEventListener("dragstart", swallow, true);
    doc.removeEventListener("keydown", guardKey, true);
    win?.removeEventListener("pagehide", onUnload);
  };
}

/** Every live frame document and the function that repaints its root. A module
 *  map rather than a ref chain: `dress()` owns the writing, the component owns
 *  the prop, and neither has to hold the other. */
const themeSyncs = new Map<Document, () => void>();

/** Repaint a live frame's root from the latest `ownTheme`. */
export function refreshFrameTheme(doc: Document | null): void {
  if (doc) themeSyncs.get(doc)?.();
}

/** What makes a style node the same node as last time. An href for a link, the
 *  text for an inline block — so an HMR edit to one rule is a change and a
 *  re-render that touched nothing is not. */
function styleKey(node: HTMLElement): string {
  if (node instanceof HTMLLinkElement) return `L:${node.getAttribute("href") ?? ""}`;
  return `S:${node.textContent ?? ""}`;
}
