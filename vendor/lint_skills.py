#!/usr/bin/env python3
"""Lint every SKILL.md: frontmatter, size budgets, local file references, optional deny-list. Exit 1 on any error.

  python3 scripts/lint_skills.py [skills_dir]
  LINT_DENYLIST="word1,word2"  (CI secret) fails on any listed identifier anywhere in the repo's tracked files,
  so employer names never land here. Unset = skipped.
"""
import os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
REF = re.compile(r"`((?:scripts|templates|reference|roles|examples|tests)/[\w./-]+)`")
MAX_DESC, MAX_BYTES = 1024, 40_000


def frontmatter(text):
    if not text.startswith("---\n"):
        return None
    end = text.find("\n---", 4)
    if end < 0:
        return None
    out = {}
    for line in text[4:end].splitlines():
        m = re.match(r"^([a-zA-Z_-]+):\s*(.*)$", line)
        if m:
            out[m.group(1)] = m.group(2).strip().strip('"')
    return out


def lint_skill(path):
    errs = []
    text = open(path, encoding="utf-8").read()
    d = os.path.dirname(path)
    fm = frontmatter(text)
    if fm is None:
        return [f"{path}: missing --- frontmatter ---"]
    name, desc = fm.get("name", ""), fm.get("description", "")
    if not NAME.match(name):
        errs.append(f"{path}: name {name!r} must be lowercase-kebab")
    if not desc:
        errs.append(f"{path}: description is empty")
    elif len(desc) > MAX_DESC:
        errs.append(f"{path}: description is {len(desc)} chars (max {MAX_DESC})")
    elif not re.search(r"\buse\b", desc, re.I):
        errs.append(f"{path}: description should say when to use it")
    if len(text.encode()) > MAX_BYTES:
        errs.append(f"{path}: {len(text.encode())} bytes (max {MAX_BYTES}); move detail to reference/")
    for ref in sorted(set(REF.findall(text))):
        if "<" in ref or "*" in ref:
            continue
        if not any(os.path.exists(os.path.join(base, ref.rstrip("/"))) for base in (d, os.path.dirname(d))):
            errs.append(f"{path}: references `{ref}`, which does not exist")
    return errs


def denylist_errors():
    words = [w.strip().lower() for w in os.environ.get("LINT_DENYLIST", "").split(",") if w.strip()]
    if not words:
        return []
    files = subprocess.run(["git", "-C", ROOT, "ls-files"], capture_output=True, text=True, check=True).stdout.split()
    errs = []
    for f in files:
        try:
            low = open(os.path.join(ROOT, f), encoding="utf-8", errors="ignore").read().lower()
        except OSError:
            continue
        errs += [f"{f}: contains a deny-listed identifier (#{i})" for i, w in enumerate(words) if w in low or w in f.lower()]
    return errs


def main():
    sdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "skills")
    paths = sorted(os.path.join(r, "SKILL.md") for r, _, fs in os.walk(sdir) if "SKILL.md" in fs)
    errs = [e for p in paths for e in lint_skill(p)] + denylist_errors()
    names = [frontmatter(open(p).read() or "") or {} for p in paths]
    seen = {}
    for p, fm in zip(paths, names):
        n = fm.get("name")
        if n in seen:
            errs.append(f"{p}: duplicate skill name {n!r} (also {seen[n]})")
        seen[n] = p
    for e in errs:
        print(e)
    print(f"lint_skills: {len(paths)} skills, {len(errs)} errors")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
