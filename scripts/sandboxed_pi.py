#!/usr/bin/env python3
"""`pi`, but unable to read or write anything it was not given. scripts/record_runs.py sets EVAL_PI to this file (macOS only: sandbox-exec).

Why: an empty HOME is not isolation. The agent has a shell, so it can `find /` and read the recording machine's other repos, the
other concurrent runs' throwaway trees (which hold the very skill under test) and its harness's installed packages (whose folder
names can identify an employer). A first re-recording showed all three: a content-free skill was adopted because models searched the
disk for the real one. So each answer's pi process runs under a macOS sandbox profile that denies file reads and writes under
/Users, /private/var/folders, /private/tmp, /Volumes, /Library and /Applications (other software on the machine, which can name an employer) and the parts of /opt/homebrew that hold other tools; the rest of /opt/homebrew stays readable because pi needs node there, except:
  - the answer's own working folder, the run's empty HOME and a TMPDIR inside it
  - the skill folder named by --skill (the `with` arm only: the without arm must not be able to read it)
  - pi's own binary and installed docs (<real home>/.pi/agent/bin and .../install), which pi needs to run
Anything denied fails like a missing file; the tool call is still recorded, which is what the Guardrails lesson shows.
Environment: SANDBOX_PI_REAL (the real pi), SANDBOX_REAL_HOME (the recording machine's home). Reads argv like pi."""
import os, subprocess, sys

DENY = ["/Users", "/private/var/folders", "/private/tmp", "/Volumes", "/Library", "/Applications",
        "/opt/homebrew/Caskroom", "/opt/homebrew/lib/node_modules", "/opt/homebrew/Library", "/opt/homebrew/var"]


def q(p):
    return '"' + p.replace("\\", "\\\\").replace('"', '\\"') + '"'


def profile(cwd, home, tmp, skill, real_home):
    allow = [cwd, home, tmp, os.path.join(real_home, ".pi/agent/bin"), os.path.join(real_home, ".pi/agent/install")] + ([skill] if skill else [])
    deny = " ".join(f"(subpath {q(p)})" for p in DENY)
    ok = " ".join(f"(subpath {q(p)})" for p in allow)
    # Node resolves a path by lstat-ing every parent directory, so each parent of an allowed folder may be stat-ed (not listed or read).
    parents = sorted({q for a in allow for q in _parents(a)})
    meta = " ".join(f"(literal {q(p)})" for p in parents)
    # Later rules win in a sandbox profile: deny the wide areas first, then re-allow the few folders the run needs.
    return f"(version 1)\n(allow default)\n(deny file-read* file-write* {deny})\n(allow file-read* file-write* {ok})\n(allow file-read-metadata {meta})\n"


def _parents(p):
    out = []
    while p not in ("/", ""):
        p = os.path.dirname(p)
        out.append(p)
    return out


def main(argv):
    real = os.path.realpath(os.environ["SANDBOX_PI_REAL"])   # the /opt/homebrew/bin symlink is itself denied
    real_home = os.path.realpath(os.environ["SANDBOX_REAL_HOME"])
    cwd, home = os.path.realpath(os.getcwd()), os.path.realpath(os.environ["HOME"])
    tmp = os.path.join(home, "tmp")
    os.makedirs(tmp, exist_ok=True)
    skill = os.path.realpath(argv[argv.index("--skill") + 1]) if "--skill" in argv else None
    env = {**os.environ, "TMPDIR": tmp}
    return subprocess.call(["/usr/bin/sandbox-exec", "-p", profile(cwd, home, tmp, skill, real_home), real, *argv], env=env)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
