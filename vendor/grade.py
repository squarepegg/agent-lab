#!/usr/bin/env python3
"""Grading for agentic probes. Pure functions, no model calls, no I/O: the same answer always gets the same grade.

A probe (evals/probes.yaml):
  expect:    list of groups; every group must match, a group matches if ANY of its strings is in the answer (case-insensitive)
  expect_re: regexes that must all match
  forbid:    strings that must not appear (a wrong claim)
  max_words: concision budget (reported, not part of `correct`)
"""
import re

WORD = re.compile(r"\w+")


def words(text):
    return len(WORD.findall(text or ""))


def grade(probe, text):
    """-> dict(correct: bool, concise: bool, missing: [group], forbidden: [str])"""
    low = (text or "").lower()
    missing = [g for g in probe.get("expect", []) if not any(str(alt).lower() in low for alt in g)]
    missing += [f"re:{p}" for p in probe.get("expect_re", []) if not re.search(p, text or "", re.I)]
    forbidden = [f for f in probe.get("forbid", []) if f.lower() in low]
    return {
        "correct": bool(text) and not missing and not forbidden,
        "concise": words(text) <= probe.get("max_words", 150),
        "missing": missing,
        "forbidden": forbidden,
    }
