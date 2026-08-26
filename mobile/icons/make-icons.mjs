#!/usr/bin/env node
// Every raster the APK ships, drawn from one path.
//
// The mark is ✦ — the four-pointed star from the app's own wordmark — in gold
// leaf on iron-gall. It is authored here as an SVG path rather than set as a
// font glyph, because the glyph is a different shape in every font on every
// phone, and a launcher icon is the one place a brand cannot be "whatever
// Roboto has".
//
//   node icons/make-icons.mjs        (needs ImageMagick's `magick` on PATH)
//
// Checked-in output, deliberately: android/app/src/main/res/**. This runs when
// the mark changes, not on every build — a build that shells out to ImageMagick
// is a build that fails on a machine without it.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const RES = join(HERE, "..", "android", "app", "src", "main", "res");

const IRON_GALL = "#16130e";
const GOLD = "#c9a227";

/** How pinched the star's waist is. Small k = long slender points, which is
 *  what the ✦ in the wordmark looks like; at k=1.5 it reads as a fat diamond. */
const WAIST = 0.65;

function starSvg(fill, size) {
  const c = 12;
  const k = WAIST;
  const d = [
    "M12,0.6",
    `Q${c + k},${c - k} 23.4,12`,
    `Q${c + k},${c + k} 12,23.4`,
    `Q${c - k},${c + k} 0.6,12`,
    `Q${c - k},${c - k} 12,0.6`,
    "Z",
  ].join(" ");
  // WIDTH AND HEIGHT, not just a viewBox. ImageMagick rasterizes an SVG at its
  // intrinsic size and only then applies `-resize`, so a viewBox-only file is
  // drawn at 24 px and blown up — which is exactly how a vector mark ends up
  // shipping as a blurry one.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">` +
    `<path d="${d}" fill="${fill}"/></svg>`
  );
}

const work = join(tmpdir(), `vellum-icons-${process.pid}`);
mkdirSync(work, { recursive: true });

function magick(args) {
  execFileSync("magick", args, { stdio: ["ignore", "ignore", "inherit"] });
}

/** The star, at `size` px, on transparency. */
function star(size, out) {
  const svg = join(work, `star-${size}.svg`);
  writeFileSync(svg, starSvg(GOLD, size));
  magick(["-background", "none", svg, out]);
}

/** The star centred on a canvas, with whatever ground is asked for. */
function plate(canvas, starSize, ground, out, mask) {
  const glyph = join(work, `glyph-${starSize}.png`);
  star(starSize, glyph);
  const args = ["-size", `${canvas}x${canvas}`, ground === null ? "xc:none" : `xc:${ground}`];
  if (mask) args.push(...mask(canvas));
  args.push(glyph, "-gravity", "center", "-composite", out);
  magick(args);
}

/** A rounded square, the shape Android draws a legacy icon into. */
const rounded = (canvas) => {
  const r = Math.round(canvas * 0.22);
  return [
    "(",
    "-size", `${canvas}x${canvas}`, "xc:none",
    "-fill", "white",
    "-draw", `roundrectangle 0,0 ${canvas - 1},${canvas - 1} ${r},${r}`,
    ")",
    "-alpha", "set",
    "-compose", "DstIn", "-composite", "-compose", "Over",
  ];
};

const circle = (canvas) => {
  const c = (canvas - 1) / 2;
  return [
    "(",
    "-size", `${canvas}x${canvas}`, "xc:none",
    "-fill", "white",
    "-draw", `circle ${c},${c} ${c},0`,
    ")",
    "-alpha", "set",
    "-compose", "DstIn", "-composite", "-compose", "Over",
  ];
};

// ── launcher icons ─────────────────────────────────────────────────────────
//
// The adaptive foreground is a 108dp canvas of which the launcher may crop to
// the inner 72dp and mask to any shape it likes. The star is drawn at 50% of
// the canvas — comfortably inside the safe circle at every mask, and small
// enough that a squircle launcher does not clip its points.
const LAUNCHER = [
  ["mdpi", 48, 108],
  ["hdpi", 72, 162],
  ["xhdpi", 96, 216],
  ["xxhdpi", 144, 324],
  ["xxxhdpi", 192, 432],
];

for (const [density, legacy, adaptive] of LAUNCHER) {
  const dir = join(RES, `mipmap-${density}`);
  mkdirSync(dir, { recursive: true });
  plate(adaptive, Math.round(adaptive * 0.5), null, join(dir, "ic_launcher_foreground.png"));
  plate(legacy, Math.round(legacy * 0.56), IRON_GALL, join(dir, "ic_launcher.png"), rounded);
  plate(legacy, Math.round(legacy * 0.52), IRON_GALL, join(dir, "ic_launcher_round.png"), circle);
}

// The splash is NOT generated here. It is res/drawable/splash.xml — a layer-list
// over the vector below — because a shape with no pixels in it needs no density
// ladder. See that file for the argument.

// ── vectors ────────────────────────────────────────────────────────────────
//
// Two places want the star as a VECTOR rather than a bitmap, and both of them
// are the system drawing it for us at a size we do not choose:
//
//   splash_star            — `windowSplashScreenAnimatedIcon` (API 31+), which
//                            Android masks to a circle at 2/3 of the canvas.
//   ic_launcher_monochrome — the themed-icon layer (API 33+), where the
//                            launcher tints a silhouette to the wallpaper's
//                            palette. Without it a themed home screen keeps
//                            one stubbornly gold square.
//
// Both are written from the same path as the bitmaps above, so the mark cannot
// drift between the splash, the icon and the wordmark.
//
// The 36-unit viewport is the inset: the star occupies the middle 24, which
// leaves its points clear of the circular mask instead of shaved off by it.
function starVectorDrawable(fill) {
  const c = 18;
  const k = WAIST;
  const d = [
    "M18,6.6",
    `Q${c + k},${c - k} 29.4,18`,
    `Q${c + k},${c + k} 18,29.4`,
    `Q${c - k},${c + k} 6.6,18`,
    `Q${c - k},${c - k} 18,6.6`,
    "Z",
  ].join(" ");
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- GENERATED by icons/make-icons.mjs. Edit the star there, not here. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="36"
    android:viewportHeight="36">
    <path
        android:fillColor="${fill}"
        android:pathData="${d}" />
</vector>
`;
}

const drawable = join(RES, "drawable");
mkdirSync(drawable, { recursive: true });
writeFileSync(join(drawable, "splash_star.xml"), starVectorDrawable(GOLD));
// Flat white: the launcher tints this layer itself, and any colour baked in
// here is a colour it has to fight.
writeFileSync(join(drawable, "ic_launcher_monochrome.xml"), starVectorDrawable("#FFFFFF"));

rmSync(work, { recursive: true, force: true });
console.log("icons: launcher + splash + vectors written to android/app/src/main/res");
