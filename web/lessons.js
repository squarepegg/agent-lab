// Guided lessons. Data, not UI: app.js walks these steps.
//
// lesson = { id, title, blurb, look, learned, steps }. `look` is one line over the canvas: what to look at. `learned` is shown when
// the last step is done.
// step = { mode, text?, exp?, hint?, deeper?, open?, look?, widget?, setup?: [[action, ...args]],
//          predict?: { q, choices, show?, run: [[action, ...]], answer(ctx), claims?, why(ctx), expects?, miss? } }
//   step.look overrides lesson.look; step.open lists folds to open: "poke" (controls), "code" (the Python), "try" (edit-and-run).
//   q is a string or (ctx) => string. show(choice, beginner) -> the label for a choice (plain words for beginners).
// Answers are COMPUTED from the real upstream code's output after the run, never hard-coded, so a vendor refresh can change a
// result without leaving a lesson that lies. The UI throws if answer() is not one of the choices. answer, claims and why may be async.
// miss = { wrongChoice: text }: what makes that wrong answer tempting. It is shown only while the computed answer is still
// `expects` (the answer the texts were written for) and every claim holds.
// ctx = { S, call }.
import { PLAIN_VERDICT, plainReason, runGrid, modelName } from "./model.js";

const top = (r) => (r && r[0] ? r[0].path.split("/").pop().replace(/\.md$/, "") : "(nothing)");
const edit = (ctx, mode) => Object.entries(ctx.S.edits).find(([k]) => k.startsWith(mode + ":"))?.[1]?.out;
const head = (S, path) => (S.files[path] || "").split("\n").slice(0, 8).join("\n");
// only the lines rank() treats as a file's "head": title / name / description / tags / aliases / heading
const heading = (S, path) => head(S, path).split("\n").filter((l) => /^\s*(title|name|description|tags|aliases)\s*:|^#\s/.test(l)).join("\n");
const hitPaths = async (call, S, q) => [...new Set((await call("search", { files: S.files, query: q })).map((x) => x.path))];
const nFiles = (S, w) => Object.values(S.files).filter((t) => new RegExp(w, "i").test(t)).length;
const last = (S) => S.results.at(-1);
const lines = (out) => out.split("\n").filter(Boolean);
// simulated re-runs through the real gate (see lab_core.noise_sweep); the lesson uses the Gate scene's probes and thresholds
const noiseCache = new Map();  // answer(), claims and why() all ask for the same sweep; it is deterministic, so compute it once
export const noise = ({ call, S }, rw, rs, n) => {
  const args = { probes: S.gate.probes, rate_without: rw, rate_with: rs, samples: n, params: S.gate.params }, k = JSON.stringify(args);
  if (!noiseCache.has(k)) noiseCache.set(k, call("noise", args));
  return noiseCache.get(k);
};
const verdictLabel = (c, beg) => (beg ? PLAIN_VERDICT[c] : c);
const gateSays = (S) => (S.level === "beginner" ? plainReason(S.gate.res) : `${S.gate.res.verdict}: ${S.gate.res.reason}.`);
const skillSays = (S) => (S.level === "beginner" ? plainReason(S.skill.res.gate) : `${S.skill.res.gate.verdict}: ${S.skill.res.gate.reason}.`);
const BACKFILL = "facts/airflow-backfill-concurrency.md", ORD = "facts/orders-timestamps-utc.md";
const Q_ZONE = (search) => `- id: order-timezone\n  q: Which time zone are order timestamps stored in?\n  run: {search: ${search}}\n  expect: [UTC]\n  tier: must`;
// recorded model runs (web/runs.json): pick by skill, variant and model family, so a re-recording under new model ids still works
const run = (S, skill, variant, family) => Object.entries(S.runs?.meta.files || {}).find(([, m]) => m.skill === skill && (m.variant || null) === variant && m.model.includes(family))?.[0];
const runRes = (S, name) => S.runs.runs[name];
const armScore = (res, probe, arm) => res.rows.filter((r) => r.probe === probe && r.arm === arm && r.correct && r.finished !== false).length;

export const LESSONS = [
  {
    id: "eval", title: "What is an eval?", blurb: "A question plus a pass/fail check. No model involved.",
    look: "Left: the evals (a green dot means the check passed). Right: the files they search. After you answer, the new eval appears at the bottom left and the files its search found are numbered.",
    learned: "An eval is a question plus an exact-text check on the output. It can fail when the answer is right, pass when it is wrong, and nothing checks the grader itself.",
    steps: [
      { mode: "evals", setup: [["qreset"]],
        text: "An **eval** is a question plus a pass/fail check. This one asks: *Which time zone are order timestamps stored in?* It searches the files for `timestamps` and passes only if the result contains `UTC`.",
        exp: "An eval is `{run: {search}, expect, first_line, forbid}` graded by `eval_run.check`, a pure function of (question, output). The agent is `brain.search`: deterministic, so a verdict only changes when the code or the data does. New eval: `run: {search: timestamps}`, `expect: [UTC]`.",
        predict: { q: "The search finds the right file first: `orders-timestamps-utc.md`, whose title says the timestamps are UTC. Does the eval pass?", choices: ["PASS", "FAIL"], expects: "FAIL",
          run: [["qreset"], ["addq", Q_ZONE("timestamps")]],
          answer: ({ S }) => (last(S).pass ? "PASS" : "FAIL"),
          claims: [["the right file is the top result", ({ S }) => last(S).output.startsWith(ORD + ":")],
                   ["that file does say `UTC`", ({ S }) => S.files[ORD].includes("UTC")],
                   ["the search output does not contain `UTC`", ({ S }) => !last(S).output.includes("UTC")],
                   ["the output does contain lower-case `utc`, in the file name", ({ S }) => last(S).output.includes("-utc.md")]],
          why: ({ S }) => `The check never opens the file. It reads only the lines the search printed, and the top one is \`${lines(last(S).output)[0].replace(/^[^ ]+ /, "")}\`. \`UTC\` is not on it. The file name has \`utc\`, but the check compares exact text, so lower case does not count. An eval grades the output, not the idea.`,
          miss: { PASS: "You said PASS, and the reasoning is fair: the right file came first and it is about UTC." } },
        hint: "The check reads what the search prints, not the whole file." },
      { mode: "evals", setup: [["qreset"]],
        predict: { q: "Same check (`expect: [UTC]`), but now the search is `late rollups final`. That finds a file about mobile events arriving late. It says nothing about order timestamps. Does the eval pass?", choices: ["PASS", "FAIL"], expects: "PASS",
          run: [["qreset"], ["addq", Q_ZONE("late rollups final")]],
          answer: ({ S }) => (last(S).pass ? "PASS" : "FAIL"),
          claims: [["the top result is not the order-timestamps file", ({ S }) => !last(S).output.startsWith(ORD + ":")],
                   ["the order-timestamps file is nowhere in the output", ({ S }) => !last(S).output.includes(ORD)],
                   ["the output contains `UTC` anyway", ({ S }) => last(S).output.includes("UTC")]],
          why: ({ S }) => `The output happens to contain \`UTC\`: \`${(lines(last(S).output).find((l) => l.includes("UTC")) || "").replace(/^[^ ]+ /, "").slice(0, 70)}…\`. That satisfies the check. The eval is green and has told you nothing about order timestamps. A passing eval can be blind; lesson 3 shows how to catch that.`,
          miss: { FAIL: "You said FAIL, which is what a careful person grading by hand would say: the answer is about the wrong thing." } },
        hint: "`expect` only asks whether the text appears somewhere in the output." },
      { mode: "evals", look: "The new eval searches the same files. The question is whether a forbidden string appears in what it finds.", setup: [["qreset"]],
        predict: { q: "Now an eval that FORBIDS `orders.created_at`, on a search whose top file contains it. Pass or fail?", choices: ["PASS", "FAIL"], expects: "FAIL", run: [["qreset"], ["bad", 3]],
          answer: ({ S }) => (last(S).pass ? "PASS" : "FAIL"),
          claims: [["the forbidden string is present in the search output", ({ S }) => last(S).output.includes("orders.created_at")]],
          why: () => "`forbid` is the opposite of `expect`: the string must be absent. It is present, so this fails. Evals can guard against wrong content as well as missing content.",
          miss: { PASS: "You said PASS. With `expect`, finding the string is good news. `forbid` flips that." } } },
      { mode: "evals", look: "The canvas still shows the real grader. The edited grader's verdict is in \u201cTry it\u201d below: compare \u201creal code\u201d with \u201cyour edit\u201d.", open: ["try"], setup: [["qreset"]],
        predict: { q: "I replace the grader with one that always passes (Try-it tweak “Always pass”) and re-run the suite, which includes two failing evals. How many fail?",
          choices: ["None: the suite goes green", "The same ones as before", "All of them"], expects: "None: the suite goes green",
          run: [["qreset"], ["addq", Q_ZONE("timestamps")], ["bad", 3], ["sel", null], ["tweak", 2]],
          answer: (ctx) => { const o = edit(ctx, "evals"); if (!o || o.error) throw new Error("tweak did not run"); return o.edited.summary.ok ? "None: the suite goes green" : JSON.stringify(o.edited) === JSON.stringify(o.base) ? "The same ones as before" : "All of them"; },
          claims: [["the suite really had failing evals before the edit", (ctx) => !edit(ctx, "evals").base.summary.ok]],
          why: () => "A broken grader turns every eval green, and nothing in the suite notices. Evals test the knowledge; nobody tests the evals. That is what lesson 3 fixes, by breaking things on purpose.",
          miss: { "The same ones as before": "You expected the failing evals to keep failing. They would, if anything checked the grader.",
                  "All of them": "You expected everything to fail. The edit makes the grader answer “pass” every time, so the opposite happens." } },
        hint: "What does a grader that returns True do to the evals that were failing?" },
    ],
  },
  {
    id: "rank", title: "Why does this file rank first?", blurb: "The ranking function, and what each part of it buys.",
    look: "The numbered badges are the real ranking. #1 is the file the agent would read first.",
    learned: "The search prefers rare words and files whose title or tags contain them. Switch either rule off and a different file wins.",
    steps: [
      { mode: "explore", look: "Nothing is searched yet. After you answer, numbered badges appear on the files that match.",
        text: "A search has to decide which file answers your question. The real `rank` function scores every line, rewards **rare** words, and rewards files whose **title or tags** contain the word.",
        exp: "`brain.rank`: stemmed prefix match, idf weights over files, a line scores the sum of the weights of its terms, file score = best line + HEAD_WEIGHT × head-term weight, ties by path. Deterministic by construction.", deeper: "Try the tabs: `query_words` runs before `rank` and drops stop words.",
        predict: { q: "I search `timestamps late`. Which file ranks #1?", choices: ["orders-timestamps-utc", "incremental-models-miss-late-rows", "mobile-events-arrive-late"], expects: "orders-timestamps-utc", run: [["search", "timestamps late"]],
          answer: async ({ call, S }) => top(await call("search", { files: S.files, query: "timestamps late" })),
          claims: [["the #1 file's title or tags mention “timestamps”", async ({ call, S }) => /timestamps/i.test(heading(S, (await hitPaths(call, S, "timestamps late"))[0]))],
                   ["neither other candidate's title or tags mention “timestamps”", async ({ call, S }) => (await hitPaths(call, S, "timestamps late")).slice(1, 3).every((p) => !/timestamps/i.test(heading(S, p)))],
                   ["“late” is in more files than “timestamps”", ({ S }) => nFiles(S, "\\blate\\b") > nFiles(S, "timestamps")]],
          why: async ({ call, S }) => `\`${top(await call("search", { files: S.files, query: "timestamps late" }))}\`: its tags contain “timestamps”, a rare word here, and titles and tags are weighted. The other two only match “late”, which many files contain.`,
          miss: { "incremental-models-miss-late-rows": "You picked a file whose title says “late”. So do others: a common word is weak evidence.",
                  "mobile-events-arrive-late": "You picked a file whose title says “late”. So do others: a common word is weak evidence." } },
        hint: "Which file's title or tags contain the word that is rarer across the knowledge base?" },
      { mode: "explore", look: "The badges are the REAL ranking. The ranking with flat word weights is in \u201cTry it\u201d below.", open: ["try"], setup: [["search", "timestamps late"]],
        predict: { q: "Now I switch off the rare-word weighting (“Flat word weights”) and run the same search. Does #1 change?", choices: ["Same #1", "A different file is #1"], expects: "A different file is #1", run: [["search", "timestamps late"], ["tweak", 0]],
          answer: (ctx) => { const o = edit(ctx, "explore"); if (!o || o.error) throw new Error("tweak did not run"); return top(o.base) === top(o.edited) ? "Same #1" : "A different file is #1"; },
          claims: [["“late” is in more files than “timestamps”", ({ S }) => nFiles(S, "\\blate\\b") > nFiles(S, "timestamps")]],
          why: (ctx) => { const o = edit(ctx, "explore"); return `Real: \`${top(o.base)}\`. Without the weighting: \`${top(o.edited)}\`. “late” appears in many files and “timestamps” in few; flat weights stop preferring the rare word.`; },
          miss: { "Same #1": "You expected the winner to hold. It was winning because its word is rare, and that advantage is exactly what this switch removes." } } },
      { mode: "explore", look: "The badges are the REAL ranking. The ranking that ignores titles and tags is in \u201cTry it\u201d below.", open: ["try"], setup: [["search", "timestamps late"]],
        predict: { q: "Instead I ignore titles and tags (“Ignore titles and tags”). Does #1 change?", choices: ["Same #1", "A different file is #1"], expects: "A different file is #1", run: [["search", "timestamps late"], ["tweak", 1]],
          answer: (ctx) => { const o = edit(ctx, "explore"); if (!o || o.error) throw new Error("tweak did not run"); return top(o.base) === top(o.edited) ? "Same #1" : "A different file is #1"; },
          claims: [["the real #1's title or tags mention “timestamps”", (ctx) => /timestamps/i.test(heading(ctx.S, edit(ctx, "explore").base[0].path))],
                   ["the file that wins without the title boost has no such title or tag", (ctx) => { const e = edit(ctx, "explore").edited[0]; return !!e && !/timestamps/i.test(heading(ctx.S, e.path)); }]],
          why: (ctx) => { const o = edit(ctx, "explore"); return `Real: \`${top(o.base)}\`. Without the title boost: \`${top(o.edited)}\`. A file that is *about* the word now loses to one that merely contains it.`; },
          miss: { "Same #1": "You expected the rare word to be enough. The rare word sits in the winner's tags, and this switch stops tags from counting extra." } } },
    ],
  },
  {
    id: "break", title: "Break it: does anything notice?", blurb: "Mutation testing: the way to test your evals.",
    look: "A crossed-out file is a deliberate break. Evals that pulse red noticed it; if none pulse, you have found a blind spot.",
    learned: "A green suite only proves what it checks. Break the knowledge on purpose: every break that no eval notices is a blind spot or a duplicate.",
    steps: [
      { mode: "break", look: "After you answer, the crossed-out file is the deleted fact. Evals that notice it pulse red.",
        text: "If you delete a fact and every eval still passes, the evals would not have noticed it vanishing. That is a **blind spot**. Breaking things on purpose (a *mutation*) and counting which evals notice is how you test the evals themselves.",
        exp: "Mutation testing applied to a knowledge base: each mutant (delete file, remove text) is run against the suite; killed = some eval fails. The score is killed/total.",
        predict: { q: "I delete `facts/airflow-backfill-concurrency.md`. One eval, `backfill`, searches for exactly that topic. Does any eval fail?", choices: ["Yes, an eval fails", "No, nothing notices"], expects: "No, nothing notices", run: [["break", { op: "delete_file", path: BACKFILL }]],
          answer: ({ S }) => (S.whatif?.res?.survived ? "No, nothing notices" : "Yes, an eval fails"),
          claims: [["the deletion really survived", ({ S }) => !!S.whatif?.res?.survived],
                   ["another file still contains `max-active-runs`", ({ S }) => Object.entries(S.files).some(([p, t]) => p !== BACKFILL && t.includes("max-active-runs"))],
                   ["the `backfill` eval has no first_line requirement", ({ S }) => { const b = ("\n" + S.questions).split("\n- id:").find((x) => x.trim().startsWith("backfill")); return !!b && !b.includes("first_line"); }]],
          why: ({ S }) => S.whatif?.res?.survived ? "It survived. The `backfill` eval only requires the string `max-active-runs` to appear somewhere, and another file (a workstream note) also contains it. The eval cannot tell the right source from any source." : `Killed by ${S.whatif.res.killed_by.join(", ")}.`,
          miss: { "Yes, an eval fails": "You expected the `backfill` eval to notice. It reads this file, so that is a fair guess." } },
        hint: "The eval asks that a string appears in the output. Could another file contain it?" },
      { mode: "break", look: "Each file is broken in turn and evals that notice flash. The list of what survived is under \u201cPoke at it yourself\u201d.", open: ["poke"],
        predict: { q: "I press “Auto-mutate everything” (deletes and text removals on every fact). What share of these breaks do the evals notice?", choices: ["Under 50%", "50% to 80%", "Over 80%"], expects: "50% to 80%", run: [["auto"]],
          answer: async ({ call, S }) => { const s = (await call("auto_mutants", { files: S.files, questions: S.questions })).score; return s < 0.5 ? "Under 50%" : s <= 0.8 ? "50% to 80%" : "Over 80%"; },
          why: async ({ call, S }) => { const r = await call("auto_mutants", { files: S.files, questions: S.questions }); return `${r.killed} of ${r.total} breaks were noticed (${Math.round(r.score * 100)}%). Each one that slipped past is listed with the reason. Press “Fix this blind spot” on one to add an eval and watch the score rise.`; },
          miss: { "Under 50%": "Lower than the real score: most of these breaks do make an eval fail.", "Over 80%": "Higher than the real score: a suite where every eval passes feels safer than it is." } } },
    ],
  },
  {
    id: "gate", title: "The gate: from results to a verdict", blurb: "Fixed rules, checked in order, first one to fire wins.",
    look: "The funnel is the gate: rules run top to bottom and the highlighted one is the verdict.",
    learned: "A gate is a fixed list of rules checked in order. The first rule that fires is the verdict, and the thresholds are part of the decision.",
    steps: [
      { mode: "gate", setup: [["preset", "Skill clearly helps"]],
        text: "Suppose you tested a skill (an instruction file) on a set of questions, with and without it. A **gate** turns those counts into one verdict using fixed rules, in a fixed order. The same inputs always give the same verdict.",
        exp: "`gate.decide(candidate, results) -> (verdict, facts)`: pure. Rules in order: INCONCLUSIVE, REGRESSION, CEILING, NO_DELTA, TOO_COSTLY, else ADOPT. Thresholds come from a candidate file registered before the run.",
        predict: { q: "Preset “Already good”: the model answers every question correctly even WITHOUT the skill, and with it. What does the gate say?", choices: ["ADOPT", "NO_DELTA", "CEILING"], show: verdictLabel, expects: "CEILING", run: [["preset", "Already good"]],
          answer: ({ S }) => S.gate.res.verdict,
          claims: [["baseline is at or above the ceiling", ({ S }) => S.gate.res.facts.dev_without / S.gate.res.facts.dev_n >= S.gate.params.ceiling], ["NO_DELTA's own test would also have tripped (gain < min_gain)", ({ S }) => S.gate.res.facts.gain < S.gate.params.min_gain]],
          why: ({ S }) => `${gateSays(S)} This rule is checked before “not enough improvement” because “no gain” would be the wrong explanation: there was simply no room to gain.`,
          miss: { ADOPT: "You said adopt: with the skill every answer is right, which looks like success. It was just as right without it.",
                  NO_DELTA: "Close. The gain is zero, so that rule would fire too. The gate checks “already too good” first, because it is the truer explanation." } },
        hint: "Both sides get every answer right. Is there room for the skill to show a gain?" },
      { mode: "gate", setup: [["preset", "Skill clearly helps"]],
        predict: { q: "Preset “Helps most, hurts one”: the skill improves most questions but makes one worse. What does the gate say?", choices: ["ADOPT", "REGRESSION", "NO_DELTA"], show: verdictLabel, expects: "REGRESSION", run: [["preset", "Helps most, hurts one"]],
          answer: ({ S }) => S.gate.res.verdict,
          claims: [["a probe really regressed", ({ S }) => S.gate.res.facts.regressed.length > 0], ["the skill still gains overall", ({ S }) => S.gate.res.facts.gain > 0]],
          why: ({ S }) => `${gateSays(S)} This rule is checked early: the gate does not let gains elsewhere pay for a question the skill broke.`,
          miss: { ADOPT: "You said adopt: the skill does gain overall. The gate does not average a broken question away.",
                  NO_DELTA: "The gain is large enough. The gate stops earlier, at the question that got worse." } } },
      { mode: "gate", look: "The highlighted rule is where the gate stopped. The thresholds are under \u201cPoke at it yourself\u201d.", open: ["poke"], setup: [["preset", "Skill clearly helps"]],
        predict: { q: "Back to “Skill clearly helps”, but I demand a gain of at least 99 correct answers. What does the gate say?", choices: ["ADOPT", "NO_DELTA", "TOO_COSTLY"], show: verdictLabel, expects: "NO_DELTA", run: [["preset", "Skill clearly helps"], ["param", "min_gain", 99]],
          answer: ({ S }) => S.gate.res.verdict,
          claims: [["the skill does gain", ({ S }) => S.gate.res.facts.gain > 0], ["but less than the threshold", ({ S }) => S.gate.res.facts.gain < S.gate.params.min_gain]],
          why: ({ S }) => `${gateSays(S)} Thresholds are part of the decision. That is why the real gate refuses thresholds that were edited after the results were in.`,
          miss: { ADOPT: "The results did not change, so adopt seems safe. The bar moved: the gain is now below it.",
                  TOO_COSTLY: "The cost did not change. The gate stops one rule earlier, at the gain." } } },
    ],
  },
  {
    id: "skill", title: "A skill that sounds right but isn't", blurb: "Why text coverage is only a proxy.",
    look: "Left: the skill. Middle: the probe questions (green means the skill's text holds the answer). Right: the real gate.",
    learned: "Checking that a skill's text contains the answers is a proxy. It catches an empty skill and is fooled by a list of keywords.",
    steps: [
      { mode: "abskill",
        text: "A **skill** is an instruction file an agent reads. Does it help? This page lints it with the real linter, then checks whether its **text** contains what each probe question expects, and hands that to the real gate. The text check is a proxy: it shows the skill *could* help, not that a model *does* better.",
        exp: "`ab_skill`: lint (`check_skills`), then per-probe text coverage via `skill_ab.missing`, then `gate.decide` on a fixture. Coverage is a necessary-not-sufficient proxy.",
        predict: { q: "A skill that says only “Lorem ipsum” (valid header, no content). What does the gate say?", choices: ["ADOPT", "NO_DELTA", "CEILING"], show: verdictLabel, expects: "NO_DELTA", run: [["skill", "filler"]],
          answer: ({ S }) => S.skill.res.gate.verdict,
          claims: [["lint reports no errors", ({ S }) => S.skill.res.lint.errors.length === 0], ["the text covers none of the probes", ({ S }) => S.skill.res.coverage.every((c) => !c.covered)],
                   ["the baseline is far below the ceiling", ({ S }) => S.skill.res.gate.facts.dev_without === 0]],
          why: ({ S }) => `${skillSays(S)} It passes lint (the header is fine) but helps with nothing, and the gate says so.`,
          miss: { ADOPT: "A valid header makes a skill look finished. Lint only checks the form.",
                  CEILING: "The baseline here is zero correct answers, so there is plenty of room. The skill simply adds nothing." } } },
      { mode: "abskill",
        predict: { q: "A skill that is JUST the list of expected keywords, with no explanation at all. What does the gate say?", choices: ["ADOPT", "NO_DELTA", "REGRESSION"], show: verdictLabel, expects: "ADOPT", run: [["skill", "stuffed"]],
          answer: ({ S }) => S.skill.res.gate.verdict,
          claims: [["the text is only keywords (no sentence of 6+ words)", ({ S }) => S.skill.text.split("---").pop().split(/[.\n]/).every((l) => l.trim().split(/\s+/).filter(Boolean).length < 40)],
                   ["every probe is nevertheless covered", ({ S }) => S.skill.res.coverage.every((c) => c.covered)]],
          why: ({ S }) => `${skillSays(S)} Substring grading cannot tell understanding from keyword stuffing. This is why a grader needs its own tests (try “Accept ANY expected phrase” in the Try-it cell), and why the next lesson uses recorded model answers instead of this proxy.`,
          miss: { NO_DELTA: "You expected a list of keywords to be rejected. A person would reject it. The grader only looks for the phrases.",
                  REGRESSION: "Nothing got worse: every probe is covered, so every answer counts as correct." } },
        hint: "The grader looks for phrases in text. What if the text is only phrases?" },
    ],
  },
  {
    id: "recorded", title: "Real models, recorded", blurb: "The same gate, judging answers two real models actually gave.",
    look: "The funnel now judges a recorded run: real answers from a real model, graded by the same code. Click a ✔ or ✘ under “Poke at it yourself” to read the answer.",
    learned: "Recorded runs replace guesses with behaviour: a model can read a skill and still fail the check, a useless skill gains nothing, and a skill that helps can still cost too much.",
    needs: (S) => !!S.runs && ["doubt", "dst"].every((s) => run(S, s, null, "haiku")) && !!run(S, "dst", "filler", "haiku") && !!run(S, "evidence-gated", null, "sonnet"),
    steps: [
      { mode: "gate", open: ["poke"], setup: [["grun", "doubt", null, "haiku"]],
        look: "Each ✔ or ✘ is one recorded answer. Click one under “Poke at it yourself” to read what the model wrote.",
        text: "Everything so far used results set by hand. These are **recorded**: two real models answered every probe question three times without the skill and three times with it. Nothing is called now; the answers are files in the repository, and the real gate judges them here.",
        exp: "`recorded/*.json` are unedited `skill_ab.py` results files (model pinned, probes hashed), judged by `gate.decide` with the default thresholds. `recorded/RUNS.json` holds their hashes; CI fails if one changes.",
        predict: { q: (ctx) => `The \`doubt\` skill, on ${modelName(runRes(ctx.S, run(ctx.S, "doubt", null, "haiku")).pi_args[1])}. The question \`doubt-framing\` expects the answer to mention “adversarial” and “fresh”. In all 3 tries with the skill, the model opened and read the skill file. How many of those 3 answers passed the check?`,
          choices: ["0 of 3", "1 or 2 of 3", "3 of 3"], run: [["grun", "doubt", null, "haiku"], ["gpeek", "doubt-framing", "with", 0]],
          answer: ({ S }) => { const n = armScore(runRes(S, S.gate.run), "doubt-framing", "with"); return n === 0 ? "0 of 3" : n === 3 ? "3 of 3" : "1 or 2 of 3"; },
          claims: [["the model read the skill in every `with` try", ({ S }) => runRes(S, S.gate.run).rows.filter((r) => r.probe === "doubt-framing" && r.arm === "with").every((r) => r.skill_read)],
                   ["the skill's text does contain both phrases", ({ S }) => ["adversarial", "fresh"].every((w) => S.skills.doubt.toLowerCase().includes(w))],
                   ["at least one `with` answer failed the check", ({ S }) => armScore(runRes(S, S.gate.run), "doubt-framing", "with") < 3]],
          why: ({ S }) => { const res = runRes(S, S.gate.run), rows = res.rows.filter((r) => r.probe === "doubt-framing" && r.arm === "with"), miss = [...new Set(rows.flatMap((r) => r.missing))];
            return `${armScore(res, "doubt-framing", "with")} of 3 passed. The skill's text contains both phrases, and the model read it, yet its answers left out ${miss.map((m) => `“${m}”`).join(" and ")}. This is a real model failing an eval. Reading a skill is not the same as answering the way the check expects, which is why the text-coverage proxy from the last lesson is not enough. One answer is open under “Poke at it yourself”.`; },
          expects: "1 or 2 of 3",
          miss: { "0 of 3": ({ S }) => `You expected the skill to do nothing. It did something: ${armScore(runRes(S, S.gate.run), "doubt-framing", "with")} of 3 answers passed. The model used part of what it read and still left a word out.`,
                  "3 of 3": ({ S }) => `You expected reading the skill to be enough. Only ${armScore(runRes(S, S.gate.run), "doubt-framing", "with")} of 3 passed. The model read it in every try and still did not use the words the check looks for.` } },
        hint: "The model had the skill. Does that guarantee it used the exact words the check looks for?" },
      { mode: "gate", open: ["poke"], setup: [["grun", "dst", "filler", "haiku"]],
        predict: { q: (ctx) => `Now a skill that should not help: the “Lorem ipsum” filler from the last lesson, offered to ${modelName(runRes(ctx.S, run(ctx.S, "dst", "filler", "haiku")).pi_args[1])} on the \`dst\` questions. The proxy said “not enough improvement”. What does the real gate say about the recorded answers?`,
          choices: ["ADOPT", "NO_DELTA", "REGRESSION", "TOO_COSTLY"], show: verdictLabel, run: [["grun", "dst", "filler", "haiku"]],
          answer: ({ S }) => S.gate.res.verdict,
          claims: [["the filler skill was the one loaded", ({ S }) => /filler/.test(runRes(S, S.gate.run).with_path)],
                   ["the skill did not reach the minimum gain", ({ S }) => S.gate.res.facts.gain < S.gate.params.min_gain]],
          why: ({ S }) => { const f = S.gate.res.facts; return `${gateSays(S)} Without the skill the model got ${f.dev_without} of ${f.dev_n} answers right, with it ${f.dev_with}. A skill with nothing in it changes nothing, and here the proxy and the real behaviour agree.`; },
          expects: "NO_DELTA",
          miss: { ADOPT: ({ S }) => `A skill with nothing in it cannot add correct answers: ${S.gate.res.facts.dev_without} right without it, ${S.gate.res.facts.dev_with} with it. ADOPT needs a real gain.`,
                  REGRESSION: ({ S }) => `REGRESSION means answers got worse by more than the limit. Here they went from ${S.gate.res.facts.dev_without} to ${S.gate.res.facts.dev_with} right, so they barely moved.`,
                  TOO_COSTLY: ({ S }) => `The cost rule is checked only after the gain is big enough. The gain here is ${S.gate.res.facts.gain}, so the gate stops at the earlier rule.` } } },
      { mode: "gate", open: ["poke"], setup: [["grun", "evidence-gated", null, "sonnet"]],
        predict: { q: (ctx) => { const S = ctx.S, res = runRes(S, run(S, "evidence-gated", null, "sonnet")), g = runGrid(res), dev = res.rows.filter((r) => r.split === "dev"), n = (arm) => dev.filter((r) => r.arm === arm && r.correct).length;
            return `The \`evidence-gated\` skill on ${modelName(res.pi_args[1])}: ${n("without")} of ${dev.length / 2} answers right without the skill, ${n("with")} of ${dev.length / 2} with it, and no question got worse (${Object.keys(g).length} questions). What does the gate say?`; },
          choices: ["ADOPT", "NO_DELTA", "CEILING", "TOO_COSTLY"], show: verdictLabel, run: [["grun", "evidence-gated", null, "sonnet"]],
          answer: ({ S }) => S.gate.res.verdict,
          claims: [["the skill gains at least the minimum", ({ S }) => S.gate.res.facts.gain >= S.gate.params.min_gain], ["nothing regressed", ({ S }) => S.gate.res.facts.regressed.length === 0]],
          why: ({ S }) => { const f = S.gate.res.facts; return `${gateSays(S)} The answers with the skill cost $${f.cost_with} against $${f.cost_without} without: reading a long skill file is not free. A hand-set grid would never have shown this; the recorded cost did.`; },
          expects: "TOO_COSTLY",
          miss: { ADOPT: ({ S }) => `The gain is big enough, but ADOPT also needs the cost to stay under the limit. With the skill the answers cost $${S.gate.res.facts.cost_with} against $${S.gate.res.facts.cost_without} without.`,
                  NO_DELTA: ({ S }) => `The skill did add answers (${S.gate.res.facts.dev_without} right without it, ${S.gate.res.facts.dev_with} with it), so the gain rule passes. The rule that fires is the cost one.`,
                  CEILING: ({ S }) => `CEILING means the model already got nearly everything right without the skill. It got ${S.gate.res.facts.dev_without} of ${S.gate.res.facts.dev_n}.` } },
        hint: "The gate has one more rule after the gain is big enough." },
    ],
  },
  {
    id: "noise", title: "Why one run isn't enough", blurb: "Model answers are noisy. Re-run the same experiment and watch the verdict move.",
    look: "The funnel shows one hand-set run. The lesson re-runs the same experiment 200 times and reports how often each verdict appears.",
    learned: "One run is one draw. The same experiment, repeated, gives different verdicts, so a verdict needs enough samples and thresholds fixed in advance.",
    steps: [
      { mode: "gate", setup: [["preset", "No effect"]],
        text: "Real model answers vary from run to run. Here a **seeded coin** stands in for the model: every answer passes with a fixed probability, so we know the true effect. We re-run the *same* experiment 200 times and hand each run to the **real gate**.",
        exp: "`lab_core.noise_sweep`: trial t draws every sample from `random.Random(t)`, builds the `skill_ab`-shaped results and calls the real `gate.decide`. Same seeds, same numbers, every time.",
        deeper: "A real run is one trial of this. You never see the other 199, which is why a single verdict can mislead.",
        predict: { q: ({ S }) => `A skill that does **nothing**: each answer passes 50% of the time with or without it. ${S.gate.probes.length} questions, 3 samples each, 200 re-runs. How often does the gate say adopt?`,
          choices: ["Never", "Under 5% of runs", "5% to 25% of runs", "Over 25% of runs"], expects: "5% to 25% of runs", run: [["preset", "No effect"]],
          answer: async (ctx) => { const a = (await noise(ctx, 0.5, 0.5, 3)).adopt_rate; return a === 0 ? "Never" : a < 0.05 ? "Under 5% of runs" : a <= 0.25 ? "5% to 25% of runs" : "Over 25% of runs"; },
          claims: [["the skill really has no effect (average gain is near zero)", async (ctx) => Math.abs((await noise(ctx, 0.5, 0.5, 3)).mean_gain) < 1],
                   ["the verdict differs between runs", async (ctx) => Object.keys((await noise(ctx, 0.5, 0.5, 3)).verdicts).length > 1]],
          why: async (ctx) => { const r = await noise(ctx, 0.5, 0.5, 3); return `Adopted in ${Math.round(r.adopt_rate * 100)}% of runs (${JSON.stringify(r.verdicts)}). The skill does nothing, yet some runs get lucky: one run cannot tell luck from a real effect.`; },
          miss: { Never: "You trusted the gate to never be fooled. Its rules are fixed, but its inputs are coin flips.", "Under 5% of runs": "Rarer than it really is. With so few samples, a lucky streak is not unusual.", "Over 25% of runs": "More often than it really is. Most lucky runs are stopped by another rule first." } },
        hint: "Nothing is true here. Is the gate's chance of being fooled zero?" },
      { mode: "gate", setup: [["preset", "No effect"]],
        predict: { q: "Same useless skill. Which verdict is the **most common** across the 200 re-runs?", choices: ["ADOPT", "NO_DELTA", "REGRESSION"], show: verdictLabel, expects: "REGRESSION", run: [["preset", "No effect"]],
          answer: async (ctx) => Object.keys((await noise(ctx, 0.5, 0.5, 3)).verdicts)[0],
          claims: [["a question lost 2+ samples by chance in more runs than the gate adopted", async (ctx) => { const v = (await noise(ctx, 0.5, 0.5, 3)).verdicts; return (v.REGRESSION || 0) > (v.ADOPT || 0); }]],
          why: async (ctx) => { const r = await noise(ctx, 0.5, 0.5, 3); return `${Object.keys(r.verdicts)[0]} (${JSON.stringify(r.verdicts)}). With ${ctx.S.gate.probes.length} questions, by luck at least one loses 2 of its 3 samples in most runs, and a single question that got worse makes the gate reject. More questions means more chances for noise to look like a regression.`; },
          miss: { ADOPT: "Adopt does happen by luck, but less often than a lucky-looking loss.", NO_DELTA: "“No effect” is the truth, so this is the sensible guess. Noise rarely looks like nothing: it looks like something." } },
        hint: "Several questions, each with its own coin flips. How likely is it that none of them dips?" },
      { mode: "gate", setup: [["preset", "Skill clearly helps"]],
        predict: { q: "Now the skill genuinely helps: 50% to 80% pass rate. How often does the gate say adopt with 3 samples per question?",
          choices: ["Nearly always (95%+)", "Most of the time (60% to 95%)", "About half (30% to 60%)", "Under 30%"], expects: "Most of the time (60% to 95%)", run: [["preset", "Skill clearly helps"]],
          answer: async (ctx) => { const a = (await noise(ctx, 0.5, 0.8, 3)).adopt_rate; return a >= 0.95 ? "Nearly always (95%+)" : a >= 0.6 ? "Most of the time (60% to 95%)" : a >= 0.3 ? "About half (30% to 60%)" : "Under 30%"; },
          claims: [["the skill really helps (average gain is positive)", async (ctx) => (await noise(ctx, 0.5, 0.8, 3)).mean_gain > 2]],
          why: async (ctx) => { const r = await noise(ctx, 0.5, 0.8, 3), r10 = await noise(ctx, 0.5, 0.8, 10); return `Adopted in ${Math.round(r.adopt_rate * 100)}% of runs at 3 samples (${JSON.stringify(r.verdicts)}), and ${Math.round(r10.adopt_rate * 100)}% at 10 samples. A real effect can be rejected and a null one adopted by the same gate: the fix is more samples and thresholds fixed in advance, not trusting one verdict.`; },
          miss: { "Nearly always (95%+)": "A real effect feels like it should always show. With 3 samples, an unlucky run still hides it.", "About half (30% to 60%)": "Better than a coin toss: the effect is large.", "Under 30%": "The gate is not that harsh: the effect is large and usually shows." } },
        hint: "A real effect is still noisy. Could an unlucky run miss it?" },
      { mode: "gate", look: "Pick a sample count in the card and compare how often each skill is adopted.", widget: "noise", setup: [["preset", "Skill clearly helps"]],
        text: "Your turn. Pick how many samples each question gets and compare the two skills: one that does nothing and one that really helps. Watch how the share of runs that say adopt moves for each.",
        exp: "`noise_sweep` for (0.5, 0.5) and (0.5, 0.8) at the chosen `samples`; thresholds are the Gate scene's. ADOPT on the first row is a false positive, on the second a true positive.",
        deeper: "More samples shrink the luck, but the gate's absolute `min_gain` does not scale with them, so the thresholds are part of the experiment design too." },
    ],
  },
];

// Every `why` makes causal claims. Each claim is a predicate over the real run; the UI shows the explanation only when all hold,
// otherwise it says the explanation is out of date, so a vendor refresh cannot leave a lesson that lies.
export async function checkClaims(predict, ctx) {
  const failed = [];
  for (const [desc, fn] of predict.claims || []) { let ok = false; try { ok = !!(await fn(ctx)); } catch { ok = false; } if (!ok) failed.push(desc); }
  return failed;
}
