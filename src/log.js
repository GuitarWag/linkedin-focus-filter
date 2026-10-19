const ext = typeof browser !== "undefined" ? browser : chrome;

let entries = [];

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s ?? "";
  return div.innerHTML;
}

function opposite(answer) {
  return answer === "YES" ? "NO" : "YES";
}

function labelledCount() {
  return entries.filter((e) => e.want).length;
}

function renderStats() {
  const total = entries.length;
  const hiddenCount = entries.filter((e) => e.hidden).length;
  const shownCount = total - hiddenCount;
  const hiddenPct = total ? Math.round((hiddenCount / total) * 100) : 0;
  const shownPct = total ? 100 - hiddenPct : 0;
  const timed = entries.filter((e) => e.latencyMs);
  const avgLatency = timed.length
    ? Math.round(timed.reduce((sum, e) => sum + e.latencyMs, 0) / timed.length)
    : 0;

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statHiddenPct").textContent = `${hiddenPct}% (${hiddenCount})`;
  document.getElementById("statShownPct").textContent = `${shownPct}% (${shownCount})`;
  document.getElementById("statLatency").textContent = `${avgLatency}ms`;

  const ratioBar = document.getElementById("ratioBar");
  ratioBar.innerHTML = total
    ? `<div class="hiddenSeg" style="width:${hiddenPct}%"></div><div class="shownSeg" style="width:${shownPct}%"></div>`
    : "";

  const timeline = document.getElementById("timeline");
  if (!total) {
    timeline.innerHTML = '<span class="empty-note">The timeline fills in as the filter checks posts.</span>';
  } else {
    timeline.innerHTML = [...entries]
      .reverse()
      .map((e) => {
        const h = 10 + Math.min(18, (e.latencyMs || 0) / 100);
        const title = `${e.hidden ? "Hidden" : "Shown"}: ${e.reason || ""} (${e.latencyMs ?? "?"}ms)`;
        return `<div class="tick ${e.hidden ? "hidden" : "shown"}" style="height:${h}px" title="${title.replace(/"/g, "&quot;")}"></div>`;
      })
      .join("");
  }

  const n = labelledCount();
  const agree = entries.filter((e) => e.want && e.want === e.answer).length;
  const evalNote = document.getElementById("evalNote");
  evalNote.textContent = n
    ? `${n} labelled · model agrees on ${agree}/${n}`
    : "Nothing labelled yet. Mark verdicts right or wrong to build an eval set.";
  document.getElementById("exportEval").disabled = n === 0;
  document.getElementById("copyEval").disabled = n === 0;
}

// One bucket per cause, so repeated reasons with different confidences group.
function hiddenCause(e) {
  if (e.junkRule) return `rule: ${e.junkRule}`;
  const r = e.reason || "";
  if (r.startsWith("avoid: ")) return r;
  if (r.startsWith("gate: ")) return `kind: ${r.slice(6).replace(/ \([\d.]+\)$/, "")}`;
  return "no topic match";
}

function tally(keys) {
  const counts = new Map();
  for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);
  const rows = [...counts].sort((a, b) => b[1] - a[1]);
  return rows.length
    ? rows.map(([k, n]) => `<li><span>${escapeHtml(k)}</span><span>${n}</span></li>`).join("")
    : '<li><span class="latency">None yet</span></li>';
}

function renderBreakdown() {
  document.getElementById("hiddenWhy").innerHTML = tally(entries.filter((e) => e.hidden).map(hiddenCause));
  document.getElementById("shownTopics").innerHTML = tally(entries.filter((e) => !e.hidden).map((e) => e.reason || "?"));
}

function render() {
  renderStats();
  renderBreakdown();
  const list = document.getElementById("list");
  const empty = document.getElementById("empty");
  if (!entries.length) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = entries
    .map((e, i) => {
      const isYes = e.answer === "YES";
      const time = new Date(e.t).toLocaleTimeString();
      const preview = e.text ? e.text.split("\n")[0] : "";
      const verdictLabel = e.junkRule ? "RULE" : isYes ? "SHOW" : "HIDE";
      const wrong = e.want && e.want !== e.answer;
      const right = e.want && e.want === e.answer;
      return `
        <div class="row ${wrong ? "flagged" : ""}" data-i="${i}">
          <div class="summary">
            <div class="badge ${isYes ? "yes" : "no"}">${verdictLabel}</div>
            <div class="body">
              <div class="text">${escapeHtml(preview)}</div>
              <div class="reason">${escapeHtml(e.reason || "")} <span class="latency">· ${e.latencyMs ?? 0}ms</span></div>
            </div>
            <div class="judge">
              <button class="mark ${right ? "on" : ""}" data-mark="right" data-i="${i}" title="Verdict was right">✓</button>
              <button class="mark ${wrong ? "on" : ""}" data-mark="wrong" data-i="${i}" title="Verdict was wrong">✗</button>
            </div>
            <div class="time">${time}</div>
          </div>
          <div class="trace">
            ${e.want ? `<h3>Your label</h3><pre>want ${escapeHtml(e.want)} (model said ${escapeHtml(e.answer)})</pre>` : ""}
            ${e.junkRule ? `<h3>Junk rule</h3><pre>${escapeHtml(e.junkRule)}: hidden without a model call</pre>` : ""}
            <h3>Your topics at the time</h3>
            <pre>${escapeHtml(e.interests || "")}</pre>
            <h3>Questions asked</h3>
            <pre>${escapeHtml(e.systemPrompt || "")}</pre>
            <h3>Post text sent to model</h3>
            <pre>${escapeHtml(e.text || "")}</pre>
            <h3>Model answers</h3>
            <pre>${escapeHtml(e.rawOutput || "")}</pre>
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll(".summary").forEach((el) => {
    el.addEventListener("click", (ev) => {
      if (ev.target.closest(".judge")) return; // labelling shouldn't expand
      el.closest(".row").classList.toggle("open");
    });
  });

  list.querySelectorAll(".mark").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = Number(btn.dataset.i);
      const entry = entries[i];
      if (!entry) return;
      const wanted = btn.dataset.mark === "right" ? entry.answer : opposite(entry.answer);
      // Clicking the same judgement again clears it.
      entry.want = entry.want === wanted ? undefined : wanted;
      await ext.storage.local.set({ lifLog: entries });
      render();
    });
  });
}

// Eval cases in the shape src/bench-corpus.js uses, so they can be dropped
// straight into the harness.
function buildEvalSet() {
  return entries
    .filter((e) => e.want)
    .map((e, i) => ({
      label: `log-${new Date(e.t).toISOString().slice(0, 16).replace(/[:T]/g, "")}-${i}`,
      want: e.want,
      interests: e.interests,
      text: e.text,
      wasAnswer: e.answer,
      wasJunkRule: e.junkRule || null,
    }));
}

function download(name, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function load() {
  const { lifLog } = await ext.storage.local.get({ lifLog: [] });
  entries = lifLog;
  render();
}

ext.storage.onChanged.addListener((changes) => {
  if (changes.lifLog) {
    entries = changes.lifLog.newValue || [];
    render();
  }
});

document.getElementById("clear").addEventListener("click", async () => {
  await ext.storage.local.set({ lifLog: [] });
});

document.getElementById("exportEval").addEventListener("click", () => {
  download("corpus-extra.json", JSON.stringify(buildEvalSet(), null, 2));
});

document.getElementById("copyEval").addEventListener("click", async () => {
  const text = JSON.stringify(buildEvalSet(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    document.getElementById("evalNote").textContent = "Copied eval set to clipboard.";
  } catch {
    document.getElementById("evalNote").textContent = "The browser blocked the clipboard. Use Export instead.";
  }
});

load();
