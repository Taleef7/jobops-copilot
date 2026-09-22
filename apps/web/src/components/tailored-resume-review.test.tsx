import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResumeVersionRecord } from '@/types/job';

const {
  tailorResumeForJob,
  approveResumeVersion,
  rejectResumeVersion,
  downloadResumeVersion,
} = vi.hoisted(() => ({
  tailorResumeForJob: vi.fn(),
  approveResumeVersion: vi.fn(),
  rejectResumeVersion: vi.fn(),
  downloadResumeVersion: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  tailorResumeForJob,
  approveResumeVersion,
  rejectResumeVersion,
  downloadResumeVersion,
}));

import { TailoredResumeReview } from './tailored-resume-review';

afterEach(() => {
  vi.clearAllMocks();
});

const sampleVersion: ResumeVersionRecord = {
  id: 'ver-123',
  userId: 'user-1',
  jobId: 'job-1',
  versionNumber: 1,
  groundednessScore: 0.95,
  approved: false,
  isBase: false,
  changeSummary: 'Emphasized React, TypeScript, and distributed systems for Staff Frontend role.',
  changeDetails: [
    {
      section: 'basics.summary',
      oldText: 'General software engineer with experience building web apps.',
      newText: 'Senior engineer specializing in high-scale React architectures and TypeScript design systems.',
      rationale: 'Directly aligns professional identity with Staff Frontend requirements.',
    },
    {
      section: 'work[0].highlights',
      oldText: 'Worked on frontend performance.',
      newText: 'Led frontend performance overhaul improving Core Web Vitals LCP by 42%.',
      rationale: 'Elevates verified performance metrics relevant to job description.',
    },
  ],
  structuredResume: {
    basics: {
      name: 'Alex Smith',
      label: 'Staff Software Engineer',
      email: 'alex@example.com',
      phone: '+1-555-0199',
      summary: 'Senior engineer specializing in high-scale React architectures.',
      location: { city: 'San Francisco', region: 'CA' },
    },
    work: [
      {
        company: 'Stripe',
        position: 'Senior Engineer',
        startDate: '2021-03',
        highlights: ['Led frontend performance overhaul improving Core Web Vitals LCP by 42%.'],
      },
    ],
    education: [
      {
        institution: 'UC Berkeley',
        area: 'Computer Science',
        studyType: 'B.S.',
        startDate: '2015',
        endDate: '2019',
      },
    ],
    skills: [
      {
        category: 'Core',
        skills: ['TypeScript', 'React', 'Next.js'],
      },
    ],
  },
  createdAt: '2026-09-21T12:00:00.000Z',
  updatedAt: '2026-09-21T12:00:00.000Z',
};

describe('TailoredResumeReview', () => {
  it('renders empty state when no versions exist and allows triggering tailor', async () => {
    const user = userEvent.setup();
    tailorResumeForJob.mockResolvedValueOnce(sampleVersion);

    render(
      <TailoredResumeReview
        jobId="job-1"
        jobTitle="Staff Frontend Engineer"
        jobCompany="Acme Corp"
        initialVersions={[]}
      />,
    );

    expect(screen.getByText('Tailored Resume Studio')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /tailor resume for acme corp/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /tailor resume for acme corp/i }));

    expect(tailorResumeForJob).toHaveBeenCalledWith('job-1');
    await waitFor(() => {
      expect(screen.getByText('Tailored Resume')).toBeInTheDocument();
      expect(screen.getByText('Draft · Pending Review')).toBeInTheDocument();
    });
  });

  it('renders error banner with link to settings if base resume is missing', async () => {
    const user = userEvent.setup();
    tailorResumeForJob.mockRejectedValueOnce(
      new Error('No structured base resume configured. Please set up your base resume in Settings first.'),
    );

    render(
      <TailoredResumeReview
        jobId="job-1"
        jobTitle="Staff Frontend Engineer"
        jobCompany="Acme Corp"
        initialVersions={[]}
      />,
    );

    await user.click(screen.getByRole('button', { name: /tailor resume for acme corp/i }));

    await waitFor(() => {
      expect(screen.getByText(/no structured base resume configured/i)).toBeInTheDocument();
      expect(screen.getByText(/open settings to set up your base resume/i)).toBeInTheDocument();
    });
  });

  it('renders change summary, why rationale, and diff for an existing draft version', () => {
    render(
      <TailoredResumeReview
        jobId="job-1"
        jobTitle="Staff Frontend Engineer"
        jobCompany="Acme Corp"
        initialVersions={[sampleVersion]}
      />,
    );

    expect(screen.getByText('Tailored Resume')).toBeInTheDocument();
    expect(screen.getByText('Draft · Pending Review')).toBeInTheDocument();
    expect(screen.getByText(/Groundedness: 95%/i)).toBeInTheDocument();

    // Change summary
    expect(
      screen.getByText('Emphasized React, TypeScript, and distributed systems for Staff Frontend role.'),
    ).toBeInTheDocument();

    // Rationale ("Why")
    expect(
      screen.getByText(/directly aligns professional identity with staff frontend requirements/i),
    ).toBeInTheDocument();

    // Diff sections
    expect(screen.getByText('basics.summary')).toBeInTheDocument();
    expect(
      screen.getByText('General software engineer with experience building web apps.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Senior engineer specializing in high-scale React architectures and TypeScript design systems.',
      ),
    ).toBeInTheDocument();

    // Download button is gated (disabled) when unapproved
    const downloadBtn = screen.getByRole('button', { name: /download pdf locked until approved/i });
    expect(downloadBtn).toBeDisabled();
  });

  it('approves draft version and unlocks ATS PDF download', async () => {
    const user = userEvent.setup();
    approveResumeVersion.mockResolvedValueOnce({
      version: { ...sampleVersion, approved: true },
      fileUrl: '/storage/ver-123.pdf',
      approved: true,
    });

    render(
      <TailoredResumeReview
        jobId="job-1"
        jobTitle="Staff Frontend Engineer"
        jobCompany="Acme Corp"
        initialVersions={[sampleVersion]}
      />,
    );

    const approveBtn = screen.getByRole('button', { name: /approve resume/i });
    await user.click(approveBtn);

    expect(approveResumeVersion).toHaveBeenCalledWith('ver-123');

    await waitFor(() => {
      expect(screen.getByText('Approved & Ready')).toBeInTheDocument();
    });

    // Download button is now unlocked and enabled
    const downloadBtn = screen.getByRole('button', { name: /download ats pdf/i });
    expect(downloadBtn).not.toBeDisabled();

    // Clicking download triggers downloadResumeVersion
    await user.click(downloadBtn);
    expect(downloadResumeVersion).toHaveBeenCalledWith(
      'ver-123',
      expect.stringContaining('Alex_Smith_Acme_Corp_Tailored.pdf'),
    );
  });

  it('allows rejecting with feedback', async () => {
    const user = userEvent.setup();
    rejectResumeVersion.mockResolvedValueOnce({
      version: {
        ...sampleVersion,
        approved: false,
        changeSummary: `${sampleVersion.changeSummary} [Rejected with feedback: Please emphasize Node.js more]`,
      },
      approved: false,
      feedback: 'Please emphasize Node.js more',
    });

    render(
      <TailoredResumeReview
        jobId="job-1"
        jobTitle="Staff Frontend Engineer"
        jobCompany="Acme Corp"
        initialVersions={[sampleVersion]}
      />,
    );

    // Click Reject button to toggle form
    const rejectBtn = screen.getByRole('button', { name: /^reject$/i });
    await user.click(rejectBtn);

    expect(screen.getByText('Provide Rejection Feedback')).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/tone down the summary/i);
    await user.type(textarea, 'Please emphasize Node.js more');

    const submitBtn = screen.getByRole('button', { name: /submit rejection/i });
    await user.click(submitBtn);

    expect(rejectResumeVersion).toHaveBeenCalledWith('ver-123', 'Please emphasize Node.js more');

    await waitFor(() => {
      expect(screen.queryByText('Provide Rejection Feedback')).not.toBeInTheDocument();
    });
  });

  it('toggles full document preview', async () => {
    render(
      <TailoredResumeReview
        jobId="job-1"
        jobTitle="Staff Frontend Engineer"
        jobCompany="Acme Corp"
        initialVersions={[sampleVersion]}
      />,
    );

    const toggleBtn = screen.getByRole('button', {
      name: /full tailored resume document preview/i,
    });

    expect(screen.queryByText('Professional Experience')).not.toBeInTheDocument();

    fireEvent.click(toggleBtn);

    expect(screen.getByText('Professional Experience')).toBeInTheDocument();
    expect(screen.getAllByText(/Led frontend performance overhaul/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('UC Berkeley')).toBeInTheDocument();
    expect(screen.getByText('TypeScript')).toBeInTheDocument();
  });
});
