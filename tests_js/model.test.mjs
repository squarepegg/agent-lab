import test from "node:test";
import assert from "node:assert/strict";
import { extractFunc, annotate, coverage, MODE_CODE, TWEAKS, applyTweak, lineDiff, brief } from "../web/codepanel.js";
import fs from "node:fs";
import { LESSONS, checkClaims } from "../web/lessons.js";
import { CHALLENGES } from "../web/challenges.js";
import { parseHits, buildGraph, layout, neighbors, gateSteps, encodeGate, decodeGate, GATE_ORDER, clip } from "../web/model.js";

const docs = [{ path: "facts/a.md", kind: "fact", title: "A" }, { path: "facts/b.md", kind: "fact", title: "B" }, { path: "facts/c.md", kind: "fact", title: "C" },
  { path: "brain.config.yaml", kind: "config", title: "cfg" }];
const results = [
  { id: "e1", q: "q", tier: "must", pass: true, query: "x", output: "facts/b.md:2: t\nfacts/b.md:5: u\nfacts/a.md:1: v" },
  { id: "e2", q: "q", tier: "must", pass: false, query: "y", output: "facts/a.md:1: v\nnot/in/graph.md:3: z" },
];

test("parseHits keeps first-seen order and drops duplicates", () => {
  assert.deepEqual(parseHits(results[0].output), ["facts/b.md", "facts/a.md"]);
  assert.deepEqual(parseHits("no matches"), []);
  assert.deepEqual(parseHits(undefined), []);
});

test("buildGraph: only file kinds, edges only to known files, rank 1 = top hit", () => {
  const g = buildGraph(docs, results);
  assert.equal(g.files.length, 3);
  assert.deepEqual(g.edges.map((e) => [e.from, e.to, e.rank]), [["eval:e1", "facts/b.md", 1], ["eval:e1", "facts/a.md", 2], ["eval:e2", "facts/a.md", 1]]);
});

test("layout is deterministic, uncovered files sink to the bottom, no overlaps", () => {
  const g = buildGraph(docs, results);
  const a = layout(g), b = layout(buildGraph([...docs].reverse(), results));
  assert.deepEqual(a.pos, b.pos);
  assert.deepEqual(a.files.map((f) => f.id), ["facts/b.md", "facts/a.md", "facts/c.md"]);
  assert.equal(a.files.at(-1).id, "facts/c.md");
  assert.ok(a.uncoveredAt > a.pos["facts/a.md"].y);
  const ys = a.files.map((f) => a.pos[f.id].y);
  assert.deepEqual(ys, [...ys].sort((x, y) => x - y));
  assert.equal(new Set(ys).size, ys.length);
});

test("neighbors", () => {
  const g = buildGraph(docs, results);
  assert.deepEqual([...neighbors(g, "facts/a.md")].sort(), ["eval:e1", "eval:e2", "facts/a.md"]);
  assert.deepEqual([...neighbors(g, "facts/c.md")], ["facts/c.md"]);
});

test("gateSteps marks exactly one fired step in gate.decide's order", () => {
  for (const [i, v] of GATE_ORDER.entries()) {
    const s = gateSteps({ verdict: v, facts: { regressed: [], gain: 1, cost_ratio: 1, dev_n: 3 }, params: { min_gain: 2 } });
    assert.deepEqual(s.map((x) => x.state), GATE_ORDER.map((_, j) => (j < i ? "no" : j === i ? "fired" : "unreached")));
  }
  assert.ok(gateSteps({ verdict: "BAD_INPUT", facts: {} }).every((x) => x.state === "unreached"));
  assert.match(gateSteps({ verdict: "NO_DELTA", facts: { gain: 1 }, params: { min_gain: 2 } })[3].detail, /gain 1 vs min_gain 2/);
});

test("gate hash round-trips", () => {
  const grid = { p0: { without: [true, false, false], with: [true, true, true] } }, params = { min_gain: 2, ceiling: 0.9 };
  assert.deepEqual(decodeGate(encodeGate(grid, params)), { grid, params });
});

test("clip", () => { assert.equal(clip("abcdef", 4), "abc…"); assert.equal(clip("abc", 4), "abc"); });

test("codepanel: every mode's functions exist in the vendored source, and the last line of decide is its ADOPT return", () => {
  for (const spec of Object.values(MODE_CODE)) for (const [file, fn] of spec) {
    const f = extractFunc(fs.readFileSync(new URL(`../vendor/${file}`, import.meta.url), "utf8"), fn);
    assert.ok(f && f.rows.length > 1, `${file}:${fn}`);
    assert.ok(f.rows[0].text.startsWith(`def ${fn}(`));
  }
  const d = extractFunc(fs.readFileSync(new URL("../vendor/gate.py", import.meta.url), "utf8"), "decide");
  assert.match(d.rows.at(-1).text, /ADOPT/);
});

test("codepanel: annotate marks hit/miss only on code lines; docstrings and defs are none", () => {
  const f = extractFunc('def f(x):\n    """doc\n    more"""\n    a = 1\n    # c\n    return a\n\nX = 1\n', "f");
  const rows = annotate(f, { 4: 2 }, [["return", "gives it back"]]);
  assert.deepEqual(rows.map((r) => r.state), ["none", "none", "none", "hit", "none", "miss"]);
  assert.equal(rows[5].note, "gives it back");
  assert.deepEqual(coverage(rows), { ran: 1, total: 2 });
});

test("tweaks: every one applies exactly once to the upstream function and changes one line", () => {
  let n = 0;
  for (const [key, list] of Object.entries(TWEAKS)) {
    const [file, fn] = key.split(":");
    const f = extractFunc(fs.readFileSync(new URL(`../vendor/${file}`, import.meta.url), "utf8"), fn);
    const src = f.rows.map((r) => r.text).join("\n");
    for (const t of list) { n++; const d = lineDiff(src, applyTweak(src, t)); assert.equal(d.length, 2, key + " " + t.label); assert.equal(d[0].kind, "del"); }
  }
  assert.ok(n >= 8);
});

test("brief: one comparable line per target", () => {
  assert.equal(brief("search", [{ path: "facts/a.md" }, { path: "facts/a.md" }, { path: "x/b.md" }]), "1 a.md · 2 b.md");
  assert.equal(brief("search", []), "no matches");
  assert.equal(brief("gate", { verdict: "ADOPT", reason: "r" }), "ADOPT: r");
  assert.equal(brief("mutate", { survived: true }), "SURVIVED: no eval noticed");
  assert.deepEqual(lineDiff("a\nb", "a\nc").map((x) => x.kind), ["del", "add"]);
});

test("lessons: every predict step has a why, 2+ choices, and claims that can fail", () => {
  const ps = LESSONS.flatMap((l) => l.steps).filter((s) => s.predict).map((s) => s.predict);
  assert.ok(ps.length >= 12);
  for (const p of ps) { assert.equal(typeof p.why, "function"); assert.ok(p.choices.length >= 2 && new Set(p.choices).size === p.choices.length); }
  assert.ok(ps.filter((p) => (p.claims || []).length).length >= 11, "nearly every explanation is claim-checked");
});

test("checkClaims reports exactly the claims that do not hold (and treats a throwing claim as failed)", () => {
  const p = { claims: [["true one", () => true], ["false one", () => false], ["throws", () => { throw new Error("x"); }]] };
  assert.deepEqual(checkClaims(p, {}), ["false one", "throws"]);
  assert.deepEqual(checkClaims({}, {}), []);
});

test("challenges: unique ids, goals, 3 hints for graded ones, code challenges have cases", () => {
  assert.equal(new Set(CHALLENGES.map((c) => c.id)).size, CHALLENGES.length);
  for (const c of CHALLENGES) { assert.ok(c.goal && c.hints.length >= 3 && c.title, c.id); assert.ok(c.code ? c.cases.length >= 4 : typeof c.check === "function", c.id); }
});
