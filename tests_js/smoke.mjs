// Runs the REAL vendored Python inside Pyodide (same code path as the browser) and checks it agrees with the native tests.
import { loadPyodide } from "pyodide";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { bootLab } from "../web/lab.js";

const bundle = JSON.parse(readFileSync(new URL("../web/bundle.json", import.meta.url)));
const lab = await bootLab(loadPyodide, bundle);
const files = bundle.brain, questions = bundle.questions;

const ev = lab.call("run_evals", { files, questions });
assert.equal(ev.summary.ok, true, JSON.stringify(ev.summary));
assert.ok(ev.summary.must_total >= 5);

const s = lab.call("search", { files, query: "order_date UTC" });
assert.match(s[0].path, /orders-timestamps/);

const m = lab.call("mutate", { files, questions, mutation: { op: "delete_file", path: "facts/orders-timestamps-utc.md" } });
assert.ok(m.killed_by.includes("midnight-mismatch"));

const ex = lab.call("explain", { files, questions, mutation: { op: "delete_file", path: "facts/airflow-backfill-concurrency.md" } });
assert.equal(ex.survived, true); assert.equal(ex.fix.verified, true);

const bad = lab.call("run_evals", { files, questions: "- id: bad\n  run: {search: order_date UTC}\n  expect: [nope-nope]\n  tier: must\n" });
assert.equal(bad.summary.ok, false);

assert.ok(bundle.probes.length >= 10);
const sk = lab.call("ab_skill", { text: bundle.skills.dst, probes: bundle.probes.filter((p) => p.skill === "dst") });
assert.ok(["ADOPT","NO_DELTA","CEILING","REGRESSION"].includes(sk.gate.verdict), JSON.stringify(sk.gate));
const P = lab.call("lint_skill", { text: bundle.skills.dst });
assert.deepEqual(P.errors, []);

const recorded = JSON.parse(readFileSync(new URL("../recorded/RUNS.json", import.meta.url)));
const name = Object.keys(recorded.files).find((n) => n.startsWith("doubt--") && n.includes("haiku"));
const gr = lab.call("gate_run", { res: JSON.parse(readFileSync(new URL("../recorded/" + name, import.meta.url))) });
assert.equal(gr.verdict, "NO_DELTA", "the real gate judges a recorded run under Pyodide");

const calls = [{ name: "bash", args: { command: "cat ~/.ssh/config" } }, { name: "bash", args: { command: "ls -la" } }];
const gd = lab.call("guard_run", { calls, policy: { rules: ["no_home"] } });
assert.deepEqual([gd.counts.caught, gd.counts.wrongly, gd.counts.missed], [1, 0, 0], "the guard policy engine runs under Pyodide");

const sc = lab.call("scrub_one", { text: "see /Users/sam/x", opts: ["machine_home"], user: "sam" });
assert.equal(sc.out, "see <machine-home>/x", "the scrubber runs under Pyodide");

const err = lab.call("run_evals", { files, questions: "not: [valid" });
assert.ok(err.error, "bad yaml is reported, not thrown");
assert.ok(lab.call("nope", {}).error);

const tr = lab.call("trace", { target: "search", args: { files, query: "order_date UTC" } });
assert.ok(Object.keys(tr.hits["brain.py"]).length > 5, "trace works under Pyodide");
console.log("pyodide smoke ok");
