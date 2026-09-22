import { dispatchChangeEvent, findLabelText, highlightField, matchAnswerForQuestion, setNativeValue } from '../helpers';
import type { AtsAdapter, AutofillContext, AutofillResult, SubmissionDetails } from '../types';

export const ashbyAdapter: AtsAdapter = {
  name: 'ashby',

  matches(url: string, doc: Document): boolean {
    const isDomain = url.toLowerCase().includes('ashbyhq.com');
    const hasAshbyElement = Boolean(
      doc.querySelector('[data-ashby-app]') ||
      doc.querySelector('div[class*="ashby"]') ||
      doc.querySelector('meta[content*="ashbyhq.com"]') ||
      doc.querySelector('a[href*="ashbyhq.com"]')
    );
    return isDomain || hasAshbyElement;
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

    // Standard Ashby fields
    fillInput('input[name="name"], input[autocomplete="name"]', profile.fullName, 'Full Name');
    fillInput('input[name="email"], input[type="email"]', profile.email, 'Email');
    fillInput('input[name="phone"], input[type="tel"]', profile.phone, 'Phone');

    // Socials & URLs
    fillInput('input[placeholder*="linkedin" i], input[name*="linkedin" i]', profile.linkedinUrl, 'LinkedIn');
    fillInput('input[placeholder*="github" i], input[name*="github" i]', profile.githubUrl, 'GitHub');
    fillInput('input[placeholder*="website" i], input[name*="website" i]', profile.websiteUrl || profile.portfolioUrl, 'Website');

    // Dynamic question fields
    const inputs = doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      'input:not([type="hidden"]):not([type="file"]), textarea, select'
    );

    inputs.forEach((input) => {
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
      atsName: 'ashby',
      filledFields: filled,
      skippedFields: skipped,
      flaggedFields: flagged,
    };
  },

  detectSubmission(url: string, doc: Document): SubmissionDetails | null {
    const isSuccessUrl = url.includes('/application-success') || url.includes('/confirmation');
    const hasSuccessDom = Boolean(
      doc.querySelector('[data-testid="application-success"]') ||
      doc.body?.textContent?.includes('Thank you for applying') ||
      doc.body?.textContent?.includes('We have received your application')
    );

    if (isSuccessUrl || hasSuccessDom) {
      return {
        atsName: 'ashby',
        confirmationUrl: url,
        notes: 'Ashby application confirmation detected',
      };
    }

    return null;
  },
};
