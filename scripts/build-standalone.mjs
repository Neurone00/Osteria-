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
