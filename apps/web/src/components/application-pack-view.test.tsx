import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApplicationPackView } from './application-pack-view';
import * as api from '@/lib/api';
import type { ApplicationPackPayload } from '@/types/job';

vi.mock('@/lib/api', () => ({
  generateJobApplicationPack: vi.fn(),
  saveApplicationAnswer: vi.fn(),
}));

const SALARY_Q = 'What are your salary expectations for this role?';
const REMOTE_AUTH_Q = 'Are you legally authorized to work in the country where this role is based?';

const samplePack: ApplicationPackPayload = {
  jobId: 'job-test-1',
  company: 'Linear',
  title: 'Senior Frontend Engineer',
  resumeVersionId: 'ver-123',
  resumeFileUrl: 'https://blob/resume.pdf',
  contactBlock: {
    name: 'Sarah Connor',
    email: 'sarah@example.com',
    phone: '555-0100',
    location: 'Los Angeles, CA',
    linkedin: 'https://linkedin.com/in/sarahc',
  },
  answers: [
    {
      questionText: 'Will you now or in the future require visa sponsorship to work in the United States?',
      questionHash: 'hash-0',
      answer: 'No',
      category: 'work_authorization',
      source: 'qa_memory',
      needsReview: false,
      flagged: false,
      note: 'Your saved answer.',
    },
    {
      questionText: REMOTE_AUTH_Q,
      questionHash: 'hash-1',
      answer: 'Yes',
      category: 'work_authorization',
      source: 'qa_memory',
      needsReview: true,
      flagged: true,
      note: "Based on your saved answer for the United States. The posting doesn't say which country this role is in, so confirm it applies.",
    },
    {
      questionText: SALARY_Q,
      questionHash: 'hash-2',
      answer: '',
      category: 'salary',
      source: 'unanswerable',
      needsReview: true,
      flagged: true,
      note: 'Enter your own expectation. The posted salary range is not used.',
    },
  ],
  flaggedQuestions: [REMOTE_AUTH_Q, SALARY_Q],
  generatedAt: '2026-05-14T10:00:00Z',
};

function renderPack(pack: ApplicationPackPayload | null = samplePack) {
  return render(<ApplicationPackView jobId="job-test-1" company="Linear" initialPack={pack} hasResume={true} />);
}

describe('ApplicationPackView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty state and generates a pack', async () => {
    const user = userEvent.setup();
    vi.mocked(api.generateJobApplicationPack).mockResolvedValueOnce(samplePack);
    renderPack(null);

    expect(screen.getByText(/Assemble your application pack/i)).toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Generate application pack/i }));

    await waitFor(() => expect(api.generateJobApplicationPack).toHaveBeenCalledWith('job-test-1'));
    expect(await screen.findByText('Sarah Connor')).toBeInTheDocument();
  });

  it('makes no autofill or verification claims', () => {
    renderPack();
    for (const claim of [/Ready for autofill/i, /Autofill verified/i, /Verified Contact Block/i, /1-click/i, /Chrome Extension/i, /verified/i]) {
      expect(screen.queryByText(claim)).not.toBeInTheDocument();
    }
    expect(screen.getByText(/Contact details/i)).toBeInTheDocument();
    expect(screen.getByText('Sarah Connor')).toBeInTheDocument();
    expect(screen.getByText('Los Angeles, CA')).toBeInTheDocument();
  });

  it('says how to fill the contact details when the résumé has none', () => {
    renderPack({ ...samplePack, contactBlock: {} });
    expect(screen.getByText(/None yet. Add your résumé in Settings/i)).toBeInTheDocument();
  });

  it('labels saved, to-review and unanswered questions honestly', () => {
    renderPack();
    expect(screen.getByText(/2 need your answer/i)).toBeInTheDocument();
    // A saved answer is shown as the user's own.
    expect(screen.getAllByText('Saved answer').length).toBeGreaterThan(0);
    // A reused answer for an unknown country asks for review and says why.
    expect(screen.getAllByText(/Based on your saved answer for the United States/).length).toBeGreaterThan(0);
    // The blank salary question is not filled in.
    expect(screen.getAllByText('Not answered yet').length).toBe(1);
    expect(screen.getAllByText(/The posted salary range is not used/).length).toBeGreaterThan(0);
  });

  it('pre-fills a reused answer for confirmation and saves a new answer to memory', async () => {
    const user = userEvent.setup();
    vi.mocked(api.saveApplicationAnswer).mockResolvedValueOnce({
      id: 'ans-1',
      userId: 'u1',
      questionHash: 'hash-2',
      questionText: SALARY_Q,
      answer: '$175,000 USD base',
      createdAt: '2026-05-14T10:00:00Z',
      updatedAt: '2026-05-14T10:00:00Z',
    });
    renderPack();

    expect(screen.getByLabelText(REMOTE_AUTH_Q)).toHaveValue('Yes');
    const salaryInput = screen.getByLabelText(SALARY_Q);
    expect(salaryInput).toHaveValue('');
    await user.type(salaryInput, '$175,000 USD base');
    await user.click(screen.getAllByRole('button', { name: /Save answer/i })[1]!);

    await waitFor(() =>
      expect(api.saveApplicationAnswer).toHaveBeenCalledWith({ questionText: SALARY_Q, answer: '$175,000 USD base' }),
    );
    await waitFor(() => expect(screen.getByText(/1 needs your answer/i)).toBeInTheDocument());
  });
});
