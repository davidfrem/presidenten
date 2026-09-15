import crypto from "node:crypto";
import { Firestore, FieldValue } from "@google-cloud/firestore";
import { OAuth2Client } from "google-auth-library";

const DAY = 86400000;
export function createActivityStore({ firestore = null, now = () => Date.now() } = {}) {
  const memory = new Map();
  const queues = new Map();
  const daily = new Map();
  const collection = firestore?.collection("playerSessions");
  const read = async (id) => collection ? (await collection.doc(id).get()).data() : memory.get(id);
  const write = async (id, data) => collection ? collection.doc(id).set(data) : memory.set(id, data);
  async function touch(id, details, ended = false) {
      const time = now();
      const old = await read(id);
      if (!old && ended) return;
      if (old && +(old.expiresAt.toDate?.() || old.expiresAt) < time) return;
      const startedAt = old?.startedAt || new Date(time);
      const record = {
        ...old, ...details, id, startedAt, lastSeen: new Date(time),
        endedAt: ended ? new Date(time) : null,
        expiresAt: old?.expiresAt || new Date(time + 90 * DAY)
      };
      if (collection) {
        await firestore.runTransaction(async (transaction) => {
          const reference = collection.doc(id);
          const existing = await transaction.get(reference);
          transaction.set(reference, record);
          if (!existing.exists) transaction.set(firestore.collection("playerDailyTotals").doc(new Date(time).toISOString().slice(0, 10)), {
            sessions: FieldValue.increment(1), [details.mode || "solo"]: FieldValue.increment(1)
          }, { merge: true });
        });
      } else {
        await write(id, record);
        if (!old) {
          const day = new Date(time).toISOString().slice(0, 10);
          const total = daily.get(day) || { sessions: 0, solo: 0, multiplayer: 0 };
          total.sessions++; total[details.mode || "solo"]++;
          daily.set(day, total);
        }
      }
      if (!collection) for (const [key, value] of memory) {
        if (+value.expiresAt <= time) memory.delete(key);
      }
  }
  return {
    async totals(from, to) {
      const start = new Date(from).toISOString().slice(0, 10);
      const end = new Date(to).toISOString().slice(0, 10);
      if (collection) {
        const snapshot = await firestore.collection("playerDailyTotals").orderBy("__name__").startAt(start).endAt(end).get();
        return snapshot.docs.map((doc) => ({ day: doc.id, ...doc.data() }));
      }
      return [...daily].filter(([day]) => day >= start && day <= end).map(([day, value]) => ({ day, ...value }));
    },
    touch(id, details, ended = false) {
      const next = (queues.get(id) || Promise.resolve()).catch(() => {}).then(() => touch(id, details, ended));
      queues.set(id, next);
      next.finally(() => { if (queues.get(id) === next) queues.delete(id); }).catch(() => {});
      return next;
    },
    async list(from, to, cursor = null) {
      if (collection) {
        let query = collection.where("startedAt", ">=", new Date(from)).where("startedAt", "<", new Date(to))
          .orderBy("startedAt", "desc").orderBy("__name__", "desc").limit(201);
        if (cursor) query = query.startAfter(new Date(cursor.time), cursor.id);
        const snapshot = await query.get();
        return page(snapshot.docs.map((doc) => doc.data()));
      }
      return page([...memory.values()].filter((row) => +row.startedAt >= from && +row.startedAt < to)
        .sort((a, b) => +b.startedAt - +a.startedAt || b.id.localeCompare(a.id))
        .filter((row) => !cursor || +row.startedAt < cursor.time || (+row.startedAt === cursor.time && row.id < cursor.id)));
    },
    async active() {
      const threshold = now() - 120000;
      const rows = collection
        ? (await collection.where("lastSeen", ">=", new Date(threshold)).limit(1001).get()).docs.map((doc) => doc.data())
        : [...memory.values()].filter((row) => +row.lastSeen >= threshold);
      return rows.filter((row) => !row.endedAt).map(jsonRow);
    }
  };
}
function jsonRow(row) {
  const date = (value) => value?.toDate ? value.toDate().toISOString() : value?.toISOString?.() || null;
  return { ...row, startedAt: date(row.startedAt), lastSeen: date(row.lastSeen), endedAt: date(row.endedAt), expiresAt: undefined };
}
function page(rows) {
  const more = rows.length > 200;
  const items = rows.slice(0, 200).map(jsonRow);
  const last = items.at(-1);
  return { items, cursor: more ? { time: Date.parse(last.startedAt), id: last.id } : null };
}
export function isAdmin(payload, email) {
  return Boolean(email && payload?.email_verified === true && payload.email?.toLowerCase() === email.toLowerCase());
}
export function createPlayerActivity(getRooms = () => []) {
  const cloud = Boolean(process.env.K_SERVICE || process.env.FIRESTORE_EMULATOR_HOST);
  const store = createActivityStore({ firestore: cloud ? new Firestore({ databaseId: process.env.FIRESTORE_DATABASE_ID }) : null });
  const auth = new OAuth2Client();
  const solo = new Map();
  const multiplayerUpdates = new Map();
  let starts = 0;
  const reset = setInterval(() => { starts = 0; }, 60000);
  reset.unref();
  const send = (response, status, body) => {
    response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(body));
  };
  return {
    multiplayer(room, human, ended = false) {
      if (!room.game) return;
      const id = crypto.createHash("sha256").update(human.token).digest("hex");
      const previous = multiplayerUpdates.get(id);
      if (!ended && previous && Date.now() - previous.time < 25000 && previous.name === human.name) return;
      if (ended) multiplayerUpdates.delete(id);
      else multiplayerUpdates.set(id, { time: Date.now(), name: human.name });
      for (const [key, value] of multiplayerUpdates) if (Date.now() - value.time > 120000) multiplayerUpdates.delete(key);
      return store.touch(id, { name: human.name, mode: "multiplayer", room: room.code, status: room.game.phase || "playing" }, ended)
        .catch(() => console.error("Spelactiviteit opslaan mislukt"));
    },
    async handle(request, response, url) {
      if (!url.pathname.startsWith("/api/activity/")) return false;
      try {
        if (url.pathname === "/api/activity/config" && request.method === "GET") {
          send(response, 200, { clientId: process.env.ADMIN_GOOGLE_CLIENT_ID || "" });
        } else if (url.pathname === "/api/activity/report" && request.method === "POST") {
          if (request.headers.origin && request.headers.origin !== `https://${request.headers.host}` && request.headers.origin !== `http://${request.headers.host}`) throw new Error("Origin");
          let raw = "";
          for await (const chunk of request) {
            raw += chunk;
            if (raw.length > 2048) throw new Error("Payload");
          }
          const data = JSON.parse(raw);
          const time = Date.now();
          for (const [id, value] of solo) if (time - value.seen > 120000) solo.delete(id);
          let id = data.id;
          if (!id) {
            if (++starts > 300 || solo.size >= 1000) { send(response, 429, {}); return true; }
            id = crypto.randomUUID();
            solo.set(id, { seen: 0 });
          }
          const session = solo.get(id);
          if (!session) { send(response, 410, {}); return true; }
          if (data.end || time - session.seen >= 25000) {
            session.seen = time;
            await store.touch(id, { name: String(data.name || "Jij").trim().slice(0, 30), mode: "solo", room: null, status: "playing" }, Boolean(data.end));
          }
          if (data.end) solo.delete(id);
          send(response, 200, { id });
        } else if (url.pathname === "/api/activity/history" && request.method === "GET") {
          const clientId = process.env.ADMIN_GOOGLE_CLIENT_ID;
          if (!clientId || !process.env.ADMIN_EMAIL) { send(response, 503, { error: "Beheerderslogin is nog niet ingesteld." }); return true; }
          let payload;
          try {
            const ticket = await auth.verifyIdToken({ idToken: request.headers.authorization?.replace(/^Bearer /, "") || "", audience: clientId });
            payload = ticket.getPayload();
          } catch { send(response, 401, { error: "Log opnieuw in." }); return true; }
          if (!isAdmin(payload, process.env.ADMIN_EMAIL)) { send(response, 403, { error: "Geen toegang." }); return true; }
          const from = Date.parse(url.searchParams.get("from"));
          const to = Date.parse(url.searchParams.get("to"));
          if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 91 * DAY) throw new Error("Dates");
          const cursor = url.searchParams.has("cursor") ? JSON.parse(url.searchParams.get("cursor")) : null;
          if (cursor && (!Number.isFinite(cursor.time) || !/^[a-zA-Z0-9-]{1,64}$/.test(cursor.id))) throw new Error("Cursor");
          const retainedFrom = Math.max(from, Date.now() - 90 * DAY);
          const history = retainedFrom < to ? await store.list(retainedFrom, to, cursor) : { items: [], cursor: null };
          send(response, 200, { ...history, active: await store.active(), daily: await store.totals(from, to - 1), rooms: getRooms() });
        } else send(response, 404, {});
      } catch { send(response, 400, { error: "Verzoek kon niet worden verwerkt." }); }
      return true;
    }
  };
}
