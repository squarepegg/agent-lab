// Module worker: loads Pyodide and the real vendored Python off the main thread, reports progress, then answers calls.
// Started by the inline script at the top of index.html, before the app's own JavaScript.
import { bootLab, PYODIDE } from "./lab.js";

const post = (m) => self.postMessage(m);
// Decoded sizes of the two big downloads (Pyodide 0.27.7), used only to scale the progress bar.
const BIG = [["pyodide.asm.wasm", 10_105_545], ["python_stdlib.zip", 2_360_737]];
const TOTAL = BIG.reduce((s, [, n]) => s + n, 0);

// Stream the big files once so there are real bytes to report. Pyodide's own requests for them are then served by the HTTP cache
// (jsDelivr marks them immutable) or by the service worker.
async function download() {
  const got = BIG.map(() => 0);
  let last = 0;
  await Promise.all(BIG.map(async ([file, size], i) => {
    try {
      const r = await fetch(PYODIDE + file);
      const rd = r.body.getReader();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        got[i] = Math.min(size, got[i] + value.length);
        const pct = 0.7 * (got.reduce((a, b) => a + b, 0) / TOTAL);
        if (pct - last > 0.01) { last = pct; post({ type: "progress", pct, label: "downloading Python" }); }
      }
    } catch { /* progress only: loadPyodide below reports the real failure */ }
  }));
}

const ready = (async () => {
  post({ type: "progress", pct: 0.01, label: "downloading Python" });
  const [bundle, mod] = await Promise.all([fetch("bundle.json").then((r) => r.json()), import(PYODIDE + "pyodide.mjs"), download()]);
  post({ type: "progress", pct: 0.72, label: "starting Python" });
  const lab = await bootLab(mod.loadPyodide, bundle, { indexURL: PYODIDE }, (stage) =>
    post({ type: "progress", pct: stage === "yaml" ? 0.86 : 0.93, label: stage === "yaml" ? "loading the YAML package" : "loading the real upstream code" }));
  post({ type: "ready" });
  return lab;
})();
ready.catch((e) => post({ type: "error", message: e?.message || String(e) }));

self.onmessage = async (e) => {
  const { id, name, args } = e.data;
  let lab;
  try { lab = await ready; } catch { return; }   // the page was told by the error message above
  post({ type: "result", id, out: lab.callJson(name, args) });
};
