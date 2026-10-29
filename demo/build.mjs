// Bundles the browser demo into a single self-contained HTML file:
//   npm run demo:build  ->  demo/dist/clinic-front-desk.html

import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const shim = (name) => here(`./shims/${name}`);

const result = await build({
  entryPoints: [here("./entry.js")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  inject: [shim("globals.js")],
  define: { "import.meta.url": JSON.stringify("file:///app/src/app.ts") },
  alias: {
    "node:sqlite": shim("sqlite.js"),
    express: shim("express.js"),
    "node:crypto": shim("crypto.js"),
    crypto: shim("crypto.js"),
    "node:fs": shim("node-misc.js"),
    fs: shim("node-misc.js"),
    "node:path": shim("node-misc.js"),
    path: shim("node-misc.js"),
    "node:url": shim("node-misc.js"),
    "node:events": "events",
    "@anthropic-ai/sdk": shim("node-misc.js"),
  },
  charset: "utf8",
  logLevel: "warning",
});

const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = readFileSync(here("../public/styles.css"), "utf8");
const html = `<meta charset="utf-8">
<title>Clinic Front Desk</title>
<meta name="description" content="Unified patient inbox and AI receptionist for clinics (browser demo)">
<style>
${css}
</style>
<div id="app"></div>
<script>
${js}
</script>
`;
mkdirSync(here("./dist"), { recursive: true });
writeFileSync(here("./dist/clinic-front-desk.html"), html);
console.log(`demo/dist/clinic-front-desk.html (${(html.length / 1024).toFixed(0)} KB)`);
