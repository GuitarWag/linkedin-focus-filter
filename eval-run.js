// Runs test/eval.html in a real Chromium (WebGPU) via agent-browser and prints
// the results. Uses its own browser session, not your everyday one.
//   npm run eval                       # all backends
//   npm run eval -- kev                # just one (comma-separated list)
const http = require("http");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const execFile = promisify(require("child_process").execFile);

const ROOT = path.join(__dirname, "test");
const PORT = Number(process.env.EVAL_PORT || 8790);
const TIMEOUT_MS = Number(process.env.EVAL_TIMEOUT_MS || 20 * 60 * 1000);
const backends = process.argv[2] || "kev,laya";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };

const server = http
  .createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return res.writeHead(404).end();
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, "127.0.0.1");

// Async on purpose: a sync exec would block the static server above.
const ab = async (...args) =>
  (await execFile("agent-browser", ["--session", "lif-eval", ...args])).stdout.trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await ab("--headed", "open", `http://127.0.0.1:${PORT}/eval.html?backends=${backends}`);
  const started = Date.now();
  let shown = 0;
  for (;;) {
    await sleep(5000);
    const text = JSON.parse(await ab("eval", "document.getElementById('log').textContent"));
    process.stdout.write(text.slice(shown));
    shown = text.length;
    if (text.includes("\ndone")) break;
    if (Date.now() - started > TIMEOUT_MS) throw new Error("eval timed out");
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await ab("close").catch(() => {});
    server.close();
  });
