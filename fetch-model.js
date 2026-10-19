const fs = require("fs");
const path = require("path");

const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
const HF_REPO = `mlc-ai/${MODEL_ID}`;
const WASM_URL =
  "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Llama-3.2-1B-Instruct-q4f16_1_cs1k-webgpu.wasm";

const NUM_SHARDS = 22;
const FILES = [
  "mlc-chat-config.json",
  "ndarray-cache.json",
  "tensor-cache.json",
  "tokenizer.json",
  "tokenizer_config.json",
  ...Array.from({ length: NUM_SHARDS }, (_, i) => `params_shard_${i}.bin`),
];

const outDir = path.join(__dirname, "assets", "models", MODEL_ID);
const filesDir = path.join(outDir, "resolve", "main");
fs.mkdirSync(filesDir, { recursive: true });

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`${dest} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
}

// The decision model the extension ships (src/decision.js). Laid out the way
// transformers.js resolves local models: <localModelPath>/<repo>/<file>.
const KEV_REPO = "onnx-community/kev-0.6b-ONNX";
const KEV_FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "added_tokens.json",
  "special_tokens_map.json",
  "vocab.json",
  "merges.txt",
  "onnx/model_q4f16.onnx",
  "onnx/model_q4f16.onnx_data",
];

async function fetchKev() {
  const dir = path.join(__dirname, "assets", "models", KEV_REPO);
  for (const f of KEV_FILES) {
    const dest = path.join(dir, f);
    if (fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await download(`https://huggingface.co/${KEV_REPO}/resolve/main/${f}`, dest);
  }
}

// Llama is only used by the eval now (`npm run eval -- llama`).
async function main() {
  await fetchKev();
  for (const f of FILES) {
    const dest = path.join(filesDir, f);
    if (fs.existsSync(dest)) continue;
    await download(`https://huggingface.co/${HF_REPO}/resolve/main/${f}`, dest);
  }
  const wasmDest = path.join(outDir, "model.wasm");
  if (!fs.existsSync(wasmDest)) await download(WASM_URL, wasmDest);
  console.log("Done:", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
