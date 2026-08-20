/**
 * Builds standalone/index.html: the whole game — React included — inlined into
 * one file with no external requests except the PeerJS fallback.
 *
 * This is what Cloudflare serves, so run it before deploying. `npm run deploy`
 * does that for you via predeploy.
 */
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const result = await build({
  entryPoints: [join(root, "src/main.jsx")],
  bundle: true,
  minify: true,
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
  outfile: "bundle.js",
});

const js = result.outputFiles[0].text;
const template = readFileSync(join(root, "scripts/standalone.template.html"), "utf8");
const html = template.replace("/*BUNDLE*/", () => js);
const out = join(root, "standalone/index.html");
writeFileSync(out, html);
console.log(`standalone/index.html — ${Math.round(html.length / 1024)} KB`);

// A minimal service worker. Its real job is to exist with a fetch handler —
// that is what makes the app installable on Android/Chrome (the browser offers
// a genuine "Install app" instead of a bookmark). It also caches the one-file
// shell so the app opens offline. Bump CACHE to force clients onto a new build.
const SW_CACHE = "osteria-" + String(html.length);
const sw = `const CACHE = ${JSON.stringify(SW_CACHE)};
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add("/")).then(() => self.skipWaiting()).catch(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => (k === CACHE ? null : caches.delete(k))))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.pathname.startsWith("/room/")) return; // never intercept the relay
  if (req.mode === "navigate") {
    // network-first so a fresh deploy always lands, cache as offline fallback
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/", copy)); return res; }).catch(() => caches.match("/")));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
`;
writeFileSync(join(root, "standalone/sw.js"), sw);
console.log("standalone/sw.js — service worker written");
