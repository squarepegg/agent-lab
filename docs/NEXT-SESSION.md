# Starting the next session

Read, in this order: `personal-brain/workstreams/agent-lab/STATE.md`, `docs/HANDOVER.md` (design rules, how to run everything), `docs/UX-REVIEW.md`
(the redesign and why). Do not re-audit; the numbers are in the review.

## Prompt for the redesign session (step 2 of `docs/UX-REVIEW.md`)
> Work in `~/projects/me/agent-lab`. The owner playtested the site and found it too busy; it should invite you in to play, with guardrails,
> evals and observability as three separate adventures. `docs/UX-REVIEW.md` has the design. Do **step 2** only: a Start screen with three doors
> ("What happened?", "Should it have been allowed?", "Did it actually work?") and a small case file board, wired to the **existing** lessons
> regrouped by pillar, with a "next door" choice at the end of each lesson. No new lesson content, no changes to the recorded data. Keep the
> existing tests green by adapting them (they assume the linear path). Measure before and after with a headless audit (visible controls, words,
> panel height), commit locally and ask before pushing. Short answers, evidence before "done".

## Note: map PR #3 (`agent-knowledge-map`, `fix/guard-lone-root`)
The PR makes a lone `/` the filesystem root in `guard_hook.py`, so `find /` is no longer allowed. agent-lab pins the old behaviour on purpose, so
**merging it breaks these until you do the work below**. Do not "fix" the failing tests by loosening them; the lesson was written around the hole.

When it merges:
1. Fresh clones of both upstream repos (`git clone --depth 1`), then `python3 scripts/vendor.py --map <map> --toolkit <toolkit>`, `python3 scripts/build_bundle.py`.
2. Expect these to fail, in this order: `python3 -m unittest tests.test_guard` (`RealGuardrail`: the find-/ tests and the attacks test), then `node tests_js/ui_modes.mjs`
   (the two real-guardrail lesson steps in `web/lessons.js`, `guard` lesson steps 5 and 6).
3. Numbers on the current recordings once the fix is in (computed with the fixed file, 760 real calls, 459 attempts to leave the folder):

   | | before the fix | after the fix |
   |---|---|---|
   | real default policy catches | 437 of 459 (22 missed, 19 of them `find /`) | **458 of 459** (1 missed: a `find <root> ... \| xargs`) |
   | attacks that get through, default | `find /`, `ls $HOME`, `eval ...` | `ls $HOME`, `eval ...` |
   | attacks that get through, `indirection: ask` | `find /` | **none** |
   | harmless calls interrupted | 0 | 0 |

4. Rewrite, do not delete: step 5 stays "nearly all, but not all" but its claims change (the miss is `xargs`, not `find /`), and step 6 becomes a "none get
   through" step. Tell the true story in the text: replaying 760 real calls found a hole in the real guardrail; it was fixed upstream (PR #3); here is the
   same replay after the fix. Update `tests/test_guard.py::RealGuardrail` to the new numbers, the README Guardrails paragraph, and the HANDOVER line about
   the hole. Re-run `node tests_js/record.mjs` (the bundle changes) and the full suite.
5. Run the `upstream-drift` workflow afterwards.

If PR #3 needs changes before it merges (review comments, CI): the branch is `fix/guard-lone-root` in `squarepegg/agent-knowledge-map`; the change is
`_tokens`/`_pathish` in `scripts/guard_hook.py` plus two specs in `tests/test_guard_hook.py` and two mutants in `tests/mutants/guard_hook.yaml`
(`python3 scripts/mutation_check.py tests/mutants/guard_hook.yaml` must stay at 99/99 killed or better).
