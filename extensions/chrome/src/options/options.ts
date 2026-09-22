import { verifyConnection } from '../shared/api';
import { getSettings, saveSettings } from '../shared/storage';

const form = document.getElementById('settings-form') as HTMLFormElement | null;
const apiUrlInput = document.getElementById('api-url') as HTMLInputElement | null;
const patTokenInput = document.getElementById('pat-token') as HTMLInputElement | null;
const toggleTokenBtn = document.getElementById('toggle-token-btn') as HTMLButtonElement | null;
const testBtn = document.getElementById('test-connection-btn') as HTMLButtonElement | null;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement | null;
const statusCard = document.getElementById('status-card') as HTMLDivElement | null;
const openSettingsLink = document.getElementById('open-settings-link') as HTMLAnchorElement | null;

function showStatus(message: string, type: 'success' | 'error' | 'info') {
  if (!statusCard) return;
  statusCard.className = `status-card ${type}`;
  statusCard.innerHTML = message;
}

function clearStatus() {
  if (!statusCard) return;
  statusCard.className = 'status-card hidden';
  statusCard.innerHTML = '';
}

function updateWebSettingsLink(apiUrl: string) {
  if (!openSettingsLink) return;
  try {
    const url = new URL(apiUrl);
    // If running locally on 4000, point web to 3000
    if (url.port === '4000') {
      openSettingsLink.href = `${url.protocol}//${url.hostname}:3000/settings`;
    } else {
      openSettingsLink.href = `${apiUrl.replace(/\/+$/, '')}/settings`;
    }
  } catch {
    openSettingsLink.href = 'http://localhost:3000/settings';
  }
}

async function loadCurrentSettings() {
  const settings = await getSettings();
  if (apiUrlInput) apiUrlInput.value = settings.apiUrl;
  if (patTokenInput) patTokenInput.value = settings.pat;
  updateWebSettingsLink(settings.apiUrl);

  if (settings.pat) {
    runConnectionTest(settings.apiUrl, settings.pat, false);
  }
}

async function runConnectionTest(apiUrl: string, pat: string, alertOnSuccess = true) {
  if (!testBtn) return;
  const originalText = testBtn.textContent;
  testBtn.disabled = true;
  testBtn.textContent = 'Testing...';

  try {
    const result = await verifyConnection(apiUrl, pat);
    if (result.ok) {
      const tokenInfo = result.token
        ? `<strong>Token:</strong> ${result.token.label} &middot; Created ${new Date(result.token.createdAt).toLocaleDateString()}`
        : '';
      showStatus(
        `<div><strong>Connection Verified!</strong></div>
         <div>Authenticated as <code>${result.userId || 'unknown'}</code></div>
         ${tokenInfo ? `<div>${tokenInfo}</div>` : ''}`,
        'success',
      );
    } else {
      showStatus(
        `<div><strong>Connection Failed</strong></div>
         <div>${result.error || 'Invalid credentials or unreachable API'}</div>`,
        'error',
      );
    }
  } catch (err: any) {
    showStatus(
      `<div><strong>Error testing connection</strong></div>
       <div>${err.message || 'Unknown network error'}</div>`,
      'error',
    );
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = originalText;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadCurrentSettings();

  // Toggle token visibility
  toggleTokenBtn?.addEventListener('click', () => {
    if (!patTokenInput) return;
    if (patTokenInput.type === 'password') {
      patTokenInput.type = 'text';
      toggleTokenBtn.textContent = 'Hide';
    } else {
      patTokenInput.type = 'password';
      toggleTokenBtn.textContent = 'Show';
    }
  });

  // URL input change updates link
  apiUrlInput?.addEventListener('input', () => {
    if (apiUrlInput) updateWebSettingsLink(apiUrlInput.value);
  });

  // Test button
  testBtn?.addEventListener('click', () => {
    clearStatus();
    const apiUrl = apiUrlInput?.value.trim() || '';
    const pat = patTokenInput?.value.trim() || '';

    if (!pat) {
      showStatus('Please enter a Personal Access Token before testing.', 'error');
      return;
    }

    runConnectionTest(apiUrl, pat, true);
  });

  // Form submit (Save)
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearStatus();

    const apiUrl = apiUrlInput?.value.trim() || '';
    const pat = patTokenInput?.value.trim() || '';

    if (!apiUrl) {
      showStatus('API URL cannot be empty.', 'error');
      return;
    }

    if (!pat) {
      showStatus('Personal Access Token cannot be empty.', 'error');
      return;
    }

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
    }

    try {
      await saveSettings({ apiUrl, pat });
      showStatus('Settings saved successfully! Verifying token...', 'info');
      await runConnectionTest(apiUrl, pat, true);
    } catch (err: any) {
      showStatus(`Failed to save settings: ${err.message}`, 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Settings';
      }
    }
  });
});
