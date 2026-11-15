"""JSON-in/JSON-out dispatch used by the web UI (Pyodide) and the Node smoke test. Whitelisted; errors come back as {"error": ...}."""
import json

import yaml

import lab_core as L

FNS = {
    "explore": lambda a: L.explore(a["files"]),
    "search": lambda a: L.search(a["files"], a["query"], a.get("limit", 10)),
    "run_evals": lambda a: (lambda r: {"results": r, "summary": L.summarize(r)})(L.run_evals(a["files"], L.parse_questions(a["questions"]))),
    "mutate": lambda a: L.mutate_and_run(a["files"], L.parse_questions(a["questions"]), a["mutation"]),
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


def call(name, args_json):
    try:
        if name not in FNS:
            raise ValueError(f"unknown call {name}")
        return json.dumps(FNS[name](json.loads(args_json)))
    except (ValueError, KeyError, TypeError) as e:
        return json.dumps({"error": f"{type(e).__name__}: {e}"})
    except Exception as e:  # yaml errors etc.: show, never crash the page
        return json.dumps({"error": f"{type(e).__name__}: {e}"})
