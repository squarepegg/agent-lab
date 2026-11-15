"""Native tests for lab/lab_core.py against the vendored upstream code. python3 -m unittest discover -s tests"""
import json, os, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "lab"))
import yaml
import lab_core as L


def load_dir(base):
    out = {}
    for r, _, fs in os.walk(base):
        for f in fs:
            full = os.path.join(r, f)
            out[os.path.relpath(full, base)] = open(full, encoding="utf-8").read()
    return out


BRAIN = load_dir(os.path.join(ROOT, "sample", "brain"))
QS = L.parse_questions(BRAIN.pop("evals/questions.yaml"))
BRAIN.pop("evals/recall.yaml", None)
SKILLS = {n: open(os.path.join(ROOT, "sample", "skills", n, "SKILL.md")).read() for n in ("dst", "doubt", "evidence-gated")}
PROBES = [{**p, "skill": n} for n in SKILLS for p in json.load(open(os.path.join(ROOT, "sample", "skills", n, "evals", "probes.json")))]


class Map(unittest.TestCase):
    def test_explore_and_search(self):
        kinds = {n["kind"] for n in L.explore(BRAIN)}
        self.assertTrue({"fact", "workstream", "decision", "catalog"} <= kinds)
        top = L.search(BRAIN, "order_date UTC")[0]
        self.assertIn("orders-timestamps", top["path"])
        self.assertEqual(L.search(BRAIN, "zzzqxvnonsense"), [])

    def test_search_is_deterministic(self):
        self.assertEqual(L.search(BRAIN, "late rows"), L.search(dict(reversed(list(BRAIN.items()))), "late rows"))


class Evals(unittest.TestCase):
    def test_sample_must_evals_pass(self):
        res = L.run_evals(BRAIN, QS)
        s = L.summarize(res)
        self.assertTrue(s["ok"], [r for r in res if not r["pass"] and r["tier"] == "must"])
        self.assertGreater(s["must_total"], 3)

    def test_breakdown_agrees_with_upstream_check(self):
        import eval_run
        for r, q in zip(L.run_evals(BRAIN, QS), QS):
            if r["tier"] == "skip":
                continue
            ok, *_ = eval_run.check(q, r["output"])
            self.assertEqual(r["pass"], ok, q["id"])
            self.assertEqual(r["pass"], all(c["ok"] for c in r["checks"]), q["id"])

    def test_cmd_questions_are_refused_not_faked(self):
        r = L.run_question(BRAIN, {"id": "x", "run": {"cmd": ["ls"]}, "expect": []})
        self.assertFalse(r["pass"])
        self.assertIn("browser", r["error"])

    def test_bad_eval_fails_visibly(self):
        bad = {"id": "bad", "q": "?", "run": {"search": "order_date UTC"}, "expect": ["definitely-not-in-the-brain"], "tier": "must"}
        r = L.run_question(BRAIN, bad)
        self.assertFalse(r["pass"])
        self.assertEqual([c for c in r["checks"] if not c["ok"]][0]["value"], "definitely-not-in-the-brain")
        bad2 = {**bad, "expect": [], "first_line": "wrong-file"}
        self.assertFalse(L.run_question(BRAIN, bad2)["pass"])
        bad3 = {**bad, "expect": [], "forbid": ["orders.created_at"]}
        self.assertFalse(L.run_question(BRAIN, bad3)["pass"])

    def test_needs_skips(self):
        r = L.run_question({}, {"id": "n", "run": {"search": "x"}, "needs": ["facts/gone.md"], "expect": ["y"]})
        self.assertEqual((r["tier"], r["pass"]), ("skip", True))


class Mutations(unittest.TestCase):
    def test_deleting_the_answer_is_caught(self):
        r = L.mutate_and_run(BRAIN, QS, {"op": "delete_file", "path": "facts/orders-timestamps-utc.md"})
        self.assertIn("midnight-mismatch", r["killed_by"])
        self.assertFalse(r["survived"])

    def test_irrelevant_edit_survives(self):
        r = L.mutate_and_run(BRAIN, QS, {"op": "replace_text", "path": "facts/orders-timestamps-utc.md", "text": "Use `created_at`", "with": "Use created_at"})
        self.assertTrue(r["survived"], "a formatting-only edit must not be flagged")

    def test_input_not_mutated_and_errors(self):
        snap = dict(BRAIN)
        L.apply_mutation(BRAIN, {"op": "delete_file", "path": "facts/pii-hashed-email.md"})
        self.assertEqual(BRAIN, snap)
        for m in ({"op": "delete_file", "path": "nope"}, {"op": "remove_text", "path": "glossary.yaml", "text": "zzz-not-there"}, {"op": "x", "path": "glossary.yaml"}):
            with self.assertRaises(ValueError):
                L.apply_mutation(BRAIN, m)

    def test_auto_mutants_include_text_removals_that_get_killed(self):
        full = L.auto_mutants(BRAIN, QS)
        removals = [m for m in full["mutants"] if m["mutation"]["op"] == "remove_text"]
        self.assertTrue(removals)
        self.assertTrue(any(m["killed_by"] for m in removals), "removing an expected string from its fact must fail an eval")

    def test_auto_mutants_score_and_a_weak_eval_set_scores_lower(self):
        full = L.auto_mutants(BRAIN, QS)
        self.assertGreater(full["total"], 5)
        self.assertGreaterEqual(full["score"], 0.5)
        weak = L.auto_mutants(BRAIN, QS[:1])  # one eval cannot notice most mutants
        self.assertLess(weak["score"], full["score"])
        self.assertTrue(weak["survivors"])


class Explain(unittest.TestCase):
    def test_killed_explains_which_check_failed(self):
        e = L.explain_mutation(BRAIN, QS, {"op": "delete_file", "path": "facts/orders-timestamps-utc.md"})
        self.assertFalse(e["survived"])
        self.assertEqual(e["killed"][0]["eval"], "midnight-mismatch")
        self.assertTrue(any("orders.created_at" in f for f in e["killed"][0]["failed"]))
        self.assertIn("only that file supplied", e["why"][0])

    def test_survivor_names_the_other_file_that_covers_it(self):
        e = L.explain_mutation(BRAIN, QS, {"op": "delete_file", "path": "facts/airflow-backfill-concurrency.md"})
        self.assertTrue(e["survived"])
        self.assertTrue(any("max-active-runs" in w and "STATE.md" in w for w in e["why"]), e["why"])
        self.assertTrue(any("no `first_line`" in w for w in e["why"]))

    def test_uncovered_file_is_called_out(self):
        files = {**BRAIN, "facts/orphan.md": "---\ntitle: Orphan zebra quokka\n---\nzebra quokka platypus specific words\n"}
        e = L.explain_mutation(files, QS, {"op": "delete_file", "path": "facts/orphan.md"})
        self.assertTrue(e["survived"])
        self.assertIn("No eval's lookup returns", e["why"][0])
        self.assertTrue(e["fix"]["verified"], e["fix"])

    def test_every_suggested_fix_is_verified_and_actually_kills_the_survivor(self):
        survivors = L.auto_mutants(BRAIN, QS)["survivors"]
        self.assertTrue(survivors)
        fixable = 0
        for m in survivors:
            fix = L.explain_mutation(BRAIN, QS, m)["fix"]
            if fix["yaml"] is None:
                self.assertFalse(fix["verified"])
                self.assertTrue(fix["note"])
                continue
            fixable += 1
            q = yaml.safe_load(fix["yaml"])
            self.assertTrue(L.summarize(L.run_evals(BRAIN, QS + q))["ok"], "the new eval passes on the real brain")
            self.assertFalse(L.mutate_and_run(BRAIN, QS + q, m)["survived"], f"and kills {m}")
        self.assertGreaterEqual(fixable, 1)

    def test_applying_all_fixes_never_lowers_the_mutation_score(self):
        before = L.auto_mutants(BRAIN, QS)
        qs = list(QS)
        for m in before["survivors"]:
            fix = L.explain_mutation(BRAIN, qs, m)["fix"]
            if fix["yaml"]:
                qs += yaml.safe_load(fix["yaml"])
        after = L.auto_mutants(BRAIN, qs)
        self.assertGreater(after["killed"], before["killed"])
        self.assertTrue(L.summarize(L.run_evals(BRAIN, qs))["ok"])

    def test_unique_tokens_exclude_anything_another_file_has(self):
        files = {"facts/a.md": "alpha-unique shared-word-here", "facts/b.md": "shared-word-here other"}
        self.assertEqual(L._unique_tokens(files, "facts/a.md"), ["alpha-unique"])

    def test_a_fix_that_does_not_kill_is_never_offered(self):
        # the unique token also lives in the title, so removing the body copy changes nothing an eval can see
        files = {**BRAIN, "facts/zed.md": "---\ntitle: zyxwv-token quirk\n---\nbody says zyxwv-token\n"}
        fix = L.explain_mutation(files, QS, {"op": "remove_text", "path": "facts/zed.md", "text": "body says zyxwv-token"})["fix"]
        self.assertFalse(fix["verified"])
        self.assertIsNone(fix["yaml"])

    def test_providers_never_include_the_mutated_file_itself(self):
        files = {**BRAIN}
        files["facts/orders-timestamps-utc.md"] = files["facts/orders-timestamps-utc.md"] + "\nUTC appears twice. UTC again.\n"
        e = L.explain_mutation(files, QS, {"op": "remove_text", "path": "facts/orders-timestamps-utc.md", "text": "UTC appears twice."})
        self.assertFalse(any("also in" in w and "facts/orders-timestamps-utc.md" in w.split("also in", 1)[1] for w in e["why"]), e["why"])

    def test_duplicated_text_is_called_redundancy_not_a_weak_eval(self):
        fix = L.explain_mutation(BRAIN, QS, {"op": "remove_text", "path": "facts/orders-timestamps-utc.md", "text": "UTC"})["fix"]
        self.assertIsNone(fix["yaml"])
        self.assertIn("redundancy", fix["note"])


class AbFact(unittest.TestCase):
    GOOD = "---\ntitle: Fiscal calendar starts in February\ntags: [calendar]\nverified: true\n---\nOur fiscal year starts on 1 February; quarter boundaries differ from calendar quarters.\n"

    def test_fit(self):
        r = L.ab_fact(BRAIN, QS, "facts/fiscal-calendar.md", self.GOOD, own_query="fiscal year quarter")
        self.assertEqual(r["verdict"], "FIT", r)
        self.assertEqual(r["findable"]["rank"], 1)

    def test_not_findable(self):
        r = L.ab_fact(BRAIN, QS, "facts/x.md", self.GOOD, own_query="completely unrelated words")
        self.assertEqual(r["verdict"], "NOT_FINDABLE")

    def test_pollutes_when_it_hijacks_an_existing_query(self):
        hijack = "---\ntitle: backfill concurrency\ntags: [backfill, concurrency]\n---\nbackfill concurrency\n"
        r = L.ab_fact(BRAIN, QS, "facts/aaa-hijack.md", hijack, own_query="backfill concurrency")
        self.assertEqual(r["verdict"], "POLLUTES", r)  # the eval still passes (substring present) but the right fact lost rank 1
        self.assertEqual(r["polluted"][0]["id"], "backfill")

    def test_breaks_when_a_must_eval_stops_passing(self):
        hijack = "---\ntitle: late rollups final\ntags: [late, rollups, final]\n---\nlate rollups final\n"
        r = L.ab_fact(BRAIN, QS, "facts/aaa-hijack.md", hijack)
        self.assertEqual(r["verdict"], "BREAKS", "first_line moved off mobile-events: a must eval fails")
        self.assertEqual(r["broke"], ["finality"])

    def test_refuses_overwrite(self):
        with self.assertRaises(ValueError):
            L.ab_fact(BRAIN, QS, "facts/pii-hashed-email.md", "x")


class Gate(unittest.TestCase):
    P = [{"id": f"p{i}", "split": "dev"} for i in range(3)] + [{"id": "h", "split": "heldout"}]

    def grid(self, without, with_, held=(True, True, True), hwith=None):
        g = {f"p{i}": {"without": without[i], "with": with_[i]} for i in range(3)}
        g["h"] = {"without": list(held), "with": list(hwith or held)}
        return g

    def decide(self, grid, **params):
        return L.gate_from_grid(self.P, grid, {"min_gain": 2, "ceiling": 0.9, "regress_by": 2, "max_cost_ratio": 1.5, **params})

    def test_every_verdict_reachable(self):
        F, T = [False] * 3, [True] * 3
        self.assertEqual(self.decide(self.grid([F, F, F], [T, T, F]))["verdict"], "ADOPT")
        self.assertEqual(self.decide(self.grid([F, F, F], [F, F, F]))["verdict"], "NO_DELTA")
        self.assertEqual(self.decide(self.grid([T, T, T], [T, T, T]))["verdict"], "CEILING")
        self.assertEqual(self.decide(self.grid([F, F, T], [T, T, F]))["verdict"], "REGRESSION")
        self.assertEqual(self.decide(self.grid([F, F, F], [T, T, F], held=T, hwith=F))["verdict"], "REGRESSION")
        self.assertEqual(self.decide(self.grid([F, F, F], [T, T, F]), _cand_cost=0.05)["verdict"], "TOO_COSTLY")

    def test_reason_names_the_rule_and_is_deterministic(self):
        F, T = [False] * 3, [True] * 3
        a = self.decide(self.grid([F, F, F], [T, T, F]))
        self.assertEqual(a, self.decide(self.grid([F, F, F], [T, T, F])))
        self.assertIn("gain 6", a["reason"])

    def test_thresholds_move_the_verdict(self):
        F = [False] * 3
        g = self.grid([F, F, F], [[True, True, False], F, F])
        self.assertEqual(self.decide(g, min_gain=2)["verdict"], "ADOPT")
        self.assertEqual(self.decide(g, min_gain=3)["verdict"], "NO_DELTA")

    def test_bad_input_is_reported(self):
        F = [False] * 3
        self.assertEqual(self.decide(self.grid([F, F, F], [F, F, F]), min_gain=-1)["verdict"], "BAD_INPUT")

    def test_grade_answer_and_the_dumbest_passing_answer(self):
        p = next(p for p in PROBES if p["id"] == "dst-pr-tier")
        self.assertFalse(L.grade_answer(p, "I like turtles")["correct"])
        self.assertFalse(L.grade_answer(p, "")["correct"])
        self.assertFalse(L.grade_answer({"id": "x", "expect": []}, "")["correct"], "an empty answer is never correct, even with no requirements")
        self.assertTrue(L.grade_answer(p, L.trivial_pass(p))["correct"], "substring grading accepts a keyword list: that is the lesson")
        self.assertTrue(L.grade_answer(p, "150 seeds, NO DOCKER").get("correct"), "case-insensitive any-of")


class AbSkill(unittest.TestCase):
    def test_dst_skill_covers_dst_probes_and_lints_clean(self):
        probes = [p for p in PROBES if p["skill"] == "dst"]
        r = L.ab_skill(SKILLS["dst"], probes, L.fixture_baseline(probes))
        self.assertTrue(any(c["covered"] for c in r["coverage"]))
        self.assertEqual(r["lint"]["errors"], [])
        self.assertIn(r["gate"]["verdict"], ("ADOPT", "NO_DELTA", "REGRESSION", "CEILING"))
        self.assertIn("proxy", r["caveat"])

    def test_covered_probes_never_do_worse_than_baseline(self):
        probes = [p for p in PROBES if p["skill"] == "doubt"]
        base = L.fixture_baseline(probes, {probes[0]["id"]: 1})
        r = L.ab_skill(SKILLS["doubt"], probes, base)
        self.assertNotEqual(r["gate"]["verdict"], "REGRESSION")

    def test_irrelevant_text_is_no_delta(self):
        probes = [p for p in PROBES if p["skill"] == "dst"]
        r = L.ab_skill("---\nname: filler\ndescription: Use when you need filler text.\n---\nLorem ipsum.\n", probes, L.fixture_baseline(probes))
        self.assertEqual(r["gate"]["verdict"], "NO_DELTA")
        self.assertFalse(any(c["covered"] for c in r["coverage"]))

    def test_lint_uses_the_real_checks(self):
        self.assertEqual(L.lint_skill_text(SKILLS["dst"], "dst")["errors"], [])
        self.assertTrue(L.lint_skill_text("no frontmatter at all", "bad")["errors"])
        self.assertTrue(any("description missing" in e for e in L.lint_skill_text("---\nname: x\n---\nbody", "x")["errors"]))
        leak = "---\nname: x\ndescription: Use when testing.\n---\nuse ~/.agents/brain here"
        self.assertTrue(any("private string" in e for e in L.lint_skill_text(leak, "x")["errors"]), "the public-repo hygiene check applies")
        self.assertTrue(any("description" in e for e in L.lint_skill_text("---\nname: x\ndescription: " + "a" * 2000 + "\n---\nb", "x")["errors"]))


if __name__ == "__main__":
    unittest.main()
