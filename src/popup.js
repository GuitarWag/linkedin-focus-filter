const ext = typeof browser !== "undefined" ? browser : chrome;

const DEFAULTS = {
  mode: "off",
  interests: "",
  avoid: "politics, war",
};
const STATS_DEFAULT = { shown: 0, hidden: 0 };
const STATUS_DEFAULT = { state: "idle", message: "Not running yet" };

const modeEl = document.getElementById("mode");
const filterSettingsEl = document.getElementById("filterSettings");
const interestsEl = document.getElementById("interests");
const avoidEl = document.getElementById("avoid");
const saveStatusEl = document.getElementById("saveStatus");

const statusDotEl = document.getElementById("statusDot");
const statusTextEl = document.getElementById("statusText");
const progressTrackEl = document.getElementById("progressTrack");
const progressBarEl = document.getElementById("progressBar");
const statHiddenEl = document.getElementById("statHidden");
const statShownEl = document.getElementById("statShown");

function syncModeVisibility() {
  filterSettingsEl.style.display = modeEl.value === "filter" ? "block" : "none";
}

function renderStats(stats) {
  statHiddenEl.textContent = stats.hidden;
  statShownEl.textContent = stats.shown;
}

function renderStatus(status, onLinkedIn) {
  if (!onLinkedIn) {
    statusDotEl.className = "idle";
    statusTextEl.textContent = "Open linkedin.com/feed to use this";
    progressTrackEl.hidden = true;
    return;
  }
  statusDotEl.className = status.state;

  const hasProgress = status.state === "loading" && typeof status.progress === "number";
  if (hasProgress) {
    const pct = Math.round(status.progress * 100);
    statusTextEl.textContent = `${status.message || "Loading"} (${pct}%)`;
    progressTrackEl.hidden = false;
    progressBarEl.style.width = `${pct}%`;
  } else {
    statusTextEl.textContent = status.message || status.state;
    progressTrackEl.hidden = true;
  }
}

let isOnLinkedIn = false;

async function init() {
  const cfg = await ext.storage.local.get(DEFAULTS);
  modeEl.value = cfg.mode;
  interestsEl.value = cfg.interests;
  avoidEl.value = cfg.avoid;
  syncModeVisibility();

  const { lifStats } = await ext.storage.local.get({ lifStats: STATS_DEFAULT });
  renderStats(lifStats);

  // Any open LinkedIn tab counts. Asking for the active tab of the current
  // window returned no URL in Dia, so the popup always said to open LinkedIn.
  const tabs = await ext.tabs.query({ url: "https://www.linkedin.com/*" });
  isOnLinkedIn = tabs.length > 0;

  const { lifStatus } = await ext.storage.local.get({ lifStatus: STATUS_DEFAULT });
  renderStatus(lifStatus, isOnLinkedIn);
}

ext.storage.onChanged.addListener((changes) => {
  if (changes.lifStats) renderStats(changes.lifStats.newValue);
  if (changes.lifStatus) renderStatus(changes.lifStatus.newValue, isOnLinkedIn);
});

modeEl.addEventListener("change", syncModeVisibility);

document.getElementById("resetStats").addEventListener("click", async () => {
  await ext.storage.local.set({ lifStats: STATS_DEFAULT });
});

document.getElementById("viewLog").addEventListener("click", () => {
  ext.tabs.create({ url: ext.runtime.getURL("log.html") });
});

document.getElementById("save").addEventListener("click", async () => {
  await ext.storage.local.set({
    mode: modeEl.value,
    interests: interestsEl.value,
    avoid: avoidEl.value,
  });
  saveStatusEl.textContent = "Saved — applied to open LinkedIn tabs right away.";
});

init();
