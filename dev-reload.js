// Dev loop against the running Dia (or Chrome) with remote debugging enabled
// from chrome://inspect/#remote-debugging. Reloads the unpacked extension from
// dist/, then reloads every open LinkedIn feed tab.
//   npm run dev     # build:debug + this script
//   node dev-reload.js --watch   # keep one approved connection open and reload
//                                # whenever dist/ is rebuilt (Dia asks to approve
//                                # every new connection, so this skips the prompt)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PORT_FILE =
  process.env.DEVTOOLS_PORT_FILE ||
  path.join(os.homedir(), "Library/Application Support/Dia/User Data/DevToolsActivePort");

// Chrome derives an unpacked extension's ID from its absolute path.
const extId = crypto
  .createHash("sha256")
  .update(path.resolve(__dirname, "dist"))
  .digest("hex")
  .slice(0, 32)
  .replace(/./g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

const [port, wsPath] = fs.readFileSync(PORT_FILE, "utf8").trim().split("\n");
const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`);

let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
};
// Every call times out: a target that dies mid-call (the extension reloading
// itself) may never answer, and a silent hang hides where the loop stopped.
function send(method, params = {}, sessionId, timeoutMs = 10000) {
  const id = nextId++;
  if (process.env.DEV_TRACE) console.log(`-> ${method}`);
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (!pending.delete(id)) return;
      reject(new Error(`${method} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reload() {
  // Reload the extension from one of its own pages; the service worker may be
  // asleep, so open the popup page in a background tab rather than rely on it.
  const { targetInfos: before } = await send("Target.getTargets");
  const mine = before.filter((t) => t.url.startsWith(`chrome-extension://${extId}/`));
  console.log(`extension targets: ${mine.map((t) => `${t.type} ${t.url.split("/").pop()}`).join(", ") || "none"}`);
  const { targetId } = await send("Target.createTarget", {
    url: `chrome-extension://${extId}/popup.html`,
    background: true,
  });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await sleep(300);
  const r = await send("Runtime.evaluate", { expression: "chrome.runtime.reload()" }, sessionId, 3000).catch(
    () => null // the page dies mid-call as the extension reloads
  );
  if (r?.exceptionDetails) console.log(`reload failed: ${r.exceptionDetails.exception?.description}`);
  console.log(`reloaded extension ${extId}`);
  await sleep(1500);

  const { targetInfos } = await send("Target.getTargets");
  const tabs = targetInfos.filter((t) => t.type === "page" && /linkedin\.com\/(feed|$)/.test(t.url));
  for (const t of tabs) {
    const s = await send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    await send("Page.reload", {}, s.sessionId);
    await send("Target.detachFromTarget", { sessionId: s.sessionId });
  }
  console.log(`reloaded ${tabs.length} LinkedIn tab(s)`);
  // A failed scroll run shouldn't take the watcher (and its approval) down.
  if (tabs[0]) await exercise(tabs[0].targetId).catch((e) => console.error(`scroll stopped: ${e.message}`));
}

// The content script skips work in a hidden tab, so bring the feed to the
// front and scroll it for a while to get posts classified unattended.
const SCROLL_STEPS = Number(process.env.SCROLL_STEPS || 12);
async function exercise(targetId) {
  await send("Target.activateTarget", { targetId });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await sleep(5000);
  // A wheel event over the feed scrolls whatever container LinkedIn uses;
  // window.scrollBy did nothing there.
  const probe =
    "JSON.stringify({y: Math.max(scrollY, document.querySelector('main')?.scrollTop || 0)," +
    " posts: document.querySelectorAll('[componentkey^=\"update-card-focus\"]').length})";
  for (let i = 0; i < SCROLL_STEPS; i++) {
    await send(
      "Input.dispatchMouseEvent",
      { type: "mouseWheel", x: 600, y: 500, deltaX: 0, deltaY: 900 },
      sessionId
    );
    await sleep(10000);
    const { result } = await send("Runtime.evaluate", { expression: probe }, sessionId);
    console.log(`step ${i + 1}: ${result.value}`);
  }
  await send("Target.detachFromTarget", { sessionId });
  console.log(`scrolled ${SCROLL_STEPS} steps`);
}

async function main() {
  console.log("connecting; approve the prompt in the browser");
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  console.log("connected");
  await reload();
  if (!process.argv.includes("--watch")) return ws.close();

  // build.js writes content.js last, so a change there means a finished build.
  let timer;
  fs.watch(path.join(__dirname, "dist"), (_, file) => {
    if (file !== "content.js") return;
    clearTimeout(timer);
    timer = setTimeout(() => reload().catch((e) => console.error(e.message)), 500);
  });
  ws.onclose = () => {
    console.error("connection closed");
    process.exit(1);
  };
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
