import { dispatchChangeEvent, findLabelText, highlightField, matchAnswerForQuestion, setNativeValue } from '../helpers';
import type { AtsAdapter, AutofillContext, AutofillResult, SubmissionDetails } from '../types';

export const workdayAdapter: AtsAdapter = {
  name: 'workday',

  matches(url: string, doc: Document): boolean {
    const isDomain = url.toLowerCase().includes('myworkdayjobs.com') || url.toLowerCase().includes('workday.com');
    const hasWorkdayDom = Boolean(
      doc.querySelector('[data-automation-id*="workday"]') ||
      doc.querySelector('[data-automation-id*="legalNameSection"]') ||
      doc.querySelector('[data-automation-id*="apply"]') ||
      doc.querySelector('div[id*="wd-"]')
    );
    return isDomain || hasWorkdayDom;
  },

  autofill(context: AutofillContext): AutofillResult {
    const { document: doc, profileData, applicationPack } = context;
    const profile = profileData.profile;
    const filled: string[] = [];
    const skipped: string[] = [];
    const flagged: string[] = [];

    const fillInput = (selector: string, value?: string, label = selector) => {
      if (!value) return;
      const el = doc.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
      if (el && !el.value.trim()) {
        setNativeValue(el, value);
        highlightField(el, 'filled');
        filled.push(label);
      }
    };

    // Standard Workday data-automation-id selectors
    fillInput('[data-automation-id="legalNameSection_firstName"]', profile.firstName, 'First Name');
    fillInput('[data-automation-id="legalNameSection_lastName"]', profile.lastName, 'Last Name');
    fillInput('[data-automation-id="email"]', profile.email, 'Email');
    fillInput('[data-automation-id="phone-number"]', profile.phone, 'Phone');
    fillInput('[data-automation-id="addressSection_city"]', profile.city, 'City');
    fillInput('[data-automation-id="addressSection_postalCode"]', profile.postalCode, 'Postal Code');
    fillInput('[data-automation-id="addressSection_countryRegion"]', profile.state, 'State / Region');

    // Fallbacks if data-automation-ids differ
    if (!doc.querySelector('[data-automation-id="legalNameSection_firstName"]')) {
      fillInput('input[id*="firstName" i]', profile.firstName, 'First Name');
    }
    if (!doc.querySelector('[data-automation-id="legalNameSection_lastName"]')) {
      fillInput('input[id*="lastName" i]', profile.lastName, 'Last Name');
    }

    // Dynamic questionnaire / custom question fields
    const questionContainers = doc.querySelectorAll(
      '[data-automation-id*="formField"], [data-automation-id*="question"], [data-automation-id*="Questionnaire"]'
    );

    questionContainers.forEach((container) => {
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input:not([type="hidden"]):not([type="file"]), textarea, select'
      );
      if (!input) return;
      if (input.value && input.value.trim()) return;

      const label = findLabelText(input, doc);
      if (!label) return;

      const match = matchAnswerForQuestion(label, profileData, applicationPack);
      if (match && match.answer) {
        if (input.tagName === 'SELECT') {
          const select = input as HTMLSelectElement;
          const target = match.answer.toLowerCase();
          for (let i = 0; i < select.options.length; i++) {
            const opt = select.options[i]!;
            if (opt.text.toLowerCase().includes(target) || opt.value.toLowerCase().includes(target)) {
              select.selectedIndex = i;
              dispatchChangeEvent(select);
              highlightField(select, match.flagged ? 'flagged' : 'filled');
              filled.push(label);
              if (match.flagged) flagged.push(label);
              return;
            }
          }
        } else {
          setNativeValue(input as HTMLInputElement | HTMLTextAreaElement, match.answer);
          highlightField(input, match.flagged ? 'flagged' : 'filled');
          filled.push(label);
          if (match.flagged) flagged.push(label);
        }
      } else {
        highlightField(input, 'blank');
        skipped.push(label);
      }
    });

    return {
      atsName: 'workday',
      filledFields: filled,
      skippedFields: skipped,
      flaggedFields: flagged,
    };
  },

  detectSubmission(url: string, doc: Document): SubmissionDetails | null {
    const hasSubmissionDom = Boolean(
      doc.querySelector('[data-automation-id="applicationSubmittedMessage"]') ||
      doc.querySelector('[data-automation-id="congratulationsMessage"]') ||
      doc.body?.textContent?.includes('Congratulations, your application has been submitted') ||
      doc.body?.textContent?.includes('Application Submitted')
    );

    if (hasSubmissionDom) {
      return {
        atsName: 'workday',
        confirmationUrl: url,
        notes: 'Workday application submission confirmed',
      };
    }

    return null;
  },
};
