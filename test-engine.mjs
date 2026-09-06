import { bestCards, chooseBotPlay, createBotObservation, createDeck, createRoleExchangeItems, isHighestRankPlay, isValidPlay, nextClockwisePlayerWithCards, ranks, sortHand } from "./game.js";
import { normalizeBotSkill, normalizePlayerName } from "./settings.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const deck = createDeck();
assert(deck.length === 32, "Deck should contain 32 cards.");
assert(ranks[0] === "7" && ranks.at(-1) === "A", "Rank order should be 7 through A.");
assert(normalizePlayerName("  Jan   de Vries  ") === "Jan de Vries", "Player names should be trimmed and normalized.");
assert(normalizePlayerName("12345678901234567890").length === 18, "Player names should be limited to eighteen characters.");
assert(normalizeBotSkill("normal") === "beginner" && normalizeBotSkill("unknown") === "beginner", "Legacy and invalid bot levels should fall back safely.");

const sevens = deck.filter((card) => card.rank === "7").slice(0, 2);
const eights = deck.filter((card) => card.rank === "8").slice(0, 2);
const singleAce = deck.find((card) => card.rank === "A");
const mixed = [deck.find((card) => card.rank === "7"), deck.find((card) => card.rank === "8")];

assert(isValidPlay(sevens, null), "A pair may open a trick.");
assert(!isValidPlay(mixed, null), "A mixed-rank play is invalid.");
assert(isValidPlay(eights, { cards: sevens, rankIndex: sevens[0].rankIndex }), "A higher pair beats a lower pair.");
assert(!isValidPlay([singleAce], { cards: sevens, rankIndex: sevens[0].rankIndex }), "A single cannot beat a pair.");
assert(!isValidPlay(sevens, { cards: eights, rankIndex: eights[0].rankIndex }), "A lower pair cannot beat a higher pair.");
assert(isHighestRankPlay([singleAce]), "An ace play should immediately close the trick.");
assert(isHighestRankPlay(deck.filter((card) => card.rank === "A").slice(0, 2)), "An ace pair should immediately close the trick.");

const clockwisePlayers = [0, 1, 2, 3].map((id) => ({ id, hand: [singleAce] }));
assert(nextClockwisePlayerWithCards(clockwisePlayers, 0) === 3, "Clockwise from the bottom player should go to the left player.");
assert(nextClockwisePlayerWithCards(clockwisePlayers, 3) === 2, "Clockwise from the left player should go to the top player.");
assert(nextClockwisePlayerWithCards([{ id: 0, hand: [singleAce] }, { id: 1, hand: [] }, { id: 2, hand: [singleAce] }, { id: 3, hand: [] }], 0) === 2, "Clockwise turn order should skip players without cards.");

const hand = sortHand([singleAce, ...sevens, ...eights]);
const bestTwo = bestCards(hand, 2);
assert(bestTwo.every((card) => card.rank === "A" || card.rank === "8"), "Best cards should come from the high end of the hand.");

const makeHand = (rankNames) => rankNames.map((rank, index) => deck.find((card) => card.rank === rank && card.suitIndex === index % 4));
const players = [
  { id: 0, role: "President", hand: makeHand(["7", "8", "9", "10", "J", "Q", "K", "A"]) },
  { id: 1, role: "Vice-president", hand: makeHand(["7", "7", "8", "9", "10", "J", "Q", "K"]) },
  { id: 2, role: "Vice-verliezer", hand: makeHand(["7", "8", "8", "9", "10", "J", "Q", "A"]) },
  { id: 3, role: "Verliezer", hand: makeHand(["7", "8", "9", "10", "J", "Q", "A", "A"]) }
];
const handSizesBeforeExchange = players.map((player) => player.hand.length);
const exchangeItems = createRoleExchangeItems(players);

assert(players.every((player, index) => player.hand.length === handSizesBeforeExchange[index]), "Planning role exchange must not add loser cards before the choice screen.");
assert(exchangeItems[0].fromId === 0 && exchangeItems[0].incomingCards.every((card) => card.rank === "A"), "President should receive the loser's original best two cards after choosing.");
assert(exchangeItems[1].fromId === 1 && exchangeItems[1].incomingCards[0].rank === "A", "Vice-president should receive the vice-loser's original best card after choosing.");

const botOpening = chooseBotPlay({ hand: sortHand(makeHand(["7", "8", "8", "9", "J", "Q", "K", "A"])) }, null);
assert(botOpening.length === 2 && botOpening.every((card) => card.rank === "8"), "Bot should open with a low pair when available.");

const botAceHeavyOpeningHand = { id: 1, hand: sortHand(makeHand(["7", "8", "9", "10", "J", "K", "A", "A"])) };
const mediumOpening = chooseBotPlay(botAceHeavyOpeningHand, null, { players: [botAceHeavyOpeningHand] }, "medium");
assert(!mediumOpening.every((card) => card.rank === "A"), "Medium bot should not open with aces early when lower options exist.");

const expertOpening = chooseBotPlay(botAceHeavyOpeningHand, null, { players: [botAceHeavyOpeningHand] }, "expert");
assert(!expertOpening.every((card) => card.rank === "A"), "Expert bot should not open with aces early when lower options exist.");

const expertDefenseHand = { id: 1, hand: sortHand(makeHand(["7", "8", "9", "10", "J", "A"])) };
const almostOutOpponent = { id: 2, hand: makeHand(["7"]) };
const expertDefense = chooseBotPlay(expertDefenseHand, { cards: makeHand(["K"]), rankIndex: ranks.indexOf("K") }, { players: [expertDefenseHand, almostOutOpponent] }, "expert");
assert(expertDefense?.[0].rank === "A", "Expert bot should spend an ace to block an opponent who is almost out.");

const observedBot = { id: 1, name: "Daan", role: "Burger", hand: sortHand(makeHand(["7", "8", "A"])), playedPile: makeHand(["9"]) };
const hiddenOpponent = { id: 2, name: "Sanne", role: "Burger", hand: sortHand(makeHand(["10", "J"])), playedPile: makeHand(["Q"]), finished: false };
const visibleQueen = hiddenOpponent.playedPile[0];
const observation = createBotObservation(
  observedBot,
  { playerId: hiddenOpponent.id, cards: [visibleQueen], rankIndex: visibleQueen.rankIndex },
  {
    players: [observedBot, hiddenOpponent],
    currentPlayerId: observedBot.id,
    lastPlayPlayerId: hiddenOpponent.id,
    passedPlayerIds: new Set([hiddenOpponent.id]),
    finishOrder: []
  }
);

assert(observation.players.every((player) => !("hand" in player)), "Bot observation must never expose opponent hands.");
assert(observation.players.find((player) => player.id === hiddenOpponent.id).cardCount === 2, "Bot observation should expose opponent card counts.");
assert(observation.players.find((player) => player.id === hiddenOpponent.id).passed, "Bot observation should expose public pass state.");
assert(observation.playedCards.length === 2, "A current play already present in a pile must not be counted twice.");
assert(observation.unseenRankCounts["7"] === 3 && observation.unseenRankCounts["A"] === 3, "Own cards must be removed from unseen rank counts.");
assert(observation.unseenRankCounts["9"] === 3 && observation.unseenRankCounts["Q"] === 3, "Played cards must be removed from unseen rank counts.");
assert(observation.unseenRankCounts["10"] === 4 && observation.unseenRankCounts["J"] === 4, "Hidden opponent cards must remain unseen.");

console.log("Engine tests passed.");
