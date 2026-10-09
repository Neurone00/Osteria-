/**
 * Self-hosted Fredoka — the brand/wordmark face — inlined as base64 @font-face rules
 * so it renders with NO network fetch: offline in the APK, and in any sandbox that
 * blocks Google Fonts. Both the web build (build-standalone) and the APK root
 * (prepare-android) inject this into the page head at the FONTS placeholder.
 *
 * Fredoka's real weight axis is 300–700 (there is no 800; heavier uses faux-bold).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "node_modules/@fontsource/fredoka/files");
const WEIGHTS = [400, 500, 600, 700];

export function fontFaceCss() {
  return WEIGHTS.map((w) => {
    const b64 = readFileSync(join(dir, `fredoka-latin-${w}-normal.woff2`)).toString("base64");
    return `@font-face{font-family:'Fredoka';font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
  }).join("\n");
}
