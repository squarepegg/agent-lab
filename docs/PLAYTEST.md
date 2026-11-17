# Playtest, 2026-11-16

Two walks through the site in headless Chrome at 1440x860 (and 390x844), driven by a script and read by me from screenshots. **No human played it.**
Treat the stuck points as findings from a careful read, not user research. Each persona walked the same build after the fixes in this change.

## Beginner (new to evals and Python)
Path: Start screen, lesson 1 (all four steps, one wrong pick on purpose), back to Start, then the Gate and Break it screens at beginner level.

| Where | What got in the way | Status |
|---|---|---|
| Cold load | Nothing. The headline, three ideas and the first question show at once; the chip says "Python 1% · downloading Python" while lesson 1 already works. (`cold-load-home.png`) | ok |
| Lesson 1, step 1, wrong pick | The miss text said why the pick was reasonable and what the check really reads. No dead end. | ok |
| Lesson 1, step 4 | The question says "I replace the grader". The open "Try it" fold below it shows a live **Run with my edit** button, which looks like something the reader must press. They do not need to. (`beginner-lesson1-step4.png`) | open |
| Any answered step | After a long explanation, Back and Next sat below the fold (`experienced-lesson1-answered-before-fix.png`). | fixed: the row is sticky (`...after-fix.png`) |
| Gate | "costs 1 times as much". | fixed: "costs the same" |
| Gate | "hidden test 0 → 9" is not explained anywhere on the beginner screen. (`beginner-gate.png`) | open |
| Phone, any mode | The "look at" strip rendered under the summary and overlapped it; summary text was 10 to 11px. (`phone-gate-before-fix.png`) | fixed |
| Python fails to load | Picking an answer on a lesson that was not recorded only flashed a toast. | fixed: the card says Python could not load |

## Experienced Python developer
Path: Start screen with level set to "I write Python", lesson 1 step 1, Map and a search, the Gate.

| Where | What got in the way | Status |
|---|---|---|
| Lesson 1 | Explanations use upstream names (`eval_run.check`, `brain.search`) and the `{run, expect, first_line, forbid}` shape, which is what this reader wants. The Python fold is closed until "Show the Python that ran". | ok |
| Map search | Rank badges sit on top of the end of long truncated titles (`experienced-map-search.png`). | open (cosmetic) |
| Gate | Upstream parameter names (`min_gain`, `ceiling`) are shown, and the vendored `decide` is one click away. | ok |
| Light theme | Gate and map are readable once the 0.2 s colour transition ends (`light-gate.png`). | ok |

## Not reviewed
Find (⌘K) and keyboard-only use were not walked. Lessons 2 to 7 were played by the tests (every answer, every claim, every `miss`) but not read on screen by a person.
