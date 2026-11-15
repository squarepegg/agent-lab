#!/usr/bin/env python3
"""Copy the upstream scripts the lab runs, unmodified, into vendor/ and record where they came from.
  python3 scripts/vendor.py --map ../agent-knowledge-map --toolkit ../agent-toolkit
check_vendor.py (CI, scheduled) re-fetches upstream and fails if a vendored file differs from the recorded hash or from upstream."""
import argparse, hashlib, json, os, shutil, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILES = {"map": ["scripts/brain.py", "scripts/_fm.py", "scripts/eval_run.py", "scripts/_attempts.py"],
         "toolkit": ["evals/gate.py", "scripts/skill_ab.py", "scripts/check_skills.py"]}


def sha(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def head(d):
    """Upstream's published main when known (a local branch's HEAD would not be a commit anyone else has)."""
    for ref in ("origin/main", "HEAD"):
        r = subprocess.run(["git", "-C", d, "rev-parse", ref], capture_output=True, text=True)
        if r.returncode == 0:
            return r.stdout.strip()
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", required=True)
    ap.add_argument("--toolkit", required=True)
    a = ap.parse_args()
    out, src = {}, {"map": a.map, "toolkit": a.toolkit}
    os.makedirs(os.path.join(ROOT, "vendor"), exist_ok=True)
    for repo, files in FILES.items():
        for f in files:
            dst = os.path.join(ROOT, "vendor", os.path.basename(f))
            shutil.copyfile(os.path.join(src[repo], f), dst)
            out[os.path.basename(f)] = {"repo": repo, "path": f, "sha256": sha(dst)}
    meta = {"upstream_commits": {k: head(v) for k, v in src.items()}, "files": out}
    json.dump(meta, open(os.path.join(ROOT, "vendor", "VENDOR.json"), "w"), indent=1, sort_keys=True)
    print(f"vendored {len(out)} files")


if __name__ == "__main__":
    main()
