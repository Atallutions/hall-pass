/* global browser, normalizeSiteInput, formatHM, getFocusEndDate, getCurrentSessionPhase, normalizeSessionSettings, findBlockedSiteMatch, isSiteUnlocked, getUnlockExpiry, MAX_UNLOCKS_PER_DAY, getUnlocksRemainingToday */
"use strict";

const statusBadge = document.getElementById("status-badge");
const statusLabel = document.getElementById("status-label");
const statusDetail = document.getElementById("status-detail");
const currentSiteChip = document.getElementById("current-site-chip");
const currentSiteName = document.getElementById("current-site-name");
const currentSiteDetail = document.getElementById("current-site-detail");
const unlockBtn = document.getElementById("unlock-btn");
const allowance = document.getElementById("allowance");
const allowancePips = document.getElementById("allowance-pips");
const allowanceText = document.getElementById("allowance-text");
const unlockTimer = document.getElementById("unlock-timer");
const openOptionsBtn = document.getElementById("open-options-btn");
const addSiteBtn = document.getElementById("add-site-btn");
const accessWarning = document.getElementById("access-warning");
const grantAccessBtn = document.getElementById("grant-access-btn");
const sessionCard = document.getElementById("session-card");
const sessionRound = document.getElementById("session-round");
const sessionClock = document.getElementById("session-clock");
const sessionPhase = document.getElementById("session-phase");
const sessionTimer = document.getElementById("session-timer");
const sessionDetail = document.getElementById("session-detail");
const startSessionBtn = document.getElementById("start-session-btn");
const endSessionBtn = document.getElementById("end-session-btn");
const BLOCKED_PAGE_URL = browser.runtime.getURL("blocked/blocked.html");

let currentMatchedSite = null;
let currentHostname = null;
let currentState = null;
let currentSiteWasUnlocked = false;
let currentPhaseEnd = 0;

function currentTabHostname() {
  return browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url) return null;
    try {
      const url = new URL(tab.url);
      // On our own block page, report the site it's blocking.
      if (tab.url.startsWith(BLOCKED_PAGE_URL)) return url.searchParams.get("site");
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return url.hostname;
    } catch (e) {
      return null;
    }
  });
}

function updateUnlockTimer(now) {
  const remaining = getUnlockExpiry(currentState, currentMatchedSite) - now.getTime();
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);
  unlockTimer.textContent = `${mm}:${ss.toString().padStart(2, "0")}`;
}

function formatCountdown(ms) {
  const totalSeconds = Math.max(Math.ceil(ms / 1000), 0);
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

// Ticks the session clock and this tab's unlock timer; when either runs out, re-render.
setInterval(() => {
  const now = new Date();
  if (currentPhaseEnd) {
    if (now.getTime() >= currentPhaseEnd) {
      currentPhaseEnd = 0;
      refresh();
      return;
    }
    sessionTimer.textContent = formatCountdown(currentPhaseEnd - now.getTime());
  }
  if (!currentSiteWasUnlocked) return;
  if (isSiteUnlocked(currentState, currentMatchedSite, now)) {
    updateUnlockTimer(now);
  } else {
    currentSiteWasUnlocked = false;
    refresh();
  }
}, 1000);

function renderSession(state, now) {
  const sessionsMode = state.mode === "sessions";
  sessionCard.hidden = !sessionsMode;
  currentPhaseEnd = 0;
  if (!sessionsMode) return;

  const phase = getCurrentSessionPhase(state, now);
  const settings = phase ? state.session : normalizeSessionSettings(state.sessionSettings);
  const rhythm = `${settings.focusMinutes} min sessions, ${settings.breakMinutes} min breaks`;
  sessionClock.hidden = !phase;
  startSessionBtn.hidden = Boolean(phase);
  endSessionBtn.hidden = !phase;
  if (!phase) {
    sessionRound.textContent = "";
    sessionDetail.textContent = `${rhythm}. They repeat until you end them.`;
    startSessionBtn.textContent = `Start a ${settings.focusMinutes}-minute session`;
    return;
  }
  currentPhaseEnd = phase.endsAt;
  sessionRound.textContent = `Session ${phase.round}`;
  sessionClock.className = `session-clock ${phase.phase}`;
  sessionPhase.textContent = phase.phase === "focus" ? "Focus" : "Break";
  sessionTimer.textContent = formatCountdown(phase.endsAt - now.getTime());
  sessionDetail.textContent =
    phase.phase === "focus"
      ? `Break at ${formatHM(new Date(phase.endsAt))}. ${rhythm}.`
      : `Sites are open. Session ${phase.round + 1} starts at ${formatHM(new Date(phase.endsAt))}.`;
}

function setChip(text, variant) {
  currentSiteChip.hidden = !text;
  currentSiteChip.textContent = text || "";
  currentSiteChip.className = `chip chip-${variant}`;
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
      : "No passes left today";
}

async function render(status, hostname) {
  const { state, blockingActive } = status;
  const now = new Date(status.now);

  currentMatchedSite = hostname ? findBlockedSiteMatch(state.blockedSites, hostname) : null;
  currentHostname = hostname;
  currentState = state;
  currentSiteWasUnlocked = false;
  accessWarning.hidden = status.hostAccess !== false;

  renderSession(state, now);
  const sessionsMode = state.mode === "sessions";
  const phase = getCurrentSessionPhase(state, now);
  if (blockingActive) {
    statusBadge.className = "pill pill-on";
    statusLabel.textContent = sessionsMode ? "Focus" : "Blocking";
    const until = getFocusEndDate(state, now);
    // The session card already says when the break starts.
    statusDetail.textContent = until && !sessionsMode ? `Sites stay blocked until ${formatHM(until)}.` : "";
  } else if (phase) {
    statusBadge.className = "pill pill-off";
    statusLabel.textContent = "Break";
    statusDetail.textContent = "";
  } else {
    statusBadge.className = sessionsMode ? "pill pill-idle" : "pill pill-off";
    statusLabel.textContent = "Off";
    statusDetail.textContent = sessionsMode
      ? "No session running. Sites load normally."
      : "No schedule is active. Sites load normally.";
  }

  addSiteBtn.hidden = true;
  unlockBtn.hidden = true;
  allowance.hidden = true;
  unlockTimer.hidden = true;
  currentSiteName.hidden = !hostname;
  currentSiteName.textContent = currentMatchedSite || hostname || "";

  if (!hostname) {
    setChip(null);
    currentSiteDetail.textContent = "This page can't be blocked.";
    return;
  }

  if (!currentMatchedSite) {
    setChip("Allowed", "neutral");
    currentSiteDetail.textContent = "Not on your blocked list.";
    addSiteBtn.hidden = false;
    return;
  }

  if (!blockingActive) {
    if (phase) {
      setChip("Break", "neutral");
      currentSiteDetail.textContent = "On your list. It opens during breaks.";
    } else if (sessionsMode) {
      setChip("No session", "neutral");
      currentSiteDetail.textContent = "On your list. It's blocked while a session runs.";
    } else {
      setChip("Off schedule", "neutral");
      currentSiteDetail.textContent = "On your list, but no schedule is active right now.";
    }
    return;
  }

  const remaining = getUnlocksRemainingToday(state, currentMatchedSite, now);
  renderAllowance(remaining);

  if (isSiteUnlocked(state, currentMatchedSite, now)) {
    setChip("Temporarily unlocked", "unlocked");
    currentSiteDetail.textContent = "";
    currentSiteWasUnlocked = true;
    unlockTimer.hidden = false;
    updateUnlockTimer(now);
    return;
  }

  setChip("Blocked", "blocked");
  if (remaining > 0) {
    currentSiteDetail.textContent = sessionsMode ? "Blocked during this session." : "Blocked by your schedule.";
    unlockBtn.hidden = false;
  } else {
    currentSiteDetail.textContent = sessionsMode
      ? "Blocked until the break. Passes reset at midnight."
      : "Blocked until the schedule ends. Passes reset at midnight.";
  }
}

async function refresh() {
  const [status, hostname] = await Promise.all([
    browser.runtime.sendMessage({ type: "getStatus" }),
    currentTabHostname(),
  ]);
  await render(status, hostname);
}

unlockBtn.addEventListener("click", async () => {
  if (!currentMatchedSite) return;
  unlockBtn.disabled = true;
  try {
    await browser.runtime.sendMessage({ type: "requestUnlock", site: currentMatchedSite });
    await refresh();
  } finally {
    unlockBtn.disabled = false;
  }
});

addSiteBtn.addEventListener("click", async () => {
  const site = normalizeSiteInput(currentHostname);
  if (!site) return;
  addSiteBtn.disabled = true;
  try {
    const { blockedSites } = await browser.storage.local.get({ blockedSites: [] });
    if (!blockedSites.includes(site)) {
      blockedSites.push(site);
      blockedSites.sort();
      await browser.storage.local.set({ blockedSites });
    }
    const status = await browser.runtime.sendMessage({ type: "getStatus" });
    // Reload so the page is actually blocked now instead of on the next navigation.
    if (status.blockingActive) await browser.tabs.reload();
    await refresh();
  } finally {
    addSiteBtn.disabled = false;
  }
});

startSessionBtn.addEventListener("click", async () => {
  startSessionBtn.disabled = true;
  try {
    await browser.runtime.sendMessage({ type: "startSession" });
    await refresh();
  } finally {
    startSessionBtn.disabled = false;
  }
});

endSessionBtn.addEventListener("click", async () => {
  endSessionBtn.disabled = true;
  try {
    await browser.runtime.sendMessage({ type: "endSession" });
    await refresh();
  } finally {
    endSessionBtn.disabled = false;
  }
});

grantAccessBtn.addEventListener("click", async () => {
  // Must run straight from the click; the browser shows its own permission prompt.
  await browser.permissions.request({ origins: ["<all_urls>"] });
  await refresh();
});

openOptionsBtn.addEventListener("click", () => {
  browser.runtime.openOptionsPage();
});

refresh();
