// Bundles the check suite and the browser benchmarks:
//   .test-build/checks.cjs  -> headless, run by `npm test`
//   test/*.js               -> pages under test/, served by `npm run eval`
const esbuild = require("esbuild");

esbuild.buildSync({
  entryPoints: ["src/checks-node.js"],
  bundle: true,
  format: "cjs",
  platform: "node",
  outfile: ".test-build/checks.cjs",
  external: ["jsdom"],
});

const browser = { bundle: true, format: "iife", target: "chrome120" };
for (const name of ["checks-browser:checks", "bench", "bench-prompts", "bench-overhead", "test-engine", "worker"]) {
  const [src, out = src] = name.split(":");
  esbuild.buildSync({ ...browser, entryPoints: [`src/${src}.js`], outfile: `test/${out}.js` });
}

// transformers.js uses top-level await, so the eval page loads as a module.
esbuild.buildSync({ ...browser, format: "esm", entryPoints: ["src/eval.js"], outfile: "test/eval.js" });
