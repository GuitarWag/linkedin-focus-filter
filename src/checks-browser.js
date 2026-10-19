// Browser entry point: same checks, but in a real engine so the layout
// assertions actually run.
import { runChecks, summarise } from "./checks.js";

runChecks({ layoutAvailable: true }).then((results) => {
  const { text, failedCount } = summarise(results);
  window.__RESULTS__ = { results, failedCount };
  document.getElementById("results").textContent = text;
});
