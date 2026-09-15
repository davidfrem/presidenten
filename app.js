import { initBrowserGame, setBrowserGameActive } from "./game.js";
import { hasStoredSettings, loadSettings, saveSettings } from "./settings.js";
import { APP_VERSION } from "./version.js";
import { trackSolo } from "./activity-client.js";

const SESSION_KEY = "presidenten.multiplayerSession";
const homeScreen = document.getElementById("homeScreen");
const soloScreen = document.getElementById("soloScreen");
const multiplayerScreen = document.getElementById("multiplayerScreen");
const settingsOverlay = document.getElementById("settingsDialog");
const settingsForm = document.getElementById("settingsForm");
const playerNameInput = document.getElementById("playerNameInput");
const botSkillSelect = document.getElementById("botSkillSelect");
const soloModeButton = document.getElementById("soloModeButton");
const multiplayerModeButton = document.getElementById("multiplayerModeButton");

let soloStarted = false;
let multiplayerModule = null;
let activeMode = "home";
let pendingMode = null;

document.querySelectorAll(".app-version").forEach((node) => { node.textContent = APP_VERSION; });
updateModeLabels();
initResponsiveTable();

function initResponsiveTable() {
  let pending = false;
  const observed = new WeakSet();
  const schedule = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      document.querySelectorAll(".hand, .played-pile, .card-backs").forEach((fan) => {
        if (resize && !observed.has(fan)) {
          resize.observe(fan);
          observed.add(fan);
        }
        const cards = [...fan.children];
        if (!cards.length || !fan.clientWidth) return;
        const style = getComputedStyle(fan);
        const available = fan.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const width = cards[0].getBoundingClientRect().width;
        const step = cards.length > 1
          ? Math.max(4, Math.min(width * 0.8, (available - width) / (cards.length - 1)))
          : width;
        fan.style.setProperty("--fan-margin", `${Math.min(0, step - width)}px`);
      });
    });
  };
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  schedule();
}

soloModeButton.addEventListener("click", startSolo);
multiplayerModeButton.addEventListener("click", startMultiplayer);
document.querySelectorAll("[data-open-settings]").forEach((button) => button.addEventListener("click", openSettings));
document.querySelectorAll("[data-go-home]").forEach((button) => button.addEventListener("click", requestHome));
document.getElementById("settingsCancel").addEventListener("click", closeSettings);
settingsForm.addEventListener("submit", applySettings);
window.addEventListener("presidenten:open-settings", openSettings);

function startSolo() {
  if (!hasStoredSettings()) {
    pendingMode = "solo";
    openSettings();
    return;
  }
  setScreen("solo");
  if (!soloStarted) {
    initBrowserGame();
    soloStarted = true;
  }
  setBrowserGameActive(true);
  updateModeLabels();
}

async function startMultiplayer() {
  if (!hasStoredSettings()) {
    pendingMode = "multiplayer";
    openSettings();
    return;
  }
  setScreen("multiplayer");
  multiplayerModule ||= await import("./multiplayer.js");
  if (activeMode !== "multiplayer") return;
  multiplayerModule.initMultiplayer({ onLeave: requestHome });
  updateModeLabels();
}

async function requestHome() {
  if (activeMode === "multiplayer" && multiplayerModule?.hasActiveRoom()) {
    if (!window.confirm("Wil je het huidige samenspel verlaten?")) return;
  }
  if (activeMode === "multiplayer") {
    await multiplayerModule?.stopMultiplayer({ clearStoredSession: true, notifyServer: true });
  }
  if (activeMode === "solo") setBrowserGameActive(false);
  setScreen("home");
  updateModeLabels();
}

function setScreen(mode) {
  trackSolo(mode === "solo");
  activeMode = mode;
  homeScreen.hidden = mode !== "home";
  soloScreen.hidden = mode !== "solo";
  multiplayerScreen.hidden = mode !== "multiplayer";
}

function openSettings() {
  if (activeMode === "solo") setBrowserGameActive(false);
  const settings = loadSettings();
  playerNameInput.value = settings.playerName === "Jij" ? "" : settings.playerName;
  botSkillSelect.value = settings.botSkill;
  settingsOverlay.hidden = false;
  requestAnimationFrame(() => {
    playerNameInput.focus({ preventScroll: true });
    playerNameInput.select();
  });
}

function closeSettings() {
  pendingMode = null;
  settingsOverlay.hidden = true;
  if (activeMode === "solo") setBrowserGameActive(true);
}

function applySettings(event) {
  event.preventDefault();
  const settings = saveSettings({
    playerName: playerNameInput.value,
    botSkill: botSkillSelect.value
  });
  window.dispatchEvent(new CustomEvent("presidenten:settings-changed", { detail: settings }));
  const nextMode = pendingMode;
  pendingMode = null;
  settingsOverlay.hidden = true;
  if (activeMode === "solo") setBrowserGameActive(true);
  if (nextMode === "solo") startSolo();
  if (nextMode === "multiplayer") startMultiplayer();
}

function updateModeLabels() {
  soloModeButton.querySelector("strong").textContent = soloStarted ? "Alleen verder" : "Alleen spelen";
  multiplayerModeButton.querySelector("strong").textContent = hasMultiplayerSession() ? "Kamer hervatten" : "Samen spelen";
}

function hasMultiplayerSession() {
  try {
    return Boolean(localStorage.getItem(SESSION_KEY));
  } catch {
    return false;
  }
}

if ("serviceWorker" in navigator) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    location.reload();
  });
  window.addEventListener("load", async () => {
    const registration = await navigator.serviceWorker.register("service-worker.js");
    registration.update().catch(() => {});
  });
}

if (new URLSearchParams(location.search).get("mode") === "samen") startMultiplayer();
