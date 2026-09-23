/* global browser, formatHM, getFocusEndDate, getActiveSchedules, getCurrentSessionPhase, getUnlocksRemainingToday, MAX_UNLOCKS_PER_DAY */
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
const allowancePips = document.getElementById("allowance-pips");
const allowanceText = document.getElementById("allowance-text");

document.title = `${site} is blocked`;
document.getElementById("site-name").textContent = site;
continueBtn.textContent = `Continue to ${site}`;

let reopenAt = null;

function formatTimeLeft(ms) {
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes <= 1) return "in less than a minute";
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `in ${m} min`;
  return m === 0 ? `in ${h} h` : `in ${h} h ${m} min`;
}

function renderAllowance(remaining) {
  allowance.hidden = false;
  allowancePips.innerHTML = "";
  for (let i = 0; i < MAX_UNLOCKS_PER_DAY; i++) {
    const pip = document.createElement("span");
    pip.className = i < remaining ? "pip left" : "pip";
    allowancePips.appendChild(pip);
  }
  allowance.classList.toggle("exhausted", remaining === 0);
  allowanceText.textContent =
    remaining > 0
      ? `${remaining} of ${MAX_UNLOCKS_PER_DAY} passes left today`
      : "Resets at midnight";
  if (remaining === 0) {
    unlockBtn.disabled = true;
    unlockBtn.textContent = "No passes left today";
  }
}

// Focus time can end while this page is open; offer the way through instead of a stale countdown.
function renderEnded(onBreak) {
  reopenAt = null;
  icon.classList.add("ended");
  document.getElementById("shackle").setAttribute("d", "M8 11V7a4 4 0 0 1 7.75-1.4");
  eyebrow.textContent = onBreak ? "Break time" : "Focus time is over";
  headlineSuffix.textContent = "is available again";
  scheduleLabel.hidden = true;
  reopen.hidden = true;
  allowance.hidden = true;
  unlockBtn.hidden = true;
  closeBtn.hidden = true;
  continueBtn.hidden = !from;
}

async function render() {
  const status = await browser.runtime.sendMessage({ type: "getStatus" });
  const now = new Date(status.now);
  const phase = getCurrentSessionPhase(status.state, now);
  if (!status.blockingActive) {
    renderEnded(Boolean(phase));
    return;
  }

  const labels = phase
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

  renderAllowance(getUnlocksRemainingToday(status.state, site, now));
}

setInterval(() => {
  if (!reopenAt) return;
  const left = reopenAt - Date.now();
  if (left <= 0) {
    render(); // another schedule may start right away, so ask rather than assume it's over
  } else {
    reopenIn.textContent = formatTimeLeft(left);
  }
}, 15 * 1000);

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
    renderAllowance(0);
    return;
  }
  if (from) {
    location.replace(from);
  } else {
    unlockBtn.textContent = "Pass in use. You can navigate away now.";
  }
});

render();
