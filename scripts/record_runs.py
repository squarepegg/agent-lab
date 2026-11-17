#!/usr/bin/env python3
"""Record real model runs for the sample skills. This is the ONLY script in the repo that calls a model; the site never does.

  python3 scripts/record_runs.py --models PROVIDER/ID [PROVIDER/ID ...] [--skills dst doubt ...] [--variant dst=filler] [--samples 3]

For every (skill, model) it runs the vendored, byte-identical `vendor/skill_ab.py` (the upstream live A/B: each probe is answered in a
fresh `pi --mode rpc --no-session --no-context-files --no-skills` session in an empty directory; the `with` arm adds `--skill`),
writes its results file to recorded/<skill>--<model>.json and records the hash, model, date and prompt in recorded/RUNS.json.
`--variant SKILL=NAME` also runs SKILL's probes with sample/variants/NAME loaded in the `with` arm instead (skill_ab's `--with-path`):
a skill that should not help. `scripts/check_recorded.py` (CI) fails if a recorded file is edited afterwards.
Costs tokens; needs `pi` with a logged-in provider.

Isolation: the agent has a shell, so each run gets an empty HOME (it cannot find the skills or anything else on the recording
machine) and, for Bedrock, short-lived credentials passed through the environment. The agent can still name absolute paths (pi tells
it where its own docs are installed), so machine paths in the results are replaced by <root>, <home>, <cwd>, <machine-home>, <tmp>.
Nothing else in a results file is changed.
"""
import argparse, concurrent.futures, datetime, hashlib, json, os, re, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "recorded")
# No extensions and no MCP: nothing from the recording machine's own setup reaches the model.
PI_EXTRA = ["--no-extensions", "--no-mcp"]
PROMPT = ("Each probe's `q` (sample/skills/<skill>/evals/probes.json) is sent as the only user message of a fresh "
          "`pi --mode rpc --no-session --no-context-files --no-skills --no-extensions --no-mcp --model <model>` session in an empty "
          "directory with an empty HOME. The `with` arm adds `--skill skills/<skill>`; nothing else differs. "
          "Grading is `skill_ab.missing`: no model grades.")


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def slug(model):
    return re.sub(r"[^a-z0-9.]+", "-", model.split("/")[-1].lower()).strip("-")


def aws_env():
    """Short-lived AWS credentials as env vars, so runs work with an empty HOME. {} when there is no AWS login (other providers)."""
    r = subprocess.run(["aws", "configure", "export-credentials", "--format", "env-no-export"], capture_output=True, text=True)
    if r.returncode:
        return {}
    env = dict(l.split("=", 1) for l in r.stdout.splitlines() if "=" in l)
    region = subprocess.run(["aws", "configure", "get", "region"], capture_output=True, text=True).stdout.strip()
    return {**env, **({"AWS_REGION": region} if region else {})}


def scrub(text, d, home):
    tmp = os.path.realpath(tempfile.gettempdir())
    bare = tmp.replace("/private", "", 1)
    text = text.replace(d, "<root>").replace(home, "<home>")
    text = re.sub(r"(?:/private)?" + re.escape(bare) + r"/skill-ab-\w+", "<cwd>", text)   # each answer's empty working directory
    places = [(os.path.expanduser("~"), "<machine-home>"), (tmp, "<tmp>"), (bare, "<tmp>")]
    if "/var/folders/" in tmp:   # macOS: the per-user directory above the temp dir is as identifying as the temp dir
        places += [(os.path.dirname(tmp), "<tmp-parent>"), (os.path.dirname(bare), "<tmp-parent>")]
    for real, name in places:
        text = text.replace(real, name)
    return text


def record(skill, model, samples, creds, variant=None):
    """Run vendor/skill_ab.py in a throwaway tree shaped like the upstream repo (it resolves skills/ relative to itself)."""
    with tempfile.TemporaryDirectory(prefix="lab-rec-") as d, tempfile.TemporaryDirectory(prefix="lab-home-") as home:
        d, home = os.path.realpath(d), os.path.realpath(home)
        os.makedirs(os.path.join(d, "scripts"))
        shutil.copyfile(os.path.join(ROOT, "vendor", "skill_ab.py"), os.path.join(d, "scripts", "skill_ab.py"))
        shutil.copytree(os.path.join(ROOT, "sample", "skills", skill), os.path.join(d, "skills", skill))
        extra = []
        if variant:
            shutil.copytree(os.path.join(ROOT, "sample", "variants", variant), os.path.join(d, "variants", variant))
            extra = ["--with-path", os.path.join(d, "variants", variant)]
        raw = os.path.join(d, "out.json")
        env = {**os.environ, **creds, "HOME": home, "EVAL_PI_ARGS": json.dumps(["--model", model, *PI_EXTRA])}
        for k in ("EVAL_PI", *(("AWS_PROFILE",) if creds else ())):
            env.pop(k, None)
        r = subprocess.run([sys.executable, os.path.join(d, "scripts", "skill_ab.py"), skill, "--samples", str(samples), "--out", raw, *extra],
                           env=env, capture_output=True, text=True)
        if r.returncode not in (0, 1) or not os.path.exists(raw):
            raise RuntimeError(f"{skill} on {model}: skill_ab failed\n{r.stdout[-2000:]}\n{r.stderr[-2000:]}")
        text = scrub(open(raw, encoding="utf-8").read(), d, home)
    res = json.loads(text)
    if not any(x["answer"] for x in res["rows"]):
        raise RuntimeError(f"{skill} on {model}: every answer is empty (is the provider logged in?)")
    name = f"{skill}{'+' + variant if variant else ''}--{slug(model)}.json"
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(text)
    return name, {"skill": skill, "variant": variant, "model": model, "date": res["date"], "samples": samples, "answers": len(res["rows"]),
                  "cost_usd": res["cost_usd"], "sha256": sha(os.path.join(OUT, name))}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models", nargs="+", required=True)
    ap.add_argument("--skills", nargs="+", default=sorted(os.listdir(os.path.join(ROOT, "sample", "skills"))))
    ap.add_argument("--variant", action="append", default=[], metavar="SKILL=NAME")
    ap.add_argument("--samples", type=int, default=3)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    meta_path = os.path.join(OUT, "RUNS.json")
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {"files": {}}
    pi = subprocess.run(["pi", "--version"], capture_output=True, text=True).stdout.strip()
    creds = aws_env() if any(m.startswith("amazon-bedrock/") for m in a.models) else {}
    failed = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
        todo = [(s, None) for s in a.skills] + [tuple(v.split("=", 1)) for v in a.variant]
        jobs = {ex.submit(record, s, m, a.samples, creds, v): (s, v, m) for s, v in todo for m in a.models}
        for j in concurrent.futures.as_completed(jobs):
            try:
                name, row = j.result()
                meta["files"][name] = row
                print(f"recorded {name}: {row['answers']} answers, ${row['cost_usd']}", flush=True)
            except Exception as e:
                failed.append(str(e))
                print(f"FAILED {jobs[j]}: {e}", flush=True)
    meta.update({"runner": "vendor/skill_ab.py", "runner_sha256": sha(os.path.join(ROOT, "vendor", "skill_ab.py")), "harness": f"pi {pi}",
                 "pi_args": PI_EXTRA, "prompt": PROMPT, "recorded_at": datetime.date.today().isoformat()})
    json.dump(meta, open(meta_path, "w"), indent=1, sort_keys=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
