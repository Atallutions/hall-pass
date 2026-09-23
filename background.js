/* global browser, importScripts, DEFAULT_STATE, formatHM, normalizeSessionSettings, getCurrentSessionPhase, isBlockingActive, isSiteUnlocked, getUnlockExpiry, pruneExpiredUnlocks, clampUnlockMinutes, normalizeHost, getUnlocksRemainingToday, recordUnlock, buildBlockRules, getNextRuleChange */
"use strict";

// Chrome runs this file alone as a service worker; Firefox loads common.js first via "scripts".
if (typeof importScripts === "function") importScripts("common.js");

async function getState() {
  return browser.storage.local.get(DEFAULT_STATE);
}

// Unlock state is read-modify-write; run those updates one at a time so two quick
// requests can't both read the same count and slip past the daily limit.
let unlockQueue = Promise.resolve();
function serialized(fn) {
  const run = unlockQueue.then(fn);
  unlockQueue = run.catch(() => {});
  return run;
}

async function setSiteUnlock(site, minutes) {
  const key = normalizeHost(site);
  const clamped = clampUnlockMinutes(minutes);
  const now = new Date();
  const state = await getState();

  // Already open: don't extend the timer or spend another unlock.
  if (isSiteUnlocked(state, key, now)) {
    return { expiry: getUnlockExpiry(state, key), remaining: getUnlocksRemainingToday(state, key, now) };
  }
  if (getUnlocksRemainingToday(state, key, now) <= 0) {
    return { error: "daily-limit-reached", remaining: 0 };
  }

  const unlocks = pruneExpiredUnlocks(state.unlocks, now);
  const expiry = now.getTime() + clamped * 60 * 1000;
  unlocks[key] = expiry;
  const unlockUsage = recordUnlock(state.unlockUsage, key, now);
  await browser.storage.local.set({ unlocks, unlockUsage });
  // Wait for the new rules, so a caller that navigates next isn't sent back to the block page.
  await syncRules();
  return { expiry, remaining: getUnlocksRemainingToday({ unlockUsage }, key, now) };
}

// Blocking is done by declarativeNetRequest rules (see buildBlockRules), not by this script, which
// Chrome and Firefox stop when idle. Every change that can affect the rules calls syncRules:
// storage changes, the alarm at the next schedule boundary or unlock expiry, startup, and a
// once-a-minute heartbeat in case an alarm is late or the clock changes.
const BLOCKED_PAGE_URL = browser.runtime.getURL("blocked/blocked.html");
const NEXT_CHANGE_ALARM = "next-change";
const HEARTBEAT_ALARM = "heartbeat";

// updateDynamicRules must not interleave: two runs could both remove the same old rules and
// then add rules with the same ids.
let rulesQueue = Promise.resolve();
function syncRules() {
  rulesQueue = rulesQueue.then(applyRules).catch((err) => {
    console.error("Hall Pass: error syncing rules", err);
  });
  return rulesQueue;
}

async function applyRules() {
  const state = await getState();
  const now = new Date();
  const existing = await browser.declarativeNetRequest.getDynamicRules();
  await browser.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: buildBlockRules(state, now, BLOCKED_PAGE_URL),
  });

  const next = getNextRuleChange(state, now);
  if (next) {
    await browser.alarms.create(NEXT_CHANGE_ALARM, { when: next });
  } else {
    await browser.alarms.clear(NEXT_CHANGE_ALARM);
  }
  // Re-creating an existing periodic alarm would restart its period on every run.
  if (!(await browser.alarms.get(HEARTBEAT_ALARM))) {
    await browser.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
  }
  updateBadge(state, now);
  await announceSessionPhase(state, now);
}

// Sessions: one notification when a break starts and one when the next round starts. The last
// phase announced is kept in storage.session, which survives this script being stopped but not
// a browser restart (and a restart ends the session anyway).
async function announceSessionPhase(state, now) {
  const phase = getCurrentSessionPhase(state, now);
  const key = phase ? `${state.session.startedAt}:${phase.round}:${phase.phase}` : "";
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
    return serialized(() => setSiteUnlock(msg.site, msg.minutes));
  },
  // The lengths come from the settings, limited to the allowed options, never from the message.
  async startSession() {
    const state = await getState();
    if (state.mode !== "sessions") throw new Error("Sessions and breaks mode is off");
    if (state.session) return { session: state.session };
    const session = { startedAt: Date.now(), ...normalizeSessionSettings(state.sessionSettings) };
    await browser.storage.local.set({ session });
    await syncRules();
    return { session };
  },
  async endSession() {
    await browser.storage.local.set({ session: null });
    await syncRules();
    return {};
  },
  async getStatus() {
    // Also repairs stale rules, e.g. when the block page opens just after a schedule ended.
    await syncRules();
    const [state, hostAccess] = await Promise.all([getState(), hasHostAccess()]);
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
