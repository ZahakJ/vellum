// The app icon, drawn rather than dragged in.
//
//   node desktop/icons/make-icon.mjs
//
// Vellum's identity is one sentence in CONTRACTS.md — "a candlelit manuscript
// room", gold-leaf `#c9a227` on iron-gall `#16130e` — and the two colours are
// tokens the whole product is painted with (`--swatch-iron-gall-bg`,
// `--swatch-iron-gall-accent` in client/styles/tokens.css). An icon is the one
// surface a reader sees before any of that loads, so it is those two colours
// and nothing else.
//
// The mark is the four-pointed star the startup banner already prints
// (`.   ✦   .` in server/index.ts) — an astroid, |x|^(2/3) + |y|^(2/3) = r^(2/3),
// which is the concave four-pointed star's actual curve rather than an
// approximation of it — set in a rounded square, over a soft radial warmth that
// is the candle.
//
// Written as a generator, and checked in beside its output, because a binary
// nobody can regenerate is a binary nobody can change: the day the accent moves
// (it has once — `#8a6d1a` failed AA and became `#7a5f14` on light), this is one
// edit and one command rather than a design tool nobody has.
//
// No dependencies: a PNG is a zlib stream in four chunks, and `node:zlib` is
// already here.

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SIZE = 512;
const BG = [0x16, 0x13, 0x0e]; // iron-gall
const GOLD = [0xc9, 0xa2, 0x27]; // gold-leaf
const RADIUS = SIZE * 0.22; // the corner radius of the app's own `--radius`, scaled

/** Coverage of a rounded square at (x, y), antialiased by 3× supersampling. */
function plate(x, y) {
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3;
      const py = y + (sy + 0.5) / 3;
      const dx = Math.max(RADIUS - px, px - (SIZE - RADIUS), 0);
      const dy = Math.max(RADIUS - py, py - (SIZE - RADIUS), 0);
      if (Math.hypot(dx, dy) <= RADIUS) hits++;
    }
  }
  return hits / 9;
}

/** Coverage of the four-pointed star, centred, same supersampling.
 *
 *  |x|^p + |y|^p = 1 with p < 1 is a concave square — the family the astroid
 *  (p = 2/3) belongs to. The astroid itself reads as a plump diamond at icon
 *  sizes; p = 0.45 is where the points get long enough to be a ✦ rather than a
 *  rhombus, which is the glyph the startup banner prints. */
function star(x, y) {
  const c = SIZE / 2;
  const r = SIZE * 0.38;
  const P = 0.45;
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const dx = Math.abs(x + (sx + 0.5) / 3 - c) / r;
      const dy = Math.abs(y + (sy + 0.5) / 3 - c) / r;
      if (dx ** P + dy ** P <= 1) hits++;
    }
  }
  return hits / 9;
}

const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE * 4);
  row[0] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    const onPlate = plate(x, y);
    // The candle: a warm radial lift toward the centre, at most ~9% of the
    // accent mixed into the ground. Subtle on purpose — it should read as light
    // in a room, not as a gradient.
    const d = Math.hypot(x - SIZE / 2, y - SIZE / 2) / (SIZE / 2);
    const warmth = Math.max(0, 1 - d * 1.15) ** 2 * 0.09;
    const ink = BG.map((c, i) => c + (GOLD[i] - c) * warmth);
    const lit = star(x, y);
    const rgb = ink.map((c, i) => Math.round(c + (GOLD[i] - c) * lit));
    const at = 1 + x * 4;
    row[at] = rgb[0];
    row[at + 1] = rgb[1];
    row[at + 2] = rgb[2];
    row[at + 3] = Math.round(onPlate * 255);
  }
  rows.push(row);
}

// ── PNG container ──────────────────────────────────────────────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // truecolour with alpha
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const out = fileURLToPath(new URL("icon.png", import.meta.url));
writeFileSync(out, png);
console.log(`icon: ${out} (${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(1)} kB)`);
