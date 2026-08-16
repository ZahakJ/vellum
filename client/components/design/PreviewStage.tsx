// THE STAGE — the designer's live preview: a real page, at a real device
// width, updating as the author types.
//
// It owns three things the canvas deliberately does not:
//
//  1. A VIEWPORT, by way of `PreviewFrame`. The design is rendered into a
//     nested document whose width IS the device's, so `@media (max-width:700px)`
//     — the rule that collapses the designed grid and lifts every target to
//     44px — resolves the way it will on a reader's phone. Preview panes that
//     put the page in a narrow DIV show the desktop design squashed, which is
//     the one thing a responsive check must not do.
//  2. A DEVICE. Three widths, because there are three answers an author needs
//     and fifty would be a slider nobody moves twice: a 1280 desktop, an 834
//     tablet and a 390 phone (the width DESIGN.md measures the shell at). The
//     frame lays out at that width and the STAGE scales the pixels to its box,
//     so the phone stays phone-shaped in a pane twice its width instead of
//     being a picture of a narrow desktop.
//  3. A CLOCK. The draft changes on every keystroke and every slider tick, and
//     a composed page with eight banners is not free to lay out. The stage
//     redraws on a trailing 120 ms edge — under the ~150 ms an eye reads as
//     "instant", over the 16 ms budget a drag would otherwise blow — and says
//     so with one dot while it waits, because a preview that is silently
//     behind is a preview the author stops trusting.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DesignDoc } from "../../../shared/design.ts";
import DesignCanvas from "../../design/DesignCanvas.tsx";
import type { PreviewContent } from "../../design/previewContent.tsx";
import PreviewFrame from "../../design/PreviewFrame.tsx";
import { localeNum, t, tf, type I18nKey } from "../../i18n.ts";
import { SegmentedControl } from "../controls/Fields.tsx";

/** The three widths, and nothing between them. `desktop` is the width every
 *  preset was drawn against; `phone` is the width the shell's own overflow is
 *  measured at, so a design that survives it survives the gate. */
const DEVICES = {
  desktop: 1280,
  tablet: 834,
  phone: 390,
} as const;

export type DeviceName = keyof typeof DEVICES;

/** A LITERAL table, not `t(\`designDevice${name}\`)`: a key built from a
 *  variable is a key `check-i18n` cannot see, and the first one that gets
 *  renamed takes the label with it silently. */
const DEVICE_LABEL: Record<DeviceName, I18nKey> = {
  desktop: "designDeviceDesktop",
  tablet: "designDeviceTablet",
  phone: "designDevicePhone",
};

/** How long the preview waits after the last edit. */
const SETTLE_MS = 120;

export interface PreviewStageProps {
  design: DesignDoc;
  content: PreviewContent;
  route: "home" | "article";
}

export default function PreviewStage({ design, content, route }: PreviewStageProps) {
  const [device, setDevice] = useState<DeviceName>("desktop");
  /** `fit` scales the whole page into the pane; `actual` draws it at 1:1 and
   *  lets the stage scroll. Both are honest — the first answers "what shape is
   *  this page", the second "can I read this type" — and a designer needs both
   *  without leaving the panel. */
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");
  const shown = useSettled(design, SETTLE_MS);
  const pending = shown !== design;

  const width = DEVICES[device];
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // The pane's box, remeasured on every reflow. A window resize is only one of
  // the ways it changes — the panel is a dialog with its own grid, and the
  // designer's controls column changes width with the tab.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const obs = new ResizeObserver(read);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // NEVER SCALE UP. A phone laid out at 390 and blown up to 700 would show an
  // author type twice the size their reader gets, which is exactly the mistake
  // a preview exists to prevent.
  const fitScale = size.w > 0 ? Math.min(1, (size.w - STAGE_PAD * 2) / width) : 1;
  const scale = zoom === "actual" ? 1 : fitScale;
  // The frame is as tall as the pane divided by the scale, so a scaled page
  // still fills the pane vertically and a 1:1 page scrolls inside its own
  // document rather than inside two.
  const height = Math.max(320, Math.round((size.h - STAGE_PAD * 2) / scale));

  const label = useMemo(
    () => tf("designPreviewFrame", { name: design.name }),
    [design.name],
  );

  // A DIFFERENT PAGE STARTS AT ITS TOP. The frame keeps its scroll position
  // across every edit — that is the whole point of reconciling into it rather
  // than remounting — but switching from the front page to the article page is
  // a NAVIGATION, and a navigation that lands halfway down a page nobody was
  // reading looks like a bug in the design. `.s-dsn` is the scrollport inside
  // the frame, exactly as it is on the live site (PreviewFrame says why).
  const frameDoc = useRef<Document | null>(null);
  useLayoutEffect(() => {
    frameDoc.current?.querySelector(".s-dsn")?.scrollTo({ top: 0 });
  }, [route]);

  // AT 1:1 THE PAGE IS WIDER THAN THE PANE, so the stage scrolls — and it must
  // open in the MIDDLE. A designed page is centred in its viewport, so a stage
  // parked at scroll 0 shows the reader's left margin and half the measure:
  // the one view of a page at actual size that answers nothing.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || zoom !== "actual") return;
    el.scrollLeft = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
  }, [zoom, width]);

  return (
    <div className={`s-dsgs${pending ? " s-dsgs--pending" : ""}`}>
      <div className="s-dsgs__bar">
        <SegmentedControl
          value={device}
          onChange={(value) => setDevice(value as DeviceName)}
          label={t("designDevice")}
          segments={(Object.keys(DEVICES) as DeviceName[]).map((name) => ({
            value: name,
            label: t(DEVICE_LABEL[name]),
          }))}
        />
        <span className="s-dsgs__meta">
          {tf("designPreviewWidth", { w: localeNum(width) })}
          {/* The dot is the clock made visible: lit while the page on screen
              is one edit behind the draft, dark the instant it catches up. */}
          <span className="s-dsgs__pulse" aria-hidden="true" />
        </span>
        <button
          type="button"
          className={`s-dsgs__zoom${zoom === "actual" ? " s-dsgs__zoom--on" : ""}`}
          onClick={() => setZoom(zoom === "fit" ? "actual" : "fit")}
          aria-pressed={zoom === "actual"}
        >
          {zoom === "actual" ? t("designZoomFit") : t("designZoomActual")}
        </button>
      </div>

      <div
        ref={box}
        className={`s-dsgs__stage s-dsgs__stage--${zoom}`}
        data-device={device}
      >
        {size.w > 0 && (
          <div
            className="s-dsgs__device"
            // The wrapper carries the SCALED size so the flexbox centring, the
            // stage's scrollbars and the device's own shadow all agree with
            // what the eye sees; the frame inside keeps its true pixels.
            style={{ width: `${width * scale}px`, height: `${height * scale}px` }}
          >
            <PreviewFrame
              title={label}
              onReady={(doc) => {
                frameDoc.current = doc;
              }}
              className="s-dsgs__frame"
              style={{
                width: `${width}px`,
                height: `${height}px`,
                transform: `scale(${scale})`,
              }}
            >
              <DesignCanvas
                design={shown}
                content={content}
                fit="native"
                route={route}
                live
                label={label}
              />
            </PreviewFrame>
          </div>
        )}
      </div>

      {content.synthetic && <p className="s-dsgs__note">{t("presetSampleNote")}</p>}
    </div>
  );
}

/** The stage's own padding, in px, on each side of the device. Kept in JS
 *  because the scale factor is computed against it; the stylesheet reads the
 *  same number from `--dsgs-pad`. */
const STAGE_PAD = 16;

/**
 * The trailing edge of a stream of edits.
 *
 * Deliberately identity-based rather than deep-equal: every control in the
 * panel writes a NEW document object, so identity is exactly "the author
 * changed something", and a deep compare of a design on every keystroke costs
 * more than the render it would save.
 */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (settled === value) return;
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms, settled]);
  return settled;
}
