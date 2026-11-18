#!/usr/bin/env python3
"""Fail if a recorded model run (recorded/*.json) no longer is what was recorded. Offline, so it can gate every push.
  - every file matches its sha256 in recorded/RUNS.json, and no unlisted results file exists
  - its probes are the ones in sample/skills (probes_sha256, the rule gate.py itself applies) and the model is pinned
  - re-grading every answer with the vendored skill_ab.missing gives the recorded `correct` (the grader has not drifted)
  - no file holds the shape of a machine path (/Users/x, /home/x, C:\\Users, /var/folders/xx/yyyy): the scrubber replaces only paths it was told
    about, so this is the second layer that refuses what it did not expect
  - no file holds a word on upstream's own private-word list (check_skills.ALL_FILES_FORBID, the one it applies to every file under skills/). A model that
    lists its harness's install folders names whatever is installed there (found on a real re-recording), which no path-shape check can know
Recorded runs are made by scripts/record_runs.py, the only thing here that calls a model."""
import glob, hashlib, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "vendor"))
sys.path.insert(0, os.path.join(ROOT, "lab"))
import check_skills  # noqa: E402  (vendored; only its list of private words is used)
import skill_ab  # noqa: E402  (vendored; only its pure missing() is used)
from scrub import detect  # noqa: E402  (lab-written: the shape of a home or temp path, with no knowledge of any machine)


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main():
    rec = os.path.join(ROOT, "recorded")
    meta = json.load(open(os.path.join(rec, "RUNS.json")))
    bad = []
    for k in ("runner", "harness", "prompt", "recorded_at"):
        if not meta.get(k):
            bad.append(f"RUNS.json: missing `{k}` (every run must say how it was made)")
    on_disk = {os.path.basename(p) for p in glob.glob(os.path.join(rec, "*.json"))} - {"RUNS.json"}
    for name in sorted(on_disk ^ set(meta["files"])):
        bad.append(f"{name}: {'not listed in RUNS.json' if name in on_disk else 'listed in RUNS.json but missing'}")
    for name, m in sorted(meta["files"].items()):
        path = os.path.join(rec, name)
        if name not in on_disk:
            continue
        if sha(path) != m["sha256"]:
            bad.append(f"{name}: edited after recording (sha256 differs from RUNS.json); re-record with scripts/record_runs.py")
            continue
        body = open(path, encoding="utf-8").read()
        words = [w for w in check_skills.ALL_FILES_FORBID if w in body.lower()]
        if words:
            bad.append(f"{name}: holds {words[0]!r}, a word on upstream's private list; extend scrub() in lab/scrub.py and re-scrub")
            continue
        found = detect(body)
        if found:
            bad.append(f"{name}: holds what looks like a machine path ({found[0]!r}); scripts/record_runs.py's scrub did not cover it")
            continue
        res = json.load(open(path))
        if not m.get("model") or m.get("model") not in res.get("pi_args", []) or not m.get("date"):
            bad.append(f"{name}: model or date missing, or RUNS.json disagrees with the results file")
        probes_path = os.path.join(ROOT, "sample", "skills", res["skill"], "evals", "probes.json")
        if sha(probes_path) != res.get("probes_sha256"):
            bad.append(f"{name}: sample/skills/{res['skill']}/evals/probes.json changed since the run; re-record")
            continue
        probes = {p["id"]: p for p in json.load(open(probes_path))}
        for r in res["rows"]:
            want = not skill_ab.missing(probes[r["probe"]], r["answer"]) and r["finished"]
            if bool(r["correct"]) != bool(want):
                bad.append(f"{name}: {r['probe']} {r['arm']} #{r['n']} is recorded as correct={r['correct']} but the vendored grader says {want}")
    print("\n".join(bad) or f"recorded ok ({len(meta['files'])} runs, {sum(m['answers'] for m in meta['files'].values())} answers)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
