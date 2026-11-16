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
