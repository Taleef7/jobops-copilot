import { dispatchChangeEvent, findLabelText, highlightField, matchAnswerForQuestion, setNativeValue } from '../helpers';
import type { AtsAdapter, AutofillContext, AutofillResult, SubmissionDetails } from '../types';

export const leverAdapter: AtsAdapter = {
  name: 'lever',

  matches(url: string, doc: Document): boolean {
    const isDomain = url.toLowerCase().includes('lever.co');
    const hasLeverElement = Boolean(
      doc.querySelector('.application-form') ||
      doc.querySelector('form#application-form') ||
      doc.querySelector('.lever-job') ||
      doc.querySelector('meta[content*="lever.co"]')
    );
    return isDomain || hasLeverElement;
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

    // Standard Lever fields
    fillInput('input[name="name"]', profile.fullName, 'Full Name');
    fillInput('input[name="email"]', profile.email, 'Email');
    fillInput('input[name="phone"]', profile.phone, 'Phone');
    fillInput('input[name="org"]', profile.currentCompany, 'Current Company');

    // Social & URL links
    fillInput('input[name="urls[LinkedIn]"]', profile.linkedinUrl, 'LinkedIn');
    fillInput('input[name="urls[GitHub]"]', profile.githubUrl, 'GitHub');
    fillInput('input[name="urls[Portfolio]"]', profile.portfolioUrl || profile.websiteUrl, 'Portfolio');
    fillInput('input[name="urls[Twitter]"]', '', 'Twitter');
    fillInput('input[name="urls[Other]"]', profile.websiteUrl, 'Website');

    // Additional information / cover letter
    const commentsText = applicationPack?.coverLetterText || profile.summary;
    fillInput('textarea[name="comments"]', commentsText, 'Additional Information');

    // Custom questions (.application-question)
    const questionContainers = doc.querySelectorAll('.application-question, .custom-question');
    questionContainers.forEach((container) => {
      const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        'input, textarea, select'
      );
      if (!input || input.type === 'file' || input.type === 'hidden') return;
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
      atsName: 'lever',
      filledFields: filled,
      skippedFields: skipped,
      flaggedFields: flagged,
    };
  },

  detectSubmission(url: string, doc: Document): SubmissionDetails | null {
    const isThanksUrl = url.toLowerCase().includes('/thanks') || url.toLowerCase().includes('/thank-you');
    const hasThanksDom = Boolean(
      doc.querySelector('.application-confirmation') ||
      doc.querySelector('.thanks') ||
      doc.body?.textContent?.includes('Thank you for submitting your application') ||
      doc.body?.textContent?.includes('Application submitted')
    );

    if (isThanksUrl || hasThanksDom) {
      return {
        atsName: 'lever',
        confirmationUrl: url,
        notes: 'Lever application confirmation detected',
      };
    }

    return null;
  },
};
