import { isValidPlay } from "./game.js";
import { loadSettings } from "./settings.js";
import { createBadge, createCardElement, renderPileCards } from "./ui-components.js";

const roleNames = ["President", "Vice-president", "Vice-verliezer", "Verliezer"];
const playerIcons = ["👤", "🧢", "🎧", "⭐"];
const SESSION_KEY = "presidenten.multiplayerSession";

let socket;
let view = null;
let selectedIds = new Set();
let exchangeSelectedIds = new Set();
let reconnectAttempt = false;
let shouldReconnect = true;
let reconnectDelay = 1500;
let initialized = false;
let onLeave = () => {};
let actionPending = false;
let resolveLeaveAck = null;

const elements = {};

export function initMultiplayer(options = {}) {
  onLeave = options.onLeave || onLeave;
  shouldReconnect = true;
  if (initialized) {
    if (!socket || socket.readyState === WebSocket.CLOSED) connect();
    return;
  }
  initialized = true;
  [
    "connectionBadge", "leaveButton", "lobbyLeaveButton", "multiplayerLobby", "joinPanel", "waitingPanel", "lobbyName",
    "lobbyBotSkill", "lobbySettingsButton", "roomCodeInput", "createRoomButton", "joinRoomButton", "roomCodeLabel", "lobbyPlayers",
    "botFillText", "startRoomButton", "hostWaitingText", "lobbyError", "mpRoundLabel", "mpHumanAvatar", "mpHumanName",
    "mpHumanRole", "mpHumanFinishBadge", "mpHumanPassBadge", "mpHumanPlayedPile", "mpHand",
    "mpTurnHint", "mpPlayButton", "mpPassButton", "mpActivityLog", "mpExchangeDialog",
    "mpExchangeTitle", "mpExchangeText", "mpExchangeHand", "mpExchangeConfirm", "mpRoundDialog",
    "mpResultsList", "mpRoundWaiting", "mpContinueButton"
  ].forEach((id) => { elements[id] = document.getElementById(id); });

  applyLobbySettings(loadSettings());
  elements.roomCodeInput.addEventListener("input", () => {
    elements.roomCodeInput.value = elements.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });
  elements.createRoomButton.addEventListener("click", () => sendLobbyAction("createRoom"));
  elements.joinRoomButton.addEventListener("click", () => sendLobbyAction("joinRoom"));
  elements.lobbySettingsButton.addEventListener("click", () => window.dispatchEvent(new Event("presidenten:open-settings")));
  elements.startRoomButton.addEventListener("click", () => sendAction({ type: "startGame" }));
  document.querySelectorAll("[data-multiplayer-leave]").forEach((button) => button.addEventListener("click", leaveGame));
  elements.mpPlayButton.addEventListener("click", playSelectedCards);
  elements.mpPassButton.addEventListener("click", () => {
    if (!selectedIds.size) sendAction({ type: "pass" });
  });
  elements.mpContinueButton.addEventListener("click", () => sendAction({ type: "nextRound" }));
  elements.mpExchangeConfirm.addEventListener("click", confirmExchange);
  window.addEventListener("presidenten:settings-changed", (event) => {
    applyLobbySettings(event.detail);
    if (view) send({ type: "updateName", name: event.detail.playerName });
  });
  connect();
}

function connect() {
  const currentSocket = new WebSocket(multiplayerSocketUrl());
  socket = currentSocket;
  setConnection("Verbinden...", false);
  currentSocket.addEventListener("open", () => {
    reconnectDelay = 1500;
    setConnection("Verbonden", true);
    showError("");
    const saved = loadSession();
    if (saved) {
      reconnectAttempt = true;
      send({ type: "reconnect", ...saved });
    }
  });
  currentSocket.addEventListener("message", (event) => handleMessage(JSON.parse(event.data)));
  currentSocket.addEventListener("close", () => {
    if (socket === currentSocket) socket = null;
    setConnection("Verbinding verbroken", false);
    actionPending = false;
    if (view) renderGame();
    if (resolveLeaveAck) resolveLeaveAck();
    else showError("Verbinding verbroken. Er wordt opnieuw verbinding gemaakt.");
    if (!shouldReconnect) return;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.6, 10_000);
  });
  currentSocket.addEventListener("error", () => setConnection("Geen verbinding", false));
}

function handleMessage(message) {
  if (message.type === "left") {
    resolveLeaveAck?.();
    return;
  }
  if (message.type === "joined") {
    reconnectAttempt = false;
    saveSession({ code: message.code, token: message.token });
    return;
  }
  if (message.type === "lobby") return renderLobby(message);
  if (message.type === "state") {
    actionPending = false;
    showError("");
    view = message;
    elements.multiplayerLobby.hidden = true;
    renderGame();
    return;
  }
  if (message.type === "error") {
    actionPending = false;
    if (reconnectAttempt) {
      reconnectAttempt = false;
      clearSession();
      elements.joinPanel.hidden = false;
      elements.waitingPanel.hidden = true;
    }
    if (view) renderGame();
    showError(message.message);
  }
}

function sendLobbyAction(type) {
  showError("");
  const name = elements.lobbyName.value.trim();
  if (!name) return showError("Vul eerst je naam in.");
  if (type === "joinRoom" && elements.roomCodeInput.value.length !== 5) {
    return showError("Vul de kamercode van vijf tekens in.");
  }
  sendAction({
    type,
    name,
    code: elements.roomCodeInput.value,
    botSkill: elements.lobbyBotSkill.value
  });
}

function renderLobby(message) {
  actionPending = false;
  view = null;
  elements.multiplayerLobby.hidden = false;
  elements.joinPanel.hidden = true;
  elements.waitingPanel.hidden = false;
  elements.roomCodeLabel.textContent = message.room.code;
  elements.lobbyPlayers.innerHTML = "";
  message.players.forEach((player) => {
    const row = document.createElement("div");
    row.className = "lobby-player";
    const icon = document.createElement("span");
    icon.className = "lobby-player-icon";
    icon.textContent = playerIcons[player.id];
    const name = document.createElement("strong");
    name.textContent = player.name;
    const status = document.createElement("span");
    status.textContent = player.connected ? "Verbonden" : "Verbinding kwijt";
    row.append(icon, name, status);
    elements.lobbyPlayers.append(row);
  });
  const botCount = 4 - message.players.length;
  elements.botFillText.textContent = botCount
    ? `${botCount} lege ${botCount === 1 ? "plek wordt" : "plekken worden"} gevuld door bots.`
    : "Alle vier de spelers zijn aanwezig.";
  elements.startRoomButton.hidden = !message.room.isHost;
  elements.startRoomButton.disabled = actionPending;
  elements.hostWaitingText.hidden = message.room.isHost;
  elements.lobbyLeaveButton.textContent = "Spel verlaten";
  showError("");
}

function renderGame() {
  selectedIds = new Set([...selectedIds].filter((id) => view.hand.some((card) => card.id === id)));
  elements.mpRoundLabel.textContent = `Ronde ${view.round} · kamer ${view.room.code}`;
  renderPlayers();
  renderHand();
  renderLog();
  renderControls();
  renderExchange();
  renderRoundEnd();
}

function renderPlayers() {
  const self = view.players.find((player) => player.id === view.viewerId);
  const selfRole = currentRoundRole(self.id);
  const selfNode = document.getElementById("mp-player-0");
  selfNode.classList.toggle("is-turn", view.currentPlayerId === self.id);
  selfNode.classList.toggle("has-finished", Boolean(selfRole));
  renderPlayerAvatar(elements.mpHumanAvatar, self);
  elements.mpHumanName.textContent = self.name;
  elements.mpHumanRole.textContent = selfRole ? "Uit" : self.role;
  elements.mpHumanFinishBadge.textContent = selfRole || "";
  elements.mpHumanFinishBadge.classList.toggle("is-visible", Boolean(selfRole));
  elements.mpHumanPassBadge.classList.toggle("is-visible", view.passedPlayerIds.includes(self.id));
  renderPile(elements.mpHumanPlayedPile, self);

  [1, 2, 3].forEach((position) => {
    const player = view.players.find((candidate) => relativePosition(candidate.id) === position);
    const node = document.getElementById(`mp-player-${position}`);
    if (!player) {
      node.innerHTML = "";
      return;
    }
    const roundRole = currentRoundRole(player.id);
    node.classList.toggle("has-finished", Boolean(roundRole));
    node.classList.toggle("is-turn", view.currentPlayerId === player.id);
    node.classList.toggle("is-disconnected", player.human && !player.connected);
    node.innerHTML = "";

    const row = document.createElement("div");
    row.className = "player-row";
    const avatar = document.createElement("span");
    avatar.className = "player-avatar";
    renderPlayerAvatar(avatar, player);
    const meta = document.createElement("div");
    meta.className = "player-meta";
    const name = document.createElement("span");
    name.className = "player-name";
    name.textContent = player.name;
    const role = document.createElement("span");
    role.className = "player-role";
    role.textContent = player.human && !player.connected
      ? "Verbinding kwijt"
      : roundRole ? "Uit" : `${player.role} - ${player.handCount} kaart${player.handCount === 1 ? "" : "en"}`;
    meta.append(name, role);
    row.append(avatar, meta, makeBadge("turn-badge", "Beurt"));
    row.append(makeBadge(`finish-badge${roundRole ? " is-visible" : ""}`, roundRole || ""));
    row.append(makeBadge(`pass-badge${view.passedPlayerIds.includes(player.id) ? " is-visible" : ""}`, "Pas"));
    node.append(row);

    const backs = document.createElement("div");
    backs.className = "card-backs";
    backs.setAttribute("aria-hidden", "true");
    Array.from({ length: player.handCount }, () => {
      const back = document.createElement("span");
      back.className = "card-back";
      backs.append(back);
    });
    node.append(backs);
    const wrap = document.createElement("div");
    wrap.className = "personal-pile-wrap";
    const pile = document.createElement("div");
    pile.className = "played-pile";
    wrap.append(pile);
    node.append(wrap);
    renderPile(pile, player);
  });
}

function renderPlayerAvatar(avatar, player) {
  const controller = player.human ? "human" : "bot";
  avatar.textContent = playerIcons[player.id];
  avatar.dataset.controller = controller;
  avatar.setAttribute("aria-label", `${player.name}, ${player.human ? "echte speler" : "bot"}`);
  avatar.title = player.human ? "Echte speler" : "Bot";
}

function renderHand() {
  elements.mpHand.innerHTML = "";
  const canPlay = view.phase === "playing" && view.currentPlayerId === view.viewerId;
  view.hand.forEach((card) => {
    const button = renderCard(card);
    button.classList.toggle("selected", selectedIds.has(card.id));
    button.disabled = !canPlay;
    button.classList.toggle("disabled", !canPlay);
    button.addEventListener("click", () => {
      if (selectedIds.has(card.id)) selectedIds.delete(card.id);
      else selectedIds.add(card.id);
      renderHand();
      renderControls();
    });
    elements.mpHand.append(button);
  });
}

function renderControls() {
  const myTurn = view.phase === "playing" && view.currentPlayerId === view.viewerId;
  const selectedCards = view.hand.filter((card) => selectedIds.has(card.id));
  elements.mpPlayButton.disabled = actionPending || !myTurn || !isValidSelection(selectedCards, view.currentPlay);
  elements.mpPassButton.disabled = actionPending || !myTurn || !view.currentPlay || selectedIds.size > 0;
  elements.mpTurnHint.textContent = !myTurn ? "" : !view.currentPlay
    ? `${view.players[view.viewerId].name} komt uit`
    : `Speel ${view.currentPlay.cards.length} hoger of pas`;
}

function renderPile(node, player) {
  const activeIds = view.currentPlay?.playerId === player.id
    ? new Set(view.currentPlay.cards.map((card) => card.id))
    : new Set();
  renderPileCards(node, player.playedPile, activeIds);
}

function renderLog() {
  elements.mpActivityLog.innerHTML = "";
  view.log.slice(0, 6).forEach((message) => {
    const item = document.createElement("li");
    item.textContent = message;
    elements.mpActivityLog.append(item);
  });
}

function renderExchange() {
  if (view.phase !== "exchange") {
    if (elements.mpExchangeDialog.open) elements.mpExchangeDialog.close();
    exchangeSelectedIds = new Set();
    return;
  }
  const prompt = view.exchangePrompt;
  elements.mpExchangeHand.innerHTML = "";
  elements.mpExchangeConfirm.hidden = prompt.type === "waiting";
  if (prompt.type === "waiting") {
    elements.mpExchangeTitle.textContent = "Kaarten wisselen";
    elements.mpExchangeText.textContent = "Wachten tot de andere spelers hun kaarten hebben gekozen.";
  } else if (prompt.type === "forcedBest") {
    elements.mpExchangeTitle.textContent = "Beste kaarten afgeven";
    elements.mpExchangeText.textContent = `Je geeft je ${prompt.count} beste kaart${prompt.count > 1 ? "en" : ""} aan ${prompt.otherName}.`;
    const marked = new Set(prompt.cardIds);
    view.hand.forEach((card) => {
      const button = renderCard(card);
      button.classList.toggle("locked", marked.has(card.id));
      button.disabled = true;
      elements.mpExchangeHand.append(button);
    });
    elements.mpExchangeConfirm.textContent = "Geef af";
    elements.mpExchangeConfirm.disabled = actionPending;
  } else {
    elements.mpExchangeTitle.textContent = "Kaarten teruggeven";
    elements.mpExchangeText.textContent = `Kies ${prompt.count} kaart${prompt.count > 1 ? "en" : ""} voor ${prompt.otherName}.`;
    view.hand.forEach((card) => {
      const button = renderCard(card);
      button.classList.toggle("selected", exchangeSelectedIds.has(card.id));
      button.addEventListener("click", () => {
        if (exchangeSelectedIds.has(card.id)) exchangeSelectedIds.delete(card.id);
        else if (exchangeSelectedIds.size < prompt.count) exchangeSelectedIds.add(card.id);
        renderExchange();
      });
      elements.mpExchangeHand.append(button);
    });
    elements.mpExchangeConfirm.textContent = "Bevestig";
    elements.mpExchangeConfirm.disabled = actionPending || exchangeSelectedIds.size !== prompt.count;
  }
  if (!elements.mpExchangeDialog.open) elements.mpExchangeDialog.showModal();
}

function renderRoundEnd() {
  if (view.phase !== "roundEnd") {
    if (elements.mpRoundDialog.open) elements.mpRoundDialog.close();
    return;
  }
  elements.mpResultsList.innerHTML = "";
  view.finishOrder.forEach((playerId, index) => {
    const row = document.createElement("div");
    row.className = "result-row";
    const role = document.createElement("strong");
    role.textContent = roleNames[index];
    const name = document.createElement("span");
    name.textContent = view.players[playerId].name;
    row.append(role, name);
    elements.mpResultsList.append(row);
  });
  elements.mpContinueButton.hidden = !view.room.isHost;
  elements.mpContinueButton.disabled = actionPending;
  elements.mpRoundWaiting.textContent = view.room.isHost ? "" : "De spelleider begint de volgende ronde.";
  if (!elements.mpRoundDialog.open) elements.mpRoundDialog.showModal();
}

function confirmExchange() {
  const prompt = view.exchangePrompt;
  if (prompt.type === "forcedBest") sendAction({ type: "confirmBest" });
  if (prompt.type === "chooseReturn") {
    sendAction({ type: "chooseReturn", cardIds: [...exchangeSelectedIds] });
    exchangeSelectedIds = new Set();
  }
}

function playSelectedCards() {
  sendAction({ type: "play", cardIds: [...selectedIds] });
  selectedIds = new Set();
}

function isValidSelection(cards, currentPlay) {
  return isValidPlay(cards, currentPlay);
}

function currentRoundRole(playerId) {
  const index = view.finishOrder.indexOf(playerId);
  return index === -1 ? null : roleNames[index];
}

function relativePosition(playerId) {
  return (playerId - view.viewerId + 4) % 4;
}

function renderCard(card) {
  return createCardElement(card);
}

function makeBadge(className, text) {
  return createBadge(className, text);
}

function setConnection(text, connected) {
  document.querySelectorAll(".multiplayer-connection").forEach((node) => { node.textContent = text; });
  elements.connectionBadge.classList.toggle("is-connected", connected);
}

function send(payload) {
  if (socket?.readyState !== WebSocket.OPEN) {
    showError("De server is niet verbonden.");
    return false;
  }
  socket.send(JSON.stringify(payload));
  return true;
}

function sendAction(payload) {
  if (actionPending) return false;
  showError("");
  if (!send(payload)) return false;
  actionPending = true;
  if (view) renderGame();
  return true;
}

function showError(message) {
  document.querySelectorAll(".multiplayer-error").forEach((node) => { node.textContent = message; });
}

function leaveGame() {
  onLeave();
}

function applyLobbySettings(settings) {
  if (!elements.lobbyName) return;
  elements.lobbyName.value = settings.playerName;
  elements.lobbyBotSkill.value = settings.botSkill;
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Reconnecting is unavailable when storage is blocked.
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing else to clean up.
  }
}

export function hasActiveRoom() {
  return Boolean(view || loadSession());
}

export async function stopMultiplayer({ clearStoredSession = false, notifyServer = false } = {}) {
  shouldReconnect = false;
  setLeavePending(true);
  if (notifyServer && loadSession() && socket?.readyState === WebSocket.OPEN) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1200);
      resolveLeaveAck = () => {
        clearTimeout(timer);
        resolve();
      };
      send({ type: "leaveRoom" });
    });
    resolveLeaveAck = null;
  }
  if (clearStoredSession) clearSession();
  socket?.close();
  socket = null;
  view = null;
  selectedIds = new Set();
  exchangeSelectedIds = new Set();
  actionPending = false;
  setLeavePending(false);
  if (elements.mpExchangeDialog?.open) elements.mpExchangeDialog.close();
  if (elements.mpRoundDialog?.open) elements.mpRoundDialog.close();
  if (elements.joinPanel) {
    elements.joinPanel.hidden = false;
    elements.waitingPanel.hidden = true;
    elements.multiplayerLobby.hidden = false;
    elements.lobbyLeaveButton.textContent = "Terug";
    elements.lobbyLeaveButton.dataset.defaultText = "Terug";
    showError("");
  }
}

function setLeavePending(pending) {
  document.querySelectorAll("[data-multiplayer-leave]").forEach((button) => {
    button.disabled = pending;
    if (!button.dataset.defaultText) button.dataset.defaultText = button.textContent;
    button.textContent = pending ? "Verlaten..." : button.dataset.defaultText;
  });
}

function multiplayerSocketUrl() {
  if (location.hostname === "presidenten.fremeijer.net") {
    return "wss://samen.presidenten.fremeijer.net/multiplayer";
  }
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/multiplayer`;
}
