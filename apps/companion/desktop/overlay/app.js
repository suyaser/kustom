/* global EventSource */

const statusEl = document.getElementById('status');
const livePill = document.getElementById('live-pill');
const root = document.getElementById('root');

const COPY = {
  waiting: 'Waiting for the League client…',
  noLobby: 'No lobby yet.',
  fearlessTitle: 'Fearless',
  fearlessSentence: 'Ban these next game.',
  fearlessEmpty: 'No champions banned yet.',
  lobbyTitle: 'This lobby',
  thin: 'Under 5 games together.',
  lane: 'lane',
  you: 'you',
};

function esc(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function recordLine(seat) {
  if (seat.with === null && seat.against === null) {
    return COPY.thin;
  }
  const parts = [];
  if (seat.with) parts.push(`With ${seat.with.wins}–${seat.with.losses}`);
  if (seat.against) parts.push(`Against ${seat.against.wins}–${seat.against.losses}`);
  return parts.join(' · ');
}

function renderFearless(fearless) {
  if (!fearless || fearless.champions.length === 0) {
    return `<section><h2>${COPY.fearlessTitle}</h2><p class="sentence">${COPY.fearlessEmpty}</p></section>`;
  }

  const byLane = new Map();
  for (const champ of fearless.champions) {
    const lane = champ.role ?? 'other';
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane).push(champ);
  }

  const order = ['top', 'jungle', 'mid', 'adc', 'support', 'other'];
  let html = `<section><h2>${COPY.fearlessTitle}</h2><p class="sentence">${COPY.fearlessSentence}</p>`;

  for (const lane of order) {
    const list = byLane.get(lane);
    if (!list) continue;

    html += `<div class="lane-group"><p class="lane-label">${esc(lane)}</p><ul class="chips">`;
    for (const champ of list) {
      const icon = champ.iconUrl
        ? `<img src="${esc(champ.iconUrl)}" width="24" height="24" alt="" loading="lazy" decoding="async" onerror="this.remove()" />`
        : '';
      html += `<li>${icon}${esc(champ.name)}</li>`;
    }
    html += '</ul></div>';
  }

  html += '</section>';
  return html;
}

function renderSide(label, color, seats, viewerPuuid) {
  if (!seats || seats.length === 0) return '';

  let html = `<div class="side"><div class="side-label ${color}">${esc(label)}</div><div class="seats">`;

  for (const seat of seats) {
    const you = seat.puuid === viewerPuuid ? ' you' : '';
    const youMark = seat.puuid === viewerPuuid ? ` <span class="you-mark">· ${COPY.you}</span>` : '';
    const lane = seat.isLaneOpponent ? `<span class="lane-mark">${COPY.lane}</span>` : '';
    const role = seat.role ?? '—';
    const records = seat.puuid === viewerPuuid ? '' : esc(recordLine(seat));

    html += `<div class="seat${you}">
      <div class="name">${esc(seat.name ?? 'Unknown')}${youMark}${lane}</div>
      <div class="meta">${esc(role)} · ${seat.rating}</div>
      ${records ? `<div class="records">${records}</div>` : ''}
    </div>`;
  }

  html += '</div></div>';
  return html;
}

function renderLobby(payload) {
  if (!payload.lobby) {
    return `<section><h2>${COPY.lobbyTitle}</h2><p class="empty">${COPY.noLobby}</p></section>`;
  }
  if (!payload.lobby.teams) {
    return `<section><h2>${COPY.lobbyTitle}</h2><p class="empty">${COPY.noLobby}</p></section>`;
  }

  const { blue, red } = payload.lobby.teams;
  return `<section><h2>${COPY.lobbyTitle}</h2>
    ${renderSide('Blue', 'blue', blue, payload.viewerPuuid)}
    ${renderSide('Red', 'red', red, payload.viewerPuuid)}
  </section>`;
}

function render(state) {
  // Update live pill
  if (state.connected && state.visible) {
    livePill.style.display = 'inline-flex';
  } else {
    livePill.style.display = 'none';
  }

  if (!state.connected) {
    statusEl.textContent = COPY.waiting;
    root.innerHTML = '';
    return;
  }

  if (!state.visible) {
    statusEl.textContent = state.phase ? `Client: ${state.phase}` : COPY.waiting;
    root.innerHTML = '<p class="empty">Panel hides outside lobby and champion select.</p>';
    return;
  }

  statusEl.textContent = state.phase ?? 'Lobby';

  if (state.error) {
    root.innerHTML = `<p class="empty">${esc(state.error)}</p>`;
    return;
  }

  if (!state.payload) {
    root.innerHTML = '<p class="empty">Loading…</p>';
    return;
  }

  root.innerHTML = renderFearless(state.payload.fearless) + renderLobby(state.payload);
}

const source = new EventSource('/events');
source.onmessage = (event) => {
  try {
    render(JSON.parse(event.data));
  } catch (error) {
    statusEl.textContent = 'Bad state';
    console.error(error);
  }
};
