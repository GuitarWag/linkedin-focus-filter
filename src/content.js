import { buildQuestions, buildState, cleanText, customOptions, judge } from "./decision.js";
import { matchJunkRule } from "./junk-filter.js";
import {
  PROCESSED_ATTR,
  blockFeed as blockFeedDom,
  clearProcessedMarkers,
  concealPost,
  hidePost,
  isPromoted,
  revealAllPosts,
  revealPost,
  unblockFeed,
} from "./dom-ops.js";

const ext = typeof browser !== "undefined" ? browser : chrome;

const DEFAULTS = {
  mode: "off", // 'off' | 'filter' | 'block'
  interests: "",
  avoid: "politics, war",
  custom: {}, // see customOptions() in decision.js
};
// `rules` counts the hidden posts a junk rule caught without a model call.
const STATS_DEFAULT = { shown: 0, hidden: 0, rules: 0 };
const LOG_DEFAULT = [];
const LOG_LIMIT = 50;

const POST_SELECTOR = '[componentkey^="update-card-focus"]';
const FEED_SELECTORS = ['[data-testid="mainFeed"]', "main"];
const DISMISS_KEY = "lifBlockDismissed";

// The decision model is trained on states up to ~384 tokens; 800 characters
// stays well inside that.
const TEXT_CAP = 800;
// How far above the viewport a queued post can drift before we stop bothering.
const STALE_ABOVE_PX = 2000;
// Posts are concealed on sight and only revealed once judged, so a stalled or
// broken model would otherwise leave a blank feed. Give up and show the post
// after this long — generous enough to cover a cold model load.
const VEIL_TIMEOUT_MS = 20000;

let config = { ...DEFAULTS };
let modelReady = false;
let modelLoading = null;
let processedCount = 0;
const queue = [];
let draining = false;

// What is actually wired into the DOM right now, as opposed to what the
// stored config says. These drift apart the moment the user switches modes.
let activeMode = null;
let observedRoot = null;
let bootstrapObserver = null;
let seen = new WeakSet();

function getConfig() {
  return ext.storage.local.get(DEFAULTS);
}

// Stats, log and debug events all buffer in memory and flush on a debounce.
// Doing them inline cost 5 serialized storage round-trips per post, all of
// them sitting between one classification and the next.
const DEBUG_LOG_KEY = "lif-debug-log";
const FLUSH_DELAY_MS = 1500;

let pendingStats = { ...STATS_DEFAULT };
let pendingLog = [];
let pendingDebug = [];
let flushTimer = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_DELAY_MS);
}

async function flush() {
  const stats = pendingStats;
  const logEntries = pendingLog;
  const debugEntries = pendingDebug;
  pendingStats = { ...STATS_DEFAULT };
  pendingLog = [];
  pendingDebug = [];

  // Debug builds ship a copy of every batch to the local collector.
  if (__LIF_TELEMETRY__ && (debugEntries.length || logEntries.length)) {
    ext.runtime
      .sendMessage({ lifTelemetry: { debug: debugEntries, log: logEntries, stats } })
      .catch(() => {});
  }

  if (debugEntries.length) {
    try {
      const arr = JSON.parse(localStorage.getItem(DEBUG_LOG_KEY) || "[]");
      arr.push(...debugEntries);
      if (arr.length > 300) arr.splice(0, arr.length - 300);
      localStorage.setItem(DEBUG_LOG_KEY, JSON.stringify(arr));
    } catch {
      // ignore
    }
  }

  const dirtyStats = stats.shown || stats.hidden;
  if (!dirtyStats && !logEntries.length) return;

  try {
    const stored = await ext.storage.local.get({ lifStats: STATS_DEFAULT, lifLog: LOG_DEFAULT });
    const next = {};
    if (dirtyStats) {
      const s = stored.lifStats;
      next.lifStats = {
        ...s,
        shown: s.shown + stats.shown,
        hidden: s.hidden + stats.hidden,
        rules: (s.rules || 0) + stats.rules,
      };
    }
    if (logEntries.length) {
      const merged = [...logEntries.reverse(), ...stored.lifLog];
      if (merged.length > LOG_LIMIT) merged.length = LOG_LIMIT;
      next.lifLog = merged;
    }
    await ext.storage.local.set(next);
  } catch (err) {
    console.error("[LinkedIn Focus Filter] flush failed", err);
  }
}

function debugLog(event, data) {
  pendingDebug.push({ t: Date.now(), event, data });
  scheduleFlush();
}

function bumpStat(key) {
  pendingStats[key] += 1;
  scheduleFlush();
}

function appendLog(entry) {
  pendingLog.push({ t: Date.now(), ...entry });
  scheduleFlush();
}

// Status drives the popup, so it stays a direct write — but nothing waits on it.
function setStatus(state, message = "", progress = null) {
  ext.storage.local
    .set({ lifStatus: { state, message, progress, updatedAt: Date.now() } })
    .catch(() => {});
}

// Don't lose buffered counts when the tab goes away.
window.addEventListener("pagehide", flush);

// The model lives in an offscreen document (see background.js). The service
// worker creates it on request; after that, decisions go straight to it.
function ensureModel() {
  if (modelReady) return Promise.resolve();
  if (modelLoading) return modelLoading;
  setStatus("loading", "Loading the model…");
  debugLog("engine:start", {});
  modelLoading = ext.runtime
    .sendMessage({ lifEnsureModel: true })
    .then((r) => {
      if (!r || r.error) {
        debugLog("engine:error", { message: r?.error || "no reply" });
        throw new Error(r?.error || "model did not start");
      }
      modelReady = true;
      setStatus("ready", "Model ready, filtering posts");
      debugLog("engine:ready", { runtime: r.runtime, loadMs: r.loadMs });
    })
    // Reset on rejection too, or a dead message port would pin every later
    // post to this failed promise. A failure retries on the next post.
    .finally(() => (modelLoading = null));
  return modelLoading;
}

async function decide(text, questions) {
  const r = await ext.runtime.sendMessage({ lifDecide: { text, questions } });
  if (!r || r.error) {
    // The document can go away (extension reload, crash); start over next time.
    modelReady = false;
    throw new Error(r?.error || "no answer from the model");
  }
  return r;
}

// textContent rather than innerText: innerText is layout-aware and forces a
// synchronous reflow on every call, which is expensive on LinkedIn's DOM.
function extractText(post) {
  const parts = post.querySelectorAll('[data-testid="expandable-text-box"]');
  const text = parts.length
    ? Array.from(parts).map((p) => p.textContent).join("\n")
    : post.textContent;
  // Drop a high surrogate left dangling by the cut, or the logged JSON breaks.
  return cleanText(text).slice(0, TEXT_CAP).replace(/[\ud800-\udbff]$/, "");
}

// judge() reasons ("avoid: war", "gate: joke or meme (0.91)") as bar text.
function hideReason(reason) {
  if (reason.startsWith("avoid: ")) return `about ${reason.slice(7)}`;
  if (reason.startsWith("gate: ")) return `kind is ${reason.slice(6).replace(/ \([\d.]+\)$/, "")}`;
  return "not about your topics";
}

const verdictCache = new Map(); // post text -> { answer, raw, reason }

async function classify(post) {
  const text = extractText(post);
  debugLog("classify:start", {
    textLen: text.length,
    textPreview: text.slice(0, 120),
    // The card's opening text (author, "Promoted", "Recommended for you"),
    // kept so header-based rules can be checked against real posts.
    head: post.textContent.replace(/\s+/g, " ").trim().slice(0, 160),
  });
  if (!text) {
    // Probably a skeleton that hasn't hydrated yet. Don't leave it veiled, and
    // don't mark it done either. Hydration adds children inside the post, so
    // the mutation scan never sees the post itself again; re-observe it after
    // a pause. (Observing right away fires immediately on a visible post and
    // spins.) Flagged so the retry doesn't veil it again.
    debugLog("classify:skip-empty-text", {});
    settleVeil(post);
    revealPost(post);
    delete post.dataset[PROCESSED_ATTR];
    post.dataset.lifRetry = "1";
    seen.delete(post);
    setTimeout(() => activeMode === "filter" && post.isConnected && io.observe(post), 1000);
    return;
  }

  // Obvious feed junk gets hidden without touching the model at all — it is
  // both the cheapest path and more reliable than asking a small model to apply
  // an exclusion policy (measured: policy prompts caused 5/12 false-hides).
  const junkRule = isPromoted(post) ? "promoted" : matchJunkRule(text);
  if (junkRule) {
    settleVeil(post);
    processedCount++;
    hidePost(post, junkRule === "promoted" ? "promoted" : `matched the ${junkRule} rule`);
    bumpStat("hidden");
    bumpStat("rules");
    debugLog("classify:junk-rule", { rule: junkRule });
    appendLog({
      interests: config.interests,
      systemPrompt: `(no model call: matched junk rule "${junkRule}")`,
      junkRule,
      text,
      rawOutput: "",
      answer: "NO",
      reason: `matched rule: ${junkRule}`,
      hidden: true,
      latencyMs: 0,
    });
    setStatus("ready", `Classified ${processedCount} post${processedCount === 1 ? "" : "s"}`);
    return;
  }

  const opts = customOptions(config.custom);
  const questions = buildQuestions(config.interests, config.avoid, opts);
  const systemPrompt = questions.map((q) => `${q.instructions} [${(q.options ?? []).join(" | ")}]`).join("\n");
  const cached = verdictCache.get(text);
  if (!cached) await ensureModel();

  // The mode can change while the model loads or an earlier post classifies.
  if (activeMode !== "filter") {
    debugLog("classify:abandoned", { activeMode });
    return;
  }

  let verdict = cached;
  let latencyMs = 0;

  if (!cached) {
    const startedAt = performance.now();
    const r = await decide(buildState(text, opts), questions);
    latencyMs = Math.round(performance.now() - startedAt);

    if (activeMode !== "filter") {
      debugLog("classify:discarded-result", { activeMode });
      return;
    }

    verdict = judge(config.interests, r.answers, opts);
    verdictCache.set(text, verdict);
  } else {
    debugLog("classify:cache-hit", {});
  }
  const { answer, raw, reason } = verdict;

  settleVeil(post);
  processedCount++;

  const hidden = answer === "NO";
  if (hidden) hidePost(post, hideReason(reason));
  else revealPost(post); // lift the veil now that it passed
  bumpStat(hidden ? "hidden" : "shown");

  debugLog("classify:answer", { answer, reason, latencyMs, cached: !!cached });
  appendLog({
    interests: config.interests,
    systemPrompt,
    // Full text as sent to the model, so log entries can be exported as
    // faithful eval cases.
    text,
    rawOutput: raw,
    answer,
    reason,
    hidden,
    latencyMs,
  });
  setStatus("ready", `Classified ${processedCount} post${processedCount === 1 ? "" : "s"}`);
}

async function drainQueue() {
  if (draining) return;
  draining = true;
  while (queue.length) {
    if (document.hidden) break; // don't burn GPU/battery on a backgrounded tab
    if (activeMode !== "filter") {
      queue.length = 0; // mode changed under us; drop the pending work
      break;
    }
    const post = queue.shift();

    // Fast scrolling queues posts the reader blows straight past. Skip those
    // and re-observe, so they only cost an inference if approached again.
    if (!post.isConnected) continue;
    if (post.getBoundingClientRect().bottom < -STALE_ABOVE_PX) {
      debugLog("queue:skip-scrolled-past", {});
      io.observe(post);
      continue;
    }

    try {
      await classify(post);
    } catch (err) {
      console.error("[LinkedIn Focus Filter]", err);
      debugLog("classify:error", { message: String(err?.message || err), stack: err?.stack });
      // Never strand a post behind the veil because classification failed.
      settleVeil(post);
      revealPost(post);
      setStatus("error", String(err.message || err));
    }
  }
  draining = false;
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && queue.length && activeMode === "filter") drainQueue();
});

const io = new IntersectionObserver(
  (entries) => {
    if (activeMode !== "filter") return;
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      io.unobserve(entry.target);
      debugLog("queue:push", { queueLenBefore: queue.length });
      queue.push(entry.target);
      drainQueue();
    }
  },
  // Kev answers in ~100ms, so judge posts well before they scroll into view.
  // At 800px, LinkedIn's batches of 5 posts sat below the margin long enough
  // for the veil timeout to show them unfiltered (11 of ~45 in one session).
  { rootMargin: "3000px 0px" }
);

const veilTimers = new WeakMap();

function releaseVeilLater(post) {
  const id = setTimeout(() => {
    // A re-apply (interests changed) re-conceals the post with a fresh timer;
    // this one is then stale and must not reveal the new veil early.
    if (veilTimers.get(post) !== id) return;
    veilTimers.delete(post);
    if (post.dataset[PROCESSED_ATTR] !== "pending") return;
    debugLog("veil:timeout-reveal", {});
    // Show it rather than leave a blank feed, but don't mark it done: a post
    // revealed because the model was still loading must stay eligible for a
    // verdict, or a slow cold start silently lets a chunk of feed through
    // unfiltered. Flagged so the retry doesn't veil it again and flicker.
    revealPost(post);
    delete post.dataset[PROCESSED_ATTR];
    post.dataset.lifRetry = "1";
    seen.delete(post);
    io.observe(post);
  }, VEIL_TIMEOUT_MS);
  veilTimers.set(post, id);
}

function settleVeil(post) {
  const id = veilTimers.get(post);
  if (id !== undefined) {
    clearTimeout(id);
    veilTimers.delete(post);
  }
}

function watchPost(post) {
  if (seen.has(post) || post.dataset[PROCESSED_ATTR]) return;
  seen.add(post);
  // Conceal first, judge second: nothing unwanted is ever readable. A post
  // already shown by the veil timeout is left visible while it retries —
  // re-concealing it would flicker every timeout.
  if (post.dataset.lifRetry !== "1") {
    concealPost(post);
    releaseVeilLater(post);
  } else {
    post.dataset[PROCESSED_ATTR] = "pending";
  }
  io.observe(post);
}

function scanForPosts(root) {
  const found = root.querySelectorAll?.(POST_SELECTOR) ?? [];
  debugLog("scan", { root: root.nodeName, matched: found.length });
  found.forEach(watchPost);
  if (root.matches?.(POST_SELECTOR)) watchPost(root);
}

function findFeedRoot() {
  for (const sel of FEED_SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function blockFeed() {
  if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
  const container = findFeedRoot();
  const blocked = blockFeedDom(container, () => sessionStorage.setItem(DISMISS_KEY, "1"));
  if (blocked) setStatus("ready", "Feed blocked");
}

const mo = new MutationObserver((mutations) => {
  if (activeMode === "block") {
    blockFeed();
    return;
  }
  if (activeMode !== "filter") return;
  for (const m of mutations) {
    m.addedNodes.forEach((node) => {
      if (node.nodeType === 1) scanForPosts(node);
    });
  }
});

// Watch only the feed container, not the whole page — LinkedIn's chrome
// (badges, nav counters, hover states) mutates far more than the feed does.
// `onFound` runs immediately once the root exists (now or via a short-lived
// bootstrap watcher) — it must not depend on a later mutation to fire, since
// the feed can render fully in one shot with no further changes inside it.
function startObserving(onFound) {
  const attach = (root) => {
    observedRoot = root;
    onFound(root);
    mo.observe(root, { childList: true, subtree: true });
  };

  const root = findFeedRoot();
  if (root) {
    attach(root);
    return;
  }
  bootstrapObserver = new MutationObserver(() => {
    const r = findFeedRoot();
    if (r) {
      bootstrapObserver.disconnect();
      bootstrapObserver = null;
      attach(r);
    }
  });
  bootstrapObserver.observe(document.body, { childList: true, subtree: true });
}

function onFoundFor(mode) {
  return mode === "block" ? () => blockFeed() : (root) => scanForPosts(root);
}

// Reverse everything the outgoing mode did to the page, and drop any watcher
// that could still fire on its behalf.
function teardown(mode) {
  bootstrapObserver?.disconnect();
  bootstrapObserver = null;
  mo.disconnect();
  observedRoot = null;

  if (mode === "block") unblockFeed();

  if (mode === "filter") {
    io.disconnect();
    queue.length = 0;
    revealAllPosts();
    seen = new WeakSet();
    // Verdicts depend on the interests, so they can't outlive a re-apply.
    verdictCache.clear();
    // Clear our markers so re-enabling re-evaluates posts against whatever
    // the interests are by then.
    clearProcessedMarkers();
    flush();
  }
}

async function applyMode(mode, force = false) {
  if (mode === activeMode && !force) return;
  debugLog("mode:apply", { from: activeMode, to: mode, force });

  teardown(activeMode);
  activeMode = mode;

  if (mode === "block") {
    startObserving(onFoundFor("block"));
  } else if (mode === "filter" && config.interests.trim()) {
    await setStatus("idle", "Watching the feed");
    scanForPosts(document.body);
    startObserving(onFoundFor("filter"));
  } else if (mode === "filter") {
    await setStatus("idle", "Add your interests to start filtering");
  } else {
    await setStatus("idle", "Off");
  }
}

// ponytail: 10s poll to catch LinkedIn's SPA swapping the feed root out from
// under us — a MutationObserver scoped to a node can't see that node being
// replaced. Move to a parent-scoped observer if 10s of staleness ever matters.
setInterval(() => {
  if (document.hidden || !activeMode || activeMode === "off") return;
  const current = findFeedRoot();
  if (!current || current === observedRoot) return;
  debugLog("root:replaced", { mode: activeMode });
  mo.disconnect();
  startObserving(onFoundFor(activeMode));
}, 10000);

async function main() {
  config = await getConfig();
  debugLog("main:start", { mode: config.mode, interestsLen: config.interests.length });

  ext.storage.onChanged.addListener((changes) => {
    if (changes.interests) config.interests = changes.interests.newValue;
    if (changes.avoid) config.avoid = changes.avoid.newValue;
    if (changes.custom) config.custom = changes.custom.newValue || {};
    if (changes.mode) {
      config.mode = changes.mode.newValue;
      // An explicit re-selection of block mode overrides an earlier
      // "show feed for this session" dismissal.
      if (config.mode === "block") sessionStorage.removeItem(DISMISS_KEY);
    }
    if (changes.mode || ((changes.interests || changes.avoid || changes.custom) && config.mode === "filter")) {
      applyMode(config.mode, true);
    }
  });

  await applyMode(config.mode);
}

main();
