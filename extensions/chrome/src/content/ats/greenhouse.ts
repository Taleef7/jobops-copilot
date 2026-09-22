import { dispatchChangeEvent, findLabelText, highlightField, matchAnswerForQuestion, setNativeValue } from '../helpers';
import type { AtsAdapter, AutofillContext, AutofillResult, SubmissionDetails } from '../types';

export const greenhouseAdapter: AtsAdapter = {
  name: 'greenhouse',

  matches(url: string, doc: Document): boolean {
    const isDomain = url.toLowerCase().includes('greenhouse.io') || url.toLowerCase().includes('gh.io');
    const hasGreenhouseElement = Boolean(
      doc.querySelector('#application_form') ||
      doc.querySelector('#apply_app') ||
      doc.querySelector('#app_body') ||
      doc.querySelector('form[action*="greenhouse.io"]') ||
      doc.querySelector('meta[content*="greenhouse.io"]')
    );
    return isDomain || hasGreenhouseElement;
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

    // Standard Greenhouse fields
    fillInput('#first_name', profile.firstName, 'First Name');
    fillInput('#last_name', profile.lastName, 'Last Name');
    fillInput('#email', profile.email, 'Email');
    fillInput('#phone', profile.phone, 'Phone');

    // Fallback for full name if first/last aren't separate
    if (!doc.querySelector('#first_name') && !doc.querySelector('#last_name')) {
      fillInput('#name, input[name="name"], input[autocomplete="name"]', profile.fullName, 'Full Name');
    }

    // Cover letter textarea if available
    const coverLetterText = applicationPack?.coverLetterText || profile.summary;
    fillInput('#cover_letter_text, textarea[name*="cover_letter"]', coverLetterText, 'Cover Letter');

    // Dynamic custom question fields
    const customFields = doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      '.field input, .field textarea, .field select, div[id*="custom_fields"] input, div[id*="custom_fields"] textarea, div[id*="custom_fields"] select'
    );

    customFields.forEach((field) => {
      // Skip file inputs or hidden inputs
      if (field.type === 'file' || field.type === 'hidden') return;
      if (field.value && field.value.trim()) return;

      const labelText = findLabelText(field, doc);
      if (!labelText) return;

      const match = matchAnswerForQuestion(labelText, profileData, applicationPack);
      if (match && match.answer) {
        if (field.tagName === 'SELECT') {
          const select = field as HTMLSelectElement;
          const target = match.answer.toLowerCase();
          for (let i = 0; i < select.options.length; i++) {
            const opt = select.options[i]!;
            if (opt.text.toLowerCase().includes(target) || opt.value.toLowerCase().includes(target)) {
              select.selectedIndex = i;
              dispatchChangeEvent(select);
              highlightField(select, match.flagged ? 'flagged' : 'filled');
              filled.push(labelText);
              if (match.flagged) flagged.push(labelText);
              return;
            }
          }
        } else {
          setNativeValue(field as HTMLInputElement | HTMLTextAreaElement, match.answer);
          highlightField(field, match.flagged ? 'flagged' : 'filled');
          filled.push(labelText);
          if (match.flagged) flagged.push(labelText);
        }
      } else {
        highlightField(field, 'blank');
        skipped.push(labelText);
      }
    });

    return {
      atsName: 'greenhouse',
      filledFields: filled,
      skippedFields: skipped,
      flaggedFields: flagged,
    };
  },

  detectSubmission(url: string, doc: Document): SubmissionDetails | null {
    const isConfirmationUrl = url.includes('/confirmation') || url.includes('#confirmation') || url.includes('/thanks');
    const hasConfirmationDom = Boolean(
      doc.querySelector('#application_confirmation') ||
      doc.querySelector('.application-confirmation') ||
      doc.querySelector('#confirmation') ||
      doc.body?.textContent?.includes('Thank you for applying') ||
      doc.body?.textContent?.includes('Your application has been submitted')
    );

    if (isConfirmationUrl || hasConfirmationDom) {
      return {
        atsName: 'greenhouse',
        confirmationUrl: url,
        notes: 'Greenhouse confirmation screen detected',
      };
    }

    return null;
  },
};
