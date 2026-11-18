# agent-lab handover

Repo: `~/projects/me/agent-lab` (github.com/squarepegg/agent-lab, branch `main`, deployed by the `pages` workflow).
Goal: make the site truly interactive for learning the Python behind agent evals, for **beginners and experienced** engineers.
State: steps 1 to 4 and 6 done (step 5 dropped), then the "intuitive and fun" rework: async Python worker, static first paint, service worker, recorded model runs, a recorded-runs lesson, plain beginner wording, phone layout. See `docs/PLAYTEST.md` for what a walk-through found.

## What it is
Static site. Pyodide runs the **real, unmodified** upstream Python (`vendor/`: `brain.py`, `eval_run.py`, `gate.py`, `skill_ab.py`, `check_skills.py`, helpers)
from `squarepegg/agent-knowledge-map` and `squarepegg/agent-toolkit`. No server, no secrets, no model calls. See `README.md` for modes.

## Build order (the agreed plan) and status
| # | Step | Status | Where |
|---|---|---|---|
| 1 | Code panel: real function per mode, executed lines highlighted (`sys.settrace`), beginner/experienced **level** chip | done | `web/codepanel.js`, `lab/api.py` `trace`, `codePanel()` in `web/app.js` |
| 2 | Edit-and-run cell: guided tweaks (beginner) / full editor (experienced), compare real vs edited, always restored, 400k-line loop budget | done | `run_edit` in `lab/api.py`, `TWEAKS`/`brief`/`lineDiff` in `codepanel.js`, `editCell()` |
| 3 | Guided lessons, predict-then-reveal, answers computed from the real run, progress in localStorage | done | `web/lessons.js` (10 lessons; `trace`, `recorded`, `guard` and `scrub` need the recorded runs), `lessonCard()` etc. in `app.js` |
| 3b | Claim-checked explanations: each `why` has `claims` predicates; page shows a warning instead of the sentence if one fails | done | `checkClaims` in `lessons.js` |
| 4 | Six auto-checked challenges with 3-hint ladders; code challenge judged by `check_fn` | done | `web/challenges.js`, `check_fn` in `lab/api.py`, `chalCard()` |
| 5 | Bring-your-own-key live model cell | **dropped** (user: pasting an API key into a page feels like phishing) | |
| 6 | Lesson "why one run isn't enough": seeded simulated re-runs through the real gate (`vendor/_attempts.py` is a resume log with no pass@k, so it is not used) | done | `noise_sweep` in `lab/lab_core.py`, `noise` in `lab/api.py`, lesson `noise` in `web/lessons.js` |

## UI structure (`app.js`)
- **Python is async.** `web/pyworker.js` runs Pyodide in a module worker; `connectLab` (`web/lab.js`) is the page's client. `call` is async. Before Python is ready it answers from `web/recorded.json` (lesson 1 only); with `?record=1` it never does and logs every call to `lab.rec` (that is how `tests_js/record.mjs` writes the file).
- **Every handler goes through the serial queue `act()`; `prep()` fetches Python results before the synchronous render.** Deadlock rule: code running inside `act()` must never `await act()`. Only detached animations (`replay`, the loop in `ACT.auto`) use it. Tests call `await __lab.idle()` after each action (`ui.mjs` patches `click`/`fill` to do it).
- Default landing is the **Start** screen (`homeHtml`): three doors, one per pillar (`PILLARS` in `lessons.js`: Observability "What happened?" = trace; Guardrails "Should it have been allowed?" = guard, scrub; Evals "Did it actually work?" = the other seven), a case file board (one square per lesson, ✔ when done, ringed when next in its pillar) and a closed fold with the challenges and the free modes. A door starts that pillar's next unfinished lesson (`ACT.door`, `nextIn`). Finishing a lesson sets `S.lesson.finished` and the drawer shows only `doorsCard()`: the next lesson in this pillar plus the next lesson of each other pillar, and a "Case file" button; Back returns to the last step. `index.html` holds the headline and the three doors as plain text so it reads with JavaScript off; `model.test.mjs` keeps it in step with `PILLARS`. `#m=<mode>` links open a mode directly. The pillars are uneven (1, 2 and 7 lessons) until UX-REVIEW steps 3 and 4.
- `drawer()` composes by context: **lesson** = lesson card (its Back/Next row is sticky) + `Poke at it yourself` fold + closed Python folds; **challenge** = card + the controls it needs; **free explore** = controls, Python fold open only for experienced.
- Fold state lives in `S.fold`; reset each lesson step. In a lesson only the folds `step.open` lists are open (the Gate's grader fold and the skill text fold are open by default only outside lessons).
- `lesson.look` / `step.look` feed the caption strip. `predict.expects` is the answer the lesson's `why` is written for, `predict.miss` the text for each wrong pick (a function `(ctx, correct) => string` is allowed), `lesson.learned` the last step's summary. `model.test.mjs` requires a `miss` for every wrong choice of the recorded lesson; `ui_modes.mjs` checks every `expects` against the computed answer and that no wrong pick falls back to "You picked X".
- If Python failed to load and a step was not recorded, the lesson card shows the failure (`L.error`), not a fading toast.
- **Gate**: beginners see plain verdicts (`PLAIN_VERDICT`, `plainReason`, `gateSteps(g, true)` in `model.js`): no upstream parameter name in any beginner label. The verdict card (`#gverdict`) sits first in the drawer. Recorded runs (`runs.json` from `recorded/`) appear in the "results to judge" menu, with a `trace` fold (`traceHtml`, numbers from `traceStats` in `model.js`); their cells are read-only and open the model's answer (`peekCard`). Skill A/B stays on the proxy, with a "recorded behaviour" table beside it.
- **Phone (≤720px)**: the canvas is replaced by `#sum`, a text summary of the same state, with the caption above it and a labelled bottom bar.
- **Guardrails** (`guard` mode, `guardDrawer`/`renderGuard`/`computeGuard` in `app.js`): `lab/guard.py` has two engines: rules and a Python `allowed()` written for this lab (the page says so), and `{"upstream": policy}`, which runs the vendored `vendor/guard_hook.py` (`merge`, `decide`) unmodified on each call rebuilt on `lab/scrub.py`'s made-up machine. `tests/test_guard.py::RealGuardrail` pins what the real one does on the recorded calls, including the `find /` hole: if upstream fixes it those tests and the lesson claims fail on purpose; `S.guard.calls` are the real tool calls flattened from `runs.json`. `reaches_outside` is the reference label, so "escape" is this lab's definition. Errors in the learner's own `allowed()` come back as data (`raw`, not `call`) and show on the card. Native tests: `tests/test_guard.py` (they pin the numbers the lesson's `expects` rely on). The **Output** tab (`S.guard.tab`, `scrubDrawer`) tests `lab/scrub.py`: `scrub` is the function `scripts/record_runs.py` imports and runs on every saved file (proved identical to the old inline version before the move); the lab rebuilds the recorded texts on a made-up machine (`machine()`, `raw_text`) because the real raw output is never saved and the real home path must not enter the repo. `detect` is also run by `check_recorded.py`.
- `web/sw.js` is cache-first for app assets and Pyodide; its asset list and a version hash come from the generated `web/sw-manifest.js`.

## Key design rules (do not break)
- `vendor/` is byte-identical upstream, hash-checked (`scripts/check_vendor.py`; weekly `upstream-drift` workflow). Never edit it. Refresh with
  `python3 scripts/vendor.py --map <clean clone of agent-knowledge-map> --toolkit <clean clone of agent-toolkit>`.
  **Use fresh `git clone --depth 1` of `squarepegg/agent-toolkit` and `agent-knowledge-map`.** `~/projects/me/agent-toolkit` is a different repo (`unsafe-agent-toolkit`); using it gives bogus diffs.
- Lesson answers are **computed** from the real run, never hard-coded; `lessonPick` throws if an answer is not one of the choices. Every causal sentence needs `claims`.
- Tweaks (`TWEAKS` in `codepanel.js`) match upstream source with an exact `find` string; `model.test.mjs` asserts each matches once. A vendor refresh that moves a line fails loudly.
- Edits never touch the real module for longer than one call (`run_edit` restores; `check_fn` runs a copy).
- `web/bundle.json`, `web/runs.json` and `web/sw-manifest.js` are generated: **run `python3 scripts/build_bundle.py` after changing anything in `lab/`, `vendor/`, `sample/` or `recorded/`**, or the UI uses stale Python (this bit once: "unknown call check_fn"). `web/recorded.json` is generated by `tests_js/record.mjs` and committed; rerun it when lesson 1 or the Python behind it changes.
- `recorded/` is committed evidence: never edit a file by hand (sha256 in `RUNS.json`; the one exception so far is a deterministic re-scrub with `lab/scrub.py`, after which the hashes were rewritten). Re-record with `scripts/record_runs.py` (needs `pi` and model access; it spends money: the four `dst` files cost about $5 per pass, and a model that flails costs more). On macOS each answer runs under `scripts/sandboxed_pi.py`; do not record without it (`--no-sandbox` warns): without isolation the models find and read other trees on disk. `tests/test_sandbox.py` checks the confinement.

## Run / test
```sh
python3 scripts/build_bundle.py && python3 -m http.server -d web 8000        # http://localhost:8000
python3 -W ignore -m unittest discover -s tests                              # 51 native tests
python3 scripts/check_vendor.py && python3 scripts/check_recorded.py
cd tests_js && node --test model.test.mjs && node smoke.mjs                  # 21 unit tests, Pyodide smoke
env -u CI node ui.mjs && env -u CI node ui_modes.mjs && env -u CI node record.mjs --check   # headless Chrome
```
`ui.mjs` plays every mode, lesson (both levels) and challenge; `ui_modes.mjs` covers JavaScript off, CDN blocked, CDN slow, service worker offline, 390px phone, beginner wording, Break it, recorded runs, every lesson's `expects`/`miss`, and blocked localStorage. Locally they use `/Applications/Google Chrome.app` (hence `env -u CI` where `CI` is set); CI uses Playwright chromium.

## Known gaps / ideas
- No guided tweaks for `answer`, `tally`, lint tabs (beginners are pointed to experienced level).
- Edits only affect the Try-it cell; the canvas stays on real code (redrawing from an edit was deliberately not built).
- Screenshot helper pattern: small playwright script in `tests_js/` (needs its `node_modules`), written to `/tmp`, then deleted.

## Style the user wants
Short answers, evidence before "done" (test output), ask before pushing, no unrequested extras, end replies that need input with a single `WAITING ON YOU:` line.
