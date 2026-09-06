import { initBrowserGame, setBrowserGameActive } from "./game.js";
import { hasStoredSettings, loadSettings, saveSettings } from "./settings.js";
import { APP_VERSION } from "./version.js";

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
renderNameKeyboard();
updateModeLabels();

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

function requestHome() {
  if (activeMode === "multiplayer" && multiplayerModule?.hasActiveRoom()) {
    if (!window.confirm("Wil je het huidige samenspel verlaten?")) return;
  }
  if (activeMode === "multiplayer") multiplayerModule?.stopMultiplayer({ clearStoredSession: true });
  if (activeMode === "solo") setBrowserGameActive(false);
  setScreen("home");
  updateModeLabels();
}

function setScreen(mode) {
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

function renderNameKeyboard() {
  const keyboard = document.getElementById("nameKeyboard");
  const rows = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["Z", "X", "C", "V", "B", "N", "M"],
    ["Spatie", "Wis"]
  ];
  rows.forEach((keys) => {
    const row = document.createElement("div");
    row.className = "name-key-row";
    keys.forEach((key) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "name-key";
      button.textContent = key;
      button.addEventListener("click", () => updateNameFromKey(key));
      row.append(button);
    });
    keyboard.append(row);
  });
}

function updateNameFromKey(key) {
  if (key === "Wis") playerNameInput.value = playerNameInput.value.slice(0, -1);
  else if (key === "Spatie") playerNameInput.value += " ";
  else if (playerNameInput.value.length < playerNameInput.maxLength) playerNameInput.value += key;
  playerNameInput.focus({ preventScroll: true });
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
