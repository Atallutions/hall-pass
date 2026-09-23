/* global browser, DEFAULT_STATE, DAY_LABELS, normalizeSiteInput, getUnlocksUsedToday, MAX_UNLOCKS_PER_DAY, isBlockingActive, getFocusEndDate, getCurrentSessionPhase, normalizeSessionSettings, SESSION_FOCUS_OPTIONS, SESSION_BREAK_OPTIONS, formatHM, parseHM, getSiteCategoryId, getSitesInCategory */
"use strict";

const statusBadge = document.getElementById("status-badge");
const statusLabel = document.getElementById("status-label");
const schedulesCount = document.getElementById("schedules-count");
const sitesTotal = document.getElementById("sites-total");
const categoryNav = document.getElementById("category-nav");
const addCategoryBtn = document.getElementById("add-category-btn");
const panels = {
  welcome: document.getElementById("panel-welcome"),
  sites: document.getElementById("panel-sites"),
  schedules: document.getElementById("panel-schedules"),
};
const heroCta = document.getElementById("hero-cta");
const uncategorizedTitle = document.getElementById("uncategorized-title");
const uncategorizedNote = document.getElementById("uncategorized-note");
const categoryNameInput = document.getElementById("category-name");
const removeCategoryBtn = document.getElementById("remove-category-btn");
const addSiteForm = document.getElementById("add-site-form");
const newSiteInput = document.getElementById("new-site-input");
const addSiteNote = document.getElementById("add-site-note");
const sitesList = document.getElementById("sites-list");
const schedulesList = document.getElementById("schedules-list");
const addScheduleBtn = document.getElementById("add-schedule-btn");
const scheduleTemplate = document.getElementById("schedule-template");
const modeInputs = document.querySelectorAll('input[name="mode"]');
const schedulesCard = document.getElementById("schedules-card");
const schedulesEmpty = document.getElementById("schedules-empty");
const sessionsCard = document.getElementById("sessions-card");
const focusOptions = document.getElementById("focus-options");
const breakOptions = document.getElementById("break-options");
const sessionStateLabel = document.getElementById("session-state");
const startSessionBtn = document.getElementById("start-session-btn");
const endSessionBtn = document.getElementById("end-session-btn");

// Hash id of the "Uncategorized" tab. Category ids are UUIDs or the short default ids.
const UNCATEGORIZED = "uncategorized";

let state = structuredClone(DEFAULT_STATE);
// { tab: "welcome" | "schedules" } or { tab: "sites", categoryId }, where a null categoryId is
// the "Uncategorized" tab.
let route = { tab: "welcome" };

function genId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function plural(n, word) {
  return n === 1 ? word : word + "s";
}

async function load() {
  state = await browser.storage.local.get(DEFAULT_STATE);
  state.sessionSettings = normalizeSessionSettings(state.sessionSettings);
  renderSchedules();
  renderMode();
  renderStatus();
  applyRoute();
}

// Schedules and categories aren't refreshed live; re-rendering them would steal focus mid-edit.
// blockedSites is, so a site added from the popup isn't lost on this page's next save.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.unlockUsage) state.unlockUsage = changes.unlockUsage.newValue;
  if (changes.blockedSites) state.blockedSites = changes.blockedSites.newValue || [];
  if (changes.blockedSites) {
    renderNav();
    renderWelcome();
  }
  if (changes.unlockUsage || changes.blockedSites) renderSites();
  // Sessions start and end from the popup too.
  if (changes.session) {
    state.session = changes.session.newValue || null;
    renderSessionControl();
    renderStatus();
  }
});

// Counts roll over at midnight without a storage change; refresh when the tab comes back.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    renderSites();
    renderStatus();
  }
});
setInterval(() => {
  renderStatus();
  renderSessionControl();
}, 15 * 1000);

async function save() {
  renderStatus();
  await browser.storage.local.set({
    blockedSites: state.blockedSites,
    schedules: state.schedules,
    categories: state.categories,
    siteCategories: state.siteCategories,
    mode: state.mode,
    sessionSettings: state.sessionSettings,
  });
}

function renderStatus() {
  const now = new Date();
  const phase = getCurrentSessionPhase(state, now);
  if (isBlockingActive(state, now)) {
    const until = getFocusEndDate(state, now);
    statusBadge.className = "pill pill-on";
    statusLabel.textContent = until ? `Blocking until ${formatHM(until)}` : "Blocking";
  } else if (phase) {
    statusBadge.className = "pill pill-off";
    statusLabel.textContent = `Break until ${formatHM(new Date(phase.endsAt))}`;
  } else {
    statusBadge.className = "pill pill-off";
    statusLabel.textContent = "Not blocking";
  }
}

// Tabs

function sitesRoute(categoryId) {
  return { tab: "sites", categoryId };
}

function firstSitesRoute() {
  return sitesRoute(state.categories.length ? state.categories[0].id : null);
}

function routeHash(r) {
  return r.tab === "sites" ? `#sites/${encodeURIComponent(r.categoryId || UNCATEGORIZED)}` : `#${r.tab}`;
}

function parseRoute() {
  const hash = decodeURIComponent(location.hash.slice(1));
  if (hash === "welcome" || hash === "schedules") return { tab: hash };
  if (hash === "sites") return firstSitesRoute();
  if (hash === `sites/${UNCATEGORIZED}`) return sitesRoute(null);
  if (hash.startsWith("sites/")) {
    const id = hash.slice("sites/".length);
    if (state.categories.some((c) => c.id === id)) return sitesRoute(id);
  }
  // No tab (the popup's Settings button, the browser's extension preferences), or one for a
  // removed category.
  return { tab: "welcome" };
}

function applyRoute() {
  route = parseRoute();
  const hash = routeHash(route);
  if (location.hash !== hash) history.replaceState(null, "", hash);
  for (const [tab, panel] of Object.entries(panels)) panel.hidden = tab !== route.tab;
  renderNav();
  renderWelcome();
  if (route.tab === "sites") {
    renderCategoryHeader();
    renderSites();
  }
}

function navigate(r) {
  location.hash = routeHash(r);
  applyRoute();
}

window.addEventListener("hashchange", () => {
  if (location.hash !== routeHash(route)) applyRoute();
});

function currentCategory() {
  return route.tab === "sites" ? state.categories.find((c) => c.id === route.categoryId) || null : null;
}

function categoryName(categoryId) {
  if (categoryId === null) return "Uncategorized";
  const category = state.categories.find((c) => c.id === categoryId);
  return (category && category.name.trim()) || "Untitled category";
}

function navItem(href, label, count, current) {
  const link = document.createElement("a");
  link.className = "nav-item";
  link.href = href;
  if (current) link.setAttribute("aria-current", "page");
  const labelSpan = document.createElement("span");
  labelSpan.className = "nav-label";
  labelSpan.textContent = label;
  const countSpan = document.createElement("span");
  countSpan.className = "nav-count";
  countSpan.textContent = count ? String(count) : "";
  link.append(labelSpan, countSpan);
  return link;
}

function renderNav() {
  for (const link of document.querySelectorAll(".sidebar [data-tab]")) {
    if (link.dataset.tab === route.tab) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  const enabled = state.schedules.filter((s) => s.enabled !== false).length;
  schedulesCount.textContent = state.mode === "sessions" ? "" : enabled ? String(enabled) : "";
  sitesTotal.textContent = state.blockedSites.length ? String(state.blockedSites.length) : "";

  categoryNav.innerHTML = "";
  const onSites = route.tab === "sites";
  for (const category of state.categories) {
    const count = getSitesInCategory(state, category.id).length;
    const current = onSites && route.categoryId === category.id;
    categoryNav.appendChild(navItem(routeHash(sitesRoute(category.id)), categoryName(category.id), count, current));
  }
  // Only there when it has something in it, or while you're on it.
  const uncategorized = getSitesInCategory(state, null).length;
  const onUncategorized = onSites && route.categoryId === null;
  if (uncategorized || onUncategorized) {
    const link = navItem(routeHash(sitesRoute(null)), "Uncategorized", uncategorized, onUncategorized);
    link.classList.add("nav-uncategorized");
    categoryNav.appendChild(link);
  }
}

function renderWelcome() {
  const sites = state.blockedSites.length;
  heroCta.textContent = sites ? "Manage blocked sites" : "Add your first site";
  heroCta.href = routeHash(firstSitesRoute());
  for (const tile of document.querySelectorAll(".mode-tile")) {
    tile.classList.toggle("current", tile.dataset.mode === state.mode);
  }
}

// Categories

// Only on a tab change: re-setting the name field while you type in it would move the cursor.
function renderCategoryHeader() {
  const category = currentCategory();
  categoryNameInput.hidden = !category;
  removeCategoryBtn.hidden = !category;
  uncategorizedTitle.hidden = Boolean(category);
  uncategorizedNote.hidden = Boolean(category);
  if (category) categoryNameInput.value = category.name;
  addSiteNote.hidden = true;
}

categoryNameInput.addEventListener("input", async () => {
  const category = currentCategory();
  if (!category) return;
  category.name = categoryNameInput.value;
  renderNav();
  renderSites(); // the move menus show category names
  await save();
});

categoryNameInput.addEventListener("change", async () => {
  const category = currentCategory();
  if (!category || category.name === category.name.trim()) return;
  category.name = categoryNameInput.value = category.name.trim();
  renderNav();
  await save();
});

addCategoryBtn.addEventListener("click", async () => {
  const category = { id: genId(), name: "" };
  state.categories.push(category);
  navigate(sitesRoute(category.id));
  categoryNameInput.focus();
  await save();
});

removeCategoryBtn.addEventListener("click", async () => {
  const category = currentCategory();
  if (!category) return;
  const sites = getSitesInCategory(state, category.id);
  if (
    sites.length > 0 &&
    !confirm(
      `Remove the category "${categoryName(category.id)}"?\n\n` +
        `Its ${sites.length} ${plural(sites.length, "site")} will stay blocked and move to Uncategorized.`
    )
  ) {
    return;
  }
  const index = state.categories.indexOf(category);
  state.categories.splice(index, 1);
  for (const site of sites) delete state.siteCategories[site];
  // Show where the sites went; otherwise stay near the removed tab.
  const neighbour = state.categories[index] || state.categories[index - 1];
  navigate(sitesRoute(sites.length || !neighbour ? null : neighbour.id));
  await save();
});

// Sites

function setSiteCategory(site, categoryId) {
  if (categoryId) state.siteCategories[site] = categoryId;
  else delete state.siteCategories[site];
}

// A "Move to…" menu listing the other categories, or null when there's nowhere else to go.
function buildMoveSelect(site) {
  const currentId = getSiteCategoryId(state, site);
  const targets = state.categories.filter((c) => c.id !== currentId).map((c) => [c.id, categoryName(c.id)]);
  if (currentId !== null) targets.push(["", "Uncategorized"]);
  if (!targets.length) return null;

  const select = document.createElement("select");
  select.className = "move-select";
  select.setAttribute("aria-label", `Move ${site} to another category`);
  const prompt = new Option("Move to…", "", true, true);
  prompt.disabled = true;
  prompt.hidden = true;
  select.appendChild(prompt);
  for (const [id, name] of targets) select.appendChild(new Option(name, id || UNCATEGORIZED));
  select.addEventListener("change", async () => {
    setSiteCategory(site, select.value === UNCATEGORIZED ? null : select.value);
    renderNav();
    renderSites();
    await save();
  });
  return select;
}

// Nothing until a site has used a pass today, so a fresh list is just names.
function buildUsage(site, now) {
  const used = getUnlocksUsedToday(state, site, now);
  if (used === 0) return null;
  const usage = document.createElement("span");
  usage.className = "usage";
  usage.classList.toggle("exhausted", used >= MAX_UNLOCKS_PER_DAY);
  const pips = document.createElement("span");
  pips.className = "pips";
  pips.setAttribute("aria-hidden", "true");
  for (let i = 0; i < MAX_UNLOCKS_PER_DAY; i++) {
    const pip = document.createElement("span");
    pip.className = i < used ? "pip used" : "pip";
    pips.appendChild(pip);
  }
  usage.appendChild(pips);
  usage.appendChild(
    document.createTextNode(
      used >= MAX_UNLOCKS_PER_DAY ? "No passes left today" : `${used} of ${MAX_UNLOCKS_PER_DAY} passes used today`
    )
  );
  return usage;
}

function renderSites() {
  if (route.tab !== "sites") return;
  const sites = getSitesInCategory(state, route.categoryId);
  sitesList.innerHTML = "";
  if (!sites.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = route.categoryId ? "No sites in this category yet." : "No uncategorized sites.";
    sitesList.appendChild(li);
    return;
  }
  const now = new Date();
  for (const site of sites) {
    const li = document.createElement("li");

    const nameSpan = document.createElement("span");
    nameSpan.className = "site-name";
    nameSpan.textContent = site;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-icon";
    removeBtn.textContent = "✕";
    removeBtn.title = `Remove ${site}`;
    removeBtn.setAttribute("aria-label", `Remove ${site}`);
    removeBtn.addEventListener("click", async () => {
      state.blockedSites = state.blockedSites.filter((s) => s !== site);
      delete state.siteCategories[site];
      renderNav();
      renderSites();
      await save();
    });

    const actions = document.createElement("span");
    actions.className = "row-actions";
    const move = buildMoveSelect(site);
    if (move) actions.appendChild(move);
    actions.appendChild(removeBtn);

    li.appendChild(nameSpan);
    const usage = buildUsage(site, now);
    if (usage) li.appendChild(usage);
    li.appendChild(actions);
    sitesList.appendChild(li);
  }
}

addSiteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const site = normalizeSiteInput(newSiteInput.value);
  if (!site) return;
  const categoryId = route.categoryId;
  addSiteNote.hidden = true;
  if (state.blockedSites.includes(site)) {
    const previous = getSiteCategoryId(state, site);
    if (previous !== categoryId) {
      addSiteNote.textContent = `${site} was already on your list. It moved here from ${categoryName(previous)}.`;
      addSiteNote.hidden = false;
    }
  } else {
    state.blockedSites.push(site);
    state.blockedSites.sort();
  }
  setSiteCategory(site, categoryId);
  renderNav();
  renderSites();
  newSiteInput.value = "";
  newSiteInput.focus();
  await save();
});

newSiteInput.addEventListener("input", () => {
  addSiteNote.hidden = true;
});

// Focus time mode and sessions

function renderMode() {
  for (const input of modeInputs) input.checked = input.value === state.mode;
  schedulesCard.hidden = state.mode === "sessions";
  sessionsCard.hidden = state.mode !== "sessions";
  renderLengthOptions(focusOptions, "focus-length", SESSION_FOCUS_OPTIONS, "focusMinutes");
  renderLengthOptions(breakOptions, "break-length", SESSION_BREAK_OPTIONS, "breakMinutes");
  renderSessionControl();
}

function renderLengthOptions(container, name, minutes, key) {
  container.innerHTML = "";
  for (const value of minutes) {
    const label = document.createElement("label");
    label.className = "day-chip";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = name;
    radio.checked = state.sessionSettings[key] === value;
    radio.addEventListener("change", async () => {
      state.sessionSettings = { ...state.sessionSettings, [key]: value };
      renderSessionControl();
      await save();
    });
    const text = document.createElement("span");
    text.textContent = `${value} min`;
    label.append(radio, text);
    container.appendChild(label);
  }
}

function renderSessionControl() {
  const phase = getCurrentSessionPhase(state, new Date());
  startSessionBtn.hidden = Boolean(phase);
  endSessionBtn.hidden = !phase;
  startSessionBtn.textContent = `Start a ${state.sessionSettings.focusMinutes}-minute session`;
  if (!phase) {
    sessionStateLabel.className = "session-state";
    sessionStateLabel.textContent = "No session running";
    return;
  }
  const until = formatHM(new Date(phase.endsAt));
  sessionStateLabel.className = `session-state ${phase.phase}`;
  sessionStateLabel.textContent =
    phase.phase === "focus"
      ? `Session ${phase.round} until ${until}, then a ${state.session.breakMinutes}-minute break`
      : `Break until ${until}, then session ${phase.round + 1}`;
}

for (const input of modeInputs) {
  input.addEventListener("change", async () => {
    if (!input.checked) return;
    state.mode = input.value;
    renderMode();
    renderNav();
    renderWelcome();
    renderStatus();
    await save();
    // A running session only counts in sessions mode; don't leave one waiting for a switch back.
    if (state.mode !== "sessions" && state.session) await browser.runtime.sendMessage({ type: "endSession" });
  });
}

startSessionBtn.addEventListener("click", async () => {
  startSessionBtn.disabled = true;
  try {
    const result = await browser.runtime.sendMessage({ type: "startSession" });
    if (result && result.session) state.session = result.session;
    renderSessionControl();
    renderStatus();
  } finally {
    startSessionBtn.disabled = false;
  }
});

endSessionBtn.addEventListener("click", async () => {
  await browser.runtime.sendMessage({ type: "endSession" });
  state.session = null;
  renderSessionControl();
  renderStatus();
});

// Schedules

function renderSchedules() {
  schedulesList.innerHTML = "";
  for (const schedule of state.schedules) {
    schedulesList.appendChild(buildScheduleCard(schedule));
  }
  renderSchedulesEmpty();
}

// With no enabled schedule nothing is ever blocked; say so instead of leaving an empty list.
function renderSchedulesEmpty() {
  const enabled = state.schedules.filter((s) => s.enabled !== false).length;
  schedulesEmpty.hidden = enabled > 0;
  schedulesEmpty.textContent = state.schedules.length
    ? "All schedules are disabled, so Hall Pass isn't blocking anything."
    : "No schedules yet, so Hall Pass isn't blocking anything. Add one to set your focus time.";
}

function buildScheduleCard(schedule) {
  const node = scheduleTemplate.content.cloneNode(true);
  const card = node.querySelector(".schedule-card");

  const labelInput = card.querySelector(".schedule-label");
  labelInput.value = schedule.label || "";
  labelInput.addEventListener("input", async () => {
    schedule.label = labelInput.value;
    await save();
  });

  const enabledInput = card.querySelector(".schedule-enabled");
  const switchLabel = card.querySelector(".switch-label");
  const syncEnabled = () => {
    card.classList.toggle("disabled", !enabledInput.checked);
    switchLabel.textContent = enabledInput.checked ? "Enabled" : "Disabled";
  };
  enabledInput.checked = schedule.enabled !== false;
  syncEnabled();
  enabledInput.addEventListener("change", async () => {
    schedule.enabled = enabledInput.checked;
    syncEnabled();
    renderSchedulesEmpty();
    renderNav();
    renderWelcome();
    await save();
  });

  const removeBtn = card.querySelector(".remove-schedule-btn");
  removeBtn.addEventListener("click", async () => {
    state.schedules = state.schedules.filter((s) => s.id !== schedule.id);
    renderSchedules();
    renderNav();
    renderWelcome();
    await save();
  });

  const daysContainer = card.querySelector(".schedule-days");
  // Monday first; DAY_LABELS / schedule.days stay Sunday=0.
  [1, 2, 3, 4, 5, 6, 0].forEach((dayIndex) => {
    const dayLabel = document.createElement("label");
    dayLabel.className = "day-chip";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = schedule.days.includes(dayIndex);
    checkbox.addEventListener("change", async () => {
      if (checkbox.checked) {
        if (!schedule.days.includes(dayIndex)) schedule.days.push(dayIndex);
      } else {
        schedule.days = schedule.days.filter((d) => d !== dayIndex);
      }
      await save();
    });
    const text = document.createElement("span");
    text.textContent = DAY_LABELS[dayIndex];
    dayLabel.appendChild(checkbox);
    dayLabel.appendChild(text);
    daysContainer.appendChild(dayLabel);
  });

  const startInput = card.querySelector(".schedule-start");
  const endInput = card.querySelector(".schedule-end");
  const overnightNote = card.querySelector(".overnight-note");
  const syncOvernight = () => {
    overnightNote.hidden = !(schedule.start && schedule.end && parseHM(schedule.start) > parseHM(schedule.end));
  };

  startInput.value = schedule.start;
  startInput.addEventListener("input", async () => {
    schedule.start = startInput.value;
    syncOvernight();
    await save();
  });

  endInput.value = schedule.end;
  endInput.addEventListener("input", async () => {
    schedule.end = endInput.value;
    syncOvernight();
    await save();
  });
  syncOvernight();

  return node;
}

addScheduleBtn.addEventListener("click", async () => {
  const schedule = {
    id: genId(),
    label: "",
    days: [1, 2, 3, 4, 5],
    start: "09:00",
    end: "17:00",
    enabled: true,
  };
  state.schedules.push(schedule);
  renderSchedules();
  renderNav();
  renderWelcome();
  await save();
});

load();
