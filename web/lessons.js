// Guided lessons. Data, not UI: app.js walks these steps.
//
// step = { mode, text, exp?, hint?, deeper?, setup?: [[action, ...args]], 
//          predict?: { q, choices: [string], run: [[action, ...]], answer(ctx) -> one of choices, why(ctx) -> string } }
// Answers are COMPUTED from the real upstream code's output after the run, never hard-coded, so a vendor refresh can
// change a result without leaving a lesson that lies. The UI throws if answer() is not one of the choices.
// ctx = { S, call }.
const top = (r) => (r && r[0] ? r[0].path.split("/").pop().replace(/\.md$/, "") : "(nothing)");
const edit = (ctx, mode) => Object.entries(ctx.S.edits).find(([k]) => k.startsWith(mode + ":"))?.[1]?.out;
const head = (S, path) => (S.files[path] || "").split("\n").slice(0, 8).join("\n");
// only the lines rank() treats as a file's "head": title / name / description / tags / aliases / heading
const heading = (S, path) => head(S, path).split("\n").filter((l) => /^\s*(title|name|description|tags|aliases)\s*:|^#\s/.test(l)).join("\n");
const hitPaths = (call, S, q) => [...new Set(call("search", { files: S.files, query: q }).map((x) => x.path))];
const nFiles = (S, w) => Object.values(S.files).filter((t) => new RegExp(w, "i").test(t)).length;
const BACKFILL = "facts/airflow-backfill-concurrency.md";

export const LESSONS = [
  {
    id: "eval", title: "What is an eval?", blurb: "A question plus a pass/fail check. No model involved.",
    steps: [
      { mode: "evals", setup: [["replay", "midnight-mismatch"]],
        text: "An **eval** is a question plus a rule for what a good answer contains. Here the \"agent\" is just a search over a small knowledge base, so the result never varies. Watch the replay: the search runs, files light up in rank order, then each check ticks.",
        exp: "An eval here is `{run: {search}, expect, first_line, forbid}` graded by `eval_run.check`, a pure function of (question, output). The agent is `brain.search`: deterministic, so any change in verdict comes from the code or the data, never from sampling.",
        deeper: "Open the code panel: `check` is 5 lines. Notice it never sees the question, only the output." },
      { mode: "evals", setup: [["qreset"]],
        predict: { q: "I add an eval that expects the text `this-string-is-not-in-the-brain`. Pass or fail?", choices: ["PASS", "FAIL"], run: [["qreset"], ["bad", 1]],
          answer: ({ S }) => (S.results.at(-1).pass ? "PASS" : "FAIL"),
          claims: [["the expected string is absent from the search output", ({ S }) => !S.results.at(-1).output.includes("this-string-is-not-in-the-brain")]],
          why: () => "`expect` strings must appear in the search output. Nothing contains this one, so it fails, and the failing check is shown as ✘." },
        hint: "`expect` is a list of strings the output must contain." },
      { mode: "evals",
        predict: { q: "Now an eval that FORBIDS `orders.created_at`, on a search whose top file contains it. Pass or fail?", choices: ["PASS", "FAIL"], run: [["qreset"], ["bad", 3]],
          answer: ({ S }) => (S.results.at(-1).pass ? "PASS" : "FAIL"),
          claims: [["the forbidden string is present in the search output", ({ S }) => S.results.at(-1).output.includes("orders.created_at")]],
          why: () => "`forbid` is the opposite of `expect`: the string must be absent. It is present, so this fails. Evals can guard against wrong content as well as missing content." } },
      { mode: "evals",
        predict: { q: "I replace the grader with one that always passes (Try-it tweak “Always pass”) and re-run the suite, which includes my failing evals. How many fail?",
          choices: ["None: the suite goes green", "The same ones as before", "All of them"], run: [["qreset"], ["bad", 1], ["bad", 3], ["sel", null], ["tweak", 2]],
          answer: (ctx) => { const o = edit(ctx, "evals"); if (!o || o.error) throw new Error("tweak did not run"); return o.edited.summary.ok ? "None: the suite goes green" : JSON.stringify(o.edited) === JSON.stringify(o.base) ? "The same ones as before" : "All of them"; },
          claims: [["the suite really had failing evals before the edit", (ctx) => !edit(ctx, "evals").base.summary.ok]],
          why: () => "A broken grader turns every eval green, and nothing in the suite notices. Evals test the knowledge; nobody tests the evals. That is what the next lesson fixes, by breaking things on purpose." },
        hint: "What does a grader that returns True do to the evals that were failing?" },
    ],
  },
  {
    id: "rank", title: "Why does this file rank first?", blurb: "The ranking function, and what each part of it buys.",
    steps: [
      { mode: "explore", text: "A search has to decide which file answers your question. The real `rank` function scores every line, rewards **rare** words, and rewards files whose **title or tags** contain the word. You will change those rules and watch the order move.",
        exp: "`brain.rank`: stemmed prefix match, idf weights over files, a line scores the sum of the weights of its terms, file score = best line + HEAD_WEIGHT × head-term weight, ties by path. Deterministic by construction.", deeper: "Try the tabs: `query_words` runs before `rank` and drops stop words." },
      { mode: "explore", setup: [["search", "timestamps late"]],
        predict: { q: "I search `timestamps late`. Which file ranks #1?", choices: ["orders-timestamps-utc", "incremental-models-miss-late-rows", "mobile-events-arrive-late"], run: [["search", "timestamps late"]],
          answer: ({ call, S }) => top(call("search", { files: S.files, query: "timestamps late" })),
          claims: [["the #1 file's title or tags mention “timestamps”", ({ call, S }) => /timestamps/i.test(heading(S, hitPaths(call, S, "timestamps late")[0]))],
                   ["neither other candidate's title or tags mention “timestamps”", ({ call, S }) => hitPaths(call, S, "timestamps late").slice(1, 3).every((p) => !/timestamps/i.test(heading(S, p)))]],
          why: ({ call, S }) => `\`${top(call("search", { files: S.files, query: "timestamps late" }))}\`: its title contains “timestamps”, and the title is weighted. The other two only match “late”.` },
        hint: "Which file's title contains the word that is rarer across the knowledge base?" },
      { mode: "explore",
        predict: { q: "Now I switch off the rare-word weighting (“Flat word weights”) and run the same search. Does #1 change?", choices: ["Same #1", "A different file is #1"], run: [["search", "timestamps late"], ["tweak", 0]],
          answer: (ctx) => { const o = edit(ctx, "explore"); if (!o || o.error) throw new Error("tweak did not run"); return top(o.base) === top(o.edited) ? "Same #1" : "A different file is #1"; },
          claims: [["“late” is in more files than “timestamps”", ({ S }) => nFiles(S, "\\blate\\b") > nFiles(S, "timestamps")]],
          why: (ctx) => { const o = edit(ctx, "explore"); return `Real: \`${top(o.base)}\`. Without idf: \`${top(o.edited)}\`. “late” appears in many files and “timestamps” in few; flat weights stop preferring the rare word.`; } } },
      { mode: "explore",
        predict: { q: "Instead I ignore titles and tags (“Ignore titles and tags”). Does #1 change?", choices: ["Same #1", "A different file is #1"], run: [["search", "timestamps late"], ["tweak", 1]],
          answer: (ctx) => { const o = edit(ctx, "explore"); if (!o || o.error) throw new Error("tweak did not run"); return top(o.base) === top(o.edited) ? "Same #1" : "A different file is #1"; },
          claims: [["the real #1's title or tags mention “timestamps”", (ctx) => /timestamps/i.test(heading(ctx.S, edit(ctx, "explore").base[0].path))],
                   ["the file that wins without the title boost has no such title or tag", (ctx) => { const e = edit(ctx, "explore").edited[0]; return !!e && !/timestamps/i.test(heading(ctx.S, e.path)); }]],
          why: (ctx) => { const o = edit(ctx, "explore"); return `Real: \`${top(o.base)}\`. Without the title boost: \`${top(o.edited)}\`. A file that is *about* the word now loses to one that merely contains it.`; } } },
    ],
  },
  {
    id: "break", title: "Break it: does anything notice?", blurb: "Mutation testing: the way to test your evals.",
    steps: [
      { mode: "break", text: "If you delete a fact and every eval still passes, the evals would not have noticed it vanishing. That is a **blind spot**. Deliberately breaking things (a *mutation*) and counting which evals notice is how you test the evals themselves.",
        exp: "Mutation testing applied to a knowledge base: each mutant (delete file, remove text) is run against the suite; killed = some eval fails. The score is killed/total." },
      { mode: "break",
        predict: { q: "I delete `facts/airflow-backfill-concurrency.md`. Does any eval fail?", choices: ["Yes, an eval fails", "No, nothing notices"], run: [["break", { op: "delete_file", path: BACKFILL }]],
          answer: ({ S }) => (S.whatif?.res?.survived ? "No, nothing notices" : "Yes, an eval fails"),
          claims: [["the deletion really survived", ({ S }) => !!S.whatif?.res?.survived],
                   ["another file still contains `max-active-runs`", ({ S }) => Object.entries(S.files).some(([p, t]) => p !== BACKFILL && t.includes("max-active-runs"))],
                   ["the `backfill` eval has no first_line requirement", ({ S }) => { const b = ("\n" + S.questions).split("\n- id:").find((x) => x.trim().startsWith("backfill")); return !!b && !b.includes("first_line"); }]],
          why: ({ S }) => S.whatif?.res?.survived ? "SURVIVED. The `backfill` eval only requires the string `max-active-runs` to appear somewhere, and another file (a workstream note) also contains it. The eval cannot tell the right source from any source." : `Killed by ${S.whatif.res.killed_by.join(", ")}.` },
        hint: "The eval asks that a string appears in the output. Could another file contain it?" },
      { mode: "break",
        predict: { q: "I press “Auto-mutate everything” (deletes and text removals on every fact). What fraction of mutants do the evals kill?", choices: ["Under 50%", "50% to 80%", "Over 80%"], run: [["auto"]],
          answer: ({ call, S }) => { const s = call("auto_mutants", { files: S.files, questions: S.questions }).score; return s < 0.5 ? "Under 50%" : s <= 0.8 ? "50% to 80%" : "Over 80%"; },
          why: ({ call, S }) => { const r = call("auto_mutants", { files: S.files, questions: S.questions }); return `${r.killed}/${r.total} killed (${Math.round(r.score * 100)}%). Click a SURVIVED row to see why, then “Add this eval” to close the gap and watch the score rise.`; } } },
    ],
  },
  {
    id: "gate", title: "The gate: from results to a verdict", blurb: "Fixed rules, checked in order, first one to fire wins.",
    steps: [
      { mode: "gate", setup: [["preset", "Skill clearly helps"]],
        text: "Suppose you tested a skill (an instruction file) on a set of probe questions, with and without it. A **gate** turns those counts into one verdict using fixed rules, in a fixed order. The same inputs always give the same verdict. Click cells to flip outcomes; edit thresholds.",
        exp: "`gate.decide(candidate, results) -> (verdict, facts)`: pure. Rules in order: INCONCLUSIVE, REGRESSION, CEILING, NO_DELTA, TOO_COSTLY, else ADOPT. Thresholds come from a candidate file registered before the run." },
      { mode: "gate",
        predict: { q: "Preset “Already good (ceiling)”: the model answers every probe correctly even WITHOUT the skill. Which verdict?", choices: ["ADOPT", "NO_DELTA", "CEILING"], run: [["preset", "Already good (ceiling)"]],
          answer: ({ S }) => S.gate.res.verdict,
          claims: [["baseline is at or above the ceiling", ({ S }) => S.gate.res.facts.dev_without / S.gate.res.facts.dev_n >= S.gate.params.ceiling], ["NO_DELTA's own test would also have tripped (gain < min_gain)", ({ S }) => S.gate.res.facts.gain < S.gate.params.min_gain]],
          why: ({ S }) => `${S.gate.res.verdict}: ${S.gate.res.reason}. CEILING is checked before NO_DELTA because “no gain” would be the wrong explanation: there was simply no room to gain.` },
        hint: "Both arms score 12/12. Is there room for the skill to show a gain?" },
      { mode: "gate",
        predict: { q: "Preset “Helps dev, hurts one”: the skill improves some probes but makes one worse. Which verdict?", choices: ["ADOPT", "REGRESSION", "NO_DELTA"], run: [["preset", "Helps dev, hurts one"]],
          answer: ({ S }) => S.gate.res.verdict,
          claims: [["a probe really regressed", ({ S }) => S.gate.res.facts.regressed.length > 0], ["the skill still gains overall", ({ S }) => S.gate.res.facts.gain > 0]],
          why: ({ S }) => `${S.gate.res.verdict}: ${S.gate.res.reason}. REGRESSION is checked early: a skill that breaks something is rejected however much it helps elsewhere.` } },
      { mode: "gate",
        predict: { q: "Back to “Skill clearly helps”, but I set min_gain to 99. Which verdict?", choices: ["ADOPT", "NO_DELTA", "TOO_COSTLY"], run: [["preset", "Skill clearly helps"], ["param", "min_gain", 99]],
          answer: ({ S }) => S.gate.res.verdict,
          claims: [["the skill does gain", ({ S }) => S.gate.res.facts.gain > 0], ["but less than the threshold", ({ S }) => S.gate.res.facts.gain < S.gate.params.min_gain]],
          why: ({ S }) => `${S.gate.res.verdict}: ${S.gate.res.reason}. Thresholds are part of the decision. That is why the real gate refuses thresholds that were edited after the results were in.` } },
    ],
  },
  {
    id: "skill", title: "A skill that sounds right but isn't", blurb: "Why text coverage is only a proxy.",
    steps: [
      { mode: "abskill", text: "Skills are judged by probe questions with **substring grading**: the answer must contain certain phrases. Here no model answers; we check whether the skill text even contains the phrases. Real evidence needs recorded model runs, and the gate then judges them identically.",
        exp: "`ab_skill`: lint (`check_skills`), then per-probe text coverage via `skill_ab.missing`, then `gate.decide` on a fixture. Coverage is a necessary-not-sufficient proxy." },
      { mode: "abskill",
        predict: { q: "A skill that says only “Lorem ipsum” (valid header, no content). What does the gate say?", choices: ["ADOPT", "NO_DELTA", "CEILING"], run: [["skill", "filler"]],
          answer: ({ S }) => S.skill.res.gate.verdict,
          claims: [["lint reports no errors", ({ S }) => S.skill.res.lint.errors.length === 0], ["the text covers none of the probes", ({ S }) => S.skill.res.coverage.every((c) => !c.covered)]],
          why: ({ S }) => `${S.skill.res.gate.verdict}: ${S.skill.res.gate.reason}. It passes lint (the header is fine) but helps with nothing, and the gate says so.` } },
      { mode: "abskill",
        predict: { q: "A skill that is JUST the list of expected keywords, with no explanation at all. Verdict?", choices: ["ADOPT", "NO_DELTA", "REGRESSION"], run: [["skill", "stuffed"]],
          answer: ({ S }) => S.skill.res.gate.verdict,
          claims: [["the text is only keywords (no sentence of 6+ words)", ({ S }) => S.skill.text.split("---").pop().split(/[.\n]/).every((l) => l.trim().split(/\s+/).filter(Boolean).length < 40)],
                   ["every probe is nevertheless covered", ({ S }) => S.skill.res.coverage.every((c) => c.covered)]],
          why: ({ S }) => `${S.skill.res.gate.verdict}: ${S.skill.res.gate.reason}. Substring grading cannot tell understanding from keyword stuffing. This is why a grader needs its own tests (try “Accept ANY expected phrase” in the Try-it cell), and why a model-written answer should also be judged by something stronger.` },
        hint: "The grader looks for phrases in text. What if the text is only phrases?" },
    ],
  },
];

// Every `why` makes causal claims. Each claim is a predicate over the real run; the UI shows the explanation only when all hold,
// otherwise it says the explanation is out of date, so a vendor refresh cannot leave a lesson that lies.
export function checkClaims(predict, ctx) {
  const failed = [];
  for (const [desc, fn] of predict.claims || []) { let ok = false; try { ok = !!fn(ctx); } catch { ok = false; } if (!ok) failed.push(desc); }
  return failed;
}
