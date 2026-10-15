import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { OutreachDraftCard } from './outreach-draft-card';

// #354: the approval queue shows saved drafts, so the length warning has to survive a refresh.
it('warns about a saved LinkedIn connection note over 300 characters', () => {
  render(<OutreachDraftCard draftText={'a'.repeat(420)} messageType="linkedin_connection" />);
  expect(screen.getByText(/over 300 characters/i)).toBeInTheDocument();
});

it('does not warn about an email of the same length', () => {
  render(<OutreachDraftCard draftText={'a'.repeat(420)} messageType="recruiter_email" />);
  expect(screen.queryByText(/over 300 characters/i)).not.toBeInTheDocument();
});
