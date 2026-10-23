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

// The home screen is what an arriving player sees first: the wordmark, Bump as the
// headline way in, the "use a code" fallback tucked under it, and the one-phone
// option. Opening a table and joining by code live behind the code disclosure now.
// The interface language follows the system locale, so accept either language.
const wanted = [["Osteria"], ["Bump"], ["Usa un codice", "Use a code"], ["Un solo telefono", "One phone"]];
const missing = wanted.filter((alts) => !alts.some((w) => text.includes(w))).map((alts) => alts[0]);

console.log(`mounted ${nodes} nodes`);
if (errs.length) console.error("errors:", errs);
if (missing.length) console.error("missing from the home:", missing.join(", "));
const ok = nodes > 20 && !errs.length && !missing.length;
console.log(ok ? "✓ the home renders clean" : "✗ boot failed");
process.exit(ok ? 0 : 1);
