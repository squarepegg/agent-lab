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

const bad = lab.call("run_evals", { files, questions: "- id: bad\n  run: {search: order_date UTC}\n  expect: [nope-nope]\n  tier: must\n" });
assert.equal(bad.summary.ok, false);

const probes = lab.call("parse_yaml", { text: bundle.probes });
assert.ok(probes.length >= 10);
const P = lab.call("lint_skill", { text: bundle.skills.dst });
assert.deepEqual(P.errors, []);

const err = lab.call("run_evals", { files, questions: "not: [valid" });
assert.ok(err.error, "bad yaml is reported, not thrown");
assert.ok(lab.call("nope", {}).error);

console.log("pyodide smoke ok");
