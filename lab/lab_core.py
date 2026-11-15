"""agent-lab core: thin, deterministic wrappers around the REAL vendored scripts (vendor/). Runs natively and in Pyodide.

A "brain" here is a plain dict {relative_path: text}. Every operation writes it to a throwaway directory, calls the upstream
code (brain.search, eval_run.check, gate.decide, skill_ab.missing, check_skills.check) and returns JSON-able data. Nothing here
calls a model, the network, git or a subprocess, so the same input always gives the same output.

What is NOT real (and the UI says so): model answers. Gate demos replay fixtures or hand-set outcomes; the skill "text coverage"
A/B is a proxy (can the skill's text even contain the answer?), not model behaviour.
"""
import contextlib, copy, glob, hashlib, io, json, os, re, sys, tempfile

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(os.path.dirname(HERE), "vendor")
for p in (VENDOR, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

_BRAIN = tempfile.mkdtemp(prefix="lab-brain-")
os.environ["BRAIN_DIR"] = _BRAIN
import brain as _brain  # noqa: E402  (vendored brain.py)
import eval_run as _eval  # noqa: E402
import gate as _gate  # noqa: E402
import skill_ab as _ab  # noqa: E402  (its pure `missing()` is the probe grader)
import check_skills as _check  # noqa: E402


@contextlib.contextmanager
def materialized(files):
    """Write {path: text} to a temp dir and point the upstream modules at it."""
    with tempfile.TemporaryDirectory(prefix="lab-") as d:
        for rel, text in files.items():
            full = os.path.join(d, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as f:
                f.write(text)
        old = (_brain.B, _eval.B)
        _brain.B = _eval.B = d
        try:
            yield d
        finally:
            _brain.B, _eval.B = old


# ---------- 1. the map
def frontmatter(text):
    m = re.match(r"^---\n(.*?)\n---\n?", text, re.S)
    if not m:
        return {}
    try:
        d = yaml.safe_load(m.group(1))
        return d if isinstance(d, dict) else {}
    except yaml.YAMLError:
        return {}


def explore(files):
    """The map as nodes: every searchable doc with kind, title, frontmatter, size."""
    nodes = []
    for p in sorted(files):
        if not p.endswith((".md", ".yaml")) or p.startswith("evals/"):
            continue
        kind = ("fact" if p.startswith("facts/") else "workstream" if p.startswith("workstreams/") else
                "decision" if p.startswith("decisions/") else "skill" if p.startswith("skills/") else
                "catalog" if p in ("glossary.yaml", "capabilities.yaml") else "config")
        fm = frontmatter(files[p]) if p.endswith(".md") else {}
        first = next((l.lstrip("# ").strip() for l in files[p].splitlines() if l.startswith("# ")), "")
        nodes.append({"path": p, "kind": kind, "title": fm.get("title") or fm.get("name") or first or os.path.basename(p),
                      "frontmatter": fm, "bytes": len(files[p].encode())})
    return nodes


def search(files, query, limit=10):
    """Real brain.search ranking. -> [{rank, path, line, text}]"""
    with materialized(files) as d:
        rows = _brain.rank(_brain.corpus(d), _brain.query_words(query), limit * 3)
    seen, out = {}, []
    for p, i, t in rows:
        seen.setdefault(p, len(seen) + 1)
        out.append({"rank": seen[p], "path": p, "line": i, "text": _brain.snippet(t, _brain.query_words(query))})
    return [r for r in out if r["rank"] <= limit]


def top_paths(files, query, k=3):
    rows = search(files, query, k)
    return list(dict.fromkeys(r["path"] for r in rows))[:k]


# ---------- 2. evals
def parse_questions(text):
    qs = yaml.safe_load(text) or []
    if not isinstance(qs, list):
        raise ValueError("questions must be a YAML list")
    for q in qs:
        if not isinstance(q, dict) or "id" not in q:
            raise ValueError("every question needs an id")
    return qs


def run_question(files, q):
    """One question, step by step. `checks` breaks the upstream verdict into the individual criteria (for display);
    `pass` is ALWAYS upstream eval_run.check's answer."""
    if any(n not in files for n in q.get("needs") or []):
        return {"id": q["id"], "tier": "skip", "pass": True, "query": "", "output": "", "checks": [], "q": q.get("q", ""), "error": ""}
    r = q.get("run") or {}
    err, out = "", ""
    if "search" in r:
        with materialized(files):
            out = _eval.answer(q)
    else:
        err = "only `run: {search: ...}` questions run in the browser (cmd questions need a shell)"
    ok, missing, first_ok, hit = _eval.check(q, out)
    lines = [l for l in out.splitlines() if l.strip()]
    checks = [{"kind": "expect", "value": s, "ok": s not in missing} for s in q.get("expect", [])]
    if q.get("first_line"):
        checks.append({"kind": "first_line", "value": q["first_line"], "ok": first_ok, "got": lines[0] if lines else ""})
    checks += [{"kind": "forbid", "value": s, "ok": s not in hit} for s in q.get("forbid", [])]
    return {"id": q["id"], "tier": q.get("tier", "must"), "pass": bool(ok and not err), "q": q.get("q", ""), "query": r.get("search", ""),
            "output": out, "checks": checks, "error": err}


def run_evals(files, questions):
    return [run_question(files, q) for q in questions]


def summarize(results):
    must = [r for r in results if r["tier"] == "must"]
    cov = [r for r in results if r["tier"] not in ("must", "skip")]
    return {"must_pass": sum(r["pass"] for r in must), "must_total": len(must),
            "coverage_pass": sum(r["pass"] for r in cov), "coverage_total": len(cov),
            "skipped": sum(r["tier"] == "skip" for r in results), "ok": all(r["pass"] for r in must)}


# ---------- 3. break it: mutations
def apply_mutation(files, m):
    """m: {op: delete_file|remove_text|replace_text, path, text?, with?}. -> new dict (input untouched) or raises ValueError."""
    out = dict(files)
    p = m.get("path")
    if p not in out:
        raise ValueError(f"no such file: {p}")
    op = m.get("op")
    if op == "delete_file":
        del out[p]
    elif op in ("remove_text", "replace_text"):
        old = m.get("text", "")
        if not old or old not in out[p]:
            raise ValueError(f"text not found in {p}: {old!r}")
        out[p] = out[p].replace(old, m.get("with", "") if op == "replace_text" else "")
    else:
        raise ValueError(f"unknown op {op!r}")
    return out


def mutate_and_run(files, questions, m):
    """Break the brain, rerun every eval. killed_by = evals that passed before and fail now. Survived = nothing noticed."""
    before = {r["id"]: r for r in run_evals(files, questions)}
    broken = apply_mutation(files, m)
    after = {r["id"]: r for r in run_evals(broken, questions)}
    killed = sorted(i for i in before if before[i]["pass"] and not after[i]["pass"] and before[i]["tier"] != "skip")
    return {"mutation": m, "killed_by": killed, "survived": not killed, "before": list(before.values()), "after": list(after.values()),
            "fixed_by": sorted(i for i in before if not before[i]["pass"] and after[i]["pass"])}


def auto_mutants(files, questions):
    """Deterministic mutant set: delete each fact; remove each question's `expect` string from the fact(s) that hold it. Score = killed/total."""
    base = {r["id"]: r for r in run_evals(files, questions)}
    mutants = [{"op": "delete_file", "path": p} for p in sorted(files) if p.startswith("facts/")]
    for q in questions:
        for s in q.get("expect", []):
            for p in sorted(files):
                if p.startswith("facts/") and s in files[p]:
                    mutants.append({"op": "remove_text", "path": p, "text": s})
    seen, rows = set(), []
    for m in mutants:
        key = json.dumps(m, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        after = {r["id"]: r for r in run_evals(apply_mutation(files, m), questions)}
        killed = sorted(i for i in base if base[i]["pass"] and base[i]["tier"] != "skip" and not after[i]["pass"])
        rows.append({"mutation": m, "killed_by": killed})
    killed_n = sum(1 for r in rows if r["killed_by"])
    return {"mutants": rows, "killed": killed_n, "total": len(rows), "score": round(killed_n / len(rows), 3) if rows else None,
            "survivors": [r["mutation"] for r in rows if not r["killed_by"]]}


# ---------- 3b. explain a mutation: why it failed / survived, and a verified fix
TOKEN = re.compile(r"[A-Za-z0-9_.\-/=<>]{5,}")


def _provider_paths(output, needle):
    """Files whose hit lines in an eval's lookup output contain `needle`."""
    out = []
    for line in output.splitlines():
        m = re.match(r"^(.+?):\d+: (.*)$", line)
        if m and needle in m.group(2) and m.group(1) not in out:
            out.append(m.group(1))
    return out


def _unique_tokens(files, path, within=None):
    """Tokens of files[path] (optionally only inside `within`) that no other file contains: what only this file can say."""
    others = "\n".join(t for p, t in files.items() if p != path)
    body = files[path] if within is None else within
    seen, out = set(), []
    for tok in TOKEN.findall(body):
        tok = tok.strip(".-/=<>")
        if len(tok) >= 5 and tok not in seen and tok not in others:
            seen.add(tok)
            out.append(tok)
    return sorted(out, key=lambda t: (-len(t), t))


def _title_words(files, path):
    title = frontmatter(files[path]).get("title") or os.path.basename(path)
    return [w for w in re.findall(r"[a-z][a-z0-9_]{3,}", str(title).lower())]


def suggest_fix(files, questions, mutation):
    """A new `must` eval that passes on the real brain and fails on the mutated one. Built from facts only this file holds, then VERIFIED by
    running both. -> {yaml, verified, note}; yaml is None when no such eval exists (the lost text is not unique to the file)."""
    path = mutation["path"]
    broken = apply_mutation(files, mutation)
    within = mutation.get("text") if mutation["op"] == "remove_text" else None
    stem = os.path.splitext(os.path.basename(path))[0]
    toks = _unique_tokens(files, path, within)
    if not toks:
        return {"yaml": None, "verified": False, "note": (
            f"Nothing in the {'removed text' if within else 'file'} is unique to {path}: other files already say it, so no eval can tell "
            "this edit apart. That is redundancy, not a weak eval. Accept it, or delete the duplicate so the fact lives in one place.")}
    base_ids = {q["id"] for q in questions}
    for tok in toks[:6]:
        for query in (" ".join(_title_words(files, path)[:3]), tok):
            if not query or path not in top_paths(files, query, 1):
                continue
            q = {"id": f"pin-{stem}"[:40], "q": f"Does the map still hold what {path} uniquely says?", "run": {"search": query},
                 "expect": [tok], "tier": "must"}
            if mutation["op"] == "delete_file":
                q["first_line"] = stem
            if q["id"] in base_ids:
                q["id"] += "-2"
            trial = questions + [q]
            ok_base = run_question(files, q)["pass"]
            ok_broken = run_question(broken, q)["pass"]
            if ok_base and not ok_broken:
                return {"yaml": yaml.safe_dump([q], sort_keys=False, default_flow_style=None).rstrip(), "verified": True, "eval": q,
                        "note": f"Verified: passes on the real brain, fails once the edit is made. `{tok}` appears only in {path}."}
    return {"yaml": None, "verified": False,
            "note": f"{path} has text no other file has ({', '.join(toks[:3])}), but no search query puts it first, so an eval cannot reach it. Add a title or tag containing those words."}


def explain_mutation(files, questions, mutation):
    """Why a mutant was killed or survived, in plain facts computed from the runs, plus a verified fix for survivors."""
    before = {r["id"]: r for r in run_evals(files, questions)}
    broken = apply_mutation(files, mutation)
    after = {r["id"]: r for r in run_evals(broken, questions)}
    path = mutation["path"]
    killed = [i for i in before if before[i]["pass"] and before[i]["tier"] != "skip" and not after[i]["pass"]]
    out = {"mutation": mutation, "survived": not killed, "killed": [], "why": [], "fix": None}
    for i in killed:
        bad = [c for c in after[i]["checks"] if not c["ok"]]
        out["killed"].append({"eval": i, "failed": [f"{c['kind']} `{c['value']}`" + (f" (top line was `{c.get('got', '')[:60]}`)" if c["kind"] == "first_line" else "") for c in bad]})
        out["why"].append(f"Eval `{i}` read {path} (its lookup `{before[i]['query']}` returned it) and needed " +
                          "; ".join(f"{c['kind']} `{c['value']}`" for c in bad) + ", which only that file supplied.")
    if killed:
        return out
    readers = [i for i in before if path in [m.group(1) for l in before[i]["output"].splitlines() if (m := re.match(r"^(.+?):\d+: ", l))]]
    if not readers:
        out["why"].append(f"No eval's lookup returns {path}, so changing it cannot change any answer. The evals do not cover this file.")
    lost = files[path] if mutation["op"] == "delete_file" else (mutation.get("text") or "")
    idle = []
    for i in readers:
        carried = [c for c in after[i]["checks"] if c["kind"] == "expect" and c["value"] in lost]
        if not carried:
            idle.append(i)
            continue
        for c in carried:
            who = [x for x in _provider_paths(after[i]["output"], c["value"]) if x != path]
            if who:
                out["why"].append(f"Eval `{i}` still passes: `{c['value']}` is also in {', '.join(who)}.")
        if not any(c["kind"] == "first_line" for c in after[i]["checks"]):
            out["why"].append(f"Eval `{i}` has no `first_line`, so it does not care which file ranks first.")
    if idle:
        out["why"].append(f"{', '.join('`' + i + '`' for i in idle)} {'also lists' if len(idle) == 1 else 'also list'} {path} in {'its' if len(idle) == 1 else 'their'} lookup, but nothing {'it requires' if len(idle) == 1 else 'they require'} came from the lost text.")
    if not out["why"]:
        out["why"].append("Every requirement of the evals that read this file is still met.")
    out["fix"] = suggest_fix(files, questions, mutation)
    return out


# ---------- 4. A/B a new fact (deterministic, no model)
def ab_fact(files, questions, new_path, new_text, own_query=None, k=3):
    """Add a candidate doc; compare before/after on the existing evals and on search ranking.
    BREAKS     a `must` eval that passed now fails
    POLLUTES   the new doc displaced the old top result of some eval's search (it is now first and was not in the old top-k)
    NOT_FINDABLE own_query given and the new doc is not in its top-k
    FIT        none of the above"""
    if new_path in files:
        raise ValueError(f"{new_path} already exists; A/B adds a new file")
    after_files = {**files, new_path: new_text}
    before, after = run_evals(files, questions), run_evals(after_files, questions)
    broke = [a["id"] for b, a in zip(before, after) if b["pass"] and not a["pass"] and b["tier"] == "must"]
    polluted = []
    for q in questions:
        s = (q.get("run") or {}).get("search")
        if not s:
            continue
        b, a = top_paths(files, s, k), top_paths(after_files, s, k)
        if a and a[0] == new_path and new_path not in b:
            polluted.append({"id": q["id"], "query": s, "was_first": b[0] if b else None})
    found = None
    if own_query:
        top = top_paths(after_files, own_query, k)
        found = {"query": own_query, "rank": top.index(new_path) + 1 if new_path in top else None, "top": top}
    verdict = ("BREAKS" if broke else "POLLUTES" if polluted else "NOT_FINDABLE" if found and found["rank"] is None else "FIT")
    return {"verdict": verdict, "broke": broke, "polluted": polluted, "findable": found,
            "before": summarize(before), "after": summarize(after)}


# ---------- 5. probes, grading, the gate
def grade_answer(probe, text):
    """skill_ab.missing: every `expect` group (any-of, case-insensitive substrings) must appear. -> {correct, missing}"""
    miss = _ab.missing(probe, text or "")
    return {"correct": bool(text) and not miss, "missing": miss}


def trivial_pass(probe):
    """The dumbest answer that passes: list one string from every expected group. Shows what substring grading can and can't tell you."""
    return " ".join(str(g[0]) for g in probe.get("expect", []))


def build_results(skill, probes, outcomes, samples=3, model="fixture/none", costs=None):
    """A skill_ab-shaped results dict from outcomes {arm: {probe_id: [bool]*samples}} (arms: with, without) so the real gate can read it."""
    rows = []
    for arm in ("with", "without"):
        for p in probes:
            for n in range(samples):
                rows.append({"probe": p["id"], "split": p.get("split", "dev"), "arm": arm, "n": n, "correct": bool(outcomes[arm][p["id"]][n]),
                             "cost_usd": (costs or {}).get(arm, 0.01), "finished": True})
    return {"skill": skill, "samples": samples, "pi_args": ["--model", model], "date": "fixture", "rows": rows}


def gate_decide(cand, res):
    """Real gate.decide + a one-line reason naming the rule that fired (mirrors decide()'s order). -> dict"""
    try:
        verdict, f = _gate.decide(cand, res)
        p = _gate.validate_candidate(cand)
    except _gate.BadInput as e:
        return {"verdict": "BAD_INPUT", "reason": str(e), "facts": {}}
    why = {
        "INCONCLUSIVE": f"more than {p['max_unfinished']:.0%} of runs did not finish",
        "REGRESSION": f"regressed probes {f['regressed']} or heldout fell {f['heldout_without']}→{f['heldout_with']} (limit {p['regress_by']})",
        "CEILING": f"without-skill dev {f['dev_without']}/{f['dev_n']} ≥ ceiling {p['ceiling']:.0%}: the probes cannot show a gain",
        "NO_DELTA": f"gain {f['gain']} < min_gain {p['min_gain']}",
        "TOO_COSTLY": f"gain {f['gain']} ok but cost ×{f['cost_ratio']} > {p['max_cost_ratio']}",
        "ADOPT": f"gain {f['gain']} ≥ {p['min_gain']}, no regression, cost ×{f['cost_ratio']} ≤ {p['max_cost_ratio']}",
    }[verdict]
    return {"verdict": verdict, "reason": why, "facts": f, "params": p}


def gate_from_grid(probes, grid, params, samples=3):
    """grid: {probe_id: {"without": [bool], "with": [bool]}} + thresholds -> gate_decide result."""
    cand = {"id": "lab", "source": "lab", "claim": "lab", "skill": "lab", "samples": samples,
            **{k: v for k, v in params.items() if not k.startswith("_")}}
    res = build_results("lab", probes, {a: {k: v[a] for k, v in grid.items()} for a in ("with", "without")}, samples,
                        costs={"with": params.get("_cand_cost", 0.01)})
    return gate_decide(cand, res)


# ---------- 6. A/B a skill (text-coverage proxy + lint)
def lint_skill_text(text, name="skill"):
    """Real check_skills.check on a temp repo holding just this SKILL.md (+ the README install line the check requires)."""
    fm = _check.frontmatter(text) or {}
    sname = fm.get("name") or name
    with tempfile.TemporaryDirectory(prefix="lab-skill-") as d:
        os.makedirs(os.path.join(d, "skills", name))
        open(os.path.join(d, "skills", name, "SKILL.md"), "w", encoding="utf-8").write(text)
        open(os.path.join(d, "README.md"), "w", encoding="utf-8").write(f'ln -s "$PWD/skills/{name}" ~/.agents/skills/{sname}\n')
        errs = _check.check(d)
    return {"errors": errs}


def skill_coverage(skill_text, probes):
    """For each probe: does the skill's TEXT contain what the probe expects (real skill_ab.missing)? Necessary for the skill to help, not
    a measure of model behaviour."""
    return [{"probe": p["id"], "split": p.get("split", "dev"), "covered": not _ab.missing(p, skill_text), "missing": _ab.missing(p, skill_text)}
            for p in probes]


def ab_skill(skill_text, probes, baseline_outcomes, samples=3, params=None):
    """Deterministic fit check for a skill: lint + text coverage, then the REAL gate on (recorded baseline: `without`) vs (oracle `with`: a
    probe the skill text covers counts as answered, one it does not stays at baseline). `baseline_outcomes` is a fixture {probe: [bool]*samples}."""
    params = {"min_gain": 2, "ceiling": 0.9, "regress_by": 2, "max_cost_ratio": 1.5, **(params or {})}
    cov = skill_coverage(skill_text, probes)
    covered = {r["probe"]: r["covered"] for r in cov}
    with_out = {p["id"]: ([True] * samples if covered[p["id"]] else list(baseline_outcomes[p["id"]])) for p in probes}
    cand = {"id": "lab", "source": "lab", "claim": "lab", "skill": "lab", "samples": samples, **params}
    g = gate_decide(cand, build_results("lab", probes, {"with": with_out, "without": baseline_outcomes}, samples))
    return {"lint": lint_skill_text(skill_text), "coverage": cov, "gate": g,
            "caveat": "proxy: text coverage assumes a model that reads the skill answers what the skill states. Only a recorded model run shows behaviour."}


def fixture_baseline(probes, rates=None, samples=3):
    """A deterministic synthetic 'default model without the skill' baseline: a probe passes in the first round(rate*samples) samples.
    rates default to 0 (the model cannot answer without the skill, the situation the probes are designed for)."""
    rates = rates or {}
    return {p["id"]: [i < round(rates.get(p["id"], 0) * samples) for i in range(samples)] for p in probes}


def sha(text):
    return hashlib.sha256(text.encode()).hexdigest()[:12]
