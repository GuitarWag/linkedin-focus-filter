// Hosts the decision model. An offscreen document is a normal extension page:
// WebGPU, WebAssembly (with 'wasm-unsafe-eval') and dynamic import() all work
// here, while a service worker forbids import() and ONNX Runtime needs it.
// Offscreen documents only get chrome.runtime, so status goes back through
// message replies.
import { env } from "@huggingface/transformers";
import { OpenJev } from "open-jev";
import { MODEL_REPO } from "./decision.js";

// Everything ships in the extension: no network at runtime.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL("models/");
env.useBrowserCache = false;
// Import the runtime from our own origin; the default blob: URL is blocked by
// the extension CSP.
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = {
  mjs: chrome.runtime.getURL("ort/ort-wasm-simd-threaded.asyncify.mjs"),
  wasm: chrome.runtime.getURL("ort/ort-wasm-simd-threaded.asyncify.wasm"),
};

let jev = null;
let loading = null;

function load() {
  if (jev) return Promise.resolve(jev);
  // ponytail: only q4f16 is bundled, which needs WebGPU shader-f16 (every Apple
  // Silicon Mac has it). Bundle model_q4 too if it must run elsewhere.
  loading ??= OpenJev.load({ model: MODEL_REPO, dtype: "q4f16", device: "webgpu" }).then(
    (j) => (jev = j),
    (err) => {
      loading = null; // let the next request retry
      throw err;
    }
  );
  return loading;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.lifLoad) {
    const t0 = performance.now();
    load().then(
      (j) => reply({ ok: true, runtime: j.runtime, loadMs: Math.round(performance.now() - t0) }),
      (err) => reply({ error: String(err?.message || err) })
    );
    return true;
  }
  if (msg?.lifDecide) {
    const { text, questions } = msg.lifDecide;
    load()
      .then((j) => j.decide(text, questions))
      .then(
        (answers) => reply({ answers: answers.map((a) => ({ choice: a.choice, confidence: a.confidence })) }),
        (err) => reply({ error: String(err?.message || err) })
      );
    return true;
  }
});
