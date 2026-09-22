import { captureApplication, matchJobByUrl } from '../shared/api';
import { getSettings } from '../shared/storage';
import type { MatchedJobRecord } from '../types';

const loadingState = document.getElementById('loading-state') as HTMLDivElement | null;
const unconfiguredState = document.getElementById('unconfigured-state') as HTMLDivElement | null;
const matchedState = document.getElementById('matched-state') as HTMLDivElement | null;
const unmatchedState = document.getElementById('unmatched-state') as HTMLDivElement | null;

const setupBtn = document.getElementById('setup-btn') as HTMLButtonElement | null;
const openOptionsLink = document.getElementById('open-options-link') as HTMLAnchorElement | null;
const dashboardLink = document.getElementById('dashboard-link') as HTMLAnchorElement | null;

const jobTitleEl = document.getElementById('job-title') as HTMLElement | null;
const jobCompanyEl = document.getElementById('job-company') as HTMLElement | null;
const jobStatusEl = document.getElementById('job-status') as HTMLElement | null;
const packAnswersCountEl = document.getElementById('pack-answers-count') as HTMLElement | null;
const packFlaggedCountEl = document.getElementById('pack-flagged-count') as HTMLElement | null;
const packResumeStatusEl = document.getElementById('pack-resume-status') as HTMLElement | null;
const autofillBtn = document.getElementById('autofill-btn') as HTMLButtonElement | null;
const viewPackBtn = document.getElementById('view-pack-btn') as HTMLButtonElement | null;

const recentJobsWrap = document.getElementById('recent-jobs-wrap') as HTMLDivElement | null;
const recentJobsSelect = document.getElementById('recent-jobs-select') as HTMLSelectElement | null;
const quickCaptureBtn = document.getElementById('quick-capture-btn') as HTMLButtonElement | null;

let currentTabUrl = '';
let currentJob: MatchedJobRecord | null = null;
let webBaseUrl = 'http://localhost:3000';

function getWebUrl(apiUrl: string): string {
  try {
    const parsed = new URL(apiUrl);
    if (parsed.port === '4000') {
      return `${parsed.protocol}//${parsed.hostname}:3000`;
    }
    return apiUrl.replace(/\/+$/, '');
  } catch {
    return 'http://localhost:3000';
  }
}

function showState(target: HTMLElement | null) {
  [loadingState, unconfiguredState, matchedState, unmatchedState].forEach((el) => {
    if (el) el.classList.add('hidden');
  });
  if (target) target.classList.remove('hidden');
}

function detectAtsFromUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('greenhouse.io')) return 'greenhouse';
  if (lower.includes('lever.co')) return 'lever';
  if (lower.includes('ashbyhq.com')) return 'ashby';
  if (lower.includes('myworkdayjobs.com') || lower.includes('workday.com')) return 'workday';
  return 'ats';
}

async function initPopup() {
  const settings = await getSettings();
  webBaseUrl = getWebUrl(settings.apiUrl);

  if (dashboardLink) {
    dashboardLink.href = `${webBaseUrl}/dashboard`;
  }

  // Check if PAT is configured
  if (!settings.pat) {
    showState(unconfiguredState);
    return;
  }

  // Query active tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  currentTabUrl = activeTab?.url || '';

  if (!currentTabUrl || currentTabUrl.startsWith('chrome://')) {
    showState(unmatchedState);
    return;
  }

  try {
    const match = await matchJobByUrl(settings.apiUrl, settings.pat, currentTabUrl);

    if (match.matched && match.job) {
      currentJob = match.job;
      if (jobTitleEl) jobTitleEl.textContent = match.job.title;
      if (jobCompanyEl) jobCompanyEl.textContent = match.job.company;
      if (jobStatusEl) jobStatusEl.textContent = match.job.status;

      const pack = match.applicationPack;
      if (pack) {
        if (packAnswersCountEl) {
          packAnswersCountEl.textContent = `• ${pack.answers?.length || 0} answers grounded from profile & Q&A`;
        }
        if (packFlaggedCountEl) {
          const flaggedLen = pack.flaggedQuestions?.length || 0;
          packFlaggedCountEl.textContent = `• ${flaggedLen} flagged question${flaggedLen === 1 ? '' : 's'}`;
          packFlaggedCountEl.style.color = flaggedLen > 0 ? '#f59e0b' : '#94a3b8';
        }
        if (packResumeStatusEl) {
          packResumeStatusEl.textContent = pack.resumeVersionId
            ? '• Tailored resume attached'
            : '• Base resume attached';
        }
      }

      showState(matchedState);
    } else {
      // Unmatched state with optional recent jobs
      if (match.recentJobs && match.recentJobs.length > 0 && recentJobsSelect && recentJobsWrap) {
        recentJobsSelect.innerHTML = '<option value="">-- Choose matching job --</option>';
        match.recentJobs.forEach((job) => {
          const opt = document.createElement('option');
          opt.value = job.id;
          opt.textContent = `${job.company} — ${job.title}`;
          recentJobsSelect.appendChild(opt);
        });
        recentJobsWrap.classList.remove('hidden');
      }

      showState(unmatchedState);
    }
  } catch (err: any) {
    console.error('Failed to match URL:', err);
    showState(unmatchedState);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initPopup();

  // Settings navigation
  setupBtn?.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  openOptionsLink?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Autofill button (message content script)
  autofillBtn?.addEventListener('click', async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'TRIGGER_AUTOFILL' }, (response) => {
        if (chrome.runtime.lastError) {
          alert('Autofill script not available on this tab. Refresh page to try again.');
        } else if (response?.filledCount !== undefined) {
          alert(`Autofill complete: filled ${response.filledCount} fields.`);
        }
      });
    }
  });

  // View pack in web app
  viewPackBtn?.addEventListener('click', () => {
    if (currentJob?.id) {
      chrome.tabs.create({ url: `${webBaseUrl}/jobs/${currentJob.id}` });
    }
  });

  // Quick capture application
  quickCaptureBtn?.addEventListener('click', async () => {
    const settings = await getSettings();
    const selectedJobId = recentJobsSelect?.value || undefined;

    quickCaptureBtn.disabled = true;
    quickCaptureBtn.textContent = 'Recording...';

    try {
      const ats = detectAtsFromUrl(currentTabUrl);
      const res = await captureApplication(settings.apiUrl, settings.pat, {
        jobId: selectedJobId,
        jobUrl: currentTabUrl,
        atsName: ats,
      });

      if (res.success) {
        alert('Application recorded in CRM as "Applied"!');
        window.close();
      }
    } catch (err: any) {
      alert(`Failed to capture application: ${err.message}`);
    } finally {
      quickCaptureBtn.disabled = false;
      quickCaptureBtn.textContent = 'Track as Applied in CRM';
    }
  });
});
