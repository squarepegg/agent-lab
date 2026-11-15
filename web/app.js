import { bootLab } from "./lab.js";
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let lab, bundle, files, questions, probes, cur;

// ---- boot
async function boot() {
  bundle = await (await fetch("bundle.json")).json();
  const s = document.createElement("script"); s.src = PYODIDE + "pyodide.js";
  await new Promise((ok, no) => { s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  lab = await bootLab(window.loadPyodide, bundle, { indexURL: PYODIDE });
  resetAll(); $("boot").remove(); document.querySelector("section").classList.add("on");
  window.__lab = { call: lab.call, ready: true };
}
function resetAll() {
  files = structuredClone(bundle.brain); questions = bundle.questions; probes = lab.call("parse_yaml", { text: bundle.probes });
  $("qs").value = questions; cur = null; renderFiles(); fillSelects(); initGate(); renderAbout();
}
const call = (n, a) => { const r = lab.call(n, a); if (r && r.error) throw new Error(r.error); return r; };
const safe = (el, fn) => { try { fn(); } catch (e) { el.innerHTML = `<div class="bad">${esc(e.message)}</div>`; } };

// ---- nav
$("nav").onclick = (e) => { const t = e.target.dataset.t; if (!t) return;
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("on", b === e.target));
  document.querySelectorAll("section").forEach((s) => s.classList.toggle("on", s.id === t)); };

// ---- 1 map
function renderFiles() {
  const nodes = call("explore", { files }); const by = {};
  nodes.forEach((n) => (by[n.kind] ??= []).push(n));
  $("files").innerHTML = Object.entries(by).map(([k, ns]) => `<div class="mut">${k}</div>` + ns.map((n) =>
    `<div data-p="${esc(n.path)}">${esc(n.title)} <span class="mut">${esc(n.path)} · ${n.bytes}B</span></div>`).join("")).join("");
}
$("files").onclick = (e) => { const p = e.target.closest("[data-p]")?.dataset.p; if (p) openFile(p); };
function openFile(p) { cur = p; $("fname").textContent = p; $("fbody").value = files[p];
  const fm = call("explore", { files }).find((n) => n.path === p)?.frontmatter || {};
  $("fmeta").textContent = Object.keys(fm).length ? "frontmatter: " + Object.keys(fm).join(", ") : ""; }
$("fsave").onclick = () => { if (cur) { files[cur] = $("fbody").value; renderFiles(); fillSelects(); } };
$("freset").onclick = resetAll;
$("qgo").onclick = $("q").onkeydown = (e) => { if (e.type === "keydown" && e.key !== "Enter") return;
  safe($("qres"), () => { const r = call("search", { files, query: $("q").value });
    $("qres").innerHTML = r.length ? r.map((x) => `<div data-p="${esc(x.path)}"><span class="pill">#${x.rank}</span><b>${esc(x.path)}</b>:${x.line}<br><span class="mut">${esc(x.text)}</span></div>`).join("") : '<span class="mut">no matches</span>'; }); };
$("qres").onclick = (e) => { const p = e.target.closest("[data-p]")?.dataset.p; if (p) openFile(p); };

// ---- 2 evals
function renderEvals(res, el = $("evres"), sum = $("evsum")) {
  const s = res.summary;
  sum.className = "verdict " + (s.ok ? "ok" : "bad"); sum.textContent = `${s.ok ? "PASS" : "FAIL"} · must ${s.must_pass}/${s.must_total}` + (s.coverage_total ? ` · coverage ${s.coverage_pass}/${s.coverage_total}` : "") + (s.skipped ? ` · skipped ${s.skipped}` : "");
  el.innerHTML = res.results.map((r) => `<details ${r.pass ? "" : "open"}><summary><span class="${r.pass ? "ok" : "bad"}">${r.tier === "skip" ? "SKIP" : r.pass ? "PASS" : "FAIL"}</span> <b>${esc(r.id)}</b> <span class="mut">[${r.tier}] ${esc(r.q)}</span></summary>
    ${r.error ? `<div class="warn">${esc(r.error)}</div>` : ""}<div class="mut">lookup: <code>search "${esc(r.query)}"</code></div>
    ${r.checks.map((c) => `<div class="${c.ok ? "ok" : "bad"}">${c.ok ? "✔" : "✘"} ${c.kind} <code>${esc(c.value)}</code>${c.kind === "first_line" && !c.ok ? ` <span class="mut">top line was: ${esc(c.got)}</span>` : ""}</div>`).join("")}
    <pre>${esc(r.output || "(no output)")}</pre></details>`).join("");
}
$("runev").onclick = () => safe($("evres"), () => renderEvals(call("run_evals", { files, questions: $("qs").value })));
const addQ = (y) => { $("qs").value += "\n" + y; $("runev").click(); };
$("addbad").onclick = () => addQ("- id: bad-expect\n  q: A wrong expectation\n  run: {search: order_date UTC}\n  expect: [this-string-is-not-in-the-brain]\n  tier: must");
$("addbad2").onclick = () => addQ("- id: bad-first-line\n  q: Wrong top result\n  run: {search: order_date UTC}\n  expect: [UTC]\n  first_line: pii-hashed\n  tier: must");
$("addbad3").onclick = () => addQ("- id: bad-forbid\n  q: Forbidden string present\n  run: {search: order_date UTC}\n  forbid: [orders.created_at]\n  tier: must");
$("qsreset").onclick = () => { $("qs").value = bundle.questions; };

// ---- 3 break
function fillSelects() { const ps = Object.keys(files).filter((p) => p.endsWith(".md")).sort();
  $("mpath").innerHTML = ps.map((p) => `<option>${esc(p)}</option>`).join(""); }
$("mgo").onclick = () => safe($("mout"), () => {
  const r = call("mutate", { files, questions: $("qs").value, mutation: { op: $("mop").value, path: $("mpath").value, text: $("mtext").value, with: $("mwith").value } });
  $("mout").innerHTML = `<div class="verdict ${r.survived ? "warn" : "ok"}">${r.survived ? "SURVIVED: no eval noticed" : "KILLED by " + r.killed_by.join(", ")}</div>
   <div class="mut">${r.survived ? "A blind spot: this knowledge can be wrong and every eval still passes." : "The evals caught the break."}</div>` +
   r.after.filter((x) => !x.pass && x.tier !== "skip").map((x) => `<div class="bad">✘ ${esc(x.id)} ${x.checks.filter((c) => !c.ok).map((c) => esc(c.kind + " " + c.value)).join("; ")}</div>`).join(""); });
$("mauto").onclick = () => safe($("mout"), () => {
  const r = call("auto_mutants", { files, questions: $("qs").value });
  $("mout").innerHTML = `<div class="verdict ${r.score >= 0.8 ? "ok" : "warn"}">mutation score ${r.killed}/${r.total} (${Math.round((r.score ?? 0) * 100)}%)</div>
   <table>${r.mutants.map((m) => `<tr><td class="${m.killed_by.length ? "ok" : "bad"}">${m.killed_by.length ? "killed" : "SURVIVED"}</td><td>${esc(m.mutation.op)} <code>${esc(m.mutation.path)}</code> ${m.mutation.text ? "<code>" + esc(m.mutation.text) + "</code>" : ""}</td><td class="mut">${esc(m.killed_by.join(", "))}</td></tr>`).join("")}</table>`; });

// ---- 4 gate
let grid, params, pr, SAMPLES = 3;
const PRESETS = {
  "Skill clearly helps": (p) => p.map(() => [[0, 0, 0], [1, 1, 1]]),
  "No effect": (p) => p.map(() => [[0, 0, 0], [0, 0, 0]]),
  "Baseline already good (ceiling)": (p) => p.map(() => [[1, 1, 1], [1, 1, 1]]),
  "Helps dev, hurts one probe": (p) => p.map((x, i) => i === 0 ? [[1, 1, 1], [0, 0, 0]] : [[0, 0, 0], [1, 1, 1]]),
};
function initGate() {
  pr = probes.slice(0, 8); params = { min_gain: 2, ceiling: 0.9, regress_by: 2, max_cost_ratio: 1.5, _cand_cost: 0.01 };
  $("presets").innerHTML = Object.keys(PRESETS).map((k) => `<button class="b alt" data-k="${esc(k)}">${esc(k)}</button>`).join("");
  $("params").innerHTML = Object.entries(params).map(([k, v]) => `<label class="mut">${k} <input data-p="${k}" value="${v}" style="width:70px"></label>`).join(" ");
  $("pg").innerHTML = probes.map((p, i) => `<option value="${i}">${esc(p.id)} (${p.split || "dev"})</option>`).join("");
  applyPreset("Skill clearly helps"); showProbe();
}
function applyPreset(k) { const v = PRESETS[k](pr); grid = {}; pr.forEach((p, i) => (grid[p.id] = { baseline: v[i][0].map(Boolean), candidate: v[i][1].map(Boolean) })); renderGate(); }
function renderGate() {
  $("grid").innerHTML = `<tr><th>probe</th><th>split</th><th>baseline</th><th>candidate</th></tr>` + pr.map((p) => `<tr><td>${esc(p.id)}</td><td class="mut">${p.split || "dev"}</td>` +
    ["baseline", "candidate"].map((a) => `<td>${grid[p.id][a].map((b, i) => `<span class="cell ${b ? "t" : "f"}" data-p="${esc(p.id)}" data-a="${a}" data-i="${i}">${b ? "✔" : "✘"}</span>`).join("")}</td>`).join("") + "</tr>").join("");
  try { const g = call("gate", { probes: pr, grid, params, samples: SAMPLES }); const col = g.verdict === "ADOPT" ? "ok" : g.verdict === "BAD_INPUT" ? "warn" : "bad";
    $("gverdict").className = "verdict " + col; $("gverdict").textContent = g.verdict; $("greason").textContent = g.reason; $("gfacts").textContent = JSON.stringify(g.facts, null, 1);
  } catch (e) { $("gverdict").textContent = "error"; $("greason").textContent = e.message; }
}
$("presets").onclick = (e) => { if (e.target.dataset.k) applyPreset(e.target.dataset.k); };
$("grid").onclick = (e) => { const d = e.target.dataset; if (d.p) { grid[d.p][d.a][+d.i] = !grid[d.p][d.a][+d.i]; renderGate(); } };
$("params").oninput = (e) => { const k = e.target.dataset.p; if (k && !isNaN(+e.target.value)) { params[k] = +e.target.value; renderGate(); } };
function showProbe() { const p = probes[+$("pg").value]; $("pq").textContent = p.q + "\n\nexpect (all groups, any in group): " + JSON.stringify(p.expect || []) + (p.expect_re ? "\nexpect_re: " + JSON.stringify(p.expect_re) : "") + (p.forbid ? "\nforbid: " + JSON.stringify(p.forbid) : ""); gradeNow(); }
function gradeNow() { const g = call("grade", { probe: probes[+$("pg").value], text: $("pa").value }); $("pgrade").innerHTML = `<span class="${g.correct ? "ok" : "bad"}">${g.correct ? "correct" : "incorrect"}</span> <span class="mut">missing ${esc(JSON.stringify(g.missing))} forbidden ${esc(JSON.stringify(g.forbidden))}</span>`; }
$("pg").onchange = showProbe; $("pa").oninput = gradeNow;
$("pdumb").onclick = () => { $("pa").value = call("trivial_pass", { probe: probes[+$("pg").value] }); gradeNow(); };

// ---- 5 A/B
$("fgo").onclick = () => safe($("fres"), () => { const r = call("ab_fact", { files, questions: $("qs").value, path: $("fpath").value, text: $("ftext").value, own_query: $("fown").value });
  const col = r.verdict === "FIT" ? "ok" : "bad";
  $("fres").innerHTML = `<div class="verdict ${col}">${r.verdict}</div><div class="mut">evals must ${r.before.must_pass}/${r.before.must_total} → ${r.after.must_pass}/${r.after.must_total}</div>` +
    (r.broke.length ? `<div class="bad">breaks: ${esc(r.broke.join(", "))}</div>` : "") + r.polluted.map((x) => `<div class="bad">hijacks top result of "${esc(x.id)}" (was ${esc(x.was_first)})</div>`).join("") +
    (r.findable ? `<div>${r.findable.rank ? `found at rank ${r.findable.rank} for "${esc(r.findable.query)}"` : `<span class="bad">not in top 3 for "${esc(r.findable.query)}"</span>`}</div>` : ""); });
$("fhij").onclick = () => { $("fpath").value = "facts/aaa-hijack.md"; $("ftext").value = "---\ntitle: late rollups final\ntags: [late, rollups, final]\n---\nlate rollups final\n"; $("fown").value = "late rollups final"; };
function skillInit() { $("sk").innerHTML = Object.keys(bundle.skills).map((k) => `<option>${esc(k)}</option>`).join(""); $("sk").onchange = () => ($("stext").value = bundle.skills[$("sk").value]); $("sk").onchange();
  const sk = [...new Set(probes.map((p) => p.skill))]; $("sprobe").innerHTML = sk.map((k) => `<option>${esc(k)}</option>`).join(""); }
$("sfill").onclick = () => ($("stext").value = "---\nname: filler\ndescription: Use when you need filler text.\n---\nLorem ipsum dolor sit amet.\n");
$("sgo").onclick = () => safe($("sres"), () => { const ps = probes.filter((p) => p.skill === $("sprobe").value); const rate = +$("srate").value;
  const r = call("ab_skill", { text: $("stext").value, probes: ps, rates: Object.fromEntries(ps.map((p) => [p.id, rate])), samples: SAMPLES });
  const g = r.gate;
  $("sres").innerHTML = `<div class="verdict ${g.verdict === "ADOPT" ? "ok" : "bad"}">${g.verdict}</div><div class="mut">${esc(g.reason)}</div>
   <div>lint: ${r.lint.errors.length ? r.lint.errors.map((e) => `<span class="bad">${esc(e)}</span>`).join("<br>") : '<span class="ok">clean</span>'}${r.lint.missing_refs.length ? ` <span class="mut">(+${r.lint.missing_refs.length} unresolved file refs: expected for a single pasted file)</span>` : ""}</div>
   <table><tr><th>probe</th><th>skill text covers it?</th></tr>${r.coverage.map((c) => `<tr><td>${esc(c.probe)}</td><td class="${c.covered ? "ok" : "bad"}">${c.covered ? "yes" : "no: " + esc(JSON.stringify(c.missing))}${c.forbidden.length ? ` <span class="warn">states forbidden: ${esc(c.forbidden.join(", "))}</span>` : ""}</td></tr>`).join("")}</table>
   <div class="mut">${esc(r.caveat)}</div>`; });

function renderAbout() { const v = bundle.vendor;
  $("aboutbox").innerHTML = `<p>Every number here comes from <b>unmodified upstream files</b> run in your browser by Pyodide: ${Object.entries(v.files).map(([k, f]) => `<code>${esc(k)}</code> (${esc(f.repo)}, sha256 ${f.sha256.slice(0, 10)})`).join(", ")}.</p>
   <p>Upstream commits: ${Object.entries(v.upstream_commits).map(([k, c]) => `${k} <code>${esc(c.slice(0, 10))}</code>`).join(", ")}. CI fails if a vendored file drifts from upstream.</p>
   <p><b>Not real here:</b> model answers. Gate demos use fixtures you set by hand; the skill A/B is a text-coverage proxy. Behaviour needs recorded model runs, which this site never makes.</p>`; }

boot().then(skillInit).catch((e) => { $("boot").innerHTML = `<span class="bad">Failed to start: ${esc(e.message)}</span>`; });
