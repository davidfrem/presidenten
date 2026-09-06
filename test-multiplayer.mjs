import {
  beginNextMultiplayerRound,
  chooseReturnExchange,
  confirmBestExchange,
  createMultiplayerGame,
  getMultiplayerView,
  passMultiplayerTurn,
  playMultiplayerCards
} from "./multiplayer-engine.js";
import { deserializeRoom, serializeRoom } from "./room-store.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const humans = [
  { seat: 0, token: "one", name: "David" },
  { seat: 3, token: "two", name: "Lisa" }
];
const game = createMultiplayerGame(humans, "medium", () => 0.42);

assert(game.players.length === 4, "A multiplayer game always needs four seats.");
assert(game.players.filter((player) => player.human).length === 2, "Human seats should be preserved.");
assert(game.players.filter((player) => !player.human).length === 2, "Empty seats should become bots.");
assert(game.players.every((player) => player.hand.length === 8), "Every player should receive eight cards.");

const view = getMultiplayerView(game, 0, { code: "ABCDE", isHost: true });
assert(view.hand.length === 8, "A player should receive their own hand.");
assert(view.players.every((player) => !("hand" in player)), "Opponent hands must not be sent in public player data.");

const activePlayer = game.players[game.currentPlayerId];
const openingCard = activePlayer.hand[0];
playMultiplayerCards(game, activePlayer.id, [openingCard.id]);
assert(game.currentPlay.cards[0].id === openingCard.id, "A valid opening should update the current play.");

const nextPlayer = game.players[game.currentPlayerId];
if (nextPlayer.human) {
  passMultiplayerTurn(game, nextPlayer.id);
  assert(game.passedPlayerIds.has(nextPlayer.id), "Passing should remain visible until that player's next turn.");
}

game.phase = "roundEnd";
game.finishOrder = [0, 1, 2, 3];
game.players.forEach((player, index) => {
  player.role = ["President", "Vice-president", "Vice-verliezer", "Verliezer"][index];
});
beginNextMultiplayerRound(game, () => 0.37);
assert(game.phase === "exchange", "A later round should start with role exchanges.");

const presidentPrompt = getMultiplayerView(game, 0, { code: "ABCDE", isHost: true }).exchangePrompt;
const loserPrompt = getMultiplayerView(game, 3, { code: "ABCDE", isHost: false }).exchangePrompt;
assert(presidentPrompt.type === "chooseReturn" && presidentPrompt.count === 2, "The president should choose two return cards.");
assert(loserPrompt.type === "forcedBest" && loserPrompt.cardIds.length === 2, "The loser should see the two forced best cards.");

const presidentReturn = game.players[0].hand.slice(0, 2).map((card) => card.id);
confirmBestExchange(game, 3);
chooseReturnExchange(game, 0, presidentReturn);
assert(game.phase === "playing", "Automatic bot exchange should finish after both humans confirm.");
assert(game.players.every((player) => player.hand.length === 8), "Role exchange must preserve every hand size.");

const storedRoom = serializeRoom({
  code: "ABCDE",
  hostToken: "one",
  botSkill: "medium",
  humans,
  sockets: new Map(),
  game
}, new Date("2026-09-06T10:00:00Z"));
const restoredRoom = deserializeRoom(storedRoom);
assert(restoredRoom.game.passedPlayerIds instanceof Set, "Restored room state should recreate passed-player sets.");
assert(restoredRoom.sockets instanceof Map && restoredRoom.sockets.size === 0, "Live sockets must never be persisted.");
assert(restoredRoom.humans.every((human) => !human.connected), "Restored players should reconnect explicitly.");
assert(storedRoom.expiresAt > storedRoom.updatedAt, "Stored rooms should receive an expiry time.");

console.log("Multiplayer engine tests passed.");
