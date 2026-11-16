// Challenges: a goal, a starting state, a hint ladder, and a checker that runs the REAL code on your result.
// check(ctx) -> [{label, ok, detail?}]; the challenge is done when every criterion is ok.
// ctx = { S, call, qs (questions text in the editor), gpa (probe-grader text), base (original questions) }.
// A challenge with `code` is checked by running your edited function against the cases (api `check_fn`), never touching the real module.
const BACKFILL = "facts/airflow-backfill-concurrency.md";
const parsed = (ctx) => { try { return { r: ctx.call("run_evals", { files: ctx.S.files, questions: ctx.qs }) }; } catch (e) { return { err: e.message }; } };

export const CHALLENGES = [
  {
    id: "survivor", title: "Catch the survivor", mode: "evals", setup: [["qreset"]],
    goal: "Deleting `facts/airflow-backfill-concurrency.md` currently goes unnoticed. Edit `questions.yaml` (press **Apply YAML**) so an eval fails when that file is deleted, while every eval still passes on the intact knowledge base.",
    hints: ["An eval can say which file must come first: `first_line:` takes part of a file name.", "Search for `backfill concurrency` and require `first_line: airflow-backfill-concurrency`.",
      "```\n- id: backfill-source\n  q: Which fact owns backfill concurrency?\n  run: {search: backfill concurrency}\n  expect: [max-active-runs]\n  first_line: airflow-backfill-concurrency\n  tier: must\n```"],
    check(ctx) {
      const p = parsed(ctx); if (p.err) return [{ label: "questions.yaml parses", ok: false, detail: p.err }];
      const n0 = ctx.call("parse_yaml", { text: ctx.base }).length, n1 = ctx.call("parse_yaml", { text: ctx.qs }).length;
      const sv = ctx.call("mutate", { files: ctx.S.files, questions: ctx.qs, mutation: { op: "delete_file", path: BACKFILL } });
      return [{ label: "every must eval passes on the intact files", ok: p.r.summary.ok, detail: `${p.r.summary.must_pass}/${p.r.summary.must_total}` },
        { label: "you added at least one eval", ok: n1 > n0 }, { label: "deleting the backfill fact is now noticed", ok: !sv.survived, detail: sv.survived ? "still SURVIVED" : "killed by " + sv.killed_by.join(", ") }];
    },
  },
  {
    id: "score", title: "Lift the mutation score to 80%", mode: "break", setup: [["qreset"]],
    goal: "The evals kill 11 of 15 mutants (73%). Add evals until at least **80%** are killed, with every eval still passing. Some survivors are just redundancy and cannot be fixed; you only need the score.",
    hints: ["Press “Auto-mutate everything”, then click a SURVIVED row.", "The card under it explains why it survived and offers a verified fix.", "Press “Add this eval” on a survivor that has a fix. Repeat until the score reaches 80%."],
    check(ctx) {
      const p = parsed(ctx); if (p.err) return [{ label: "questions.yaml parses", ok: false, detail: p.err }];
      const m = ctx.call("auto_mutants", { files: ctx.S.files, questions: ctx.S.questions });
      return [{ label: "every must eval passes", ok: p.r.summary.ok }, { label: "mutation score ≥ 80%", ok: m.score >= 0.8, detail: `${m.killed}/${m.total} (${Math.round(m.score * 100)}%)` }];
    },
  },
  {
    id: "costly", title: "Helps, but too expensive", mode: "gate", setup: [["preset", "Skill clearly helps"]],
    goal: "With “Skill clearly helps” the gate says ADOPT. Without touching a single outcome cell, make it say **TOO_COSTLY**.",
    hints: ["The verdict depends on thresholds as well as outcomes.", "Which threshold compares what the skill costs with what the baseline costs?", "Lower `max_cost_ratio` below the current cost ratio, or raise `_cand_cost`."],
    check: ({ S }) => [{ label: "verdict is TOO_COSTLY", ok: S.gate.res.verdict === "TOO_COSTLY", detail: S.gate.res.verdict }, { label: "the skill still gains (so it is cost, not effect)", ok: S.gate.res.facts.gain > 0 }],
  },
  {
    id: "tolerated", title: "How much regression does the gate tolerate?", mode: "gate", setup: [["preset", "Skill clearly helps"]],
    goal: "Starting from “Skill clearly helps”, make one probe **worse** with the skill than without (fewer correct answers) and still get **ADOPT**, by flipping outcome cells only.",
    hints: ["Thresholds stay as they are: change cells, not numbers.", "`regress_by` is 2: what is the smallest drop that is NOT a regression?", "On one probe, make the “without” cells ✔✔✔ and the “with” cells ✔✔✘."],
    check: ({ S }) => { const g = S.gate.grid, dropped = Object.values(g).some((a) => a.with.filter(Boolean).length < a.without.filter(Boolean).length);
      return [{ label: "verdict is ADOPT", ok: S.gate.res.verdict === "ADOPT", detail: S.gate.res.verdict }, { label: "at least one probe got worse with the skill", ok: dropped }, { label: "thresholds unchanged", ok: S.gate.params.regress_by === 2 && S.gate.params.min_gain === 2 }]; },
  },
  {
    id: "opposite", title: "Fool the grader", mode: "gate", setup: [["preset", "Skill clearly helps"]],
    goal: "In the **probe grader** (bottom of the gate panel), write an answer that the grader marks **correct** while saying the *opposite* of the truth: it must contain “not” or “never”, in 30 words or fewer.",
    hints: ["The grader looks for phrases anywhere in the text.", "Use the probe's expected phrases, but negate them.", "e.g. “It is not adversarial and never fresh.” for the doubt-framing probe."],
    check({ S, call, gpa }) {
      const t = gpa || "", g = call("grade", { probe: S.gate.probes[S.gate.pg], text: t });
      return [{ label: "the grader marks it correct", ok: g.correct, detail: g.correct ? "" : "missing " + JSON.stringify(g.missing) }, { label: "it contains “not” or “never”", ok: /\b(not|never)\b/i.test(t) }, { label: "30 words or fewer", ok: t.trim().split(/\s+/).filter(Boolean).length <= 30 && !!t.trim() }];
    },
  },
  {
    id: "fixgrader", title: "Fix the grader", mode: "abskill", setup: [], code: { file: "skill_ab.py", fn: "missing" },
    goal: "`skill_ab.missing` is the probe grader. Edit it below so it passes the unit tests: hyphen and spacing differences should not matter, and a phrase must match whole words (`unknown bug` is not `known bug`). The last three tests must keep passing.",
    hints: ["Normalise both the text and each phrase the same way before comparing.", "Replace every run of non-word characters with one space, lowercase, and pad with a space on each side.", "```\nimport re\nnorm = lambda s: re.sub(r\"[\\W_]+\", \" \", s.lower()).strip()\nlow = \" \" + norm(text) + \" \"\nreturn [g[0] for g in probe[\"expect\"] if not any(\" \" + norm(a) + \" \" in low for a in g)]\n```"],
    cases: [
      { name: "hyphen is the same as a space", args: [{ expect: [["known bug"]] }, "It is a known-bug test"], expect: [] },
      { name: "case and extra spaces are ignored", args: [{ expect: [["known bug"]] }, "KNOWN   BUG pinned"], expect: [] },
      { name: "whole words only: “unknown bug” is not “known bug”", args: [{ expect: [["known bug"]] }, "an unknown bug appeared"], expect: ["known bug"] },
      { name: "still reports the group that is missing", args: [{ expect: [["a"], ["b"]] }, "a only"], expect: ["b"] },
      { name: "empty answer misses everything", args: [{ expect: [["known bug"]] }, ""], expect: ["known bug"] },
      { name: "any phrasing in a group is accepted", args: [{ expect: [["150"], ["no docker", "without docker"]] }, "about 150 seeds, without Docker"], expect: [] },
    ],
  },
];
