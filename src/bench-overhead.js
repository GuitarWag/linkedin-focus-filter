// How much of a classification is fixed per-call overhead versus per-token
// work? That decides whether batching several posts into one prompt is worth
// anything: only the fixed part can be amortised.
import { CreateMLCEngine } from "@mlc-ai/web-llm";
import { MODEL_ID, INTERESTS, POSTS } from "./bench-corpus.js";

const SIZES = [0, 100, 200, 400, 800];
const REPS = 6;
const SYSTEM = `Topics: ${INTERESTS}. Is this post mainly about one of those topics? Answer in English, YES or NO.`;

// One long body to slice, so content is comparable across sizes.
const BODY = POSTS.find((p) => p.label === "postgres-deep-dive").text.repeat(3);

function log(msg) {
  const el = document.getElementById("log");
  el.textContent += msg + "\n";
  el.scrollTop = el.scrollHeight;
}

let engine = null;

async function loadEngine() {
  const modelBase = new URL(`models/${MODEL_ID}/`, location.href).href;
  log(`loading ${MODEL_ID}…`);
  engine = await CreateMLCEngine(MODEL_ID, {
    appConfig: {
      cacheBackend: "indexeddb",
      model_list: [
        {
          model: modelBase,
          model_id: MODEL_ID,
          model_lib: new URL(`models/${MODEL_ID}/model.wasm`, location.href).href,
          vram_required_MB: 879.04,
          low_resource_required: true,
          overrides: { context_window_size: 4096 },
        },
      ],
    },
    initProgressCallback: (p) => {
      document.getElementById("progress").textContent = p.text;
    },
  });
  log("engine ready\n");
}

async function timeCall(userContent, maxTokens = 8) {
  const started = performance.now();
  await engine.chat.completions.create({
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: userContent },
    ],
    max_tokens: maxTokens,
    temperature: 0,
  });
  return performance.now() - started;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function run() {
  document.getElementById("run").disabled = true;
  try {
    if (!engine) await loadEngine();
    log("warmup…");
    await timeCall(BODY.slice(0, 400));

    const rows = [];
    for (const size of SIZES) {
      const content = size === 0 ? "." : BODY.slice(0, size);
      const times = [];
      for (let i = 0; i < REPS; i++) times.push(await timeCall(content));
      const med = median(times);
      rows.push({ size, med });
      log(`${String(size).padStart(4)} chars -> median ${med.toFixed(0)}ms  (${times.map((t) => t.toFixed(0)).join(", ")})`);
    }

    // Least-squares fit over chars -> ms. Intercept is the fixed cost a batch
    // would amortise; slope is per-char work a batch still has to pay.
    const n = rows.length;
    const sx = rows.reduce((a, r) => a + r.size, 0);
    const sy = rows.reduce((a, r) => a + r.med, 0);
    const sxy = rows.reduce((a, r) => a + r.size * r.med, 0);
    const sxx = rows.reduce((a, r) => a + r.size * r.size, 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;

    log(`\nfixed overhead ≈ ${intercept.toFixed(0)}ms per call`);
    log(`per-char cost  ≈ ${(slope * 1000).toFixed(1)}ms per 1000 chars`);

    const at800 = intercept + slope * 800;
    log(`\nmodelled cost of an 800-char post: ${at800.toFixed(0)}ms`);
    log(`  of which fixed: ${((intercept / at800) * 100).toFixed(0)}%`);

    // What batching 5 posts of 800 chars could save, ignoring accuracy risk.
    const serial = 5 * at800;
    const batched = intercept + slope * 5 * 800;
    log(`\n5 posts serial:  ${serial.toFixed(0)}ms`);
    log(`5 posts batched: ${batched.toFixed(0)}ms (one call, same total text)`);
    log(`potential saving: ${(((serial - batched) / serial) * 100).toFixed(0)}%`);

    window.__OVERHEAD__ = { rows, slope, intercept };
    log("\ndone");
  } catch (err) {
    log(`ERROR: ${err.stack || err.message || err}`);
  } finally {
    document.getElementById("run").disabled = false;
  }
}

document.getElementById("run").addEventListener("click", run);
