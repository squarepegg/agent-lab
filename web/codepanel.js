// Pure helpers for the "real code" panel: cut one function out of a vendored file and join it with the executed-line trace.
// No DOM here, so tests_js/model.test.mjs can run it.

// Source lines of top-level `def name` (decorators excluded) up to, not including, the next top-level statement.
export function extractFunc(src, name) {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`def ${name}(`));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() && !/^\s/.test(l) && !l.startsWith(")")) { end = i; break; }
  }
  while (end > start + 1 && !lines[end - 1].trim()) end--;
  return { start: start + 1, rows: lines.slice(start, end).map((text, i) => ({ n: start + 1 + i, text })) };
}

// Join rows with {line: count}. A line is "code" when it is not blank, a comment, or inside a docstring/continuation-free def line.
export function annotate(fn, hits, notes = []) {
  const h = hits || {};
  let inDoc = false;
  return fn.rows.map((r) => {
    const t = r.text.trim();
    const q = (t.match(/"""/g) || []).length;
    const doc = inDoc || (t.startsWith('"""') && q > 0) || (t.startsWith('r"""'));
    if (q === 1 && !inDoc && (t.startsWith('"""') || t.startsWith('r"""'))) inDoc = true; else if (inDoc && q >= 1) inDoc = false;
    const code = !!t && !t.startsWith("#") && !doc && !t.startsWith("def ");
    const count = h[String(r.n)] || 0;
    const note = (notes.find(([sub]) => r.text.includes(sub)) || [])[1] || "";
    return { ...r, code, count, state: !code ? "none" : count ? "hit" : "miss", note };
  });
}

export function coverage(rows) {
  const code = rows.filter((r) => r.code);
  return { ran: code.filter((r) => r.count).length, total: code.length };
}

// What to show per mode: [file, function, tab label]. First entry is the default tab.
export const MODE_CODE = {
  explore: [["brain.py", "rank", "rank"], ["brain.py", "query_words", "query_words"]],
  evals: [["eval_run.py", "check", "check"], ["eval_run.py", "answer", "answer"]],
  break: [["eval_run.py", "check", "check"], ["eval_run.py", "answer", "answer"]],
  gate: [["gate.py", "decide", "decide"], ["gate.py", "tally", "tally"]],
  abfact: [["brain.py", "rank", "rank"]],
  abskill: [["gate.py", "decide", "decide"], ["skill_ab.py", "missing", "missing"], ["check_skills.py", "check", "lint"]],
};

// Plain-English margin notes for Beginner level: [substring of the line, note]. First match wins per line.
export const NOTES = {
  "brain.py:rank": [
    ["qs = sorted(", "stem each search word so 'deploys' and 'deploy' match"],
    ["files.setdefault", "group every line by the file it came from"],
    ["df = {", "document frequency: in how many files does each word appear?"],
    ["w = {q: math.log", "rare words get a bigger weight (idf): 'pii' says more than 'the'"],
    ["hl = sorted(", "score each line by the weights of the words it contains"],
    ["head = tokens(", "a file whose title or tags say the word beats one that only mentions it"],
    ["ranked.sort", "best score first; ties broken by path so the order is always the same"],
    ["return out[:limit]", "top results only"],
  ],
  "brain.py:query_words": [
    ["raw = TOKEN", "split the question into lowercase words"],
    ["return list(dict.fromkeys", "drop duplicates but keep order: same question, same words, every time"],
  ],
  "eval_run.py:check": [
    ["missing = ", "every `expect` string must appear in the search output"],
    ["first_ok = ", "optional: the top result must come from the right file"],
    ["hit = ", "`forbid` strings must NOT appear"],
    ["return (not missing", "pass only if nothing is missing, the top line is right and nothing forbidden showed up"],
  ],
  "eval_run.py:answer": [
    ["brain.search(", "the 'agent' here is just the search: no model, so the same input always gives the same answer"],
  ],
  "gate.py:decide": [
    ["p = validate_candidate", "thresholds were written down before the run (pre-registered)"],
    ["b, bcost, bunf = tally", "count how often each probe was answered correctly WITHOUT the skill"],
    ["w, wcost, wunf = tally", "...and WITH the skill"],
    ["f[\"gain\"] =", "gain = extra correct answers on dev probes with the skill"],
    ["return \"INCONCLUSIVE\"", "too many runs did not finish: say nothing rather than guess"],
    ["return \"REGRESSION\"", "the skill made something worse: stop"],
    ["return \"CEILING\"", "it already scores high without the skill, so these probes cannot show a gain"],
    ["return \"NO_DELTA\"", "not enough gain to bother"],
    ["return \"TOO_COSTLY\"", "it helps, but costs too much more"],
    ["return \"ADOPT\"", "survived every rule"],
  ],
  "gate.py:tally": [["def tally", "count correct answers, cost and unfinished runs per probe"]],
  "skill_ab.py:missing": [
    ["return [g[0]", "each expected group is a list of acceptable phrasings; one must appear in the answer. This is substring grading: it is cheap and fooled by keyword stuffing"],
  ],
  "check_skills.py:check": [
    ["fm = frontmatter(text)", "read the `name:` / `description:` header of each skill"],
    ["DESC_MAX", "descriptions must stay short, because agents load them all"],
  ],
};

// ---- step 2: edit and run -------------------------------------------------------------------------------------
// Guided tweaks for Beginner (also starter edits for Experienced). `find` must occur exactly once in the upstream source
// (tests_js/model.test.mjs checks that), so a tweak can never silently do nothing after a vendor refresh.
export const TWEAKS = {
  "brain.py:rank": [
    { label: "Flat word weights (no idf)", find: "w = {q: math.log(1 + n / (1 + df[q])) for q in qs}", to: "w = {q: 1.0 for q in qs}",
      why: "Every word now counts the same, so common words matter as much as rare ones. Watch the order change." },
    { label: "Ignore titles and tags", find: "HEAD_WEIGHT * sum(", to: "0 * sum(",
      why: "A file whose title says the word no longer beats one that merely mentions it." },
  ],
  "brain.py:query_words": [
    { label: "Keep stop words", find: "len(t) > 2 and t not in STOP", to: "True",
      why: "Words like 'the' and 'why' are now search terms. Rare-word weighting hides most of the damage, but not all of it." },
  ],
  "eval_run.py:check": [
    { label: "Forget `forbid`", find: 'hit = [s for s in q.get("forbid", []) if s in out]', to: "hit = []",
      why: "Forbidden strings are never looked for. If nothing changes, no eval was guarding that rule: a blind spot (see Break it)." },
    { label: "Case-insensitive expect", find: "missing = [s for s in q.get(\"expect\", []) if s not in out]", to: 'missing = [s for s in q.get("expect", []) if s.lower() not in out.lower()]',
      why: "A looser check: more evals can pass. Looser checks are how an eval suite quietly stops catching things." },
    { label: "Always pass", find: "return (not missing and first_ok and not hit), missing, first_ok, hit", to: "return True, missing, first_ok, hit",
      why: "The dumbest grader that passes everything. A good eval suite should notice this; does yours?" },
  ],
  "gate.py:decide": [
    { label: "Skip the CEILING rule", find: 'if f["dev_without"] / f["dev_n"] >= p["ceiling"]:', to: "if False:",
      preset: "Already good",
      why: "Without it a skill can 'win' on probes the model already aces." },
    { label: "Ignore regressions", find: 'if f["regressed"] or f["heldout_without"] - f["heldout_with"] >= p["regress_by"]:', to: "if False:",
      preset: "Helps most, hurts one",
      why: "A skill that helps one probe and breaks another now gets through." },
    { label: "Demand a gain of 99", find: 'if f["gain"] < p["min_gain"]:', to: 'if f["gain"] < 99:',
      why: "Nothing can pass now. Thresholds are part of the decision, which is why the real gate registers them before the run." },
  ],
  "skill_ab.py:missing": [
    { label: "Accept ANY expected phrase", find: 'return [g[0] for g in probe["expect"] if not any(a.lower() in low for a in g)]',
      to: 'return [] if any(a.lower() in low for g in probe["expect"] for a in g) else [g[0] for g in probe["expect"]]',
      why: "Now one matching group is enough. A weaker grader flatters the skill; watch the A/B verdict." },
  ],
};

// Pairwise line diff for same-length sources (tweaks never change the line count); falls back to "changed" for the rest.
export function lineDiff(a, b) {
  const x = a.split("\n"), y = b.split("\n"), out = [];
  if (x.length !== y.length) return [{ kind: "note", text: `${x.length} lines → ${y.length} lines` }];
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) out.push({ kind: "del", text: x[i], i }, { kind: "add", text: y[i], i });
  return out;
}

// One short, comparable line per result of the call a mode traces.
export function brief(target, r) {
  if (!r) return "";
  if (target === "search") return r.length ? [...new Set(r.map((x) => x.path))].slice(0, 5).map((p, i) => `${i + 1} ${p.split("/").pop()}`).join(" · ") : "no matches";
  if (target === "run_evals") { const bad = r.results.filter((x) => !x.pass && x.tier !== "skip").map((x) => x.id); return `must ${r.summary.must_pass}/${r.summary.must_total}${bad.length ? " · failing: " + bad.join(", ") : ""}`; }
  if (target === "mutate") return r.survived ? "SURVIVED: no eval noticed" : "KILLED by " + r.killed_by.join(", ");
  if (target === "gate" || target === "gate_run") return `${r.verdict}: ${r.reason}`;
  if (target === "ab_skill") return `${r.gate.verdict}: ${r.gate.reason}`;
  return JSON.stringify(r).slice(0, 120);
}

export function applyTweak(src, t) {
  if (src.split(t.find).length !== 2) throw new Error(`tweak "${t.label}" no longer matches the upstream source`);
  return src.replace(t.find, () => t.to);
}
