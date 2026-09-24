/* global browser, formatHM, getFocusEndDate, getActiveSchedules, getCurrentSessionPhase, getNextRuleChange, getUnlocksRemainingToday, renderAllowance */
"use strict";

const params = new URLSearchParams(location.search);
const site = params.get("site") || "This site";
const from = originalUrl();

// The block rule appends the blocked URL after "#" (see buildBlockRules). Any site can link to this
// page, so only follow http(s) URLs.
function originalUrl() {
  try {
    const url = new URL(location.hash.slice(1));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch (e) {
    return "";
  }
}

const icon = document.getElementById("icon");
const shackle = document.getElementById("shackle");
const eyebrow = document.getElementById("eyebrow");
const headlineSuffix = document.getElementById("headline-suffix");
const scheduleLabel = document.getElementById("schedule-label");
const reopen = document.getElementById("reopen");
const reopenTime = document.getElementById("reopen-time");
const reopenIn = document.getElementById("reopen-in");
const closeBtn = document.getElementById("close-btn");
const continueBtn = document.getElementById("continue-btn");
const unlockBtn = document.getElementById("unlock-btn");
const allowance = document.getElementById("allowance");

document.title = `${site} is blocked`;
document.getElementById("site-name").textContent = site;
continueBtn.textContent = `Continue to ${site}`;

const LOCKED_SHACKLE = shackle.getAttribute("d");
const OPEN_SHACKLE = "M8 11V7a4 4 0 0 1 7.75-1.4";
const UNLOCK_LABEL = unlockBtn.textContent;

let reopenAt = null;
let nextChange = null;

function formatTimeLeft(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes <= 1) return "in less than a minute";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `in ${m} min`;
  return m === 0 ? `in ${h} h` : `in ${h} h ${m} min`;
}

function renderPasses(remaining) {
  renderAllowance(remaining, "Resets at midnight");
  unlockBtn.disabled = remaining === 0;
  unlockBtn.textContent = remaining === 0 ? "No passes left today" : UNLOCK_LABEL;
}

async function render() {
  const status = await browser.runtime.sendMessage({ type: "getStatus" });
  const now = new Date(status.now);
  const phase = getCurrentSessionPhase(status.state, now);
  const ended = !status.blockingActive;
  nextChange = getNextRuleChange(status.state, now);

  icon.classList.toggle("ended", ended);
  shackle.setAttribute("d", ended ? OPEN_SHACKLE : LOCKED_SHACKLE);
  eyebrow.textContent = !ended ? "Focus time" : phase ? "Break time" : "Focus time is over";
  headlineSuffix.textContent = ended ? "is available again" : "is blocked";
  closeBtn.hidden = ended;
  unlockBtn.hidden = ended;
  continueBtn.hidden = !ended || !from;

  const labels = ended
    ? []
    : phase
      ? [`Session ${phase.round}`]
      : getActiveSchedules(status.state.schedules, now).map((s) => s.label).filter(Boolean);
  scheduleLabel.hidden = labels.length === 0;
  scheduleLabel.textContent = labels.join(" · ");

  reopenAt = getFocusEndDate(status.state, now);
  reopen.hidden = !reopenAt;
  if (reopenAt) {
    reopenTime.textContent = formatHM(reopenAt);
    reopenIn.textContent = formatTimeLeft(reopenAt - now);
  }

  if (ended) allowance.hidden = true;
  else renderPasses(getUnlocksRemainingToday(status.state, site, now));
}

setInterval(() => {
  if (nextChange && Date.now() >= nextChange) {
    nextChange = null;
    render();
  } else if (reopenAt) {
    reopenIn.textContent = formatTimeLeft(reopenAt - Date.now());
  }
}, 15 * 1000);

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.mode || changes.session || changes.schedules)) render();
});

closeBtn.addEventListener("click", async () => {
  const tab = await browser.tabs.getCurrent();
  if (tab) browser.tabs.remove(tab.id);
});

continueBtn.addEventListener("click", () => {
  location.replace(from);
});

unlockBtn.addEventListener("click", async () => {
  unlockBtn.disabled = true;
  unlockBtn.textContent = "Using a pass…";
  const result = await browser.runtime.sendMessage({ type: "requestUnlock", site });
  if (result && result.error) {
    renderPasses(0);
    return;
  }
  if (from) {
    location.replace(from);
  } else {
    unlockBtn.textContent = "Pass in use. You can navigate away now.";
  }
});

render();
