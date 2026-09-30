import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StructuredResume } from '@/types/job';

const { saveBaseResume, uploadResumeFile, parseResume, fetchResumeText, saveResumeText, toastFn } = vi.hoisted(() => {
  const toastFn = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() });
  return {
    saveBaseResume: vi.fn(async (resume: unknown) => resume),
    uploadResumeFile: vi.fn(),
    parseResume: vi.fn(),
    fetchResumeText: vi.fn(),
    saveResumeText: vi.fn(async () => null),
    toastFn,
  };
});
vi.mock('sonner', () => ({ toast: toastFn }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api', () => ({
  saveBaseResume,
  uploadResumeFile,
  parseResume,
  fetchResumeText,
  saveResumeText,
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));

import { ResumePanel } from './resume-panel';

afterEach(() => vi.clearAllMocks());

const resume: StructuredResume = {
  basics: { name: 'Jane Candidate', email: 'jane@example.com', summary: 'Backend developer.' },
  work: [
    {
      company: 'Medical Informatics Engineering',
      position: 'Software Developer',
      startDate: '2026-05-01',
      highlights: ['Encoded 9 regulatory measures as documented business rules'],
    },
    { company: 'Riccle', position: 'Product Associate', startDate: '2025-09-01', endDate: '2026-05-01', highlights: [] },
  ],
  education: [{ institution: 'Purdue University', studyType: 'M.S.', area: 'Computer Science', endDate: '2026-05' }],
  skills: [{ category: 'Languages', skills: ['Python', 'TypeScript'] }],
  projects: [],
  certificates: [],
};

const section = (name: string) => screen.getByRole('region', { name });

describe('ResumePanel (#350)', () => {
  it('reads like a résumé, with dates as month and year', () => {
    render(<ResumePanel initial={resume} updatedAt="2026-09-30T12:00:00.000Z" resumeFileName="cv.pdf" hasStoredText />);

    const experience = section('Experience');
    expect(within(experience).getByText('Software Developer')).toBeInTheDocument();
    expect(within(experience).getByText('Medical Informatics Engineering · May 2026 – Present')).toBeInTheDocument();
    expect(within(experience).getByText('Riccle · Sep 2025 – May 2026')).toBeInTheDocument();
    expect(screen.getByText(/Last updated/)).toBeInTheDocument();
  });

  it('shows "Not set" for an empty résumé, never an example value', async () => {
    const user = userEvent.setup();
    const { container } = render(<ResumePanel initial={null} updatedAt={null} resumeFileName={null} hasStoredText={false} />);

    for (const name of ['Basics', 'Experience', 'Education', 'Skills', 'Projects', 'Certificates']) {
      expect(within(section(name)).getByText('Not set')).toBeInTheDocument();
    }
    await user.click(within(section('Experience')).getByRole('button', { name: /edit/i }));
    await user.click(within(section('Experience')).getByRole('button', { name: /add a role/i }));
    const allowed = new Set(['e.g. 2024-06', 'Leave empty if current']);
    for (const field of container.querySelectorAll('input[placeholder], textarea[placeholder]')) {
      expect(allowed).toContain(field.getAttribute('placeholder'));
    }
    expect(container.textContent).not.toMatch(/San Francisco|Jane Doe|Acme|Senior Software Engineer|2016-05-15|Reduced latency/);
  });

  it('saves one section from its own Save button and changes nothing else', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    const experience = section('Experience');
    await user.click(within(experience).getByRole('button', { name: /edit/i }));
    const title = within(experience).getByLabelText('Title', { selector: '#resume-work-1-position' });
    await user.clear(title);
    await user.type(title, 'Operations Analyst');
    await user.click(within(experience).getByRole('button', { name: /^save$/i }));

    expect(saveBaseResume).toHaveBeenCalledOnce();
    const saved = saveBaseResume.mock.calls[0]![0] as StructuredResume;
    expect(saved.work[1]!.position).toBe('Operations Analyst');
    expect(saved.work[0]).toEqual(resume.work[0]);
    expect({ ...saved, work: resume.work }).toEqual(resume);
  });

  it('asks before leaving a section with unsaved changes, and keeps them on "Keep editing"', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.click(within(section('Experience')).getByRole('button', { name: /edit/i }));
    const company = screen.getByLabelText('Company', { selector: '#resume-work-1-company' });
    await user.type(company, ' Inc');
    await user.click(within(section('Skills')).getByRole('button', { name: /edit/i }));

    expect(screen.getByText(/discard your changes to experience/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(screen.getByLabelText('Company', { selector: '#resume-work-1-company' })).toHaveValue('Riccle Inc');
  });

  it('asks before replacing from file while a section has unsaved changes', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.click(within(section('Basics')).getByRole('button', { name: /edit/i }));
    await user.type(screen.getByLabelText('Name', { selector: '#resume-basics-name' }), ' Q.');
    await user.click(screen.getByRole('button', { name: /replace from file/i }));

    expect(screen.getByText(/discard your changes to basics/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(uploadResumeFile).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name', { selector: '#resume-basics-name' })).toHaveValue('Jane Candidate Q.');
  });

  it('deletes a role with an Undo that brings it back', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    const experience = section('Experience');
    await user.click(within(experience).getByRole('button', { name: /edit/i }));
    await user.click(within(experience).getByRole('button', { name: /remove riccle/i }));
    expect(screen.queryByDisplayValue('Riccle')).not.toBeInTheDocument();

    const [message, options] = toastFn.mock.calls.at(-1)! as [string, { duration: number; action: { label: string; onClick: () => void } }];
    expect(message).toMatch(/removed/i);
    expect(options.duration).toBe(5000);
    expect(options.action.label).toBe('Undo');
    await user.click(document.body);
    options.action.onClick();
    expect(await screen.findByDisplayValue('Riccle')).toBeInTheDocument();
  });

  it('replaces from file through the confirmation, and saves only on "Looks right"', async () => {
    uploadResumeFile.mockResolvedValue({ profile: null, resumeText: 'NEW TEXT', resumeFileName: 'new.pdf' });
    parseResume.mockResolvedValue({ structuredResume: { ...resume, work: [resume.work[0]!] }, flags: [] });
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.upload(screen.getByLabelText('Résumé PDF'), new File(['%PDF'], 'new.pdf', { type: 'application/pdf' }));

    expect(await screen.findByText('Check what we read')).toBeInTheDocument();
    expect(parseResume).toHaveBeenCalledWith('NEW TEXT');
    // The file is only read: nothing is stored until "Looks right".
    expect(uploadResumeFile).toHaveBeenCalledWith(expect.any(File), { preview: true });
    expect(saveResumeText).not.toHaveBeenCalled();
    expect(saveBaseResume).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /looks right/i }));
    expect(saveResumeText).toHaveBeenCalledWith('NEW TEXT', 'new.pdf');
    expect(saveBaseResume).toHaveBeenCalledWith({ ...resume, work: [resume.work[0]] });
    expect(screen.getByText('new.pdf')).toBeInTheDocument();
  });

  it('cancelling a replacement stores nothing, and the old file stays', async () => {
    uploadResumeFile.mockResolvedValue({ profile: null, resumeText: 'NEW TEXT', resumeFileName: 'new.pdf' });
    parseResume.mockResolvedValue({ structuredResume: resume, flags: [] });
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.upload(screen.getByLabelText('Résumé PDF'), new File(['%PDF'], 'new.pdf', { type: 'application/pdf' }));
    await user.click(await screen.findByRole('button', { name: /cancel/i }));

    expect(saveResumeText).not.toHaveBeenCalled();
    expect(saveBaseResume).not.toHaveBeenCalled();
    expect(screen.getByText('cv.pdf')).toBeInTheDocument();
  });

  it('closes an open, unchanged section when an import starts', async () => {
    uploadResumeFile.mockResolvedValue({ profile: null, resumeText: 'NEW TEXT', resumeFileName: 'new.pdf' });
    parseResume.mockResolvedValue({ structuredResume: resume, flags: [] });
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.click(within(section('Experience')).getByRole('button', { name: /edit/i }));
    await user.click(screen.getByRole('button', { name: /replace from file/i }));
    await user.upload(screen.getByLabelText('Résumé PDF'), new File(['%PDF'], 'new.pdf', { type: 'application/pdf' }));
    await screen.findByText('Check what we read');

    expect(screen.queryByLabelText('Company', { selector: '#resume-work-0-company' })).not.toBeInTheDocument();
  });

  it('shows what was read from the PDF', async () => {
    fetchResumeText.mockResolvedValue({ resumeText: 'Encoded 9 regulatory measures', resumeFileName: 'cv.pdf', updatedAt: null });
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.click(screen.getByText(/what we read from your pdf/i));
    expect(await screen.findByText('Encoded 9 regulatory measures')).toBeInTheDocument();
  });
});

describe('ResumePanel review fixes (#350)', () => {
  const nameless: StructuredResume = { ...resume, basics: { name: '', email: '', summary: '' } };

  it('won\'t save a section while the résumé has no name, and says where to add it', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={nameless} updatedAt={null} resumeFileName={null} hasStoredText={false} />);

    const experience = section('Experience');
    await user.click(within(experience).getByRole('button', { name: /edit/i }));
    await user.type(screen.getByLabelText('Title', { selector: '#resume-work-1-position' }), ' II');
    await user.click(within(experience).getByRole('button', { name: /^save$/i }));

    expect(saveBaseResume).not.toHaveBeenCalled();
    expect(within(experience).getByRole('alert')).toHaveTextContent(/add your name in basics first/i);
  });

  it('won\'t save Basics with a blank name', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName={null} hasStoredText={false} />);

    await user.click(within(section('Basics')).getByRole('button', { name: /edit/i }));
    await user.clear(screen.getByLabelText('Name', { selector: '#resume-basics-name' }));
    expect(within(section('Basics')).getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('shows the load failure instead of an empty résumé, with no way to overwrite it', () => {
    render(<ResumePanel initial={null} updatedAt={null} resumeFileName="cv.pdf" hasStoredText loadError="API unreachable" />);

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your résumé");
    expect(screen.queryByRole('button', { name: /^edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /replace from file/i })).not.toBeInTheDocument();
  });

  it('closes an open section when an import is saved, so it can\'t undo the import', async () => {
    uploadResumeFile.mockResolvedValue({ profile: null, resumeText: 'NEW' });
    parseResume.mockResolvedValue({ structuredResume: { ...resume, work: [resume.work[0]!] }, flags: [] });
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.click(within(section('Experience')).getByRole('button', { name: /edit/i }));
    await user.upload(screen.getByLabelText('Résumé PDF'), new File(['%PDF'], 'new.pdf', { type: 'application/pdf' }));
    await user.click(await screen.findByRole('button', { name: /looks right/i }));

    expect(within(section('Experience')).queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(within(section('Experience')).queryByText('Riccle · Sep 2025 – May 2026')).not.toBeInTheDocument();
  });

  it('ends a "current" role when an end date is typed', async () => {
    const current: StructuredResume = { ...resume, work: [{ ...resume.work[0]!, current: true }] };
    const user = userEvent.setup();
    render(<ResumePanel initial={current} updatedAt={null} resumeFileName={null} hasStoredText={false} />);

    await user.click(within(section('Experience')).getByRole('button', { name: /edit/i }));
    await user.type(screen.getByLabelText('End', { selector: '#resume-work-0-end' }), '2026-08');
    await user.click(within(section('Experience')).getByRole('button', { name: /^save$/i }));

    const saved = saveBaseResume.mock.calls[0]![0] as StructuredResume;
    expect(saved.work[0]!.current).toBe(false);
    expect(await screen.findByText('Medical Informatics Engineering · May 2026 – Aug 2026')).toBeInTheDocument();
  });

  it('drops a blank added role on save, and a blank one alone is not a change', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName={null} hasStoredText={false} />);

    const experience = section('Experience');
    await user.click(within(experience).getByRole('button', { name: /edit/i }));
    await user.click(within(experience).getByRole('button', { name: /add a role/i }));
    expect(within(experience).getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('moves focus to the discard question, so it can\'t go unnoticed', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.click(within(section('Experience')).getByRole('button', { name: /edit/i }));
    await user.type(screen.getByLabelText('Company', { selector: '#resume-work-1-company' }), ' Inc');
    await user.click(within(section('Skills')).getByRole('button', { name: /edit/i }));

    expect(screen.getByRole('button', { name: /keep editing/i })).toHaveFocus();
  });

  it('dismisses a pending Undo when the section closes', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    const experience = section('Experience');
    await user.click(within(experience).getByRole('button', { name: /edit/i }));
    toastFn.mockReturnValueOnce('toast-1');
    await user.click(within(experience).getByRole('button', { name: /remove riccle/i }));
    await user.click(within(experience).getByRole('button', { name: /cancel/i }));

    expect(toastFn.dismiss).toHaveBeenCalledWith('toast-1');
  });
});

describe('ResumePanel Codex fixes (#350)', () => {
  it('holds section editing while an import waits for confirmation', async () => {
    uploadResumeFile.mockResolvedValue({ profile: null, resumeText: 'NEW' });
    parseResume.mockResolvedValue({ structuredResume: resume, flags: [] });
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.upload(screen.getByLabelText('Résumé PDF'), new File(['%PDF'], 'new.pdf', { type: 'application/pdf' }));
    await screen.findByText('Check what we read');
    expect(within(section('Experience')).getByRole('button', { name: /edit/i })).toBeDisabled();
  });

  it('shows a certificate date as a date, not a range', () => {
    render(
      <ResumePanel
        initial={{ ...resume, certificates: [{ name: 'AZ-900', issuer: 'Microsoft', date: '2024-09' }] }}
        updatedAt={null}
        resumeFileName={null}
        hasStoredText={false}
      />,
    );
    expect(within(section('Certificates')).getByText(/Microsoft · Sep 2024$/)).toBeInTheDocument();
  });
});
