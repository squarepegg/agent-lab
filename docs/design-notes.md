# Design notes: what to take from archify (tt-a1i/archify, Apache-2.0; inspiration only, no code copied)

Source read: DESIGN.md, viewer/README.md, hero screenshot. Their north star: "the Evidence Console", one dominant canvas, compact chrome,
progressive disclosure, fixed semantic colour, motion that never carries meaning alone.

## What makes theirs feel good, and what ours does wrong
| archify | agent-lab today | change |
|---|---|---|
| One spatial canvas is the product; everything is a node/edge you can hover | Five tabs of textareas, tables and forms | Make the **map a graph** (nodes: primer, facts, skills, evals, mutants; edges: eval→fact it hits, skill→probe). Tabs become lenses on the same canvas |
| Hover/focus previews relationships (intent-trace), click pins (focus), reachability highlight | None | Hover a fact: light the evals that cover it and the queries that rank it. Hover an eval: light the facts it reads |
| Semantic colour vocabulary: 7 colours, each = a meaning, never decoration | Green/red/blue ad hoc | One legend: fact, skill, eval, probe, mutant, verdict; verdict colours reserved for pass/fail |
| Route Journey / path tracing, guided views | Static result lists | **Step-through** of one eval: query → ranked docs → each expect/forbid ticks in sequence, finishing on a verdict; same for a gate decision (which rule fired, in order) |
| Node finder (search to jump), minimap radar | Separate search box | Cmd-K finder over files, evals, probes |
| Delta view: base vs head architecture | Before/after as two lists | Show A/B as a **diff on the canvas**: new node appears, nodes it displaces/breaks flash red, ranks shift with animated reorder |
| Motion has one owner, 140-200ms, finishes | Instant swaps | Short transitions on state change only; a "kill" animation when a mutant is caught, a "survive" pulse when nobody notices |
| Evidence beacons: every claim links to source lines | Verdict text only | Each verdict has a "why" chip that opens the exact upstream rule/line (gate.py order, eval_run.check) |
| Themes (dark/light/blueprint) keep category identity | Single dark theme | Dark default + light; same colours |
| Mono typography, small caps labels, dense | Default sans, loose cards | JetBrains Mono / system mono, 12px body, 10px tracked labels |
| Export (image, share card, WebM) | None | Share a scenario by URL hash (brain edits + eval + thresholds); export a verdict card PNG |

## Proposed redesign (if you want it)
1. Single full-bleed SVG/canvas graph (no framework; d3-force or hand-rolled layout), slim left toolbar (Map, Evals, Break, Gate, A/B as **modes**), right drawer for details/editing.
2. Modes recolour and animate the same graph instead of swapping pages: Evals mode lights coverage; Break mode lets you click a node and press Delete; A/B mode drags a new node in.
3. Gate mode: a small decision-tree diagram (INCONCLUSIVE → REGRESSION → CEILING → NO_DELTA → TOO_COSTLY → ADOPT) where the path taken lights up as you change thresholds or click sample cells.
4. Keep all Python calls unchanged (`lab/api.py`); this is a front-end rewrite, so the existing 26 native tests + Pyodide smoke stay valid and only `tests_js/ui.mjs` needs new selectors.

Not taking: AI diagram generation, multi-format renderers, community gallery.
