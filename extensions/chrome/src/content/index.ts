import { resolveAtsAdapter } from './ats';
import { ContentOverlay } from './overlay';
import type { ApplicationPackPayload, MatchedJobRecord, ProfileFillData } from '../types';

async function main() {
  const currentUrl = window.location.href;
  const adapter = resolveAtsAdapter(currentUrl, document);

  // Invariant §12: Unknown ATS page → extension does nothing.
  if (!adapter) {
    return;
  }

  console.log(`[JobOps Copilot] Active ATS adapter identified: ${adapter.name}`);

  // 1. Check if page is an already-submitted confirmation page
  const submission = adapter.detectSubmission(currentUrl, document);
  if (submission) {
    console.log('[JobOps Copilot] Application confirmation detected:', submission);
    chrome.runtime?.sendMessage?.(
      {
        type: 'CAPTURE_SUBMISSION',
        payload: {
          jobUrl: currentUrl,
          atsName: submission.atsName,
          confirmationUrl: submission.confirmationUrl,
          notes: submission.notes,
        },
      },
      (res) => {
        if (res?.ok) {
          const overlay = new ContentOverlay(() => {});
          overlay.mount(document);
          overlay.showSubmissionCaptured();
        }
      }
    );
    return;
  }

  // 2. We are on an application form page: mount overlay & match job
  let matchedJob: MatchedJobRecord | null = null;
  let applicationPack: ApplicationPackPayload | null = null;
  let profileData: ProfileFillData | null = null;

  const performAutofill = async (): Promise<{ filledCount: number; flaggedCount: number }> => {
    try {
      if (!profileData) {
        const profileRes = await chrome.runtime.sendMessage({ type: 'GET_PROFILE_FILL' });
        if (profileRes?.ok && profileRes.data) {
          profileData = profileRes.data as ProfileFillData;
        } else {
          throw new Error(profileRes?.error || 'Failed to retrieve profile fill data');
        }
      }

      const result = adapter.autofill({
        document,
        url: window.location.href,
        profileData: profileData!,
        applicationPack,
      });

      console.log('[JobOps Copilot] Autofill completed:', result);
      overlay.showResult(result.filledFields.length, result.flaggedFields.length);

      return {
        filledCount: result.filledFields.length,
        flaggedCount: result.flaggedFields.length,
      };
    } catch (err: any) {
      console.error('[JobOps Copilot] Autofill failed:', err);
      alert(`JobOps Autofill Error: ${err.message}`);
      return { filledCount: 0, flaggedCount: 0 };
    }
  };

  const overlay = new ContentOverlay(() => {
    performAutofill();
  });
  overlay.mount(document);

  // Match URL against CRM
  chrome.runtime?.sendMessage?.({ type: 'MATCH_URL', url: currentUrl }, (res) => {
    if (res?.ok && res.data) {
      if (res.data.matched && res.data.job) {
        matchedJob = res.data.job;
        applicationPack = res.data.applicationPack;
        overlay.showMatchedJob(matchedJob!, applicationPack);
      }
    }
  });

  // Listen for messages from popup
  chrome.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
    if (message.type === 'TRIGGER_AUTOFILL') {
      performAutofill()
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse({ error: error.message }));
      return true;
    }
    return false;
  });

  // Watch for submission on forms
  document.addEventListener('submit', () => {
    setTimeout(() => {
      const sub = adapter.detectSubmission(window.location.href, document);
      if (sub) {
        chrome.runtime?.sendMessage?.({
          type: 'CAPTURE_SUBMISSION',
          payload: {
            jobId: matchedJob?.id,
            jobUrl: currentUrl,
            atsName: sub.atsName,
            confirmationUrl: sub.confirmationUrl,
            notes: sub.notes,
          },
        });
      }
    }, 1200);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}
