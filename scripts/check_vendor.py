#!/usr/bin/env python3
"""Fail if a vendored file was edited (hash != vendor/VENDOR.json). With --upstream OWNER/map-repo OWNER/toolkit-repo, also fail if
upstream's current file differs (drift). Offline by default so it can gate every push."""
import base64, hashlib, json, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
meta = json.load(open(os.path.join(ROOT, "vendor", "VENDOR.json")))
bad = []
for name, f in meta["files"].items():
    h = hashlib.sha256(open(os.path.join(ROOT, "vendor", name), "rb").read()).hexdigest()
    if h != f["sha256"]:
        bad.append(f"{name}: edited locally (vendored files must stay byte-identical to upstream; change upstream and re-run scripts/vendor.py)")
if "--upstream" in sys.argv:
    i = sys.argv.index("--upstream")
    repos = {"map": sys.argv[i + 1], "toolkit": sys.argv[i + 2]}
    for name, f in meta["files"].items():
        r = subprocess.run(["gh", "api", f"repos/{repos[f['repo']]}/contents/{f['path']}", "--jq", ".content"], capture_output=True, text=True)
        if r.returncode:
            bad.append(f"{name}: not found upstream ({repos[f['repo']]}/{f['path']})")
            continue
        up = base64.b64decode(r.stdout)
        if hashlib.sha256(up).hexdigest() != f["sha256"]:
            bad.append(f"{name}: upstream changed since vendoring (re-run scripts/vendor.py and the tests)")
print("\n".join(bad) or f"vendor ok ({len(meta['files'])} files)")
sys.exit(1 if bad else 0)
