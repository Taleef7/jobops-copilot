import type { ApplicationPackPayload, ProfileFillData } from '../types';

/**
 * Dispatches a change event using the element's window Event constructor.
 */
export function dispatchChangeEvent(element: HTMLElement): void {
  const EventConstructor = element.ownerDocument?.defaultView?.Event || globalThis.Event;
  element.dispatchEvent(new EventConstructor('change', { bubbles: true }));
}

/**
 * Dispatches proper input/change events so React/Vue/Angular forms detect changes.
 */
export function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  if (!element) return;

  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }

  const EventConstructor = element.ownerDocument?.defaultView?.Event || globalThis.Event;
  element.dispatchEvent(new EventConstructor('input', { bubbles: true }));
  element.dispatchEvent(new EventConstructor('change', { bubbles: true }));
  element.dispatchEvent(new EventConstructor('blur', { bubbles: true }));
}

/**
 * Highlights a form field to give visual confirmation of autofilled vs unhandled fields.
 */
export function highlightField(element: HTMLElement, type: 'filled' | 'blank' | 'flagged'): void {
  if (!element) return;

  element.classList.add('jobops-field-highlighted');
  if (type === 'filled') {
    element.style.setProperty('outline', '2px solid #10b981', 'important');
    element.style.setProperty('background-color', 'rgba(16, 185, 129, 0.05)', 'important');
  } else if (type === 'flagged') {
    element.style.setProperty('outline', '2px solid #f59e0b', 'important');
    element.style.setProperty('background-color', 'rgba(245, 158, 11, 0.05)', 'important');
  } else {
    element.style.setProperty('outline', '1px dashed #94a3b8', 'important');
  }
}

/**
 * Retrieves label text associated with an input element.
 */
export function findLabelText(element: HTMLElement, doc: Document = document): string {
  // 1. Associated <label for="id">
  if (element.id) {
    const label = doc.querySelector(`label[for="${element.id}"]`);
    if (label && label.textContent?.trim()) {
      return label.textContent.trim();
    }
  }

  // 2. Parent label element
  const parentLabel = element.closest('label');
  if (parentLabel && parentLabel.textContent?.trim()) {
    return parentLabel.textContent.trim();
  }

  // 3. aria-label or aria-labelledby
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel?.trim()) return ariaLabel.trim();

  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = doc.getElementById(labelledBy);
    if (labelEl && labelEl.textContent?.trim()) {
      return labelEl.textContent.trim();
    }
  }

  // 4. Closest preceding heading, label, or legend in form group
  const formGroup = element.closest('.field, .form-group, .application-question, [data-automation-id*="formField"]');
  if (formGroup) {
    const groupLabel = formGroup.querySelector('label, legend, h3, h4, .label');
    if (groupLabel && groupLabel.textContent?.trim()) {
      return groupLabel.textContent.trim();
    }
  }

  // 5. Placeholder or name attribute as fallback
  const placeholder = (element as HTMLInputElement).placeholder;
  if (placeholder?.trim()) return placeholder.trim();

  const name = (element as HTMLInputElement).name;
  if (name?.trim()) return name.trim();

  return '';
}

/**
 * Normalizes question strings for fuzzy dictionary matching.
 */
export function normalizeQuestion(text: string): string {
  return text
    .toLowerCase()
    .replace(/[?*:]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Matches question labels against profile data and Q&A memory.
 */
export function matchAnswerForQuestion(
  questionLabel: string,
  profileData: ProfileFillData,
  applicationPack?: ApplicationPackPayload | null,
): { answer: string; flagged: boolean } | null {
  const norm = normalizeQuestion(questionLabel);

  // 1. Check application pack answers first
  if (applicationPack?.answers) {
    for (const ans of applicationPack.answers) {
      if (normalizeQuestion(ans.questionText) === norm) {
        return { answer: ans.answer, flagged: ans.flagged };
      }
    }
  }

  // 2. Check Q&A memory from profileData
  if (profileData.answers) {
    for (const [key, ans] of Object.entries(profileData.answers)) {
      if (normalizeQuestion(key) === norm) {
        return { answer: ans, flagged: false };
      }
    }
  }

  // 3. Heuristic matching for common ATS questions
  if (norm.includes('authorized to work') || norm.includes('legally authorized') || norm.includes('work authorization')) {
    return {
      answer: profileData.profile.workAuthorization.authorizedInUS ? 'Yes' : 'No',
      flagged: false,
    };
  }

  if (norm.includes('sponsorship') || norm.includes('require visa') || norm.includes('future visa')) {
    return {
      answer: profileData.profile.workAuthorization.requireSponsorship ? 'Yes' : 'No',
      flagged: false,
    };
  }

  if (norm.includes('salary') || norm.includes('compensation') || norm.includes('target pay')) {
    // Check if any salary answer was stored
    for (const [k, v] of Object.entries(profileData.answers || {})) {
      if (k.toLowerCase().includes('salary') || k.toLowerCase().includes('compensation')) {
        return { answer: v, flagged: false };
      }
    }
    return {
      answer: 'Competitive with market rate for this role and seniority.',
      flagged: true,
    };
  }

  if (norm.includes('linkedin')) {
    if (profileData.profile.linkedinUrl) {
      return { answer: profileData.profile.linkedinUrl, flagged: false };
    }
  }

  if (norm.includes('github')) {
    if (profileData.profile.githubUrl) {
      return { answer: profileData.profile.githubUrl, flagged: false };
    }
  }

  if (norm.includes('portfolio') || norm.includes('website') || norm.includes('personal site')) {
    const url = profileData.profile.portfolioUrl || profileData.profile.websiteUrl;
    if (url) return { answer: url, flagged: false };
  }

  if (norm.includes('current company') || norm.includes('current employer')) {
    if (profileData.profile.currentCompany) {
      return { answer: profileData.profile.currentCompany, flagged: false };
    }
  }

  return null;
}
