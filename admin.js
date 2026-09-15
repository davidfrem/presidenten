const el = (id) => document.getElementById(id);
let token = null;
let cursor = null;
let rows = [];
let loading = false;
const today = new Date().toLocaleDateString("en-CA");
el("from").value = el("to").value = today;
const date = (value) => value ? new Date(value).toLocaleString("nl-NL") : "-";
function renderRows() {
  el("history").replaceChildren();
  const query = el("name").value.toLowerCase();
  rows.filter((row) => row.name.toLowerCase().includes(query)).forEach((row) => {
    const tr = document.createElement("tr");
    [row.name, row.mode === "solo" ? "Alleen" : "Samen", row.room || "-", row.roundsCompleted ?? "-", row.roundsStarted ?? "-", date(row.startedAt), date(row.lastSeen), date(row.endedAt || (!row.active ? row.lastSeen : null))].forEach((value) => {
      const td = document.createElement("td"); td.textContent = value; tr.append(td);
    });
    el("history").append(tr);
  });
  el("total").textContent = `${rows.length} sessies geladen${cursor ? " (meer beschikbaar)" : ""}. Einde zonder afmelding: laatst gezien.`;
}
async function load(more = false) {
  if (!token || loading) return;
  loading = true;
  const requestToken = token;
  try {
    const from = new Date(`${el("from").value}T00:00:00`);
    const to = new Date(`${el("to").value}T00:00:00`); to.setDate(to.getDate() + 1);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (more && cursor) params.set("cursor", JSON.stringify(cursor));
    const response = await fetch(`/api/activity/history?${params}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const data = await response.json();
    if (token !== requestToken) return;
    if (!response.ok) throw new Error(data.error || "Laden mislukt.");
    const activeIds = new Set(data.active.map((row) => row.id));
    const items = data.items.map((row) => ({ ...row, active: activeIds.has(row.id) }));
    rows = more ? [...rows, ...items] : items; cursor = data.cursor;
    const soloCount = data.active.filter((row) => row.mode === "solo").length;
    const bots = data.rooms.reduce((sum, room) => sum + room.bots, 0);
    el("count").textContent = `(${data.active.length}: ${soloCount} alleen, ${data.active.length - soloCount} samen; ${bots} multiplayerbots)`;
    el("daily").textContent = data.daily.map((row) => `${row.day}: ${row.sessions} sessies (${row.solo || 0} alleen, ${row.multiplayer || 0} samen)`).join(" | ") || "Geen sessies in deze periode.";
    el("active").replaceChildren();
    data.active.forEach((row) => { const p = document.createElement("p"); p.textContent = `${row.name} / ${row.mode === "solo" ? "Alleen" : `Samen / ${row.room}`}`; el("active").append(p); });
    if (!data.active.length) el("active").textContent = "Geen actieve spelers.";
    el("more").hidden = !cursor; el("report").hidden = false; el("status").textContent = `Bijgewerkt: ${date(new Date())}`;
    renderRows();
  } catch (error) { if (token === requestToken) el("status").textContent = error.message; }
  finally { loading = false; }
}
el("filters").addEventListener("submit", (event) => { event.preventDefault(); load(); });
el("name").addEventListener("input", renderRows);
el("more").addEventListener("click", () => load(true));
el("logout").addEventListener("click", () => { token = null; rows = []; el("history").replaceChildren(); el("active").replaceChildren(); el("report").hidden = true; el("logout").hidden = true; el("login").hidden = false; });
try {
  const { clientId } = await (await fetch("/api/activity/config", { cache: "no-store" })).json();
  if (!clientId) throw new Error("Google-inloggen moet nog door de beheerder worden ingesteld.");
  const started = Date.now();
  while (!window.google?.accounts?.id) {
    if (Date.now() - started > 10000) throw new Error("Google-inloggen kon niet worden geladen.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  google.accounts.id.initialize({ client_id: clientId, callback: ({ credential }) => { token = credential; el("logout").hidden = false; el("login").hidden = true; load(); } });
  google.accounts.id.renderButton(el("login"), { theme: "outline", size: "large" });
  el("status").textContent = "Log in met je beheerdersaccount.";
} catch (error) { el("status").textContent = error.message; }
setInterval(() => { if (token && !document.hidden && !cursor) load(); }, 30000);
