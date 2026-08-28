/**
 * Prepares android-www/ — the offline web root the Android APK ships and serves with
 * zero network. Unlike standalone/ (the web build Cloudflare serves, which has the
 * Bluetooth transport compiled out), the APK gets its OWN app bundle built with
 * __OSTERIA_NATIVE__ = true, so the native Bluetooth transport is included — plus the
 * bridge injected ahead of the app so window.OsteriaNative exists before React renders.
 *
 * Run `npm run bundle` first (for the shared static assets), then this. Capacitor points
 * webDir at android-www (see capacitor.config.json).
 *
 *   npm run cap:prepare && npx cap sync android
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "standalone");
const dst = join(root, "android-www");

// The APK's app bundle — same source as the web, but with the native flag on so the
// Bluetooth transport and its UI are kept (they're dead-code-eliminated on the web).
const app = await build({
  entryPoints: [join(root, "src/main.jsx")],
  bundle: true,
  minify: true,
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "globalThis.__OSTERIA_NATIVE__": "true" },
  write: false,
});
const appJs = app.outputFiles[0].text;

// The bridge (imports the Capacitor BLE central plugin; the peripheral plugin is a
// Cordova runtime global, referenced off window rather than imported).
const bridge = await build({
  entryPoints: [join(root, "native/bridge.js")],
  bundle: true,
  minify: true,
  format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
});
const bridgeJs = bridge.outputFiles[0].text;

// Fresh copy of the offline web root — take the static assets (icons, manifest, sw)
// from standalone/, then overwrite index.html with the native-flavoured bundle.
rmSync(dst, { recursive: true, force: true });
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
writeFileSync(join(dst, "native-bridge.js"), bridgeJs);

const template = readFileSync(join(root, "scripts/standalone.template.html"), "utf8");
const html = template
  .replace("/*BUNDLE*/", () => appJs)
  // Load the bridge before the inlined app bundle so the global is ready at first render.
  .replace('<div id="root"></div>', '<div id="root"></div>\n    <script src="native-bridge.js"></script>');
writeFileSync(join(dst, "index.html"), html);

console.log(`android-www/ ready — app (native) ${Math.round(appJs.length / 1024)} KB, bridge ${Math.round(bridgeJs.length / 1024)} KB`);
