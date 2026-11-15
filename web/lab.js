// Boots Pyodide with the real vendored Python and returns call(name, args) -> object. Used by the page and by tests_js/smoke.mjs.
export async function bootLab(loadPyodide, bundle, opts = {}) {
  const py = await loadPyodide(opts);
  await py.loadPackage("pyyaml");
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
    call(name, args) {
      const out = JSON.parse(api.call(name, JSON.stringify(args)));
      return out;
    },
    py,
  };
}
