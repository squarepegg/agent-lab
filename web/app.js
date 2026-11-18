import { connectLab } from "./lab.js";
import { LESSONS, PILLARS, CASES, checkClaims, noise, featured, casePair } from "./lessons.js";
import { CHALLENGES } from "./challenges.js";
import { extractFunc, annotate, coverage, MODE_CODE, NOTES, TWEAKS, applyTweak, lineDiff, brief } from "./codepanel.js";
import { buildGraph, layout, neighbors, gateSteps, clip, encodeGate, decodeGate, FILE_KINDS, PLAIN_VERDICT, plainReason, costs, runGrid, traceStats, slimRun, modelName } from "./model.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const NS = "http://www.w3.org/2000/svg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kindVar = (k) => `var(--${k === "eval" ? "eval" : k})`;
const phone = () => matchMedia("(max-width:720px)").matches;
const RECORD = /[?&]record=1/.test(location.search);   // tests_js/record.mjs: never answer from the recording, log every call
// localStorage can throw (private mode, blocked, full). Progress is a convenience: failing to save it must not break a lesson.
const store = {
  get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* not saved */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* nothing to remove */ } },
  json(k) { try { return JSON.parse(this.get(k, "null")); } catch { return null; } },
};
// Playtest log: opt-in and local. ?playtest=1 turns it on (and remembers it); one line per event goes to localStorage and nowhere else. The Start screen
// then offers Download and Clear. Stalls are read from the gaps between events: which beat, which step, how long, which door.
const PT = /[?&]playtest=1/.test(location.search) ? (store.set("lab.playtest", "1"), true) : store.get("lab.playtest") === "1";
const pt = (type, data = {}) => { if (!PT) return; const log = store.json("lab.ptlog") || []; log.push({ t: Date.now(), type, ...data }); store.set("lab.ptlog", JSON.stringify(log.slice(-1000))); };

const ICON = {
  explore: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l8 1M7.5 8l3 8M16.5 10l-3 6"/>',
  evals: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  break: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  gate: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  trace: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
  abfact: '<path d="M12 5v14M5 12h14"/><rect x="3" y="3" width="18" height="18" rx="4"/>',
  abskill: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  start: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v15H5.5C4.7 19 4 18.3 4 17.5zM20 5.5c0-.8-.7-1.5-1.5-1.5H13v15h5.5c.8 0 1.5-.7 1.5-1.5z"/>',
  guard: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
};
const NAV = { start: "Start", explore: "Map", evals: "Evals", break: "Break it", gate: "Gate", trace: "Trace", abfact: "A/B fact", abskill: "A/B skill", guard: "Guardrails", about: "About" };
const MODES = [
  ["start", "Start", "scene-home", "Guided lessons: make a guess, then watch the real code answer."],
  ["explore", "Map", "scene-graph", "The map: facts, workstreams, decisions and the evals that read them. Hover to trace, click to open and edit."],
  ["evals", "Evals", "scene-graph", "Replay one eval step by step, or add a bad one and watch it fail."],
  ["break", "Break it", "scene-graph", "Break the knowledge on purpose and see which evals notice. The ones that don't are blind spots."],
  ["gate", "The gate", "scene-gate", "Same results in, same verdict out. Judge hand-set results or a recorded model run."],
  ["trace", "Trace", "scene-trace", "One recorded answer, call by call: what the agent actually did."],
  ["abfact", "A/B a fact", "scene-graph", "Drop a new fact into a copy of the map and see what it breaks, hijacks or fits."],
  ["abskill", "A/B a skill", "scene-skill", "Lint a skill, check its text covers the probes, and compare with recorded model runs."],
  ["guard", "Guardrails", "scene-guard", "What an agent may do (a policy tested on real tool calls) and what it may say (a scrubber tested on real output)."],
  ["about", "About", "scene-about", "What is real here and what is not."],
];

// ---------------- state
const HASH0 = location.hash;
let lab, bundle;
const S = { mode: "start", files: {}, questions: "", docs: [], results: [], qlist: [], graph: null, sel: null, ov: {}, whatif: null, preview: null, runs: null, skills: {},
  view: { x: 0, y: 0, k: 1 }, level: store.get("lab.level") || "beginner", tab: {}, fold: {}, trace: new Map(), edits: {}, gate: null, skill: {}, replayTok: 0, ref: {}, ready: false, case: "dst", corpus: null };
// Every result comes from the real Python. `call` waits for it; while Python is still loading, calls that were recorded from the
// real code at build time (web/recorded.json) answer at once.
const raw = (n, a) => lab.call(n, a);   // errors of the learner's own edit come back as data
const call = async (n, a) => { const r = await raw(n, a); if (r && r.error) throw new Error(r.error); return r; };
// One action at a time, in click order: every handler runs through `act`. Code inside an action awaits helpers directly and never
// calls `act` (it would wait for itself). Detached animations (replay, auto-mutate) use `act` for each frame.
let Q = Promise.resolve();
const act = (fn) => (Q = Q.then(fn).catch((e) => { toast(e.message, "fail"); console.error(e); }));
const idle = async () => { let q; do { q = Q; await q; } while (q !== Q); };

// ---------------- svg helpers
function el(tag, attrs = {}, kids = []) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const c of [].concat(kids)) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const vp = () => $("vp");
function applyView() { vp().setAttribute("transform", `translate(${S.view.x} ${S.view.y}) scale(${S.view.k})`); }
function fit(w, h) {
  S.size = [w, h];
  const r = $("svg").getBoundingClientRect(); if (!r.width || !r.height) return;   // hidden on a phone: the summary is shown instead
  const k = Math.min(r.width / (w + 20), r.height / (h + 20), 1.25);
  S.view = { k, x: (r.width - w * k) / 2, y: Math.max(6, (r.height - h * k) / 2) };
  applyView();
}
function toast(msg, cls = "") { const t = $("toast"); t.textContent = msg; t.className = "show " + cls; clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ""), 2600); }

// ---------------- data refresh
async function refresh() {
  const r = await call("run_evals", { files: S.files, questions: S.questions });
  S.results = r.results; S.summary = r.summary;
  S.docs = await call("explore", { files: S.files });
  S.qlist = await call("parse_yaml", { text: S.questions });
}
function currentGraph() {
  if (S.preview) return buildGraph(S.preview.docs, S.preview.results);
  return buildGraph(S.docs, S.whatif?.results ?? S.results);
}

// ---------------- graph scene
const FILE_W = 340;
function renderGraph() {
  const g = (S.graph = currentGraph());
  const L = (S.layout = layout(g, { fileW: FILE_W }));
  const root = vp(); root.replaceChildren();
  const edges = el("g"), nodes = el("g"); S.ref = { nodes: new Map(), edges: [] };
  root.append(edges, nodes);
  root.append(el("text", { class: "col", x: 30, y: 44 }, "evals (questions)"), el("text", { class: "col", x: 600, y: 44 }, "knowledge (files)"));
  if (L.uncoveredAt != null) { root.append(el("line", { class: "gap", x1: 600, x2: 600 + FILE_W, y1: L.uncoveredAt, y2: L.uncoveredAt }), el("text", { class: "gaptxt", x: 600, y: L.uncoveredAt - 4 }, "no eval reads these")); }
  for (const e of g.edges) {
    const a = L.pos[e.from], b = L.pos[e.to]; if (!a || !b) continue;
    const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2, mx = (x1 + x2) / 2;
    const isNew = S.preview && e.to === S.preview.path;
    const p = el("path", { class: `edge ${e.rank > 1 ? "weak" : ""} ${isNew ? "newe" : ""}`, d: `M${x1} ${y1} C${mx} ${y1},${mx} ${y2},${x2} ${y2}` });
    edges.append(p); S.ref.edges.push([e, p]);
  }
  for (const n of [...g.evals, ...L.files]) nodes.append(nodeEl(n, L.pos[n.id]));
  fit(L.width, L.height);
  paintOverlay();
}
// A node shows a clipped title; hovering or focusing it shows the whole title and path, widening the box if it must.
function nodeEl(n, p) {
  const isEval = n.kind === "eval", chars = Math.floor((p.w - 34) / 7.1);
  const cls = ["node"];
  if (isEval && n.pass != null) { cls.push(n.tier === "skip" ? "skip" : n.pass ? "pass" : "fail"); }
  const sub = n.sub ?? (isEval ? `search "${n.query}" · ${n.tier}` : n.path);
  const g = el("g", { class: cls.join(" "), tabindex: 0, role: "button", "data-id": n.id, "aria-label": n.title, transform: `translate(${p.x} ${p.y})` }, [
    el("rect", { class: "box", width: p.w, height: p.h, rx: 9 }),
    el("rect", { class: "bar", x: 0, y: 0, width: 5, height: p.h, rx: 2, fill: kindVar(n.kind) }),
    el("text", { class: "t", x: 16, y: 16 }, clip(n.title, chars - 3)),   // room for the rank badge at the right edge
    el("text", { class: "s", x: 16, y: 30 }, clip(sub, Math.floor(chars * 1.2))),
  ]);
  if (isEval && n.pass != null) g.append(el("circle", { class: "dot", cx: p.w - 14, cy: p.h / 2, r: 4.5, fill: n.tier === "skip" ? "var(--dim)" : n.pass ? "var(--pass)" : "var(--fail)" }));
  const full = [n.title, sub], short = [g.querySelector(".t").textContent, g.querySelector(".s").textContent];
  const grow = (on) => {
    const t = g.querySelector(".t"), s = g.querySelector(".s");
    t.textContent = on ? full[0] : short[0]; s.textContent = on ? full[1] : short[1];
    const w = on ? Math.max(p.w, Math.max(t.getComputedTextLength(), s.getComputedTextLength() * 1) + 44) : p.w;
    g.querySelector("rect.box").setAttribute("width", w); g.querySelector("circle.dot")?.setAttribute("cx", w - 14);
    g.classList.toggle("wide", on && w > p.w);
    if (on && w > p.w && g.parentNode.lastChild !== g) g.parentNode.append(g);   // draw over its neighbours
  };
  const needs = full[0] !== short[0] || full[1] !== short[1];
  const on = () => { focusNode(n.id); if (needs) grow(true); }, off = () => { focusNode(null); if (needs) grow(false); };
  g.addEventListener("mouseenter", on); g.addEventListener("mouseleave", off);
  g.addEventListener("focus", on); g.addEventListener("blur", off);
  g.addEventListener("click", (ev) => { ev.stopPropagation(); act(() => onNode(n.id)); });
  g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); act(() => onNode(n.id)); } });
  if (needs) g.append(el("title", {}, `${n.title}\n${sub}`));
  S.ref.nodes.set(n.id, g);
  return g;
}
function focusNode(hover) {
  const id = hover ?? S.sel; if (!S.graph) return;
  const nb = id ? neighbors(S.graph, id) : null;
  for (const [nid, g] of S.ref.nodes) g.classList.toggle("dim", !!nb && !nb.has(nid) || (!!S.ov.ranks && !nb && !(nid in S.ov.ranks)));
  for (const [e, p] of S.ref.edges) { const on = !!nb && (e.from === id || e.to === id); p.classList.toggle("hot", on); p.classList.toggle("dim", !!nb && !on); }
}
function paintOverlay() {
  const ov = S.ov;
  for (const [id, g] of S.ref.nodes) {
    g.classList.toggle("sel", id === S.sel);
    g.classList.toggle("broken", id === S.whatif?.broken);
    g.classList.toggle("new", !!S.preview && id === S.preview.path);
    g.classList.toggle("poll", !!S.preview && S.preview.ab.polluted.some((x) => "eval:" + x.id === id));
    g.querySelector(".badge")?.remove(); g.querySelector(".badge-t")?.remove();
    const r = ov.ranks?.[id];
    if (r) { const w = +g.querySelector("rect.box").getAttribute("width"); g.append(el("circle", { class: "badge", cx: w - 14, cy: 14, r: 10 }), el("text", { class: "badge-t", x: w - 14, y: 18 }, r)); }
  }
  focusNode(null); summary();
}
function flash(ids) {
  for (const id of ids) {
    for (const g of [S.ref.nodes.get(id), $("sum").querySelector(`[data-node="${CSS.escape(id)}"]`)]) {
      if (g) { g.classList.remove("flash"); void g.getBoundingClientRect(); g.classList.add("flash"); setTimeout(() => g.classList.remove("flash"), 1900); }
    }
  }
}

// ---------------- node clicks
async function onNode(id) {
  if (!S.graph || !(S.graph.evals.some((e) => e.id === id) || S.graph.files.some((f) => f.id === id))) return;   // skill and about scenes: display only
  S.sel = S.sel === id ? null : id;
  if (S.mode === "evals" && id.startsWith("eval:")) { S.sel = id; replay(id.slice(5)); }
  paintOverlay(); await drawer();
}

// ---------------- evals: replay one eval step by step. Detached: started inside an action, never awaited by it.
async function replay(evalId) {
  const tok = ++S.replayTok, r = (S.whatif?.results ?? S.results).find((x) => x.id === evalId); if (!r) return;
  const hits = (S.graph.edges.filter((e) => e.from === "eval:" + evalId)).sort((a, b) => a.rank - b.rank);
  S.ov = { ranks: {} }; paintOverlay(); S.replay = { id: evalId, shown: 0, done: false };
  const frame = (fn) => act(() => { if (tok !== S.replayTok) return; return fn(); });
  await frame(drawer);
  await sleep(300);
  for (const e of hits) { if (tok !== S.replayTok) return; await frame(() => { S.ov.ranks[e.to] = e.rank; paintOverlay(); }); await sleep(260); }
  for (let i = 0; i < r.checks.length; i++) { if (tok !== S.replayTok) return; await frame(() => { S.replay.shown = i + 1; return drawer(); }); await sleep(260); }
  await frame(() => { S.replay.done = true; toast(r.tier === "skip" ? "skipped" : r.pass ? "PASS" : "FAIL", r.pass ? "pass" : "fail"); return drawer(); });
}

// ---------------- Python status (top bar): loading with progress, ready, or failed
function pyState() {
  const p = $("py"), pct = Math.round(lab.pct * 100), need = !lab.ready && lab.waiting > 0;
  p.className = "py " + (lab.failed ? "fail" : lab.ready ? "ready" : need ? "load need" : "load");
  $("pyfill").style.width = pct + "%";
  $("pytxt").textContent = lab.failed ? "Python did not load" : lab.ready ? "Python ready" : need ? `Waiting for Python ${pct}% · this step needs it` : `Python ${pct}% · ${lab.label}`;
  p.title = lab.failed ? lab.failed + ". Recorded steps still work. Reload to try again." : lab.ready ? "The real Python is running in your browser. Every result is computed live." : "The real Python is loading in the background. Lesson 1 runs from results recorded from the same code.";
  const hp = $("homepy"); if (hp) hp.innerHTML = homePy();
  if (lab.ready && !S.pyWasReady) {
    S.pyWasReady = true; window.__lab && (window.__lab.ready = true);
    if (S.stale) { S.stale = false; act(drawer); }   // light up the Python lines that had to wait
  }
}
const homePy = () => (lab.failed ? `<span class="bad">Python could not load, so only the first Evals lesson works. Reload to try again.</span>`
  : lab.ready ? ""   // the header chip already says so
  : `The first Evals lesson already works, from results recorded off the real code. Python is still loading in the background (${Math.round(lab.pct * 100)}%), so the other lessons will wake up in a moment.`);

// ---------------- drawer
const setStatus = () => {
  const s = S.summary; $("st1").textContent = s ? `evals ${s.must_pass}/${s.must_total} must pass${s.skipped ? ` · ${s.skipped} skipped` : ""}` : "";
  $("st2").textContent = `${Object.keys(S.files).length} files · deterministic · no model calls`;
};
// A fold is a <details> whose open state survives the drawer re-rendering. `def` is only the default.
const foldOpen = (key, def) => S.fold[key] ?? def;
const fold = (key, title, html, def) => (html ? `<details class="fold" ${foldOpen(key, def) ? "open" : ""}><summary data-fold="${key}" data-def="${def ? 1 : 0}"><span>${title}</span></summary>${html}</details>` : "");
function caption() {
  const look = S.lesson && !S.lesson.finished ? (lstep()[1].look ?? lstep()[0].look) : "";
  const on = !!look, was = $("stage").classList.contains("cap");
  $("caption").innerHTML = on ? `<b>look at</b><span title="${esc(look)}">${esc(look)}</span>` : ""; $("caption").classList.toggle("on", on); $("stage").classList.toggle("cap", on);
  if (on !== was && S.size && S.mode !== "start") fit(...S.size);   // the strip takes height from the canvas
}
// Python results a render needs are fetched first, so the render itself is synchronous.
async function prep() {
  if (S.mode === "start") return;
  const ts = MODE_CODE[S.mode] && traceSpec();
  if (ts) {
    const key = JSON.stringify(ts);
    if (!S.trace.has(key)) {
      if (lab.ready || RECORD) { try { S.trace.set(key, (await call("trace", ts)).hits); } catch { S.trace.set(key, null); } }
      else { const r = lab.peek("trace", ts); if (r) S.trace.set(key, r.hits); else S.stale = true; }   // not recorded: redrawn when Python is ready
      if (S.trace.size > 24) S.trace.delete(S.trace.keys().next().value);
    }
  }
  if (S.lesson && lstep()[1].widget === "noise") S.lesson.noise = await noiseRows(S.lesson.samples ?? 3);
}
// What the drawer shows depends on what you are doing.
//   start: the Start screen, no drawer.   lesson: the lesson card, everything else folded away.
//   challenge: the card plus the controls it needs.   free explore: the mode's controls; the real Python is a fold.
async function drawer() {
  await prep();
  const d = $("drawer"), m = MODES.find((x) => x[0] === S.mode), keep = d.scrollTop;
  document.body.classList.toggle("home", S.mode === "start");
  setStatus(); caption();
  if (S.mode === "start") { $("home").innerHTML = homeHtml(); d.innerHTML = ""; return; }
  if (S.lesson?.finished) { d.innerHTML = doorsCard(); bindDrawer(); return; }
  const lesson = !!S.lesson, guided = lesson || !!S.chal, step = lesson ? lstep()[1] : null;
  const body = DRAW[S.mode]?.() ?? "", cp = codePanel(), ec = editCell();
  let h = lessonCard() + chalCard();
  if (!guided) h += `<h2>${m[1]}</h2>` + beginnerIntro();
  const opens = (k) => !!step?.open?.includes(k);   // lessons say which folds a step needs; free explore opens the Python for experienced users
  h += lesson ? fold("poke", "Poke at it yourself", body, opens("poke")) : body;
  if (cp) h += fold("code", cp.title, cp.html, lesson ? opens("code") : !guided && S.level !== "beginner");
  if (ec) h += fold("try", ec.title, (lesson && opens("try") ? `<div class="note">The lesson runs this edit for you once you answer. You can try other edits here, but you do not have to.</div>` : "") + ec.html, opens("try"));
  d.innerHTML = h; d.scrollTop = keep; bindDrawer();
}
// ---------------- level + real-code panel
const INTRO = {
  explore: ["Each box on the right is a file the agent can read; each box on the left is a question (an eval) we ask of it.", "Search “deploy” below and watch the numbered badges: that is the ranking function at work."],
  evals: ["An eval is a question plus a pass/fail check. No model is involved: the “agent” is a search, so results never change.", "Click an eval to replay it, then press “+ bad expect” to see what a failing one looks like."],
  break: ["If you delete a fact and every eval still passes, the evals would not have noticed. That is a blind spot.", "Press “Auto-mutate everything” and read why each break was or was not noticed."],
  gate: ["A gate is a fixed checklist that turns results into one verdict. The rules run top to bottom and the first that fires wins.", "Press “No effect”, or pick a recorded run and click a ✔ or ✘ to read what the model answered."],
  abfact: ["Before adding a note to a knowledge base, test it: does it break an eval, steal a top search result, or can it even be found?", "Press “load a hijacking fact” then A/B it."],
  abskill: ["A skill is a short instruction file for an agent. The text check here is a proxy: it shows the skill could help. The recorded runs show what two real models did.", "Press “filler skill” then A/B: lint passes, the gate says no."],
  trace: ["A trace is what an agent actually did: every tool call, in order. This is one recorded answer; each square is one call.", "Click a square, then pick an answer that made far fewer calls."],
  guard: ["A guardrail limits an agent. “What it may do” tests a policy on real tool calls from the recorded runs; “What it may say” tests the scrubber that cleans those runs. The rules and the scrubber are written for this lab; the “real one” option is upstream's own guard_hook.py.", "Switch on “Block every shell command”, then read what it stops that was harmless."],
  about: ["Everything here runs the real upstream Python files, unmodified, in your browser.", ""],
};
const INTRO_SAY = ["The recordings are scrubbed before they are saved. Here the lab rebuilds the real texts on a made-up machine and asks your scrubber to clean them.", "Press “What record_runs.py does”, then type something that might still leak."];
function beginnerIntro() {
  const i = S.mode === "guard" && S.guard?.tab === "output" ? INTRO_SAY : INTRO[S.mode]; if (S.level !== "beginner" || !i) return "";
  return (i[1] ? `<div class="try"><b>Try</b> ${i[1]}</div>` : "") + fold("intro", "What am I looking at?", `<div class="mut">${i[0]}</div>`, false);
}
function traceSpec() {
  const f = S.files, q = S.questions;
  switch (S.mode) {
    case "explore": return S.lastQ ? { target: "search", args: { files: f, query: S.lastQ } } : null;
    case "evals": case "break": {
      if (S.mode === "break" && S.lastMut) return { target: "mutate", args: { files: f, questions: q, mutation: S.lastMut } };
      const id = S.sel?.startsWith("eval:") ? S.sel.slice(5) : null;
      if (!id) return { target: "run_evals", args: { files: f, questions: q } };
      return { target: "run_evals", args: { files: f, questions: JSON.stringify(S.qlist.filter((x) => x.id === id)) } };
    }
    case "gate": return !S.gate?.res ? null : S.gate.run ? { target: "gate_run", args: { res: slimRun(S.runs.runs[S.gate.run]), params: S.gate.params } }
      : { target: "gate", args: { probes: S.gate.probes, grid: S.gate.grid, params: S.gate.params, samples: 3 } };
    case "abfact": return S.ab ? { target: "search", args: { files: { ...f, [S.ab.path]: S.ab.text }, query: S.ab.own } } : null;
    case "abskill": { const k = S.skill; if (!k.res) return null; const ps = bundle.probes.filter((p) => p.skill === k.name);
      return { target: "ab_skill", args: { text: k.text, probes: ps, rates: Object.fromEntries(ps.map((p) => [p.id, k.rate])), samples: 3 } }; }
    default: return null;
  }
}
const TRACE_WHAT = { explore: "your last search", evals: "the selected eval (or all of them)", break: "the last break (or all evals)", gate: "the current outcomes and thresholds", abfact: "the fact's own query", abskill: "the last A/B" };
function codePanel() {
  const spec = MODE_CODE[S.mode]; if (!spec) return null;
  const ti = Math.min(S.tab[S.mode] || 0, spec.length - 1), [file, fn, label] = spec[ti];
  const src = bundle.py["vendor/" + file], f = src && extractFunc(src, fn); if (!f) return null;
  const ts = traceSpec(), key = ts && JSON.stringify(ts), known = !!ts && S.trace.has(key);
  const hits = known ? S.trace.get(key)?.[file] ?? {} : null;
  const rows = annotate(f, hits, NOTES[`${file}:${fn}`]), cov = coverage(rows), beg = S.level === "beginner";
  const body = rows.map((r) => `<div class="cl ${hits ? r.state : "none"}"><span class="ln">${r.n}</span><span class="cx">${esc(r.text) || " "}</span><span class="cnt">${hits && r.count > 1 && !beg ? "×" + r.count : ""}</span></div>` +
    (beg && r.note && r.code ? `<div class="cn">↳ ${esc(r.note)}</div>` : "")).join("");
  const tabs = spec.length > 1 ? `<div class="row tabs">${spec.map((x, i) => `<button class="btn alt ${i === ti ? "on" : ""}" data-act="ctab" data-i="${i}">${x[2]}</button>`).join("")}</div>` : "";
  const legend = !ts ? `<div class="mut">Do something on the left and the lines that ran will light up.</div>`
    : !known ? `<div class="mut">The lines that ran will light up as soon as Python has loaded.</div>`
    : `<div class="mut"><span class="ok">green</span> lines ran for ${TRACE_WHAT[S.mode]}${cov.total ? ` · ${cov.ran}/${cov.total} lines` : ""}. ${beg ? "Grey lines did not run this time." : "Counts show loop iterations."}</div>`;
  return { title: `The Python behind this <span class="mut">${esc(file)}${hits && cov.total ? ` · ${cov.ran}/${cov.total} lines ran` : ""}</span>`,
    html: `${tabs}${legend}<div class="code">${body}</div><div class="mut">unmodified upstream <code>${esc(bundle.vendor.files[file]?.path ?? file)}</code> (${esc(bundle.vendor.files[file]?.repo ?? "")}), line numbers match the file.</div>` };
}
// ---------------- step 2: edit the real function and re-run the same input
function editCtx() {
  const spec = MODE_CODE[S.mode]; if (!spec) return null;
  const [file, fn] = spec[Math.min(S.tab[S.mode] || 0, spec.length - 1)];
  const f = bundle.py["vendor/" + file] && extractFunc(bundle.py["vendor/" + file], fn); if (!f) return null;
  const key = `${S.mode}:${file}:${fn}`;
  return { file, fn, key, orig: f.rows.map((r) => r.text).join("\n"), E: (S.edits[key] ||= { src: null, out: null, tweak: null }), tweaks: TWEAKS[`${file}:${fn}`] || [] };
}
function editCell() {
  const c = editCtx(); if (!c) return null; const { E, orig } = c, beg = S.level === "beginner", ts = traceSpec();
  const src = E.src ?? orig, o = E.out;
  let h = `<div class="mut">${beg ? "Pick a tweak. The same input runs through your changed function and we compare with the real one." : "Edit the function and run the same input through it. Only this cell sees your edit; the canvas stays on the real code."}</div>`;
  if (c.tweaks.length) h += `<div class="row">${c.tweaks.map((t, i) => `<button class="btn alt ${E.tweak === t ? "on" : ""}" data-act="edtweak" data-i="${i}">${esc(t.label)}</button>`).join("")}</div>`;
  else if (beg) h += `<div class="mut">No guided tweaks for <code>${esc(c.fn)}</code>. Switch level to <b>experienced</b> to edit it freely.</div>`;
  if (!beg) h += `<textarea id="edsrc" spellcheck="false" style="min-height:${Math.min(360, 30 + orig.split("\n").length * 15)}px;white-space:pre;overflow:auto">${esc(src)}</textarea>`;
  h += `<div class="row"><button class="btn" data-act="edrun" ${ts ? "" : "disabled"}>Run with my edit</button><button class="btn alt" data-act="edreset">Reset to upstream</button></div>`;
  if (!ts) h += `<div class="mut">Do something on the left first (search, pick an eval, press A/B) so there is an input to run.</div>`;
  if (E.src != null && E.src !== orig) {
    const d = lineDiff(orig, E.src);
    h += `<div class="code diff">${d.map((x) => `<div class="cl ${x.kind}"><span class="ln">${x.kind === "del" ? "−" : x.kind === "add" ? "+" : ""}</span><span class="cx">${esc(x.text)}</span></div>`).join("")}</div>`;
  }
  if (o) {
    const changed = !o.error && JSON.stringify(o.base) !== JSON.stringify(o.edited);
    h += `<div class="card"><div class="mut">real code</div><div>${esc(brief(o.target, o.base))}</div><div class="mut" style="margin-top:6px">your edit</div>` +
      (o.error ? `<div class="bad">${esc(o.error)}</div>` : `<div class="${changed ? "warn" : ""}">${esc(brief(o.target, o.edited))}</div><div class="big ${changed ? "warn" : "ok"}">${changed ? "RESULT CHANGED" : "no visible change"}</div>`) +
      (E.tweak && !o.error ? `<div class="note" style="margin-top:8px">${esc(E.tweak.why)}${E.tweak.preset && !presetActive(E.tweak.preset) ? ` Try the “${esc(E.tweak.preset)}” preset.` : ""}</div>` : "") + `</div>`;
  }
  return { title: "Try it: change the real code", html: h };
}
const fileEditor = () => {
  const p = S.sel && S.files[S.sel] != null ? S.sel : null;
  if (!p) return `<div class="mut">Click a file to open it. Click an eval to see what it reads.</div>`;
  const n = S.docs.find((x) => x.path === p), fm = n?.frontmatter || {};
  return `<h3>${esc(n?.kind)} · ${esc(p)}</h3><div class="mut">${Object.keys(fm).map((k) => `<span class="pill">${esc(k)}</span>`).join("")}</div>
    <textarea id="fbody" style="min-height:240px">${esc(S.files[p])}</textarea><div class="row"><button class="btn" data-act="save">Save edit</button><button class="btn alt" data-act="reset">Reset all files</button></div>
    <div class="mut">Edits stay in this tab. Re-run evals to see the graph change.</div>`;
};
const evalInfo = () => {
  const id = S.sel?.startsWith("eval:") ? S.sel.slice(5) : null; const r = id && S.results.find((x) => x.id === id);
  if (!r) return "";
  return `<h3>eval · ${esc(r.id)}</h3><div>${esc(r.q)}</div><div class="mut">lookup: <code>search "${esc(r.query)}"</code></div>`;
};
const shortPath = (p) => p.replace(/^facts\//, "").replace(/\.md$/, "");
const mutLabel = (m) => `${m.op === "delete_file" ? "Delete" : m.op === "remove_text" ? "Remove" : "Replace"}${m.text ? ` <code>${esc(clip(m.text, 40))}</code> ${m.op === "remove_text" ? "from" : "in"}` : ""} <code>${esc(shortPath(m.path))}</code>`;
function explainCard() {
  const e = S.explain; if (!e) return "";
  let h = `<h3>why · ${mutLabel(e.mutation)}</h3><div class="card"><div class="big ${e.survived ? "warn" : "ok"}">${e.survived ? "SURVIVED: no eval noticed" : "KILLED: an eval noticed"}</div>`;
  h += e.why.map((w) => `<div class="mut" style="margin:4px 0">• ${mdi(w)}</div>`).join("");
  if (!e.survived) h += e.killed.map((k) => `<div class="bad">✘ ${esc(k.eval)}: ${k.failed.map(esc).join("; ")}</div>`).join("");
  if (e.fix) {
    h += `<h3>how to fix</h3><div class="mut">${esc(e.fix.note)}</div>`;
    if (e.fix.yaml) h += `<pre>${esc(e.fix.yaml)}</pre><button class="btn" data-act="applyfix">Fix this blind spot: add the eval</button>`;
  }
  return h + "</div>";
}
// ---------------- lessons: predict, then run the real code, then compare
const prog = () => store.json("lab.progress") || {};
const saveProg = (fn) => { const p = prog(); fn(p); store.set("lab.progress", JSON.stringify(p)); };
const mdi = (t) => esc(t).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>").replace(/`([^`]+)`/g, "<code>$1</code>");
const ctx = () => ({ S, call });
const lessons = () => LESSONS.filter((l) => !l.needs || l.needs(S));   // a lesson built on recorded runs is offered only when they loaded
// leaving a lesson or challenge discards what it set up (bad evals, broken files, presets) so free exploring starts clean
async function leaveGuided() { if (S.lesson || S.chal) { S.lesson = null; S.chal = null; S.corpus = null; await resetAll(); } }
async function resetAll() {
  S.files = structuredClone(bundle.brain); S.questions = bundle.questions; S.sel = null; S.whatif = null; S.preview = null; S.ov = {}; S.mut = null; S.explain = null;
  S.replay = null; S.edits = {}; S.tab = {}; S.lastQ = null; S.lastMut = null; S.ab = null; S.mop = null; S.replayTok++; await refresh(); await initGate(true); initSkill(); initGuard();
  S.tl = null;
}
const findRun = (skill, variant, family) => Object.entries(S.runs?.meta.files || {}).find(([, m]) => m.skill === skill && (m.variant || null) === (variant || null) && m.model.includes(family))?.[0];
const LA = {   // actions a lesson step may name
  qreset: async () => { S.questions = bundle.questions; await refresh(); },
  sel: (id) => { S.sel = id; },
  replay: (id) => { S.sel = "eval:" + id; replay(id); },
  bad: (n) => ACT["bad" + n](),
  addq: (y) => addQ(y),
  search: async (q) => { $("qin").value = q; await ACT.search(); },
  tweak: (i) => ACT.edtweak({ dataset: { i } }),
  break: async (m) => { S.sel = m.path; S.mop = m.op; await drawer(); if ($("mtext")) $("mtext").value = m.text || ""; if ($("mwith")) $("mwith").value = m.with || ""; await ACT.break(); },
  auto: () => ACT.auto(),
  preset: (k) => applyPreset(k),
  param: async (k, v) => { S.gate.params[k] = v; await computeGate(); renderScene(); },
  gupstream: async (rules = {}, allowRoot = true) => { const G = S.guard; G.meta ??= await call("guard_meta", {}); G.code ??= G.meta.default_code; const d = structuredClone(G.meta.upstream.default); G.up = { ...d, rules: { ...d.rules, ...rules }, allow_paths: allowRoot ? d.allow_paths : [] }; G.engine = "upstream"; G.sel = null; G.try = null; await computeGuard(); renderScene(); },
  gtab: async (t) => { S.guard.tab = t; await computeGuardTab(); renderScene(); },
  gscrub: async (opts, user = "sam") => { const O = S.guard.out; O.meta ??= await call("scrub_meta", { user }); O.opts = opts === "real" ? [...O.meta.base] : [...opts]; O.user = user; O.try = null; O.sel = null; O.selOut = null; await computeScrub(); renderScene(); },
  gpolicy: async (rules) => { const G = S.guard; G.engine = "lab"; G.rules = [...rules]; G.useCode = false; G.sel = null; G.try = null; await computeGuard(); renderScene(); },
  grun: async (skill, variant, family) => { await setRun(findRun(skill, variant, family)); renderScene(); },
  gpeek: (p, a, i) => { S.gate.peek = { p, a, i }; },
  tans: async (family, arm) => { const f = featured(S, family); await setAnswer(f.run, f[arm]); renderScene(); },
  tcase: async (id, arm) => { const p = casePair(S, id); await setAnswer(p.run, p[arm]); renderScene(); },
  glogsample: async () => { await loadLive("an example log (made up)", bundle.guardlog); },
  skill: async (kind) => {
    if (kind === "filler") await ACT.sfill();
    else if (kind === "stuffed") { const ps = bundle.probes.filter((p) => p.skill === S.skill.name); S.skill.text = "---\nname: stuffed\ndescription: Use when stuffing keywords.\n---\n" + ps.flatMap((p) => p.expect.map((g) => g[0])).join(" ") + "\n"; await drawer(); }
    await ACT.sgo();
  },
};
const runActs = async (acts = []) => { for (const [a, ...args] of acts) { if (!LA[a]) throw new Error("unknown lesson action " + a); await LA[a](...args); } };
const lstep = () => { const L = LESSONS.find((l) => l.id === S.lesson.id); return [L, L.steps[S.lesson.i]]; };
async function startLesson(id, at = 0) {
  const Lz = LESSONS.find((l) => l.id === id), c = caseOfLesson(id);
  S.corpus = Lz.corpus ?? null;   // the guard lessons of the short cases replay only that case's calls
  if (c && c !== S.case) { S.case = c; store.set("lab.case", c); }
  await resetAll(); S.chal = null; S.lesson = { id, i: Math.min(at, Lz.steps.length - 1), right: 0, total: 0, answered: {} };
  await enterStep();
}
async function enterStep() {
  S.fold = {};   // each step starts with its own defaults (step.open lists the folds a step needs)
  const [, st] = lstep(), ans = S.lesson.answered[S.lesson.i];
  pt("step", { lesson: S.lesson.id, i: S.lesson.i, case: S.case });
  store.set("lab.resume", JSON.stringify({ id: S.lesson.id, i: S.lesson.i }));
  S.gate.peek = null;
  await setMode(st.mode, true); await runActs(st.setup);
  if (ans) { await runActs(st.predict.run); await explainStep(); }
  await drawer(); $("drawer").scrollTop = 0;
}
// The explanation of the current, answered step: which claims still hold, the why, and what made a wrong pick tempting.
async function explainStep() {
  const [, st] = lstep(), ans = S.lesson.answered[S.lesson.i], pr = st.predict; if (!ans || !pr) return;
  ans.bad = await checkClaims(pr, ctx());
  try { ans.why = await pr.why(ctx()); } catch (e) { ans.why = ""; ans.bad.push("the explanation could not be built: " + e.message); }
  const m = ans.picked !== ans.correct && (!pr.expects || pr.expects === ans.correct) ? pr.miss?.[ans.picked] : null;
  ans.miss = typeof m === "function" ? m(ctx(), ans.correct) : m || "";
}
async function lessonPick(i) {
  const [, st] = lstep(), L = S.lesson; if (L.answered[L.i] || !st.predict) return;
  const choice = st.predict.choices[i];
  let correct;
  try { await runActs(st.predict.run); correct = await st.predict.answer(ctx()); }
  catch (e) { if (!lab.failed) throw e; L.error = e.message; await drawer(); return; }   // Python is gone and this step was not recorded: say so on the card, not in a toast that fades
  L.error = null;
  if (!st.predict.choices.includes(correct)) throw new Error(`lesson bug: answer ${JSON.stringify(correct)} is not one of the choices`);
  L.answered[L.i] = { picked: choice, correct, src: lab.ready ? "live" : "recorded" }; L.total++; if (choice === correct) L.right++;
  pt("answer", { lesson: L.id, i: L.i, right: choice === correct });
  await explainStep();
  toast(choice === correct ? "you called it" : "not quite: the reason is below", choice === correct ? "pass" : "warn");
  await drawer();
}
async function lessonNav(d) {
  const [Lz] = lstep(), L = S.lesson;
  if (L.finished) { L.finished = false; await enterStep(); return; }   // Back from the doors: the last step again
  const next = L.i + d;
  if (next < 0) return;
  if (next >= Lz.steps.length) {
    const n = L.total; saveProg((p) => (p[L.id] = { done: true, right: L.right, total: n })); store.del("lab.resume");
    pt("finish", { lesson: L.id, right: L.right, total: L.total }); L.finished = true; await drawer(); $("drawer").scrollTop = 0; return;   // the doors card: where next?
  }
  L.i = next; await enterStep();
}
const NOISE_SAMPLES = [1, 3, 5, 10, 20];
const noiseRows = async (n) => { const c = ctx(), out = []; for (const [name, rw, rs, kind] of [["No effect (50% → 50%)", 0.5, 0.5, "false ADOPT"], ["Real effect (50% → 80%)", 0.5, 0.8, "true ADOPT"]]) out.push({ name, kind, r: await noise(c, rw, rs, n) }); return out; };
function noiseWidget(L) {
  const n = L.samples ?? 3;
  const rows = (L.noise || []).map(({ name, kind, r }) =>
    `<tr><td>${esc(name)}</td><td>${Object.entries(r.verdicts).map(([v, k]) => `${esc(v)} ${k}`).join(" · ")}</td><td data-noise="${esc(kind)}"><b>${Math.round(r.adopt_rate * 100)}%</b> <span class="mut">${kind}</span></td></tr>`).join("");
  return `<div class="row"><span class="mut">samples per question</span>${NOISE_SAMPLES.map((k) => `<button class="btn alt ${k === n ? "on" : ""}" data-act="lsamples" data-n="${k}">${k}</button>`).join("")}</div>
    <table><tr><th>skill</th><th>verdicts over 200 re-runs</th><th>ADOPT</th></tr>${rows}</table>`;
}
// The reason, short: the first sentence is what you read; the rest is one click away.
function splitWhy(t) {
  const re = /[.!?](?=\s+[A-Z`“(])/g; let m;
  while ((m = re.exec(t))) { const head = t.slice(0, m.index + 1); if (head.length >= 60 && (head.match(/`/g) || []).length % 2 === 0) { const rest = t.slice(m.index + 1).trim(); return rest.length >= 80 ? [head, rest] : [t, ""]; } }
  return [t, ""];
}
// End of a lesson: the next beat of this adventure, a deeper lesson, and the next unplayed beat of the other adventures (three doors at most).
function doorsCard() {
  const L = S.lesson, Lz = LESSONS.find((l) => l.id === L.id), me = pillarOf(L.id), q = prog()[L.id], inDeeper = me.deeper.includes(L.id);
  const go = (l, head, sub) => `<button class="btn alt" data-act="lstart" data-id="${l.id}"><b>${esc(head)}</b><span class="mut">${esc(sub)}</span></button>`;
  const beat = inDeeper ? nextIn(me) : nextIn(me, L.id), dp = nextDeeper(me), doors = [];
  if (beat) doors.push(go(beat, `${inDeeper ? "Back to" : "Next in"} ${me.name.toLowerCase()}: ${beat.title}`, beat.blurb));
  if (dp) doors.push(go(dp, `Go deeper: ${dp.title}`, dp.blurb));
  const at = PILLARS.indexOf(me);
  for (const p of [...PILLARS.slice(at + 1), ...PILLARS.slice(0, at)].filter((x) => nextIn(x))) if (doors.length < 3) doors.push(go(nextIn(p), p.door, `${p.name}: ${nextIn(p).title}`));
  const closed = !PILLARS.some((p) => nextIn(p)), other = CASES.find((c) => c.id !== S.case && PILLARS.some((p) => (p.beats[c.id] || []).some((id) => !prog()[id]?.done && lessons().some((l) => l.id === id))));
  let h = `<div class="lesson doors-end"><div class="lh"><b>${esc(Lz.title)}: done</b><span class="mut">${q?.total ? `${q.right}/${q.total} predicted` : ""}</span></div><div class="lq"><b>${closed ? "Case closed. Where next?" : !beat && !inDeeper ? `${esc(me.name)} done. Where next?` : "Where next?"}</b></div><div class="choices">${doors.join("")}`;
  if (closed && other) h += `<button class="btn alt" data-act="case" data-id="${other.id}"><b>Open another case</b><span class="mut">${esc(other.title)}</span></button>`;
  return h + `</div><div class="row lnav"><button class="btn alt" data-act="lback">← Back</button><button class="btn" data-act="lexit">Case file</button></div></div>`;
}
function lessonCard() {
  if (!S.lesson) return "";
  if (S.lesson.finished) return doorsCard();
  const [Lz, st] = lstep(), L = S.lesson, beg = S.level === "beginner", n = Lz.steps.length, pr = st.predict, ans = L.answered[L.i], picked = !!ans;
  const label = (c) => (pr.show ? pr.show(c, beg) : c);
  let h = `<div class="lesson"><div class="lh"><b>${esc(Lz.title)}</b><span class="dots" title="step ${L.i + 1} of ${n}">${Array.from({ length: n }, (_, i) => `<i class="${i < L.i ? "d" : i === L.i ? "c" : ""}"></i>`).join("")}</span><button class="chip" data-act="lexit">exit</button></div>`;
  if (L.i === 0 && Lz.before && !L.answered[0]) h += `<div class="row"><span class="mut">${esc(Lz.before[1])}</span><button class="btn sm alt" data-act="lstart" data-id="${Lz.before[0]}">Basics first</button></div>`;
  if (st.text) { const t = `<div class="lt">${mdi(!beg && st.exp ? st.exp : st.text)}</div>`; h += picked ? fold("setup", "The setup", t, false) : t; }   // once answered, the setup is one click away, not in the way
  if (!beg && st.deeper) h += `<div class="mut">${mdi(st.deeper)}</div>`;
  if (pr) {
    h += `<div class="lq"><b>Guess first.</b> ${mdi(typeof pr.q === "function" ? pr.q(ctx()) : pr.q)}</div>`;
    if (L.error && !picked) h += `<div class="note bad">${esc(L.error)}</div>`;
    if (beg && st.hint && !picked) h += `<div class="mut">Hint: ${mdi(st.hint)}</div>`;
    h += `<div class="choices">${pr.choices.map((c, i) => `<button class="btn alt ${picked && c === ans.correct ? "right" : picked && c === ans.picked ? "wrong" : ""}" data-act="lpick" data-i="${i}" data-c="${esc(c)}" ${picked ? "disabled" : ""}>${esc(label(c))}</button>`).join("")}</div>`;
    if (picked) {
      const ok = ans.picked === ans.correct, bad = ans.bad || []; if (bad.length) console.warn("lesson explanation out of date:", Lz.id, bad);
      h += `<div class="big ${ok ? "ok" : "warn"}">${ok ? "Correct" : "Not quite"}</div>`;
      if (!ok && !bad.length) h += `<div class="lt miss">${mdi(ans.miss || `You picked “${label(ans.picked)}”.`)}</div>`;
      const [head, rest] = bad.length ? ["", ""] : splitWhy(ans.why);
      h += `<div class="lt">${ok ? "" : `The real code says <b>${esc(label(ans.correct))}</b>. `}` +
        (bad.length ? `<span class="warn">⚠ The explanation no longer matches what the code did (${esc(bad.join("; "))}). The answer is still computed from the real run.</span>` : mdi(head)) + `</div>` +
        (rest ? fold("why", "The longer answer", `<div class="lt">${mdi(rest)}</div>`, false) : "");
      h += `<div class="src ${ans.src}">${ans.src === "recorded" ? "recorded from the real code" : "computed just now by the real code in your browser"}</div>`;
    }
  }
  if (picked && MODE_CODE[S.mode] && !foldOpen("code", false)) h += `<div class="row"><button class="btn alt" data-act="showcode">Show the Python that ran</button></div>`;
  if (st.widget === "noise") h += noiseWidget(L);
  const last = L.i === n - 1, can = !pr || picked;
  if (last && can && Lz.learned) h += `<div class="learned"><b>The short version.</b> ${mdi(Lz.learned)}</div>`;
  h += `<div class="row lnav"><button class="btn alt" data-act="lback" ${L.i ? "" : "disabled"}>← Back</button><button class="btn" data-act="lnext" ${can ? "" : "disabled"}>${last ? "Finish" : "Next →"}</button></div></div>`;
  return h;
}
// ---------------- challenges: do something, press Check, the real code judges
const md = (t) => t.split("```").map((seg, i) => (i % 2 ? `<pre>${esc(seg.replace(/^\n/, ""))}</pre>` : mdi(seg))).join("");
const chalDef = () => CHALLENGES.find((c) => c.id === S.chal.id);
async function startChal(id) {
  const c = CHALLENGES.find((x) => x.id === id); await resetAll(); S.lesson = null;
  S.chal = { id, hints: 0, result: null, solved: false, src: null };
  if (c.code) { const f = extractFunc(bundle.py["vendor/" + c.code.file], c.code.fn); S.chal.src = f.rows.map((r) => r.text).join("\n"); }
  await setMode(c.mode, true); await runActs(c.setup); await drawer(); $("drawer").scrollTop = 0;
}
async function chalCheck() {
  const c = chalDef(), C = S.chal; let crit;
  if (c.code) {
    const r = await raw("check_fn", { file: c.code.file, fn: c.code.fn, src: C.src, cases: c.cases.map(({ args, expect }) => ({ args, expect })) });
    crit = r.error ? [{ label: "your source runs", ok: false, detail: r.error }] : c.cases.map((k, i) => ({ label: k.name, ok: r.results[i].ok, detail: r.results[i].ok ? "" : r.results[i].error || "got " + JSON.stringify(r.results[i].got) }));
  } else {
    let qs = S.questions;
    if ($("qs")) { qs = $("qs").value; try { S.questions = qs; await refresh(); renderGraph(); } catch (e) { crit = [{ label: "questions.yaml parses", ok: false, detail: e.message }]; } }
    crit ||= await c.check({ S, call, qs, gpa: $("gpa")?.value, base: bundle.questions });
  }
  C.result = crit; C.solved = crit.every((x) => x.ok);
  if (C.solved) saveProg((p) => (p["chal:" + c.id] = { done: true }));
  toast(C.solved ? "solved" : `${crit.filter((x) => x.ok).length}/${crit.length} checks pass`, C.solved ? "pass" : "warn"); await drawer();
}
function chalCard() {
  if (!S.chal) return "";
  const c = chalDef(), C = S.chal;
  let h = `<div class="lesson"><div class="lh"><b>Challenge · ${esc(c.title)}</b><button class="chip" data-act="cexit">exit</button></div><div class="lt">${md(c.goal)}</div>`;
  if (c.code) h += `<textarea id="chsrc" spellcheck="false" style="min-height:${Math.min(300, 40 + C.src.split("\n").length * 15)}px;white-space:pre;overflow:auto;font-size:10.5px">${esc(C.src)}</textarea>`;
  if (c.cases && !C.result) h += `<div class="mut">Tests:</div>` + c.cases.map((k) => `<div class="chk in">○ ${esc(k.name)}</div>`).join("");
  if (C.result) h += C.result.map((x) => `<div class="chk in ${x.ok ? "ok" : "bad"}">${x.ok ? "✔" : "✘"} ${mdi(x.label)}${x.detail ? ` <span class="mut">${esc(x.detail)}</span>` : ""}</div>`).join("") + (C.solved ? `<div class="big ok">Solved</div>` : "");
  if (C.hints) h += c.hints.slice(0, C.hints).map((t, i) => `<div class="note"><b>Hint ${i + 1}.</b> ${md(t)}</div>`).join("");
  h += `<div class="row"><button class="btn" data-act="ccheck">Check</button>${C.hints < c.hints.length ? `<button class="btn alt" data-act="chint">Hint (${C.hints}/${c.hints.length})</button>` : ""}</div></div>`;
  return h;
}
// ---------------- Start screen: three doors (one per pillar) and a case file of every lesson. Its first screenful is also the static shell in index.html.
// The beats of the current case are the main path of each adventure; `deeper` lessons are optional depth, offered as a door and on the case file.
const lessonsById = (ids) => ids.map((id) => lessons().find((l) => l.id === id)).filter(Boolean);
const pillarLessons = (p) => lessonsById(p.beats[S.case] ?? []);
const deeperOf = (p) => lessonsById(p.deeper);
const pillarOf = (id) => PILLARS.find((p) => p.deeper.includes(id) || Object.values(p.beats).some((b) => b.includes(id)));
const caseOfLesson = (id) => CASES.find((c) => PILLARS.some((p) => p.beats[c.id]?.includes(id)))?.id;
const firstUndone = (ls, after) => { const pr = prog(), at = after ? ls.findIndex((l) => l.id === after) : -1; return [...ls.slice(at + 1), ...ls.slice(0, at + 1)].find((l) => !pr[l.id]?.done); };
const nextIn = (p, after) => firstUndone(pillarLessons(p), after);
const nextDeeper = (p) => firstUndone(deeperOf(p));
function homeHtml() {
  const pr = prog(), res = store.json("lab.resume"), cs = CASES.find((c) => c.id === S.case);
  const door = (p) => { const ls = pillarLessons(p), n = ls.filter((l) => pr[l.id]?.done).length, up = nextIn(p), mid = !!up && res?.id === up.id && res.i > 0;
    return `<button class="door ${up ? "" : "done"}" data-act="door" data-p="${p.id}"><span class="dq">${esc(p.door)}</span><span class="dn">${esc(p.name)}</span><span class="mut">${esc(p.blurb)}</span><span class="dp">${up ? (n || mid ? "Continue" : "Start") : "Done, play again"} · ${n}/${ls.length} ${ls.length === 1 ? "lesson" : "lessons"}</span></button>`; };
  const sq = (l, i, deeper, up) => { const q = pr[l.id]; return `<button class="${q?.done ? "d" : ""} ${up ? "n" : ""} ${deeper ? "x" : ""}" data-act="lstart" data-id="${l.id}" title="${esc(l.title)}${deeper ? " (deeper)" : ""}${q?.done && q.total ? ` · ${q.right}/${q.total} predicted` : ""}" aria-label="${esc(l.title)}${deeper ? ", deeper" : ""}${q?.done ? ", done" : ""}">${q?.done ? "✔" : deeper ? "+" : i + 1}</button>`; };
  const board = (p) => `<div class="cf"><b>${esc(p.name)}</b><div class="sq">${pillarLessons(p).map((l, i) => sq(l, i, false, nextIn(p)?.id === l.id)).join("")}${deeperOf(p).map((l, i) => sq(l, i, true, false)).join("")}</div></div>`;
  const beg = S.level === "beginner";
  // What needs you, in order: the lesson you left half done, then adventures in progress, then ones not started, then finished ones.
  const rank = (p) => (!nextIn(p) ? 2 : pillarLessons(p).some((l) => pr[l.id]?.done) ? 0 : 1);
  const rl = res && lessons().find((l) => l.id === res.id && !pr[l.id]?.done), ns = notes();
  const resume = rl ? `<div class="resume"><span class="mut">Pick up where you left off</span><b>${esc(rl.title)}</b><span class="mut">step ${res.i + 1} of ${rl.steps.length}</span><button class="btn" data-act="lstart" data-id="${rl.id}">Continue</button></div>` : "";
  const notesHtml = ns.length ? `<details class="fold" ${foldOpen("notes", false) ? "open" : ""}><summary data-fold="notes" data-def="0"><span>Your notes · ${ns.length}</span></summary>${ns.map((n) => `<div class="lrow"><div class="t"><b>${esc(n.text)}</b><span class="mut">${esc(n.label)}</span></div><button class="btn alt sm" data-act="notedel" data-key="${esc(n.key)}">Remove</button></div>`).join("")}<div class="row"><button class="btn alt" data-act="notesdl">Download as markdown</button><button class="btn alt" data-act="notesclear">Clear all</button></div></details>` : "";
  let h = `<div class="hm"><h1>Your agent passes the demo. How do you know it's good?</h1>
    <p class="hl">Pick a question, guess what the real code will do, then watch it run. Guessing wrong is fine: it's the useful bit. No model is called and nothing leaves the page.</p>
    ${resume}
    <div class="case"><span class="mut">Case</span> <b>${esc(cs.title)}</b> <span class="mut">${esc(cs.line)}</span>${CASES.filter((c) => c !== cs).map((c) => `<button class="chip" data-act="case" data-id="${c.id}" title="${esc(c.line)}">${esc(c.title)}</button>`).join("")}</div>
    <div class="doors">${[...PILLARS].sort((a, b) => rank(a) - rank(b)).map(door).join("")}</div><div class="mut" id="homepy">${homePy()}</div>
    <h2>Case file</h2><div class="cfs">${PILLARS.map(board).join("")}</div>${notesHtml}
    <div class="who"><span class="mut">Starting from</span><button data-act="lvl" data-l="beginner" class="chip ${beg ? "on" : ""}" title="Plain words, a hint on each question and notes beside the code.">new to evals or Python</button><button data-act="lvl" data-l="experienced" class="chip ${beg ? "" : "on"}" title="Terse: upstream names, line counts and a full editor.">I write Python</button></div>`;
  if (PT) h += `<div class="mut">Playtest log, kept on this device and never sent: ${(store.json("lab.ptlog") || []).length} events <button class="chip" data-act="ptdl">Download</button> <button class="chip" data-act="ptclear">Clear</button></div>`;
  h += `<details class="fold" ${foldOpen("tools", false) ? "open" : ""}><summary data-fold="tools" data-def="0"><span>Or just poke at the tools · ${CHALLENGES.length} challenges <span class="mut">${CHALLENGES.filter((c) => pr["chal:" + c.id]?.done).length}/${CHALLENGES.length} solved</span></span></summary>` +
    CHALLENGES.map((c) => `<div class="lrow"><span class="ck">${pr["chal:" + c.id]?.done ? "✔" : ""}</span><div class="t"><b>${esc(c.title)}</b><span class="mut">${c.code ? "edit code" : "in " + MODES.find((m) => m[0] === c.mode)[1]}</span></div><button class="btn alt" data-act="cstart" data-id="${c.id}">${pr["chal:" + c.id]?.done ? "Again" : "Start"}</button></div>`).join("") +
    `<div class="mgrid">${MODES.filter((m) => !["start", "about"].includes(m[0])).map((m) => `<button data-act="go" data-m="${m[0]}"><b>${esc(m[1])}</b><span class="mut">${esc(m[3])}</span></button>`).join("")}</div></details></div>`;
  return h;
}
const MUT_KIND = { fix: "Blind spot.", redundant: "Duplicate, not a blind spot.", unreachable: "Blind spot that no search reaches yet." };
const DRAW = {
  explore() {
    return `<div class="row"><input id="qin" placeholder="search the brain (real ranking)…"><button class="btn" data-act="search">Search</button></div>
      <div id="hits">${S.ov.hits || ""}</div>${evalInfo()}${fileEditor()}`;
  },
  evals() {
    const s = S.summary, rp = S.replay, cur = S.sel?.startsWith("eval:") ? S.results.find((x) => "eval:" + x.id === S.sel) : null;
    let h = `<div class="big ${s.ok ? "ok" : "bad"}">${s.ok ? "PASS" : "FAIL"} · ${s.must_pass}/${s.must_total}</div>
      <div class="row"><button class="btn" data-act="runall">Run all</button><button class="btn alt" data-act="bad1">+ bad expect</button><button class="btn alt" data-act="bad2">+ wrong first_line</button><button class="btn alt" data-act="bad3">+ forbid that hits</button><button class="btn alt" data-act="qreset">Reset</button></div>`;
    if (cur) {
      h += `<h3>replay · ${esc(cur.id)}</h3><div>${esc(cur.q)}</div><div class="mut">1 · lookup <code>search "${esc(cur.query)}"</code> → files light up in rank order</div><div class="mut">2 · each criterion is checked:</div>`;
      h += cur.checks.map((c, i) => `<div class="chk ${rp && rp.id === cur.id && i < rp.shown ? "in" : ""} ${c.ok ? "ok" : "bad"}">${c.ok ? "✔" : "✘"} ${c.kind} <code>${esc(c.value)}</code>${c.kind === "first_line" && !c.ok ? ` <span class="mut">top line: ${esc(c.got)}</span>` : ""}</div>`).join("");
      if (rp && rp.done) h += `<div class="big ${cur.pass ? "ok" : "bad"}">${cur.pass ? "PASS" : "FAIL"}</div><div class="mut">what the search printed (all the check can see):</div><pre>${esc(cur.output || "(no output)")}</pre>`;
    } else h += `<div class="mut" style="margin-top:10px">Click an eval to replay it.</div>`;
    return h + `<h3>questions.yaml</h3><textarea id="qs" style="min-height:200px">${esc(S.questions)}</textarea><div class="row"><button class="btn alt" data-act="applyqs">Apply YAML</button></div>`;
  },
  break() {
    const f = S.sel && S.files[S.sel] != null ? S.sel : null, op = S.mop || "delete_file", M = S.mut;
    let h = `<div class="note">A <b>mutation</b> is a deliberate wrong edit. If no eval fails, the evals have a blind spot.</div>
      <div class="row"><button class="btn" data-act="auto">Auto-mutate everything</button></div>
      <div class="mut">Breaks every fact in turn (delete the file, remove each text an eval expects) and re-runs the evals each time.</div>
      <div class="ring"><div id="mring" style="width:${M ? (M.i / M.total) * 100 : 0}%"></div></div>`;
    if (M) {
      const left = M.total - M.killed;
      h += M.done ? `<div class="big ${M.score >= 0.8 ? "ok" : "warn"}">Mutation score ${M.killed}/${M.total} (${Math.round(M.score * 100)}%)</div>
        <div class="lt">${M.killed} of ${M.total} deliberate breaks made at least one eval fail. ${left ? `The other ${left} are below: each is a <b>blind spot</b> (add an eval) or a <b>duplicate</b>.` : "Nothing slipped past."}</div>`
        : `<div class="big">${M.i}/${M.total}…</div>`;
      const mrow = (r, i) => { const k = r.killed_by.length, e = r.explain;
        return `<div class="mrow rowx ${k ? "killed" : "survived"}" data-act="exp" data-i="${i}"><div class="mh"><b class="${k ? "ok" : "bad"}">${k ? "noticed" : "SURVIVED"}</b><span>${mutLabel(r.mutation)}</span></div>` +
          (k ? `<div class="mut">noticed by ${esc(r.killed_by.join(", "))}</div>`
             : e ? `<div class="why"><b>${MUT_KIND[e.fix?.kind] || "Blind spot."}</b> ${mdi(splitWhy(e.why[0] || "")[0])}</div>${e.fix?.yaml ? `<button class="btn sm" data-act="fixrow" data-i="${i}">Fix this blind spot</button>` : ""}` : "") + `</div>`; };
      // What needs your attention first: the breaks nothing noticed. The ones an eval did notice are one click away.
      const live = M.rows.map((r, i) => [r, i]), lost = live.filter(([r]) => !r.killed_by.length), caught = live.filter(([r]) => r.killed_by.length);
      h += `<div class="mrows">${lost.map(([r, i]) => mrow(r, i)).join("")}</div>` + (caught.length ? fold("noticed", `Noticed by an eval (${caught.length})`, `<div class="mrows">${caught.map(([r, i]) => mrow(r, i)).join("")}</div>`, false) : "")
        + `<div class="mut">Click a row for the full explanation.</div>`;
    }
    if (S.whatif?.res && !S.explain) { const r = S.whatif.res; h += `<div class="card"><div class="big ${r.survived ? "warn" : "ok"}">${r.survived ? "SURVIVED: nothing noticed" : "KILLED by " + esc(r.killed_by.join(", "))}</div></div>`; }
    h += explainCard();
    h += `<h3>or break one file yourself</h3>` + (f ? `<div class="mut">target: <code>${esc(f)}</code></div>
      <label class="fld">What to do<select id="mop"><option value="delete_file" ${op === "delete_file" ? "selected" : ""}>delete the file</option><option value="remove_text" ${op === "remove_text" ? "selected" : ""}>remove some text</option><option value="replace_text" ${op === "replace_text" ? "selected" : ""}>replace some text</option></select></label>
      ${op !== "delete_file" ? `<label class="fld">Text to ${op === "remove_text" ? "remove" : "replace"}<input id="mtext" placeholder="exact text from the file"></label>` : ""}
      ${op === "replace_text" ? `<label class="fld">Replace it with<input id="mwith" placeholder="new text"></label>` : ""}
      <div class="row"><button class="btn danger" data-act="break">Break it</button><button class="btn alt" data-act="restore">Restore</button></div>`
      : `<div class="mut">Click a file on the canvas to choose what to break.</div>`);
    return h;
  },
  abfact() {
    const pv = S.preview;
    let h = `<div class="mut">Adds the doc to a copy of the map and reruns every eval and the search rankings.</div>
      <label class="fld">Path of the new file<input id="fpath" value="${esc(S.ab?.path ?? "facts/fiscal-calendar.md")}"></label>
      <textarea id="ftext" style="min-height:150px">${esc(S.ab?.text ?? "---\ntitle: Fiscal year starts in February\ntags: [calendar, fiscal]\nverified: true\n---\nOur fiscal year starts on 1 February, so quarter boundaries differ from calendar quarters.\n")}</textarea>
      <label class="fld">A search that SHOULD find it<input id="fown" value="${esc(S.ab?.own ?? "fiscal year quarter")}"></label>
      <button class="btn" data-act="abfact">A/B this fact</button><button class="btn alt" data-act="hijack">load a hijacking fact</button><button class="btn alt" data-act="abdiscard">Discard</button>`;
    if (pv) { const a = pv.ab, col = a.verdict === "FIT" ? "ok" : "bad";
      h += `<div class="card"><div class="big ${col}">${a.verdict}</div><div class="mut">evals must ${a.before.must_pass}/${a.before.must_total} → ${a.after.must_pass}/${a.after.must_total}</div>
        ${a.broke.map((x) => `<div class="bad">✘ breaks <code>${esc(x)}</code></div>`).join("")}${a.polluted.map((x) => `<div class="warn">⚑ hijacks the top result of <code>${esc(x.id)}</code> (was ${esc(x.was_first)})</div>`).join("")}
        ${a.findable ? (a.findable.rank ? `<div class="ok">found at rank ${a.findable.rank} for "${esc(a.findable.query)}"</div>` : `<div class="bad">not in the top 3 for "${esc(a.findable.query)}"</div>`) : ""}
        ${a.verdict === "FIT" ? '<button class="btn" data-act="commit">Add to map</button>' : ""}</div>`; }
    return h;
  },
  gate: () => gateDrawer(),
  guard: () => guardDrawer(),
  abskill: () => skillDrawer(),
  trace: () => traceDrawer(),
  about() {
    const v = bundle.vendor, R = S.runs;
    const files = `<table>${Object.entries(v.files).map(([k, f]) => `<tr><td><code>${esc(k)}</code></td><td class="mut">${esc(f.repo)}</td><td class="mut">${f.sha256.slice(0, 10)}</td></tr>`).join("")}</table>
<p class="mut">upstream: ${Object.entries(v.upstream_commits).map(([k, c]) => `${k} <code>${esc(c.slice(0, 10))}</code>`).join(", ")}</p>`;
    const runs = `${R ? `<p>Real answers from real models, recorded on ${esc([...new Set(Object.values(R.meta.files).map((f) => f.date))].sort().join(" and "))} (each file carries its own date) by <code>${esc(R.meta.runner)}</code> (the vendored upstream A/B script) through ${esc(R.meta.harness)}, and committed. CI fails if a file changes or the grader would grade an answer differently.</p>
<table><tr><th>skill</th><th>model</th><th>answers</th><th>sha256</th></tr>${Object.entries(R.meta.files).map(([, m]) => `<tr><td>${esc(m.skill)}${m.variant ? ` + ${esc(m.variant)}` : ""}</td><td title="${esc(m.model)}">${esc(modelName(m.model))}</td><td>${m.answers}</td><td class="mut">${m.sha256.slice(0, 10)}</td></tr>`).join("")}</table>
<details class="fold"><summary><span>The prompt</span></summary><div class="lt">${mdi(R.meta.prompt)}</div></details>` : `<p class="mut">The recorded runs did not load.</p>`}`;
    // What is not real comes first, in the open; the tables are one click away.
    return `<p>Every number comes from <b>unmodified upstream files</b>, run in your browser by Pyodide. CI fails if they drift.</p><div class="note"><b>What is not real here.</b> No model is called on this page, ever. The Guardrails policy engine (<code>lab/guard.py</code>) is written for this lab, not upstream; only the tool calls it runs on are real. The Gate's presets and clickable cells are hand-set. The A/B skill text check is a proxy (does the text contain the answer?), not behaviour. The noise lesson uses a seeded coin, not a model. Recorded runs are 3 tries per question on two models: evidence about those runs, not a general claim about a skill.</div>` + fold("vend", `The upstream files that run here (${Object.keys(v.files).length})`, files, false) + fold("runs", "The recorded model runs", runs, false) + fold("l1", "Lesson 1 before Python loads", `<div class="note"><b>Lesson 1 before Python loads.</b> Its results are recorded from this same code at build time (<code>recorded.json</code>, checked in CI against a fresh run) and labelled “recorded from the real code”. Once Python is ready everything is computed live.</div>`, false);
  },
};

// ---------------- drawer actions
const panelClick = (e) => {
  const sm = e.target.closest("summary[data-fold]");
  if (sm) { S.fold[sm.dataset.fold] = !sm.parentElement.open; return; }   // the browser toggles the <details>; we remember the new state
  const a = e.target.closest("[data-act]"); if (a) { act(() => ACT[a.dataset.act]?.(a)); return; }
  const cell = e.target.closest("[data-gc]"); if (cell) { act(() => gateCell(cell.dataset)); return; }
  const hit = e.target.closest("[data-hit]"); if (hit) act(() => { S.sel = hit.dataset.hit; paintOverlay(); return drawer(); });
};
function bindDrawer() {
  const d = $("drawer");
  d.onclick = panelClick;
  d.oninput = (e) => { const t = e.target;
    if (t.id === "chsrc" && S.chal) { S.chal.src = t.value; return; }
    if (t.id === "edsrc") { const c = editCtx(); if (c) c.E.src = t.value; return; }
    if (t.id === "gcode") { S.guard.code = t.value; return; }
    if (t.id === "gtext") { S.guard.text = t.value; return; }
    if (t.id === "stext") { S.guard.out.text = t.value; return; }
    if (t.dataset.gp) act(() => gateParam(t)); if (t.id === "gpa") act(gateGrade); };
  d.onchange = (e) => { const t = e.target;
    if (t.id === "gpg") act(() => { S.gate.pg = +t.value; return drawer(); });
    if (t.id === "glog") act(async () => { const f = t.files[0]; if (f) await loadLive(f.name, await f.text()); });
    if (t.id === "grun") act(async () => { await setRun(t.value || null); renderScene(); await drawer(); });
    if (t.id === "tlrun") act(async () => { const f = featured(S, "", t.value); await setAnswer(t.value, f.without); renderScene(); await drawer(); });
    if (t.id === "tlans") act(async () => { await setAnswer(S.tl.run, S.runs.runs[S.tl.run].rows[+t.value]); renderScene(); await drawer(); });
    if (t.id === "mop") act(() => { S.mop = t.value; return drawer(); }); };
  d.onkeydown = (e) => { if (e.target.id === "gtext" && e.key === "Enter") { e.preventDefault(); act(() => ACT.gtry()); return; }
    if (e.target.id === "stext" && e.key === "Enter") { e.preventDefault(); act(() => ACT.stry()); return; }
    if (e.target.id === "gcode" && e.key === "Tab") { e.preventDefault(); const t = e.target, a = t.selectionStart; t.setRangeText("    ", a, t.selectionEnd, "end"); S.guard.code = t.value; return; }
    if ((e.target.id === "edsrc" || e.target.id === "chsrc") && e.key === "Tab") { e.preventDefault(); const t = e.target, a = t.selectionStart; t.setRangeText("    ", a, t.selectionEnd, "end"); t.dispatchEvent(new Event("input", { bubbles: true })); return; } if (e.key === "Enter" && e.target.id === "qin") act(ACT.search); };
}
async function addQ(y) { S.questions = S.questions.trimEnd() + "\n" + y + "\n"; await refresh(); renderGraph(); await drawer(); const bad = S.results.at(-1); S.sel = "eval:" + bad.id; paintOverlay(); flash([S.sel]); replay(bad.id); }
// auto_mutants plus, for every break that survived, the reason and a verified fix (explain_mutation)
async function mutants() {
  const r = await call("auto_mutants", { files: S.files, questions: S.questions });
  for (const row of r.mutants) if (!row.killed_by.length) row.explain = await call("explain", { files: S.files, questions: S.questions, mutation: row.mutation });
  return r;
}
const ACT = {
  async edtweak(t) { const c = editCtx(); const tw = c.tweaks[+t.dataset.i]; c.E.tweak = tw; c.E.src = applyTweak(c.orig, tw); await drawer(); /* refresh the editor first: edrun reads it */ await ACT.edrun(); },
  async edrun() {
    const c = editCtx(), ts = traceSpec(); if (!ts) return; if ($("edsrc")) c.E.src = $("edsrc").value;
    const r = await raw("run_edit", { target: ts.target, file: c.file, fn: c.fn, src: c.E.src ?? c.orig, args: ts.args });
    if (r.error && !r.base) throw new Error(r.error);   // a failing EDIT comes back as {base, error} and is shown in the cell
    c.E.out = { ...r, target: ts.target }; await drawer(); $("drawer").querySelector(".card:last-of-type")?.scrollIntoView({ block: "nearest" });
  },
  edreset() { const c = editCtx(); delete S.edits[c.key]; return drawer(); },
  lstart(t) { const r = store.json("lab.resume"); pt("open", { lesson: t.dataset.id, from: S.lesson?.finished ? "doors" : "case file" }); return startLesson(t.dataset.id, r && r.id === t.dataset.id && !prog()[r.id]?.done ? r.i : 0); },
  lpick(t) { return lessonPick(+t.dataset.i); },
  lsamples(t) { S.lesson.samples = +t.dataset.n; return drawer(); },
  lnext() { return lessonNav(1); }, lback() { return lessonNav(-1); },
  cstart(t) { return startChal(t.dataset.id); },
  ccheck() { return chalCheck(); },
  chint() { S.chal.hints++; return drawer(); },
  cexit() { return setMode("start"); },
  lexit() { return setMode("start"); },
  go(t) { return setMode(t.dataset.m); },
  async showcode() { S.fold.code = true; await drawer(); $("drawer").querySelector('summary[data-fold="code"]')?.scrollIntoView({ block: "nearest" }); },
  door(t) { const p = PILLARS.find((x) => x.id === t.dataset.p), n = nextIn(p) ?? pillarLessons(p)[0], r = store.json("lab.resume"); if (n) { pt("door", { pillar: p.id, lesson: n.id }); return startLesson(n.id, r && r.id === n.id && !prog()[n.id]?.done ? r.i : 0); } },
  case(t) { S.case = t.dataset.id; store.set("lab.case", S.case); pt("case", { case: S.case }); return S.mode === "start" && !S.lesson ? drawer() : setMode("start"); },
  ptdl() { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(store.json("lab.ptlog") || [], null, 1)], { type: "application/json" })); a.download = "agent-lab-playtest.json"; a.click(); URL.revokeObjectURL(a.href); },
  ptclear() { store.del("lab.ptlog"); return drawer(); },
  notesave() { const t = $("nnote"); if (!t) return; const text = t.value.trim(), rest = notes().filter((n) => n.key !== t.dataset.key); store.set("lab.notes", JSON.stringify(text ? [...rest, { key: t.dataset.key, label: t.dataset.label, text, t: Date.now() }] : rest)); if (text) pt("note", { key: t.dataset.key }); renderScene(); return drawer(); },
  notedel(t) { store.set("lab.notes", JSON.stringify(notes().filter((n) => n.key !== t.dataset.key))); renderScene(); return drawer(); },
  notesclear() { store.del("lab.notes"); return drawer(); },
  notesdl() { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([notesMarkdown()], { type: "text/markdown" })); a.download = "agent-lab-notes.md"; a.click(); URL.revokeObjectURL(a.href); },
  async lvl(t) { S.level = t.dataset.l; store.set("lab.level", S.level); $("level").textContent = "level: " + S.level; await relevel(); },
  ctab(t) { S.tab[S.mode] = +t.dataset.i; return drawer(); },
  async save() { S.files[S.sel] = $("fbody").value; await refresh(); renderGraph(); toast("saved to this tab", ""); await drawer(); },
  async reset() { S.files = structuredClone(bundle.brain); S.questions = bundle.questions; S.sel = null; S.whatif = null; S.preview = null; S.ov = {}; await refresh(); renderGraph(); await drawer(); },
  async search() {
    const q = $("qin").value; S.lastQ = q; const r = await call("search", { files: S.files, query: q });
    S.ov = { hits: r.length ? r.map((x) => `<div class="li" data-hit="${esc(x.path)}"><span class="pill">#${x.rank}</span><span><b>${esc(x.path)}</b>:${x.line}<br><span class="mut">${esc(clip(x.text, 110))}</span></span></div>`).join("") : '<div class="mut">no matches</div>' };
    const first = {}; for (const x of r) first[x.path] ??= x.rank; S.ov.ranks = first; paintOverlay(); await drawer(); $("qin").value = q;
  },
  async runall() { await refresh(); renderGraph(); await drawer(); toast(S.summary.ok ? "all must evals pass" : "some evals fail", S.summary.ok ? "pass" : "fail"); },
  bad1: () => addQ("- id: bad-expect\n  q: A wrong expectation\n  run: {search: order_date UTC}\n  expect: [this-string-is-not-in-the-brain]\n  tier: must"),
  bad2: () => addQ("- id: bad-first-line\n  q: Wrong top result\n  run: {search: order_date UTC}\n  expect: [UTC]\n  first_line: pii-hashed\n  tier: must"),
  bad3: () => addQ("- id: bad-forbid\n  q: Forbidden string present\n  run: {search: order_date UTC}\n  forbid: [orders.created_at]\n  tier: must"),
  async qreset() { S.questions = bundle.questions; await refresh(); renderGraph(); await drawer(); },
  async applyqs() { S.questions = $("qs").value; await refresh(); renderGraph(); await drawer(); },
  async break() {
    const m = { op: $("mop").value, path: S.sel, text: $("mtext")?.value || "", with: $("mwith")?.value || "" };
    S.lastMut = m; const r = await call("mutate", { files: S.files, questions: S.questions, mutation: m });
    S.whatif = { results: r.after, broken: S.sel, res: r }; S.explain = await call("explain", { files: S.files, questions: S.questions, mutation: m }); renderGraph(); await drawer();
    setTimeout(() => flash(r.killed_by.map((i) => "eval:" + i)), 120); toast(r.survived ? "SURVIVED: no eval noticed" : "KILLED by " + r.killed_by.length + " eval(s)", r.survived ? "warn" : "pass");
  },
  async exp(t) { const row = S.mut.rows[+t.dataset.i]; S.sel = row.mutation.path; S.explain = row.explain || await call("explain", { files: S.files, questions: S.questions, mutation: row.mutation }); paintOverlay(); await drawer(); $("drawer").querySelector(".card")?.scrollIntoView({ block: "nearest" }); },
  fixrow(t) { S.explain = S.mut.rows[+t.dataset.i].explain; return ACT.applyfix(); },
  async applyfix() {
    const q = S.explain.fix.yaml, before = S.mut?.killed; S.questions = S.questions.trimEnd() + "\n" + q + "\n"; S.explain = null; S.replayTok++; await refresh(); renderGraph();
    const r = await mutants(); S.mut = { i: r.total, total: r.total, killed: r.killed, rows: r.mutants.slice().reverse(), done: true, score: r.score };
    await drawer(); toast(`eval added · mutation score ${before != null ? before + " → " : ""}${r.killed}/${r.total}`, "pass");
  },
  restore() { S.whatif = null; S.lastMut = null; S.explain = null; renderGraph(); return drawer(); },
  async auto() {
    S.explain = null;
    const r = await mutants(); S.whatif = null; renderGraph();
    S.mut = { i: 0, total: r.total, killed: 0, rows: [], done: false, score: r.score }; const tok = ++S.replayTok; await drawer();
    (async () => {   // detached: the rest of the page stays usable while the breaks play out
      const step = r.total > 25 ? 70 : 130;
      for (const row of r.mutants) {
        if (tok !== S.replayTok) return;
        await act(() => { if (tok !== S.replayTok) return; S.mut.i++; S.mut.rows.unshift(row); if (row.killed_by.length) S.mut.killed++;
          S.sel = row.mutation.path; paintOverlay(); if (row.killed_by.length) flash(row.killed_by.map((i) => "eval:" + i)); return drawer(); });
        await sleep(step);
      }
      await act(() => { if (tok !== S.replayTok) return; S.mut.done = true; toast(`mutation score ${r.killed}/${r.total}`, r.score >= 0.8 ? "pass" : "warn"); return drawer(); });
    })();
  },
  hijack() { S.ab = { path: "facts/aaa-hijack.md", text: "---\ntitle: late rollups final\ntags: [late, rollups, final]\n---\nlate rollups final\n", own: "late rollups final" }; return drawer(); },
  async abfact() {
    S.ab = { path: $("fpath").value, text: $("ftext").value, own: $("fown").value };
    const ab = await call("ab_fact", { files: S.files, questions: S.questions, path: S.ab.path, text: S.ab.text, own_query: S.ab.own });
    const merged = { ...S.files, [S.ab.path]: S.ab.text };
    const res = (await call("run_evals", { files: merged, questions: S.questions })).results;
    S.preview = { path: S.ab.path, docs: await call("explore", { files: merged }), results: res, ab }; S.sel = null; renderGraph(); await drawer();
    setTimeout(() => flash(ab.broke.map((i) => "eval:" + i)), 150); toast(ab.verdict, ab.verdict === "FIT" ? "pass" : "fail");
  },
  abdiscard() { S.preview = null; renderGraph(); return drawer(); },
  async commit() { S.files[S.preview.path] = S.ab.text; S.preview = null; await refresh(); renderGraph(); await drawer(); toast("added to this tab's map", "pass"); },
  // gate
  preset(t) { return applyPreset(t.dataset.k); },
  async dumb() { const p = S.gate.probes[S.gate.pg]; $("gpa").value = await call("trivial_pass", { probe: p }); await gateGrade(); },
  gpeek(t) { const d = t.dataset; S.gate.peek = { p: d.p, a: d.a, i: +d.i }; return drawer(); },
  async gtab(t) { S.guard.tab = t.dataset.t; await computeGuardTab(); renderScene(); await drawer(); },
  async glive() { await loadLive("an example log (made up)", bundle.guardlog); },
  sopt(t) { const O = S.guard.out, id = t.dataset.o; O.try = null; O.opts = O.opts.includes(id) ? O.opts.filter((x) => x !== id) : [...O.opts, id]; return guardRefresh(); },
  suser(t) { const O = S.guard.out; O.user = t.dataset.u; O.try = null; return guardRefresh(); },
  spreset(t) { const O = S.guard.out; O.opts = t.dataset.p === "real" ? [...O.meta.base] : []; O.try = null; return guardRefresh(); },
  async stry() { const O = S.guard.out; if ($("stext")) O.text = $("stext").value; O.try = await call("scrub_one", { text: O.text, opts: O.opts, user: O.user }); await drawer(); },
  async gengine(t) { const G = S.guard; G.engine = t.dataset.e; G.sel = null; G.try = null; return guardRefresh(); },
  gdial(t) { const G = S.guard, r = t.dataset.r, A = G.meta.upstream.actions; G.up.rules[r] = A[(A.indexOf(G.up.rules[r]) + 1) % A.length]; return guardPolicyChanged(); },
  gallow() { const G = S.guard, root = G.meta.upstream.default.allow_paths; G.up.allow_paths = G.up.allow_paths.length ? [] : [...root]; return guardPolicyChanged(); },
  async gapply() { const G = S.guard, p = await raw("guard_yaml", { text: $("gyaml").value }); if (p.error) { G.yaml = $("gyaml").value; G.err = p.error; return drawer(); } G.up = p; return guardPolicyChanged(); },
  grule(t) { const G = S.guard, id = t.dataset.r; G.useCode = false; G.sel = null; G.try = null; G.rules = G.rules.includes(id) ? G.rules.filter((x) => x !== id) : [...G.rules, id]; return guardRefresh(); },
  async gcode() { const G = S.guard; if ($("gcode")) G.code = $("gcode").value; G.useCode = true; G.sel = null; G.try = null; return guardRefresh(); },
  guse() { S.guard.useCode = false; S.guard.try = null; return guardRefresh(); },
  async gtry() { const G = S.guard; if ($("gtext")) { G.text = $("gtext").value; G.tool = $("gtool").value; } await guardTry(); await drawer(); },
  async gattack(t) { const G = S.guard, a = G.meta.attacks[+t.dataset.i]; G.text = a.text; G.tool = a.tool; await guardTry(); await drawer(); },
  async openrun(t) { await setMode("gate"); await setRun(t.dataset.run); renderScene(); await drawer(); },
  // skill
  sfill() { S.skill.text = bundle.variants.filler; return drawer(); },
  sbad() { S.skill.text = "---\nname: Bad Name\n---\nmentions ~/.agents/brain\n"; return drawer(); },
  sgo() { S.skill.text = $("stext").value; S.skill.name = $("sk").value; S.skill.dir = $("sdir").value; S.skill.rate = +$("srate").value; return runSkill(); },
  sload() { S.skill.name = $("sk").value; S.skill.dir = S.skill.name; S.skill.text = bundle.skills[S.skill.name]; S.skill.res = null; S.skill.rec = []; renderSkill(); return drawer(); },
};
// Explanations are worded for the level, so a level change rebuilds the current one.
async function relevel() { if (S.lesson) await explainStep(); if (S.mode !== "start") renderScene(); await drawer(); }

// ---------------- gate scene: hand-set results (presets, clickable cells) or a recorded model run
const PRESETS = {
  "Skill clearly helps": (p) => p.map(() => [[0, 0, 0], [1, 1, 1]]),
  "No effect": (p) => p.map(() => [[0, 0, 0], [0, 0, 0]]),
  "Already good": (p) => p.map(() => [[1, 1, 1], [1, 1, 1]]),
  "Helps most, hurts one": (p) => p.map((x, i) => (i === 0 ? [[1, 1, 1], [0, 0, 0]] : [[0, 0, 0], [1, 1, 1]])),
};
// Beginner labels for the thresholds: what each one means, never the upstream parameter name.
const PARAM_PLAIN = {
  min_gain: "Smallest gain that counts, in correct answers", ceiling: "“Already too good” line: share correct without the skill",
  regress_by: "Drop on one question that counts as “got worse”", max_cost_ratio: "Most it may cost, as a multiple of the cost without it",
};
async function initGate(fresh) {
  const probes = bundle.probes.filter((p) => ["dst", "doubt"].includes(p.skill)).slice(0, 8);
  S.gate = { probes, params: { min_gain: 2, ceiling: 0.9, regress_by: 2, max_cost_ratio: 1.5, _cand_cost: 0.01 }, grid: {}, pg: 0, res: null, run: null, peek: null };
  const h = !fresh && HASH0.match(/g=([^&]+)/), run = !fresh && HASH0.match(/run=([^&]+)/);
  if (h) { try { const d = decodeGate(decodeURIComponent(h[1])); S.gate.params = { ...S.gate.params, ...d.params }; S.gate.grid = d.grid; } catch { /* ignore bad link */ } }
  if (!Object.keys(S.gate.grid).length) setPreset("Skill clearly helps");
  if (run && S.runs?.runs[decodeURIComponent(run[1])]) S.gate.run = decodeURIComponent(run[1]);
  await computeGate();
}
const gateRun = () => (S.gate.run ? S.runs.runs[S.gate.run] : null);
const gateProbes = () => (S.gate.run ? bundle.probes.filter((p) => p.skill === gateRun().skill) : S.gate.probes);
function presetActive(k) { const G = S.gate, v = PRESETS[k](G.probes); return !G.run && G.probes.every((p, i) => JSON.stringify(G.grid[p.id]) === JSON.stringify({ without: v[i][0].map(Boolean), with: v[i][1].map(Boolean) })); }
function setPreset(k) { const v = PRESETS[k](S.gate.probes); S.gate.grid = {}; S.gate.run = null; S.gate.peek = null; S.gate.probes.forEach((p, i) => (S.gate.grid[p.id] = { without: v[i][0].map(Boolean), with: v[i][1].map(Boolean) })); }
async function applyPreset(k) { setPreset(k); await computeGate(); renderScene(); await drawer(); }
async function setRun(name) { if (name && !S.runs?.runs[name]) throw new Error("that recorded run is not available"); S.gate.run = name || null; S.gate.peek = null; await computeGate(); }
async function computeGate() {
  const G = S.gate;
  G.res = G.run ? await call("gate_run", { res: slimRun(gateRun()), params: G.params }) : await call("gate", { probes: G.probes, grid: G.grid, params: G.params, samples: 3 });
  if (S.mode === "gate" && !S.lesson) history.replaceState(null, "", G.run ? `#m=gate&run=${encodeURIComponent(G.run)}` : `#m=gate&g=${encodeURIComponent(encodeGate(G.grid, G.params))}`);
}
async function gateCell(d) { if (S.gate.run) return; const c = S.gate.grid[d.p][d.a]; c[+d.i] = !c[+d.i]; await computeGate(); renderScene(); await drawer(); }
async function gateParam(i) {   // typing a threshold: update the verdict and the funnel in place so the field keeps focus
  const v = +i.value; if (isNaN(v) || i.value === "") return;
  S.gate.params[i.dataset.gp] = v; await computeGate(); renderScene();
  const box = $("gverdict"); if (box) box.outerHTML = verdictHtml(S.gate.res);
}
async function gateGrade() { const g = await call("grade", { probe: S.gate.probes[S.gate.pg], text: $("gpa").value }); $("gpr").innerHTML = `<span class="${g.correct ? "ok" : "bad"}">${g.correct ? "correct" : "incorrect"}</span> <span class="mut">missing ${esc(JSON.stringify(g.missing))}</span>`; }
// The verdict first, large, with one sentence of why. Beginners get plain words built from the gate's own numbers.
function verdictHtml(g, id = "gverdict") {
  const beg = S.level === "beginner", good = g.verdict === "ADOPT";
  return `<div class="verdict ${good ? "good" : "bad"}" id="${id}" data-verdict="${esc(g.verdict)}"><div class="vl">the gate says</div><div class="big">${esc(beg ? PLAIN_VERDICT[g.verdict] ?? g.verdict : g.verdict)}</div><div class="vw">${esc(beg ? plainReason(g) : g.reason)}</div></div>`;
}
const runLabel = (name) => { const m = S.runs.meta.files[name]; return `${m.skill}${m.variant ? " + " + m.variant + " skill" : ""} · ${modelName(m.model)}`; };
function peekCard() {
  const k = S.gate.peek, res = gateRun(); if (!k || !res) return "";
  const r = res.rows.find((x) => x.probe === k.p && x.arm === k.a && x.n === k.i), pr = bundle.probes.find((p) => p.id === k.p); if (!r || !pr) return "";
  return `<div class="card peek"><div class="mut">recorded answer · ${esc(k.p)} · ${k.a === "with" ? "with the skill" : "without the skill"} · try ${k.i + 1} of ${res.samples}</div>
    <div class="lq"><b>Question.</b> ${esc(pr.q)}</div><div class="mut">The check wants every one of: ${pr.expect.map((g) => g.map((x) => `“${esc(x)}”`).join(" or ")).join(" · ")}</div>
    <pre class="ans">${esc(r.answer || "(no answer)")}</pre>
    <div class="${r.correct ? "ok" : "bad"}">${r.correct ? "✔ passed the check" : `✘ failed the check: missing ${r.missing.map((m) => `“${esc(m)}”`).join(", ") || "nothing, but the run did not finish"}`}</div>
    <div class="mut">${k.a === "with" ? (r.skill_read ? "The model opened the skill file. " : "The model did not open the skill file. ") : ""}${r.tools.length} tool call${r.tools.length === 1 ? "" : "s"} · $${r.cost_usd} · ${r.finished ? "finished" : "did not finish"}</div></div>`;
}
// The observability view of a recorded run: what each answer did, not only whether it passed. Click a row to read the answer.
function traceHtml(res, beg) {
  const T = traceStats(res), d = (x) => `$${x.toFixed(3)}`, row = (r) => `<tr class="rowx" data-act="gpeek" data-p="${esc(r.probe)}" data-a="${r.arm}" data-i="${r.n}">
    <td>${esc(r.probe)} <span class="mut">${r.arm === "with" ? "with" : "without"} · try ${r.n + 1}</span></td><td class="${r.correct ? "ok" : "bad"}">${r.correct ? "✔" : "✘"}</td>
    <td>${r.arm === "with" ? (r.skill_read ? "yes" : "no") : "·"}</td><td>${r.tools.length}</td><td>${d(r.cost_usd)}</td></tr>`;
  const line = (label, s) => (s.n ? `<tr><td>${label}</td><td>${s.correct}/${s.n}</td><td></td><td>${s.tools.toFixed(1)}</td><td>${d(s.cost)}</td></tr>` : "");
  return `<div class="mut">Every answer the model gave, as it was recorded, including the ${beg ? "hidden test" : "heldout"} questions the gate counts separately: did it pass the check, did it open the skill file, how many tool calls it made, what it cost. Averages first, then each answer.</div>
    <table class="tr"><tr><th>${beg ? "group" : "group (mean)"}</th><th>passed</th><th></th><th>tool calls</th><th>cost</th></tr>
    ${line("without the skill", T.without)}${line("with it, opened the skill file", T.withRead)}${line("with it, did not open it", T.withSkip)}</table>
    <table class="tr long"><tr><th>answer</th><th>passed</th><th>opened skill</th><th>tool calls</th><th>cost</th></tr>${res.rows.map(row).join("")}</table>`;
}
function gateDrawer() {
  const G = S.gate, g = G.res, p = G.probes[G.pg], beg = S.level === "beginner", res = gateRun(), meta = res && S.runs.meta.files[G.run], R = S.runs;
  const grid = res ? runGrid(res) : G.grid, split = (q) => (q.split === "heldout" ? (beg ? "hidden test" : "heldout") : beg ? "" : "dev");
  let h = verdictHtml(g);
  h += (R ? `<select id="grun"><option value="">hand-set results (click the cells)</option>${Object.keys(R.meta.files).map((n) => `<option value="${esc(n)}" ${n === G.run ? "selected" : ""}>recorded: ${esc(runLabel(n))}</option>`).join("")}</select>` : "");
  if (res) h += `<div class="card rec"><b>Recorded run.</b> Real answers from <b title="${esc(meta.model)}">${esc(modelName(meta.model))}</b> on ${esc(meta.date)}: ${meta.answers} answers, $${meta.cost_usd}. Nothing is called now.
      <details><summary>How it was recorded</summary><div class="mut">${mdi(R.meta.prompt)}</div><div class="mut">model <code>${esc(meta.model)}</code> · ${esc(R.meta.harness)} · runner <code>${esc(R.meta.runner)}</code> · file sha256 <code>${meta.sha256.slice(0, 12)}</code>${meta.variant ? ` · skill loaded: <code>${esc(res.with_path)}</code>` : ""}</div></details></div>`;
  else h += `<div class="row">${Object.keys(PRESETS).map((k) => `<button class="btn alt ${presetActive(k) ? "on" : ""}" data-act="preset" data-k="${esc(k)}">${esc(k)}</button>`).join("")}</div>`;
  h += `<h3>${res ? "recorded answers (3 tries each, click one to read it)" : "outcomes (3 tries each, click to flip)"}</h3><table class="grid"><tr><th>${beg ? "question" : "probe"}</th><th>without${beg ? " the skill" : ""}</th><th>with${beg ? " the skill" : ""}</th></tr>${gateProbes().map((q) => `<tr><td title="${esc(q.q)}">${esc(q.id)} <span class="mut" ${beg && q.split === "heldout" ? `title="Held back while a skill is tuned: it checks the skill works on questions it has not seen."` : ""}>${split(q)}</span></td>` + ["without", "with"].map((a) => `<td>${(grid[q.id]?.[a] || []).map((b, i) => { const on = res && G.peek && G.peek.p === q.id && G.peek.a === a && G.peek.i === i;
      return `<span class="cell ${b ? "t" : "f"} ${on ? "on" : ""}" ${res ? `data-act="gpeek"` : "data-gc"} data-p="${esc(q.id)}" data-a="${a}" data-i="${i}">${b ? "✔" : "✘"}</span>`; }).join("")}</td>`).join("") + "</tr>").join("")}</table>`;
  h += peekCard();
  if (res) h += fold("trace", beg ? "What happened in each answer?" : "trace: one row per recorded answer", traceHtml(res, beg), !!(S.lesson && lstep()[1].open?.includes("trace")));
  h += fold("bar", beg ? "The bar the skill must clear" : "thresholds", `<div class="params">${Object.entries(G.params).filter(([k]) => !(k.startsWith("_") && (beg || res))).map(([k, v]) => `<label class="fld">${beg ? esc(PARAM_PLAIN[k] ?? k) : `<code>${k}</code>`}<input data-gp="${k}" value="${v}" inputmode="decimal"></label>`).join("")}</div>
    ${beg ? `<div class="mut">These are set before the run. Moving them afterwards would be choosing the verdict.</div>` : ""}`, !!S.chal || (!!S.lesson && !!lstep()[1].open?.includes("poke") && false));
  if (!res) h += fold("grader", beg ? "How is one answer marked right or wrong?" : "probe grader", `<div class="row"><select id="gpg">${G.probes.map((q, i) => `<option value="${i}" ${i === G.pg ? "selected" : ""}>${esc(q.id)}</option>`).join("")}</select></div>
    <pre>${esc(p.q)}\n\nexpect (every group, any inside): ${esc(JSON.stringify(p.expect))}</pre><textarea id="gpa" style="min-height:60px" placeholder="type an answer"></textarea>
    <div class="row"><button class="btn alt" data-act="dumb">fill the dumbest passing answer</button><span id="gpr"></span></div>`, (!beg && !S.lesson) || S.chal?.id === "opposite");
  return h;
}
function renderTree(parent, x, y, w, steps, o = {}) {
  const gap = o.gap ?? 22, h = o.h ?? 62, beg = S.level === "beginner";
  steps.forEach((s, i) => {
    const yy = y + i * (h + gap);
    if (i) parent.append(el("line", { class: `link ${steps[i - 1].state !== "unreached" && s.state !== "unreached" ? "live" : ""}`, x1: x + 26, x2: x + 26, y1: yy - gap, y2: yy }));
    const good = s.verdict === "ADOPT", col = s.state === "fired" ? (good ? "var(--pass)" : "var(--fail)") : "var(--muted)";
    const g = el("g", { class: `step ${s.state} ${s.state === "fired" ? (good ? "good" : "bad") : ""}`, transform: `translate(${x} ${yy})`, "data-step": s.verdict }, [
      el("rect", { width: w, height: h, rx: 10 }),
      el("text", { class: "tag", x: 14, y: 20, style: `fill:${col}` }, `${i + 1} · ${s.name}`),
      el("text", { class: "q", x: 14, y: 38 }, clip(s.question, Math.floor(w / 7.4))),
      el("text", { class: "d", x: 14, y: 54 }, clip(s.detail, Math.floor(w / 6.2))),
      el("text", { x: w - 14, y: 20, "text-anchor": "end", class: "tag", style: `fill:${s.state === "fired" ? col : "var(--dim)"}` }, s.state === "fired" ? (good ? (beg ? "→ adopt" : "→ ADOPT") : beg ? "yes → stop here" : `→ stop: ${s.verdict}`) : s.state === "no" ? "no, continue" : ""),
    ]);
    parent.append(g);
  });
  return y + steps.length * (h + gap);
}
function renderGate() {
  const root = vp(); root.replaceChildren(); S.ref = { nodes: new Map(), edges: [] };
  const g = S.gate.res, f = g.facts || {}, beg = S.level === "beginner", run = S.gate.run;
  root.append(el("text", { class: "col", x: 30, y: 30 }, (beg ? "the gate: rules in the order they are checked" : "gate.decide, rules in the order they are checked") + (run ? ` · recorded run: ${runLabel(run)}` : " · hand-set results")));
  const inbox = el("g", { class: "step no", transform: "translate(30 50)" }, [el("rect", { width: 640, height: 54, rx: 10 }),
    el("text", { class: "q", x: 14, y: 22 }, beg ? `correct answers: ${f.dev_without ?? "?"} of ${f.dev_n ?? "?"} without the skill → ${f.dev_with ?? "?"} of ${f.dev_n ?? "?"} with it` : `dev correct: without ${f.dev_without ?? "?"}/${f.dev_n ?? "?"} → with ${f.dev_with ?? "?"}/${f.dev_n ?? "?"}`),
    el("text", { class: "d", x: 14, y: 40 }, beg ? `hidden test ${f.heldout_without ?? "?"} → ${f.heldout_with ?? "?"} · ${f.cost_ratio == null ? "costs ? times as much" : costs(f.cost_ratio)} · same inputs always give the same verdict` : `heldout ${f.heldout_without ?? "?"}→${f.heldout_with ?? "?"} · cost ×${f.cost_ratio ?? "?"} · same inputs always give the same verdict`)]);
  root.append(inbox, el("line", { class: "link live", x1: 56, x2: 56, y1: 104, y2: 126 }));
  const bottom = renderTree(root, 30, 126, 640, gateSteps(g, beg));
  root.append(el("text", { class: "col", x: 30, y: bottom + 18, style: "fill:var(--muted)" }, g.verdict === "BAD_INPUT" ? g.reason : ""));
  fit(700, bottom + 40);
}
// ---------------- skill scene
// ---------------- guardrails: a policy against the real tool calls in the recorded runs (lab/guard.py is written for this lab, not upstream)
function initGuard() {
  const calls = [];
  const inCorpus = (name) => !S.corpus || (S.runs.meta.files[name].skill === CASES.find((c) => c.id === S.corpus).skill && !S.runs.meta.files[name].variant);
  for (const [name, res] of Object.entries(S.runs?.runs || {})) if (inCorpus(name)) for (const r of res.rows) for (const [tool, args] of r.tools) {
    let a; try { a = JSON.parse(args); } catch { a = {}; }
    calls.push({ name: tool, args: a, run: name, probe: r.probe, arm: r.arm, n: r.n });
  }
  S.guard = { calls, rules: [], code: S.guard?.code ?? null, meta: S.guard?.meta ?? null, useCode: false, res: null, att: null, sel: null, err: null, text: "", tool: "bash", try: null, live: S.guard?.live ?? null,
    tab: "calls", engine: "lab", up: null, yaml: null, out: { opts: [], user: "sam", meta: null, res: null, att: null, sel: null, selOut: null, text: "", try: null, texts: scrubTexts() } };
}
// every recorded model answer and tool call, as recorded (already scrubbed): the corpus the output scrubber is tested on
function scrubTexts() {
  const out = [];
  for (const res of Object.values(S.runs?.runs || {})) for (const r of res.rows) out.push({ text: r.answer ?? "", kind: "answer" });
  for (const res of Object.values(S.runs?.runs || {})) for (const r of res.rows) for (const [, args] of r.tools) { let a = {}; try { a = JSON.parse(args); } catch { /* skip */ } out.push({ text: a.path ?? a.command ?? "", kind: "tool" }); }
  return out;
}
const guardPolicy = () => (S.guard.engine === "upstream" ? { upstream: S.guard.up } : S.guard.useCode ? { code: S.guard.code } : { rules: S.guard.rules });
// With no policy switched on, "got through" means nothing yet: the calls that tried to leave the folder are outlined, not alarming.
const guardNothing = () => S.guard.engine !== "upstream" && !S.guard.useCode && !S.guard.rules.length;
const guardText = (c) => (c.name === "read" ? c.args.path : c.args.command) ?? "";
async function computeGuard() {
  const G = S.guard; if (!G.calls.length) return;
  if (!G.meta) { G.meta = await call("guard_meta", {}); G.code ??= G.meta.default_code; G.up ??= structuredClone(G.meta.upstream.default); G.yaml ??= G.meta.upstream.yaml; }
  const r = await raw("guard_run", { calls: G.calls.map(({ name, args }) => ({ name, args })), policy: guardPolicy() });
  if (r.error) { G.err = r.error; return; }   // keep the last good result on screen
  G.err = null; G.res = r;
  const a = await raw("guard_attacks", { policy: guardPolicy() }); G.att = a.error ? null : a;
}
async function computeScrub() {
  const O = S.guard.out; if (!O.texts.length) return;
  O.meta = await call("scrub_meta", { user: O.user });
  O.res = await call("scrub_run", { texts: O.texts, opts: O.opts, user: O.user });
  O.att = await call("scrub_attacks", { opts: O.opts, user: O.user });
  if (O.sel != null) O.selOut = await call("scrub_one", { text: O.texts[O.sel].text, opts: O.opts, user: O.user, rebuild: true });
}
const computeGuardTab = () => (S.guard.tab === "output" ? computeScrub() : computeGuard());
// "Your log": a decision log written by scripts/guard_hook.py, read in the browser (never uploaded) and only counted: the lab does not judge it
async function loadLive(name, text) {
  const r = await raw("guard_live", { text });
  S.guard.live = { name, res: r.error ? null : r, err: r.error || null, sel: null };
  renderScene(); await drawer();
}
function renderLive(root) {
  const L = S.guard.live, cols = 24, step = 22;
  if (!L?.res) { root.append(el("text", { class: "col", x: 0, y: 20 }, "load a decision log, or the made-up example, to see what a policy decided")); fit(520, 40); return; }
  root.append(el("text", { class: "col", x: 0, y: 10 }, `each square is one judged tool call, oldest first${L.res.dropped ? ` (the last ${L.res.rows.length} of ${L.res.counts.total})` : ""}`));
  L.res.rows.forEach((r, i) => {
    const g = el("rect", { class: `gc ${r.action === "allow" ? "fine" : r.action} ${L.sel === i ? "sel" : ""}`, x: (i % cols) * step, y: 24 + Math.floor(i / cols) * step, width: 18, height: 18, rx: 4 }, el("title", {}, `${r.action} ${r.rule} ${r.text}`.slice(0, 120)));
    g.addEventListener("click", (e) => { e.stopPropagation(); act(() => { L.sel = i; renderScene(); return drawer(); }); });
    root.append(g);
  });
  fit(cols * step, 24 + Math.ceil(L.res.rows.length / cols) * step + 10);
}
function liveDrawer() {
  const L = S.guard.live, beg = S.level === "beginner", r = L?.res, k = r?.counts;
  let h = `<div class="mut">${beg ? "When the guard hook is on, it writes one line per tool call to a file. Pick that file to see what it decided." : "Pick <code>$BRAIN_DIR/metrics/guard.jsonl</code> (or <code>$GUARD_LOG</code>). The file is read in your browser, nothing is uploaded."}</div>
    <div class="row"><input type="file" id="glog" accept=".jsonl,.json,.txt,application/json" aria-label="a guard decision log"><button class="btn alt" data-act="glive">Try a made-up log</button></div>`;
  if (L?.err) h += `<div class="note bad">${esc(L.err)}</div>`;
  if (!k) return h + `<div class="note"><b>What this is.</b> The log comes from <code>scripts/guard_hook.py</code> in agent-knowledge-map: one JSON line per judged call (<code>ts, tool, action, rule</code>, and <code>text</code> for what was not allowed). The lab only counts it. It does not say whether a decision was right: that is what replaying recorded sessions against a policy is for.</div>`;
  const stopped = k.ask + k.deny;
  h += `<div class="verdict good" id="gscore"><div class="vl">${esc(L.name)}</div><div class="big">${stopped} of ${k.total} calls were not simply allowed</div>
    <div class="vw">${k.allow} allowed, ${k.ask} asked, ${k.deny} denied${r.first ? `, from ${esc(r.first)} to ${esc(r.last)}` : ""}.${k.bad ? ` ${k.bad} lines were not decisions and were skipped.` : ""}</div></div>`;
  const sel = L.sel != null ? r.rows[L.sel] : null;
  h += sel ? `<div class="card gcall"><div class="mut">${esc(sel.tool)} · ${esc(sel.ts)}</div><div><b>${esc(sel.action)}</b>${sel.rule ? ` by “${esc(sel.rule)}”` : ""}</div>${sel.text ? `<pre>${esc(sel.text)}</pre>` : ""}</div>` : `<div class="mut">Click a square to read that decision.</div>`;
  const rules = Object.entries(r.rules).sort((a, b) => b[1] - a[1]);
  if (rules.length) h += `<h3>which rule stopped them</h3><table class="tr">${rules.map(([id, n]) => `<tr><td>${esc(id || "(none)")}</td><td>${n}</td></tr>`).join("")}</table>`;
  if (r.top.length) h += fold("glt", beg ? "The commands asked about most" : "most frequent non-allowed", `<div class="mut">Grouped by rule, action and the first two words. A line that keeps coming back is a candidate for <code>allow_paths</code> or <code>allow_commands</code>.</div><table class="tr"><tr><th>rule</th><th>action</th><th>command</th><th>times</th></tr>${r.top.map((t) => `<tr><td>${esc(t.rule)}</td><td>${esc(t.action)}</td><td><code>${esc(t.head)}</code></td><td>${t.n}</td></tr>`).join("")}</table>`, !S.lesson);
  h += `<div class="note"><b>What this is.</b> Counts only. The guard is a set of text rules, not a sandbox, and an allowed call is not proof the call was safe. Nothing here is uploaded.</div>`;
  return h;
}
async function guardPolicyChanged() { const G = S.guard; G.yaml = (await call("guard_policy_yaml", { policy: G.up })).yaml; G.sel = null; G.try = null; return guardRefresh(); }
async function guardRefresh() { await computeGuardTab(); renderScene(); await drawer(); }
async function guardTry() {
  const G = S.guard, r = await raw("guard_attack", { policy: guardPolicy(), tool: G.tool, text: G.text });
  if (r.error) { G.err = r.error; G.try = null; } else { G.err = null; G.try = r; }
}
function renderGuard() {
  const root = vp(); root.replaceChildren(); S.ref = { nodes: new Map(), edges: [] }; S.graph = null;
  const G = S.guard, cols = 24, step = 22, nothing = guardNothing();
  if (G.tab === "output") return renderScrub(root);
  if (G.tab === "log") return renderLive(root);
  if (!G.calls.length) { root.append(el("text", { class: "col", x: 0, y: 20 }, "the recorded runs did not load")); fit(400, 40); return; }
  let y = 10;
  root.append(el("text", { class: "col", x: 0, y }, "each square is one real tool call a model made"));
  for (const tool of ["bash", "read"]) {
    const idx = G.calls.map((_, i) => i).filter((i) => G.calls[i].name === tool);
    y += 34; root.append(el("text", { class: "col", x: 0, y }, `${tool === "bash" ? "shell commands" : "files read"} · ${idx.length}`)); y += 10;
    idx.forEach((i, k) => {
      const r = G.res?.rows[i], c = r ? (r.blocked ? (r.outside ? "caught" : "fp") : r.outside ? (nothing ? "esc" : "miss") : "fine") : "fine";
      const g = el("rect", { class: `gc ${c} ${G.sel === i ? "sel" : ""} ${noteFor(callKey(G.calls[i])) ? "noted" : ""} ${guardFocus()?.i === i ? "focus" : ""}`, x: (k % cols) * step, y: y + Math.floor(k / cols) * step, width: 18, height: 18, rx: 4 }, el("title", {}, guardText(G.calls[i]).slice(0, 120)));
      g.addEventListener("click", (e) => { e.stopPropagation(); act(() => { G.sel = i; renderScene(); return drawer(); }); });
      root.append(g);
    });
    y += Math.ceil(idx.length / cols) * step;
  }
  fit(cols * step, y + 10);
}
function renderScrub(root) {
  const O = S.guard.out, cols = 24, step = 22;
  if (!O.res) { root.append(el("text", { class: "col", x: 0, y: 20 }, "loading…")); fit(300, 40); return; }
  let y = 10;
  root.append(el("text", { class: "col", x: 0, y }, "each square is one real model answer or tool call, rebuilt on a made-up machine"));
  for (const kind of ["answer", "tool"]) {
    const idx = O.texts.map((_, i) => i).filter((i) => O.texts[i].kind === kind);
    y += 34; root.append(el("text", { class: "col", x: 0, y }, `${kind === "answer" ? "model answers" : "tool calls"} · ${idx.length}`)); y += 10;
    idx.forEach((i, k) => {
      const st = O.res.rows[i].status;
      const g = el("rect", { class: `gc ${st === "leak" ? (O.opts.length ? "miss" : "esc") : st === "fixed" ? "caught" : st === "damaged" ? "fp" : "fine"} ${O.sel === i ? "sel" : ""}`, x: (k % cols) * step, y: y + Math.floor(k / cols) * step, width: 18, height: 18, rx: 4 }, el("title", {}, O.texts[i].text.slice(0, 100)));
      g.addEventListener("click", (e) => { e.stopPropagation(); act(async () => { O.sel = i; O.selOut = await call("scrub_one", { text: O.texts[i].text, opts: O.opts, user: O.user, rebuild: true }); renderScene(); return drawer(); }); });
      root.append(g);
    });
    y += Math.ceil(idx.length / cols) * step;
  }
  fit(cols * step, y + 10);
}
function scrubDrawer() {
  const O = S.guard.out, beg = S.level === "beginner", k = O.res?.counts, M = O.meta;
  if (!k || !M) return `<div class="mut">Loading Python…</div>`;
  const m = M.machine, on = (id) => O.opts.includes(id), nothing = !O.opts.length;
  // The score first. With no scrubber at all it is an invitation, not a failure.
  let h = nothing ? `<div class="verdict" id="gscore"><div class="vl">${k.total} real texts, ${k.dirty} of them carry the machine's details</div><div class="big">Nothing is scrubbed yet</div><div class="vw">Press “What record_runs.py does” and watch the squares.</div></div>`
    : `<div class="verdict ${k.leaks === 0 && k.damaged === 0 ? "good" : "bad"}" id="gscore"><div class="vl">your scrubber, on ${k.total} real texts</div><div class="big">${k.leaks} still leak</div>
    <div class="vw">${k.dirty} of the ${k.total} carried the machine's details before scrubbing. ${k.fixed} were cleaned${k.damaged ? `; ${k.damaged} had a word replaced that was not part of any path` : ""}.</div></div>`;
  h += `<div class="row"><button class="btn alt" data-act="spreset" data-p="real">What record_runs.py does</button><button class="btn alt" data-act="spreset" data-p="none">Nothing</button></div>`;
  const sel = O.sel != null ? O.texts[O.sel] : null;
  if (sel && O.selOut) h += `<div class="card gcall"><div class="mut">${sel.kind === "answer" ? "a model answer" : "a tool call"}, ${O.res.rows[O.sel].status}</div><div class="mut">before</div><pre>${esc(O.selOut.raw.slice(0, 400))}</pre><div class="mut">after your scrubber</div><pre>${esc(O.selOut.out.slice(0, 400))}</pre>
    <div class="${O.selOut.leaks.length ? "bad" : "ok"}">${O.selOut.leaks.length ? "✘ still shows: " + esc(O.selOut.leaks.join(", ")) : "✔ nothing identifying left"}</div></div>`;
  else h += `<div class="mut">Click a square to see that text before and after.</div>`;
  let t = "";
  if (O.try) t = `<div class="card gtry"><pre>${esc(O.try.out)}</pre><div class="${O.try.leaks.length ? "bad" : "ok"}"><b>${O.try.leaks.length ? "✘ Still shows: " + esc(O.try.leaks.join(", ")) + "." : O.try.raw_leaks.length ? "✔ It carried the machine's details and they are gone." : "✔ Nothing identifying in it, before or after."}</b></div></div>`;
  h += fold("stry", "Try to leak something", `<div class="mut">Type something a model might write about the machine, then see what is left.</div><div class="row tryrow"><input id="stext" value="${esc(O.text)}" placeholder="${esc(m.home)}/.ssh/config" aria-label="text to scrub"><button class="btn" data-act="stry">Scrub it</button></div>` + t, true);
  if (O.att) h += fold("satt", "Ready-made leaks", `<div class="mut">Ways the same machine can show up. The last two are harmless.</div><table class="tr"><tr><th>text</th><th>after your scrubber</th><th></th></tr>${O.att.rows.map((a) => `<tr><td><code>${esc(a.text.slice(0, 40))}</code><div class="mut">${esc(a.note)}</div></td><td><code>${esc(a.out.slice(0, 44))}</code></td><td class="${a.leaks.length ? "bad" : "ok"}">${a.leaks.length ? "✘ " + esc(a.leaks[0]) : "✔"}</td></tr>`).join("")}</table>`, !!(S.lesson && lstep()[1].open?.includes("leaks")));
  h += fold("ssw", `The switches (${M.base.length + M.extra.length}) and the username`, `<div class="mut">Each switch replaces one thing the scrubber knows about.</div><div class="rules">${M.base.concat(M.extra).map((id) => `<button class="btn alt ${on(id) ? "on" : ""}" data-act="sopt" data-o="${id}">${esc(M.labels[id])}</button>`).join("")}</div>
    <div class="mut">Username on the made-up machine (try a name that is also an ordinary word)</div><div class="row">${["sam", "dev", "ci"].map((u) => `<button class="btn alt ${O.user === u ? "on" : ""}" data-act="suser" data-u="${u}">${u}</button>`).join("")}</div>`, !!S.lesson);
  h += fold("mach", "About the made-up machine", `<div class="mut">The recordings are scrubbed, so the lab puts a made-up machine's paths back (home <code>${esc(m.home)}</code>, temp <code>${esc(m.tmp_parent)}/…</code>, user <code>${esc(m.user)}</code>) and asks your scrubber to remove them again. The real raw output is never saved.</div>
    <div class="mut"><code>lab/scrub.py</code> is written for this lab. Its <code>scrub</code> function is the one <code>scripts/record_runs.py</code> really runs on every saved file. CI also runs <code>detect</code>, which knows nothing about any machine and fails if a recorded file holds the <i>shape</i> of a home or temp path, and refuses any word on upstream's private-word list.</div>`, false);
  return h;
}
function guardDrawer() {
  const tab = (id, label) => `<button class="btn alt ${S.guard.tab === id ? "on" : ""}" data-act="gtab" data-t="${id}">${label}</button>`;
  const tabs = `<div class="row">${tab("calls", "What it may do")}${tab("output", "What it may say")}${tab("log", "Your log")}</div>`;
  return tabs + (S.guard.tab === "output" ? scrubDrawer() : S.guard.tab === "log" ? liveDrawer() : callsDrawer());
}
function callsDrawer() {
  const G = S.guard, beg = S.level === "beginner", k = G.res?.counts, meta = G.meta;
  if (!G.calls.length) return `<div class="note bad">The recorded runs did not load, so there are no real tool calls to test a policy against.</div>`;
  if (!k || !meta) return `<div class="mut">Loading Python…</div>`;
  const label = (id) => meta.rules.find((r) => r.id === id)?.label ?? id;
  const real = G.engine === "upstream", nothing = !real && !G.useCode && !G.rules.length;
  // The score first, in plain words. With nothing switched on it is an invitation, not a failure.
  let h = nothing ? `<div class="verdict" id="gscore"><div class="vl">${k.total} real tool calls, ${k.escapes} of them tried to leave the working folder</div><div class="big">Nothing is blocked yet</div><div class="vw">Switch a rule on and watch the squares change.</div></div>`
    : `<div class="verdict ${k.missed === 0 && k.wrongly === 0 ? "good" : "bad"}" id="gscore"><div class="vl">your policy, on ${k.total} real tool calls</div><div class="big">${k.caught} of ${k.escapes} escapes blocked</div>
    <div class="vw">${k.missed ? `${k.missed} got through.` : "None got through."} ${k.wrongly ? `${k.wrongly} harmless calls were blocked.` : "No harmless call was blocked."}${k.asked || k.denied ? ` (${k.denied} denied, ${k.asked} would ask you first.)` : ""}</div></div>`;
  const rule = (r) => `<button class="btn alt ${!G.useCode && G.rules.includes(r.id) ? "on" : ""}" data-act="grule" data-r="${r.id}">${esc(r.label)}</button>`;
  const FIRST = ["no_bash", "no_home", "no_absolute"];
  if (real) {
    const U = meta.upstream, up = G.up;
    h += `<div class="mut">The real guardrail (<code>guard_hook.py</code>): each rule can allow, ask or deny. Click a rule to change it.</div><div class="rules">${U.rules.map((r) => `<button class="btn alt ${up.rules[r] === "allow" ? "" : "on"}" data-act="gdial" data-r="${r}">${esc(r)}: ${esc(up.rules[r])}</button>`).join("")}</div>`;
  } else h += `<div class="rules">${meta.rules.filter((r) => FIRST.includes(r.id)).map(rule).join("")}</div>`;
  if (G.err) h += `<div class="note bad">${esc(G.err)}</div>`;
  const c = G.sel != null ? G.calls[G.sel] : null, r = c && G.res.rows[G.sel];
  if (c && r) {
    h += `<div class="card gcall"><div class="mut">${esc(c.name)} · ${esc(c.probe)} · ${c.arm === "with" ? "with" : "without"} the skill, try ${c.n + 1}</div><pre>${esc(guardText(c))}</pre>
    <div>${r.blocked ? `<b>${r.action === "ask" ? "Asks you first" : "Blocked"}</b>${r.by && r.by !== "your function" ? ` by “${esc(label(r.by))}”${r.reason ? `: ${esc(r.reason)}` : ""}` : ""}.` : "<b>Allowed.</b>"}</div>
    <div class="${r.outside ? "bad" : "ok"}">${r.outside ? "✘ Goes outside the working folder: " : "✔ Stays inside: "}${esc(r.why)}.</div></div>`;
    h += noteBox(callKey(c), callLabel(c));
  } else { const fo = guardFocus(); h += fo ? `<div class="mut">Start with the ringed square: ${esc(fo.why)}.</div>` : `<div class="mut">Click any square to read that call.</div>`; }
  const tryRow = `<div class="mut">Type a command or a file path and see if your policy stops it.</div><div class="row tryrow"><select id="gtool" aria-label="kind"><option value="bash" ${G.tool !== "read" ? "selected" : ""}>command</option><option value="read" ${G.tool === "read" ? "selected" : ""}>file</option></select>
    <input id="gtext" value="${esc(G.text)}" placeholder="cat ~/.ssh/config" aria-label="a command or path to try"><button class="btn" data-act="gtry">Try</button></div>`;
  let t = "";
  if (G.try) { const x = G.try, ok = x.blocked === x.outside; t = `<div class="card gtry"><div class="${ok ? "ok" : "bad"}"><b>${x.blocked ? (x.outside ? "✔ Blocked, and it would have gone outside." : "✘ Blocked by mistake: it stays inside.") : x.outside ? "✘ It got through, and it goes outside." : "✔ Allowed, and it stays inside."}</b></div><div class="mut">${esc(x.why)}.</div></div>`; }
  h += fold("gtry", "Try to get past it", tryRow + t, !S.lesson);
  if (G.att) h += fold("gatt", "Ready-made attacks", `<div class="mut">Click one to run it.</div><table class="tr"><tr><th>call</th><th>policy</th><th>really outside?</th><th></th></tr>${G.att.rows.map((a, i) => `<tr class="rowx" data-act="gattack" data-i="${i}"><td><code>${esc(a.text.slice(0, 44))}</code></td><td>${a.blocked ? "blocked" : "allowed"}</td><td>${a.outside ? "yes" : "no"}</td><td class="${a.blocked === a.outside ? "ok" : "bad"}">${a.blocked === a.outside ? "✔" : "✘"}</td></tr>`).join("")}</table>`, !!(S.lesson && lstep()[1].open?.includes("attacks")));
  // Everything else, one fold: other rules, the real guardrail, your own Python.
  const more = `<div class="mut">Which guardrail</div><div class="row"><button class="btn alt ${real ? "" : "on"}" data-act="gengine" data-e="lab">Rules written for this lab</button><button class="btn alt ${real ? "on" : ""}" data-act="gengine" data-e="upstream">The real one: guard_hook.py</button></div>`
    + (real ? `<div class="rules"><button class="btn alt ${G.up.allow_paths.length ? "on" : ""}" data-act="gallow">${G.up.allow_paths.length ? "The skill folder is an allowed place" : "Allow the skill folder as a place"}</button></div>
      <div class="mut">The policy file upstream reads (<code>.agent-guard.yaml</code>). Edit it and press Apply.</div><textarea id="gyaml" style="min-height:150px">${esc(G.yaml)}</textarea><div class="row"><button class="btn" data-act="gapply">Apply</button></div>`
    : `<div class="mut">More rules</div><div class="rules">${meta.rules.filter((r) => !FIRST.includes(r.id)).map(rule).join("")}</div>
      <div class="mut">Or write the policy as Python</div><textarea id="gcode" style="min-height:130px">${esc(G.code)}</textarea><div class="row"><button class="btn" data-act="gcode">Run my function</button><button class="btn alt" data-act="guse">Back to the switches</button></div>${G.useCode ? `<div class="mut">Your function is deciding now; the switches are off.</div>` : ""}`)
    + `<div class="mut">${real ? "The real guardrail is upstream's <code>guard_hook.py</code>, run unmodified; the recorded paths are put back onto a made-up machine so it can resolve them." : "These rules and the Python option are code written for this lab, not upstream."} Both are rule-based; real systems also use sandboxes and model-based checks. “Goes outside” is this lab's definition, worked out from the call's text.</div>`;
  h += fold("gmore", "More: other rules, the real guardrail, your own code", more, !!S.lesson && !!lstep()[1].open?.includes("more") || real || G.useCode || G.rules.some((x) => !FIRST.includes(x)));
  return h;
}

function initSkill() { const n = Object.keys(bundle.skills)[0]; S.skill = { name: n, dir: n, text: bundle.skills[n], rate: 0, res: null, rec: [] }; }
// Recorded runs that used exactly this text on this skill's probes (the sample skill itself, or a variant such as the filler).
const skillRuns = () => Object.entries(S.runs?.meta.files || {}).filter(([, m]) => m.skill === S.skill.name && (m.variant ? bundle.variants[m.variant] : bundle.skills[m.skill]) === S.skill.text);
async function runSkill() {
  const ps = bundle.probes.filter((p) => p.skill === S.skill.name);
  S.skill.probes = ps;
  S.skill.res = await call("ab_skill", { text: S.skill.text, probes: ps, rates: Object.fromEntries(ps.map((p) => [p.id, S.skill.rate])), samples: 3 });
  S.skill.rec = []; for (const [name, m] of skillRuns()) S.skill.rec.push({ name, m, g: await call("gate_run", { res: slimRun(S.runs.runs[name]) }) });
  S.skill.lint = S.skill.res.lint; renderSkill(); await drawer(); toast(S.skill.res.gate.verdict, S.skill.res.gate.verdict === "ADOPT" ? "pass" : "fail");
}
function renderSkill() {
  const root = vp(); root.replaceChildren(); S.ref = { nodes: new Map(), edges: [] }; S.graph = null;
  const r = S.skill.res; const ps = bundle.probes.filter((p) => p.skill === S.skill.name), beg = S.level === "beginner";
  root.append(el("text", { class: "col", x: 30, y: 30 }, "skill"), el("text", { class: "col", x: 330, y: 30 }, "text check (a proxy)"), el("text", { class: "col", x: 700, y: 30 }, "the gate, on the proxy"));
  root.append(nodeEl({ id: "skill", kind: "skill", title: S.skill.dir || "skill", sub: `${(S.skill.text || "").length} characters` }, { x: 30, y: 50, w: 250, h: 38 }));
  ps.forEach((p, i) => {
    const cov = r?.coverage.find((c) => c.probe === p.id);
    const n = nodeEl({ id: "p:" + p.id, kind: "eval", title: p.id, tier: p.split || "dev", pass: cov ? cov.covered : null,
      sub: cov ? (cov.covered ? "text contains every expected phrase" : "missing " + JSON.stringify(cov.missing)) : "run the A/B to check coverage" }, { x: 330, y: 50 + i * 50, w: 330, h: 38 });
    n.addEventListener("click", () => toast(p.q, ""));
    root.append(n);
    if (cov) { const a = { x: 280, y: 69 }, b = { x: 330, y: 69 + i * 50 }; root.insertBefore(el("path", { class: `edge ${cov.covered ? "hot" : "bad"}`, d: `M${a.x} ${a.y} C305 ${a.y},305 ${b.y},${b.x} ${b.y}` }), root.firstChild); }
  });
  if (r) renderTree(root, 700, 50, 380, gateSteps(r.gate, beg), { h: 58, gap: 18 }); else root.append(el("text", { class: "gaptxt", x: 700, y: 70 }, "choose a skill and press A/B"));
  fit(1110, Math.max(50 + ps.length * 50, 50 + 6 * 76) + 40);
}
function skillDrawer() {
  const k = S.skill, r = k.res, beg = S.level === "beginner", own = bundle.skills[k.name] === k.text;
  let h = `${beg ? "" : `<div class="note"><b>Read this first.</b> The verdict below comes from a <b>text check</b>: does the skill's text contain what each question expects? That is a proxy. It shows the skill could help, not that a model does better. The recorded runs under it are real model behaviour.</div>`}
    <div class="row"><select id="sk">${Object.keys(bundle.skills).map((n) => `<option ${n === k.name ? "selected" : ""}>${esc(n)}</option>`).join("")}</select><button class="btn alt" data-act="sload">load</button></div>
    <div class="row"><button class="btn" data-act="sgo">A/B this skill</button><button class="btn alt" data-act="sfill">filler skill</button><button class="btn alt" data-act="sbad">bad skill</button></div>`;
  if (r) {
    h += `<h3>verdict of the text check (proxy)</h3>${verdictHtml(r.gate, "sverdict")}`;
    h += `<h3>recorded behaviour (real model answers · click a row to read them)</h3>` + (k.rec.length ? `<table class="rec"><tr><th>model</th><th>correct without → with</th><th>${beg ? "the real gate says" : "gate"}</th></tr>${k.rec.map(({ name, m, g }) => `<tr class="rowx" data-act="openrun" data-run="${esc(name)}"><td title="${esc(m.model)}">${esc(modelName(m.model))}<br><span class="mut">${esc(m.date)}</span></td><td>${g.facts.dev_without}/${g.facts.dev_n} → ${g.facts.dev_with}/${g.facts.dev_n}<br><span class="mut">costs ×${g.facts.cost_ratio}</span></td><td class="${g.verdict === "ADOPT" ? "ok" : "bad"}"><b>${esc(beg ? PLAIN_VERDICT[g.verdict] : g.verdict)}</b></td></tr>`).join("")}</table>
        ${k.rec.some((x) => x.g.verdict !== r.gate.verdict) ? `<div class="mut">Where the proxy and a recorded verdict disagree, believe the recording.</div>` : ""}${fold("recnote", "How these were recorded", `<div class="mut">Recorded once with this exact text, 3 tries per question, judged by the same gate.</div>`, false)}`
      : `<div class="mut">${!S.runs ? "The recorded runs did not load." : own ? "No run was recorded for this skill." : "No recorded run used this text, so only the proxy applies. Load a sample skill unchanged, or the filler on dst, to compare with real behaviour."}</div>`);
    h += `<h3>lint (real check_skills)</h3>${r.lint.errors.length ? r.lint.errors.map((e) => `<div class="bad">${esc(e)}</div>`).join("") : '<div class="ok">clean</div>'}`;
  }
  h += fold("skilltext", `The skill text <span class="mut">${k.text.length.toLocaleString("en-CA")} characters · edit it and press A/B</span>`, `<input id="sdir" type="hidden" value="${esc(k.dir)}"><textarea id="stext" style="min-height:200px">${esc(k.text)}</textarea>
    <div class="row"><label class="mut">share of answers already right without the skill <input id="srate" type="range" min="0" max="1" step="0.33" value="${k.rate}" style="width:110px"></label></div>`, !beg && !S.lesson);
  return h;
}
function renderAbout() {
  const root = vp(); root.replaceChildren(); S.ref = { nodes: new Map(), edges: [] }; S.graph = null;
  const v = bundle.vendor, entries = Object.entries(v.files);
  root.append(el("text", { class: "col", x: 30, y: 30 }, "vendored upstream files (byte-identical)"), el("text", { class: "col", x: 560, y: 30 }, "runs here, in your browser"));
  entries.forEach(([k, f], i) => { root.append(nodeEl({ id: k, kind: f.repo === "map" ? "fact" : "skill", title: k, sub: `${f.repo} · sha256 ${f.sha256.slice(0, 10)}` }, { x: 30, y: 50 + i * 50, w: 300, h: 38 }));
    root.insertBefore(el("path", { class: "edge hot", d: `M330 ${69 + i * 50} C445 ${69 + i * 50},445 ${50 + entries.length * 25 + 10},560 ${50 + entries.length * 25 + 10}` }), root.firstChild); });
  const mid = 50 + entries.length * 25 - 9;
  root.append(nodeEl({ id: "py", kind: "eval", title: "Pyodide (WebAssembly Python)", sub: "no server · no model calls · no secrets", pass: true }, { x: 560, y: mid, w: 300, h: 38 }));
  fit(900, 50 + entries.length * 50);
}
// ---------------- guidance: where to start looking, and notes you pin to a square
// The ringed square is where to start. Trace: the first call that leaves the folder, else the first call. Guardrails: the first escape your policy let
// through, else the first harmless call it blocked, else the first call that tries to leave the folder.
function traceFocus() {
  const T = S.tl; if (!T?.calls.length) return null;
  const o = T.labels.findIndex((x) => x.outside);
  return o >= 0 ? { i: o, why: `call ${o + 1}, the first one to leave the working folder` } : { i: 0, why: "call 1, the first thing it did" };
}
function guardFocus() {
  const G = S.guard, rows = G.res?.rows; if (!rows || G.tab !== "calls") return null;
  const nothing = guardNothing(); if (guardFocus.c?.rows === rows && guardFocus.c.nothing === nothing) return guardFocus.c.v;
  const pick = (f, why) => { const i = rows.findIndex(f); return i < 0 ? null : { i, why }; };
  const v = (nothing ? null : pick((r) => r.outside && !r.blocked, "the first escape your policy let through") ?? pick((r) => r.blocked && !r.outside, "the first harmless call it blocked by mistake")) ?? pick((r) => r.outside, "the first call that tries to leave the working folder");
  guardFocus.c = { rows, nothing, v }; return v;
}
const notes = () => store.json("lab.notes") || [];
const noteFor = (key) => notes().find((n) => n.key === key);
const traceKey = (i) => `trace:${S.tl.run}:${S.tl.probe}:${S.tl.arm}:${S.tl.n}:${i}`;
const callKey = (c) => `guard:${c.run}:${c.probe}:${c.arm}:${c.n}:${guardText(c).slice(0, 120)}`;
const traceLabel = (i) => `${S.tl.probe}, ${S.tl.arm === "with" ? "with" : "without"} the skill, call ${i + 1}: ${guardText(S.tl.calls[i]).slice(0, 80)}`;
const callLabel = (c) => `${c.probe}, ${c.arm === "with" ? "with" : "without"} the skill: ${guardText(c).slice(0, 80)}`;
function noteBox(key, label) {
  const n = noteFor(key);
  return `<div class="nbox"><label class="fld">Your note<textarea id="nnote" data-key="${esc(key)}" data-label="${esc(label)}" placeholder="What do you notice here? One line is plenty.">${esc(n?.text ?? "")}</textarea></label><div class="row"><button class="btn sm" data-act="notesave">${n ? "Update note" : "Pin note"}</button>${n ? `<button class="btn sm alt" data-act="notedel" data-key="${esc(n.key)}">Remove</button>` : ""}</div></div>`;
}
function notesMarkdown() { return `# agent-lab notes\n\nNotes pinned to recorded tool calls. Written in the browser and kept on this device.\n\n` + notes().map((n) => `## ${n.label}\n\n${n.text}\n`).join("\n"); }
// On a phone the squares stay: the same squares as the canvas, as buttons you tap. Tapping does what clicking the canvas square does.
const psq = (items) => `<div class="psqs ${items.length > 120 ? "many" : ""}">${items.map((x, i) => `<button class="psq ${x.cls} ${x.sel ? "sel" : ""} ${x.focus ? "focus" : ""} ${x.noted ? "noted" : ""}" data-psq="${i}" aria-label="${esc(x.label)}"></button>`).join("")}</div>`;
function guardSquares() {
  const G = S.guard, O = G.out;
  if (G.tab === "log") return G.live?.res ? psq(G.live.res.rows.map((r, i) => ({ cls: r.action === "allow" ? "fine" : r.action, label: `${r.action} ${r.rule} ${r.text}`.slice(0, 80), sel: G.live.sel === i }))) : "";
  if (G.tab === "output") return O.res ? psq(O.texts.map((t, i) => { const st = O.res.rows[i].status; return { cls: st === "leak" ? (O.opts.length ? "miss" : "esc") : st === "fixed" ? "caught" : st === "damaged" ? "fp" : "fine", label: t.text.slice(0, 80), sel: O.sel === i }; })) : "";
  const nothing = guardNothing();
  return G.calls.length ? psq(G.calls.map((c, i) => { const r = G.res?.rows[i]; return { cls: r ? (r.blocked ? (r.outside ? "caught" : "fp") : r.outside ? (nothing ? "esc" : "miss") : "fine") : "fine", label: guardText(c).slice(0, 80), sel: G.sel === i, focus: guardFocus()?.i === i, noted: !!noteFor(callKey(c)) }; })) : "";
}
async function tapSquare(i) {
  const sc = MODES.find((m) => m[0] === S.mode)[2], G = S.guard;
  if (sc === "scene-trace") S.tl.sel = i;
  else if (G.tab === "log") G.live.sel = i;
  else if (G.tab === "output") { G.out.sel = i; G.out.selOut = await call("scrub_one", { text: G.out.texts[i].text, opts: G.out.opts, user: G.out.user, rebuild: true }); }
  else G.sel = i;
  renderScene(); await drawer();
}
// ---------------- phone: the canvas is too small to read at 390px, so the same state is shown as a short, tappable summary
function summary() {
  const box = $("sum"); if (!phone() || S.mode === "start") { box.innerHTML = ""; return; }
  const sc = MODES.find((m) => m[0] === S.mode)[2], beg = S.level === "beginner";
  if (sc === "scene-trace") { const T = S.tl, r = tlAnswer(); box.innerHTML = T && r ? `<h4>Trace <span>${esc(r.probe)} · ${r.arm === "with" ? "with" : "without"} the skill</span></h4><div class="mut">${T.calls.length} tool calls, ${tlOut()} reaching outside the working folder · ${r.correct ? "passed" : "failed"} the check · $${r.cost_usd}</div>${psq(T.calls.map((c, i) => ({ cls: T.labels[i]?.outside ? "ask" : "in", label: `${i + 1}. ${c.name} ${guardText(c).slice(0, 60)}`, sel: T.sel === i, focus: traceFocus()?.i === i, noted: !!noteFor(traceKey(i)) })))}` : ""; return; }
  const steps = (g) => gateSteps(g, beg).map((s, i) => `<div class="sstep ${s.state} ${s.state === "fired" ? (s.verdict === "ADOPT" ? "good" : "bad") : ""}"><b>${i + 1} · ${esc(s.name)}</b><span>${esc(s.question)}</span><em>${s.state === "fired" ? (s.verdict === "ADOPT" ? "→ adopt" : "yes → stop here") : s.state === "no" ? "no" : ""}</em></div>`).join("");
  let h = "";
  if (sc === "scene-graph" && S.graph) {
    const nb = S.sel ? neighbors(S.graph, S.sel) : null, dim = (id) => (nb ? !nb.has(id) : !!S.ov.ranks && !(id in S.ov.ranks)), unc = new Set(S.graph.files.map((f) => f.id)); for (const e of S.graph.edges) unc.delete(e.to);
    const chip = (n, cls, text, extra = "") => `<button class="sc ${cls} ${S.sel === n.id ? "sel" : ""} ${dim(n.id) ? "dim" : ""}" data-node="${esc(n.id)}" style="--k:${kindVar(n.kind)}">${extra}${esc(text)}</button>`;
    const files = S.layout.files, fileChip = (f) => chip(f, `file ${f.id === S.whatif?.broken ? "broken" : ""} ${S.preview && f.id === S.preview.path ? "new" : ""}`, shortPath(f.path).split("/").pop(), S.ov.ranks?.[f.id] ? `<b class="rk">#${S.ov.ranks[f.id]}</b>` : "");
    h = `<h4>Evals <span>the questions · tap one${S.mode === "evals" ? " to replay it" : ""}</span></h4><div class="chips">${S.graph.evals.map((e) => chip(e, `eval ${e.tier === "skip" ? "skip" : e.pass ? "pass" : "fail"}`, e.title, `<i></i>`)).join("")}</div>
      <h4>Files <span>what the evals search${S.sel ? " · lit = linked to your pick" : ""}</span></h4><div class="chips">${files.filter((f) => !unc.has(f.id)).map(fileChip).join("")}</div>` +
      (unc.size ? `<h4 class="warn">No eval reads these</h4><div class="chips">${files.filter((f) => unc.has(f.id)).map(fileChip).join("")}</div>` : "");
  } else if (sc === "scene-gate" && S.gate?.res) {
    const f = S.gate.res.facts || {};
    h = `<h4>The gate <span>${S.gate.run ? "recorded: " + esc(runLabel(S.gate.run)) : "hand-set results"} · correct ${f.dev_without ?? "?"}/${f.dev_n ?? "?"} → ${f.dev_with ?? "?"}/${f.dev_n ?? "?"}</span></h4>${steps(S.gate.res)}`;
  } else if (sc === "scene-guard" && S.guard?.tab === "log") {
    const k = S.guard.live?.res?.counts;
    h = k ? `<h4>Your log <span>${k.total} judged calls</span></h4><div class="chips"><span class="sc eval"><i></i>allowed · ${k.allow}</span><span class="sc eval"><i></i>asked · ${k.ask}</span><span class="sc eval ${k.deny ? "fail" : ""}"><i></i>denied · ${k.deny}</span></div>` : "";
  } else if (sc === "scene-guard" && S.guard?.tab === "output" && S.guard.out.res) {
    const k = S.guard.out.res.counts;
    h = `<h4>Your scrubber <span>${k.total} real texts</span></h4><div class="chips"><span class="sc eval fail"><i></i>still leak · ${k.leaks}</span><span class="sc eval pass"><i></i>cleaned · ${k.fixed}</span><span class="sc eval ${k.damaged ? "fail" : "pass"}"><i></i>word replaced · ${k.damaged}</span><span class="sc eval"><i></i>nothing to do · ${k.fine}</span></div>`;
  } else if (sc === "scene-guard" && S.guard?.res) {
    const k = S.guard.res.counts;
    h = `<h4>Your policy <span>${k.total} real tool calls</span></h4><div class="chips"><span class="sc eval pass"><i></i>blocked an escape · ${k.caught}</span><span class="sc eval fail"><i></i>got through · ${k.missed}</span><span class="sc eval ${k.wrongly ? "fail" : "pass"}"><i></i>blocked by mistake · ${k.wrongly}</span><span class="sc eval"><i></i>allowed, harmless · ${k.total - k.blocked - k.missed}</span></div>`;
  } else if (sc === "scene-skill") {
    const r = S.skill.res;
    h = `<h4>Text check <span>does the skill's text hold each answer?</span></h4><div class="chips">${bundle.probes.filter((p) => p.skill === S.skill.name).map((p) => { const c = r?.coverage.find((x) => x.probe === p.id); return `<span class="sc eval ${c ? (c.covered ? "pass" : "fail") : ""}"><i></i>${esc(p.id)}</span>`; }).join("")}</div>` + (r ? `<h4>The gate, on that check</h4>${steps(r.gate)}` : "");
  }
  if (sc === "scene-guard") h += guardSquares();
  box.innerHTML = h;
}
// ---------------- trace: one recorded answer as a row of squares, one per tool call. Labels come from lab/guard.py's reference check.
const TRACE_LEG = [["pass", "inside the working folder"], ["warn", "reaches outside it"]];
async function setAnswer(run, r) {
  const calls = r.tools.map(([name, args]) => { let a = {}; try { a = JSON.parse(args); } catch { /* an unparsable call is shown as empty */ } return { name, args: a }; });
  const g = calls.length ? await call("guard_run", { calls, policy: { rules: [] } }) : { rows: [] };
  S.tl = { run, probe: r.probe, arm: r.arm, n: r.n, calls, labels: g.rows, sel: null };
}
async function ensureTl() {
  if (S.tl || !S.runs) return;
  const f = featured(S); if (f) await setAnswer(f.run, f.without);
}
const tlAnswer = () => S.tl && S.runs.runs[S.tl.run].rows.find((r) => r.probe === S.tl.probe && r.arm === S.tl.arm && r.n === S.tl.n);
const tlOut = () => S.tl.labels.filter((x) => x.outside).length;
function renderTrace() {
  const root = vp(); root.replaceChildren(); S.ref = { nodes: new Map(), edges: [] }; S.graph = null;
  const T = S.tl, r = tlAnswer();
  if (!T || !r) { root.append(el("text", { class: "col", x: 0, y: 20 }, "no recorded run is loaded")); fit(400, 40); return; }
  const cols = 20, step = 34, n = T.calls.length, rows = Math.max(1, Math.ceil(n / cols)), y0 = 24 + rows * step + 12;
  root.append(el("text", { class: "col", x: 0, y: 10 }, `${modelName(S.runs.runs[T.run].pi_args[1])} · ${r.probe} · ${r.arm === "with" ? "with" : "without"} the skill · try ${r.n + 1}`));
  if (!n) root.append(el("text", { class: "col", x: 0, y: 44 }, "no tool calls: it answered straight away"));
  const fo = traceFocus();
  T.calls.forEach((c, i) => {
    const g = el("rect", { class: `gc ${T.labels[i]?.outside ? "ask" : "in"} ${T.sel === i ? "sel" : ""} ${noteFor(traceKey(i)) ? "noted" : ""} ${fo?.i === i ? "focus" : ""}`, "data-i": i, x: (i % cols) * step, y: 24 + Math.floor(i / cols) * step, width: 28, height: 28, rx: 5 }, el("title", {}, `${i + 1}. ${c.name} ${guardText(c)}`.slice(0, 120)));
    g.addEventListener("click", (e) => { e.stopPropagation(); act(() => { T.sel = i; renderScene(); return drawer(); }); });
    root.append(g);
  });
  const sel = T.sel != null ? T.calls[T.sel] : null;
  root.append(el("text", { class: "col", x: 0, y: y0 }, sel ? `${T.sel + 1}. ${sel.name}: ${guardText(sel).slice(0, 56)}` : n ? `start here, at the ringed square: ${fo.why}` : ""));
  if (sel) root.append(el("text", { class: "col", x: 0, y: y0 + 18, style: "fill:var(--muted)" }, (T.labels[T.sel]?.why ?? "").slice(0, 70)));
  root.append(el("text", { class: "col", x: 0, y: y0 + (sel ? 44 : 30), style: `fill:var(--${r.correct ? "pass" : "fail"})` }, `then it answered: ${r.correct ? "✔ passed" : "✘ failed"} the check · $${r.cost_usd}`));
  fit(cols * step, y0 + (sel ? 56 : 42));
}
function traceDrawer() {
  const T = S.tl, R = S.runs, r = tlAnswer(); if (!T || !r) return `<div class="mut">No recorded runs are loaded.</div>`;
  const res = R.runs[T.run], sel = T.sel != null ? T.calls[T.sel] : null;
  let h = `<select id="tlrun">${Object.keys(R.meta.files).map((n) => `<option value="${esc(n)}" ${n === T.run ? "selected" : ""}>recorded: ${esc(runLabel(n))}</option>`).join("")}</select>
    <select id="tlans" aria-label="answer">${res.rows.map((x, i) => `<option value="${i}" ${x === r ? "selected" : ""}>${esc(x.probe)} · ${x.arm === "with" ? "with" : "without"} the skill · try ${x.n + 1} · ${x.tools.length} call${x.tools.length === 1 ? "" : "s"}</option>`).join("")}</select>
    <div class="card"><div class="big ${r.correct ? "ok" : "bad"}">${r.correct ? "✔ passed" : "✘ failed"} the check</div>
      <div class="mut">${T.calls.length} tool call${T.calls.length === 1 ? "" : "s"}, ${tlOut()} reaching outside the working folder · $${r.cost_usd} · ${r.finished ? "finished" : "did not finish"}${r.arm === "with" ? (r.skill_read ? " · opened the skill file" : " · did not open the skill file") : ""}</div></div>`;
  h += sel ? `<div class="card gcall"><div class="mut">call ${T.sel + 1} of ${T.calls.length} · ${esc(sel.name)}</div><pre>${esc(guardText(sel))}</pre><div class="${T.labels[T.sel]?.outside ? "warn" : "ok"}">${esc(T.labels[T.sel]?.why ?? "")}</div></div>` + noteBox(traceKey(T.sel), traceLabel(T.sel)) : `<div class="mut">Click or tap a square to read that call. Start with the ringed one.</div>`;
  return h + `<div class="note"><b>What this is.</b> A recorded answer, scrubbed like the rest. “Outside” is this lab's reference label (<code>reaches_outside</code> in <code>lab/guard.py</code>): a path outside the working folder, or a shell feature that can build one. The recording has one cost per answer, not per call.</div>`;
}

// ---------------- scene switch
function renderScene() {
  const sc = MODES.find((m) => m[0] === S.mode)[2];
  const leg = (sc === "scene-guard" && S.guard?.tab === "log") ? [["dim", "allowed"], ["warn", "asked"], ["fail", "denied"]] : (sc === "scene-guard" && S.guard?.tab === "output") ? (S.guard.out.opts.length ? [["fail", "still leaks"], ["pass", "cleaned"], ["warn", "word replaced"], ["dim", "nothing to do"]] : [["fail", "carries the machine's details"], ["dim", "nothing to hide"]]) : { "scene-graph": [["fact", "fact"], ["workstream", "workstream"], ["decision", "decision"], ["catalog", "catalog"], ["pass", "pass"], ["fail", "fail"]], "scene-gate": [["pass", "adopt"], ["fail", "stop"], ["dim", "not reached"]], "scene-skill": [["skill", "skill"], ["pass", "covered"], ["fail", "not covered"]], "scene-about": [["fact", "knowledge map"], ["skill", "toolkit"]], "scene-guard": guardNothing() ? [["fail", "tried to leave the folder"], ["dim", "stayed inside"]] : [["pass", "blocked an escape"], ["fail", "escape got through"], ["warn", "harmless but blocked"], ["dim", "allowed, harmless"]], "scene-home": [] }[sc];
  $("hud").innerHTML = (sc === "scene-trace" ? TRACE_LEG : leg).map(([c, t]) => `<span><i style="background:var(--${c})"></i>${t}</span>`).join("");
  if (sc === "scene-home") return;
  if (sc === "scene-graph") renderGraph(); else if (sc === "scene-gate") renderGate(); else if (sc === "scene-skill") renderSkill(); else if (sc === "scene-guard") renderGuard(); else if (sc === "scene-trace") renderTrace(); else renderAbout();
  summary();
}
async function setMode(m, fromHash) {
  if (!fromHash) await leaveGuided();   // navigating away ends a lesson or challenge; lessons themselves pass fromHash
  S.mode = m; document.body.classList.toggle("home", m === "start");   // before rendering: the canvas needs its real size to fit
  S.explain = null; S.replayTok++; if (m === "gate") await computeGate(); if (m === "guard") await computeGuardTab(); S.ov = {}; S.whatif = null; if (m !== "abfact") S.preview = null;
  if (m === "trace") await ensureTl();
  if (!["scene-graph"].includes(MODES.find((x) => x[0] === m)[2])) S.sel = null;
  document.querySelectorAll("#tools button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
  $("sub").textContent = MODES.find((x) => x[0] === m)[3];
  if (!fromHash && m !== "gate") history.replaceState(null, "", `#m=${m}`);
  if (m === "abskill" && !S.skill.res) { await runSkill(); return; }
  renderScene(); await drawer();
}

// ---------------- palette
const pal = { sel: 0, items: [] };
function palItems(q) {
  const t = q.toLowerCase();
  const all = [...MODES.map(([m, n]) => ({ k: "mode", label: n, sub: "go to mode", run: () => setMode(m) })),
    ...S.docs.filter((d) => FILE_KINDS.includes(d.kind)).map((d) => ({ k: "file", label: d.title, sub: d.path, run: async () => { if (!["explore", "break", "abfact"].includes(S.mode)) await setMode("explore"); S.sel = d.path; paintOverlay(); await drawer(); } })),
    ...S.results.map((r) => ({ k: "eval", label: r.id, sub: r.q, run: async () => { await setMode("evals"); S.sel = "eval:" + r.id; replay(r.id); } }))];
  const f = t ? all.filter((i) => (i.label + " " + i.sub).toLowerCase().includes(t)) : all.slice(0, 12);
  if (t) f.push({ k: "search", label: `search the brain for “${q}”`, sub: "real ranking", run: async () => { await setMode("explore"); $("qin").value = q; await ACT.search(); } });
  return f.slice(0, 14);
}
function palRender() { $("palist").innerHTML = pal.items.map((i, n) => `<div class="li ${n === pal.sel ? "sel" : ""}" data-n="${n}"><span class="pill">${i.k}</span><span><b>${esc(i.label)}</b> <span class="mut">${esc(clip(i.sub, 50))}</span></span></div>`).join(""); }
function palOpen() { $("pal").classList.add("on"); $("pin").value = ""; pal.sel = 0; pal.items = palItems(""); palRender(); $("pin").focus(); }
function palClose() { $("pal").classList.remove("on"); }
function palPick(n) { const it = pal.items[n]; palClose(); if (it) act(it.run); }

// ---------------- wiring
function wire() {
  const lv = () => { $("level").textContent = "level: " + S.level; };
  $("level").onclick = () => act(async () => { S.level = S.level === "beginner" ? "experienced" : "beginner"; store.set("lab.level", S.level); lv(); await relevel(); });
  lv();
  const btn = (m) => `<button data-m="${m}" title="${esc(MODES.find((x) => x[0] === m)[3])}" aria-label="${esc(MODES.find((x) => x[0] === m)[1])}"><svg viewBox="0 0 24 24">${ICON[m]}</svg><span class="lbl">${NAV[m]}</span></button>`;
  $("tools").innerHTML = btn("start") + `<div class="grp">explore</div>` + ["explore", "evals", "break", "gate", "trace", "abfact", "abskill", "guard"].map(btn).join("") + `<div class="sp"></div>` + btn("about");
  $("home").onclick = panelClick;
  $("tools").onclick = (e) => { const m = e.target.closest("button")?.dataset.m; if (m) act(() => setMode(m)); };
  $("sum").onclick = (e) => { const id = e.target.closest("[data-node]")?.dataset.node; if (id) act(() => onNode(id)); const sq = e.target.closest("[data-psq]"); if (sq) act(() => tapSquare(+sq.dataset.psq)); };
  $("find").onclick = palOpen;
  $("pin").oninput = () => { pal.items = palItems($("pin").value); pal.sel = 0; palRender(); };
  $("pin").onkeydown = (e) => { if (e.key === "ArrowDown") pal.sel = Math.min(pal.sel + 1, pal.items.length - 1); else if (e.key === "ArrowUp") pal.sel = Math.max(pal.sel - 1, 0); else if (e.key === "Enter") return palPick(pal.sel); else if (e.key === "Escape") return palClose(); else return; e.preventDefault(); palRender(); };
  $("palist").onclick = (e) => { const n = e.target.closest("[data-n]")?.dataset.n; if (n != null) palPick(+n); };
  $("pal").onclick = (e) => { if (e.target.id === "pal") palClose(); };
  addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palOpen(); } else if (e.key === "Escape" && !$("pal").classList.contains("on") && S.mode !== "start") act(() => { S.sel = null; S.ov = {}; paintOverlay(); return drawer(); }); });
  $("theme").onclick = () => { const l = document.documentElement.dataset.theme === "dark"; document.documentElement.dataset.theme = l ? "light" : "dark"; $("theme").title = l ? "switch to the dark theme" : "switch to the light theme"; };
  $("share").onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast("link copied", "pass"); } catch { toast(location.href, ""); } };
  const svg = $("svg"); let drag = null;
  svg.addEventListener("pointerdown", (e) => { if (e.target.closest(".node,.step,.gc")) return; drag = { x: e.clientX - S.view.x, y: e.clientY - S.view.y }; svg.classList.add("drag"); svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointermove", (e) => { if (drag) { S.view.x = e.clientX - drag.x; S.view.y = e.clientY - drag.y; applyView(); } });
  svg.addEventListener("pointerup", () => { drag = null; svg.classList.remove("drag"); });
  svg.addEventListener("click", (e) => { if (!e.target.closest(".node") && S.sel) act(() => { S.sel = null; paintOverlay(); return drawer(); }); });
  const zoom = (f, cx, cy) => { const r = svg.getBoundingClientRect(); cx ??= r.width / 2; cy ??= r.height / 2; const k = Math.min(3, Math.max(0.3, S.view.k * f)); S.view.x = cx - ((cx - S.view.x) / S.view.k) * k; S.view.y = cy - ((cy - S.view.y) / S.view.k) * k; S.view.k = k; applyView(); };
  svg.addEventListener("wheel", (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  $("zin").onclick = () => zoom(1.2); $("zout").onclick = () => zoom(1 / 1.2); $("zfit").onclick = () => S.size && fit(...S.size);
  let wasPhone = phone();
  addEventListener("resize", () => { if (phone() !== wasPhone) { wasPhone = phone(); if (S.ready && S.mode !== "start") renderScene(); } else if (S.size) fit(...S.size); });
}

async function boot() {
  const get = (f) => fetch(f).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${f}: HTTP ${r.status}`))));
  let recorded;
  [bundle, recorded, S.runs] = await Promise.all([get("bundle.json"), get("recorded.json").catch(() => ({ calls: {} })), get("runs.json").catch(() => null)]);
  lab = connectLab(window.__py, recorded, { record: RECORD, onState: pyState });
  S.files = structuredClone(bundle.brain); S.questions = bundle.questions; S.skills = bundle.skills; { const c = store.get("lab.case"); if (CASES.some((x) => x.id === c)) S.case = c; }
  initGuard();   // before the lesson list below: the guard lessons are offered only once their tool calls exist
  window.__lab = { call: (n, a) => lab.call(n, a), ready: lab.ready, interactive: false, idle, S, lab, notesMarkdown, lessons: lessons().map((l) => l.id) };
  wire(); pyState();
  const m = HASH0.match(/m=(\w+)/)?.[1]; const start = /[#&](g|run)=/.test(HASH0) ? "gate" : MODES.some((x) => x[0] === m) ? m : "start";
  // The Start screen needs no Python at all. Everything else needs the map, the evals and the gate: recorded, so instant.
  if (start === "start") { $("home").innerHTML = homeHtml(); window.__lab.interactive = true; }
  await act(async () => { await refresh(); await initGate(); initSkill(); initGuard(); S.ready = true; await setMode(start, true); window.__lab.interactive = true; });
  if ("serviceWorker" in navigator && (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /[?&]sw=1/.test(location.search))) navigator.serviceWorker.register("sw.js").catch(() => {});
}
boot().catch((e) => { toast(`Failed to start: ${e.message}`, "fail"); $("pytxt").textContent = "failed to start"; console.error(e); });
