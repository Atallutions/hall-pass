/* global browser, importScripts, MAX_UNLOCK_MINUTES, loadState, formatHM, getCurrentSessionPhase, isBlockingActive, isSiteUnlocked, pruneExpiredUnlocks, normalizeHost, getUnlocksRemainingToday, recordUnlock, buildBlockRules, getNextRuleChange */
"use strict";

// Chrome runs this file alone as a service worker; Firefox loads common.js first via "scripts".
if (typeof importScripts === "function") importScripts("common.js");

let unlockQueue = Promise.resolve();
function serialized(fn) {
  const run = unlockQueue.then(fn);
  unlockQueue = run.catch(() => {});
  return run;
}

async function setSiteUnlock(site) {
  const key = normalizeHost(site);
  const now = new Date();
  const state = await loadState();

  if (isSiteUnlocked(state, key, now)) return {};
  if (getUnlocksRemainingToday(state, key, now) <= 0) return { error: "daily-limit-reached" };

  const unlocks = pruneExpiredUnlocks(state.unlocks, now);
  unlocks[key] = now.getTime() + MAX_UNLOCK_MINUTES * 60 * 1000;
  const unlockUsage = recordUnlock(state.unlockUsage, key, now);
  await browser.storage.local.set({ unlocks, unlockUsage });
  await syncRules();
  return {};
}

const BLOCKED_PAGE_URL = browser.runtime.getURL("blocked/blocked.html");
const NEXT_CHANGE_ALARM = "next-change";
const HEARTBEAT_ALARM = "heartbeat";

// Overlapping runs could add rule ids that already exist, which updateDynamicRules rejects.
let rulesQueue = Promise.resolve();
let waitingSync = null;
function syncRules() {
  if (!waitingSync) {
    waitingSync = rulesQueue
      .then(() => {
        waitingSync = null;
        return applyRules();
      })
      .catch((err) => {
        console.error("Hall Pass: error syncing rules", err);
      });
    rulesQueue = waitingSync;
  }
  return waitingSync;
}

async function applyRules() {
  const [state, { appliedRules = "" }] = await Promise.all([
    loadState(),
    browser.storage.session.get("appliedRules"),
  ]);
  const now = new Date();
  const rules = buildBlockRules(state, now, BLOCKED_PAGE_URL);
  // Firefox writes the rules to disk on every update, even an identical one.
  const rulesJson = JSON.stringify(rules);
  if (rulesJson !== appliedRules) {
    const existing = await browser.declarativeNetRequest.getDynamicRules();
    await browser.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((rule) => rule.id),
      addRules: rules,
    });
    await browser.storage.session.set({ appliedRules: rulesJson });
  }

  const next = getNextRuleChange(state, now);
  if (next) {
    await browser.alarms.create(NEXT_CHANGE_ALARM, { when: next });
  } else {
    await browser.alarms.clear(NEXT_CHANGE_ALARM);
  }
  // The heartbeat covers an alarm that fires late or a change of the system clock.
  // Creating an alarm that already exists restarts its period.
  if (!(await browser.alarms.get(HEARTBEAT_ALARM))) {
    await browser.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  }
  updateBadge(state, now);
  await announceSessionPhase(state, now);
}

async function announceSessionPhase(state, now) {
  const phase = getCurrentSessionPhase(state, now);
  const key = phase ? `${state.session.startedAt}:${phase.round}:${phase.phase}` : "";
  // storage.session outlives this script, which the browser stops when idle.
  const { seenPhase = "" } = await browser.storage.session.get("seenPhase");
  if (key === seenPhase) return;
  await browser.storage.session.set({ seenPhase: key });
  // You just started the first phase yourself; only changes after that are news.
  if (!phase || !seenPhase.startsWith(`${state.session.startedAt}:`)) return;

  const until = formatHM(new Date(phase.endsAt));
  const notice =
    phase.phase === "break"
      ? { title: "Break time", message: `Your sites are open until ${until}. The next session starts then.` }
      : { title: `Session ${phase.round} started`, message: `Your sites are blocked until ${until}.` };
  browser.notifications.create("session-phase", {
    type: "basic",
    iconUrl: browser.runtime.getURL("icons/icon-128.png"),
    ...notice,
  });
}

// Without host access the redirect rules do nothing. Firefox and Chrome both let users revoke it.
function hasHostAccess() {
  return browser.permissions.contains({ origins: ["<all_urls>"] });
}

const messageHandlers = {
  async requestUnlock(msg) {
    if (!msg.site) throw new Error("requestUnlock requires a site");
    return serialized(() => setSiteUnlock(msg.site));
  },
  async startSession() {
    const state = await loadState();
    if (state.mode !== "sessions") throw new Error("Sessions and breaks mode is off");
    if (state.session) return {};
    await browser.storage.local.set({ session: { startedAt: Date.now(), ...state.sessionSettings } });
    await syncRules();
    return {};
  },
  async endSession() {
    await browser.storage.local.set({ session: null });
    await syncRules();
    return {};
  },
  async getStatus() {
    await syncRules();
    const [state, hostAccess] = await Promise.all([loadState(), hasHostAccess()]);
    const now = new Date();
    return { state, now: now.getTime(), blockingActive: isBlockingActive(state, now), hostAccess };
  },
};

// Answer through sendResponse; Chrome doesn't use a promise returned from this listener.
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !Object.hasOwn(messageHandlers, msg.type)) return false;
  const handler = messageHandlers[msg.type];
  handler(msg).then(sendResponse, (err) => {
    console.error("Hall Pass: error handling message", msg.type, err);
    sendResponse({ error: err.message });
  });
  return true;
});

// "ON" during a schedule. During a session, the minutes left in the phase, red for focus and green
// for a break; the heartbeat keeps it within a minute.
function updateBadge(state, now) {
  const phase = getCurrentSessionPhase(state, now);
  let text = isBlockingActive(state, now) ? "ON" : "";
  // Dark enough for white text; left alone, Chrome draws black text on a light red.
  let color = "#b3261e";
  if (phase) {
    text = `${Math.ceil((phase.endsAt - now.getTime()) / 60000)}m`;
    if (phase.phase === "break") color = "#1e7e34";
  }
  browser.action.setBadgeText({ text });
  if (!text) return;
  browser.action.setBadgeBackgroundColor({ color });
  if (browser.action.setBadgeTextColor) browser.action.setBadgeTextColor({ color: "#ffffff" });
}

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") syncRules();
});
browser.alarms.onAlarm.addListener(() => syncRules());
// Closing the browser ends a session, so one from yesterday isn't still running today. Registered
// at the top level, which also makes Chrome start the service worker with the browser.
browser.runtime.onStartup.addListener(async () => {
  await browser.storage.local.set({ session: null });
  syncRules();
});
// Open the settings page, on its welcome tab, after a first install.
browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") browser.runtime.openOptionsPage();
});

syncRules();
