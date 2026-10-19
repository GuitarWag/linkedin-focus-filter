const ext = typeof browser !== "undefined" ? browser : chrome;

// The model runs in an offscreen document (offscreen.js), not here or in the
// content script: Chrome applies linkedin.com's CSP to WebAssembly in content
// scripts, and service workers forbid the dynamic import() ONNX Runtime uses.
// The service worker only makes sure that document exists; the content script
// then messages it directly. One document serves every LinkedIn tab.
let creating = null;
async function ensureOffscreen() {
  if (await ext.offscreen.hasDocument()) return;
  creating ??= ext.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Runs the on-device post classifier with WebGPU.",
    })
    .finally(() => (creating = null));
  await creating;
}

ext.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.lifEnsureModel) {
    ensureOffscreen()
      .then(() => ext.runtime.sendMessage({ lifLoad: true }))
      .then(reply, (err) => reply({ error: String(err?.message || err) }));
    return true;
  }

  // Debug builds only (see build.js): forward the content script's buffered
  // events to the local collector. The service worker sends them because a
  // fetch to localhost from the linkedin.com page hits its CORS and Chrome's
  // local-network checks; the extension's host permission skips both.
  if (__LIF_TELEMETRY__ && msg?.lifTelemetry) {
    fetch(__LIF_TELEMETRY__, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ t: Date.now(), tab: sender.tab?.url, ...msg.lifTelemetry }),
    }).catch(() => {}); // collector not running is fine
  }
});
