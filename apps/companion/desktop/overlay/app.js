/* global EventSource, fetch */

const statusEl = document.getElementById('status');
const livePill = document.getElementById('live-pill');
const root = document.getElementById('root');
const groupRow = document.getElementById('group-row');
const groupLabel = document.getElementById('group-label');
const groupSelect = document.getElementById('group-select');

const COPY = {
  waiting: 'Waiting for the League client…',
  noLobby: 'No lobby yet.',
  fearlessTitle: 'Fearless',
  fearlessSentence: 'Ban these next game.',
  fearlessEmpty: 'No champions banned yet.',
  // M13.8, exact. The picker's own labels and the refused-token sentence come from the engine (groups.ts).
  noGroups: 'Play a game with your group, or ask them for the join link.',
  lobbyTitle: 'This lobby',
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

// A single count, not a with/against sentence: whichever record applies to this
// seat (teammate or opponent) relative to the viewer. Null (too little history)
// renders nothing.
function recordNote(seat) {
  const record = seat.with ?? seat.against;
  if (!record) return null;
  return `${record.games} game${record.games === 1 ? '' : 's'}`;
}

// Lobby-fill readiness cue, e.g. "Blue 3/5 · Red 2/5". Pure: just counts the
// rosters already in the payload against 5 a side (see src/panel/overlayUi.test.ts).
function fillReadiness(teams) {
  const blue = Math.min((teams?.blue ?? []).length, 5);
  const red = Math.min((teams?.red ?? []).length, 5);
  return `Blue ${blue}/5 · Red ${red}/5`;
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
    const note = seat.puuid === viewerPuuid ? null : recordNote(seat);
    const records = note ? esc(note) : '';

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
    <p class="fill">${esc(fillReadiness({ blue, red }))}</p>
    ${renderSide('Blue', 'blue', blue, payload.viewerPuuid)}
    ${renderSide('Red', 'red', red, payload.viewerPuuid)}
  </section>`;
}

// The picker as the header shows it (M13.8): null with fewer than two groups, else the label, the options and
// whether the select is disabled (Host, mid-switch). Pure so the vm test can read it.
function pickerModel(groups) {
  if (!groups || !groups.picker) return null;
  return {
    label: groups.picker.label,
    options: groups.picker.options,
    selectedGroupId: groups.picker.selectedGroupId,
    disabled: Boolean(groups.switching),
  };
}

// What `main` shows for groups instead of, or above, the panel: the zero-groups sentence alone (no fearless,
// no lobby, not even their headings), or the refused-token sentence as the box that is first in `main`.
function groupMain(groups) {
  if (groups?.noGroups) {
    return { only: `<p class="empty">${esc(COPY.noGroups)}</p>`, lead: '' };
  }
  if (groups?.error) {
    return { only: null, lead: `<p class="error" role="alert">${esc(groups.error)}</p>` };
  }
  return { only: null, lead: '' };
}

let pickerSignature = '';

function renderPicker(groups) {
  const model = pickerModel(groups);
  if (!model) {
    groupRow.hidden = true;
    pickerSignature = '';
    return;
  }
  groupRow.hidden = false;
  groupLabel.textContent = model.label;
  // Rebuild only when the options changed: replacing a <select> under an open menu would close it.
  const signature = JSON.stringify([model.label, model.options]);
  if (signature !== pickerSignature) {
    pickerSignature = signature;
    groupSelect.innerHTML = model.options
      .map(
        (option) =>
          `<option value="${esc(option.groupId)}"${option.disabled ? ' disabled' : ''}>${esc(option.label)}</option>`,
      )
      .join('');
  }
  groupSelect.value = model.selectedGroupId ?? '';
  groupSelect.disabled = model.disabled;
}

function render(state) {
  renderPicker(state.groups);
  // Update live pill
  if (state.connected && state.visible) {
    livePill.style.display = 'inline-flex';
  } else {
    livePill.style.display = 'none';
  }

  const mainGroups = groupMain(state.groups);

  if (!state.connected) {
    statusEl.textContent = COPY.waiting;
    root.innerHTML = mainGroups.only ?? mainGroups.lead;
    return;
  }

  if (mainGroups.only) {
    statusEl.textContent = state.visible
      ? (state.phase ?? 'Lobby')
      : state.phase
        ? `Client: ${state.phase}`
        : COPY.waiting;
    root.innerHTML = mainGroups.only;
    return;
  }

  if (!state.visible) {
    statusEl.textContent = state.phase ? `Client: ${state.phase}` : COPY.waiting;
    root.innerHTML = `${mainGroups.lead}<p class="empty">Panel hides outside lobby and champion select.</p>`;
    return;
  }

  statusEl.textContent = state.phase ?? 'Lobby';

  if (state.error) {
    root.innerHTML = `${mainGroups.lead}<p class="empty">${esc(state.error)}</p>`;
    return;
  }

  if (!state.payload) {
    root.innerHTML = `${mainGroups.lead}<p class="empty">Loading…</p>`;
    return;
  }

  root.innerHTML = mainGroups.lead + renderFearless(state.payload.fearless) + renderLobby(state.payload);
}

groupSelect.addEventListener('change', () => {
  // The engine answers by pushing new state; nothing is assumed here. A refused pick snaps back on that push.
  fetch('/group', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ groupId: groupSelect.value }),
  }).catch((error) => {
    console.error(error);
  });
});

const source = new EventSource('/events');
source.onmessage = (event) => {
  try {
    render(JSON.parse(event.data));
  } catch (error) {
    statusEl.textContent = 'Bad state';
    console.error(error);
  }
};
