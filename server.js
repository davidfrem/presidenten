import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import {
  beginNextMultiplayerRound,
  chooseReturnExchange,
  confirmBestExchange,
  createMultiplayerGame,
  getMultiplayerView,
  passMultiplayerTurn,
  playBotTurn,
  playMultiplayerCards
} from "./multiplayer-engine.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const rooms = new Map();
const sessions = new Map();
const botTimers = new Map();
const publicFiles = new Set([
  "/index.html",
  "/multiplayer.html",
  "/styles.css",
  "/game.js",
  "/multiplayer.js",
  "/service-worker.js",
  "/manifest.webmanifest"
]);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8"
};

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (requestUrl.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }

  const pathname = requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
  if (!publicFiles.has(pathname) && !pathname.startsWith("/icons/")) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Niet gevonden");
    return;
  }
  const filePath = path.resolve(root, `.${pathname}`);
  if (!filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Niet gevonden");
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream"
    });
    response.end(data);
  });
});

const websocketServer = new WebSocketServer({ server, path: "/multiplayer", maxPayload: 64 * 1024 });

websocketServer.on("connection", (socket) => {
  socket.on("message", (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      handleMessage(socket, message);
    } catch (error) {
      send(socket, { type: "error", message: error.message || "Ongeldig verzoek." });
    }
  });

  socket.on("close", () => disconnect(socket));
  send(socket, { type: "connected" });
});

function handleMessage(socket, message) {
  if (message.type === "createRoom") return createRoom(socket, message);
  if (message.type === "joinRoom") return joinRoom(socket, message);
  if (message.type === "reconnect") return reconnect(socket, message);

  const session = sessions.get(socket);
  if (!session) throw new Error("Maak eerst een kamer of neem deel.");
  const room = rooms.get(session.roomCode);
  if (!room) throw new Error("Deze kamer bestaat niet meer.");

  if (message.type === "startGame") return startGame(room, session);
  if (message.type === "play") return playerAction(room, session, () => playMultiplayerCards(room.game, session.seat, message.cardIds || []));
  if (message.type === "pass") return playerAction(room, session, () => passMultiplayerTurn(room.game, session.seat));
  if (message.type === "confirmBest") return playerAction(room, session, () => confirmBestExchange(room.game, session.seat));
  if (message.type === "chooseReturn") return playerAction(room, session, () => chooseReturnExchange(room.game, session.seat, message.cardIds || []));
  if (message.type === "nextRound") return nextRound(room, session);
  throw new Error("Onbekende actie.");
}

function createRoom(socket, message) {
  disconnect(socket);
  const code = createRoomCode();
  const token = crypto.randomUUID();
  const human = { seat: 0, token, name: normalizeName(message.name), connected: true };
  const room = {
    code,
    hostToken: token,
    botSkill: normalizeSkill(message.botSkill),
    humans: [human],
    sockets: new Map([[token, socket]]),
    game: null
  };
  rooms.set(code, room);
  sessions.set(socket, { roomCode: code, token, seat: 0 });
  send(socket, { type: "joined", code, token, seat: 0 });
  broadcastRoom(room);
}

function joinRoom(socket, message) {
  disconnect(socket);
  const code = String(message.code || "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) throw new Error("Kamer niet gevonden.");
  if (room.game) throw new Error("Dit spel is al begonnen.");
  if (room.humans.length >= 4) throw new Error("Deze kamer is vol.");
  const seat = [0, 1, 2, 3].find((candidate) => !room.humans.some((human) => human.seat === candidate));
  const token = crypto.randomUUID();
  const human = { seat, token, name: normalizeName(message.name), connected: true };
  room.humans.push(human);
  room.sockets.set(token, socket);
  sessions.set(socket, { roomCode: code, token, seat });
  send(socket, { type: "joined", code, token, seat });
  broadcastRoom(room);
}

function reconnect(socket, message) {
  disconnect(socket);
  const code = String(message.code || "").trim().toUpperCase();
  const room = rooms.get(code);
  const human = room?.humans.find((item) => item.token === message.token);
  if (!room || !human) throw new Error("Je vorige speelsessie is niet meer beschikbaar.");
  const oldSocket = room.sockets.get(human.token);
  if (oldSocket && oldSocket !== socket) {
    sessions.delete(oldSocket);
    oldSocket.close(1000, "Nieuwe verbinding");
  }
  human.connected = true;
  room.sockets.set(human.token, socket);
  sessions.set(socket, { roomCode: code, token: human.token, seat: human.seat });
  if (room.game) room.game.players[human.seat].connected = true;
  send(socket, { type: "joined", code, token: human.token, seat: human.seat });
  broadcastRoom(room);
}

function startGame(room, session) {
  requireHost(room, session);
  if (room.game) throw new Error("Het spel is al begonnen.");
  room.game = createMultiplayerGame(room.humans, room.botSkill);
  broadcastRoom(room);
  scheduleBots(room);
}

function playerAction(room, session, action) {
  if (!room.game) throw new Error("Het spel is nog niet begonnen.");
  action();
  broadcastRoom(room);
  scheduleBots(room);
}

function nextRound(room, session) {
  requireHost(room, session);
  if (!room.game) throw new Error("Het spel is nog niet begonnen.");
  beginNextMultiplayerRound(room.game);
  broadcastRoom(room);
  scheduleBots(room);
}

function scheduleBots(room) {
  clearTimeout(botTimers.get(room.code));
  botTimers.delete(room.code);
  if (!room.game || room.game.phase !== "playing") return;
  const player = room.game.players[room.game.currentPlayerId];
  if (!player || player.human) return;
  const timer = setTimeout(() => {
    botTimers.delete(room.code);
    playBotTurn(room.game);
    broadcastRoom(room);
    scheduleBots(room);
  }, 650);
  botTimers.set(room.code, timer);
}

function broadcastRoom(room) {
  room.humans.forEach((human) => {
    const socket = room.sockets.get(human.token);
    if (!socket || socket.readyState !== 1) return;
    if (!room.game) {
      send(socket, {
        type: "lobby",
        room: roomInfo(room, human.token),
        viewerId: human.seat,
        players: room.humans.map(({ seat, name, connected }) => ({ id: seat, name, connected }))
      });
      return;
    }
    send(socket, getMultiplayerView(room.game, human.seat, roomInfo(room, human.token)));
  });
}

function roomInfo(room, viewerToken) {
  return {
    code: room.code,
    isHost: room.hostToken === viewerToken,
    botSkill: room.botSkill,
    humanCount: room.humans.length
  };
}

function disconnect(socket) {
  const session = sessions.get(socket);
  if (!session) return;
  sessions.delete(socket);
  const room = rooms.get(session.roomCode);
  if (!room) return;
  const human = room.humans.find((item) => item.token === session.token);
  if (human) human.connected = false;
  room.sockets.delete(session.token);
  if (room.game) room.game.players[session.seat].connected = false;
  if (room.hostToken === session.token) {
    const replacement = room.humans.find((item) => item.connected);
    if (replacement) room.hostToken = replacement.token;
  }
  broadcastRoom(room);
}

function requireHost(room, session) {
  if (room.hostToken !== session.token) throw new Error("Alleen de spelleider kan dit doen.");
}

function createRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function normalizeName(name) {
  const clean = String(name || "").trim().replace(/\s+/g, " ").slice(0, 18);
  return clean || "Speler";
}

function normalizeSkill(skill) {
  return ["beginner", "medium", "expert"].includes(skill) ? skill : "beginner";
}

function send(socket, payload) {
  if (socket.readyState === 1) socket.send(JSON.stringify(payload));
}

server.listen(port, host, () => {
  console.log(`Presidenten lokaal: http://localhost:${port}`);
});

export { server };
