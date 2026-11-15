#!/usr/bin/env python3
"""Pack everything the browser needs into web/bundle.json: the real vendored Python, lab code, sample brain, probes, sample skills."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def tree(base):
    out = {}
    for r, _, fs in os.walk(base):
        for f in sorted(fs):
            if f.endswith((".md", ".yaml", ".py", ".json")) and f != "VENDOR.json" and "__pycache__" not in r:
                out[os.path.relpath(os.path.join(r, f), base)] = open(os.path.join(r, f), encoding="utf-8").read()
    return out


def main():
    brain = tree(os.path.join(ROOT, "sample", "brain"))
    skills_dir = os.path.join(ROOT, "sample", "skills")
    skills, probes = {}, []
    for name in sorted(os.listdir(skills_dir)):
        skills[name] = open(os.path.join(skills_dir, name, "SKILL.md"), encoding="utf-8").read()
        probes += [{**p, "skill": name} for p in json.load(open(os.path.join(skills_dir, name, "evals", "probes.json")))]
    bundle = {
        "py": {**{f"vendor/{k}": v for k, v in tree(os.path.join(ROOT, "vendor")).items()},
               **{f"lab/{k}": v for k, v in tree(os.path.join(ROOT, "lab")).items()}},
        "brain": {k: v for k, v in brain.items() if not k.startswith("evals/")},
        "questions": brain["evals/questions.yaml"],
        "probes": probes,
        "skills": skills,
        "vendor": json.load(open(os.path.join(ROOT, "vendor", "VENDOR.json"))),
    }
    path = os.path.join(ROOT, "web", "bundle.json")
    json.dump(bundle, open(path, "w"), separators=(",", ":"))
    print(f"{path}: {os.path.getsize(path)//1024} KiB")


if __name__ == "__main__":
    main()
