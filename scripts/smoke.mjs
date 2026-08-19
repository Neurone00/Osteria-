/**
 * Boots standalone/index.html in jsdom and checks the app actually mounts.
 * Catches the failure mode a rules simulation can't: a white screen.
 *
 *   node scripts/smoke.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { JSDOM } from "jsdom";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "standalone/index.html"), "utf8");

const errs = [];
const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "https://example.com/" });
dom.virtualConsole.on("jsdomError", (e) => errs.push(e.detail?.message || e.message));
dom.window.addEventListener("error", (e) => errs.push(e.message));

await new Promise((r) => setTimeout(r, 1500));

const mount = dom.window.document.getElementById("root");
for (const style of mount.querySelectorAll("style")) style.remove();
const text = mount.textContent.replace(/\s+/g, " ").trim();
const nodes = mount.querySelectorAll("*").length;

// The home screen is what an arriving player sees first: the wordmark, the name
// field and the two ways onto a table. Games and rules are chosen later, in the
// lobby, so they are not expected here.
const wanted = ["Osteria", "Apri un tavolo", "oppure", "Entra"];
const missing = wanted.filter((w) => !text.includes(w));

console.log(`mounted ${nodes} nodes`);
if (errs.length) console.error("errors:", errs);
if (missing.length) console.error("missing from the lobby:", missing.join(", "));
const ok = nodes > 20 && !errs.length && !missing.length;
console.log(ok ? "✓ the lobby renders clean" : "✗ boot failed");
process.exit(ok ? 0 : 1);
