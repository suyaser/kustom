/* global __TAURI__ */

const invoke = window.__TAURI__?.core?.invoke;
const shellOpen = window.__TAURI__?.shell?.open;

const setupScreen = document.getElementById('setup-screen');
const runningScreen = document.getElementById('running-screen');
const subtitle = document.getElementById('subtitle');
const modeHost = document.getElementById('mode-host');
const modeOverlay = document.getElementById('mode-overlay');
const tokenGroup = document.getElementById('token-group');
const tokenInput = document.getElementById('token-input');
const apiInput = document.getElementById('api-input');
const saveButton = document.getElementById('save-button');
const errorMessage = document.getElementById('error-message');
const statusMode = document.getElementById('status-mode');
const statusState = document.getElementById('status-state');
const statusPhase = document.getElementById('status-phase');
const logsButton = document.getElementById('logs-button');
const editButton = document.getElementById('edit-button');
const quitButton = document.getElementById('quit-button');

let selectedMode = 'host';
let pollTimer = null;

function setMode(mode) {
  selectedMode = mode;
  modeHost.setAttribute('aria-pressed', mode === 'host' ? 'true' : 'false');
  modeOverlay.setAttribute('aria-pressed', mode === 'overlay' ? 'true' : 'false');
  tokenGroup.classList.toggle('hidden', mode === 'overlay');
  subtitle.textContent = mode === 'host' ? 'Host this PC for the night' : 'Overlay only — no token';
}

function showSetup() {
  setupScreen.classList.remove('hidden');
  runningScreen.classList.add('hidden');
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function showRunning() {
  setupScreen.classList.add('hidden');
  runningScreen.classList.remove('hidden');
  subtitle.textContent = 'Running in the tray';
  startPolling();
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
}

function hideError() {
  errorMessage.classList.add('hidden');
}

async function boot() {
  if (!invoke) {
    showError('Open this window from the Kustom app (Tauri).');
    return;
  }
  try {
    const existing = await invoke('load_app_config');
    if (existing && existing.configured) {
      setMode(existing.mode);
      if (existing.apiBase) apiInput.value = existing.apiBase;
      showRunning();
      await invoke('start_engine');
      return;
    }
    if (existing?.apiBase) apiInput.value = existing.apiBase;
    setMode(existing?.mode === 'overlay' ? 'overlay' : 'host');
    showSetup();
  } catch (error) {
    showError(error?.message ?? String(error));
    showSetup();
  }
}

async function saveAndStart() {
  hideError();
  const apiBase = apiInput.value.trim();
  if (!apiBase) {
    showError('API address is required.');
    return;
  }
  if (selectedMode === 'host') {
    const token = tokenInput.value.trim();
    if (!token) {
      showError('Paste a companion token for Host mode.');
      return;
    }
  }
  saveButton.disabled = true;
  saveButton.textContent = 'Saving…';
  try {
    await invoke('save_app_config', {
      mode: selectedMode,
      apiBase,
      companionToken: selectedMode === 'host' ? tokenInput.value.trim() : null,
    });
    await invoke('start_engine');
    tokenInput.value = '';
    showRunning();
  } catch (error) {
    showError(error?.message ?? String(error));
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Save and start';
  }
}

async function refreshStatus() {
  try {
    const status = await invoke('read_engine_status');
    if (!status) return;
    statusMode.textContent = status.mode === 'host' ? 'Host' : 'Overlay';
    statusState.textContent = (status.state || 'unknown').replace(/_/g, ' ');
    statusPhase.textContent = status.phase || '—';
  } catch (error) {
    console.error(error);
  }
}

function startPolling() {
  refreshStatus();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshStatus, 1500);
}

async function openLogs() {
  try {
    await invoke('open_logs');
  } catch (error) {
    if (shellOpen) {
      await shellOpen('%APPDATA%\\customs-night\\logs');
    } else {
      showError(error?.message ?? String(error));
    }
  }
}

async function editSettings() {
  try {
    await invoke('stop_engine');
  } catch {
    // still show setup
  }
  showSetup();
}

async function quitApp() {
  try {
    await invoke('quit_app');
  } catch {
    window.close();
  }
}

modeHost.addEventListener('click', () => setMode('host'));
modeOverlay.addEventListener('click', () => setMode('overlay'));
saveButton.addEventListener('click', () => {
  void saveAndStart();
});
logsButton.addEventListener('click', () => {
  void openLogs();
});
editButton.addEventListener('click', () => {
  void editSettings();
});
quitButton.addEventListener('click', () => {
  void quitApp();
});

void boot();
