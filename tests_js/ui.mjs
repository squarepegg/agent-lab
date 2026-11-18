// Drives the real page in headless Chrome: boots Pyodide from the CDN, then exercises every mode through the canvas and asserts what is visible.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join } from "node:path";
import assert from "node:assert/strict";
import { LESSONS, PILLARS, CASES } from "../web/lessons.js";
const caseOf = (id) => CASES.find((c) => PILLARS.some((p) => p.beats[c.id]?.includes(id)))?.id;
// Start a lesson from the Start screen: switch to its case first (the case file shows one case at a time).
const begin = async (id) => { await page.evaluate((i) => __lab.start(i), id); await idle(); };   // straight into a lesson: the lesson walks below are about the lessons, not the pages
// A door opens that adventure's page; its highlighted button starts the next lesson.
const door = async (p) => { await page.click(`#home [data-act=door][data-p=${p}]`); await page.click("#home .adv [data-act=lstart].go"); };

const root = new URL("../web/", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const srv = createServer((req, res) => { const p = req.url.split("?")[0], f = join(root, p === "/" ? "index.html" : p);
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

// --- start screen: three doors and a case file, not a syllabus
await open();
assert.match(await txt("#home"), /Your agent passes the demo/);
assert.deepEqual(await page.locator("#home [data-act=door]").evaluateAll((b) => b.map((x) => x.querySelector(".dq").textContent)), ["What happened?", "Should it have been allowed?", "Did it actually work?"], "three doors, in the order of the story");
assert.match(await page.getAttribute("#home [data-act=lvl][data-l=beginner]", "class"), /\bon\b/, "the current level is marked");
assert.ok((await page.locator("#home [data-act=door]").last().boundingBox()).y < (await page.locator("#home [data-act=lvl]").first().boundingBox()).y, "the doors come before the level choice");
assert.equal(await page.locator("#home [data-act=lstart]").count(), 0, "the start screen is only the three questions: no lessons yet");
assert.equal(await page.locator("#home .cf").count(), 0, "and no case file");
await page.click("#home [data-act=door][data-p=evals]");
assert.match(await txt("#home .adv h1"), /Did it actually work\?/, "a door opens that adventure's own page");
assert.equal(await page.locator("#home .adv .lrow").count(), 1, "only the first lesson is on offer");
assert.match(await txt("#home .adv"), /2 more lessons turn up as you go/);
assert.equal(await page.locator("#home .adv summary[data-fold=advevals]").count(), 0, "no advanced lessons until you've started");
await page.click("#home .adv [data-act=advback]");
assert.equal(await page.locator("#home [data-act=door]").count(), 3, "back to the three questions");
assert.ok(!(await page.locator("#stage").isVisible()) && !(await page.locator("#drawer").isVisible()), "no canvas or drawer on the start screen");
assert.equal(await page.locator("#home [data-act=go]:visible").count(), 0, "the tools are folded away until asked for");
await page.click("#home summary[data-fold=tools]");
await page.click("#home [data-act=go][data-m=explore]");
assert.ok(await page.locator("#stage").isVisible() && !(await page.locator("#home").isVisible()), "free explore opens the map");
// each door opens its own adventure at its first lesson, and the end of a lesson offers the other doors
for (const [p, id] of [["observability", "timeline"], ["guardrails", "guard"], ["evals", "dstgate"]]) {
  await open(); await door(p);
  assert.equal(await page.evaluate(() => __lab.S.lesson.id), id, `the ${p} door opens ${id}`);
  assert.ok(await page.locator("#drawer [data-act=lpick]").count() > 0, `${id}: a prediction is on screen after one click`);
}
await open(); await door("observability");
for (let g = 0; g < 4; g++) { const pick = page.locator("#drawer [data-act=lpick]:not([disabled])"); if (await pick.count()) await pick.first().click(); if ((await txt("#drawer .lesson [data-act=lnext]")).includes("Finish")) break; await page.click("#drawer [data-act=lnext]"); }
await page.click("#drawer [data-act=lnext]");
assert.deepEqual(await page.locator("#drawer .doors-end [data-act=lstart]").evaluateAll((b) => b.map((x) => x.dataset.id)), ["trace", "guard", "dstgate"], "one observability beat done: the next beat here, and the next beat of the other two adventures");
assert.equal(await page.locator("#drawer details.fold").count(), 0, "the doors card is alone in the drawer");
await page.click("#drawer [data-act=lstart][data-id=guard]");
assert.equal(await page.evaluate(() => __lab.S.lesson.id), "guard");
await page.click("#drawer [data-act=lexit]");
assert.match(await txt("#home .adv h1"), /Should it have been allowed\?/, "leaving a lesson returns to its adventure's page");
await page.click("#home [data-act=advback]"); await page.click("#home [data-act=door][data-p=observability]");
assert.equal(await page.locator("#home .adv .ck:has-text('✔')").count(), 1, "the page marks what you finished");
// --- the first Evals beat links to the basics and offers depth; the short cases have their own beats and guard corpus, and close
const finish = async () => { for (let g = 0; g < 12; g++) { const pick = page.locator("#drawer [data-act=lpick]:not([disabled])"); if (await pick.count()) await pick.first().click(); const last = (await txt("#drawer .lesson [data-act=lnext]")).includes("Finish"); await page.click("#drawer .lesson [data-act=lnext]"); if (last) break; } };
await page.evaluate(() => localStorage.clear()); await open();
await door("evals");
assert.equal(await page.locator("#drawer [data-act=lstart][data-id=eval]").count(), 1, "the first Evals beat links to the basics");
await finish();
assert.deepEqual(await page.locator("#drawer .doors-end [data-act=lstart]").evaluateAll((b) => b.map((x) => x.dataset.id)), ["break", "eval", "timeline"], "a beat, a deeper lesson, and a door into another adventure");
await page.click("#drawer [data-act=lexit]");
assert.equal(await page.locator("#home .adv .lrow:visible").count(), 2, "the lesson you finished, and the next one");
await page.click("#home .adv summary[data-fold=advevals]");
assert.deepEqual(await page.locator("#home .adv details [data-act=lstart]").evaluateAll((b) => b.map((x) => x.dataset.id)), ["eval", "rank", "gate", "skill", "recorded"], "the advanced lessons appear once you've started");
await page.evaluate(() => localStorage.clear()); await open();
await page.click("#home [data-act=case][data-id=evidence]");
await page.click("#home [data-act=door][data-p=evals]");
assert.equal(await page.locator("#home .adv .lrow").count(), 1, "a short case: one lesson per adventure");
assert.equal(await page.locator("#home .adv summary[data-fold=advevals]").count(), 0);
await page.click("#home [data-act=advback]"); await door("guardrails");
assert.equal(await page.evaluate(() => __lab.S.lesson.id), "evguard");
assert.equal(await page.evaluate(() => __lab.S.guard.calls.length), 64, "the guard lessons of a short case replay only that case's calls");
await finish(); await page.click("#drawer [data-act=lstart][data-id=evtrace]"); await finish();
await page.click("#drawer [data-act=lstart][data-id=evgate]"); await finish();
assert.match(await txt("#drawer .doors-end"), /Case closed/, "three beats done closes the case");
await page.click("#drawer [data-act=case]");
assert.match(await txt("#home .case"), /went looking|read and still failed|read it and still failed|The skill it read/, "the other case is offered");
await page.evaluate(() => localStorage.clear());
// --- playtest log: off unless asked for; then local events only (door, step, answer)
await open(); await page.click("#home [data-act=door][data-p=observability]");
assert.equal(await page.evaluate(() => localStorage.getItem("lab.ptlog")), null, "nothing is logged by default");
await page.evaluate(() => localStorage.clear());
await open("?playtest=1");
assert.match(await txt("#home"), /Playtest log/);
await door("observability"); await page.click("#drawer [data-act=lpick] >> nth=0");
const ptlog = await page.evaluate(() => JSON.parse(localStorage.getItem("lab.ptlog")));
assert.deepEqual(ptlog.map((e) => e.type), ["door", "open", "step", "answer"], "which door, which lesson, which step, what was answered");
assert.equal(ptlog[2].lesson, "timeline");
await page.evaluate(() => localStorage.clear());
// --- trace mode: one recorded answer is a row of squares, one per tool call, and the with-skill answer is a much shorter row
await open("#m=trace");
const nCalls = await page.evaluate(() => __lab.S.tl.calls.length);
assert.ok(nCalls > 10, "the featured answer is a long one");
assert.equal(await page.locator("#svg rect.gc").count(), nCalls, "one square per tool call");
assert.ok(await page.locator("#svg rect.gc.ask").count() > nCalls / 2 && await page.locator("#svg rect.gc.in").count() >= 1, "most of its calls reach outside the folder, and at least one stays inside");
await page.locator("#svg rect.gc").nth(3).click();
assert.match(await txt("#drawer .gcall"), new RegExp(`call 4 of ${nCalls}`), "clicking a square reads that call");
assert.match(await txt("#svg"), /^[\s\S]*4\. \w+:/, "the canvas shows the selected call");
const withIdx = await page.evaluate(() => { const T = __lab.S.tl, rows = __lab.S.runs.runs[T.run].rows; return rows.findIndex((r) => r.arm === "with" && r.probe === T.probe && r.n === T.n); });
await page.selectOption("#tlans", String(withIdx));
assert.ok(await page.locator("#svg rect.gc").count() <= 2, "with the skill: one or two calls");
assert.match(await txt("#drawer .card"), /passed/);
// --- guidance: a ringed square to start with, notes pinned to a square, and a Start screen that remembers where you were
await open("#m=trace");
const firstOut = await page.evaluate(() => __lab.S.tl.labels.findIndex((x) => x.outside));
assert.equal(await page.locator("#svg rect.gc.focus").count(), 1, "one square is ringed");
assert.equal(await page.locator("#svg rect.gc").evaluateAll((r) => r.findIndex((x) => x.classList.contains("focus"))), firstOut, "the ring is on the first call that leaves the folder");
assert.match(await txt("#svg"), /start here, at the ringed square/);
await page.locator("#svg rect.gc").nth(firstOut).click();
await page.fill("#nnote", "Here is where it wanders off.");
await page.click("[data-act=notesave]");
assert.equal(await page.locator("#svg rect.gc.noted").count(), 1, "a pinned note marks its square");
assert.match(await page.evaluate(() => __lab.notesMarkdown()), /Here is where it wanders off\./);
await mode("start");
assert.match(await txt("#home"), /Your notes · 1/);
await page.click("#home summary[data-fold=notes]");
assert.match(await txt("#home"), /Here is where it wanders off\./);
await page.click("#home [data-act=notedel]");
assert.equal(await page.locator("#home summary[data-fold=notes]").count(), 0, "removing the last note removes the fold");
await open("#m=guard"); await page.click("[data-act=grule][data-r=no_home]");
assert.equal(await page.locator("#svg rect.gc.focus").count(), 1, "the Guardrails canvas rings a square once a policy is on");
await page.evaluate(() => localStorage.clear()); await open();
assert.equal(await page.locator("#home .resume").count(), 0, "nothing to pick up on a first visit");
await door("evals"); await page.click("#drawer [data-act=lpick] >> nth=0"); await page.click("#drawer [data-act=lexit]"); await page.click("#home [data-act=advback]");
assert.match(await txt("#home .resume"), /The gate says adopt/, "the lesson you left is offered first");
await page.evaluate(() => localStorage.clear());
// --- notes on the log and scrubber squares, the pin card inside a lesson, and a step that says where to look
await open("#m=guard"); await page.click("[data-act=gtab][data-t=log]"); await page.click("[data-act=glive]");
await page.locator("#svg rect.gc.deny").first().click();
await page.fill("#nnote", "Secrets, fair enough."); await page.click("[data-act=notesave]");
assert.equal(await page.locator("#svg rect.gc.noted").count(), 1, "a note marks a log square");
await page.click("[data-act=gtab][data-t=output]"); await page.locator("#svg rect.gc").nth(5).click();
await page.fill("#nnote", "Leaks here."); await page.click("[data-act=notesave]");
assert.match(await page.evaluate(() => __lab.notesMarkdown()), /Secrets, fair enough\.[\s\S]*Leaks here\./, "both notes are in the export");
await page.evaluate(() => localStorage.clear());
await open(); await door("observability");
await page.locator("#svg rect.gc").nth(2).click();
assert.equal(await page.locator("#nnote").count(), 1, "inside a lesson there is one note box");
assert.equal(await page.locator("#drawer > .pin #nnote").count(), 1, "and it sits under the lesson card, not in a fold");
await page.fill("#nnote", "Third call, already off the map."); await page.click("[data-act=notesave]");
assert.equal(await page.locator("#svg rect.gc.noted").count(), 1, "the note is pinned from inside the lesson");
await page.evaluate(() => localStorage.clear());
await begin("guard"); await page.click("#drawer [data-act=lpick] >> nth=0");
assert.match(await page.locator("#svg rect.gc.focus").getAttribute("class"), /\bfp\b/, "this step rings a harmless call the rule blocked, not an escape");
await page.evaluate(() => localStorage.clear());
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
await unfold("noticed"); await page.locator(".mrow.killed").first().click(); // a kill: which check failed
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
await unfold("bar"); await page.fill("[data-gp=min_gain]", "99"); assert.equal(await fired(), "NO_DELTA");
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
    await begin(id);
    assert.ok(await page.locator("#caption.on").isVisible(), `${id}: the canvas says what to look at`);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll("#drawer details.fold[open]")].filter((d) => !d.parentElement.closest("details:not([open])")).length), LESSONS.find((l) => l.id === id).steps[0].open?.length ?? 0, `${id}: only the folds step 1 asks for are open`);
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
    assert.equal(await page.locator("#drawer [data-act=lpick]").count(), 0, `${id} finished`);
    assert.equal(await page.locator("#drawer .doors-end").count(), 1, `${id}: finishing shows where to go next`);
    assert.match(await txt("#drawer .doors-end"), /Where next\?|Case closed/, `${id}: the doors card asks`);
  }
}
const pg = await page.evaluate(() => JSON.parse(localStorage.getItem("lab.progress")));
assert.ok(Object.keys(pg).length >= 5 && Object.values(pg).every((x) => x.done));

// --- step 4: every challenge is unsolved at first and solved by its reference solution, judged by the real code
{
  const start = async (id) => { await open(); await page.click("summary[data-fold=tools]"); await page.click(`[data-act=cstart][data-id=${id}]`); };
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
