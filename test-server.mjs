import { spawn } from "node:child_process";
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

const child = spawn(process.execPath, ["server.js"], {
  cwd: import.meta.dirname,
  env: { ...process.env, HOST: "127.0.0.1", PORT: "0" },
  stdio: ["ignore", "pipe", "inherit"]
});

let first;
let second;
try {
  const port = await waitForServer(child);
  const url = `ws://127.0.0.1:${port}/multiplayer`;
  first = await connect(url);
  first.socket.send(JSON.stringify({ type: "createRoom", name: "David", botSkill: "medium" }));
  const joinedFirst = await waitFor(first, (message) => message.type === "joined");
  await waitFor(first, (message) => message.type === "lobby");

  second = await connect(url);
  second.socket.send(JSON.stringify({ type: "joinRoom", code: joinedFirst.code, name: "Lisa" }));
  await waitFor(second, (message) => message.type === "joined");
  await waitFor(first, (message) => message.type === "lobby" && message.players?.length === 2);

  first.socket.send(JSON.stringify({ type: "startGame" }));
  const started = await waitFor(first, (message) => message.type === "state");
  assert(started.players.length === 4 && started.hand.length === 8, "Het online spel moet vier plaatsen en acht eigen kaarten tonen.");

  second.socket.send(JSON.stringify({ type: "updateName", name: "Lies" }));
  const renamed = await waitFor(first, (message) => message.type === "state" && message.players.some((player) => player.name === "Lies"));
  assert(renamed.players[1].name === "Lies", "Een naamswijziging moet naar alle spelers worden uitgezonden.");

  console.log("Multiplayer server integration tests passed.");
} finally {
  first?.socket.close();
  second?.socket.close();
  child.kill("SIGTERM");
}
