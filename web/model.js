// Pure helpers behind the canvas: no DOM, unit-tested in tests_js/model.test.mjs.
export const GATE_ORDER = ["INCONCLUSIVE", "REGRESSION", "CEILING", "NO_DELTA", "TOO_COSTLY", "ADOPT"];
export const FILE_KINDS = ["fact", "workstream", "decision", "catalog"];

/** "path:line: text" lines from brain.search -> unique paths in rank order */
export function parseHits(output) {
  const seen = [];
  for (const l of String(output || "").split("\n")) {
    const m = l.match(/^(.+?):(\d+): /);
    if (m && !seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

/** explore() nodes + run_evals results -> {files, evals, edges}. edges: eval -> file, rank 1 = top hit. */
export function buildGraph(docs, results) {
  const files = docs.filter((d) => FILE_KINDS.includes(d.kind)).map((d) => ({ id: d.path, kind: d.kind, title: d.title, path: d.path }));
  const ids = new Set(files.map((f) => f.id));
  const evals = results.map((r) => ({ id: "eval:" + r.id, evalId: r.id, kind: "eval", title: r.id, q: r.q, tier: r.tier, pass: r.pass, query: r.query }));
  const edges = [];
  for (const r of results) {
    parseHits(r.output).filter((p) => ids.has(p)).forEach((p, i) => edges.push({ from: "eval:" + r.id, to: p, rank: i + 1 }));
  }
  return { files, evals, edges };
}

/** Deterministic two-column layout. Files are ordered by the mean position of the evals that hit them, so edges rarely cross;
 *  files no eval reaches sink to the bottom (the coverage gap is visible). */
export function layout(graph, o = {}) {
  const { rowH = 50, nodeH = 38, evalX = 30, evalW = 250, fileX = 600, fileW = 300, top = 70 } = o;
  const evalPos = new Map(graph.evals.map((e, i) => [e.id, i]));
  const bary = new Map();
  for (const e of graph.edges) {
    const a = bary.get(e.to) || { s: 0, n: 0 };
    a.s += evalPos.get(e.from) * (e.rank === 1 ? 2 : 1); a.n += e.rank === 1 ? 2 : 1;
    bary.set(e.to, a);
  }
  const key = (f) => (bary.has(f.id) ? bary.get(f.id).s / bary.get(f.id).n : 1e6);
  const files = [...graph.files].sort((a, b) => key(a) - key(b) || a.path.localeCompare(b.path));
  const pos = {};
  graph.evals.forEach((e, i) => (pos[e.id] = { x: evalX, y: top + i * rowH, w: evalW, h: nodeH }));
  let uncoveredAt = null;
  files.forEach((f, i) => {
    pos[f.id] = { x: fileX, y: top + i * rowH, w: fileW, h: nodeH };
    if (uncoveredAt === null && !bary.has(f.id)) uncoveredAt = top + i * rowH - 14;
  });
  const n = Math.max(graph.evals.length, files.length);
  return { pos, files, height: top + n * rowH + 20, uncoveredAt, width: fileX + fileW + 30 };
}

export function neighbors(graph, id) {
  const s = new Set([id]);
  for (const e of graph.edges) { if (e.from === id) s.add(e.to); if (e.to === id) s.add(e.from); }
  return s;
}

/** Which rule of gate.decide fired, in its exact order, with live numbers. g = api "gate"/gate_decide result. */
export function gateSteps(g) {
  const f = g.facts || {}, p = g.params || {};
  const fired = GATE_ORDER.indexOf(g.verdict);
  const text = {
    INCONCLUSIVE: ["too many runs unfinished?", `limit ${Math.round((p.max_unfinished ?? 0.1) * 100)}% of answers`],
    REGRESSION: ["a probe or the heldout split got worse?", `regressed: ${(f.regressed || []).join(", ") || "none"} · heldout ${f.heldout_without}→${f.heldout_with} (limit ${p.regress_by})`],
    CEILING: ["baseline already too good to show a gain?", `without-skill dev ${f.dev_without}/${f.dev_n} vs ceiling ${Math.round((p.ceiling ?? 0.9) * 100)}%`],
    NO_DELTA: ["gain below the minimum?", `gain ${f.gain} vs min_gain ${p.min_gain}`],
    TOO_COSTLY: ["gain is there, but costs too much?", `cost ×${f.cost_ratio} vs max ${p.max_cost_ratio}`],
    ADOPT: ["every rule passed", "this is the only way to ADOPT"],
  };
  return GATE_ORDER.map((v, i) => ({ verdict: v, question: text[v][0], detail: g.facts ? text[v][1] : "", state: fired < 0 ? "unreached" : i < fired ? "no" : i === fired ? "fired" : "unreached" }));
}

/** gate state <-> URL hash (grid is 0/1 strings) */
export function encodeGate(grid, params) {
  return btoa(JSON.stringify({ p: params, g: Object.fromEntries(Object.entries(grid).map(([k, v]) => [k, [v.without.map(Number).join(""), v.with.map(Number).join("")]])) }));
}
export function decodeGate(s) {
  const o = JSON.parse(atob(s));
  return { params: o.p, grid: Object.fromEntries(Object.entries(o.g).map(([k, [a, b]]) => [k, { without: [...a].map((c) => c === "1"), with: [...b].map((c) => c === "1") }])) };
}

export const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
