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

/** Beginner names for the gate's verdicts. The upstream names stay visible for experienced users. */
export const PLAIN_VERDICT = {
  INCONCLUSIVE: "Too many unfinished runs", REGRESSION: "Something got worse", CEILING: "Already too good to show a gain",
  NO_DELTA: "Not enough improvement", TOO_COSTLY: "Helps, but costs too much", ADOPT: "Adopt the skill", BAD_INPUT: "Cannot judge this input",
};
const pct = (x, d) => Math.round((x ?? d) * 100);
/** "costs the same" or "costs 2.1 times as much": never "1 times". */
export const costs = (r) => (+r === 1 ? "costs the same" : `costs ${r} times as much`);
const signed = (n) => (n > 0 ? "+" + n : String(n));

/** One plain sentence saying why the gate gave this verdict, built only from the facts gate.decide returned. */
export function plainReason(g) {
  const f = g.facts || {}, p = g.params || {};
  switch (g.verdict) {
    case "INCONCLUSIVE": return `More than ${pct(p.max_unfinished, 0.1)}% of the answers did not finish, so the gate refuses to judge.`;
    case "REGRESSION": return (f.regressed || []).length
      ? `The skill made ${f.regressed.length === 1 ? "one question" : f.regressed.length + " questions"} worse (${f.regressed.join(", ")}). A skill that breaks something is rejected, however much it helps elsewhere.`
      : `The skill did worse on the hidden test questions (${f.heldout_without} correct without it, ${f.heldout_with} with it).`;
    case "CEILING": return `Without the skill, ${f.dev_without} of ${f.dev_n} answers were already correct. There is no room left to show a gain.`;
    case "NO_DELTA": return `The skill changed the score by ${signed(f.gain)} correct answers. It needs at least +${p.min_gain}.`;
    case "TOO_COSTLY": return `The skill helps (${signed(f.gain)} correct answers) but ${costs(f.cost_ratio)}. The limit is ${p.max_cost_ratio} times.`;
    case "ADOPT": return `The skill added ${f.gain} correct answers, made nothing worse, and ${costs(f.cost_ratio)} (the limit is ${p.max_cost_ratio}).`;
    default: return g.reason || "";
  }
}

/** Which rule of gate.decide fired, in its exact order, with live numbers. g = api "gate"/gate_decide result.
 *  plain = beginner wording: no upstream parameter names. */
export function gateSteps(g, plain = false) {
  const f = g.facts || {}, p = g.params || {};
  const fired = GATE_ORDER.indexOf(g.verdict);
  const text = plain ? {
    INCONCLUSIVE: ["Did too many answers fail to finish?", `at most ${pct(p.max_unfinished, 0.1)}% may be unfinished`],
    REGRESSION: ["Did any question get worse with the skill?", `worse: ${(f.regressed || []).join(", ") || "none"} · hidden test ${f.heldout_without} → ${f.heldout_with} correct (a drop of ${p.regress_by} counts)`],
    CEILING: ["Was it already near-perfect without the skill?", `without the skill ${f.dev_without}/${f.dev_n} correct · near-perfect means ${pct(p.ceiling, 0.9)}% or more`],
    NO_DELTA: ["Did the skill add too few correct answers?", `changed by ${signed(f.gain ?? 0)} · needs at least +${p.min_gain}`],
    TOO_COSTLY: ["Does it help, but cost too much more?", `${costs(f.cost_ratio)} · the limit is ${p.max_cost_ratio} times`],
    ADOPT: ["Every check passed", "this is the only way to be adopted"],
  } : {
    INCONCLUSIVE: ["too many runs unfinished?", `limit ${pct(p.max_unfinished, 0.1)}% of answers`],
    REGRESSION: ["a probe or the heldout split got worse?", `regressed: ${(f.regressed || []).join(", ") || "none"} · heldout ${f.heldout_without}→${f.heldout_with} (limit ${p.regress_by})`],
    CEILING: ["baseline already too good to show a gain?", `without-skill dev ${f.dev_without}/${f.dev_n} vs ceiling ${pct(p.ceiling, 0.9)}%`],
    NO_DELTA: ["gain below the minimum?", `gain ${f.gain} vs min_gain ${p.min_gain}`],
    TOO_COSTLY: ["gain is there, but costs too much?", `cost ×${f.cost_ratio} vs max ${p.max_cost_ratio}`],
    ADOPT: ["every rule passed", "this is the only way to ADOPT"],
  };
  return GATE_ORDER.map((v, i) => ({ verdict: v, name: plain ? PLAIN_VERDICT[v] : v, question: text[v][0], detail: g.facts ? text[v][1] : "", state: fired < 0 ? "unreached" : i < fired ? "no" : i === fired ? "fired" : "unreached" }));
}

/** A recorded skill_ab results file -> the same {probe: {without: [bool], with: [bool]}} grid the hand-set gate uses. */
export function runGrid(res) {
  const grid = {};
  for (const r of res.rows) ((grid[r.probe] ||= { without: [], with: [] })[r.arm][r.n] = !!(r.correct && r.finished !== false));
  return grid;
}
/** What the trace of a recorded run shows, split three ways: answers without the skill, answers with it where the model opened
 *  the skill file, and answers with it where it did not. Per group: n, correct, mean cost in dollars, mean tool calls, mean answer length in characters.
 *  `ratio` is the total cost with the skill over the total cost without. An answer that did not finish does not count as correct. */
export function traceStats(res) {
  const groups = { without: [], withRead: [], withSkip: [] };
  for (const r of res.rows) groups[r.arm === "without" ? "without" : r.skill_read ? "withRead" : "withSkip"].push(r);
  const sum = (rs, f) => rs.reduce((s, r) => s + f(r), 0);
  const stat = (rs) => ({ n: rs.length, correct: sum(rs, (r) => (r.correct && r.finished !== false ? 1 : 0)), cost: rs.length ? sum(rs, (r) => r.cost_usd) / rs.length : 0, tools: rs.length ? sum(rs, (r) => r.tools.length) / rs.length : 0, chars: rs.length ? sum(rs, (r) => (r.answer ?? "").length) / rs.length : 0 });
  const out = Object.fromEntries(Object.entries(groups).map(([k, rs]) => [k, stat(rs)]));
  const total = (...ks) => ks.reduce((s, k) => s + out[k].n * out[k].cost, 0);
  out.ratio = total("without") ? total("withRead", "withSkip") / total("without") : 0;
  return out;
}
/** Only what gate.decide reads from a results file (answers and tool calls stay on the page). */
export const slimRun = (res) => ({ skill: res.skill, samples: res.samples, pi_args: res.pi_args, date: res.date,
  rows: res.rows.map((r) => ({ probe: r.probe, split: r.split, arm: r.arm, n: r.n, correct: r.correct, finished: r.finished, cost_usd: r.cost_usd })) });
/** "amazon-bedrock/global.anthropic.claude-haiku-4-5-20251001-v1:0" -> "claude-haiku-4-5" */
export const modelName = (id) => (String(id).match(/claude-[a-z]+-\d+(?:-\d(?!\d))?/) || [String(id).split("/").pop()])[0];

/** gate state <-> URL hash (grid is 0/1 strings) */
export function encodeGate(grid, params) {
  return btoa(JSON.stringify({ p: params, g: Object.fromEntries(Object.entries(grid).map(([k, v]) => [k, [v.without.map(Number).join(""), v.with.map(Number).join("")]])) }));
}
export function decodeGate(s) {
  const o = JSON.parse(atob(s));
  return { params: o.p, grid: Object.fromEntries(Object.entries(o.g).map(([k, [a, b]]) => [k, { without: [...a].map((c) => c === "1"), with: [...b].map((c) => c === "1") }])) };
}

export const clip = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));
