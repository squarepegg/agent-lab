"""scripts/sandboxed_pi.py: the profile pi runs under while recording. macOS only (sandbox-exec). Behaviour, not wording: what a shell can and cannot read."""
import os, subprocess, sys, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import sandboxed_pi as W


@unittest.skipUnless(sys.platform == "darwin" and os.path.exists("/usr/bin/sandbox-exec"), "needs macOS sandbox-exec")
class Confinement(unittest.TestCase):
    def setUp(self):
        real = os.path.realpath
        self.cwd, self.home = real(tempfile.mkdtemp(prefix="skill-ab-")), real(tempfile.mkdtemp(prefix="lab-home-"))
        self.skill, self.other = real(tempfile.mkdtemp(prefix="lab-rec-")), real(tempfile.mkdtemp(prefix="lab-rec-"))
        for d in (self.skill, self.other):
            open(os.path.join(d, "SKILL.md"), "w").write("skill text")
        os.makedirs(os.path.join(self.home, "tmp"))

    def sh(self, cmd, skill=True):
        prof = W.profile(self.cwd, self.home, os.path.join(self.home, "tmp"), self.skill if skill else None, os.path.expanduser("~"))
        r = subprocess.run(["/usr/bin/sandbox-exec", "-p", prof, "/bin/sh", "-c", cmd], cwd=self.cwd, capture_output=True, text=True)
        return r.returncode, r.stdout

    def test_it_reads_and_writes_its_own_folder(self):
        self.assertEqual(self.sh("echo hi > x.txt && cat x.txt"), (0, "hi\n"))

    def test_with_arm_reads_the_skill_without_arm_cannot(self):
        self.assertEqual(self.sh(f"cat {self.skill}/SKILL.md"), (0, "skill text"))
        self.assertNotEqual(self.sh(f"cat {self.skill}/SKILL.md", skill=False)[0], 0)

    def test_another_runs_tree_and_the_home_folder_are_unreadable(self):
        self.assertNotEqual(self.sh(f"cat {self.other}/SKILL.md")[0], 0)
        self.assertEqual(self.sh(f"ls {os.path.expanduser('~')} 2>/dev/null")[1], "")
        self.assertEqual(self.sh("find /Users /Library /Applications /private/var/folders -name SKILL.md 2>/dev/null")[1], "", "a search cannot even find the skill: it is readable only by the exact path pi was given")

    def test_nothing_outside_its_folder_can_be_written(self):
        self.assertNotEqual(self.sh(f"echo x > {os.path.expanduser('~')}/lab-sandbox-test.txt")[0], 0)
        self.assertFalse(os.path.exists(os.path.join(os.path.expanduser("~"), "lab-sandbox-test.txt")))


if __name__ == "__main__":
    unittest.main()
