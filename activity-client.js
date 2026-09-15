import { loadSettings } from "./settings.js";
let generation = 0;
let session = null;
let playing = false;
let busy = false;
function end(id) {
  if (id) fetch("/api/activity/report", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, end: true, name: loadSettings().playerName }), keepalive: true }).catch(() => {});
}
async function heartbeat() {
  if (!playing || document.hidden || busy) return;
  busy = true;
  const current = generation;
  try {
    const response = await fetch("/api/activity/report", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: session, name: loadSettings().playerName }) });
    if (response.status === 410) session = null;
    if (response.ok) {
      const { id } = await response.json();
      if (current === generation) session = id;
      else end(id);
    }
  } catch { /* Offline play remains available. */ }
  finally { busy = false; }
}
export function trackSolo(active) {
  if (playing === active) return;
  playing = active;
  generation++;
  if (!active) { end(session); session = null; }
  else heartbeat();
}
setInterval(heartbeat, 30000);
document.addEventListener("visibilitychange", heartbeat);
window.addEventListener("pagehide", () => { end(session); session = null; generation++; });
