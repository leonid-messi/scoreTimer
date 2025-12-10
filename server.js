const path = require('path');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const DURATION_MS = 5 * 60 * 1000; // 5 Minuten pro Tisch

function newTableState(id) {
  return {
    id,
    durationMs: DURATION_MS,
    remainingMs: DURATION_MS,
    running: false,
    teamA: { name: 'Team A', score: 0, lastGoalMs: null },
    teamB: { name: 'Team B', score: 0, lastGoalMs: null },
    lastUpdated: Date.now(),
  };
}

const tables = [1, 2, 3].map((i) => newTableState(i));

function broadcast(obj) {
  const data = JSON.stringify(obj);
  wss.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(data));
}

function tableById(id) {
  return tables.find((t) => t.id === Number(id));
}

/**
 * Effektive Restzeit unter Berücksichtigung von lastUpdated und running.
 */
function effectiveRemainingMs(t, now = Date.now()) {
  if (!t.running) return t.remainingMs;
  const delta = now - t.lastUpdated;
  return Math.max(0, t.remainingMs - delta);
}

// Sanfter Server-Tick für Grenzfälle (stoppt bei 0)
setInterval(() => {
  let changed = false;
  const now = Date.now();
  for (const t of tables) {
    if (!t.running) continue;
    const eff = effectiveRemainingMs(t, now);
    if (eff === 0) {
      t.running = false;
      t.remainingMs = 0;
      t.lastUpdated = now;
      changed = true;
    } else if (now - t.lastUpdated >= 1000) {
      // Alle ~Sekunde den Ankerpunkt nachziehen, damit Clients nicht driften
      t.remainingMs = eff;
      t.lastUpdated = now;
      changed = true;
    }
  }
  if (changed) broadcast({ type: 'state', tables });
}, 250);

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'state', tables }));

  ws.on('message', (raw) => {
    let msg = {};
    try { msg = JSON.parse(raw); } catch { return; }

    const t = tableById(msg.tableId);

    switch (msg.type) {
      case 'start': {
        if (t && !t.running && effectiveRemainingMs(t) > 0) {
          // Fixiere aktuellen Rest als Start-Anker
          t.remainingMs = effectiveRemainingMs(t);
          t.running = true;
          t.lastUpdated = Date.now();
          broadcast({ type: 'state', tables });
        }
        break;
      }
      case 'pause': {
        if (t && t.running) {
          // Schreibe die effektive Restzeit fest und pausiere
          t.remainingMs = effectiveRemainingMs(t);
          t.running = false;
          t.lastUpdated = Date.now();
          broadcast({ type: 'state', tables });
        }
        break;
      }
      case 'reset': {
        if (t) {
          const id = t.id;
          const nameA = t.teamA.name;
          const nameB = t.teamB.name;
          Object.assign(t, newTableState(id));
          t.teamA.name = nameA; // Teamnamen behalten
          t.teamB.name = nameB;
          broadcast({ type: 'state', tables });
        }
        break;
      }
      case 'resetAll': {
        for (const tab of tables) {
          const id = tab.id;
          const nameA = tab.teamA.name;
          const nameB = tab.teamB.name;
          Object.assign(tab, newTableState(id));
          tab.teamA.name = nameA;
          tab.teamB.name = nameB;
        }
        broadcast({ type: 'state', tables });
        break;
      }
      case 'rename': {
        if (t && (msg.team === 'A' || msg.team === 'B') && typeof msg.name === 'string') {
          const key = msg.team === 'A' ? 'teamA' : 'teamB';
          t[key].name = msg.name.trim().slice(0, 40) || t[key].name;
          broadcast({ type: 'state', tables });
        }
        break;
      }
      case 'goal': {
        if (t && (msg.team === 'A' || msg.team === 'B')) {
          const now = Date.now();
          const key = msg.team === 'A' ? 'teamA' : 'teamB';
          t[key].score += 1;

          // Berechne "Zeit seit Start" robust
          const effRem = effectiveRemainingMs(t, now);
          const elapsedMs = t.durationMs - effRem;
          // Auf volle Sekunde runden (schöner in der Anzeige)
          t[key].lastGoalMs = Math.max(0, Math.floor(elapsedMs / 1000) * 1000);

          // Optional: State pushen
          broadcast({ type: 'state', tables });
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server läuft auf http://localhost:${PORT}`);
});
