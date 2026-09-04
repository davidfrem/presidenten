import { bestCards, chooseBotPlay, createDeck, createRoleExchangeItems, isHighestRankPlay, isValidPlay, nextClockwisePlayerWithCards, ranks, sortHand } from "./game.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const deck = createDeck();
assert(deck.length === 32, "Deck should contain 32 cards.");
assert(ranks[0] === "7" && ranks.at(-1) === "A", "Rank order should be 7 through A.");

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

console.log("Engine tests passed.");
