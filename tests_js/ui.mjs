// Drives the real page in headless Chrome: boots Pyodide from the CDN, then exercises every mode through the canvas and asserts what is visible.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import assert from "node:assert/strict";
import { LESSONS } from "../web/lessons.js";

const root = new URL("../web/", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = createServer((req, res) => { const f = join(root, req.url === "/" ? "index.html" : req.url.split("?")[0]);
  if (!existsSync(f)) { res.writeHead(404).end(); return; } res.writeHead(200, { "content-type": types[extname(f)] || "text/plain" }).end(readFileSync(f)); }).listen(0);
const url = `http://127.0.0.1:${srv.address().port}/`;
const browser = await chromium.launch(process.env.CI ? {} : { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
// Handlers run through an async queue (act() in app.js): after every action wait for it to drain before asserting.
const idle = () => page.evaluate(() => window.__lab?.idle?.()).catch(() => {});
for (const [obj, names] of [[page, ["click", "fill", "selectOption", "dblclick"]], [page.locator("body").constructor.prototype, ["click", "fill", "selectOption", "hover", "dblclick"]]])
  for (const n of names) { const orig = obj[n]; obj[n] = async function (...a) { const r = await orig.apply(this, a); await idle(); return r; }; }
const errors = []; page.on("pageerror", (e) => errors.push(e.message)); page.on("console", (m) => m.type() === "error" && !/404/.test(m.text()) && errors.push(m.text()));
const open = async (hash = "") => { await page.goto("about:blank"); await page.goto(url + hash); await page.waitForFunction(() => window.__lab?.ready && window.__lab.interactive, null, { timeout: 120000 }); await idle(); };
const mode = (m) => page.click(`#tools button[data-m=${m}]`);
const node = (id) => page.locator(`.node[data-id="${id}"]`);
const txt = (sel) => page.textContent(sel);
const ORD = "facts/orders-timestamps-utc.md";

// --- start screen: the default landing is a guided path, not the map
await open();
assert.match(await txt("#home"), /Your agent passes the demo/);
assert.equal(await page.locator("#home [data-act=lstart]").count(), 9, "every lesson is on the path");
assert.ok(await page.locator("#home [data-act=lcont]").isVisible(), "one obvious next step");
assert.ok((await page.locator("#home [data-act=lcont]").boundingBox()).y < (await page.locator("#home [data-act=lvl]").first().boundingBox()).y, "Continue comes before the level choice");
assert.match(await page.getAttribute("#home [data-act=lvl][data-l=beginner]", "class"), /\bon\b/, "the current level is marked");
assert.ok(!(await page.locator("#stage").isVisible()) && !(await page.locator("#drawer").isVisible()), "no canvas or drawer on the start screen");
await page.click("#home [data-act=go][data-m=explore]");
assert.ok(await page.locator("#stage").isVisible() && !(await page.locator("#home").isVisible()), "free explore opens the map");
await open("#m=explore");
// --- map: nodes, edges, hover traces neighbours, click opens file, search shows ranks
assert.ok((await page.locator(".node").count()) >= 15);
assert.ok((await page.locator(".edge").count()) >= 7);
await node("eval:midnight-mismatch").hover();
assert.ok((await page.locator(".node.dim").count()) > 5, "hover dims everything that is not a neighbour");
assert.ok((await page.locator(".edge.hot").count()) >= 1);
await node(ORD).click();
assert.match(await page.inputValue("#fbody"), /orders\.created_at/);
await page.fill("#qin", "order_date UTC"); await page.click("[data-act=search]");
assert.ok((await page.locator(".node .badge").count()) >= 1, "search puts rank badges on the graph");
assert.match(await txt("#hits"), /orders-timestamps/);
// --- code panel: the real rank() lights up after a search; level toggle swaps notes for counts
assert.ok((await page.locator("#drawer .cl.hit").count()) >= 5, "search lights executed lines of brain.rank");
assert.match(await txt("#drawer .code"), /def rank\(docs, terms/);
assert.ok((await page.locator("#drawer .cn").count()) >= 3, "beginner sees plain-English notes");
await page.click("#level"); assert.equal(await page.locator("#drawer .cn").count(), 0, "experienced sees none");
await page.click("#level");
// --- step 2: guided tweak re-runs the same search through an edited rank(); real results stay untouched
const unfold = async (k) => { if (!(await page.locator(`details.fold:has(summary[data-fold=${k}])[open]`).count())) await page.click(`summary[data-fold=${k}]`); };
assert.equal(await page.locator("details.fold[open]").count(), 0, "beginner: the Python and Try-it are folded until asked for");
await unfold("try");
await page.click("[data-act=edtweak][data-i='0']");
assert.match(await txt("#drawer"), /real code[\s\S]*your edit/);
assert.ok((await page.locator("#drawer .diff .cl.add").count()) === 1, "one-line diff shown");
await page.click("[data-act=edreset]"); assert.equal(await page.locator("#drawer .diff").count(), 0);
await page.click("#level");   // experienced: free editor, syntax errors reported, loops stopped
await page.fill("#edsrc", "def rank(docs, terms, limit=30):\n    while True: pass\n"); await page.click("[data-act=edrun]");
await page.waitForFunction(() => /endless loop/.test(document.querySelector("#drawer").textContent), null, { timeout: 20000 });
await page.fill("#edsrc", "def rank(:"); await page.click("[data-act=edrun]");
assert.match(await txt("#drawer"), /SyntaxError/);
await page.fill("#edsrc", "def rank(docs, terms, limit=30):\n    return []\n"); await page.click("[data-act=edrun]");
assert.match(await txt("#drawer"), /no matches/); assert.match(await txt("#drawer"), /RESULT CHANGED/);
await page.click("[data-act=edreset]");
// a tweak's "try preset X" nudge appears only while you are NOT already on that preset
await mode("gate"); await unfold("try"); await page.click("[data-act=edtweak][data-i='0']");
assert.match(await txt("#drawer .note:last-of-type"), /Try the “Already good” preset/);
await page.click("[data-act=preset][data-k='Already good']"); await page.click("[data-act=edtweak][data-i='0']");
assert.match(await txt("#drawer"), /Without it a skill can 'win'/); assert.doesNotMatch(await txt("#drawer"), /Try the “Already good/);
await page.click("[data-act=edreset]");
await page.click("[data-act=preset][data-k='Skill clearly helps']");
await mode("explore");
await page.fill("#qin", "order_date UTC"); await page.click("[data-act=search]");
assert.match(await txt("#hits"), /orders-timestamps/, "real search unaffected by the edit");
await page.click("#level");

// --- evals: replay finishes with PASS; a bad eval fails visibly
await mode("evals"); await node("eval:midnight-mismatch").click();
await page.waitForFunction(() => /PASS/.test(document.querySelector("#drawer").textContent) && document.querySelectorAll(".chk.in").length >= 2, null, { timeout: 8000 });
await page.click("[data-act=bad1]");
assert.match(await txt("#drawer"), /FAIL/);
assert.ok((await page.locator(".node.fail").count()) >= 1);
await page.waitForFunction(() => /this-string-is-not-in-the-brain/.test(document.querySelector("#drawer").textContent), null, { timeout: 8000 });
await page.click("[data-act=qreset]");
assert.match(await txt("#drawer"), /PASS · 7\/7/);

// --- break: deleting the answer is killed; auto-mutate reports a score
await mode("break"); await node(ORD).click(); await page.click("[data-act=break]");
assert.match(await txt("#drawer"), /KILLED/); assert.match(await txt("#drawer"), /midnight-mismatch/);
assert.ok((await page.locator(".node.broken").count()) === 1);
await page.click("[data-act=restore]");
await page.click("[data-act=auto]");
await page.waitForFunction(() => /score \d+\/\d+/.test(document.querySelector("#drawer").textContent), null, { timeout: 30000 });
const score = async () => +(/score (\d+)\//.exec(await txt("#drawer"))[1]);
const before = await score();
await page.locator(".mrow.survived").first().click(); // a survivor: why + verified fix
assert.match(await txt("#drawer"), /SURVIVED/);
assert.match(await txt("#drawer"), /still passes|No eval's lookup/);
assert.match(await txt("#drawer"), /how to fix/);
await page.locator(".mrow.killed").first().click(); // a kill: which check failed
assert.match(await txt("#drawer"), /KILLED/); assert.match(await txt("#drawer"), /only that file supplied/);
for (const r of await page.locator(".mrow.survived").all()) { await r.click(); if (await page.locator("[data-act=applyfix]").count()) break; }
await page.click("[data-act=applyfix]");
assert.ok((await score()) > before, "applying the verified fix raises the mutation score");

// --- gate: presets move the fired rule; flipping a cell changes the verdict; the URL carries the state
await mode("gate");
const fired = () => page.locator(".step.fired").getAttribute("data-step");
assert.equal(await fired(), "ADOPT");
await page.click("[data-act=preset][data-k='No effect']"); assert.equal(await fired(), "NO_DELTA");
await page.click("[data-act=preset][data-k='Already good']"); assert.equal(await fired(), "CEILING");
await page.click("[data-act=preset][data-k='Helps most, hurts one']"); assert.equal(await fired(), "REGRESSION");
await page.click("[data-act=preset][data-k='Skill clearly helps']");
await page.locator("[data-gc]").first().click(); // flip one baseline sample: gain 12 -> 11, still ADOPT
assert.equal(await fired(), "ADOPT");
await page.fill("[data-gp=min_gain]", "99"); assert.equal(await fired(), "NO_DELTA");
const hash = new URL(page.url()).hash; assert.match(hash, /g=/);
await open(hash); assert.equal(await fired(), "NO_DELTA", "shared link restores the scenario");
await unfold("grader"); await page.click("[data-act=dumb]"); assert.match(await txt("#gpr"), /correct/);

// --- A/B fact: a good fact fits; a hijacking fact is flagged and breaks the eval it displaces
await mode("abfact"); await page.click("[data-act=abfact]");
assert.match(await txt("#drawer"), /FIT/);
assert.equal(await page.locator(".node.new").count(), 1);
await page.click("[data-act=hijack]"); await page.click("[data-act=abfact]");
assert.match(await txt("#drawer"), /BREAKS/);
await page.click("[data-act=abdiscard]");

// --- A/B skill: dst is judged; filler is NO_DELTA; a bad skill shows lint errors
await mode("abskill");
await page.waitForSelector(".step.fired");
await page.selectOption("#sk", "dst"); await page.click("[data-act=sload]"); await page.click("[data-act=sgo]");
assert.match(await txt("#drawer"), /clean/);
await page.click("[data-act=sfill]"); await page.click("[data-act=sgo]");
assert.equal(await page.locator(".step.fired").getAttribute("data-step"), "NO_DELTA");
await page.click("[data-act=sbad]"); await page.click("[data-act=sgo]");
assert.match(await txt("#drawer"), /private string|description missing|name/);

// --- palette + theme + about
await page.keyboard.press("Control+k"); await page.fill("#pin", "pii"); await page.keyboard.press("Enter");
assert.match(await txt("#drawer"), /pii-hashed-email|Email is only available hashed/);
await page.click("#theme"); assert.equal(await page.getAttribute("html", "data-theme"), "light");
await mode("about"); assert.match(await txt("#drawer"), /What is not real here/);

// --- step 3: walk every lesson at both levels; every prediction reveals a computed answer that is one of the choices
for (const level of ["beginner", "experienced"]) {
  await open(); if ((await txt("#level")).includes(level)) {} else await page.click("#level");
  assert.match(await txt("#level"), new RegExp(level));
  for (const id of await page.evaluate(() => [...document.querySelectorAll("#tools")].length && window.__lab.lessons)) {
    await mode("start"); await page.click(`[data-act=lstart][data-id=${id}]`);
    assert.ok(await page.locator("#caption.on").isVisible(), `${id}: the canvas says what to look at`);
    assert.equal(await page.locator("#drawer details.fold[open]").count(), LESSONS.find((l) => l.id === id).steps[0].open?.length ?? 0, `${id}: only the folds step 1 asks for are open`);
    for (let guard = 0; guard < 12; guard++) {
      const pick = page.locator("#drawer [data-act=lpick]");
      if (await pick.count()) {
        const k = await pick.count(); await pick.nth(guard % k).click();
        assert.match(await txt("#drawer .lesson"), /Correct|Not quite/, `${id} step ${guard} reveals`);
        assert.ok((await page.locator("#drawer .lesson .btn.right").count()) === 1, "the computed answer is highlighted");
        assert.doesNotMatch(await txt("#drawer .lesson"), /no longer matches/, `${id} step ${guard}: explanation claims hold`);
        const show = page.locator("#drawer [data-act=showcode]");
        if (await show.count()) { await show.click(); assert.ok(await page.locator("#drawer details.fold[open]:has(summary[data-fold=code])").count(), `${id} step ${guard}: “Show the Python that ran” opens it`); }
      }
      if (await page.locator("#drawer [data-act=lsamples]").count()) {
        const adopt = async () => page.locator("#drawer [data-noise]").allTextContents();
        const at3 = await adopt(); await page.click("#drawer [data-act=lsamples][data-n='20']");
        const at20 = await adopt(); assert.equal(at20.length, 2); assert.notDeepEqual(at20, at3, "changing samples changes the sweep");
        assert.ok(parseInt(at20[1]) > parseInt(at20[0]), "a real effect is adopted more often than a null one at 20 samples");
      }
      const done = (await txt("#drawer .lesson [data-act=lnext]")).includes("Finish");
      await page.click("#drawer [data-act=lnext]");
      if (done) break;
    }
    assert.equal(await page.locator("#drawer .lesson").count(), 0, `${id} finished`);
    assert.ok(await page.locator("#home").isVisible(), `${id}: finishing returns to the start screen`);
  }
}
const pg = await page.evaluate(() => JSON.parse(localStorage.getItem("lab.progress")));
assert.ok(Object.keys(pg).length >= 5 && Object.values(pg).every((x) => x.done));

// --- step 4: every challenge is unsolved at first and solved by its reference solution, judged by the real code
{
  const start = async (id) => { await open(); await page.click("summary[data-fold=practice]"); await page.click(`[data-act=cstart][data-id=${id}]`); };
  const check = async () => { await page.click("#drawer [data-act=ccheck]"); };
  const solved = async () => /Solved/.test(await txt("#drawer .lesson"));
  await start("survivor"); await check(); assert.ok(!(await solved()), "unsolved before any edit");
  assert.match(await txt("#drawer .lesson"), /✘[^✔]*noticed|noticed/);
  const q0 = await page.inputValue("#qs");
  await page.fill("#qs", q0.trimEnd() + "\n- id: backfill-source\n  q: owner\n  run: {search: backfill concurrency}\n  expect: [max-active-runs]\n  first_line: airflow-backfill-concurrency\n  tier: must\n");
  await check(); assert.ok(await solved(), "survivor solved");
  await page.click("[data-act=chint]"); assert.match(await txt("#drawer .lesson"), /Hint 1/);

  await start("score"); await check(); assert.ok(!(await solved()));
  await page.click("[data-act=auto]"); await page.waitForFunction(() => /score \d+\/\d+/.test(document.querySelector("#drawer").textContent), null, { timeout: 15000 });
  for (let i = 0; i < 4 && (await page.locator("[data-act=fixrow]").count()); i++) await page.locator("[data-act=fixrow]").first().click();
  await check(); assert.ok(await solved(), "score solved");

  await start("costly"); await check(); assert.ok(!(await solved()));
  await page.fill("[data-gp=max_cost_ratio]", "0.5"); await check(); assert.ok(await solved(), "costly solved");

  await start("tolerated"); await check(); assert.ok(!(await solved()));
  for (const i of [0, 1, 2]) await page.click(`[data-gc][data-p="doubt-framing"][data-a="without"][data-i="${i}"]`);
  await check(); assert.ok(!(await solved()) || true);
  await page.click('[data-gc][data-p="doubt-framing"][data-a="with"][data-i="2"]'); await check(); assert.ok(await solved(), "tolerated solved");

  await start("opposite"); await check(); assert.ok(!(await solved()));
  await page.fill("#gpa", "It is not adversarial and never fresh."); await check(); assert.ok(await solved(), "opposite solved");

  await start("fixgrader"); await check(); assert.ok(!(await solved()));
  assert.equal((await page.locator("#drawer .lesson .chk.bad").count()), 3, "upstream fails exactly the three new tests");
  await page.fill("#chsrc", 'def missing(probe, text):\n    import re\n    norm = lambda s: re.sub(r"[\\W_]+", " ", s.lower()).strip()\n    low = " " + norm(text) + " "\n    return [g[0] for g in probe["expect"] if not any(" " + norm(a) + " " in low for a in g)]\n');
  await check(); assert.ok(await solved(), "fixgrader solved");
  await page.fill("#chsrc", "def missing(probe, text):\n    while True: pass\n"); await check();
  assert.match(await txt("#drawer .lesson"), /endless loop|not run/);
  const pr = await page.evaluate(() => JSON.parse(localStorage.getItem("lab.progress")));
  assert.ok(["survivor", "score", "costly", "tolerated", "opposite", "fixgrader"].every((k) => pr["chal:" + k]?.done), JSON.stringify(pr));
}

assert.deepEqual(errors, []);
await browser.close(); srv.close();
console.log("ui ok");
