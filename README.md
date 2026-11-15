# agent-lab

An interactive companion to [agent-knowledge-map](https://github.com/squarepegg/agent-knowledge-map) and
[agent-toolkit](https://github.com/squarepegg/agent-toolkit). A static site that runs the **real, unmodified** upstream Python
(`brain.py`, `eval_run.py`, `gate.py`, `grade.py`, `lint_skills.py`) in your browser with Pyodide. No server, no secrets, no model calls.

| Tab | What you can do |
|---|---|
| The map | Browse a sample brain, edit files, search with the real ranking. |
| Evals | Edit `questions.yaml`, run it, see each criterion tick or fail; add a bad eval and watch it fail. |
| Break it | Delete/alter a fact and see which evals notice; auto-mutate for a mutation score. |
| The gate | Flip per-sample outcomes and thresholds; the real `gate.decide` returns ADOPT / NO_DELTA / CEILING / REGRESSION / TOO_COSTLY. Probe grader playground. |
| A/B | Paste a new fact (BREAKS / POLLUTES / NOT_FINDABLE / FIT by rule) or skill (lint + text coverage + the real gate). |

## What is and is not real
Real: ranking, eval checking, grading, gate verdicts, skill lint. **Not real:** model answers. Gate demos use fixtures; the skill A/B is a
text-coverage proxy ("the skill states the answer"), not evidence a model behaves better. Behaviour needs recorded runs from
`agent-toolkit/evals/run.py`, which the gate then judges identically.

## Run / test
```sh
python3 scripts/build_bundle.py && python3 -m http.server -d web 8000     # http://localhost:8000
python3 -W ignore -m unittest discover -s tests                            # native tests of lab/lab_core.py
cd tests_js && npm ci && npm test                                          # same code inside Pyodide + the page in headless Chrome
```
## Vendoring
`vendor/` holds byte-identical copies of upstream scripts, hashed in `vendor/VENDOR.json`. Refresh with
`python3 scripts/vendor.py --map ../agent-knowledge-map --toolkit ../agent-toolkit`. `scripts/check_vendor.py` fails CI on local edits;
a weekly workflow compares against upstream.
