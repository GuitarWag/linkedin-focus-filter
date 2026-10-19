import { CreateWebWorkerMLCEngine } from "@mlc-ai/web-llm";

const MODEL_ID = "SmolLM2-360M-Instruct-q4f16_1-MLC";

let engine = null;

function log(msg) {
  const el = document.getElementById("log");
  el.textContent += msg + "\n";
  el.scrollTop = el.scrollHeight;
}

async function ensureEngine() {
  if (engine) return engine;

  const modelBase = new URL(`models/${MODEL_ID}/`, location.href).href;
  const appConfig = {
    model_list: [
      {
        model: modelBase,
        model_id: MODEL_ID,
        model_lib: new URL(`models/${MODEL_ID}/model.wasm`, location.href).href,
        vram_required_MB: 376.06,
        low_resource_required: true,
        required_features: ["shader-f16"],
        overrides: { context_window_size: 4096 },
      },
    ],
  };

  log(`model base: ${modelBase}`);

  engine = await CreateWebWorkerMLCEngine(
    new Worker(new URL("worker.js", location.href), { type: "module" }),
    MODEL_ID,
    {
      appConfig,
      initProgressCallback: (p) => log(`[progress] ${p.text} (${Math.round((p.progress || 0) * 100)}%)`),
    }
  );
  log("engine ready");
  return engine;
}

async function classify(interests, text) {
  const e = await ensureEngine();
  const reply = await e.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          `You are a content filter for a social feed. The reader is interested in: ${interests}. ` +
          `Given a post, reply with exactly one word: YES if it relates to any of those interests, otherwise NO.`,
      },
      { role: "user", content: text },
    ],
    max_tokens: 3,
    temperature: 0,
  });
  return reply.choices[0]?.message?.content?.trim() ?? "(empty)";
}

document.getElementById("run").addEventListener("click", async () => {
  const interests = document.getElementById("interests").value;
  const text = document.getElementById("post").value;
  document.getElementById("run").disabled = true;
  try {
    log("--- classifying ---");
    const answer = await classify(interests, text);
    log(`ANSWER: ${answer}`);
  } catch (err) {
    log(`ERROR: ${err.stack || err.message || err}`);
  } finally {
    document.getElementById("run").disabled = false;
  }
});

window.addEventListener("error", (e) => log(`window error: ${e.message}`));
window.addEventListener("unhandledrejection", (e) => log(`unhandled rejection: ${e.reason}`));
