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
      questionText: 'Are you legally authorized to work in the United States?',
      questionHash: 'hash-1',
      answer: 'Yes, US Citizen.',
      category: 'work_authorization',
      source: 'preferences',
      flagged: false,
    },
    {
      questionText: 'What are your salary expectations for this role?',
      questionHash: 'hash-2',
      answer: 'Competitive with market rate.',
      category: 'salary',
      source: 'generated',
      flagged: true,
    },
  ],
  flaggedQuestions: ['What are your salary expectations for this role?'],
  generatedAt: '2026-05-14T10:00:00Z',
};

describe('ApplicationPackView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when initialPack is null', () => {
    render(
      <ApplicationPackView
        jobId="job-test-1"
        company="Linear"
        initialPack={null}
        hasResume={true}
      />,
    );

    expect(screen.getByText(/Assemble your Application Pack/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Application Pack/i })).toBeInTheDocument();
  });

  it('generates application pack when button clicked in empty state', async () => {
    const user = userEvent.setup();
    vi.mocked(api.generateJobApplicationPack).mockResolvedValueOnce(samplePack);

    render(
      <ApplicationPackView
        jobId="job-test-1"
        company="Linear"
        initialPack={null}
        hasResume={true}
      />,
    );

    const generateBtn = screen.getByRole('button', { name: /Generate Application Pack/i });
    await user.click(generateBtn);

    await waitFor(() => {
      expect(api.generateJobApplicationPack).toHaveBeenCalledWith('job-test-1');
    });

    expect(await screen.findByText('Ready for autofill')).toBeInTheDocument();
    expect(screen.getByText('Sarah Connor')).toBeInTheDocument();
  });

  it('renders populated contact block and answers when pack is provided', () => {
    render(
      <ApplicationPackView
        jobId="job-test-1"
        company="Linear"
        initialPack={samplePack}
        hasResume={true}
      />,
    );

    expect(screen.getByText('Ready for autofill')).toBeInTheDocument();
    expect(screen.getByText('Sarah Connor')).toBeInTheDocument();
    expect(screen.getByText('sarah@example.com')).toBeInTheDocument();
    expect(screen.getByText('555-0100')).toBeInTheDocument();
    expect(screen.getByText('Los Angeles, CA')).toBeInTheDocument();
    expect(screen.getByText('Are you legally authorized to work in the United States?')).toBeInTheDocument();
    expect(screen.getByText('Yes, US Citizen.')).toBeInTheDocument();
  });

  it('allows answering a flagged question and saving to Q&A memory', async () => {
    const user = userEvent.setup();
    vi.mocked(api.saveApplicationAnswer).mockResolvedValueOnce({
      id: 'ans-1',
      userId: 'u1',
      questionHash: 'hash-2',
      questionText: 'What are your salary expectations for this role?',
      answer: '$175,000 USD base',
      createdAt: '2026-05-14T10:00:00Z',
      updatedAt: '2026-05-14T10:00:00Z',
    });

    render(
      <ApplicationPackView
        jobId="job-test-1"
        company="Linear"
        initialPack={samplePack}
        hasResume={true}
      />,
    );

    expect(screen.getByText(/1 flagged for review/i)).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/e.g. \$165,000 USD base/i);
    await user.type(input, '$175,000 USD base');

    const saveBtn = screen.getByRole('button', { name: /Save to Q&A memory/i });
    await user.click(saveBtn);

    await waitFor(() => {
      expect(api.saveApplicationAnswer).toHaveBeenCalledWith({
        questionText: 'What are your salary expectations for this role?',
        answer: '$175,000 USD base',
      });
    });

    // The answer should update in local state and flagged banner disappear
    await waitFor(() => {
      expect(screen.queryByText(/1 flagged for review/i)).not.toBeInTheDocument();
    });
  });
});
