import { loadSettings } from "./settings.js";
import { getSoloRoundStats } from "./game.js";
let generation = 0;
let session = null;
let playing = false;
let busy = false;
let stats = null;
let dirty = false;
function end(id, rounds = stats) {
  if (id) fetch("/api/activity/report", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, end: true, name: loadSettings().playerName, ...rounds }), keepalive: true }).catch(() => {});
}
async function heartbeat() {
  if (!playing || document.hidden || busy) return;
  busy = true;
  dirty = false;
  const current = generation;
  const sentStats = stats;
  try {
    const response = await fetch("/api/activity/report", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: session, name: loadSettings().playerName, ...stats }) });
    if (response.status === 410) session = null;
    if (response.ok) {
      const { id } = await response.json();
      if (current === generation) session = id;
      else end(id, sentStats);
    }
  } catch { /* Offline play remains available. */ }
  finally { busy = false; if (dirty && playing) heartbeat(); }
}
export function trackSolo(active) {
  if (playing === active) return;
  playing = active;
  generation++;
  if (!active) { end(session); session = null; }
  else { stats = getSoloRoundStats(); heartbeat(); }
}
window.addEventListener("presidenten:solo-round-stats", ({ detail }) => {
  if (JSON.stringify(stats) === JSON.stringify(detail)) return;
  if (stats && stats.gameId !== detail.gameId) {
    end(session); session = null; generation++;
  }
  stats = detail;
  dirty = true;
  heartbeat();
});
setInterval(heartbeat, 30000);
document.addEventListener("visibilitychange", heartbeat);
window.addEventListener("pagehide", () => { end(session); session = null; generation++; });
