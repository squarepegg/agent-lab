// Shared by the browser tests: a static server over ../web (queries ignored) and headless Chrome.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";

export const root = new URL("../web/", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = createServer((req, res) => { const p = req.url.split("?")[0].split("#")[0]; const f = join(root, p === "/" ? "index.html" : p);
  if (!existsSync(f)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[extname(f)] || "text/plain" }).end(readFileSync(f)); }).listen(0);
export const url = `http://127.0.0.1:${srv.address().port}/`;
export const browser = await chromium.launch(process.env.CI ? {} : { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
export const errors = [];
/** A fresh context (so a fresh localStorage and service worker) and its page; failing requests are expected only when `quiet`. */
export async function newPage({ width = 1440, height = 860, quiet = false, ...opts } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, ...opts });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  if (!quiet) page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return page;
}
export const idle = (page) => page.evaluate(() => window.__lab?.idle?.());
/** Open the app and wait until it can be clicked (Python need not be ready). */
export async function open(page, path = "") {
  await page.goto("about:blank"); await page.goto(url + path);
  await page.waitForFunction(() => window.__lab?.interactive, null, { timeout: 60000 }); await idle(page);
}
export const ready = (page) => page.waitForFunction(() => window.__lab?.ready, null, { timeout: 120000 });
export async function done() { await browser.close(); srv.close(); }
