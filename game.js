export const ranks = ["7", "8", "9", "10", "J", "Q", "K", "A"];
export const suits = [
  { id: "clubs", label: "♣", red: false },
  { id: "diamonds", label: "♦", red: true },
  { id: "hearts", label: "♥", red: true },
  { id: "spades", label: "♠", red: false }
];

const roleNames = ["President", "Vice-president", "Vice-verliezer", "Verliezer"];
const SETTINGS_KEY = "presidenten.settings";
const defaultSettings = {
  playerName: "Jij",
  botSkill: "normal"
};
const botNames = ["Sanne", "Daan", "Emma"];
const playerIcons = ["👤", "🧢", "🎧", "⭐"];
let settings = { ...defaultSettings };

export function createDeck() {
  return ranks.flatMap((rank, rankIndex) =>
    suits.map((suit, suitIndex) => ({
      id: `${rank}-${suit.id}`,
      rank,
      rankIndex,
      suit: suit.label,
      suitIndex,
      red: suit.red
    }))
  );
}

export function shuffle(cards, random = Math.random) {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function sortHand(hand) {
  return [...hand].sort((a, b) => a.rankIndex - b.rankIndex || a.suitIndex - b.suitIndex);
}

export function isValidPlay(cards, currentPlay) {
  if (cards.length < 1 || cards.length > 4) return false;
  const firstRank = cards[0].rankIndex;
  if (!cards.every((card) => card.rankIndex === firstRank)) return false;
  if (!currentPlay) return true;
  return cards.length === currentPlay.cards.length && firstRank > currentPlay.rankIndex;
}

export function isHighestRankPlay(cards) {
  return cards.length > 0 && cards[0].rankIndex === ranks.length - 1;
}

export function bestCards(hand, count) {
  return [...hand]
    .sort((a, b) => b.rankIndex - a.rankIndex || b.suitIndex - a.suitIndex)
    .slice(0, count);
}

function removeCards(hand, cards) {
  const ids = new Set(cards.map((card) => card.id));
  return hand.filter((card) => !ids.has(card.id));
}

function getPlayerNames() {
  return [settings.playerName, ...botNames];
}

function createPlayers(previousRoles = null) {
  return getPlayerNames().map((name, index) => ({
    id: index,
    name,
    role: previousRoles?.[index] ?? "Burger",
    hand: [],
    playedPile: [],
    finished: false
  }));
}

function deal(players) {
  const deck = shuffle(createDeck());
  players.forEach((player) => {
    player.hand = [];
    player.playedPile = [];
    player.finished = false;
  });
  deck.forEach((card, index) => {
    players[index % 4].hand.push(card);
  });
  players.forEach((player) => {
    player.hand = sortHand(player.hand);
  });
}

export function nextClockwisePlayerWithCards(players, fromPlayerId) {
  for (let step = 1; step <= players.length; step += 1) {
    const player = players[(fromPlayerId - step + players.length) % players.length];
    if (player.hand.length > 0) return player.id;
  }
  return null;
}

function countPlayersWithCards(players) {
  return players.filter((player) => player.hand.length > 0).length;
}

function groupByRank(hand) {
  return hand.reduce((groups, card) => {
    groups[card.rank] ||= [];
    groups[card.rank].push(card);
    return groups;
  }, {});
}

export function chooseBotPlay(player, currentPlay) {
  const groups = Object.values(groupByRank(player.hand));
  if (!currentPlay) {
    const duplicateOpenings = groups
      .filter((group) => group.length > 1)
      .sort((a, b) => a[0].rankIndex - b[0].rankIndex || b.length - a.length);

    if (duplicateOpenings.length) return duplicateOpenings[0];

    return groups
      .map((group) => group.slice(0, 1))
      .sort((a, b) => a[0].rankIndex - b[0].rankIndex)[0] ?? null;
  }

  const options = groups
    .flatMap((group) => {
      const plays = [];
      const maxSize = currentPlay.cards.length;
      for (let size = 1; size <= Math.min(group.length, maxSize); size += 1) {
        const cards = group.slice(0, size);
        if (isValidPlay(cards, currentPlay)) plays.push(cards);
      }
      return plays;
    })
    .sort((a, b) => a[0].rankIndex - b[0].rankIndex || a.length - b.length);

  if (!options.length) return null;

  const finishingPlay = options.find((cards) => cards.length === player.hand.length);
  if (finishingPlay) return finishingPlay;

  return options[0];
}

let state = null;
let selectedIds = new Set();
let exchange = null;

function loadSettings() {
  if (typeof localStorage === "undefined") return { ...defaultSettings };

  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return normalizeSettings({ ...defaultSettings, ...stored });
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(nextSettings) {
  settings = normalizeSettings({ ...defaultSettings, ...nextSettings });
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Safari can block storage in some restricted modes; keep the session setting.
    }
  }
}

function hasStoredSettings() {
  if (typeof localStorage === "undefined") return false;

  try {
    return localStorage.getItem(SETTINGS_KEY) !== null;
  } catch {
    return false;
  }
}

function normalizeSettings(nextSettings) {
  return {
    playerName: normalizePlayerName(nextSettings.playerName),
    botSkill: nextSettings.botSkill === "normal" ? "normal" : defaultSettings.botSkill
  };
}

function normalizePlayerName(name) {
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  return clean || defaultSettings.playerName;
}

function createInitialState() {
  const dealer = Math.floor(Math.random() * 4);
  const players = createPlayers();
  deal(players);
  const openerId = nextClockwisePlayerWithCards(players, dealer);
  return {
    players,
    round: 1,
    dealer,
    currentPlayerId: openerId,
    currentPlay: null,
    lastPlayPlayerId: null,
    consecutivePasses: 0,
    passedPlayerIds: new Set(),
    finishOrder: [],
    log: [`${players[openerId].name} komt uit.`],
    awaitingExchange: false
  };
}

function startRoundFromPrevious() {
  const previousRoles = {};
  state.finishOrder.forEach((playerId, index) => {
    previousRoles[playerId] = roleNames[index];
  });

  const loserId = state.finishOrder[3];
  const players = createPlayers(previousRoles);
  deal(players);
  state = {
    players,
    round: state.round + 1,
    dealer: state.dealer,
    currentPlayerId: loserId,
    currentPlay: null,
    lastPlayPlayerId: null,
    consecutivePasses: 0,
    passedPlayerIds: new Set(),
    finishOrder: [],
    log: [`${players[loserId].name} komt uit als verliezer.`],
    awaitingExchange: true
  };

  applyForcedTrade();
}

function applyForcedTrade() {
  const exchangeItems = createRoleExchangeItems(state.players);
  if (!exchangeItems.length) {
    state.awaitingExchange = false;
    return;
  }

  queueChoiceExchange(exchangeItems);
}

export function createRoleExchangeItems(players) {
  const president = players.find((player) => player.role === "President");
  const vicePresident = players.find((player) => player.role === "Vice-president");
  const viceLoser = players.find((player) => player.role === "Vice-verliezer");
  const loser = players.find((player) => player.role === "Verliezer");

  if (!president || !vicePresident || !viceLoser || !loser) return [];

  return [
    { fromId: president.id, toId: loser.id, count: 2, incomingCards: bestCards(loser.hand, 2) },
    { fromId: vicePresident.id, toId: viceLoser.id, count: 1, incomingCards: bestCards(viceLoser.hand, 1) }
  ];
}

function transfer(from, to, cards) {
  from.hand = sortHand(removeCards(from.hand, cards));
  to.hand = sortHand([...to.hand, ...cards]);
}

function queueChoiceExchange(items) {
  const next = items.shift();
  if (!next) {
    state.awaitingExchange = false;
    render();
    maybeRunBots();
    return;
  }

  const from = state.players[next.fromId];
  const to = state.players[next.toId];
  if (from.id === 0) {
    exchange = { ...next, remaining: items, selected: new Set() };
    renderExchange(from, to, next.count);
  } else {
    const cards = worstCards(from.hand, next.count);
    transfer(from, to, cards);
    state.log.unshift(`${from.name} geeft ${next.count} kaart${next.count > 1 ? "en" : ""} terug.`);
    receiveBestCards(to, from, next.incomingCards);
    queueChoiceExchange(items);
  }
}

function worstCards(hand, count) {
  return [...hand]
    .sort((a, b) => a.rankIndex - b.rankIndex || a.suitIndex - b.suitIndex)
    .slice(0, count);
}

function receiveBestCards(from, to, incomingCards) {
  const cards = incomingCards.filter((card) => from.hand.some((heldCard) => heldCard.id === card.id));
  transfer(from, to, cards);
  state.log.unshift(`${to.name} ontvangt ${cards.length} beste kaart${cards.length > 1 ? "en" : ""}.`);
}

function playCards(playerId, cards) {
  const player = state.players[playerId];
  if (!isValidPlay(cards, state.currentPlay)) return false;

  player.hand = sortHand(removeCards(player.hand, cards));
  player.playedPile = [...player.playedPile, ...cards];
  state.currentPlay = { playerId, cards, rankIndex: cards[0].rankIndex };
  state.lastPlayPlayerId = playerId;
  state.consecutivePasses = 0;
  state.log.unshift(`${player.name} speelt ${formatCards(cards)}.`);

  if (player.hand.length === 0) {
    player.finished = true;
    state.passedPlayerIds.delete(playerId);
    state.finishOrder.push(playerId);
    state.log.unshift(`${player.name} is uit.`);
  }

  advanceTurnAfterAction(playerId, isHighestRankPlay(cards));
  return true;
}

function passTurn(playerId) {
  if (!state.currentPlay) return false;
  state.consecutivePasses += 1;
  state.passedPlayerIds.add(playerId);
  state.log.unshift(`${state.players[playerId].name} past.`);
  advanceTurnAfterAction(playerId);
  return true;
}

function advanceTurnAfterAction(playerId, forceTrickWin = false) {
  const remaining = countPlayersWithCards(state.players);
  if (remaining <= 1) {
    const last = state.players.find((player) => player.hand.length > 0);
    if (last && !state.finishOrder.includes(last.id)) state.finishOrder.push(last.id);
    state.currentPlayerId = null;
    state.log.unshift("Ronde afgelopen.");
    setTimeout(showRoundDialog, 250);
    render();
    return;
  }

  const passTarget = Math.max(0, remaining - 1);
  if (state.currentPlay && (forceTrickWin || state.consecutivePasses >= passTarget)) {
    const opener = state.players[state.lastPlayPlayerId].hand.length > 0
      ? state.lastPlayPlayerId
      : nextClockwisePlayerWithCards(state.players, state.lastPlayPlayerId);
    state.currentPlay = null;
    state.consecutivePasses = 0;
    state.currentPlayerId = opener;
    state.log.unshift(`${state.players[opener].name} wint de slag en komt uit.`);
  } else {
    state.currentPlayerId = nextClockwisePlayerWithCards(state.players, playerId);
  }

  if (state.currentPlayerId !== null) {
    state.passedPlayerIds.delete(state.currentPlayerId);
  }

  render();
  maybeRunBots();
}

function maybeRunBots() {
  if (state.awaitingExchange || state.currentPlayerId === null || state.currentPlayerId === 0) return;
  setTimeout(() => {
    const player = state.players[state.currentPlayerId];
    const cards = chooseBotPlay(player, state.currentPlay);
    if (cards) {
      playCards(player.id, cards);
    } else {
      passTurn(player.id);
    }
  }, 650);
}

function formatCards(cards) {
  return `${cards.length}x ${cards[0].rank}`;
}

function render() {
  renderPlayers();
  renderHand();
  renderLog();
  updateControls();
}

function renderPlayers() {
  state.players.forEach((player) => {
    const node = document.getElementById(`player-${player.id}`);
    if (!node) return;
    const roundRole = getCurrentRoundRole(player.id);
    node.classList.toggle("is-turn", state.currentPlayerId === player.id);
    node.classList.toggle("has-finished", Boolean(roundRole));

    if (player.id === 0) {
      document.getElementById("humanName").textContent = player.name;
      document.getElementById("humanRole").textContent = roundRole ? "Uit" : player.role;
      document.getElementById("humanFinishBadge").textContent = roundRole ?? "";
      document.getElementById("humanFinishBadge").classList.toggle("is-visible", Boolean(roundRole));
      document.getElementById("humanPassBadge").classList.toggle("is-visible", state.passedPlayerIds.has(player.id));
      renderPlayedPile(document.getElementById("humanPlayedPile"), player);
      return;
    }

    const backs = Array.from({ length: player.hand.length }, () => '<span class="card-back"></span>').join("");
    node.innerHTML = `
      <div class="player-row">
        <span class="player-avatar">${playerIcons[player.id]}</span>
        <div class="player-meta">
          <span class="player-name">${player.name}</span>
          <span class="player-role">${roundRole ? "Uit" : `${player.role} - ${player.hand.length} kaart${player.hand.length === 1 ? "" : "en"}`}</span>
        </div>
        <span class="turn-badge">Beurt</span>
        <span class="finish-badge${roundRole ? " is-visible" : ""}">${roundRole ?? ""}</span>
        <span class="pass-badge${state.passedPlayerIds.has(player.id) ? " is-visible" : ""}">Pas</span>
      </div>
      <div class="card-backs" aria-hidden="true">${backs}</div>
      <div class="personal-pile-wrap">
        <div class="played-pile" id="played-pile-${player.id}"></div>
      </div>
    `;
    renderPlayedPile(document.getElementById(`played-pile-${player.id}`), player);
  });

  document.getElementById("roundLabel").textContent = `Ronde ${state.round}`;
  document.getElementById("turnHint").textContent = getTurnHint();
  document.getElementById("player-0").classList.toggle("is-turn", state.currentPlayerId === 0);
}

function getCurrentRoundRole(playerId) {
  const finishIndex = state.finishOrder.indexOf(playerId);
  return finishIndex === -1 ? null : roleNames[finishIndex];
}

function renderHand() {
  const hand = document.getElementById("hand");
  hand.innerHTML = "";
  state.players[0].hand.forEach((card) => {
    const button = renderCard(card);
    button.classList.toggle("selected", selectedIds.has(card.id));
    button.disabled = state.currentPlayerId !== 0;
    button.classList.toggle("disabled", state.currentPlayerId !== 0);
    button.addEventListener("click", () => {
      if (selectedIds.has(card.id)) selectedIds.delete(card.id);
      else selectedIds.add(card.id);
      render();
    });
    hand.append(button);
  });
}

function renderCard(card) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card${card.red ? " red" : ""}`;
  button.dataset.cardId = card.id;
  button.innerHTML = `<span class="card-rank">${card.rank}</span><span class="card-suit">${card.suit}</span>`;
  return button;
}

function renderPlayedPile(node, player) {
  const cards = player.playedPile;
  const activeIds = state.currentPlay?.playerId === player.id
    ? new Set(state.currentPlay.cards.map((card) => card.id))
    : new Set();

  node.innerHTML = "";
  if (!cards.length) return;

  [...cards].reverse().forEach((card) => {
    const item = document.createElement("span");
    item.className = `pile-card${card.red ? " red" : ""}`;
    item.classList.toggle("latest-play", activeIds.has(card.id));
    item.innerHTML = `<span class="pile-card-rank">${card.rank}</span><span class="pile-card-suit">${card.suit}</span>`;
    node.append(item);
  });
}

function renderLog() {
  const log = document.getElementById("activityLog");
  log.innerHTML = state.log.slice(0, 6).map((item) => `<li>${item}</li>`).join("");
}

function getTurnHint() {
  if (state.currentPlayerId !== 0) return "";
  if (!state.currentPlay) return `${state.players[0].name} komt uit`;
  return `Speel ${state.currentPlay.cards.length} hoger of pas`;
}

function updateControls() {
  const selectedCards = state.players[0].hand.filter((card) => selectedIds.has(card.id));
  document.getElementById("playButton").disabled = state.currentPlayerId !== 0 || !isValidPlay(selectedCards, state.currentPlay);
  document.getElementById("passButton").disabled = state.currentPlayerId !== 0 || !state.currentPlay || selectedIds.size > 0;
}

function renderExchange(from, to, count) {
  const dialog = document.getElementById("exchangeDialog");
  document.getElementById("exchangeTitle").textContent = `${from.role}: kaarten teruggeven`;
  document.getElementById("exchangeText").textContent = `Kies ${count} kaart${count > 1 ? "en" : ""} die naar ${to.name} gaan.`;
  const hand = document.getElementById("exchangeHand");
  hand.innerHTML = "";
  from.hand.forEach((card) => {
    const button = renderCard(card);
    button.classList.toggle("selected", exchange.selected.has(card.id));
    button.addEventListener("click", () => {
      if (exchange.selected.has(card.id)) {
        exchange.selected.delete(card.id);
      } else if (exchange.selected.size < count) {
        exchange.selected.add(card.id);
      }
      document.getElementById("exchangeConfirm").disabled = exchange.selected.size !== count;
      renderExchange(from, to, count);
    });
    hand.append(button);
  });
  document.getElementById("exchangeConfirm").disabled = exchange.selected.size !== count;
  if (!dialog.open) dialog.showModal();
}

function showRoundDialog() {
  const dialog = document.getElementById("roundDialog");
  const list = document.getElementById("resultsList");
  list.innerHTML = state.finishOrder
    .map((playerId, index) => `
      <div class="result-row">
        <strong>${roleNames[index]}</strong>
        <span>${state.players[playerId].name}</span>
      </div>
    `)
    .join("");
  if (!dialog.open) dialog.showModal();
}

function showSettingsDialog() {
  const dialog = document.getElementById("settingsDialog");
  document.getElementById("playerNameInput").value = settings.playerName === defaultSettings.playerName ? "" : settings.playerName;
  document.getElementById("botSkillSelect").value = settings.botSkill;
  if (!dialog.open) dialog.showModal();
}

function applySettingsFromForm() {
  const playerName = document.getElementById("playerNameInput").value;
  const botSkill = document.getElementById("botSkillSelect").value;
  saveSettings({ playerName, botSkill });

  if (state?.players?.[0]) {
    state.players[0].name = settings.playerName;
  }

  render();
}

function initBrowserGame() {
  const shouldAskSettings = !hasStoredSettings();
  settings = loadSettings();
  state = createInitialState();

  document.getElementById("playButton").addEventListener("click", () => {
    const cards = state.players[0].hand.filter((card) => selectedIds.has(card.id));
    selectedIds = new Set();
    playCards(0, cards);
  });

  document.getElementById("passButton").addEventListener("click", () => {
    if (selectedIds.size > 0) return;
    selectedIds = new Set();
    passTurn(0);
  });

  document.getElementById("newGameButton").addEventListener("click", () => {
    selectedIds = new Set();
    state = createInitialState();
    document.getElementById("roundDialog").close();
    render();
    maybeRunBots();
  });

  document.getElementById("settingsButton").addEventListener("click", () => {
    showSettingsDialog();
  });

  document.getElementById("settingsCancel").addEventListener("click", () => {
    document.getElementById("settingsDialog").close();
    maybeRunBots();
  });

  document.getElementById("settingsForm").addEventListener("submit", () => {
    applySettingsFromForm();
    maybeRunBots();
  });

  document.getElementById("continueButton").addEventListener("click", () => {
    selectedIds = new Set();
    document.getElementById("roundDialog").close();
    startRoundFromPrevious();
  });

  document.getElementById("exchangeConfirm").addEventListener("click", () => {
    const from = state.players[exchange.fromId];
    const to = state.players[exchange.toId];
    const cards = from.hand.filter((card) => exchange.selected.has(card.id));
    transfer(from, to, cards);
    state.log.unshift(`${from.name} geeft ${cards.length} kaart${cards.length > 1 ? "en" : ""} terug.`);
    receiveBestCards(to, from, exchange.incomingCards);
    document.getElementById("exchangeDialog").close();
    const remaining = exchange.remaining;
    exchange = null;
    queueChoiceExchange(remaining);
  });

  render();
  if (shouldAskSettings) {
    showSettingsDialog();
  } else {
    maybeRunBots();
  }
}

if (typeof document !== "undefined") {
  initBrowserGame();
}
