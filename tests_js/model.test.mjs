import test from "node:test";
import assert from "node:assert/strict";
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
