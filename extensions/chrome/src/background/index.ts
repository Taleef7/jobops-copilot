import {
  captureApplication,
  getProfileFill,
  matchJobByUrl,
  verifyConnection,
} from '../shared/api';
import { getSettings, saveSettings } from '../shared/storage';
import type { ExtensionMessage } from '../types';

const SUPPORTED_ATS_DOMAINS = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'myworkdayjobs.com',
  'workday.com',
];

function isAtsUrl(url?: string): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return SUPPORTED_ATS_DOMAINS.some((domain) => hostname.includes(domain));
  } catch {
    return false;
  }
}

// Update action badge when switching or navigating tabs
chrome.tabs?.onUpdated?.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (isAtsUrl(tab.url)) {
      chrome.action?.setBadgeText?.({ tabId, text: 'ATS' });
      chrome.action?.setBadgeBackgroundColor?.({ tabId, color: '#059669' });
    } else {
      chrome.action?.setBadgeText?.({ tabId, text: '' });
    }
  }
});

// Central message router
chrome.runtime?.onMessage?.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  handleMessage(message)
    .then((result) => sendResponse({ ok: true, data: result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  // Return true to keep message channel open for async response
  return true;
});

async function handleMessage(message: ExtensionMessage): Promise<any> {
  switch (message.type) {
    case 'GET_SETTINGS': {
      return await getSettings();
    }

    case 'SAVE_SETTINGS': {
      return await saveSettings(message.settings);
    }

    case 'VERIFY_TOKEN': {
      const settings = await getSettings();
      return await verifyConnection(settings.apiUrl, settings.pat);
    }

    case 'MATCH_URL': {
      const settings = await getSettings();
      if (!settings.pat) {
        return { matched: false, error: 'No personal access token configured' };
      }
      return await matchJobByUrl(settings.apiUrl, settings.pat, message.url);
    }

    case 'GET_PROFILE_FILL': {
      const settings = await getSettings();
      if (!settings.pat) {
        throw new Error('No personal access token configured');
      }
      return await getProfileFill(settings.apiUrl, settings.pat);
    }

    case 'CAPTURE_SUBMISSION': {
      const settings = await getSettings();
      if (!settings.pat) {
        throw new Error('No personal access token configured');
      }
      return await captureApplication(settings.apiUrl, settings.pat, message.payload);
    }

    default:
      throw new Error(`Unknown message type: ${(message as any)?.type}`);
  }
}

console.log('[JobOps Extension] Service worker initialized.');
