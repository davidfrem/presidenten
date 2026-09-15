import { spawn } from "node:child_process";
import http from "node:http";
import WebSocket from "ws";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server startte niet op tijd.")), 10_000);
    child.stdout.on("data", (data) => {
      const match = data.toString().match(/localhost:(\d+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    });
    child.once("exit", (code) => reject(new Error(`Server stopte onverwacht met code ${code}.`)));
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const client = { socket, messages: [], waiters: [] };
    socket.on("message", (data) => {
      const message = JSON.parse(data);
      const index = client.waiters.findIndex((waiter) => waiter.predicate(message));
      if (index < 0) return client.messages.push(message);
      const [waiter] = client.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    });
    socket.once("open", () => resolve(client));
    socket.once("error", reject);
  });
}

function waitFor(client, predicate, timeout = 10_000) {
  const index = client.messages.findIndex(predicate);
  if (index >= 0) return Promise.resolve(client.messages.splice(index, 1)[0]);
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, timer: null };
    waiter.timer = setTimeout(() => {
      client.waiters.splice(client.waiters.indexOf(waiter), 1);
      reject(new Error("Geen verwacht serverbericht ontvangen."));
    }, timeout);
    client.waiters.push(waiter);
  });
}

const externalUrl = process.env.TEST_WS_URL;
const child = externalUrl ? null : spawn(process.execPath, ["server.js"], {
  cwd: import.meta.dirname,
  env: { ...process.env, HOST: "127.0.0.1", PORT: "0", DISCONNECT_GRACE_MS: "400", REDIRECT_LEGACY_DOMAIN: "true" },
  stdio: ["ignore", "pipe", "inherit"]
});

let first;
let second;
let third;
let fourth;
let reconnectedFourth;
try {
  const port = child ? await waitForServer(child) : null;
  if (child) {
    const request = (hostname, pathname) => new Promise((resolve, reject) => {
      http.get({ hostname: "127.0.0.1", port, path: pathname, headers: { host: hostname } }, (response) => {
        response.resume();
        resolve(response);
      }).on("error", reject);
    });
    const legacy = await request("samen.presidenten.fremeijer.net", "/?mode=samen&code=ABCDE");
    assert(legacy.statusCode === 308, "Oud domein moet omleiden.");
    assert(legacy.headers.location === "https://presidenten.fremeijer.net/?mode=samen&code=ABCDE", "Omleiding moet pad en parameters bewaren.");
    const canonical = await request("presidenten.fremeijer.net", "/");
    assert(canonical.statusCode === 200, "Hoofddomein mag niet omleiden.");
    const health = await request("samen.presidenten.fremeijer.net", "/health");
    assert(health.statusCode === 200, "Healthcheck moet beschikbaar blijven.");
    const api = await fetch(`http://127.0.0.1:${port}/api/activity/history`);
    assert(api.status === 503, "Beheerdata moet zonder loginconfig gesloten blijven.");
    assert(api.headers.get("cache-control") === "no-store", "Beheerdata mag niet gecachet worden.");
    const report = await fetch(`http://127.0.0.1:${port}/api/activity/report`, { method: "POST", body: JSON.stringify({ name: "Test", roundsStarted: 2, roundsCompleted: 1 }) });
    assert(report.ok, "Solo-registratie moet werken.");
    const { id } = await report.json();
    const invalidRounds = await fetch(`http://127.0.0.1:${port}/api/activity/report`, { method: "POST", body: JSON.stringify({ id, roundsStarted: 1, roundsCompleted: 2 }) });
    assert(invalidRounds.status === 400, "Meer voltooide dan gestarte rondes moet worden geweigerd.");
    const stop = await fetch(`http://127.0.0.1:${port}/api/activity/report`, { method: "POST", body: JSON.stringify({ id, end: true, name: "Test" }) });
    assert(stop.ok, "Solo-afmelding moet werken.");
  }
  const url = externalUrl || `ws://127.0.0.1:${port}/multiplayer`;
  first = await connect(url);
  first.socket.send(JSON.stringify({ type: "createRoom", name: "David", botSkill: "medium" }));
  const joinedFirst = await waitFor(first, (message) => message.type === "joined");
  await waitFor(first, (message) => message.type === "lobby");

  second = await connect(url);
  second.socket.send(JSON.stringify({ type: "joinRoom", code: joinedFirst.code, name: "Lisa" }));
  await waitFor(second, (message) => message.type === "joined");
  await waitFor(first, (message) => message.type === "lobby" && message.players?.length === 2);

  second.socket.send(JSON.stringify({ type: "leaveRoom" }));
  await waitFor(second, (message) => message.type === "left");
  await waitFor(first, (message) => message.type === "lobby" && message.players?.length === 1);

  second = await connect(url);
  second.socket.send(JSON.stringify({ type: "joinRoom", code: joinedFirst.code, name: "Lisa" }));
  await waitFor(second, (message) => message.type === "joined");
  await waitFor(first, (message) => message.type === "lobby" && message.players?.length === 2);

  first.socket.send(JSON.stringify({ type: "leaveRoom" }));
  await waitFor(first, (message) => message.type === "left");
  await waitFor(second, (message) => message.type === "lobby" && message.room?.isHost && message.players?.length === 1);

  third = await connect(url);
  third.socket.send(JSON.stringify({ type: "joinRoom", code: joinedFirst.code, name: "Sam" }));
  const joinedThird = await waitFor(third, (message) => message.type === "joined");
  await waitFor(second, (message) => message.type === "lobby" && message.players?.length === 2);

  fourth = await connect(url);
  fourth.socket.send(JSON.stringify({ type: "joinRoom", code: joinedFirst.code, name: "Noor" }));
  const joinedFourth = await waitFor(fourth, (message) => message.type === "joined");
  await waitFor(second, (message) => message.type === "lobby" && message.players?.length === 3);

  second.socket.send(JSON.stringify({ type: "startGame" }));
  const started = await waitFor(second, (message) => message.type === "state");
  assert(started.players.length === 4 && started.hand.length === 8, "Het online spel moet vier plaatsen en acht eigen kaarten tonen.");

  second.socket.send(JSON.stringify({ type: "updateName", name: "Lies" }));
  const renamed = await waitFor(second, (message) => message.type === "state" && message.players.some((player) => player.name === "Lies"));
  assert(renamed.players.some((player) => player.name === "Lies"), "Een naamswijziging moet naar alle spelers worden uitgezonden.");

  third.socket.send(JSON.stringify({ type: "leaveRoom" }));
  await waitFor(third, (message) => message.type === "left");
  await waitFor(second, (message) => message.type === "state" && message.players.some((player) => player.id === joinedThird.seat && !player.human));

  fourth.socket.close();
  await waitFor(second, (message) => message.type === "state" && message.players.some((player) => player.id === joinedFourth.seat && !player.connected));

  reconnectedFourth = await connect(url);
  reconnectedFourth.socket.send(JSON.stringify({ type: "reconnect", code: joinedFourth.code, token: joinedFourth.token }));
  await waitFor(reconnectedFourth, (message) => message.type === "joined");
  await waitFor(second, (message) => message.type === "state" && message.players.some((player) => player.id === joinedFourth.seat && player.connected));

  reconnectedFourth.socket.close();
  await waitFor(second, (message) => message.type === "state" && message.players.some((player) => player.id === joinedFourth.seat && !player.connected));
  const takenOver = await waitFor(second, (message) => message.type === "state" && message.players.some((player) => player.id === joinedFourth.seat && !player.human), 3_000);
  assert(takenOver.players.find((player) => player.id === joinedFourth.seat).connected, "Een bot moet de plek van een langdurig offline speler overnemen.");

  console.log("Multiplayer server integration tests passed.");
} finally {
  first?.socket.close();
  second?.socket.close();
  third?.socket.close();
  fourth?.socket.close();
  reconnectedFourth?.socket.close();
  child?.kill("SIGTERM");
}
