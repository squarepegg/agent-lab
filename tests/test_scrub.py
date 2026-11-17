"""Native tests for lab/scrub.py: the scrubber record_runs.py uses, and the lab's way of testing it on a made-up machine."""
import glob, json, os, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "lab"))
import scrub as S


def texts():
    out = []
    for f in sorted(glob.glob(os.path.join(ROOT, "recorded", "*.json"))):
        if f.endswith("RUNS.json"):
            continue
        for r in json.load(open(f))["rows"]:
            out.append({"text": r["answer"], "kind": "answer"})
            for _, a in r["tools"]:
                j = json.loads(a)
                out.append({"text": j.get("path") or j.get("command") or "", "kind": "tool"})
    return out


TEXTS = texts()


class RealScrubber(unittest.TestCase):
    def test_replaces_the_paths_it_is_told_about(self):
        out = S.scrub("cat /w/skills/x /h/.pi /Users/a/.pi /var/folders/k3/y/T/skill-ab-xy12/f /var/folders/k3/y/z", "/w", "/h", "/Users/a", "/var/folders/k3/y/T", "/var/folders/k3/y")
        self.assertEqual(out, "cat <root>/skills/x <home>/.pi <machine-home>/.pi <cwd>/f <tmp-parent>/z")

    def test_private_prefix_on_macos_is_covered(self):
        out = S.scrub("ls /private/var/folders/k3/y/T/skill-ab-q1 /var/folders/k3/y/T/x", "/w", "/h", "/Users/a", "/private/var/folders/k3/y/T", "/private/var/folders/k3/y")
        self.assertEqual(out, "ls <cwd> <tmp>/x")

    def test_it_knows_nothing_it_was_not_told(self):
        self.assertEqual(S.scrub("/USERS/A/x and //Users//a", "/w", "/h", "/Users/a", "/t"), "/USERS/A/x and //Users//a")


class OnTheRecordedTexts(unittest.TestCase):
    def test_nothing_in_the_committed_results_looks_like_a_machine_path(self):
        self.assertEqual([x for t in TEXTS for x in S.detect(t["text"])], [])

    def test_the_detector_sees_the_shapes_without_knowing_a_machine(self):
        for t in ("/Users/bob/x", "/home/bob/x", r"C:\Users\bob", "/var/folders/k3/abc123/T", "/tmp/skill-ab-9x"):
            self.assertTrue(S.detect(t), t)
        self.assertEqual(S.detect("find /private/var/folders -type f"), [], "a bare system directory identifies nobody")

    def test_with_nothing_on_the_paths_leak_with_the_real_set_none_do(self):
        self.assertGreater(S.run(TEXTS, [])["counts"]["leaks"], 20)
        k = S.run(TEXTS, S.BASE)["counts"]
        self.assertEqual((k["leaks"], k["damaged"]), (0, 0))
        self.assertEqual(k["fixed"], S.run(TEXTS, [])["counts"]["dirty"])

    def test_a_username_that_is_an_ordinary_word_trades_leaks_for_damage(self):
        base = S.run(TEXTS, S.BASE, "dev")["counts"]
        self.assertGreater(base["leaks"], 0)
        both = S.run(TEXTS, S.BASE + ["user"], "dev")["counts"]
        self.assertEqual(both["leaks"], 0)
        self.assertGreater(both["damaged"], 0)
        self.assertEqual(S.run(TEXTS, S.BASE + ["user"], "sam")["counts"]["damaged"], 0, "a rare username costs nothing")

    def test_round_trip_the_real_set_gives_back_the_recorded_text(self):
        m = S.machine()
        for t in TEXTS:
            self.assertEqual(S.scrub_with(S.raw_text(t["text"], m), m, S.BASE), t["text"].replace("<tmp-parent>", "<tmp-parent>"), t["text"][:60])


class Attacks(unittest.TestCase):
    def test_real_set_misses_the_odd_spellings_and_the_extras_catch_them(self):
        base = {a["text"] for a in S.try_attacks(S.BASE)["rows"] if a["leaks"]}
        self.assertEqual(len(base), 5, base)
        self.assertEqual([a for a in S.try_attacks(S.BASE + S.EXTRA)["rows"] if a["leaks"]], [])

    def test_each_extra_fixes_its_own_case(self):
        rows = lambda extra: {a["note"] for a in S.try_attacks(S.BASE + extra)["rows"] if a["leaks"]}
        self.assertNotIn("the same path in capital letters", rows(["nocase"]))
        self.assertNotIn("the same path with doubled slashes", rows(["slashes"]))
        self.assertNotIn("the username on its own", rows(["user"]))

    def test_harmless_controls_leak_only_when_the_username_is_an_ordinary_word(self):
        ctl = lambda user: [a["leaks"] for a in S.try_attacks(S.BASE, user)["rows"] if a["note"].startswith("harmless")]
        self.assertEqual(ctl("sam"), [[], []])
        self.assertEqual(ctl("dev")[1], ["the username"])


if __name__ == "__main__":
    unittest.main()
