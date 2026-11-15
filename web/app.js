import { bootLab } from "./lab.js";
import { buildGraph, layout, neighbors, gateSteps, clip, encodeGate, decodeGate, FILE_KINDS } from "./model.js";

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const NS = "http://www.w3.org/2000/svg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kindVar = (k) => `var(--${k === "eval" ? "eval" : k})`;

const ICON = {
  explore: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7l8 1M7.5 8l3 8M16.5 10l-3 6"/>',
  evals: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  break: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  gate: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  abfact: '<path d="M12 5v14M5 12h14"/><rect x="3" y="3" width="18" height="18" rx="4"/>',
  abskill: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  about: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.01"/>',
};
const MODES = [
  ["explore", "Map", "scene-graph", "The map: facts, workstreams, decisions and the evals that read them. Hover to trace, click to open and edit."],
  ["evals", "Evals", "scene-graph", "Replay one eval step by step, or add a bad one and watch it fail."],
  ["break", "Break it", "scene-graph", "Break the knowledge on purpose; see which evals notice and which don't."],
  ["gate", "The gate", "scene-gate", "Same results in, same verdict out. Change outcomes or thresholds; watch which rule fires."],
  ["abfact", "A/B a fact", "scene-graph", "Drop a new fact into a copy of the map and see what it breaks, hijacks or fits."],
  ["abskill", "A/B a skill", "scene-skill", "Lint a skill, check its text covers the probes, then run the real gate."],
  ["about", "About", "scene-about", "What is real here and what is not."],
];

// ---------------- state
const HASH0 = location.hash;
let lab, bundle;
const S = { mode: "explore", files: {}, questions: "", docs: [], results: [], graph: null, sel: null, ov: {}, whatif: null, preview: null,
  view: { x: 0, y: 0, k: 1 }, gate: null, skill: {}, replayTok: 0, ref: {} };
const call = (n, a) => { const r = lab.call(n, a); if (r && r.error) throw new Error(r.error); return r; };
const guard = (fn) => { try { return fn(); } catch (e) { toast(e.message, "fail"); console.error(e); } };

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
  const r = $("stage").getBoundingClientRect();
  const k = Math.min(r.width / (w + 20), r.height / (h + 20), 1.25);
  S.view = { k, x: (r.width - w * k) / 2, y: Math.max(6, (r.height - h * k) / 2) };
  S.size = [w, h]; applyView();
}
function toast(msg, cls = "") { const t = $("toast"); t.textContent = msg; t.className = "show " + cls; clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = ""), 2600); }

// ---------------- data refresh
function refresh() {
  S.docs = call("explore", { files: S.files });
  S.results = call("run_evals", { files: S.files, questions: S.questions }).results;
  S.summary = call("run_evals", { files: S.files, questions: S.questions }).summary;
}
function currentGraph() {
  if (S.preview) return buildGraph(S.preview.docs, S.preview.results);
  return buildGraph(S.docs, S.whatif?.results ?? S.results);
}

// ---------------- graph scene
function renderGraph() {
  const g = (S.graph = currentGraph());
  const L = (S.layout = layout(g));
  const root = vp(); root.replaceChildren();
  const edges = el("g"), nodes = el("g"); S.ref = { nodes: new Map(), edges: [] };
  root.append(edges, nodes);
  root.append(el("text", { class: "col", x: 30, y: 44 }, "evals (questions)"), el("text", { class: "col", x: 600, y: 44 }, "knowledge (files)"));
  if (L.uncoveredAt != null) { root.append(el("line", { class: "gap", x1: 600, x2: 900, y1: L.uncoveredAt, y2: L.uncoveredAt }), el("text", { class: "gaptxt", x: 600, y: L.uncoveredAt - 4 }, "no eval reads these")); }
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
function nodeEl(n, p) {
  const isEval = n.kind === "eval";
  const cls = ["node"];
  if (isEval) { cls.push(n.tier === "skip" ? "skip" : n.pass ? "pass" : "fail"); }
  const sub = isEval ? `search "${clip(n.query, 26)}" · ${n.tier}` : clip(n.path, 40);
  const g = el("g", { class: cls.join(" "), tabindex: 0, role: "button", "data-id": n.id, "aria-label": n.title, transform: `translate(${p.x} ${p.y})` }, [
    el("rect", { class: "box", width: p.w, height: p.h, rx: 9 }),
    el("rect", { class: "bar", x: 0, y: 0, width: 5, height: p.h, rx: 2, fill: kindVar(n.kind) }),
    el("text", { class: "t", x: 16, y: 16 }, clip(n.title, isEval ? 30 : 34)),
    el("text", { class: "s", x: 16, y: 30 }, sub),
  ]);
  if (isEval) g.append(el("circle", { cx: p.w - 14, cy: p.h / 2, r: 4.5, fill: n.tier === "skip" ? "var(--dim)" : n.pass ? "var(--pass)" : "var(--fail)" }));
  g.addEventListener("mouseenter", () => focusNode(n.id)); g.addEventListener("mouseleave", () => focusNode(null));
  g.addEventListener("focus", () => focusNode(n.id)); g.addEventListener("blur", () => focusNode(null));
  g.addEventListener("click", (ev) => { ev.stopPropagation(); onNode(n.id); });
  g.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onNode(n.id); } });
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
  focusNode(null);
}
function flash(ids) { for (const id of ids) { const g = S.ref.nodes.get(id); if (g) { g.classList.remove("flash"); void g.getBoundingClientRect(); g.classList.add("flash"); setTimeout(() => g.classList.remove("flash"), 1900); } } }

// ---------------- node clicks
function onNode(id) {
  S.sel = S.sel === id ? null : id;
  if (S.mode === "evals" && id.startsWith("eval:")) { S.sel = id; replay(id.slice(5)); }
  paintOverlay(); drawer();
}

// ---------------- evals: replay one eval step by step
async function replay(evalId) {
  const tok = ++S.replayTok, r = (S.whatif?.results ?? S.results).find((x) => x.id === evalId); if (!r) return;
  const hits = (S.graph.edges.filter((e) => e.from === "eval:" + evalId)).sort((a, b) => a.rank - b.rank);
  S.ov = { ranks: {} }; paintOverlay(); S.replay = { id: evalId, shown: 0, done: false }; drawer();
  await sleep(300);
  for (const e of hits) { if (tok !== S.replayTok) return; S.ov.ranks[e.to] = e.rank; paintOverlay(); await sleep(260); }
  for (let i = 0; i < r.checks.length; i++) { if (tok !== S.replayTok) return; S.replay.shown = i + 1; drawer(); await sleep(260); }
  if (tok !== S.replayTok) return;
  S.replay.done = true; drawer(); toast(r.tier === "skip" ? "skipped" : r.pass ? "PASS" : "FAIL", r.pass ? "pass" : "fail");
}

// ---------------- drawer
function drawer() {
  const d = $("drawer"), m = MODES.find((x) => x[0] === S.mode);
  const keep = d.scrollTop;
  d.innerHTML = `<h2>${m[1]}</h2><p class="lead">${m[3]}</p>` + (DRAW[S.mode]?.() ?? "");
  d.scrollTop = keep; bindDrawer();
  const s = S.summary; $("st1").textContent = s ? `evals ${s.must_pass}/${s.must_total} must pass${s.skipped ? ` · ${s.skipped} skipped` : ""}` : "";
  $("st2").textContent = `${Object.keys(S.files).length} files · deterministic · no model calls`;
}
const fileEditor = () => {
  const p = S.sel && S.files[S.sel] != null ? S.sel : null;
  if (!p) return `<div class="mut">Click a file node to open it. Click an eval node to see what it reads.</div>`;
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
function explainCard() {
  const e = S.explain; if (!e) return "";
  const m = e.mutation, tgt = `${m.op.replace("_", " ")} <code>${esc(clip(m.path, 34))}</code>${m.text ? ` · <code>${esc(clip(m.text, 24))}</code>` : ""}`;
  let h = `<h3>why · ${tgt}</h3><div class="card"><div class="big ${e.survived ? "warn" : "ok"}">${e.survived ? "SURVIVED" : "KILLED"}</div>`;
  h += e.why.map((w) => `<div class="mut" style="margin:4px 0">• ${esc(w).replace(/`([^`]+)`/g, "<code>$1</code>")}</div>`).join("");
  if (!e.survived) h += e.killed.map((k) => `<div class="bad">✘ ${esc(k.eval)}: ${k.failed.map(esc).join("; ")}</div>`).join("");
  if (e.fix) {
    h += `<h3>how to fix</h3><div class="mut">${esc(e.fix.note)}</div>`;
    if (e.fix.yaml) h += `<pre>${esc(e.fix.yaml)}</pre><button class="btn" data-act="applyfix">Add this eval</button>`;
  }
  return h + "</div>";
}
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
      if (rp && rp.done) h += `<div class="big ${cur.pass ? "ok" : "bad"}">${cur.pass ? "PASS" : "FAIL"}</div><pre>${esc(cur.output || "(no output)")}</pre>`;
    } else h += `<div class="mut" style="margin-top:10px">Click an eval node on the canvas to replay it.</div>`;
    return h + `<h3>questions.yaml</h3><textarea id="qs" style="min-height:200px">${esc(S.questions)}</textarea><div class="row"><button class="btn alt" data-act="applyqs">Apply YAML</button></div>`;
  },
  break() {
    const f = S.sel && S.files[S.sel] != null ? S.sel : null;
    let h = `<div class="note">A mutation is a deliberate wrong edit. If no eval fails, the evals have a blind spot.</div>`;
    h += f ? `<h3>target · ${esc(f)}</h3><div class="row"><select id="mop"><option value="delete_file">delete file</option><option value="remove_text">remove text</option><option value="replace_text">replace text</option></select></div>
      <div class="row"><input id="mtext" placeholder="text to remove / replace"><input id="mwith" placeholder="replacement"></div><button class="btn danger" data-act="break">Break it</button><button class="btn alt" data-act="restore">Restore</button>`
      : `<div class="mut">Click a file node to choose what to break.</div>`;
    h += `<div class="row"><button class="btn alt" data-act="auto">Auto-mutate everything</button></div><div class="ring"><div id="mring" style="width:${S.mut ? (S.mut.i / S.mut.total) * 100 : 0}%"></div></div>`;
    if (S.mut) h += `<div class="big ${S.mut.done && S.mut.score >= 0.8 ? "ok" : S.mut.done ? "warn" : ""}">${S.mut.done ? `score ${S.mut.killed}/${S.mut.total} (${Math.round(S.mut.score * 100)}%)` : `${S.mut.i}/${S.mut.total}…`}</div>
      <div class="mut">click a row to see why</div><table>${S.mut.rows.map((r) => `<tr class="rowx" data-act="exp" data-i="${S.mut.rows.indexOf(r)}"><td class="${r.killed_by.length ? "ok" : "bad"}">${r.killed_by.length ? "killed" : "SURVIVED"}</td><td>${esc(r.mutation.op)} <code>${esc(clip(r.mutation.path, 28))}</code></td><td class="mut">${esc(r.killed_by.join(", "))}</td></tr>`).join("")}</table>`;
    if (S.whatif?.res && !S.explain) { const r = S.whatif.res; h += `<div class="card"><div class="big ${r.survived ? "warn" : "ok"}">${r.survived ? "SURVIVED: nothing noticed" : "KILLED by " + esc(r.killed_by.join(", "))}</div></div>`; }
    return h + explainCard();
  },
  abfact() {
    const pv = S.preview;
    let h = `<div class="mut">Adds the doc to a copy of the map and reruns every eval and the search rankings.</div>
      <div class="row"><input id="fpath" value="${esc(S.ab?.path ?? "facts/fiscal-calendar.md")}"></div>
      <textarea id="ftext" style="min-height:150px">${esc(S.ab?.text ?? "---\ntitle: Fiscal year starts in February\ntags: [calendar, fiscal]\nverified: true\n---\nOur fiscal year starts on 1 February, so quarter boundaries differ from calendar quarters.\n")}</textarea>
      <div class="row"><input id="fown" placeholder="a query that SHOULD find it" value="${esc(S.ab?.own ?? "fiscal year quarter")}"></div>
      <button class="btn" data-act="abfact">A/B this fact</button><button class="btn alt" data-act="hijack">load a hijacking fact</button><button class="btn alt" data-act="abdiscard">Discard</button>`;
    if (pv) { const a = pv.ab, col = a.verdict === "FIT" ? "ok" : "bad";
      h += `<div class="card"><div class="big ${col}">${a.verdict}</div><div class="mut">evals must ${a.before.must_pass}/${a.before.must_total} → ${a.after.must_pass}/${a.after.must_total}</div>
        ${a.broke.map((x) => `<div class="bad">✘ breaks <code>${esc(x)}</code></div>`).join("")}${a.polluted.map((x) => `<div class="warn">⚑ hijacks the top result of <code>${esc(x.id)}</code> (was ${esc(x.was_first)})</div>`).join("")}
        ${a.findable ? (a.findable.rank ? `<div class="ok">found at rank ${a.findable.rank} for "${esc(a.findable.query)}"</div>` : `<div class="bad">not in the top 3 for "${esc(a.findable.query)}"</div>`) : ""}
        ${a.verdict === "FIT" ? '<button class="btn" data-act="commit">Add to map</button>' : ""}</div>`; }
    return h;
  },
  gate: () => gateDrawer(),
  abskill: () => skillDrawer(),
  about() {
    const v = bundle.vendor;
    return `<p>Every number comes from <b>unmodified upstream files</b>, run in your browser by Pyodide. CI fails if they drift.</p>
      <table>${Object.entries(v.files).map(([k, f]) => `<tr><td><code>${esc(k)}</code></td><td class="mut">${esc(f.repo)}</td><td class="mut">${f.sha256.slice(0, 10)}</td></tr>`).join("")}</table>
      <p class="mut">upstream: ${Object.entries(v.upstream_commits).map(([k, c]) => `${k} <code>${esc(c.slice(0, 10))}</code>`).join(", ")}</p>
      <div class="note"><b>Not real here:</b> model answers. Gate demos use fixtures you set by hand; the skill A/B is a text-coverage proxy. Behaviour needs recorded model runs, which this site never makes.</div>`;
  },
};

// ---------------- drawer actions
function bindDrawer() {
  const d = $("drawer");
  d.onclick = (e) => { const a = e.target.closest("[data-act]")?.dataset.act; if (a) guard(() => ACT[a]?.(e.target.closest("[data-act]"))); const c = e.target.closest("[data-gc]"); if (c) gateCell(c.dataset); const l = e.target.closest("[data-hit]"); if (l) { S.sel = l.dataset.hit; paintOverlay(); drawer(); } };
  d.oninput = (e) => { if (e.target.dataset.gp) gateParam(e.target); if (e.target.id === "gpa") gateGrade(); if (e.target.id === "gpg") { S.gate.pg = +e.target.value; drawer(); } };
  d.onchange = (e) => { if (e.target.id === "gpg") { S.gate.pg = +e.target.value; drawer(); } };
  d.onkeydown = (e) => { if (e.key === "Enter" && e.target.id === "qin") ACT.search(); };
}
const addQ = (y) => { S.questions = S.questions.trimEnd() + "\n" + y + "\n"; refresh(); renderGraph(); drawer(); const bad = S.results.at(-1); S.sel = "eval:" + bad.id; paintOverlay(); flash([S.sel]); replay(bad.id); };
const ACT = {
  save() { S.files[S.sel] = $("fbody").value; refresh(); renderGraph(); toast("saved to this tab", ""); drawer(); },
  reset() { S.files = structuredClone(bundle.brain); S.questions = bundle.questions; S.sel = null; S.whatif = null; S.preview = null; S.ov = {}; refresh(); renderGraph(); drawer(); },
  search() {
    const q = $("qin").value; const r = call("search", { files: S.files, query: q });
    S.ov = { ranks: Object.fromEntries(r.map((x) => [x.path, x.rank]).filter(([, rk], i, a) => true)), hits: r.length ? r.map((x) => `<div class="li" data-hit="${esc(x.path)}"><span class="pill">#${x.rank}</span><span><b>${esc(x.path)}</b>:${x.line}<br><span class="mut">${esc(clip(x.text, 110))}</span></span></div>`).join("") : '<div class="mut">no matches</div>' };
    const first = {}; for (const x of r) first[x.path] ??= x.rank; S.ov.ranks = first; paintOverlay(); drawer(); $("qin").value = q;
  },
  runall() { refresh(); renderGraph(); drawer(); toast(S.summary.ok ? "all must evals pass" : "some evals fail", S.summary.ok ? "pass" : "fail"); },
  bad1: () => addQ("- id: bad-expect\n  q: A wrong expectation\n  run: {search: order_date UTC}\n  expect: [this-string-is-not-in-the-brain]\n  tier: must"),
  bad2: () => addQ("- id: bad-first-line\n  q: Wrong top result\n  run: {search: order_date UTC}\n  expect: [UTC]\n  first_line: pii-hashed\n  tier: must"),
  bad3: () => addQ("- id: bad-forbid\n  q: Forbidden string present\n  run: {search: order_date UTC}\n  forbid: [orders.created_at]\n  tier: must"),
  qreset() { S.questions = bundle.questions; refresh(); renderGraph(); drawer(); },
  applyqs() { S.questions = $("qs").value; refresh(); renderGraph(); drawer(); },
  break() {
    const m = { op: $("mop").value, path: S.sel, text: $("mtext").value, with: $("mwith").value };
    const r = call("mutate", { files: S.files, questions: S.questions, mutation: m });
    S.whatif = { results: r.after, broken: S.sel, res: r }; S.explain = call("explain", { files: S.files, questions: S.questions, mutation: m }); renderGraph(); drawer();
    setTimeout(() => flash(r.killed_by.map((i) => "eval:" + i)), 120); toast(r.survived ? "SURVIVED: no eval noticed" : "KILLED by " + r.killed_by.length + " eval(s)", r.survived ? "warn" : "pass");
  },
  exp(t) { const row = S.mut.rows[+t.dataset.i]; S.sel = row.mutation.path; S.explain = call("explain", { files: S.files, questions: S.questions, mutation: row.mutation }); paintOverlay(); drawer(); $("drawer").querySelector(".card")?.scrollIntoView({ block: "nearest" }); },
  applyfix() {
    const q = S.explain.fix.yaml; S.questions = S.questions.trimEnd() + "\n" + q.replace(/^- /, "- ") + "\n"; S.explain = null; refresh(); renderGraph();
    const r = call("auto_mutants", { files: S.files, questions: S.questions }); S.mut = { i: r.total, total: r.total, killed: r.killed, rows: r.mutants.slice().reverse(), done: true, score: r.score };
    drawer(); toast(`added the eval · mutation score ${r.killed}/${r.total}`, "pass");
  },
  restore() { S.whatif = null; S.explain = null; renderGraph(); drawer(); },
  async auto() {
    S.explain = null;
    const r = call("auto_mutants", { files: S.files, questions: S.questions }); S.whatif = null; renderGraph();
    S.mut = { i: 0, total: r.total, killed: 0, rows: [], done: false, score: r.score }; const tok = ++S.replayTok; drawer();
    const step = r.total > 25 ? 70 : 130;
    for (const row of r.mutants) {
      if (tok !== S.replayTok) return; S.mut.i++; S.mut.rows.unshift(row); if (row.killed_by.length) S.mut.killed++;
      S.sel = row.mutation.path; paintOverlay(); if (row.killed_by.length) flash(row.killed_by.map((i) => "eval:" + i));
      $("mring") && ($("mring").style.width = (S.mut.i / S.mut.total) * 100 + "%"); drawer(); await sleep(step);
    }
    S.mut.done = true; drawer(); toast(`mutation score ${r.killed}/${r.total}`, r.score >= 0.8 ? "pass" : "warn");
  },
  hijack() { S.ab = { path: "facts/aaa-hijack.md", text: "---\ntitle: late rollups final\ntags: [late, rollups, final]\n---\nlate rollups final\n", own: "late rollups final" }; drawer(); },
  abfact() {
    S.ab = { path: $("fpath").value, text: $("ftext").value, own: $("fown").value };
    const ab = call("ab_fact", { files: S.files, questions: S.questions, path: S.ab.path, text: S.ab.text, own_query: S.ab.own });
    const merged = { ...S.files, [S.ab.path]: S.ab.text };
    const res = call("run_evals", { files: merged, questions: S.questions }).results;
    S.preview = { path: S.ab.path, docs: call("explore", { files: merged }), results: res, ab }; S.sel = null; renderGraph(); drawer();
    setTimeout(() => flash(ab.broke.map((i) => "eval:" + i)), 150); toast(ab.verdict, ab.verdict === "FIT" ? "pass" : "fail");
  },
  abdiscard() { S.preview = null; renderGraph(); drawer(); },
  commit() { S.files[S.preview.path] = S.ab.text; S.preview = null; refresh(); renderGraph(); drawer(); toast("added to this tab's map", "pass"); },
  // gate
  preset(t) { applyPreset(t.dataset.k); }, dumb() { const p = S.gate.probes[S.gate.pg]; $("gpa").value = call("trivial_pass", { probe: p }); gateGrade(); },
  // skill
  sfill() { S.skill.text = "---\nname: filler\ndescription: Use when you need filler text.\n---\nLorem ipsum dolor sit amet.\n"; drawer(); },
  sbad() { S.skill.text = "---\nname: Bad Name\n---\nmentions ~/.agents/brain\n"; drawer(); },
  sgo() { S.skill.text = $("stext").value; S.skill.name = $("sk").value; S.skill.dir = $("sdir").value; S.skill.rate = +$("srate").value; runSkill(); },
  sload() { S.skill.name = $("sk").value; S.skill.dir = S.skill.name; S.skill.text = bundle.skills[S.skill.name]; S.skill.res = null; renderSkill(); drawer(); },
};

// ---------------- gate scene
const PRESETS = {
  "Skill clearly helps": (p) => p.map(() => [[0, 0, 0], [1, 1, 1]]),
  "No effect": (p) => p.map(() => [[0, 0, 0], [0, 0, 0]]),
  "Already good (ceiling)": (p) => p.map(() => [[1, 1, 1], [1, 1, 1]]),
  "Helps dev, hurts one": (p) => p.map((x, i) => (i === 0 ? [[1, 1, 1], [0, 0, 0]] : [[0, 0, 0], [1, 1, 1]])),
};
function initGate() {
  const probes = bundle.probes.filter((p) => ["dst", "doubt"].includes(p.skill)).slice(0, 8);
  S.gate = { probes, params: { min_gain: 2, ceiling: 0.9, regress_by: 2, max_cost_ratio: 1.5, _cand_cost: 0.01 }, grid: {}, pg: 0, res: null };
  const h = HASH0.match(/g=([^&]+)/);
  if (h) { try { const d = decodeGate(decodeURIComponent(h[1])); S.gate.params = { ...S.gate.params, ...d.params }; S.gate.grid = d.grid; } catch { /* ignore bad link */ } }
  if (!Object.keys(S.gate.grid).length) applyPreset("Skill clearly helps", true);
  computeGate();
}
function applyPreset(k, quiet) { const v = PRESETS[k](S.gate.probes); S.gate.grid = {}; S.gate.probes.forEach((p, i) => (S.gate.grid[p.id] = { without: v[i][0].map(Boolean), with: v[i][1].map(Boolean) })); if (!quiet) { computeGate(); renderScene(); drawer(); } }
function computeGate() { S.gate.res = call("gate", { probes: S.gate.probes, grid: S.gate.grid, params: S.gate.params, samples: 3 }); if (S.mode === "gate") history.replaceState(null, "", `#m=gate&g=${encodeURIComponent(encodeGate(S.gate.grid, S.gate.params))}`); }
function gateCell(d) { const c = S.gate.grid[d.p][d.a]; c[+d.i] = !c[+d.i]; computeGate(); renderScene(); drawer(); }
function gateParam(i) { const v = +i.value; if (!isNaN(v) && i.value !== "") { S.gate.params[i.dataset.gp] = v; computeGate(); renderScene(); const keep = i.dataset.gp; $("drawer").querySelector(`[data-gp=${keep}]`)?.setAttribute("value", v); } }
function gateGrade() { const g = call("grade", { probe: S.gate.probes[S.gate.pg], text: $("gpa").value }); $("gpr").innerHTML = `<span class="${g.correct ? "ok" : "bad"}">${g.correct ? "correct" : "incorrect"}</span> <span class="mut">missing ${esc(JSON.stringify(g.missing))}</span>`; }
function gateDrawer() {
  const G = S.gate, g = G.res, p = G.probes[G.pg];
  return `<div class="row">${Object.keys(PRESETS).map((k) => `<button class="btn alt" data-act="preset" data-k="${esc(k)}">${esc(k)}</button>`).join("")}</div>
    <h3>outcomes (3 samples each, click to flip)</h3><table><tr><th>probe</th><th>without</th><th>with</th></tr>${G.probes.map((q) => `<tr><td title="${esc(q.id)}">${esc(clip(q.id, 20))} <span class="mut">${q.split || "dev"}</span></td>` + ["without", "with"].map((a) => `<td>${G.grid[q.id][a].map((b, i) => `<span class="cell ${b ? "t" : "f"}" data-gc data-p="${esc(q.id)}" data-a="${a}" data-i="${i}">${b ? "✔" : "✘"}</span>`).join("")}</td>`).join("") + "</tr>").join("")}</table>
    <h3>thresholds</h3><div class="row">${Object.entries(G.params).map(([k, v]) => `<label class="mut">${k}<input data-gp="${k}" value="${v}" style="width:76px"></label>`).join("")}</div>
    <h3>verdict</h3><div class="big ${g.verdict === "ADOPT" ? "ok" : "bad"}">${g.verdict}</div><div class="mut">${esc(g.reason)}</div>
    <h3>probe grader</h3><div class="row"><select id="gpg">${G.probes.map((q, i) => `<option value="${i}" ${i === G.pg ? "selected" : ""}>${esc(q.id)}</option>`).join("")}</select></div>
    <pre>${esc(p.q)}\n\nexpect (every group, any inside): ${esc(JSON.stringify(p.expect))}</pre><textarea id="gpa" style="min-height:60px" placeholder="type an answer"></textarea>
    <div class="row"><button class="btn alt" data-act="dumb">fill the dumbest passing answer</button><span id="gpr"></span></div>`;
}
function renderTree(parent, x, y, w, steps, o = {}) {
  const gap = o.gap ?? 22, h = o.h ?? 62;
  steps.forEach((s, i) => {
    const yy = y + i * (h + gap);
    if (i) parent.append(el("line", { class: `link ${steps[i - 1].state !== "unreached" && s.state !== "unreached" ? "live" : ""}`, x1: x + 26, x2: x + 26, y1: yy - gap, y2: yy }));
    const good = s.verdict === "ADOPT";
    const g = el("g", { class: `step ${s.state} ${s.state === "fired" ? (good ? "good" : "bad") : ""}`, transform: `translate(${x} ${yy})`, "data-step": s.verdict }, [
      el("rect", { width: w, height: h, rx: 10 }),
      el("text", { class: "tag", x: 14, y: 20, fill: s.state === "fired" ? (good ? "var(--pass)" : "var(--fail)") : "var(--muted)", style: `fill:${s.state === "fired" ? (good ? "var(--pass)" : "var(--fail)") : "var(--muted)"}` }, `${i + 1} · ${s.verdict}`),
      el("text", { class: "q", x: 14, y: 38 }, clip(s.question, Math.floor(w / 7.4))),
      el("text", { class: "d", x: 14, y: 54 }, clip(s.detail, Math.floor(w / 6.2))),
      el("text", { x: w - 14, y: 20, "text-anchor": "end", class: "tag", style: `fill:${s.state === "fired" ? (good ? "var(--pass)" : "var(--fail)") : "var(--dim)"}` }, s.state === "fired" ? (good ? "→ ADOPT" : `→ stop: ${s.verdict}`) : s.state === "no" ? "no, continue" : ""),
    ]);
    parent.append(g);
  });
  return y + steps.length * (h + gap);
}
function renderGate() {
  const root = vp(); root.replaceChildren(); S.ref = { nodes: new Map(), edges: [] };
  const g = S.gate.res, f = g.facts || {};
  root.append(el("text", { class: "col", x: 30, y: 30 }, "gate.decide, rules in the order they are checked"));
  const inbox = el("g", { class: "step no", transform: "translate(30 50)" }, [el("rect", { width: 640, height: 54, rx: 10 }), el("text", { class: "q", x: 14, y: 22 }, `dev correct: without ${f.dev_without ?? "?"}/${f.dev_n ?? "?"} → with ${f.dev_with ?? "?"}/${f.dev_n ?? "?"}`), el("text", { class: "d", x: 14, y: 40 }, `heldout ${f.heldout_without ?? "?"}→${f.heldout_with ?? "?"} · cost ×${f.cost_ratio ?? "?"} · same inputs always give the same verdict`)]);
  root.append(inbox, el("line", { class: "link live", x1: 56, x2: 56, y1: 104, y2: 126 }));
  const bottom = renderTree(root, 30, 126, 640, gateSteps(g));
  root.append(el("text", { class: "col", x: 30, y: bottom + 18, style: "fill:var(--muted)" }, g.verdict === "BAD_INPUT" ? g.reason : ""));
  fit(700, bottom + 40);
}
// ---------------- skill scene
function initSkill() { const n = Object.keys(bundle.skills)[0]; S.skill = { name: n, dir: n, text: bundle.skills[n], rate: 0, res: null }; }
function runSkill() {
  const ps = bundle.probes.filter((p) => p.skill === S.skill.name);
  S.skill.probes = ps;
  S.skill.res = call("ab_skill", { text: S.skill.text, probes: ps, rates: Object.fromEntries(ps.map((p) => [p.id, S.skill.rate])), samples: 3 });
  S.skill.lint = S.skill.res.lint; renderSkill(); drawer(); toast(S.skill.res.gate.verdict, S.skill.res.gate.verdict === "ADOPT" ? "pass" : "fail");
}
function renderSkill() {
  const root = vp(); root.replaceChildren(); S.ref = { nodes: new Map(), edges: [] };
  const r = S.skill.res; const ps = bundle.probes.filter((p) => p.skill === S.skill.name);
  root.append(el("text", { class: "col", x: 30, y: 30 }, "skill"), el("text", { class: "col", x: 330, y: 30 }, "probes: does the skill text hold the answer?"), el("text", { class: "col", x: 700, y: 30 }, "the real gate"));
  const sk = nodeEl({ id: "skill", kind: "skill", title: S.skill.dir || "skill", path: `${(S.skill.text || "").length} chars`, tier: "" }, { x: 30, y: 50, w: 250, h: 38 });
  sk.querySelector(".s").textContent = `${(S.skill.text || "").length} chars`; root.append(sk);
  ps.forEach((p, i) => {
    const cov = r?.coverage.find((c) => c.probe === p.id);
    const n = nodeEl({ id: "p:" + p.id, kind: "eval", title: p.id, query: "", tier: p.split || "dev", pass: cov ? cov.covered : true }, { x: 330, y: 50 + i * 50, w: 330, h: 38 });
    n.querySelector(".s").textContent = cov ? (cov.covered ? "text contains every expected group" : "missing " + clip(JSON.stringify(cov.missing), 40)) : "run the A/B to check coverage";
    if (!cov) { n.classList.remove("pass", "fail"); }
    n.addEventListener("click", () => toast(p.q, ""));
    root.append(n);
    if (cov) { const a = { x: 280, y: 69 }, b = { x: 330, y: 69 + i * 50 }; root.insertBefore(el("path", { class: `edge ${cov.covered ? "hot" : "bad"}`, d: `M${a.x} ${a.y} C305 ${a.y},305 ${b.y},${b.x} ${b.y}` }), root.firstChild); }
  });
  const steps = r ? gateSteps(r.gate) : [];
  if (r) renderTree(root, 700, 50, 380, steps, { h: 58, gap: 18 }); else root.append(el("text", { class: "gaptxt", x: 700, y: 70 }, "choose a skill and press A/B"));
  fit(1110, Math.max(50 + ps.length * 50, 50 + 6 * 76) + 40);
}
function skillDrawer() {
  const k = S.skill, r = k.res;
  let h = `<div class="row"><select id="sk">${Object.keys(bundle.skills).map((n) => `<option ${n === k.name ? "selected" : ""}>${esc(n)}</option>`).join("")}</select><button class="btn alt" data-act="sload">load</button></div>
    <input id="sdir" type="hidden" value="${esc(k.dir)}"><textarea id="stext" style="min-height:200px">${esc(k.text)}</textarea>
    <div class="row"><label class="mut">baseline pass rate without the skill <input id="srate" type="range" min="0" max="1" step="0.33" value="${k.rate}" style="width:110px"></label></div>
    <button class="btn" data-act="sgo">A/B this skill</button><button class="btn alt" data-act="sfill">filler skill</button><button class="btn alt" data-act="sbad">bad skill</button>`;
  if (r) h += `<h3>verdict</h3><div class="big ${r.gate.verdict === "ADOPT" ? "ok" : "bad"}">${r.gate.verdict}</div><div class="mut">${esc(r.gate.reason)}</div>
    <h3>lint (real check_skills)</h3>${r.lint.errors.length ? r.lint.errors.map((e) => `<div class="bad">${esc(e)}</div>`).join("") : '<div class="ok">clean</div>'}
    <div class="note">${esc(r.caveat)}</div>`;
  return h;
}
function renderAbout() {
  const root = vp(); root.replaceChildren(); S.ref = { nodes: new Map(), edges: [] };
  const v = bundle.vendor, entries = Object.entries(v.files);
  root.append(el("text", { class: "col", x: 30, y: 30 }, "vendored upstream files (byte-identical)"), el("text", { class: "col", x: 560, y: 30 }, "runs here, in your browser"));
  entries.forEach(([k, f], i) => { const n = nodeEl({ id: k, kind: f.repo === "map" ? "fact" : "skill", title: k, path: `${f.repo} · sha256 ${f.sha256.slice(0, 10)}`, tier: "" }, { x: 30, y: 50 + i * 50, w: 300, h: 38 }); root.append(n);
    root.insertBefore(el("path", { class: "edge hot", d: `M330 ${69 + i * 50} C445 ${69 + i * 50},445 ${50 + entries.length * 25 + 10},560 ${50 + entries.length * 25 + 10}` }), root.firstChild); });
  const mid = 50 + entries.length * 25 - 9;
  root.append(nodeEl({ id: "py", kind: "eval", title: "Pyodide (WebAssembly Python)", path: "no server · no model · no secrets", tier: "" }, { x: 560, y: mid, w: 300, h: 38 }));
  fit(900, 50 + entries.length * 50);
}
// ---------------- scene switch
function renderScene() {
  const sc = MODES.find((m) => m[0] === S.mode)[2];
  const leg = { "scene-graph": [["fact", "fact"], ["workstream", "workstream"], ["decision", "decision"], ["catalog", "catalog"], ["pass", "pass"], ["fail", "fail"]], "scene-gate": [["pass", "ADOPT"], ["fail", "stop"], ["dim", "not reached"]], "scene-skill": [["skill", "skill"], ["pass", "covered"], ["fail", "not covered"]], "scene-about": [["fact", "knowledge map"], ["skill", "toolkit"]] }[sc];
  $("hud").innerHTML = leg.map(([c, t]) => `<span><i style="background:var(--${c})"></i>${t}</span>`).join("");
  if (sc === "scene-graph") renderGraph(); else if (sc === "scene-gate") renderGate(); else if (sc === "scene-skill") renderSkill(); else renderAbout();
}
function setMode(m, fromHash) {
  S.mode = m; S.explain = null; S.replayTok++; if (m === "gate") computeGate(); S.ov = {}; S.sel = m === "break" || m === "evals" ? S.sel : S.sel; S.whatif = null; if (m !== "abfact") S.preview = null;
  document.querySelectorAll("#tools button").forEach((b) => b.classList.toggle("on", b.dataset.m === m));
  $("sub").textContent = MODES.find((x) => x[0] === m)[3];
  if (!fromHash && m !== "gate") history.replaceState(null, "", `#m=${m}`);
  if (m === "abskill" && !S.skill.res) { try { runSkill(); return; } catch (e) { console.error(e); } }
  renderScene(); drawer();
}

// ---------------- palette
const pal = { sel: 0, items: [] };
function palItems(q) {
  const t = q.toLowerCase();
  const all = [...MODES.map(([m, n]) => ({ k: "mode", label: n, sub: "go to mode", run: () => setMode(m) })),
    ...S.docs.filter((d) => FILE_KINDS.includes(d.kind)).map((d) => ({ k: "file", label: d.title, sub: d.path, run: () => { if (!["explore", "break", "abfact"].includes(S.mode)) setMode("explore"); S.sel = d.path; paintOverlay(); drawer(); } })),
    ...S.results.map((r) => ({ k: "eval", label: r.id, sub: r.q, run: () => { setMode("evals"); S.sel = "eval:" + r.id; replay(r.id); } }))];
  const f = t ? all.filter((i) => (i.label + " " + i.sub).toLowerCase().includes(t)) : all.slice(0, 12);
  if (t) f.push({ k: "search", label: `search the brain for “${q}”`, sub: "real ranking", run: () => { setMode("explore"); $("qin").value = q; ACT.search(); } });
  return f.slice(0, 14);
}
function palRender() { $("palist").innerHTML = pal.items.map((i, n) => `<div class="li ${n === pal.sel ? "sel" : ""}" data-n="${n}"><span class="pill">${i.k}</span><span><b>${esc(i.label)}</b> <span class="mut">${esc(clip(i.sub, 50))}</span></span></div>`).join(""); }
function palOpen() { $("pal").classList.add("on"); $("pin").value = ""; pal.sel = 0; pal.items = palItems(""); palRender(); $("pin").focus(); }
function palClose() { $("pal").classList.remove("on"); }
function palPick(n) { const it = pal.items[n]; palClose(); it?.run(); }

// ---------------- wiring
function wire() {
  $("tools").innerHTML = MODES.map(([m, n]) => `<button data-m="${m}" data-tip="${n}" aria-label="${n}"><svg viewBox="0 0 24 24">${ICON[m]}</svg></button>`).join("");
  $("tools").onclick = (e) => { const m = e.target.closest("button")?.dataset.m; if (m) setMode(m); };
  $("find").onclick = palOpen;
  $("pin").oninput = () => { pal.items = palItems($("pin").value); pal.sel = 0; palRender(); };
  $("pin").onkeydown = (e) => { if (e.key === "ArrowDown") pal.sel = Math.min(pal.sel + 1, pal.items.length - 1); else if (e.key === "ArrowUp") pal.sel = Math.max(pal.sel - 1, 0); else if (e.key === "Enter") return palPick(pal.sel); else if (e.key === "Escape") return palClose(); else return; e.preventDefault(); palRender(); };
  $("palist").onclick = (e) => { const n = e.target.closest("[data-n]")?.dataset.n; if (n != null) palPick(+n); };
  $("pal").onclick = (e) => { if (e.target.id === "pal") palClose(); };
  addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palOpen(); } else if (e.key === "Escape" && !$("pal").classList.contains("on")) { S.sel = null; S.ov = {}; paintOverlay(); drawer(); } });
  $("theme").onclick = () => { const l = document.documentElement.dataset.theme === "dark"; document.documentElement.dataset.theme = l ? "light" : "dark"; $("theme").textContent = l ? "dark" : "light"; };
  $("share").onclick = async () => { try { await navigator.clipboard.writeText(location.href); toast("link copied", "pass"); } catch { toast(location.href, ""); } };
  const svg = $("svg"); let drag = null;
  svg.addEventListener("pointerdown", (e) => { if (e.target.closest(".node,.step")) return; drag = { x: e.clientX - S.view.x, y: e.clientY - S.view.y }; svg.classList.add("drag"); svg.setPointerCapture(e.pointerId); });
  svg.addEventListener("pointermove", (e) => { if (drag) { S.view.x = e.clientX - drag.x; S.view.y = e.clientY - drag.y; applyView(); } });
  svg.addEventListener("pointerup", () => { drag = null; svg.classList.remove("drag"); });
  svg.addEventListener("click", (e) => { if (!e.target.closest(".node") && S.sel) { S.sel = null; paintOverlay(); drawer(); } });
  const zoom = (f, cx, cy) => { const r = svg.getBoundingClientRect(); cx ??= r.width / 2; cy ??= r.height / 2; const k = Math.min(3, Math.max(0.3, S.view.k * f)); S.view.x = cx - ((cx - S.view.x) / S.view.k) * k; S.view.y = cy - ((cy - S.view.y) / S.view.k) * k; S.view.k = k; applyView(); };
  svg.addEventListener("wheel", (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  $("zin").onclick = () => zoom(1.2); $("zout").onclick = () => zoom(1 / 1.2); $("zfit").onclick = () => S.size && fit(...S.size);
  addEventListener("resize", () => S.size && fit(...S.size));
}

async function boot() {
  bundle = await (await fetch("bundle.json")).json();
  const s = document.createElement("script"); s.src = PYODIDE + "pyodide.js";
  await new Promise((ok, no) => { s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  lab = await bootLab(window.loadPyodide, bundle, { indexURL: PYODIDE });
  S.files = structuredClone(bundle.brain); S.questions = bundle.questions;
  refresh(); initGate(); initSkill(); wire();
  const m = HASH0.match(/m=(\w+)/)?.[1]; const start = HASH0.includes("g=") ? "gate" : MODES.some((x) => x[0] === m) ? m : "explore";
  $("boot").remove(); setMode(start, true);
  window.__lab = { call: lab.call, ready: true, S };
}
boot().catch((e) => { $("boot").innerHTML = `<span class="bad">Failed to start: ${esc(e.message)}</span>`; console.error(e); });
