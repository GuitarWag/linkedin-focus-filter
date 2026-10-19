const esbuild = require("esbuild");
const fs = require("fs");

// LIF_TELEMETRY=1 npm run build -> debug build that posts events to the local
// collector (telemetry-server.js). Set it to a URL to point somewhere else.
const telemetry = process.env.LIF_TELEMETRY;
const telemetryUrl = telemetry === "1" ? "http://127.0.0.1:8787/events" : telemetry || null;
const define = { __LIF_TELEMETRY__: JSON.stringify(telemetryUrl) };

fs.mkdirSync("dist", { recursive: true });
for (const f of ["popup.html", "log.html", "log.js", "offscreen.html"]) {
  fs.copyFileSync(`src/${f}`, `dist/${f}`);
}

// 330 MB, so skip the copy once a previous build placed it (rm -r dist to redo).
if (!fs.existsSync("dist/models/onnx-community")) {
  fs.cpSync("assets/models/onnx-community", "dist/models/onnx-community", { recursive: true });
}

fs.cpSync("src/icons", "dist/icons", { recursive: true });

// ONNX Runtime's WebAssembly build, served from the extension instead of a CDN.
fs.rmSync("dist/ort", { recursive: true, force: true });
fs.mkdirSync("dist/ort");
for (const f of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
  fs.copyFileSync(`node_modules/onnxruntime-web/dist/${f}`, `dist/ort/${f}`);
}

const manifest = JSON.parse(fs.readFileSync("src/manifest.json", "utf8"));
if (telemetryUrl) {
  manifest.name += " (debug)";
  manifest.host_permissions.push(new URL(telemetryUrl).origin + "/*");
}
fs.writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2));

const common = { bundle: true, target: "chrome120", define };
esbuild.buildSync({ ...common, format: "iife", entryPoints: ["src/background.js"], outfile: "dist/background.js" });
// The popup imports the defaults from decision.js.
esbuild.buildSync({ ...common, format: "iife", entryPoints: ["src/popup.js"], outfile: "dist/popup.js" });
// transformers.js uses top-level await, so the offscreen page loads as a module.
esbuild.buildSync({ ...common, format: "esm", entryPoints: ["src/offscreen.js"], outfile: "dist/offscreen.js" });
// Built last: dev-reload.js watches for content.js to know a build finished.
esbuild.buildSync({ ...common, format: "iife", entryPoints: ["src/content.js"], outfile: "dist/content.js" });

console.log(`Built extension into dist/${telemetryUrl ? ` (telemetry -> ${telemetryUrl})` : ""}`);
