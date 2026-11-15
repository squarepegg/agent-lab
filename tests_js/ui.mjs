// Drives the real page in headless Chromium: boots Pyodide from the CDN, clicks through each tab, asserts visible results.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import assert from "node:assert/strict";

const root = new URL("../web/", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = createServer((req, res) => { const f = join(root, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  if (!existsSync(f)) { res.writeHead(404).end(); return; } res.writeHead(200, { "content-type": types[extname(f)] || "text/plain" }).end(readFileSync(f)); }).listen(0);
const url = `http://127.0.0.1:${srv.address().port}/`;
const browser = await chromium.launch(process.env.CI ? {} : { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await browser.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url);
await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 120000 });
const tab = (t) => page.click(`nav button[data-t=${t}]`);

await page.fill("#q", "order_date UTC"); await page.click("#qgo");
assert.match(await page.textContent("#qres"), /orders-timestamps/);

await tab("evals"); await page.click("#runev");
assert.match(await page.textContent("#evsum"), /PASS · must 7\/7/);
await page.click("#addbad");
assert.match(await page.textContent("#evsum"), /FAIL/);
assert.match(await page.textContent("#evres"), /this-string-is-not-in-the-brain/);

await tab("break"); await page.selectOption("#mpath", "facts/orders-timestamps-utc.md"); await page.click("#mgo");
assert.match(await page.textContent("#mout"), /KILLED|SURVIVED/);

await tab("gate");
assert.equal((await page.textContent("#gverdict")).trim(), "ADOPT");
await page.click("button[data-k='No effect']"); assert.equal((await page.textContent("#gverdict")).trim(), "NO_DELTA");
await page.click("button[data-k='Baseline already good (ceiling)']"); assert.equal((await page.textContent("#gverdict")).trim(), "CEILING");
await page.click("button[data-k='Helps dev, hurts one probe']"); assert.equal((await page.textContent("#gverdict")).trim(), "REGRESSION");
await page.click("#pdumb"); assert.match(await page.textContent("#pgrade"), /correct|incorrect/);

await tab("ab"); await page.click("#fgo"); assert.match(await page.textContent("#fres"), /FIT/);
await page.click("#fhij"); await page.click("#fgo"); assert.match(await page.textContent("#fres"), /BREAKS|POLLUTES/);
await page.click("#sgo"); assert.match(await page.textContent("#sres"), /ADOPT|NO_DELTA|REGRESSION|CEILING/);
await page.click("#sfill"); await page.click("#sgo"); assert.match(await page.textContent("#sres"), /NO_DELTA/);

assert.deepEqual(errors, []);
await browser.close(); srv.close();
console.log("ui ok");
