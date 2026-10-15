import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { OutreachDraft } from '@/types/job';
import { SavedOutreachDraft } from './saved-outreach-draft';

function draft(overrides: Partial<OutreachDraft> = {}): OutreachDraft {
  return {
    id: 'outreach-1',
    jobId: 'job-1',
    contactName: 'Dana',
    contactRole: 'Recruiter',
    contactSource: 'manual',
    messageType: 'linkedin_connection',
    draftText: 'a'.repeat(420),
    status: 'drafted',
    createdAt: '2026-10-15T00:00:00.000Z',
    ...overrides,
  };
}

// #354: the job page shows the saved draft after a refresh, so the length warning goes there too.
it('warns about a saved LinkedIn connection note over 300 characters', () => {
  render(<SavedOutreachDraft draft={draft()} company="Acme" />);
  expect(screen.getByText(/over 300 characters/i)).toBeInTheDocument();
});

it('does not warn about a note within the limit', () => {
  render(<SavedOutreachDraft draft={draft({ draftText: 'Hi there, I would like to connect.' })} company="Acme" />);
  expect(screen.getByText('Hi there, I would like to connect.')).toBeInTheDocument();
  expect(screen.queryByText(/over 300 characters/i)).not.toBeInTheDocument();
});
