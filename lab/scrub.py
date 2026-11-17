"""The output scrubber, and a way to test it. Written for this lab (NOT upstream).

`scrub` is what scripts/record_runs.py runs on every saved results file: the agent can name absolute paths on the recording machine
(its harness tells it where its own docs are installed), so those paths are replaced by placeholders before anything is saved.
It replaces exactly the strings it is told about. The rest of this file lets the lab show what that does and does not cover, on a
MADE-UP machine (the real raw output is never saved, and the real home path never appears in this repository):
  - `machine(user)`: the made-up machine. `raw_text` rebuilds what a recorded text looked like on it before scrubbing.
  - `scrub_with`: the same replacements as separate switches, plus three that handle sloppier spellings of the same path.
  - `leaks`: the reference check: does this text still identify the machine?  `detect` is the generic version used by
    scripts/check_recorded.py: it knows nothing about any machine and looks for the shape of a home or temp path."""
import os, re, urllib.parse

PLACEHOLDER = re.compile(r"<[a-z-]+>")


def machine(user="sam"):
    return {"user": user, "home": f"/Users/{user}", "root": "/private/lab-rec-q7x2", "run_home": "/private/lab-home-w4p8",
            "tmp": "/var/folders/k3/x9y2z7/T", "tmp_parent": "/var/folders/k3/x9y2z7", "cwd": "/var/folders/k3/x9y2z7/T/skill-ab-ab12cd", "host": "mbp-7"}


def raw_text(text, m):
    """A recorded text as it would have looked before scrubbing, on the made-up machine."""
    for ph, real in (("<root>", m["root"]), ("<cwd>", m["cwd"]), ("<home>", m["run_home"]), ("<machine-home>", m["home"]),
                     ("<tmp-parent>", m["tmp_parent"]), ("<tmp>", m["tmp"])):
        text = text.replace(ph, real)
    return text


def scrub(text, root, run_home, machine_home, tmp, tmp_parent=None):
    """The scrubber record_runs.py uses. root: the throwaway tree the run lived in; run_home: the empty HOME it was given;
    machine_home: the recording machine's real home; tmp: its temp directory; tmp_parent: the directory above it when that is as
    identifying as the temp dir itself (macOS /var/folders/xx/yyyy)."""
    bare = tmp.replace("/private", "", 1)
    text = text.replace(root, "<root>").replace(run_home, "<home>")
    text = re.sub(r"(?:/private)?" + re.escape(bare) + r"/skill-ab-\w+", "<cwd>", text)   # each answer's empty working directory
    places = [(machine_home, "<machine-home>"), (tmp, "<tmp>"), (bare, "<tmp>")]
    if tmp_parent:
        places += [(tmp_parent, "<tmp-parent>"), (tmp_parent.replace("/private", "", 1), "<tmp-parent>")]
    for real, name in places:
        text = text.replace(real, name)
    return text


BASE = ["root", "run_home", "cwd", "machine_home", "tmp", "tmp_parent"]
EXTRA = ["nocase", "slashes", "user"]
LABELS = {
    "root": "Replace the working-copy path", "run_home": "Replace the empty HOME the run was given", "cwd": "Replace each answer's working folder",
    "machine_home": "Replace the machine's home folder", "tmp": "Replace the temp folder", "tmp_parent": "Replace the folder above the temp folder",
    "nocase": "Match paths in any letter case", "slashes": "Treat `//` and `%2F` like `/`", "user": "Replace the username wherever it appears as a word",
}


def _path_re(p, opts):
    parts = [("(?:/|%2[Ff])+" if c == "/" else re.escape(c)) if "slashes" in opts else re.escape(c) for c in p]
    return re.compile("".join(parts), re.I if "nocase" in opts else 0)


def scrub_with(text, m, opts):
    """The scrubber as switches. The order is the real one: root, run HOME, working folder, then home, temp, temp parent."""
    sub = lambda pat, name, t: _path_re(pat, opts).sub(name, t)
    if "root" in opts:
        text = sub(m["root"], "<root>", text)
    if "run_home" in opts:
        text = sub(m["run_home"], "<home>", text)
    if "cwd" in opts:
        text = re.compile(_path_re(m["tmp"], opts).pattern + r"(?:/|%2[Ff])*skill-ab-\w+", re.I if "nocase" in opts else 0).sub("<cwd>", text)
    for key, name in (("machine_home", "<machine-home>"), ("tmp", "<tmp>"), ("tmp_parent", "<tmp-parent>")):
        if key in opts:
            text = sub(m[{"machine_home": "home"}.get(key, key)], name, text)
    if "user" in opts:
        text = re.sub(rf"\b{re.escape(m['user'])}\b", "<user>", text, flags=re.I)
    return text


def leaks(text, m):
    """The reference check: reasons this text still identifies the made-up machine ([] when it does not). The username counts
    wherever it appears as a word; whether hiding it is worth the cost is for the scrubber's author to decide."""
    norm = re.sub(r"/+", "/", urllib.parse.unquote(text)).lower()
    out = []
    for key, why in (("home", "the home folder path"), ("root", "the working-copy path"), ("run_home", "the run's HOME path"), ("tmp_parent", "the temp folder path")):
        if re.sub(r"/+", "/", m[key]).lower() in norm:
            out.append(why)
    if re.search(rf"\b{re.escape(m['user'].lower())}\b", norm):
        out.append("the username")
    if m["host"] in norm:
        out.append("the machine name")
    return out


GENERIC = [re.compile(p) for p in (r"/Users/[^/\s]+", r"/home/[^/\s]+", r"[A-Za-z]:\\Users\\", r"/var/folders/\w\w/\w+", r"/tmp/(?:skill-ab|lab-rec|lab-home)-\w+")]


def detect(text):
    """Shapes of a home or temp path, with no knowledge of any machine. -> list of matches."""
    return [x.group(0) for p in GENERIC for x in p.finditer(text)]


def run(texts, opts, user="sam"):
    """The scrubber `opts` on every recorded text, rebuilt on the made-up machine. texts = [{"text": ..., "kind": ...}].
    -> {rows: [{status}], counts}. status: leak (still identifies the machine), fixed (did, no longer does), damaged (no path in it
    at all, but a word was replaced), fine (nothing to do)."""
    m, opts = machine(user), set(opts)
    rows, k = [], dict(total=len(texts), leaks=0, fixed=0, damaged=0, fine=0, dirty=0)
    for t in texts:
        raw = raw_text(t["text"], m)
        out = scrub_with(raw, m, opts)
        dirty = leaks(raw, m)
        k["dirty"] += bool(dirty)
        if leaks(out, m):
            st = "leak"
        elif "user" in opts and not any(w != "the username" for w in dirty) and re.search(rf"\b{re.escape(user)}\b", raw, re.I):
            st = "damaged"
        elif dirty:
            st = "fixed"
        else:
            st = "fine"
        rows.append({"status": st, "kind": t.get("kind", "")})
        k[{"leak": "leaks"}.get(st, st)] += 1
    return {"rows": rows, "counts": k}


def one(text, opts, user="sam", rebuild=False):
    """One text, as the model might have written it on the made-up machine. rebuild: `text` is a recorded (already scrubbed) text, so
    first put the made-up machine's paths back."""
    m = machine(user)
    raw = raw_text(text, m) if rebuild else text
    out = scrub_with(raw, m, set(opts))
    return {"raw": raw, "out": out, "leaks": leaks(out, m), "raw_leaks": leaks(raw, m)}


def attacks(user="sam"):
    """Ways the made-up machine can show up that an exact-string scrubber does not expect. The last two are harmless controls."""
    m = machine(user)
    h = m["home"]
    return [
        (f"Config is at {h}/.ssh/config", "the home path, written out in full"),
        (f"opened {h.upper()}/notes.txt", "the same path in capital letters"),
        (f"ls {h.replace('/', '//')}/notes", "the same path with doubled slashes"),
        (f"fetched file%3A%2F%2F{urllib.parse.quote(h, safe='')}%2Fnotes", "the same path, URL-encoded"),
        (f"whoami printed {user}", "the username on its own"),
        (f"{h}/../{user}/x", "a path that goes up and back down"),
        (f"cwd was {m['cwd']}/skills", "the working folder"),
        ("see skills/dst/SKILL.md", "harmless: a relative path"),
        ("the CI job passed on the dev branch", "harmless: ordinary words, which are the username for some people"),
    ]


def try_attacks(opts, user="sam"):
    m = machine(user)
    rows = []
    for text, note in attacks(user):
        r = one(text, opts, user)
        rows.append({"text": text, "note": note, **r})
    return {"rows": rows}
