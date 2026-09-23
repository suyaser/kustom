const { invoke } = window.__TAURI__.core;
const { open } = window.__TAURI__.shell;

// Elements
const setupScreen = document.getElementById('setup-screen');
const runningScreen = document.getElementById('running-screen');
const tokenInput = document.getElementById('token-input');
const apiInput = document.getElementById('api-input');
const saveButton = document.getElementById('save-button');
const errorMessage = document.getElementById('error-message');

const statusState = document.getElementById('status-state');
const playerName = document.getElementById('player-name');
const logsButton = document.getElementById('logs-button');
const editButton = document.getElementById('edit-button');
const quitButton = document.getElementById('quit-button');

// State
let hasConfig = false;

// Check if config exists on startup
async function checkConfig() {
  // TODO: Check if config file exists via backend command
  // For now, always show setup
  hasConfig = false;

  if (hasConfig) {
    showRunningScreen();
    startStatusPolling();
  } else {
    showSetupScreen();
  }
}

function showSetupScreen() {
  setupScreen.classList.remove('hidden');
  runningScreen.classList.add('hidden');
}

function showRunningScreen() {
  setupScreen.classList.add('hidden');
  runningScreen.classList.remove('hidden');
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
}

function hideError() {
  errorMessage.classList.add('hidden');
}

async function saveConfig() {
  const token = tokenInput.value.trim();
  const _apiBase = apiInput.value.trim();

  if (!token) {
    showError('Please enter a companion token');
    return;
  }

  hideError();
  saveButton.disabled = true;
  saveButton.textContent = 'Saving...';

  try {
    // TODO: Save config via Tauri command that writes to config.json
    // For now, just simulate
    await new Promise((resolve) => setTimeout(resolve, 500));

    hasConfig = true;
    showRunningScreen();
    startStatusPolling();
  } catch (error) {
    showError(`Failed to save config: ${error.message}`);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = 'Save and Start';
  }
}

async function updateStatus() {
  try {
    const status = await invoke('get_status');
    statusState.textContent = status.state.charAt(0).toUpperCase() + status.state.slice(1);
    playerName.textContent = status.playerName || '—';
  } catch (error) {
    console.error('Failed to get status:', error);
  }
}

function startStatusPolling() {
  updateStatus();
  setInterval(updateStatus, 2000);
}

async function openLogs() {
  const logsPath = '%APPDATA%\\customs-night\\logs';
  try {
    await open(logsPath);
  } catch (error) {
    console.error('Failed to open logs:', error);
  }
}

function editToken() {
  showSetupScreen();
}

async function quit() {
  // TODO: Stop sidecar gracefully
  window.close();
}

// Event listeners
saveButton.addEventListener('click', saveConfig);
logsButton.addEventListener('click', openLogs);
editButton.addEventListener('click', editToken);
quitButton.addEventListener('click', quit);

// Initialize
checkConfig();
