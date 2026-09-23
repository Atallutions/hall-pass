/* global browser, DEFAULT_STATE, DAY_LABELS, normalizeSiteInput, getUnlocksUsedToday, MAX_UNLOCKS_PER_DAY, isBlockingActive, getBlockUntilDate, formatHM, parseHM */
"use strict";

const statusBadge = document.getElementById("status-badge");
const statusLabel = document.getElementById("status-label");
const addSiteForm = document.getElementById("add-site-form");
const newSiteInput = document.getElementById("new-site-input");
const sitesList = document.getElementById("sites-list");
const sitesCount = document.getElementById("sites-count");
const schedulesList = document.getElementById("schedules-list");
const addScheduleBtn = document.getElementById("add-schedule-btn");
const scheduleTemplate = document.getElementById("schedule-template");

let state = structuredClone(DEFAULT_STATE);

function genId() {
  return (crypto.randomUUID && crypto.randomUUID()) || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function load() {
  state = await browser.storage.local.get(DEFAULT_STATE);
  renderSites();
  renderSchedules();
  renderStatus();
}

// Schedules aren't refreshed live; re-rendering them would steal focus mid-edit.
// blockedSites is, so a site added from the popup isn't lost on this page's next save.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.unlockUsage) state.unlockUsage = changes.unlockUsage.newValue;
  if (changes.blockedSites) state.blockedSites = changes.blockedSites.newValue || [];
  if (changes.unlockUsage || changes.blockedSites) renderSites();
});

// Counts roll over at midnight without a storage change; refresh when the tab comes back.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    renderSites();
    renderStatus();
  }
});
setInterval(renderStatus, 30 * 1000);

async function save() {
  renderStatus();
  await browser.storage.local.set({
    blockedSites: state.blockedSites,
    schedules: state.schedules,
  });
}

function renderStatus() {
  const now = new Date();
  if (isBlockingActive(state, now)) {
    const until = getBlockUntilDate(state.schedules, now);
    statusBadge.className = "pill pill-on";
    statusLabel.textContent = until ? `Blocking until ${formatHM(until)}` : "Blocking";
  } else {
    statusBadge.className = "pill pill-off";
    statusLabel.textContent = "Not blocking";
  }
}

function renderSites() {
  sitesList.innerHTML = "";
  sitesCount.textContent = state.blockedSites.length ? String(state.blockedSites.length) : "";
  if (!state.blockedSites.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No sites added yet.";
    sitesList.appendChild(li);
    return;
  }
  const now = new Date();
  for (const site of state.blockedSites) {
    const li = document.createElement("li");

    const nameSpan = document.createElement("span");
    nameSpan.className = "site-name";
    nameSpan.textContent = site;

    const used = getUnlocksUsedToday(state, site, now);
    const usage = document.createElement("span");
    usage.className = "usage";
    usage.classList.toggle("exhausted", used >= MAX_UNLOCKS_PER_DAY);
    usage.title = "Passes used today";
    const pips = document.createElement("span");
    pips.className = "pips";
    for (let i = 0; i < MAX_UNLOCKS_PER_DAY; i++) {
      const pip = document.createElement("span");
      pip.className = i < used ? "pip used" : "pip";
      pips.appendChild(pip);
    }
    usage.appendChild(pips);
    usage.appendChild(document.createTextNode(`${used} of ${MAX_UNLOCKS_PER_DAY} used today`));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-icon";
    removeBtn.textContent = "✕";
    removeBtn.title = `Remove ${site}`;
    removeBtn.setAttribute("aria-label", `Remove ${site}`);
    removeBtn.addEventListener("click", async () => {
      state.blockedSites = state.blockedSites.filter((s) => s !== site);
      renderSites();
      await save();
    });

    li.appendChild(nameSpan);
    li.appendChild(usage);
    li.appendChild(removeBtn);
    sitesList.appendChild(li);
  }
}

addSiteForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const site = normalizeSiteInput(newSiteInput.value);
  if (!site) return;
  if (!state.blockedSites.includes(site)) {
    state.blockedSites.push(site);
    state.blockedSites.sort();
    renderSites();
    await save();
  }
  newSiteInput.value = "";
  newSiteInput.focus();
});

function renderSchedules() {
  schedulesList.innerHTML = "";
  for (const schedule of state.schedules) {
    schedulesList.appendChild(buildScheduleCard(schedule));
  }
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
    await save();
  });

  const removeBtn = card.querySelector(".remove-schedule-btn");
  removeBtn.addEventListener("click", async () => {
    state.schedules = state.schedules.filter((s) => s.id !== schedule.id);
    renderSchedules();
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
  await save();
});

load();
