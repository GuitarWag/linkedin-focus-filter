// Headless entry point: stands up a DOM with jsdom, runs the checks, exits
// non-zero on failure so `npm test` is usable in a hook or CI.
import { JSDOM } from "jsdom";
import { runChecks, summarise } from "./checks.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;

// jsdom has no layout engine, so getBoundingClientRect returns zeros. Probe
// for it rather than assuming, and let the suite skip those assertions —
// test/checks.html covers them in a real browser.
function probeLayout() {
  const el = document.createElement("div");
  el.style.height = "40px";
  el.textContent = "probe";
  document.body.appendChild(el);
  const height = el.getBoundingClientRect().height;
  el.remove();
  return height > 0;
}

const layoutAvailable = probeLayout();

runChecks({ layoutAvailable }).then((results) => {
  const { text, failedCount } = summarise(results);
  console.log(text);
  if (!layoutAvailable) {
    console.log(
      "\nnote: layout assertions skipped under jsdom — run test/checks.html in a browser for those."
    );
  }
  process.exit(failedCount > 0 ? 1 : 0);
});
