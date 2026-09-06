import {
  bestCards,
  chooseBotPlay,
  createDeck,
  isHighestRankPlay,
  isValidPlay,
  nextClockwisePlayerWithCards,
  shuffle,
  sortHand
} from "./game.js";

export const multiplayerRoleNames = ["President", "Vice-president", "Vice-verliezer", "Verliezer"];
const botNames = ["Sanne", "Daan", "Emma", "Noor"];

function removeCards(hand, cards) {
  const ids = new Set(cards.map((card) => card.id));
  return hand.filter((card) => !ids.has(card.id));
}

function deal(players, random = Math.random) {
  const deck = shuffle(createDeck(), random);
  players.forEach((player) => {
    player.hand = [];
    player.playedPile = [];
    player.finished = false;
  });
  deck.forEach((card, index) => players[index % 4].hand.push(card));
  players.forEach((player) => {
    player.hand = sortHand(player.hand);
  });
}

function countPlayersWithCards(players) {
  return players.filter((player) => player.hand.length > 0).length;
}

function worstCards(hand, count) {
  return [...hand]
    .sort((a, b) => a.rankIndex - b.rankIndex || a.suitIndex - b.suitIndex)
    .slice(0, count);
}

function transfer(from, to, cards) {
  from.hand = sortHand(removeCards(from.hand, cards));
  to.hand = sortHand([...to.hand, ...cards]);
}

function formatCards(cards) {
  return `${cards.length}x ${cards[0].rank}`;
}

function log(game, message) {
  game.log.unshift(message);
  game.log = game.log.slice(0, 30);
}

function createPlayer(seat, input = {}) {
  return {
    id: seat,
    name: input.name ?? botNames[seat] ?? `Bot ${seat + 1}`,
    role: input.role ?? "Burger",
    human: Boolean(input.human),
    token: input.token ?? null,
    connected: Boolean(input.connected),
    hand: [],
    playedPile: [],
    finished: false
  };
}

export function createMultiplayerGame(humans, botSkill = "beginner", random = Math.random) {
  const usedNames = new Set(humans.map((human) => human.name));
  const players = Array.from({ length: 4 }, (_, seat) => {
    const human = humans.find((item) => item.seat === seat);
    if (human) return createPlayer(seat, { ...human, human: true, connected: true });
    const name = botNames.find((candidate) => !usedNames.has(candidate)) ?? `Bot ${seat + 1}`;
    usedNames.add(name);
    return createPlayer(seat, { name });
  });
  const dealer = Math.floor(random() * 4);
  deal(players, random);
  const openerId = nextClockwisePlayerWithCards(players, dealer);
  return {
    players,
    botSkill,
    round: 1,
    dealer,
    phase: "playing",
    currentPlayerId: openerId,
    currentPlay: null,
    lastPlayPlayerId: null,
    consecutivePasses: 0,
    passedPlayerIds: new Set(),
    finishOrder: [],
    log: [`${players[openerId].name} komt uit.`],
    exchangeQueue: [],
    currentExchange: null
  };
}

export function playMultiplayerCards(game, playerId, cardIds) {
  if (game.phase !== "playing") throw new Error("Er wordt nu niet gespeeld.");
  if (game.currentPlayerId !== playerId) throw new Error("Je bent niet aan de beurt.");
  const player = game.players[playerId];
  const uniqueIds = new Set(cardIds);
  const cards = player.hand.filter((card) => uniqueIds.has(card.id));
  if (cards.length !== cardIds.length || !isValidPlay(cards, game.currentPlay)) {
    throw new Error("Deze kaarten kunnen nu niet worden gespeeld.");
  }

  player.hand = sortHand(removeCards(player.hand, cards));
  player.playedPile.push(...cards);
  game.currentPlay = { playerId, cards, rankIndex: cards[0].rankIndex };
  game.lastPlayPlayerId = playerId;
  game.consecutivePasses = 0;
  log(game, `${player.name} speelt ${formatCards(cards)}.`);

  if (player.hand.length === 0) {
    player.finished = true;
    game.passedPlayerIds.delete(playerId);
    game.finishOrder.push(playerId);
    log(game, `${player.name} is uit.`);
  }

  advanceTurn(game, playerId, isHighestRankPlay(cards));
  return cards;
}

export function passMultiplayerTurn(game, playerId) {
  if (game.phase !== "playing") throw new Error("Er wordt nu niet gespeeld.");
  if (game.currentPlayerId !== playerId) throw new Error("Je bent niet aan de beurt.");
  if (!game.currentPlay) throw new Error("Je kunt niet passen als je uitkomt.");
  game.consecutivePasses += 1;
  game.passedPlayerIds.add(playerId);
  log(game, `${game.players[playerId].name} past.`);
  advanceTurn(game, playerId);
}

function advanceTurn(game, playerId, forceTrickWin = false) {
  const remaining = countPlayersWithCards(game.players);
  if (remaining <= 1) {
    const last = game.players.find((player) => player.hand.length > 0);
    if (last && !game.finishOrder.includes(last.id)) game.finishOrder.push(last.id);
    game.currentPlayerId = null;
    game.phase = "roundEnd";
    multiplayerRoleNames.forEach((role, index) => {
      game.players[game.finishOrder[index]].role = role;
    });
    log(game, "Ronde afgelopen.");
    return;
  }

  const passTarget = Math.max(0, remaining - 1);
  if (game.currentPlay && (forceTrickWin || game.consecutivePasses >= passTarget)) {
    const opener = game.players[game.lastPlayPlayerId].hand.length > 0
      ? game.lastPlayPlayerId
      : nextClockwisePlayerWithCards(game.players, game.lastPlayPlayerId);
    game.currentPlay = null;
    game.consecutivePasses = 0;
    game.currentPlayerId = opener;
    log(game, `${game.players[opener].name} wint de slag en komt uit.`);
  } else {
    game.currentPlayerId = nextClockwisePlayerWithCards(game.players, playerId);
  }
  if (game.currentPlayerId !== null) game.passedPlayerIds.delete(game.currentPlayerId);
}

export function playBotTurn(game) {
  if (game.phase !== "playing") return false;
  const player = game.players[game.currentPlayerId];
  if (!player || player.human) return false;
  const cards = chooseBotPlay(player, game.currentPlay, game, game.botSkill);
  if (cards) playMultiplayerCards(game, player.id, cards.map((card) => card.id));
  else passMultiplayerTurn(game, player.id);
  return true;
}

export function beginNextMultiplayerRound(game, random = Math.random) {
  if (game.phase !== "roundEnd") throw new Error("De ronde is nog niet afgelopen.");
  const loserId = game.finishOrder[3];
  deal(game.players, random);
  game.round += 1;
  game.phase = "exchange";
  game.currentPlayerId = loserId;
  game.currentPlay = null;
  game.lastPlayPlayerId = null;
  game.consecutivePasses = 0;
  game.passedPlayerIds = new Set();
  game.finishOrder = [];
  game.log = [`${game.players[loserId].name} komt straks uit als verliezer.`];

  const president = game.players.find((player) => player.role === "President");
  const vicePresident = game.players.find((player) => player.role === "Vice-president");
  const viceLoser = game.players.find((player) => player.role === "Vice-verliezer");
  const loser = game.players.find((player) => player.role === "Verliezer");
  game.exchangeQueue = [
    createExchange(president, loser, 2),
    createExchange(vicePresident, viceLoser, 1)
  ];
  game.currentExchange = null;
  advanceExchange(game);
}

function createExchange(highPlayer, lowPlayer, count) {
  return {
    highPlayerId: highPlayer.id,
    lowPlayerId: lowPlayer.id,
    count,
    bestCardIds: bestCards(lowPlayer.hand, count).map((card) => card.id),
    bestConfirmed: !lowPlayer.human,
    returnCardIds: highPlayer.human ? null : worstCards(highPlayer.hand, count).map((card) => card.id)
  };
}

function advanceExchange(game) {
  if (!game.currentExchange) game.currentExchange = game.exchangeQueue.shift() ?? null;
  const exchange = game.currentExchange;
  if (!exchange) {
    game.phase = "playing";
    log(game, `${game.players[game.currentPlayerId].name} komt uit als verliezer.`);
    return;
  }
  if (!exchange.bestConfirmed || !exchange.returnCardIds) return;

  const high = game.players[exchange.highPlayerId];
  const low = game.players[exchange.lowPlayerId];
  const outgoing = high.hand.filter((card) => exchange.returnCardIds.includes(card.id));
  const incoming = low.hand.filter((card) => exchange.bestCardIds.includes(card.id));
  transfer(high, low, outgoing);
  transfer(low, high, incoming);
  log(game, `${high.name} en ${low.name} wisselen ${exchange.count} kaart${exchange.count > 1 ? "en" : ""}.`);
  game.currentExchange = null;
  advanceExchange(game);
}

export function confirmBestExchange(game, playerId) {
  const exchange = game.currentExchange;
  if (game.phase !== "exchange" || !exchange || exchange.lowPlayerId !== playerId) {
    throw new Error("Je hoeft nu geen kaarten af te geven.");
  }
  exchange.bestConfirmed = true;
  advanceExchange(game);
}

export function chooseReturnExchange(game, playerId, cardIds) {
  const exchange = game.currentExchange;
  if (game.phase !== "exchange" || !exchange || exchange.highPlayerId !== playerId) {
    throw new Error("Je hoeft nu geen kaarten terug te geven.");
  }
  const uniqueIds = new Set(cardIds);
  const validCount = cardIds.length === exchange.count && uniqueIds.size === exchange.count;
  const ownsCards = cardIds.every((id) => game.players[playerId].hand.some((card) => card.id === id));
  if (!validCount || !ownsCards) throw new Error(`Kies precies ${exchange.count} kaart${exchange.count > 1 ? "en" : ""}.`);
  exchange.returnCardIds = cardIds;
  advanceExchange(game);
}

export function getMultiplayerView(game, viewerId, roomInfo) {
  const viewer = game.players[viewerId];
  const exchange = game.currentExchange;
  let exchangePrompt = null;
  if (game.phase === "exchange" && exchange) {
    if (exchange.lowPlayerId === viewerId && !exchange.bestConfirmed) {
      exchangePrompt = {
        type: "forcedBest",
        count: exchange.count,
        otherName: game.players[exchange.highPlayerId].name,
        cardIds: exchange.bestCardIds
      };
    } else if (exchange.highPlayerId === viewerId && !exchange.returnCardIds) {
      exchangePrompt = {
        type: "chooseReturn",
        count: exchange.count,
        otherName: game.players[exchange.lowPlayerId].name
      };
    } else {
      exchangePrompt = { type: "waiting" };
    }
  }

  return {
    type: "state",
    room: roomInfo,
    phase: game.phase,
    round: game.round,
    viewerId,
    currentPlayerId: game.currentPlayerId,
    currentPlay: game.currentPlay,
    lastPlayPlayerId: game.lastPlayPlayerId,
    passedPlayerIds: [...game.passedPlayerIds],
    finishOrder: game.finishOrder,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      role: player.role,
      human: player.human,
      connected: player.human ? player.connected : true,
      handCount: player.hand.length,
      playedPile: player.playedPile,
      finished: player.finished
    })),
    hand: viewer.hand,
    log: game.log,
    exchangePrompt
  };
}
