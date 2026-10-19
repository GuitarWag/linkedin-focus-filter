import { DEFAULT_OPTIONS, KIND_GATE } from "./decision.js";

const ext = typeof browser !== "undefined" ? browser : chrome;

const DEFAULTS = {
  mode: "off",
  interests: "",
  avoid: "politics, war",
  custom: {},
};
const STATS_DEFAULT = { shown: 0, hidden: 0, rules: 0 };
const STATUS_DEFAULT = { state: "idle", message: "Not running yet" };
const MODE_HINTS = {
  off: "LinkedIn shows the feed as usual.",
  filter: "Posts stay hidden until the model checks them. Posts that do not match your topics stay collapsed.",
  block: "Replaces the whole feed with a notice. You can show it again for the current session.",
};

const $ = (id) => document.getElementById(id);
const interestsEl = $("interests");
const avoidEl = $("avoid");
const instructionsEl = $("instructions");
const otherEl = $("otherDescription");
const kindsEl = $("kinds");
const saveEl = $("save");
const saveStatusEl = $("saveStatus");

kindsEl.innerHTML = KIND_GATE.options
  .map(
    (k, i) =>
      `<label title="${KIND_GATE.descriptions[k]}"><input type="checkbox" id="kind-${i}" value="${k}" />${k}</label>`
  )
  .join("");
const kindBoxes = [...kindsEl.querySelectorAll("input")];
instructionsEl.placeholder = DEFAULT_OPTIONS.instructions;
otherEl.placeholder = DEFAULT_OPTIONS.otherDescription;

const currentMode = () => document.querySelector('input[name="mode"]:checked')?.value || "off";

function syncMode() {
  const mode = currentMode();
  $("filterSettings").hidden = mode !== "filter";
  $("modeHint").textContent = MODE_HINTS[mode];
}

function fillAdvanced(custom) {
  instructionsEl.value = custom.instructions || DEFAULT_OPTIONS.instructions;
  otherEl.value = custom.otherDescription || DEFAULT_OPTIONS.otherDescription;
  const keep = custom.keepKinds?.length ? custom.keepKinds : KIND_GATE.keep;
  for (const box of kindBoxes) box.checked = keep.includes(box.value);
}

// Store only what differs from the shipped defaults, so a later release that
// improves a default reaches readers who never changed it.
function readCustom() {
  const custom = {};
  const instructions = instructionsEl.value.trim();
  const other = otherEl.value.trim();
  const keep = kindBoxes.filter((b) => b.checked).map((b) => b.value);
  if (instructions && instructions !== DEFAULT_OPTIONS.instructions) custom.instructions = instructions;
  if (other && other !== DEFAULT_OPTIONS.otherDescription) custom.otherDescription = other;
  if (keep.join("|") !== KIND_GATE.keep.join("|")) custom.keepKinds = keep;
  return custom;
}

function renderStats(stats) {
  const { shown = 0, hidden = 0, rules = 0, since } = stats || {};
  const total = shown + hidden;
  const pct = total ? Math.round((hidden / total) * 100) : 0;
  $("statShown").textContent = shown;
  $("statHidden").textContent = hidden;
  $("statPct").textContent = `${pct}%`;
  $("ratioShown").style.width = total ? `${100 - pct}%` : "0";
  $("ratioHidden").style.width = total ? `${pct}%` : "0";
  const parts = [];
  if (hidden) parts.push(`${rules} of the hidden posts matched a rule (ads, hiring, bait) and skipped the model.`);
  if (since) parts.push(`Since ${new Date(since).toLocaleDateString()}.`);
  $("statRules").textContent = total ? parts.join(" ") : "No posts checked yet.";
}

function renderStatus(status, onLinkedIn) {
  const dot = $("statusDot");
  const text = $("statusText");
  const track = $("progressTrack");
  if (!onLinkedIn) {
    dot.className = "";
    text.textContent = "Open LinkedIn to start";
    track.hidden = true;
    return;
  }
  dot.className = status.state;
  const hasProgress = status.state === "loading" && typeof status.progress === "number";
  const pct = hasProgress ? Math.round(status.progress * 100) : 0;
  text.textContent = hasProgress ? `${status.message || "Loading"} ${pct}%` : status.message || status.state;
  track.hidden = !hasProgress;
  $("progressBar").style.width = `${pct}%`;
}

function markDirty() {
  saveEl.disabled = false;
  saveStatusEl.textContent = "";
}

let isOnLinkedIn = false;

async function init() {
  const cfg = await ext.storage.local.get(DEFAULTS);
  $(`mode-${cfg.mode}`).checked = true;
  interestsEl.value = cfg.interests;
  avoidEl.value = cfg.avoid;
  fillAdvanced(cfg.custom || {});
  if (Object.keys(cfg.custom || {}).length) $("advanced").open = true;
  syncMode();

  const { lifStats, lifStatus } = await ext.storage.local.get({ lifStats: STATS_DEFAULT, lifStatus: STATUS_DEFAULT });
  renderStats(lifStats);

  // Any open LinkedIn tab counts. Asking for the active tab of the current
  // window returned no URL in Dia, so the popup always said to open LinkedIn.
  const tabs = await ext.tabs.query({ url: "https://www.linkedin.com/*" });
  isOnLinkedIn = tabs.length > 0;
  renderStatus(lifStatus, isOnLinkedIn);
}

ext.storage.onChanged.addListener((changes) => {
  if (changes.lifStats) renderStats(changes.lifStats.newValue);
  if (changes.lifStatus) renderStatus(changes.lifStatus.newValue, isOnLinkedIn);
});

// The mode is a switch: it applies at once, with no Save.
for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener("change", () => {
    syncMode();
    ext.storage.local.set({ mode: currentMode() });
  });
}

for (const el of [interestsEl, avoidEl, instructionsEl, otherEl, ...kindBoxes]) {
  el.addEventListener("input", markDirty);
}

$("resetAdvanced").addEventListener("click", () => {
  fillAdvanced({});
  markDirty();
});

$("resetStats").addEventListener("click", () => {
  ext.storage.local.set({ lifStats: { ...STATS_DEFAULT, since: Date.now() } });
});

$("viewLog").addEventListener("click", () => {
  ext.tabs.create({ url: ext.runtime.getURL("log.html") });
});

saveEl.addEventListener("click", async () => {
  if (!kindBoxes.some((b) => b.checked)) {
    saveStatusEl.textContent = "Tick at least one post kind, or every post is hidden.";
    return;
  }
  await ext.storage.local.set({ interests: interestsEl.value, avoid: avoidEl.value, custom: readCustom() });
  saveEl.disabled = true;
  saveStatusEl.textContent = "Saved. Open LinkedIn tabs check the feed again now.";
});

// Cmd/Ctrl+Enter saves from any field.
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !saveEl.disabled) saveEl.click();
});

init();
