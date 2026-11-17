// The Python side of the lab. Three users:
//   bootLab      boots Pyodide with the real vendored Python (the worker, and tests_js/smoke.mjs under Node)
//   connectLab   the page's async client for that worker; answers from `recorded` while Python is still loading
//   callKey      the key a call is recorded under (web/recorded.json, written by tests_js/record.mjs)
export const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";

export async function bootLab(loadPyodide, bundle, opts = {}, onStage = () => {}) {
  const py = await loadPyodide(opts);
  onStage("yaml");
  await py.loadPackage("pyyaml");
  onStage("code");
  for (const [path, text] of Object.entries(bundle.py)) {
    const dir = "/app/" + path.split("/").slice(0, -1).join("/");
    py.FS.mkdirTree(dir);
    py.FS.writeFile("/app/" + path, text);
  }
  py.runPython(`
import sys
sys.path[:0] = ["/app/vendor", "/app/lab"]
import api
`);
  const api = py.pyimport("api");
  return {
    callJson: (name, args) => api.call(name, JSON.stringify(args)),
    call(name, args) { return JSON.parse(api.call(name, JSON.stringify(args))); },
    py,
  };
}

// cyrb53: a fast 53-bit string hash. Keys only need to tell a few hundred recorded calls apart.
function hash(s) {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
}
export const callKey = (name, args) => `${name}:${hash(JSON.stringify(args))}`;

/** port = { worker, log: [messages so far], on } (set up by the inline script in index.html so Python starts before this file loads).
 *  recorded = { calls: { key: result } }. Returns the client; `onState` fires on every progress / ready / error message. */
export function connectLab(port, recorded, { record = false, onState = () => {} } = {}) {
  const pending = new Map(), calls = recorded?.calls || {};
  const lab = { ready: false, failed: null, pct: 0, label: "starting", recordedHits: 0, waiting: 0, rec: record ? {} : null };
  let seq = 0, whenReady;
  lab.whenReady = new Promise((ok) => (whenReady = ok));
  const onMsg = (m) => {
    if (m.type === "progress") { lab.pct = m.pct; lab.label = m.label; }
    else if (m.type === "ready") { lab.ready = true; lab.pct = 1; lab.label = "ready"; whenReady(); }
    else if (m.type === "error") { lab.failed = m.message; for (const [, no] of pending.values()) no(new Error(failText(lab))); pending.clear(); }
    else if (m.type === "result") { const p = pending.get(m.id); if (p) { pending.delete(m.id); lab.waiting = pending.size; p[0](m.out); } return; }
    if (live) onState(lab);
  };
  let live = false;   // the messages that arrived before this client existed only set the state
  port.on = onMsg;
  for (const m of port.log) onMsg(m);
  live = true;
  /** recorded result for this call, or undefined. Never waits. */
  lab.peek = (name, args) => (lab.ready || record ? undefined : calls[callKey(name, args)]);
  /** -> parsed result. Before Python is ready a recorded result is used when there is one; otherwise this waits for Python. */
  lab.call = async (name, args) => {
    const key = !lab.ready || record ? callKey(name, args) : null;
    if (!lab.ready && !record && calls[key] !== undefined) { lab.recordedHits++; return structuredClone(calls[key]); }
    if (lab.failed || !port.worker) throw new Error(failText(lab));
    const out = JSON.parse(await new Promise((ok, no) => {
      const id = ++seq; pending.set(id, [ok, no]); lab.waiting = pending.size; if (!lab.ready) onState(lab);
      port.worker.postMessage({ id, name, args });
    }));
    if (record) lab.rec[key ?? callKey(name, args)] = out;
    return out;
  };
  return lab;
}
const failText = (lab) => `Python could not load (${lab.failed || "no worker"}). Recorded steps still work; reload to try again.`;
