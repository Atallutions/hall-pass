"use strict";

const assert = require("assert");
const {
  hostMatchesSite,
  findBlockedSiteMatch,
  normalizeSiteInput,
  isScheduleActive,
  getBlockUntilDate,
  isBlockingActive,
  isSiteUnlocked,
  pruneExpiredUnlocks,
  MAX_UNLOCKS_PER_DAY,
  dayKey,
  getUnlocksUsedToday,
  getUnlocksRemainingToday,
  recordUnlock,
  DEFAULT_STATE,
  buildBlockRules,
  getNextRuleChange,
  getSiteCategoryId,
  getSitesInCategory,
  normalizeSessionSettings,
  getSessionPhase,
  getCurrentSessionPhase,
  getFocusEndDate,
} = require("../common.js");

function at(hhmm, dayOffsetFromThursday = 0) {
  // Reference Thursday 2026-09-17 (a known Thursday) + offset days, at hh:mm local time.
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(2026, 8, 17 + dayOffsetFromThursday, h, m, 0, 0);
  return d;
}

let failures = 0;
function check(name, actual, expected) {
  try {
    assert.deepStrictEqual(actual, expected);
    console.log(`ok - ${name}`);
  } catch (e) {
    failures++;
    console.error(`FAIL - ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// --- host matching ---
check("exact host match", hostMatchesSite("facebook.com", "facebook.com"), true);
check("subdomain matches", hostMatchesSite("www.facebook.com", "facebook.com"), true);
check("unrelated host does not match", hostMatchesSite("notfacebook.com", "facebook.com"), false);
check("sibling suffix does not falsely match", hostMatchesSite("evilfacebook.com", "facebook.com"), false);

check("normalizeSiteInput strips protocol/path", normalizeSiteInput("https://www.Facebook.com/foo/bar"), "facebook.com");
check("normalizeSiteInput bare domain", normalizeSiteInput("Twitter.com"), "twitter.com");

const siteList = ["facebook.com", "youtube.com"];
check("findBlockedSiteMatch finds subdomain owner", findBlockedSiteMatch(siteList, "www.facebook.com"), "facebook.com");
check("findBlockedSiteMatch returns null for unrelated host", findBlockedSiteMatch(siteList, "twitter.com"), null);

// --- schedule: simple same-day window, Thursday=4 ---
const weekdayWork = { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", enabled: true };
check("inside simple window", isScheduleActive(weekdayWork, at("10:00")), true);
check("before simple window", isScheduleActive(weekdayWork, at("08:59")), false);
check("at end boundary is exclusive", isScheduleActive(weekdayWork, at("17:00")), false);
check("wrong day", isScheduleActive(weekdayWork, at("10:00", 2)), false); // Saturday
check("disabled schedule inactive", isScheduleActive({ ...weekdayWork, enabled: false }, at("10:00")), false);

// --- schedule: wraps midnight, e.g. 22:00 -> 06:00 on weekdays ---
const overnight = { days: [1, 2, 3, 4, 5], start: "22:00", end: "06:00", enabled: true };
check("overnight active just after start (Thu 23:00)", isScheduleActive(overnight, at("23:00")), true);
check("overnight active just before end next day (Fri 05:30)", isScheduleActive(overnight, at("05:30", 1)), true);
check("overnight inactive mid-day", isScheduleActive(overnight, at("12:00")), false);
check(
  "overnight still active Sat morning (tail of Friday's window)",
  isScheduleActive(overnight, at("05:30", 2)),
  true
);
check(
  "overnight inactive Sun morning (Sat not in weekday days)",
  isScheduleActive(overnight, at("05:30", 3)),
  false
);

// --- blockUntil / active aggregation ---
check("isBlockingActive true when a schedule matches", isBlockingActive({ schedules: [weekdayWork] }, at("10:00")), true);
check("isBlockingActive false when none match", isBlockingActive({ schedules: [weekdayWork] }, at("20:00")), false);

const until = getBlockUntilDate([weekdayWork], at("10:00"));
check("getBlockUntilDate returns 17:00 same day", until && until.getHours() * 60 + until.getMinutes(), 17 * 60);

const untilOvernight = getBlockUntilDate([overnight], at("23:00"));
check(
  "getBlockUntilDate for overnight window rolls to next day 06:00",
  untilOvernight && untilOvernight.getDate(),
  at("06:00", 1).getDate()
);

const everyDay = [0, 1, 2, 3, 4, 5, 6];
const endOf = (schedules, now) => {
  const date = getBlockUntilDate(schedules, now);
  return date && date.getTime();
};
check(
  "getBlockUntilDate runs through back-to-back schedules",
  endOf([{ ...weekdayWork, end: "13:00" }, { ...weekdayWork, start: "13:00" }], at("10:00")),
  at("17:00").getTime()
);
check(
  "getBlockUntilDate runs through overlapping schedules",
  endOf([{ ...weekdayWork, end: "13:00" }, { ...weekdayWork, start: "12:00", end: "15:00" }], at("10:00")),
  at("15:00").getTime()
);
check(
  "getBlockUntilDate stops at a one-minute gap",
  endOf([{ ...weekdayWork, end: "13:00" }, { ...weekdayWork, start: "13:01" }], at("10:00")),
  at("13:00").getTime()
);
check(
  "getBlockUntilDate follows an overnight window into the morning",
  endOf([{ ...overnight, days: everyDay }, { days: everyDay, start: "06:00", end: "08:00" }], at("23:00")),
  at("08:00", 1).getTime()
);
check(
  "getBlockUntilDate has no end when blocking never stops",
  endOf([{ days: everyDay, start: "00:00", end: "12:00" }, { days: everyDay, start: "12:00", end: "00:00" }], at("10:00")),
  null
);

const now = new Date();
const unlockedState = { unlocks: { "facebook.com": now.getTime() + 1000 } };
check("isSiteUnlocked true within window", isSiteUnlocked(unlockedState, "facebook.com", now), true);
check("isSiteUnlocked true via subdomain lookup key", isSiteUnlocked(unlockedState, "www.facebook.com", now), true);
check("isSiteUnlocked false for a different site", isSiteUnlocked(unlockedState, "youtube.com", now), false);

const expiredState = { unlocks: { "facebook.com": now.getTime() - 1000 } };
check("isSiteUnlocked false when expired", isSiteUnlocked(expiredState, "facebook.com", now), false);

const mixedUnlocks = { fresh: now.getTime() + 60000, stale: now.getTime() - 60000 };
check("pruneExpiredUnlocks drops only expired entries", pruneExpiredUnlocks(mixedUnlocks, now), {
  fresh: mixedUnlocks.fresh,
});

// --- default schedules: weekdays 09:00-13:00 and 14:00-18:00 ---
check("defaults block weekday mornings", isBlockingActive(DEFAULT_STATE, at("09:00")), true);
check("defaults leave lunch open", isBlockingActive(DEFAULT_STATE, at("13:30")), false);
check("defaults block weekday afternoons", isBlockingActive(DEFAULT_STATE, at("17:59")), true);
check("defaults end at 18:00", isBlockingActive(DEFAULT_STATE, at("18:00")), false);
check("defaults off on weekends", isBlockingActive(DEFAULT_STATE, at("10:00", 2)), false);

// --- daily unlock limit ---
check("dayKey uses local date", dayKey(at("23:59")), "2026-09-17");
check("daily limit is 6", MAX_UNLOCKS_PER_DAY, 6);

let usage = { day: "", counts: {} };
for (let i = 0; i < 5; i++) usage = recordUnlock(usage, "facebook.com", at("10:00"));
check("recordUnlock counts per site", getUnlocksUsedToday({ unlockUsage: usage }, "facebook.com", at("11:00")), 5);
check("remaining is limit minus used", getUnlocksRemainingToday({ unlockUsage: usage }, "facebook.com", at("11:00")), 1);
check("subdomain shares the site's count", getUnlocksUsedToday({ unlockUsage: usage }, "www.facebook.com", at("11:00")), 5);
check("other sites have their own count", getUnlocksRemainingToday({ unlockUsage: usage }, "youtube.com", at("11:00")), 6);

usage = recordUnlock(usage, "facebook.com", at("12:00"));
check("remaining floors at 0 once limit is hit", getUnlocksRemainingToday({ unlockUsage: usage }, "facebook.com", at("12:00")), 0);
check("next day starts fresh", getUnlocksRemainingToday({ unlockUsage: usage }, "facebook.com", at("00:00", 1)), 6);
check("recording on a new day drops yesterday's counts", recordUnlock(usage, "youtube.com", at("09:00", 1)), {
  day: "2026-09-18",
  counts: { "youtube.com": 1 },
});
check("missing unlockUsage counts as zero", getUnlocksUsedToday({}, "facebook.com", at("10:00")), 0);

// --- declarativeNetRequest rules ---
const PAGE = "chrome-extension://abc/blocked/blocked.html";
const ruleState = {
  blockedSites: ["facebook.com", "localhost:3000", "youtube.com"],
  schedules: DEFAULT_STATE.schedules,
  unlocks: { "youtube.com": at("10:05").getTime() },
};
const rules = buildBlockRules(ruleState, at("10:00"), PAGE);
check("no rules outside a schedule", buildBlockRules(ruleState, at("13:30"), PAGE), []);
check("invalid domains are skipped", rules.map((r) => r.condition.requestDomains[0]), ["facebook.com", "youtube.com"]);
check("rule ids are 1..n", rules.map((r) => r.id), [1, 2]);
check("blocked site redirects with the original URL after #", rules[0].action, {
  type: "redirect",
  redirect: { regexSubstitution: PAGE + "?site=facebook.com#\\0" },
});
check("redirect regex captures the whole http(s) URL", rules[0].condition.regexFilter, "^https?://.*$");
check("only top-level navigations", rules[0].condition.resourceTypes, ["main_frame"]);
check("unlocked site gets an allow rule", rules[1].action, { type: "allow" });
check("unlock expiry turns allow back into redirect", buildBlockRules(ruleState, at("10:05"), PAGE)[1].action.type, "redirect");
const overlap = buildBlockRules(
  { blockedSites: ["old.reddit.com", "reddit.com"], schedules: DEFAULT_STATE.schedules, unlocks: {} },
  at("10:00"),
  PAGE
);
check("earlier list entry wins on overlap, like findBlockedSiteMatch", overlap[0].priority > overlap[1].priority, true);

check("next change is the unlock expiry when it comes first", getNextRuleChange(ruleState, at("10:00")), at("10:05").getTime());
check("next change is the next schedule end", getNextRuleChange(ruleState, at("10:06")), at("13:00").getTime());
check("next change skips to tomorrow after the last boundary", getNextRuleChange(ruleState, at("18:00")), at("09:00", 1).getTime());
check("a boundary exactly now is not the next change", getNextRuleChange(ruleState, at("13:00")), at("14:00").getTime());
check(
  "disabled schedules don't set alarms",
  getNextRuleChange({ schedules: [{ ...DEFAULT_STATE.schedules[0], enabled: false }] }, at("10:00")),
  null
);

const catState = {
  blockedSites: ["bbc.com", "reddit.com", "twitch.tv", "zalando.de"],
  categories: [
    { id: "news", name: "News" },
    { id: "social", name: "Social networks" },
  ],
  siteCategories: { "bbc.com": "news", "reddit.com": "social", "twitch.tv": "removed-category" },
};
check("site category is looked up by its normalized name", getSiteCategoryId(catState, "www.Reddit.com"), "social");
check("a site whose category was removed has none", getSiteCategoryId(catState, "twitch.tv"), null);
check("a site with no entry has none", getSiteCategoryId(catState, "zalando.de"), null);
check("sites in a category", getSitesInCategory(catState, "news"), ["bbc.com"]);
check("null lists the uncategorized sites", getSitesInCategory(catState, null), ["twitch.tv", "zalando.de"]);
check("default categories", DEFAULT_STATE.categories.map((c) => c.name), [
  "News",
  "Gambling",
  "Social networks",
  "Entertainment",
  "Shopping",
]);
check("state saved before categories existed lists every site as uncategorized", getSitesInCategory(
  { ...DEFAULT_STATE, blockedSites: ["bbc.com"] },
  null
), ["bbc.com"]);

// Sessions: 30 min focus, 5 min break, started Thursday 10:00.
const session = { startedAt: at("10:00").getTime(), focusMinutes: 30, breakMinutes: 5 };
const sessionState = { ...DEFAULT_STATE, mode: "sessions", session, blockedSites: ["reddit.com"] };
check("session starts in focus", getSessionPhase(session, at("10:00")), { phase: "focus", round: 1, endsAt: at("10:30").getTime() });
check("break after the focus block", getSessionPhase(session, at("10:30")), { phase: "break", round: 1, endsAt: at("10:35").getTime() });
check("next round after the break", getSessionPhase(session, at("10:35")), { phase: "focus", round: 2, endsAt: at("11:05").getTime() });
check("rounds keep repeating", getSessionPhase(session, at("12:20")), { phase: "focus", round: 5, endsAt: at("12:50").getTime() });
check("no session, no phase", getSessionPhase(null, at("10:00")), null);
check("a session in the future has no phase", getSessionPhase(session, at("09:59")), null);
check("sessions mode blocks during focus", isBlockingActive(sessionState, at("10:10")), true);
check("sessions mode opens sites during a break", isBlockingActive(sessionState, at("10:31")), false);
check("sessions mode ignores schedules", isBlockingActive({ ...sessionState, session: null }, at("10:10")), false);
check("schedules mode ignores a stored session", getCurrentSessionPhase({ ...sessionState, mode: "schedules" }, at("10:10")), null);
check("focus ends at the break", getFocusEndDate(sessionState, at("10:10")).getTime(), at("10:30").getTime());
check("no focus end during a break", getFocusEndDate(sessionState, at("10:31")), null);
check("schedules mode focus end", getFocusEndDate(DEFAULT_STATE, at("10:00")).getTime(), at("13:00").getTime());
check("sessions mode: next rule change is the phase end", getNextRuleChange(sessionState, at("10:10")), at("10:30").getTime());
check("sessions mode: no session, no alarm", getNextRuleChange({ ...sessionState, session: null }, at("10:10")), null);
check("sessions mode: rules during focus", buildBlockRules(sessionState, at("10:10"), PAGE).length, 1);
check("sessions mode: no rules during a break", buildBlockRules(sessionState, at("10:31"), PAGE).length, 0);
check("session lengths outside the options fall back", normalizeSessionSettings({ focusMinutes: 1, breakMinutes: 60 }), { focusMinutes: 30, breakMinutes: 5 });
check("allowed session lengths are kept", normalizeSessionSettings({ focusMinutes: 45, breakMinutes: 15 }), { focusMinutes: 45, breakMinutes: 15 });

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll tests passed.");
}
