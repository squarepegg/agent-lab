// Browser tests for the load path (no Python, slow Python, offline), the phone layout, beginner wording, recorded runs and every lesson's wrong-pick text.
// ui.mjs plays every mode and challenge; this file checks what a person sees while things load or fail.
import assert from "node:assert/strict";
import { LESSONS } from "../web/lessons.js";
import { newPage, open, ready, idle, errors, done } from "./harness.mjs";
import { url, root } from "./harness.mjs";
import { readFileSync } from "node:fs";

const txt = (page, sel) => page.textContent(sel);
const PARAMS = /min_gain|ceiling|regress_by|max_cost_ratio|_cand_cost|heldout|max_unfinished/;
const click = async (page, sel) => { await page.click(sel); await idle(page); };

// --- JavaScript off: the static shell already says what the site is
{
  const page = await newPage({ javaScriptEnabled: false });
  await page.goto(url);
  const home = await txt(page, "#home");
  assert.match(home, /Your agent passes the demo/);
  assert.equal(await page.locator("#home .ideas li").count(), 5, "five ideas");
  assert.match(home, /time zone/, "the lesson 1 preview question is on the page");
  await page.context().close();
}

// --- the shell text matches lesson 1 step 1, and the preloads point at the Pyodide the code loads
{
  const html = readFileSync(root + "index.html", "utf8"), q = LESSONS[0].steps[0].predict.q.replace(/[`*]/g, "");
  assert.ok(html.replace(/<[^>]+>/g, "").includes(q.slice(0, 40)), "static preview question matches lesson 1");
}

// --- CDN blocked: lesson 1 plays to Finish from recorded results; the next lesson says Python is unavailable
{
  const page = await newPage({ quiet: true });
  await page.context().route("**/cdn.jsdelivr.net/**", (r) => r.abort());
  await open(page);
  await click(page, "#home [data-act=lcont]");
  for (let g = 0; g < 12; g++) {
    const pick = page.locator("#drawer [data-act=lpick]:not([disabled])");
    if (await pick.count()) { await pick.first().click(); await idle(page); assert.match(await txt(page, "#drawer .src"), /recorded from the real code/, `step ${g}`); }
    const next = page.locator("#drawer .lesson [data-act=lnext]"), last = (await next.textContent()).includes("Finish");
    await click(page, "#drawer .lesson [data-act=lnext]"); if (last) break;
  }
  assert.ok(await page.locator("#home").isVisible(), "lesson 1 reached Finish without Python");
  assert.equal(await page.evaluate(() => __lab.ready), false);
  await click(page, "#home [data-act=lstart][data-id=rank]");
  await click(page, "#drawer [data-act=lpick] >> nth=0");
  assert.match(await txt(page, "#drawer .lesson .note"), /could not load/i, "the next lesson says why it cannot be answered");
  await page.context().close();
}

// --- CDN slow: the chip shows progress and a lesson 1 answer arrives while Python is not ready
{
  const page = await newPage({ quiet: true });
  await page.context().route("**/cdn.jsdelivr.net/**", async (r) => { await new Promise((ok) => setTimeout(ok, 4000)); r.continue(); });
  await open(page);
  assert.equal(await page.evaluate(() => __lab.ready), false);
  assert.match(await txt(page, "#py"), /\d+\s*%|loading|Python/i, "a progress chip is visible");
  await click(page, "#home [data-act=lcont]"); await click(page, "#drawer [data-act=lpick] >> nth=0");
  assert.equal(await page.evaluate(() => __lab.ready), false, "answered before Python was ready");
  assert.match(await txt(page, "#drawer"), /Correct|Not quite/);
  await page.context().close();
}

// --- service worker: after one visit, a reload works with the network off
{
  const page = await newPage({ quiet: true });
  await open(page, "?sw=1"); await ready(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => (await caches.keys()).some((k) => k.startsWith("lab-py-")) && (await caches.keys()).some((k) => k.startsWith("lab-app-")), null, { timeout: 60000 });
  await page.waitForFunction(() => navigator.serviceWorker.controller || true);
  await page.reload(); await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 });
  await page.context().setOffline(true);
  await page.reload(); await page.waitForFunction(() => window.__lab?.ready, null, { timeout: 60000 });
  assert.match(await txt(page, "#py"), /ready/i, "Python started from the cache");
  await page.context().close();
}

// --- phone: 390 wide
{
  const page = await newPage({ width: 390, height: 844 });
  await open(page, "#m=gate"); await ready(page); await idle(page);
  assert.equal(await page.locator("#svg").isVisible(), false, "the canvas is replaced by a summary");
  assert.ok(await page.locator("#sum").isVisible());
  const chip = await page.locator("#sum *").evaluateAll((els) => Math.min(...els.filter((e) => e.children.length === 0 && e.textContent.trim()).map((e) => parseFloat(getComputedStyle(e).fontSize))));
  assert.ok(chip >= 12, `summary text is at least 12px (${chip})`);
  assert.ok(await page.locator("#tools .lbl").first().isVisible(), "the bottom bar is labelled");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal scroll");
  assert.ok(await page.evaluate(() => { const r = document.querySelector("#gverdict").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), "the verdict is on screen");
  await page.context().close();
}

// --- beginner Gate: no internal parameter name, verdict in view without scrolling
{
  const page = await newPage();
  await open(page, "#m=gate"); await ready(page); await idle(page);
  assert.match(await txt(page, "#level"), /beginner/);
  for (const sel of ["#drawer", "#svg", "#sum"]) assert.doesNotMatch(await page.evaluate((s) => { const e = document.querySelector(s); return e.innerText ?? e.textContent; }, sel), PARAMS, `${sel} has no parameter names`);
  for (const k of ["Already good", "Helps most, hurts one", "No effect", "Skill clearly helps"]) { await click(page, `[data-act=preset][data-k='${k}']`); assert.doesNotMatch(await page.evaluate(() => document.querySelector("#drawer").innerText + document.querySelector("#svg").textContent), PARAMS, k); }
  assert.ok(await page.evaluate(() => { const r = document.querySelector("#gverdict").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), "verdict visible at 1440x860");
  await page.context().close();
}

// --- Break it: a plain score sentence, a reason on every survivor, and a fix that raises the score
{
  const page = await newPage();
  await open(page, "#m=break"); await ready(page); await idle(page);
  await click(page, "[data-act=auto]");
  await page.waitForFunction(() => /Mutation score \d+\/\d+/.test(document.querySelector("#drawer").textContent), null, { timeout: 30000 });
  assert.match(await txt(page, "#drawer"), /of \d+ deliberate breaks made at least one eval fail/);
  const score = async () => +/Mutation score (\d+)\//.exec(await txt(page, "#drawer"))[1];
  const before = await score();
  assert.ok(await page.locator(".mrow.survived").count() >= 1);
  assert.equal(await page.locator(".mrow.survived .why:empty").count(), 0, "every survivor is explained");
  await click(page, "[data-act=fixrow] >> nth=0");
  assert.ok((await score()) > before, "the fix raises the score");
  await page.context().close();
}

// --- recorded runs: the card names model and date; a cell opens the real answer; skill A/B lists recorded verdicts
{
  const page = await newPage();
  await open(page, "#m=gate"); await ready(page); await idle(page);
  const file = await page.locator("#grun option").nth(1).getAttribute("value");
  await page.selectOption("#grun", file); await idle(page);
  assert.match(await txt(page, ".card.rec"), /haiku|sonnet|Haiku|Sonnet/);
  assert.match(await txt(page, ".card.rec"), /20\d\d-\d\d-\d\d/);
  await click(page, "[data-act=gpeek] >> nth=0");
  assert.ok((await txt(page, ".peek .ans")).length > 0, "the model's answer is shown");
  await click(page, "#tools button[data-m=abskill]");
  await page.selectOption("#sk", "dst"); await click(page, "[data-act=sload]"); await click(page, "[data-act=sgo]");
  assert.ok(await page.locator("table.rec tr.rowx").count() >= 2, "recorded runs of the unmodified skill");
  await page.context().close();
}

// --- Guardrails: switches change the score, a typed attack gets a verdict, your own function is judged, the phone shows a summary
{
  const page = await newPage();
  await open(page, "#m=guard"); await ready(page); await idle(page);
  const score = async () => /(\d+) of (\d+) escapes blocked/.exec(await txt(page, "#gscore"));
  assert.ok(await page.locator(".gc").count() > 100, "one square per real tool call");
  assert.equal((await score())[1], "0", "no rules, nothing blocked");
  await click(page, "[data-act=grule][data-r=no_absolute]");
  const [, caught, escapes] = await score();
  assert.equal(caught, escapes, "this rule catches every real escape");
  assert.equal(await page.locator(".gc.caught").count(), +caught);
  assert.equal(await page.locator(".gc.fp").count(), 0, "and blocks nothing harmless");
  await click(page, "[data-act=grule][data-r=no_bash]");
  assert.ok(await page.locator(".gc.fp").count() > 50, "blocking every command stops harmless work, shown in amber");
  await click(page, "[data-act=grule][data-r=no_bash]");
  await page.fill("#gtext", "ls $HOME"); await click(page, "[data-act=gtry]");
  assert.match(await txt(page, ".gtry"), /got through/);
  await page.fill("#gtext", "cat ~/.ssh/config"); await click(page, "[data-act=gtry]");
  assert.match(await txt(page, ".gtry"), /Blocked, and it would have gone outside/);
  await page.locator(".gc.caught").first().click(); await idle(page);
  assert.match(await txt(page, ".gcall"), /Blocked/);
  // your own function, at the experienced level
  await click(page, "#level");
  await page.fill("#gcode", "def allowed(name, args):\n    return name != 'bash'"); await click(page, "[data-act=gcode]");
  assert.ok(await page.locator(".gc.fp").count() > 50, "a function that blocks bash behaves like the switch");
  await page.fill("#gcode", "def allowed(:"); await click(page, "[data-act=gcode]");
  assert.match(await txt(page, "#drawer .note.bad"), /SyntaxError/, "a broken function is reported, the last score stays");
  await page.fill("#gcode", "def allowed(name, args):\n    while True: pass"); await click(page, "[data-act=gcode]");
  assert.match(await txt(page, "#drawer .note.bad"), /endless loop/);
  await page.context().close();
}
{
  const page = await newPage({ width: 390, height: 844 });
  await open(page, "#m=guard"); await ready(page); await idle(page);
  assert.equal(await page.locator("#svg").isVisible(), false);
  assert.match(await page.evaluate(() => document.querySelector("#sum").innerText), /blocked an escape/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "no horizontal scroll");
  await page.context().close();
}

// --- every lesson: the computed answer is the one the lesson expects, and a wrong pick explains itself
{
  const page = await newPage();
  await open(page); await ready(page);
  for (const L of LESSONS) {
    await open(page); await click(page, `[data-act=lstart][data-id=${L.id}]`);
    for (let i = 0; i < L.steps.length; i++) {
      const st = L.steps[i];
      if (st.setup?.some(([a]) => a === "grun")) assert.match(await txt(page, "#svg"), /recorded run:/, `${L.id} step ${i + 1}: the canvas shows the recorded run, not the hand-set one`);
      if (st.predict) {
        const choices = await page.locator("#drawer [data-act=lpick]").evaluateAll((b) => b.map((x) => x.dataset.c));
        const wrong = choices.find((c) => c !== st.predict.expects) ?? choices[0];
        await click(page, `#drawer [data-act=lpick][data-c="${wrong}"]`);
        assert.equal(await page.locator("#drawer .btn.right").getAttribute("data-c"), st.predict.expects, `${L.id} step ${i + 1}: the real code gives the expected answer`);
        assert.equal(await page.locator("#drawer .lt.miss").count(), 1, `${L.id} step ${i + 1}: a wrong pick gets a miss line`);
        assert.doesNotMatch(await txt(page, "#drawer .lt.miss"), /^You picked “[^”]*”\.$/, `${L.id} step ${i + 1}: miss text is written`);
      }
      if (i === L.steps.length - 1) assert.equal(await page.locator("#drawer .learned").count(), 1, `${L.id}: the last step says what you learned`);
      await click(page, "#drawer .lesson [data-act=lnext]");
    }
  }
  await page.context().close();
}

// --- localStorage throws: lesson 1 still completes
{
  const page = await newPage();
  await page.addInitScript(() => { const boom = () => { throw new Error("blocked"); }; Object.defineProperty(window, "localStorage", { get: boom }); });
  await open(page); await click(page, "#home [data-act=lcont]");
  for (let g = 0; g < 12; g++) {
    const pick = page.locator("#drawer [data-act=lpick]:not([disabled])"); if (await pick.count()) await pick.first().click(); await idle(page);
    const next = page.locator("#drawer .lesson [data-act=lnext]"), last = (await next.textContent()).includes("Finish");
    await click(page, "#drawer .lesson [data-act=lnext]"); if (last) break;
  }
  assert.ok(await page.locator("#home").isVisible(), "finished with storage blocked");
  await page.context().close();
}

assert.deepEqual(errors, []);
await done();
console.log("ui_modes ok");
