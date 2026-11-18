# Starting the next session

Read, in this order: `personal-brain/workstreams/agent-lab/STATE.md`, `docs/HANDOVER.md` (design rules, how to run everything), `docs/UX-REVIEW.md`
(the redesign and why). Do not re-audit; the numbers are in the review.

## Where things stand (2026-11-18)
Steps 2 to 7 of `docs/UX-REVIEW.md` are built and tested (Start screen with doors and case file; Trace mode and the Observability beats; the Evals and
Guardrails beats with doors; two short cases; tappable squares on a phone; an opt-in playtest log). **No human has played any of it.** The next
session is a playtest, not more building: put five people in front of `?playtest=1`, download the logs, and check the success criteria at the end of
`docs/UX-REVIEW.md` (a choice in under 10 s, a reaction in under 30 s, two different routes under 10 minutes each, four of five can say what each
pillar is for). Then fix what they stall on.

## Note: map PR #3 (`agent-knowledge-map`, `fix/guard-lone-root`)
The PR makes a lone `/` the filesystem root in `guard_hook.py`, so `find /` is no longer allowed. agent-lab pins the old behaviour on purpose, so
**merging it breaks these until you do the work below**. Do not "fix" the failing tests by loosening them; the lesson was written around the hole.

When it merges:
1. Fresh clones of both upstream repos (`git clone --depth 1`), then `python3 scripts/vendor.py --map <map> --toolkit <toolkit>`, `python3 scripts/build_bundle.py`.
2. Expect these to fail, in this order: `python3 -m unittest tests.test_guard` (`RealGuardrail`: the find-/ tests and the attacks test), then `node tests_js/ui_modes.mjs`
   (the two real-guardrail lesson steps in `web/lessons.js`, `guardreal` lesson steps 2 and 3; the short-case guard lessons use the lab's own rules and are unaffected).
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
