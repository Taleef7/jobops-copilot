import type { ExtensionSettings } from '../types';

export const DEFAULT_API_URL = 'http://localhost:4000';

const DEFAULT_SETTINGS: ExtensionSettings = {
  apiUrl: DEFAULT_API_URL,
  pat: '',
};

let memoryStore: Record<string, any> = {};

function getChromeStorage(): chrome.storage.StorageArea | null {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    return chrome.storage.sync || chrome.storage.local || null;
  }
  return null;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const storage = getChromeStorage();
  if (!storage) {
    return {
      apiUrl: memoryStore['apiUrl'] || DEFAULT_SETTINGS.apiUrl,
      pat: memoryStore['pat'] || DEFAULT_SETTINGS.pat,
    };
  }

  return new Promise((resolve) => {
    storage.get(['apiUrl', 'pat'], (result) => {
      resolve({
        apiUrl: (result['apiUrl'] as string) || DEFAULT_SETTINGS.apiUrl,
        pat: (result['pat'] as string) || DEFAULT_SETTINGS.pat,
      });
    });
  });
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getSettings();
  const updated: ExtensionSettings = {
    apiUrl: settings.apiUrl !== undefined ? settings.apiUrl.trim() : current.apiUrl,
    pat: settings.pat !== undefined ? settings.pat.trim() : current.pat,
  };

  const storage = getChromeStorage();
  if (!storage) {
    memoryStore['apiUrl'] = updated.apiUrl;
    memoryStore['pat'] = updated.pat;
    return updated;
  }

  return new Promise((resolve, reject) => {
    storage.set({ apiUrl: updated.apiUrl, pat: updated.pat }, () => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(updated);
      }
    });
  });
}

export function resetMemoryStoreForTests(initial: Partial<ExtensionSettings> = {}) {
  memoryStore = {
    apiUrl: initial.apiUrl || DEFAULT_SETTINGS.apiUrl,
    pat: initial.pat || DEFAULT_SETTINGS.pat,
  };
}
