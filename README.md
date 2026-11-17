# agent-lab

An interactive companion to [agent-knowledge-map](https://github.com/squarepegg/agent-knowledge-map) and
[agent-toolkit](https://github.com/squarepegg/agent-toolkit). A static site that runs the **real, unmodified** upstream Python
(`brain.py`, `eval_run.py`, `gate.py`, `skill_ab.py`, `check_skills.py`) in your browser with Pyodide. No server, no secrets, no model calls.

One canvas, seven modes (left toolbar; `⌘K` jumps to anything; scenarios live in the URL):

| Mode | What you do |
|---|---|
| Map | A graph of evals and the files they read. Hover traces neighbours, click opens and edits, search puts rank badges on nodes. Files no eval reads sink to a visible gap. |
| Evals | Replay one eval step by step (lookup, ranked files, each check ticking); add a bad eval and watch it fail. |
| Break it | Delete or alter a fact and see which evals notice; auto-mutate for a mutation score. |
| The gate | The real `gate.decide` as a decision path: flip sample outcomes and thresholds and watch which rule fires. Probe grader playground. |
| A/B a fact | Drop a new fact onto the map: BREAKS / POLLUTES / NOT_FINDABLE / FIT by rule. |
| A/B a skill | Real `check_skills` lint, text coverage of the probes, then the real gate. |
| About | Which upstream files run here, with hashes. |

## Levels and the real-code panel
**The Python behind this** (a fold under each mode's controls): the upstream function behind what you just did, with the lines that actually ran highlighted
(a `sys.settrace` of the vendored files in Pyodide). It is closed for beginners and open for experienced users; the fold's title shows how many lines ran. The `level` chip switches **beginner** (plain-English margin notes, a "what am I looking at" box)
and **experienced** (no notes, per-line execution counts). Choice is remembered in localStorage.

**Try it: change the real code** (a second fold, closed by default): beginners pick a guided tweak ("Skip the CEILING rule"), experienced users edit the whole
function. The same input runs through the real function and your edit, and the result is compared. The edit is swapped in for one call and
restored; syntax errors and endless loops (400k-line budget) are reported in the cell, never break the page.

**Start** (the landing page): pick your level, then follow the path: see how an agent is graded, test the tests, decide what to trust. One button continues where you left off; free-explore modes and the challenges are below the path.

**Lessons**: 6 guided lessons (what is an eval, ranking, mutation testing, the gate, skill A/B, why one run isn't enough). Each asks you to **predict** before it
runs the real code. The answer is computed from that run, never written in advance, and the page refuses a lesson whose answer is not one of its choices.
While a lesson runs, the drawer shows only the lesson card. A strip above the canvas says what to look at (`look` in `web/lessons.js`), the mode's controls sit in a **Poke at it yourself** fold (open on steps flagged `hands`), and the Python folds are closed. Leaving a lesson resets whatever it set up. Progress is in localStorage.

**Challenges** (on the Start screen under Practice): six tasks (catch a surviving mutant, lift the mutation score, make the gate say TOO_COSTLY, find the regression the gate tolerates, fool the grader,
fix `skill_ab.missing` against unit tests). Press **Check** and the real code judges your result; each has a 3-step hint ladder.
Lesson explanations are claim-checked: every causal sentence has predicates evaluated on the real run, and the page shows a warning instead of the sentence if one stops holding.

## What is and is not real
Real: ranking, eval checking, grading, gate verdicts, skill lint. **Not real:** model answers. Gate demos use fixtures; the skill A/B is a
text-coverage proxy ("the skill states the answer"), not evidence a model behaves better. Behaviour needs recorded runs from
`agent-toolkit/evals/run.py`, which the gate then judges identically.

## Run / test
```sh
python3 scripts/build_bundle.py && python3 -m http.server -d web 8000     # http://localhost:8000
python3 -W ignore -m unittest discover -s tests                            # native tests of lab/lab_core.py
cd tests_js && npm ci && npm test                                          # graph model unit tests, same code inside Pyodide, the page in headless Chrome
```
## Vendoring
`vendor/` holds byte-identical copies of upstream scripts, hashed in `vendor/VENDOR.json`. Refresh with
`python3 scripts/vendor.py --map ../agent-knowledge-map --toolkit ../agent-toolkit`. `scripts/check_vendor.py` fails CI on local edits;
a weekly workflow compares against upstream.
