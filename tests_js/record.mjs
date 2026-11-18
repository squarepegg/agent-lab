// Records every Python call the first Evals beat (`dstgate`) and its basics lesson (`eval`) make, plus the boot calls, into web/recorded.json, so both work before Pyodide has loaded.
// The recording is made in headless Chrome against Pyodide, the same runtime users get.
//   node record.mjs           write ../web/recorded.json
//   node record.mjs --check   regenerate and fail if the committed file differs by one byte (CI)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import { createHash } from "node:crypto";
import { PYODIDE } from "../web/lab.js";

const root = new URL("../web/", import.meta.url).pathname;
const target = join(root, "recorded.json");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = createServer((req, res) => { const p = req.url.split("?")[0]; const f = join(root, p === "/" ? "index.html" : p);
  if (!existsSync(f)) { res.writeHead(404).end(); return; } res.writeHead(200, { "content-type": types[extname(f)] || "text/plain" }).end(readFileSync(f)); }).listen(0);
const url = `http://127.0.0.1:${srv.address().port}/`;
const browser = await chromium.launch(process.env.CI ? {} : { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
let page; const errors = [];
const idle = () => page.evaluate(() => __lab.idle());
// A new context each time: the Start screen only shows its lesson 1 preview to a first-time visitor.
const fresh = async () => { await page?.context().close(); page = await (await browser.newContext({ viewport: { width: 1440, height: 860 } })).newPage(); page.on("pageerror", (e) => errors.push(e.message)); await page.goto(url + "?record=1"); await page.waitForFunction(() => window.__lab?.ready && __lab.interactive, null, { timeout: 120000 }); await idle(); };

// Play lesson 1 from the start, answering with choice `pick` at every prediction. Step 1 also replays each eval node once.
async function play(begin, pick) {
  await fresh(); await begin(); await idle();
  for (let guard = 0; guard < 12; guard++) {
    if (guard === 0) for (const id of await page.locator(".node[data-id^='eval:']").evaluateAll((n) => n.map((x) => x.dataset.id))) { await page.locator(`.node[data-id="${id}"]`).click(); await idle(); }
    const choices = page.locator("#drawer [data-act=lpick]:not([disabled])");
    if (await choices.count()) { await choices.nth(pick % await choices.count()).click(); await idle(); }
    const next = page.locator("#drawer .lesson [data-act=lnext]"); const last = (await next.textContent()).includes("Finish");
    await next.click(); await idle(); if (last) return;
  }
  throw new Error("lesson 1 did not finish");
}
const rec = {};
const grab = async () => Object.assign(rec, await page.evaluate(() => __lab.lab.rec));
await fresh(); await grab();
for (const id of ["dstgate", "eval"]) for (const pick of [0, 1]) {   // the first beat of the Evals door, and the "basics first" lesson it links to
  await play(() => page.click(`[data-act=lstart][data-id=${id}]`), pick); await grab();
}
const bundle = JSON.parse(readFileSync(join(root, "bundle.json"), "utf8"));
const vendor = createHash("sha256").update(Object.values(bundle.vendor.files).map((f) => f.sha256).sort().join("\n")).digest("hex");
const sorted = Object.fromEntries(Object.keys(rec).sort().map((k) => [k, rec[k]]));
const out = JSON.stringify({ meta: { pyodide: PYODIDE, vendor_sha256: vendor }, calls: sorted }, null, 1) + "\n";
await browser.close(); srv.close();
if (errors.length) { console.error("page errors:\n" + errors.join("\n")); process.exit(1); }
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== out) { console.error("web/recorded.json is out of date. Run `node record.mjs` in tests_js and commit the result."); process.exit(1); }
  console.log(`recorded.json matches a fresh run (${Object.keys(sorted).length} calls)`);
} else { writeFileSync(target, out); console.log(`wrote recorded.json: ${Object.keys(sorted).length} calls, ${Math.round(out.length / 1024)} KiB`); }
