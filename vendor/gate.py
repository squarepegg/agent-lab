#!/usr/bin/env python3
"""Deterministic adopt/reject gate for a candidate (a skill, prompt rule or external resource).

  python3 evals/gate.py evals/candidates/<id>.yaml results/<id>/baseline.json results/<id>/candidate.json [--md out.md]

The model runs (evals/run.py) are noisy; this verdict is not: same inputs, same verdict. Thresholds come from the
candidate file, which must be committed before the run (run.py records its sha256 and this gate refuses a mismatch).

Verdicts (exit 0 = ADOPT, 1 = not adopted, 2 = bad input):
  ADOPT        gain >= min_gain on dev, heldout not down by regress_by, no per-probe regression, cost within max_cost_ratio
  CEILING      baseline already >= ceiling on dev: the probes cannot show a gain (write harder probes, or drop it)
  NO_DELTA     gain < min_gain
  REGRESSION   some probe, or the heldout split, lost >= regress_by correct samples
  TOO_COSTLY   gain is there but cost ratio > max_cost_ratio
  INCONCLUSIVE more than max_unfinished of the runs timed out
"""
import hashlib, json, sys
from collections import defaultdict

DEFAULTS = {"min_gain": 2, "ceiling": 0.9, "regress_by": 2, "max_cost_ratio": 1.5, "max_unfinished": 0.1}


class BadInput(Exception):
    pass


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def tally(run):
    """-> {(split, probe): correct_count}, total_cost, unfinished_fraction"""
    per = defaultdict(int)
    cost, unfinished = 0.0, 0
    for r in run["results"]:
        per[(r["split"], r["probe"])] += 1 if r["correct"] and r.get("finished", True) else 0
        cost += float(r.get("cost_usd") or 0)
        unfinished += 0 if r.get("finished", True) else 1
    return per, cost, unfinished / max(1, len(run["results"]))


def check_pair(cand, base, test):
    for k in ("candidate", "model", "samples", "probes_sha", "candidate_sha"):
        if base.get(k) != test.get(k):
            raise BadInput(f"arms differ on {k}: {base.get(k)!r} vs {test.get(k)!r}")
    if base.get("candidate") != cand["id"]:
        raise BadInput(f"results are for {base.get('candidate')!r}, not {cand['id']!r}")
    if base.get("arm") != "baseline" or test.get("arm") != "candidate":
        raise BadInput("pass the baseline results first, then the candidate results")
    keys = lambda run: sorted((r["split"], r["probe"], r["sample"]) for r in run["results"])
    if keys(base) != keys(test):
        raise BadInput("arms ran different probe/sample sets")
    if not base["results"]:
        raise BadInput("no results")


def decide(cand, base, test):
    """Pure: candidate spec + two result dicts -> (verdict, facts)."""
    check_pair(cand, base, test)
    p = {**DEFAULTS, **{k: cand[k] for k in DEFAULTS if k in cand}}
    b, bcost, bunf = tally(base)
    c, ccost, cunf = tally(test)
    n = base["samples"]
    split_sum = lambda t, s: sum(v for (sp, _), v in t.items() if sp == s)
    dev_n = n * sum(1 for (sp, _) in b if sp == "dev")
    facts = {
        "dev_base": split_sum(b, "dev"), "dev_cand": split_sum(c, "dev"), "dev_n": dev_n,
        "heldout_base": split_sum(b, "heldout"), "heldout_cand": split_sum(c, "heldout"),
        "heldout_n": n * sum(1 for (sp, _) in b if sp == "heldout"),
        "cost_base": round(bcost, 4), "cost_cand": round(ccost, 4),
        "cost_ratio": round(ccost / bcost, 2) if bcost > 0 else (1.0 if ccost == 0 else float("inf")),
        "regressed": sorted(pr for (sp, pr), v in b.items() if v - c[(sp, pr)] >= p["regress_by"]),
        "params": p,
    }
    facts["gain"] = facts["dev_cand"] - facts["dev_base"]
    if dev_n == 0:
        raise BadInput("no dev probes")
    if max(bunf, cunf) > p["max_unfinished"]:
        return "INCONCLUSIVE", facts
    if facts["regressed"] or facts["heldout_base"] - facts["heldout_cand"] >= p["regress_by"]:
        return "REGRESSION", facts
    if facts["dev_base"] / dev_n >= p["ceiling"]:
        return "CEILING", facts
    if facts["gain"] < p["min_gain"]:
        return "NO_DELTA", facts
    if facts["cost_ratio"] > p["max_cost_ratio"]:
        return "TOO_COSTLY", facts
    return "ADOPT", facts


def negative_result_line(cand, base, verdict, f):
    """One line in evals/negative-results.md format."""
    return (f"- {base.get('date', 'YYYY-MM-DD')} | {cand['id']} ({cand.get('source', 'n/a')}) | "
            f"{len(set(r['probe'] for r in base['results']))} probes x {base['samples']} samples, {base['model']} | "
            f"dev {f['dev_base']}/{f['dev_n']} -> {f['dev_cand']}/{f['dev_n']}, heldout {f['heldout_base']} -> {f['heldout_cand']}, "
            f"cost x{f['cost_ratio']} | {verdict}")


def main(argv):
    import yaml
    args = [a for a in argv if not a.startswith("--")]
    md = argv[argv.index("--md") + 1] if "--md" in argv else None
    if md:
        args.remove(md)
    if len(args) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    cand_path, base_path, test_path = args
    try:
        cand = yaml.safe_load(open(cand_path))
        base, test = json.load(open(base_path)), json.load(open(test_path))
        if base.get("candidate_sha") != sha256(cand_path):
            raise BadInput("candidate file changed since the run (sha256 mismatch): re-run, thresholds are pre-registered")
        verdict, f = decide(cand, base, test)
    except (BadInput, KeyError, ValueError, OSError) as e:
        print(f"gate: bad input: {e}", file=sys.stderr)
        return 2
    line = negative_result_line(cand, base, verdict, f)
    print(f"{verdict}: {cand['id']}")
    print(json.dumps({k: v for k, v in f.items() if k != 'params'}))
    print(line)
    if md:
        with open(md, "a") as out:
            out.write(f"### Eval gate: `{cand['id']}` → **{verdict}**\n\n| | baseline | candidate |\n|---|---|---|\n"
                      f"| dev correct | {f['dev_base']}/{f['dev_n']} | {f['dev_cand']}/{f['dev_n']} |\n"
                      f"| heldout correct | {f['heldout_base']}/{f['heldout_n']} | {f['heldout_cand']}/{f['heldout_n']} |\n"
                      f"| cost USD | {f['cost_base']} | {f['cost_cand']} |\n\n"
                      f"Regressed probes: {', '.join(f['regressed']) or 'none'}\n\n"
                      f"If not adopted, add to `evals/negative-results.md`:\n```\n{line}\n```\n")
    return 0 if verdict == "ADOPT" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
