// Downloads the decision model the extension ships (src/decision.js) into
// assets/models, laid out the way transformers.js resolves local models:
// <localModelPath>/<repo>/<file>. Files already present are skipped.
//   node fetch-model.js
const fs = require("fs");
const path = require("path");

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

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`${dest} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  const dir = path.join(__dirname, "assets", "models", KEV_REPO);
  for (const f of KEV_FILES) {
    const dest = path.join(dir, f);
    if (fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await download(`https://huggingface.co/${KEV_REPO}/resolve/main/${f}`, dest);
  }
  console.log("Done:", dir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
