"""JSON-in/JSON-out dispatch used by the web UI (Pyodide) and the Node smoke test. Whitelisted; errors come back as {"error": ...}."""
import json, os, sys

import yaml

import lab_core as L

FNS = {
    "explore": lambda a: L.explore(a["files"]),
    "search": lambda a: L.search(a["files"], a["query"], a.get("limit", 10)),
    "run_evals": lambda a: (lambda r: {"results": r, "summary": L.summarize(r)})(L.run_evals(a["files"], L.parse_questions(a["questions"]))),
    "mutate": lambda a: L.mutate_and_run(a["files"], L.parse_questions(a["questions"]), a["mutation"]),
    "explain": lambda a: L.explain_mutation(a["files"], L.parse_questions(a["questions"]), a["mutation"]),
    "auto_mutants": lambda a: L.auto_mutants(a["files"], L.parse_questions(a["questions"])),
    "ab_fact": lambda a: L.ab_fact(a["files"], L.parse_questions(a["questions"]), a["path"], a["text"], a.get("own_query") or None),
    "grade": lambda a: L.grade_answer(a["probe"], a["text"]),
    "trivial_pass": lambda a: L.trivial_pass(a["probe"]),
    "gate": lambda a: L.gate_from_grid(a["probes"], a["grid"], a["params"], a.get("samples", 3)),
    "ab_skill": lambda a: L.ab_skill(a["text"], a["probes"], L.fixture_baseline(a["probes"], a.get("rates"), a.get("samples", 3)),
                                     a.get("samples", 3), a.get("params")),
    "parse_yaml": lambda a: yaml.safe_load(a["text"]),
    "lint_skill": lambda a: L.lint_skill_text(a["text"]),
}


def _trace(a):
    """Run FNS[target](args) with a line tracer on the vendored upstream files only. -> {"hits": {file: {line: count}}}.
    The result of the call is discarded: this exists to show WHICH upstream lines ran, never to change a verdict."""
    target = a["target"]
    if target == "trace" or target not in FNS:
        raise ValueError(f"cannot trace {target}")
    vendor = os.path.realpath(L.VENDOR)
    hits = {}

    def local(frame, event, arg):
        if event == "line":
            d = hits.setdefault(os.path.basename(frame.f_code.co_filename), {})
            d[frame.f_lineno] = d.get(frame.f_lineno, 0) + 1
        return local

    def glob(frame, event, arg):
        return local if os.path.dirname(os.path.realpath(frame.f_code.co_filename)) == vendor else None

    old = sys.gettrace()
    sys.settrace(glob)
    try:
        FNS[target](a.get("args") or {})
    finally:
        sys.settrace(old)
    return {"hits": {f: {str(k): v for k, v in d.items()} for f, d in hits.items()}}


FNS["trace"] = _trace

EDIT_BUDGET = 400_000  # executed lines; stops `while True` in a learner's edit instead of freezing the tab
MODS = {"brain.py": L._brain, "eval_run.py": L._eval, "gate.py": L._gate, "skill_ab.py": L._ab, "check_skills.py": L._check}


def _run_edit(a):
    """Run FNS[target](args) twice: with the real upstream function and with the learner's edited source of `file`:`fn`.
    The edit is swapped in for the duration of the call only and always restored, so the page's real results never change.
    -> {"base": result, "edited": result} or {"base": result, "error": "..."}."""
    target, file, fn = a["target"], a["file"], a["fn"]
    if target in ("trace", "run_edit") or target not in FNS:
        raise ValueError(f"cannot run {target}")
    mod = MODS.get(file)
    if mod is None or not callable(getattr(mod, fn, None)):
        raise ValueError(f"cannot edit {file}:{fn}")
    args = a.get("args") or {}
    base = FNS[target](args)
    try:
        ns = dict(vars(mod))
        ns.pop(fn)  # so that source which does not define `fn` is caught, not silently the original
        exec(compile(a["src"], "<edit>", "exec"), ns)
        new = ns.get(fn)
        if not callable(new):
            return {"base": base, "error": f"your source must define `def {fn}(...)`"}
    except SyntaxError as e:
        return {"base": base, "error": f"SyntaxError on line {e.lineno}: {e.msg}"}
    except Exception as e:
        return {"base": base, "error": f"{type(e).__name__}: {e}"}
    vendor, count, old_fn, old_trace = os.path.realpath(L.VENDOR), [0], getattr(mod, fn), sys.gettrace()

    def local(frame, event, arg):
        count[0] += 1
        if count[0] > EDIT_BUDGET:
            raise TimeoutError(f"your edit ran more than {EDIT_BUDGET:,} lines: is there an endless loop?")
        return local

    def glob(frame, event, arg):
        f = frame.f_code.co_filename
        return local if f == "<edit>" or os.path.dirname(os.path.realpath(f)) == vendor else None

    setattr(mod, fn, new)
    sys.settrace(glob)
    try:
        edited = FNS[target](args)
    except Exception as e:
        return {"base": base, "error": f"{type(e).__name__}: {e}"}
    finally:
        sys.settrace(old_trace)
        setattr(mod, fn, old_fn)
    return {"base": base, "edited": edited}


FNS["run_edit"] = _run_edit


def call(name, args_json):
    try:
        if name not in FNS:
            raise ValueError(f"unknown call {name}")
        return json.dumps(FNS[name](json.loads(args_json)))
    except (ValueError, KeyError, TypeError) as e:
        return json.dumps({"error": f"{type(e).__name__}: {e}"})
    except Exception as e:  # yaml errors etc.: show, never crash the page
        return json.dumps({"error": f"{type(e).__name__}: {e}"})
