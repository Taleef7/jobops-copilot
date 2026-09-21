import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StructuredResume } from '@/types/job';

const { saveBaseResume, parseResumeToStructured } = vi.hoisted(() => ({
  saveBaseResume: vi.fn(),
  parseResumeToStructured: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock('@/lib/api', () => ({
  saveBaseResume,
  parseResumeToStructured,
}));

import { toast } from 'sonner';
import { BaseResumeEditor } from './base-resume-editor';

afterEach(() => {
  vi.clearAllMocks();
});

const sampleResume: StructuredResume = {
  basics: {
    name: 'Jane Doe',
    email: 'jane@example.com',
    phone: '+1-555-0100',
    summary: 'Experienced Software Engineer',
  },
  work: [
    {
      company: 'Acme Corp',
      position: 'Staff Engineer',
      startDate: '2021-01-01',
      highlights: ['Architected distributed engine', 'Mentored 6 engineers'],
    },
  ],
  education: [
    {
      institution: 'Stanford',
      area: 'Computer Science',
      studyType: 'BS',
    },
  ],
  skills: [
    {
      category: 'Languages',
      skills: ['TypeScript', 'Python'],
    },
  ],
  projects: [],
  certificates: [],
};

describe('BaseResumeEditor', () => {
  it('renders initial resume data correctly', () => {
    render(<BaseResumeEditor initial={sampleResume} hasStoredResume={true} />);

    expect(screen.getByDisplayValue('Jane Doe')).toBeInTheDocument();
    expect(screen.getByDisplayValue('jane@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Acme Corp')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Staff Engineer')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Stanford')).toBeInTheDocument();
    expect(screen.getByDisplayValue('TypeScript, Python')).toBeInTheDocument();
  });

  it('shows import prompt when no base resume exists but stored resume is available', () => {
    render(<BaseResumeEditor initial={null} hasStoredResume={true} />);

    expect(screen.getByText(/import from your uploaded resume/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import/i })).toBeInTheDocument();
  });

  it('imports and populates structured resume from stored text', async () => {
    parseResumeToStructured.mockResolvedValueOnce(sampleResume);
    const user = userEvent.setup();

    render(<BaseResumeEditor initial={null} hasStoredResume={true} />);

    await user.click(screen.getByRole('button', { name: /import/i }));

    expect(parseResumeToStructured).toHaveBeenCalledOnce();
    expect(await screen.findByDisplayValue('Jane Doe')).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('parsed'));
  });

  it('allows adding and removing work experience entries', async () => {
    const user = userEvent.setup();
    render(<BaseResumeEditor initial={sampleResume} hasStoredResume={false} />);

    expect(screen.getAllByPlaceholderText('Acme Corp')).toHaveLength(1);

    // Click Add work experience
    const addButtons = screen.getAllByRole('button', { name: /add/i });
    // Work section Add is first
    await user.click(addButtons[0]!);

    expect(screen.getAllByPlaceholderText('Acme Corp')).toHaveLength(2);

    // Remove the first one
    const removeButtons = screen.getAllByLabelText('Remove work experience');
    await user.click(removeButtons[0]!);

    expect(screen.getAllByPlaceholderText('Acme Corp')).toHaveLength(1);
  });

  it('saves base resume and displays success toast', async () => {
    saveBaseResume.mockResolvedValueOnce(sampleResume);
    const user = userEvent.setup();

    render(<BaseResumeEditor initial={sampleResume} hasStoredResume={false} />);

    const saveButton = screen.getByRole('button', { name: /save base resume/i });
    expect(saveButton).toBeEnabled();

    await user.click(saveButton);

    expect(saveBaseResume).toHaveBeenCalledWith(
      expect.objectContaining({
        basics: expect.objectContaining({ name: 'Jane Doe' }),
      }),
    );
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('saved'));
  });

  it('disables save button when name is blank', async () => {
    const user = userEvent.setup();
    render(<BaseResumeEditor initial={sampleResume} hasStoredResume={false} />);

    const nameInput = screen.getByDisplayValue('Jane Doe');
    await user.clear(nameInput);

    const saveButton = screen.getByRole('button', { name: /save base resume/i });
    expect(saveButton).toBeDisabled();
  });
});
