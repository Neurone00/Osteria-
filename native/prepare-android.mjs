/**
 * Prepares android-www/ — the offline web root the Android APK ships and serves
 * with zero network. It is standalone/ (the same one-file build Cloudflare serves)
 * plus the native Bluetooth bridge injected ahead of the app so window.OsteriaNative
 * exists before React first renders.
 *
 * Run `npm run bundle` first so standalone/ is fresh, then this. Capacitor points
 * webDir at android-www (see capacitor.config.json), so the app loads locally and
 * needs no internet — the native BLE transport carries the game between two phones.
 *
 *   npm run bundle && npm run cap:prepare && npx cap sync android
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "standalone");
const dst = join(root, "android-www");

// Bundle the bridge (imports the Capacitor BLE central plugin; the peripheral
// plugin is a Cordova runtime global, so it's referenced off window, not imported).
const bundled = await build({
  entryPoints: [join(root, "native/bridge.js")],
  bundle: true,
  minify: true,
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
});
const bridgeJs = bundled.outputFiles[0].text;

// Fresh copy of the offline web root.
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
writeFileSync(join(dst, "native-bridge.js"), bridgeJs);

// Load the bridge before the inlined app bundle so the global is ready at first
// render. Placing it right after #root guarantees it runs ahead of the app script.
let html = readFileSync(join(dst, "index.html"), "utf8");
if (!html.includes("native-bridge.js")) {
  html = html.replace(
    '<div id="root"></div>',
    '<div id="root"></div>\n    <script src="native-bridge.js"></script>'
  );
}
writeFileSync(join(dst, "index.html"), html);

console.log(`android-www/ ready — native-bridge.js ${Math.round(bridgeJs.length / 1024)} KB`);
