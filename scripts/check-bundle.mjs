// Production build checks (run after `npm run build`):
//  1. Initial JS on "/" (scripts referenced by the prerendered HTML) stays within 250 KB gzipped (NFR-1).
//  2. No client asset contains an API key (G6, NFR-3).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 250;
const KEY_NAMES = ["FREECRYPTOAPI_KEY", "COINGECKO_DEMO_API_KEY"];
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const nextDir = join(root, ".next");
const kb = (bytes) => (bytes / 1024).toFixed(1);

const html = readFileSync(join(nextDir, "server", "app", "index.html"), "utf8");
const scripts = [
  ...new Set([...html.matchAll(/<script src="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1])),
];
let initial = 0;
for (const src of scripts)
  initial += gzipSync(readFileSync(join(nextDir, src.replace("/_next/", "")))).length;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const staticFiles = walk(join(nextDir, "static"));
const chunks = staticFiles.filter((f) => f.endsWith(".js"));
const chartChunk = chunks.find((f) => readFileSync(f, "utf8").includes("lightweight-charts"));
const totalJs = chunks.reduce((n, f) => n + gzipSync(readFileSync(f)).length, 0);

console.log(
  `Initial JS for "/": ${kb(initial)} KB gzipped across ${scripts.length} scripts (budget ${BUDGET_KB} KB)`,
);
if (chartChunk)
  console.log(
    `Chart library chunk (loaded after first paint): ${kb(gzipSync(readFileSync(chartChunk)).length)} KB gzipped`,
  );
console.log(`All client JS: ${kb(totalJs)} KB gzipped in ${chunks.length} chunks`);

let failed = initial / 1024 > BUDGET_KB;
if (failed) console.error("FAIL: initial JS is over budget");

let envFile = "";
try {
  envFile = readFileSync(join(root, ".env.local"), "utf8");
} catch {
  // no .env.local
}
function envValue(name) {
  if (process.env[name]) return process.env[name];
  const line = envFile.split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
  return line ? line.slice(name.length + 1).trim() : "";
}

for (const name of KEY_NAMES) {
  const key = envValue(name);
  if (!key) {
    console.log(`${name} not set; leak scan for it skipped`);
    continue;
  }
  const leaks = staticFiles.filter((f) => readFileSync(f).includes(key));
  if (leaks.length > 0) {
    failed = true;
    console.error(`FAIL: ${name} found in client assets:\n  ${leaks.join("\n  ")}`);
  } else {
    console.log(`${name} absent from all ${staticFiles.length} client assets`);
  }
}
process.exit(failed ? 1 : 0);
