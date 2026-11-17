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

**Lessons**: 8 guided lessons (what is an eval, ranking, mutation testing, the gate, skill A/B, real models recorded, what happened in each answer, why one run isn't enough). The trace lesson is the observability one: in the Gate, a recorded run has a fold with one row per answer (passed, opened the skill file, tool calls, cost) and the lesson asks where the extra cost came from. It is built only from the recorded runs; guardrails are not covered because upstream has no runnable guardrail code. Each asks you to **predict** before it
runs the real code. The answer is computed from that run, never written in advance, and the page refuses a lesson whose answer is not one of its choices.
While a lesson runs, the drawer shows only the lesson card. A strip above the canvas says what to look at (`look` in `web/lessons.js`), the mode's controls sit in a **Poke at it yourself** fold and the Python folds are closed unless a step lists them in `open`. After you answer a prediction, **Show the Python that ran** opens the lines the real code executed. Leaving a lesson resets whatever it set up. Progress is in localStorage.

**Challenges** (on the Start screen under Practice): six tasks (catch a surviving mutant, lift the mutation score, make the gate say TOO_COSTLY, find the regression the gate tolerates, fool the grader,
fix `skill_ab.missing` against unit tests). Press **Check** and the real code judges your result; each has a 3-step hint ladder.
Each prediction has a plain explanation of a wrong pick (`miss`), and the last step says what you learned. Lesson explanations are claim-checked: every causal sentence has predicates evaluated on the real run, and the page shows a warning instead of the sentence if one stops holding.

## How it loads
The page works before Python does. `index.html` holds a static shell (headline, three ideas, lesson 1's first question, so it reads on its own with JavaScript off) and starts `web/pyworker.js` first. Once the app boots, the Start screen replaces it with the headline, one Start button and the path (which carries the three ideas as its headings).
The worker downloads Pyodide 0.27.7 from jsDelivr and boots the vendored Python off the main thread, so a chip shows real progress. Lesson 1 runs from
`web/recorded.json` until Python is ready: results recorded from this same code in headless Chrome, labelled "recorded from the real code" on the page. Once Python is ready every result is computed live.
`node tests_js/record.mjs` regenerates that file; `--check` fails CI on any byte difference. `web/sw.js` caches the app and Pyodide, so a repeat visit works offline (it registers off localhost, or with `?sw=1`).
Pyodide stays on 0.27.7: 0.29.5 was about 0.3 s faster unthrottled and 0.4 s faster at 8 Mbit in a 4 to 7 run comparison, which is not worth moving from Python 3.12 (what CI runs natively) to 3.13.
A Pyodide memory snapshot was tried and failed ("Unexpected hiwire entry") in 0.27.7, so it is not used.

## What is and is not real
Real: ranking, eval checking, grading, gate verdicts, skill lint, and the model answers in `recorded/`. **Not real:** the Gate's presets and clickable cells are hand-set; the
skill A/B canvas is a text-coverage proxy ("the skill states the answer"), not evidence a model behaves better; the noise lesson uses a seeded coin.
No model is called on the page.

**Recorded runs** (`recorded/`, 8 files, 192 answers): 3 tries per probe question, with and without the skill, on `claude-haiku-4-5` and `claude-sonnet-5-5`, for `dst`, `doubt`, `evidence-gated` and a "Lorem ipsum" filler skill.
Made on 2026-11-16 with the vendored `skill_ab.py` through `pi 1.5.2` on Bedrock (`--no-extensions --no-mcp`, empty HOME). Machine paths in the answers are scrubbed.
`recorded/RUNS.json` holds each file's sha256, model, date, cost and the exact prompt. `scripts/check_recorded.py` fails CI if a file is edited, a probe changed, or the vendored grader would grade an answer differently.
`scripts/record_runs.py` is the only script that calls a model. These are 3 tries on two models: evidence about those runs, not a general claim about a skill. No run was ADOPT.

## Run / test
```sh
python3 scripts/build_bundle.py && python3 -m http.server -d web 8000     # http://localhost:8000
python3 -W ignore -m unittest discover -s tests                            # native tests of lab/lab_core.py
cd tests_js && npm ci && node --test model.test.mjs && node smoke.mjs      # unit tests, same code inside Pyodide
env -u CI node ui.mjs && env -u CI node ui_modes.mjs                       # the page in headless Chrome: every mode, lesson and challenge; then loading, offline, phone, recorded runs
env -u CI node record.mjs --check                                          # web/recorded.json equals a fresh run
python3 scripts/check_recorded.py                                          # recorded/ unedited and still graded the same
```
(`env -u CI` only matters where `CI` is set: locally the tests use `/Applications/Google Chrome.app`, in CI Playwright's Chromium.)
## Vendoring
`vendor/` holds byte-identical copies of upstream scripts, hashed in `vendor/VENDOR.json`. Refresh with
`python3 scripts/vendor.py --map ../agent-knowledge-map --toolkit ../agent-toolkit`. `scripts/check_vendor.py` fails CI on local edits;
a weekly workflow compares against upstream.
