// Shared helpers used by background.js and the UI pages.
// Loaded as a plain script (no modules) so it can be included via <script> tags too.

// Chrome only has the `chrome` namespace; its MV3 APIs return promises like Firefox's `browser`.
if (typeof globalThis.browser === "undefined" && typeof globalThis.chrome !== "undefined") {
  globalThis.browser = globalThis.chrome;
}

const MAX_UNLOCK_MINUTES = 5;
const MAX_UNLOCKS_PER_DAY = 6;

// Lengths a session and its break can have, in minutes. The background script only starts sessions
// with these, whatever is in storage.
const SESSION_FOCUS_OPTIONS = [20, 30, 45];
const SESSION_BREAK_OPTIONS = [5, 10, 15];

const DEFAULT_STATE = {
  // "schedules": blocking follows the clock. "sessions": it follows a session you start, which
  // alternates focus and breaks until you end it.
  mode: "schedules",
  sessionSettings: { focusMinutes: 30, breakMinutes: 5 },
  session: null, // { startedAt, focusMinutes, breakMinutes } while one is running
  blockedSites: [], // e.g. ["facebook.com", "youtube.com"]
  // { id, label, days:[0-6] (0=Sun), start:"HH:MM", end:"HH:MM", enabled:true }
  // Only used until schedules are first saved; deleting both leaves an empty list, not these.
  schedules: [
    { id: "default-morning", label: "Morning", days: [1, 2, 3, 4, 5], start: "09:00", end: "13:00", enabled: true },
    { id: "default-afternoon", label: "Afternoon", days: [1, 2, 3, 4, 5], start: "14:00", end: "18:00", enabled: true },
  ],
  // { id, name } in display order. Categories only group sites on the settings page; every site
  // follows the same schedules. Like schedules, only used until first saved.
  categories: [
    { id: "news", name: "News" },
    { id: "gambling", name: "Gambling" },
    { id: "social", name: "Social networks" },
    { id: "entertainment", name: "Entertainment" },
    { id: "shopping", name: "Shopping" },
  ],
  siteCategories: {}, // { [normalizedSite]: categoryId }; a site without one is "Uncategorized"
  unlocks: {}, // { [normalizedSite]: expiryEpochMs } — one independent unlock timer per site
  unlockUsage: { day: "", counts: {} }, // { day:"YYYY-MM-DD", counts:{ [normalizedSite]: n } } — only today's counts are kept
};

function normalizeHost(host) {
  return String(host || "").replace(/^www\./i, "").toLowerCase();
}

function normalizeSiteInput(raw) {
  let value = String(raw || "").trim().toLowerCase();
  if (!value) return "";
  // Allow pasting a full URL; extract just the hostname.
  if (value.includes("://")) {
    try {
      value = new URL(value).hostname;
    } catch (e) {
      // fall through, keep raw value
    }
  } else {
    value = value.split("/")[0];
  }
  return normalizeHost(value);
}

function hostMatchesSite(host, site) {
  const h = normalizeHost(host);
  const s = normalizeHost(site);
  if (!h || !s) return false;
  return h === s || h.endsWith("." + s);
}

// Which entry in blockedSites (if any) covers this host? e.g. "www.facebook.com" -> "facebook.com".
// Unlocks are keyed by this canonical entry so a subdomain visit unlocks the whole site.
function findBlockedSiteMatch(blockedSites, host) {
  return (blockedSites || []).find((site) => hostMatchesSite(host, site)) || null;
}

// The id of the category a site is in, or null if it has none or its category was removed.
function getSiteCategoryId(state, site) {
  const id = (state.siteCategories || {})[normalizeHost(site)];
  return (state.categories || []).some((c) => c.id === id) ? id : null;
}

// Blocked sites in a category, in list order; null gives the uncategorized ones.
function getSitesInCategory(state, categoryId) {
  return (state.blockedSites || []).filter((site) => getSiteCategoryId(state, site) === categoryId);
}

function parseHM(hm) {
  const [h, m] = String(hm).split(":").map(Number);
  return h * 60 + m;
}

function formatHM(date) {
  return date.getHours().toString().padStart(2, "0") + ":" + date.getMinutes().toString().padStart(2, "0");
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Is this schedule currently active, given `now`? Handles windows that wrap past midnight.
function isScheduleActive(schedule, now) {
  if (!schedule || schedule.enabled === false) return false;
  if (!Array.isArray(schedule.days) || schedule.days.length === 0) return false;

  const day = now.getDay();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const start = parseHM(schedule.start);
  const end = parseHM(schedule.end);
  if (Number.isNaN(start) || Number.isNaN(end) || start === end) return false;

  if (start < end) {
    return schedule.days.includes(day) && nowMinutes >= start && nowMinutes < end;
  }

  // Window wraps midnight (e.g. 22:00 -> 06:00).
  const prevDay = (day + 6) % 7;
  const activeFromToday = schedule.days.includes(day) && nowMinutes >= start;
  const activeFromYesterday = schedule.days.includes(prevDay) && nowMinutes < end;
  return activeFromToday || activeFromYesterday;
}

function getActiveSchedules(schedules, now) {
  return (schedules || []).filter((s) => isScheduleActive(s, now));
}

function getBlockUntilDate(schedules, now) {
  const horizon = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  let until = getLatestActiveEnd(schedules, now);
  while (until) {
    const next = getLatestActiveEnd(schedules, until);
    if (!next) return until;
    if (next.getTime() > horizon) return null;
    until = next;
  }
  return null;
}

function getLatestActiveEnd(schedules, now) {
  let latest = null;
  for (const schedule of getActiveSchedules(schedules, now)) {
    const end = parseHM(schedule.end);
    const start = parseHM(schedule.start);
    const wraps = start >= end;
    const endDate = new Date(now);
    endDate.setHours(0, end, 0, 0);
    if (wraps && now.getHours() * 60 + now.getMinutes() >= start) {
      endDate.setDate(endDate.getDate() + 1);
    }
    if (!latest || endDate > latest) latest = endDate;
  }
  return latest;
}

function normalizeSessionSettings(settings) {
  const s = settings || {};
  return {
    focusMinutes: SESSION_FOCUS_OPTIONS.includes(s.focusMinutes) ? s.focusMinutes : DEFAULT_STATE.sessionSettings.focusMinutes,
    breakMinutes: SESSION_BREAK_OPTIONS.includes(s.breakMinutes) ? s.breakMinutes : DEFAULT_STATE.sessionSettings.breakMinutes,
  };
}

// Where a running session is at `now`: { phase: "focus" | "break", round (from 1), endsAt (epoch
// ms) }, or null if there's no session. Rounds of focus then break repeat until the session ends.
function getSessionPhase(session, now) {
  if (!session || !session.startedAt) return null;
  const focus = session.focusMinutes * 60000;
  const pause = session.breakMinutes * 60000;
  const elapsed = now.getTime() - session.startedAt;
  if (!(focus > 0) || !(pause > 0) || elapsed < 0) return null;
  const cycle = focus + pause;
  const index = Math.floor(elapsed / cycle);
  const roundStart = session.startedAt + index * cycle;
  const inFocus = elapsed - index * cycle < focus;
  return { phase: inFocus ? "focus" : "break", round: index + 1, endsAt: roundStart + (inFocus ? focus : cycle) };
}

// The running session's phase, or null in schedules mode or with no session running.
function getCurrentSessionPhase(state, now) {
  return state.mode === "sessions" ? getSessionPhase(state.session, now) : null;
}

function isBlockingActive(state, now) {
  if (state.mode === "sessions") {
    const phase = getSessionPhase(state.session, now);
    return Boolean(phase) && phase.phase === "focus";
  }
  return getActiveSchedules(state.schedules, now).length > 0;
}

// When does the current focus time end? A Date, or null when nothing is blocking.
function getFocusEndDate(state, now) {
  if (state.mode === "sessions") {
    const phase = getSessionPhase(state.session, now);
    return phase && phase.phase === "focus" ? new Date(phase.endsAt) : null;
  }
  return getBlockUntilDate(state.schedules, now);
}

// `site` should be a canonical blockedSites entry (see findBlockedSiteMatch), not a raw hostname.
function getUnlockExpiry(state, site) {
  const key = normalizeHost(site);
  return (state.unlocks && state.unlocks[key]) || 0;
}

function isSiteUnlocked(state, site, now) {
  const expiry = getUnlockExpiry(state, site);
  return Boolean(expiry) && now.getTime() < expiry;
}

// Drop expired entries so `unlocks` doesn't grow forever across long-running sessions.
function pruneExpiredUnlocks(unlocks, now) {
  const pruned = {};
  for (const [site, expiry] of Object.entries(unlocks || {})) {
    if (expiry > now.getTime()) pruned[site] = expiry;
  }
  return pruned;
}

// Not toISOString(), which gives the UTC date; passes reset at local midnight.
function dayKey(date) {
  return (
    date.getFullYear() +
    "-" +
    (date.getMonth() + 1).toString().padStart(2, "0") +
    "-" +
    date.getDate().toString().padStart(2, "0")
  );
}

function getUnlocksUsedToday(state, site, now) {
  const usage = state.unlockUsage;
  if (!usage || usage.day !== dayKey(now)) return 0;
  return (usage.counts && usage.counts[normalizeHost(site)]) || 0;
}

function getUnlocksRemainingToday(state, site, now) {
  return Math.max(MAX_UNLOCKS_PER_DAY - getUnlocksUsedToday(state, site, now), 0);
}

// Returns a new unlockUsage with one more unlock counted for `site`; a new day starts from zero.
function recordUnlock(usage, site, now) {
  const today = dayKey(now);
  const counts = usage && usage.day === today ? { ...usage.counts } : {};
  const key = normalizeHost(site);
  counts[key] = (counts[key] || 0) + 1;
  return { day: today, counts };
}

// declarativeNetRequest rejects the whole rule update if one requestDomains entry is invalid
// (e.g. "localhost:3000" or non-punycode), so skip those instead of losing every rule.
const RULE_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

function buildBlockRules(state, now, blockedPageUrl) {
  if (!isBlockingActive(state, now)) return [];
  const sites = (state.blockedSites || []).map(normalizeHost).filter((site) => RULE_DOMAIN.test(site));
  return sites.map((site, index) => {
    const rule = {
      id: index + 1,
      priority: sites.length - index,
      condition: { requestDomains: [site], resourceTypes: ["main_frame"] },
    };
    if (isSiteUnlocked(state, site, now)) {
      rule.action = { type: "allow" };
    } else {
      rule.condition.regexFilter = "^https?://.*$";
      rule.action = {
        type: "redirect",
        redirect: { regexSubstitution: blockedPageUrl + "?site=" + encodeURIComponent(site) + "#\\0" },
      };
    }
    return rule;
  });
}

function getNextRuleChange(state, now) {
  const t = now.getTime();
  const times = Object.values(state.unlocks || {});
  if (state.mode === "sessions") {
    const phase = getSessionPhase(state.session, now);
    if (phase) times.push(phase.endsAt);
  } else {
    for (const schedule of state.schedules || []) {
      if (!schedule || schedule.enabled === false) continue;
      for (const hm of [schedule.start, schedule.end]) {
        const minutes = parseHM(hm);
        if (Number.isNaN(minutes)) continue;
        const at = new Date(now);
        at.setHours(0, minutes, 0, 0);
        if (at.getTime() <= t) at.setDate(at.getDate() + 1);
        times.push(at.getTime());
      }
    }
  }
  const upcoming = times.filter((ms) => ms > t);
  return upcoming.length ? Math.min(...upcoming) : null;
}

async function loadState() {
  const state = await browser.storage.local.get(DEFAULT_STATE);
  state.sessionSettings = normalizeSessionSettings(state.sessionSettings);
  return state;
}

function onButtonClick(button, action) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await action();
    } finally {
      button.disabled = false;
    }
  });
}

function renderPips(container, filled) {
  container.replaceChildren();
  for (let i = 0; i < MAX_UNLOCKS_PER_DAY; i++) {
    const pip = document.createElement("span");
    pip.className = i < filled ? "pip filled" : "pip";
    container.appendChild(pip);
  }
}

function renderAllowance(remaining, noneLeftText) {
  const allowance = document.getElementById("allowance");
  allowance.hidden = false;
  allowance.classList.toggle("exhausted", remaining === 0);
  renderPips(document.getElementById("allowance-pips"), remaining);
  document.getElementById("allowance-text").textContent =
    remaining > 0 ? `${remaining} of ${MAX_UNLOCKS_PER_DAY} passes left today` : noneLeftText;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    MAX_UNLOCK_MINUTES,
    MAX_UNLOCKS_PER_DAY,
    SESSION_FOCUS_OPTIONS,
    SESSION_BREAK_OPTIONS,
    DEFAULT_STATE,
    normalizeHost,
    normalizeSiteInput,
    hostMatchesSite,
    findBlockedSiteMatch,
    getSiteCategoryId,
    getSitesInCategory,
    parseHM,
    formatHM,
    DAY_LABELS,
    isScheduleActive,
    getActiveSchedules,
    getBlockUntilDate,
    isBlockingActive,
    normalizeSessionSettings,
    getSessionPhase,
    getCurrentSessionPhase,
    getFocusEndDate,
    getUnlockExpiry,
    isSiteUnlocked,
    pruneExpiredUnlocks,
    dayKey,
    getUnlocksUsedToday,
    getUnlocksRemainingToday,
    recordUnlock,
    buildBlockRules,
    getNextRuleChange,
  };
}
