# agent-lab handover

Repo: `~/projects/me/agent-lab` (github.com/squarepegg/agent-lab, branch `main`, deployed by the `pages` workflow).
Goal: make the site truly interactive for learning the Python behind agent evals, for **beginners and experienced** engineers.
State at handover (`cd3257b`): steps 1 to 4 done and pushed; CI, pages and upstream-drift all green. Step 5 and one lesson remain.

## What it is
Static site. Pyodide runs the **real, unmodified** upstream Python (`vendor/`: `brain.py`, `eval_run.py`, `gate.py`, `skill_ab.py`, `check_skills.py`, helpers)
from `squarepegg/agent-knowledge-map` and `squarepegg/agent-toolkit`. No server, no secrets, no model calls. See `README.md` for modes.

## Build order (the agreed plan) and status
| # | Step | Status | Where |
|---|---|---|---|
| 1 | Code panel: real function per mode, executed lines highlighted (`sys.settrace`), beginner/experienced **level** chip | done | `web/codepanel.js`, `lab/api.py` `trace`, `codePanel()` in `web/app.js` |
| 2 | Edit-and-run cell: guided tweaks (beginner) / full editor (experienced), compare real vs edited, always restored, 400k-line loop budget | done | `run_edit` in `lab/api.py`, `TWEAKS`/`brief`/`lineDiff` in `codepanel.js`, `editCell()` |
| 3 | Guided lessons, predict-then-reveal, answers computed from the real run, progress in localStorage | done | `web/lessons.js` (5 lessons, 14 steps), `lessonCard()` etc. in `app.js` |
| 3b | Claim-checked explanations: each `why` has `claims` predicates; page shows a warning instead of the sentence if one fails | done | `checkClaims` in `lessons.js` |
| 4 | Six auto-checked challenges with 3-hint ladders; code challenge judged by `check_fn` | done | `web/challenges.js`, `check_fn` in `lab/api.py`, `chalCard()` |
| 5 | **Bring-your-own-key live model cell** | **not started** | see below |
| 6 | Lesson "why one run isn't enough" (pass@k, variance) using upstream `vendor/_attempts.py` | not started | |

## Step 5 design (decided with the user)
- The user's own key must never be in the site. A learner pastes **their own** provider API key; keep it in memory only (never localStorage, never in the URL/share link), calls go browser to provider.
- Optional, clearly labelled; offline fixtures stay the default so the lab is reproducible and safe.
- Purpose: run the same grader (`skill_ab.missing`) on a real model's answer, show variance across N samples, feed the gate.
- Open questions to settle first: which provider(s) allow browser CORS calls (Anthropic needs `anthropic-dangerous-direct-browser-access`), cost cap / sample limit, and how a recorded run is fed to `gate_from_grid`.

## Key design rules (do not break)
- `vendor/` is byte-identical upstream, hash-checked (`scripts/check_vendor.py`; weekly `upstream-drift` workflow). Never edit it. Refresh with
  `python3 scripts/vendor.py --map <clean clone of agent-knowledge-map> --toolkit <clean clone of agent-toolkit>`.
  **Use fresh `git clone --depth 1` of `squarepegg/agent-toolkit` and `agent-knowledge-map`.** `~/projects/me/agent-toolkit` is a different repo (`unsafe-agent-toolkit`); using it gives bogus diffs.
- Lesson answers are **computed** from the real run, never hard-coded; `lessonPick` throws if an answer is not one of the choices. Every causal sentence needs `claims`.
- Tweaks (`TWEAKS` in `codepanel.js`) match upstream source with an exact `find` string; `model.test.mjs` asserts each matches once. A vendor refresh that moves a line fails loudly.
- Edits never touch the real module for longer than one call (`run_edit` restores; `check_fn` runs a copy).
- `web/bundle.json` is generated: **run `python3 scripts/build_bundle.py` after changing anything in `lab/`, `vendor/` or `sample/`**, or the UI uses stale Python (this bit once: "unknown call check_fn").

## Run / test (all passing at handover)
```sh
python3 scripts/build_bundle.py && python3 -m http.server -d web 8000        # http://localhost:8000
python3 -W ignore -m unittest discover -s tests                              # 46 tests
cd tests_js && node --test model.test.mjs && node smoke.mjs && node ui.mjs    # 14 unit, Pyodide smoke, headless Chrome (plays every lesson + challenge)
python3 scripts/check_vendor.py [--upstream squarepegg/agent-knowledge-map squarepegg/agent-toolkit]
```
`ui.mjs` locally uses `/Applications/Google Chrome.app`; CI uses Playwright chromium. It takes ~20s.

## Known gaps / ideas
- Tweak "why" notes sometimes say "try preset X" when you are already on it.
- No guided tweaks for `answer`, `tally`, lint tabs (beginners are pointed to experienced level).
- Edits only affect the Try-it cell; the canvas stays on real code (redrawing from an edit was deliberately not built).
- `sed -i` is broken in this shell environment (BSD sed); use python for in-place edits.
- Screenshot helper pattern: small playwright script in `tests_js/` (needs its `node_modules`), written to `/tmp`, then deleted.

## Style the user wants
Short answers, evidence before "done" (test output), ask before pushing, no unrequested extras, end replies that need input with a single `WAITING ON YOU:` line.
