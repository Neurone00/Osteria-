/**
 * Generates the Android launcher icons from the Osteria favicon so the installed
 * app wears the two-cards mark instead of the Capacitor default.
 *
 *   node native/make-icons.mjs
 *
 * Writes into android/app/src/main/res/mipmap-*  (the android/ project is committed,
 * and `cap sync` does not touch icons, so the generated PNGs simply ride along into
 * every CI build). Adaptive icon = dark background colour + the cards as foreground;
 * legacy icons = the full favicon, square and circle-masked.
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const res = join(root, "android/app/src/main/res");

// The cards, lifted straight out of favicon.svg (no background rect).
const CARDS = `
  <g transform="rotate(-14 24 26)"><rect x="12.5" y="10" width="23" height="31" rx="3.4" fill="#e9e3d8" stroke="#1b1a18" stroke-width="1"/></g>
  <g transform="rotate(10 24 26)"><rect x="12.5" y="9" width="23" height="31" rx="3.4" fill="#fbfaf7" stroke="#1b1a18" stroke-width="1"/>
    <text x="16.4" y="16.6" font-size="7.4" font-weight="700" fill="#b23a2e" font-family="Georgia,'Times New Roman',serif">7</text>
    <circle cx="24" cy="25.5" r="7.4" fill="none" stroke="#b8862b" stroke-width="2.1"/>
    <circle cx="24" cy="25.5" r="2.5" fill="#b23a2e"/></g>`;

// Full mark (dark rounded background + cards) for the legacy square/round icons.
const FULL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="11" fill="#1b1a18"/>${CARDS}</svg>`;

// Adaptive foreground: cards only, on a transparent 108 canvas, scaled into the
// safe zone (≈66 of 108) and centred — the launcher supplies the dark background.
const FG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><g transform="translate(54 54) scale(1.375) translate(-24 -26)">${CARDS}</g></svg>`;

const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FOREGROUND = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

const circleMask = (n) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}"><circle cx="${n / 2}" cy="${n / 2}" r="${n / 2}" fill="#fff"/></svg>`);

for (const [d, n] of Object.entries(LEGACY)) {
  const dir = join(res, `mipmap-${d}`);
  mkdirSync(dir, { recursive: true });
  const square = await sharp(Buffer.from(FULL)).resize(n, n).png().toBuffer();
  writeFileSync(join(dir, "ic_launcher.png"), square);
  const round = await sharp(square).composite([{ input: circleMask(n), blend: "dest-in" }]).png().toBuffer();
  writeFileSync(join(dir, "ic_launcher_round.png"), round);
}

for (const [d, n] of Object.entries(FOREGROUND)) {
  const dir = join(res, `mipmap-${d}`);
  mkdirSync(dir, { recursive: true });
  const fg = await sharp(Buffer.from(FG)).resize(n, n).png().toBuffer();
  writeFileSync(join(dir, "ic_launcher_foreground.png"), fg);
}

console.log("launcher icons written to android/app/src/main/res/mipmap-*");
