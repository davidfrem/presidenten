import { Firestore } from "@google-cloud/firestore";

const DEFAULT_TTL_HOURS = 24;

export function createRoomStore() {
  const useFirestore = Boolean(
    process.env.K_SERVICE ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.FIRESTORE_PROJECT_ID ||
    process.env.FIRESTORE_EMULATOR_HOST
  );
  if (!useFirestore) return createMemoryRoomStore();

  const projectId = process.env.FIRESTORE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
  const firestore = projectId ? new Firestore({ projectId }) : new Firestore();
  const collection = firestore.collection("multiplayerRooms");

  return {
    mode: "firestore",
    async exists(code) {
      return (await collection.doc(code).get()).exists;
    },
    async load(code) {
      const snapshot = await collection.doc(code).get();
      if (!snapshot.exists) return null;
      const data = snapshot.data();
      if (toDate(data.expiresAt) <= new Date()) {
        await snapshot.ref.delete();
        return null;
      }
      return deserializeRoom(data);
    },
    async save(room) {
      await collection.doc(room.code).set(serializeRoom(room));
    }
  };
}

function createMemoryRoomStore() {
  return {
    mode: "memory",
    async exists() {
      return false;
    },
    async load() {
      return null;
    },
    async save() {}
  };
}

export function serializeRoom(room, now = new Date()) {
  const ttlHours = positiveNumber(process.env.ROOM_TTL_HOURS, DEFAULT_TTL_HOURS);
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);
  return {
    code: room.code,
    hostToken: room.hostToken,
    botSkill: room.botSkill,
    humans: room.humans.map(({ seat, token, name }) => ({ seat, token, name })),
    game: room.game ? serializeGame(room.game) : null,
    updatedAt: now,
    expiresAt
  };
}

export function deserializeRoom(data) {
  const humans = (data.humans || []).map((human) => ({ ...human, connected: false }));
  const game = data.game ? deserializeGame(data.game) : null;
  if (game) {
    game.players.forEach((player) => {
      if (player.human) player.connected = false;
    });
  }
  return {
    code: data.code,
    hostToken: data.hostToken,
    botSkill: data.botSkill,
    humans,
    sockets: new Map(),
    game
  };
}

function serializeGame(game) {
  return {
    ...game,
    passedPlayerIds: [...game.passedPlayerIds]
  };
}

function deserializeGame(game) {
  return {
    ...game,
    passedPlayerIds: new Set(game.passedPlayerIds || []),
    exchangeQueue: game.exchangeQueue || [],
    currentExchange: game.currentExchange || null
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function toDate(value) {
  if (value instanceof Date) return value;
  if (value?.toDate) return value.toDate();
  return new Date(value);
}
