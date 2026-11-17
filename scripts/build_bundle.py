#!/usr/bin/env python3
"""Generate what the browser needs, into web/:
  bundle.json      the real vendored Python, lab code, sample brain, probes, sample skills
  runs.json        the recorded model runs (recorded/) with how they were made
  sw-manifest.js   the service worker's asset list and a version hash, so a deploy replaces the offline cache"""
import hashlib, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")


def tree(base):
    out = {}
    for r, dirs, fs in os.walk(base):
        dirs.sort()   # os.walk order is the filesystem's; the bundle (and the keys of recorded calls) must not depend on it
        for f in sorted(fs):
            if f.endswith((".md", ".yaml", ".py", ".json")) and f != "VENDOR.json" and "__pycache__" not in r:
                out[os.path.relpath(os.path.join(r, f), base)] = open(os.path.join(r, f), encoding="utf-8").read()
    return out


def write(name, obj):
    path = os.path.join(WEB, name)
    with open(path, "w", encoding="utf-8") as f:
        f.write(obj if isinstance(obj, str) else json.dumps(obj, separators=(",", ":")))
    print(f"{path}: {os.path.getsize(path) // 1024} KiB")


def main():
    brain = tree(os.path.join(ROOT, "sample", "brain"))
    skills_dir = os.path.join(ROOT, "sample", "skills")
    skills, probes = {}, []
    for name in sorted(os.listdir(skills_dir)):
        skills[name] = open(os.path.join(skills_dir, name, "SKILL.md"), encoding="utf-8").read()
        probes += [{**p, "skill": name} for p in json.load(open(os.path.join(skills_dir, name, "evals", "probes.json")))]
    write("bundle.json", {
        "py": {**{f"vendor/{k}": v for k, v in tree(os.path.join(ROOT, "vendor")).items()},
               **{f"lab/{k}": v for k, v in tree(os.path.join(ROOT, "lab")).items()}},
        "brain": {k: v for k, v in brain.items() if not k.startswith("evals/")},
        "questions": brain["evals/questions.yaml"],
        "probes": probes,
        "skills": skills,
        "variants": {n: open(os.path.join(ROOT, "sample", "variants", n, "SKILL.md"), encoding="utf-8").read()
                     for n in sorted(os.listdir(os.path.join(ROOT, "sample", "variants")))},
        "vendor": json.load(open(os.path.join(ROOT, "vendor", "VENDOR.json"))),
    })
    rec = os.path.join(ROOT, "recorded")
    meta = json.load(open(os.path.join(rec, "RUNS.json")))
    write("runs.json", {"meta": meta, "runs": {n: json.load(open(os.path.join(rec, n))) for n in sorted(meta["files"])}})
    # Everything the page needs to work offline. sw.js and this manifest are fetched by the browser's own update check.
    assets = sorted(f for f in os.listdir(WEB) if os.path.isfile(os.path.join(WEB, f)) and not f.startswith(("sw", ".")))
    h = hashlib.sha256()
    for f in assets + ["sw.js"]:
        h.update(f.encode() + b"\0" + open(os.path.join(WEB, f), "rb").read())
    pyodide = re.search(r'export const PYODIDE = "([^"]+)"', open(os.path.join(WEB, "lab.js"), encoding="utf-8").read()).group(1)
    write("sw-manifest.js", "self.LAB = " + json.dumps({"version": h.hexdigest()[:12], "pyodide": pyodide, "assets": assets}) + ";\n")


if __name__ == "__main__":
    main()
