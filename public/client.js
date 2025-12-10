const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${wsProtocol}://${location.host}`);

const cardsContainer = document.getElementById('cardsContainer');
const tableSelect = document.getElementById('tableSelect');
const viewAllToggle = document.getElementById('viewAll');
const resetAllBtn = document.getElementById('resetAll');
const singleLabel = document.getElementById('singleLabel');

let state = { tables: [] };
let selected = 1;
let viewAll = false;

/** Hilfen **/
const pad2 = (n) => String(n).padStart(2, '0');
function msToMMSS(ms) {
  ms = Math.max(0, Math.floor(ms / 1000) * 1000);
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${pad2(m)}:${pad2(s)}`;
}

/** Effektive Restzeit berechnen (clientseitig, Anzeige-only) */
function effectiveRemainingMs(t) {
  if (!t) return 0;
  if (!t.running) return t.remainingMs;
  const now = Date.now();
  const delta = now - t.lastUpdated;
  return Math.max(0, t.remainingMs - delta);
}

/** UI: Karte für einen Tisch generieren */
function tableCardHTML(t) {
  return `
    <div class="card" data-table="${t.id}">
      <div class="card-header">
        <div class="card-title">Tisch ${t.id}</div>
        <div class="timer-controls">
          <button data-action="start">Start</button>
          <button data-action="pause" class="warn">Pause</button>
          <button data-action="reset" class="ghost">Reset</button>
        </div>
      </div>

      <div class="timer-row">
        <div class="time-display" data-role="time">${msToMMSS(effectiveRemainingMs(t))}</div>
      </div>

      <div class="teams-row">
        <div class="team" data-team="A">
          <div class="team-header">
            <input class="team-name" data-role="nameA" value="${escapeHtml(t.teamA.name)}" maxlength="40" />
            <button class="small" data-action="rename" data-team="A">Umbenennen</button>
          </div>
          <div class="score-row">
            <button data-action="goal" data-team="A">+ Tor</button>
            <div class="score" data-role="scoreA">${t.teamA.score}</div>
          </div>
          <div class="last-goal" data-role="lastA">Letztes Tor: ${t.teamA.lastGoalMs == null ? '–' : msToMMSS(t.teamA.lastGoalMs)}</div>
        </div>

        <div class="team" data-team="B">
          <div class="team-header">
            <input class="team-name" data-role="nameB" value="${escapeHtml(t.teamB.name)}" maxlength="40" />
            <button class="small" data-action="rename" data-team="B">Umbenennen</button>
          </div>
          <div class="score-row">
            <button data-action="goal" data-team="B">+ Tor</button>
            <div class="score" data-role="scoreB">${t.teamB.score}</div>
          </div>
          <div class="last-goal" data-role="lastB">Letztes Tor: ${t.teamB.lastGoalMs == null ? '–' : msToMMSS(t.teamB.lastGoalMs)}</div>
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, s => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[s]));
}

/** Render-Logik */
function render() {
  const tables = state.tables || [];
  cardsContainer.innerHTML = '';

  if (viewAll) {
    for (const t of tables) {
      cardsContainer.insertAdjacentHTML('beforeend', tableCardHTML(t));
    }
    tableSelect.disabled = true;
    singleLabel.style.opacity = 0.5;
  } else {
    const t = tables.find(x => x.id === Number(selected)) || tables[0];
    if (t) cardsContainer.insertAdjacentHTML('beforeend', tableCardHTML(t));
    tableSelect.disabled = false;
    singleLabel.style.opacity = 1;
  }

  // Buttons disablen wo nötig
  updateButtonsDisabled();
}

/** Buttons je Karte passend (Start/Pause) setzen */
function updateButtonsDisabled() {
  document.querySelectorAll('.card').forEach(card => {
    const id = Number(card.dataset.table);
    const t = state.tables.find(x => x.id === id);
    if (!t) return;
    const startBtn = card.querySelector('[data-action="start"]');
    const pauseBtn = card.querySelector('[data-action="pause"]');
    if (startBtn) startBtn.disabled = t.running || effectiveRemainingMs(t) === 0;
    if (pauseBtn) pauseBtn.disabled = !t.running;
  });
}

/** Live-Loop nur für Anzeige (ohne State zu verändern) */
function animate() {
  // Update der Zeitfelder je Karte
  document.querySelectorAll('.card').forEach(card => {
    const id = Number(card.dataset.table);
    const t = state.tables.find(x => x.id === id);
    if (!t) return;
    const timeEl = card.querySelector('[data-role="time"]');
    if (!timeEl) return;
    timeEl.textContent = msToMMSS(effectiveRemainingMs(t));
  });
  updateButtonsDisabled();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

/** WebSocket: State erhalten */
ws.addEventListener('message', (ev) => {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'state') {
      state.tables = msg.tables;
      render(); // Struktur/Texts neu zeichnen
    }
  } catch {}
});

/** Top-Leisten Controls */
tableSelect.addEventListener('change', (e) => {
  selected = Number(e.target.value);
  if (!viewAll) render();
});

viewAllToggle.addEventListener('change', (e) => {
  viewAll = !!e.target.checked;
  render();
});

resetAllBtn.addEventListener('click', () => {
  ws.send(JSON.stringify({ type: 'resetAll' }));
});

/** Event-Delegation für Karten (Start, Pause, Reset, Goal, Rename) */
cardsContainer.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;

  const card = e.target.closest('.card');
  if (!card) return;
  const tableId = Number(card.dataset.table);
  const action = btn.dataset.action;
  const team = btn.dataset.team;

  if (action === 'start') {
    ws.send(JSON.stringify({ type: 'start', tableId }));
  } else if (action === 'pause') {
    ws.send(JSON.stringify({ type: 'pause', tableId }));
  } else if (action === 'reset') {
    ws.send(JSON.stringify({ type: 'reset', tableId }));
  } else if (action === 'goal' && (team === 'A' || team === 'B')) {
    ws.send(JSON.stringify({ type: 'goal', tableId, team }));
  } else if (action === 'rename' && (team === 'A' || team === 'B')) {
    const input = card.querySelector(team === 'A' ? '[data-role="nameA"]' : '[data-role="nameB"]');
    if (!input) return;
    const proposed = input.value.trim();
    if (proposed) {
      ws.send(JSON.stringify({ type: 'rename', tableId, team, name: proposed }));
    }
  }
});

/** Erstes Rendern */
render();
