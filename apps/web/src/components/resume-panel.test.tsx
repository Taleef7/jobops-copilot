import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateInBrowser, renderOnServer } from '@/test/time-zones';
import type { ResumeLayout, StructuredResume } from '@/types/job';

const { saveBaseResume, saveResumeLayout, uploadResumeFile, parseResume, fetchResumeText, saveResumeText, toastFn } = vi.hoisted(() => {
  const toastFn = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), dismiss: vi.fn() });
  return {
    saveBaseResume: vi.fn(async (resume: unknown) => resume),
    saveResumeLayout: vi.fn(async (layout: unknown) => layout),
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
  saveResumeLayout,
  fetchBaseResumePdf: vi.fn(),
  downloadBaseResumePdf: vi.fn(),
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
    // The file's text and the résumé read from it are saved together, in one request.
    expect(saveBaseResume).toHaveBeenCalledOnce();
    expect(saveBaseResume).toHaveBeenCalledWith({ ...resume, work: [resume.work[0]] }, { text: 'NEW TEXT', fileName: 'new.pdf' });
    expect(saveResumeText).not.toHaveBeenCalled();
    expect(await screen.findByText('new.pdf')).toBeInTheDocument();
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

  // The server's time zone (UTC on Azure) can put a save on a different day than the browser
  // does: live, the server rendered "Oct 3" and the browser "Oct 2", a hydration error.
  it('leaves the "Last updated" date to the browser', async () => {
    const panel = <ResumePanel initial={resume} updatedAt="2026-10-03T00:54:15.096Z" resumeFileName="cv.pdf" hasStoredText />;
    const html = renderOnServer(panel);
    expect(html).not.toContain('Oct 3, 2026');

    const { container, hydrationErrors } = await hydrateInBrowser(html, panel);
    expect(hydrationErrors).not.toHaveBeenCalled();
    expect(within(container).getByText(/^Last updated/)).toHaveTextContent('Last updated Oct 2, 2026');
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

  it('keeps the old file when a replacement fails to save', async () => {
    uploadResumeFile.mockResolvedValue({ profile: null, resumeText: 'NEW TEXT', resumeFileName: 'new.pdf' });
    parseResume.mockResolvedValue({ structuredResume: resume, flags: [] });
    saveBaseResume.mockRejectedValueOnce(new Error('The API took too long to answer.'));
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.upload(screen.getByLabelText('Résumé PDF'), new File(['%PDF'], 'new.pdf', { type: 'application/pdf' }));
    await user.click(await screen.findByRole('button', { name: /looks right/i }));
    expect(await screen.findByText('The API took too long to answer.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(saveResumeText).not.toHaveBeenCalled();
    expect(screen.getByText('cv.pdf')).toBeInTheDocument();
    expect(screen.queryByText('new.pdf')).not.toBeInTheDocument();
  });

  it('freezes the section while it saves, so nothing done meanwhile is lost', async () => {
    let finish!: (value: StructuredResume) => void;
    saveBaseResume.mockImplementationOnce(() => new Promise<StructuredResume>((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    const experience = section('Experience');
    await user.click(within(experience).getByRole('button', { name: /edit/i }));
    toastFn.mockReturnValueOnce('toast-1');
    await user.click(within(experience).getByRole('button', { name: /remove riccle/i }));
    const [, options] = toastFn.mock.calls.at(-1)! as [string, { action: { onClick: (event: { preventDefault: () => void }) => void } }];
    await user.click(within(experience).getByRole('button', { name: /^save$/i }));

    expect(screen.getByLabelText('Company', { selector: '#resume-work-0-company' })).toBeDisabled();
    expect(within(experience).getByRole('button', { name: /add a role/i })).toBeDisabled();
    expect(within(experience).getByRole('button', { name: /remove medical/i })).toBeDisabled();
    expect(within(section('Skills')).getByRole('button', { name: /edit/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /replace from file/i })).toBeDisabled();
    // Undo waits too: a click now changes nothing, and its toast stays for after the save.
    const click = { preventDefault: vi.fn() };
    act(() => options.action.onClick(click));
    expect(click.preventDefault).toHaveBeenCalled();
    expect(screen.queryByDisplayValue('Riccle')).not.toBeInTheDocument();

    await act(async () => finish({ ...resume, work: [resume.work[0]!] }));
    expect(within(experience).queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument();
    expect(within(experience).queryByText(/Riccle/)).not.toBeInTheDocument();
    expect(toastFn.dismiss).toHaveBeenCalledWith('toast-1');
  });

  it('keeps Undo working when a save fails', async () => {
    saveBaseResume.mockRejectedValueOnce(new Error("The API couldn't be reached."));
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    const experience = section('Experience');
    await user.click(within(experience).getByRole('button', { name: /edit/i }));
    toastFn.mockReturnValueOnce('toast-1');
    await user.click(within(experience).getByRole('button', { name: /remove riccle/i }));
    const [, options] = toastFn.mock.calls.at(-1)! as [string, { action: { onClick: (event: { preventDefault: () => void }) => void } }];
    await user.click(within(experience).getByRole('button', { name: /^save$/i }));

    expect(await within(experience).findByRole('alert')).toHaveTextContent("The API couldn't be reached.");
    expect(toastFn.dismiss).not.toHaveBeenCalledWith('toast-1');
    act(() => options.action.onClick({ preventDefault: vi.fn() }));
    expect(await screen.findByDisplayValue('Riccle')).toBeInTheDocument();
  });

  it('holds a failed import\'s "Try again" while a section saves', async () => {
    uploadResumeFile.mockResolvedValue({ profile: null, resumeText: 'NEW TEXT', resumeFileName: 'new.pdf' });
    parseResume.mockRejectedValueOnce(new Error('The AI is unavailable.'));
    saveBaseResume.mockImplementationOnce(() => new Promise<StructuredResume>(() => {}));
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.upload(screen.getByLabelText('Résumé PDF'), new File(['%PDF'], 'new.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText('The AI is unavailable.')).toBeInTheDocument();
    const experience = section('Experience');
    await user.click(within(experience).getByRole('button', { name: /edit/i }));
    await user.type(screen.getByLabelText('Title', { selector: '#resume-work-1-position' }), ' II');
    await user.click(within(experience).getByRole('button', { name: /^save$/i }));

    // Either would read a file and close the section while its save is on its way.
    expect(screen.getByRole('button', { name: /try again/i })).toBeDisabled();
    expect(screen.getByLabelText('Résumé PDF')).toBeDisabled();
  });

  it('asks before a failed import\'s "Try again" drops unsaved changes', async () => {
    uploadResumeFile.mockResolvedValue({ profile: null, resumeText: 'NEW TEXT', resumeFileName: 'new.pdf' });
    parseResume
      .mockRejectedValueOnce(new Error('The AI is unavailable.'))
      .mockResolvedValueOnce({ structuredResume: resume, flags: [] });
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.upload(screen.getByLabelText('Résumé PDF'), new File(['%PDF'], 'new.pdf', { type: 'application/pdf' }));
    await screen.findByText('The AI is unavailable.');
    await user.click(within(section('Experience')).getByRole('button', { name: /edit/i }));
    await user.type(screen.getByLabelText('Company', { selector: '#resume-work-1-company' }), ' Inc');
    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.getByText(/trying again will discard your changes to experience/i)).toBeInTheDocument();
    expect(parseResume).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: /keep editing/i }));
    expect(screen.getByLabelText('Company', { selector: '#resume-work-1-company' })).toHaveValue('Riccle Inc');

    await user.click(screen.getByRole('button', { name: /try again/i }));
    await user.click(screen.getByRole('button', { name: /discard and try again/i }));
    expect(await screen.findByText('Check what we read')).toBeInTheDocument();
    expect(parseResume).toHaveBeenLastCalledWith('NEW TEXT');
  });

  it("keeps a saved replacement's text over a slow load of the old one", async () => {
    let answer!: (value: { resumeText: string; resumeFileName: string; updatedAt: null }) => void;
    fetchResumeText.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    uploadResumeFile.mockResolvedValue({ profile: null, resumeText: 'NEW TEXT', resumeFileName: 'new.pdf' });
    parseResume.mockResolvedValue({ structuredResume: resume, flags: [] });
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.click(screen.getByText(/what we read from your pdf/i));
    await waitFor(() => expect(fetchResumeText).toHaveBeenCalled());
    await user.upload(screen.getByLabelText('Résumé PDF'), new File(['%PDF'], 'new.pdf', { type: 'application/pdf' }));
    await user.click(await screen.findByRole('button', { name: /looks right/i }));
    expect(await screen.findByText('NEW TEXT')).toBeInTheDocument();

    await act(async () => answer({ resumeText: 'OLD TEXT', resumeFileName: 'cv.pdf', updatedAt: null }));
    expect(screen.getByText('NEW TEXT')).toBeInTheDocument();
    expect(screen.queryByText('OLD TEXT')).not.toBeInTheDocument();
  });

  it('shows the PDF text when a failed load is tried again', async () => {
    fetchResumeText
      .mockRejectedValueOnce(new Error("The API couldn't be reached."))
      .mockResolvedValueOnce({ resumeText: 'Encoded 9 regulatory measures', resumeFileName: 'cv.pdf', updatedAt: null });
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    const summary = screen.getByText(/what we read from your pdf/i);
    await user.click(summary);
    expect(await screen.findByText("The API couldn't be reached.")).toBeInTheDocument();
    await user.click(summary);
    await user.click(summary);

    expect(await screen.findByText('Encoded 9 regulatory measures')).toBeInTheDocument();
    expect(screen.queryByText("The API couldn't be reached.")).not.toBeInTheDocument();
  });

  it('shows a saved replacement\'s text, even after a failed load', async () => {
    fetchResumeText.mockRejectedValueOnce(new Error("The API couldn't be reached."));
    uploadResumeFile.mockResolvedValue({ profile: null, resumeText: 'NEW TEXT', resumeFileName: 'new.pdf' });
    parseResume.mockResolvedValue({ structuredResume: resume, flags: [] });
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    await user.click(screen.getByText(/what we read from your pdf/i));
    await screen.findByText("The API couldn't be reached.");
    await user.upload(screen.getByLabelText('Résumé PDF'), new File(['%PDF'], 'new.pdf', { type: 'application/pdf' }));
    await user.click(await screen.findByRole('button', { name: /looks right/i }));

    expect(await screen.findByText('NEW TEXT')).toBeInTheDocument();
    expect(screen.queryByText("The API couldn't be reached.")).not.toBeInTheDocument();
  });
});

// #415: everything the PDF prints can be edited here, and lists can be put in order with the
// keyboard (Move up / Move down), each move announced.
describe('ResumePanel editor (#415)', () => {
  const saved = () => saveBaseResume.mock.calls.at(-1)![0] as StructuredResume;

  it('edits the contact line: location, website and profile links', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    const basics = section('Basics');
    await user.click(within(basics).getByRole('button', { name: /edit/i }));
    await user.type(within(basics).getByLabelText('City'), 'Austin');
    await user.type(within(basics).getByLabelText('State or region'), 'TX');
    await user.type(within(basics).getByLabelText('Country'), 'US');
    await user.type(within(basics).getByLabelText('Website'), 'https://jane.dev');
    await user.click(within(basics).getByRole('button', { name: 'Add a link' }));
    await user.type(within(basics).getByLabelText('Site', { selector: '#resume-basics-profiles-0-network' }), 'GitHub');
    await user.type(within(basics).getByLabelText('URL', { selector: '#resume-basics-profiles-0-url' }), 'https://github.com/jane');
    await user.click(within(basics).getByRole('button', { name: /^save$/i }));

    expect(saved().basics).toEqual({
      ...resume.basics,
      location: { city: 'Austin', region: 'TX', countryCode: 'US' },
      url: 'https://jane.dev',
      profiles: [{ network: 'GitHub', url: 'https://github.com/jane' }],
    });
    expect(await within(basics).findByText(/Austin, TX, US/)).toBeInTheDocument();
    expect(within(basics).getByText(/github\.com\/jane/)).toBeInTheDocument();
  });

  it("edits a role's summary, and its bullets one at a time: add, move and remove", async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    const experience = section('Experience');
    await user.click(within(experience).getByRole('button', { name: /edit/i }));
    await user.type(within(experience).getByLabelText('Summary (optional)', { selector: '#resume-work-0-summary' }), 'Led the rules engine.');
    const bullets = within(experience).getAllByRole('group', { name: 'Bullets' })[0]!;
    await user.click(within(bullets).getByRole('button', { name: 'Add a bullet' }));
    await user.type(within(bullets).getByLabelText('Bullet 2'), 'Cut review time by 30%');
    within(bullets).getByRole('button', { name: 'Move bullet 2 up' }).focus();
    await user.keyboard('{Enter}');
    expect(within(bullets).getByLabelText('Bullet 1')).toHaveValue('Cut review time by 30%');
    expect(within(experience).getByText('Bullet moved to position 1 of 2')).toBeInTheDocument();
    expect(within(bullets).getByRole('button', { name: 'Move bullet 1 down' })).toHaveFocus();
    await user.click(within(bullets).getByRole('button', { name: 'Add a bullet' }));
    await user.type(within(bullets).getByLabelText('Bullet 3'), 'A line to remove');
    await user.click(within(bullets).getByRole('button', { name: 'Remove bullet 3' }));
    await user.click(within(experience).getByRole('button', { name: /^save$/i }));

    expect(saved().work[0]).toEqual({
      ...resume.work[0],
      summary: 'Led the rules engine.',
      highlights: ['Cut review time by 30%', 'Encoded 9 regulatory measures as documented business rules'],
    });
    expect(await within(experience).findByText('Led the rules engine.')).toBeInTheDocument();
  });

  it('splits a bullet pasted with line breaks into bullets', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);
    const experience = section('Experience');
    await user.click(within(experience).getByRole('button', { name: /edit/i }));
    const bullets = within(experience).getAllByRole('group', { name: 'Bullets' })[1]!;
    await user.click(within(bullets).getByRole('button', { name: 'Add a bullet' }));
    await user.click(within(bullets).getByLabelText('Bullet 1'));
    await user.paste('Ran the pilot\nWrote the playbook');
    await user.click(within(experience).getByRole('button', { name: /^save$/i }));
    expect(saved().work[1]!.highlights).toEqual(['Ran the pilot', 'Wrote the playbook']);
  });

  it('moves roles up and down with the keyboard, and says where they went', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    const experience = section('Experience');
    await user.click(within(experience).getByRole('button', { name: /edit/i }));
    within(experience).getByRole('button', { name: 'Move Riccle up' }).focus();
    await user.keyboard('{Enter}');
    expect(within(experience).getByText('Riccle moved to position 1 of 2')).toBeInTheDocument();
    expect(within(experience).getByRole('button', { name: 'Move Riccle up' })).toBeDisabled();
    expect(within(experience).getByRole('button', { name: 'Move Riccle down' })).toHaveFocus();
    expect(within(experience).getByLabelText('Company', { selector: '#resume-work-0-company' })).toHaveValue('Riccle');
    await user.click(within(experience).getByRole('button', { name: /^save$/i }));
    expect(saved().work.map((role) => role.company)).toEqual(['Riccle', 'Medical Informatics Engineering']);
  });

  it("edits a school's start, GPA and bullets", async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    const education = section('Education');
    await user.click(within(education).getByRole('button', { name: /edit/i }));
    await user.type(within(education).getByLabelText('Start'), '2024-08');
    await user.type(within(education).getByLabelText('GPA'), '3.9');
    await user.click(within(education).getByRole('button', { name: 'Add a bullet' }));
    await user.type(within(education).getByLabelText('Bullet 1'), 'Thesis on clinical rules');
    await user.click(within(education).getByRole('button', { name: /^save$/i }));

    expect(saved().education[0]).toEqual({ ...resume.education[0], startDate: '2024-08', gpa: '3.9', highlights: ['Thesis on clinical rules'] });
    expect(await within(education).findByText(/GPA 3\.9/)).toBeInTheDocument();
  });

  it('orders skill groups and the skills in them; skills typed with commas are split', async () => {
    const user = userEvent.setup();
    render(<ResumePanel initial={resume} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);

    const skills = section('Skills');
    await user.click(within(skills).getByRole('button', { name: /edit/i }));
    within(skills).getByRole('button', { name: 'Move skill 2 up' }).focus();
    await user.keyboard('{Enter}');
    expect(within(skills).getByText('Skill moved to position 1 of 2')).toBeInTheDocument();
    await user.click(within(skills).getByRole('button', { name: 'Add a skill group' }));
    await user.type(within(skills).getByLabelText('Group', { selector: '#resume-skills-1-category' }), 'Tools');
    const tools = within(skills).getAllByRole('group', { name: 'Skills' })[1]!;
    await user.click(within(tools).getByRole('button', { name: 'Add a skill' }));
    await user.type(within(tools).getByLabelText('Skill 1'), 'Docker, Terraform');
    await user.click(within(skills).getByRole('button', { name: 'Move Tools up' }));
    await user.click(within(skills).getByRole('button', { name: /^save$/i }));

    expect(saved().skills).toEqual([
      { category: 'Tools', skills: ['Docker', 'Terraform'] },
      { category: 'Languages', skills: ['TypeScript', 'Python'] },
    ]);
  });

  it("edits a project's keywords and bullets, and a certificate's link", async () => {
    const user = userEvent.setup();
    render(
      <ResumePanel
        initial={{ ...resume, projects: [{ name: 'Ledger' }], certificates: [{ name: 'AZ-900', issuer: 'Microsoft' }] }}
        updatedAt={null}
        resumeFileName="cv.pdf"
        hasStoredText
      />,
    );

    const projects = section('Projects');
    await user.click(within(projects).getByRole('button', { name: /edit/i }));
    await user.type(within(projects).getByLabelText('Keywords, separated by commas'), 'Go, Postgres');
    await user.click(within(projects).getByRole('button', { name: 'Add a bullet' }));
    await user.type(within(projects).getByLabelText('Bullet 1'), 'Handles 1M entries a day');
    await user.click(within(projects).getByRole('button', { name: /^save$/i }));
    expect(saved().projects).toEqual([{ name: 'Ledger', keywords: ['Go', 'Postgres'], highlights: ['Handles 1M entries a day'] }]);
    expect(await within(projects).findByText('Handles 1M entries a day')).toBeInTheDocument();

    const certificates = section('Certificates');
    await user.click(within(certificates).getByRole('button', { name: /edit/i }));
    await user.type(within(certificates).getByLabelText('Link'), 'https://learn.microsoft.com/cert');
    await user.click(within(certificates).getByRole('button', { name: /^save$/i }));
    expect(saved().certificates).toEqual([{ name: 'AZ-900', issuer: 'Microsoft', url: 'https://learn.microsoft.com/cert' }]);
  });

  it('can edit every field the PDF prints', async () => {
    // The fields the renderer reads, listed by the API's test of it (resume-printed-paths.test.ts).
    const printed = JSON.parse(readFileSync(join(__dirname, '../../../api/src/lib/resume-printed-paths.json'), 'utf8')) as string[];
    const blankResume: StructuredResume = {
      basics: { name: 'Jane Candidate', email: '', summary: '' },
      work: [],
      education: [],
      skills: [],
      projects: [],
      certificates: [],
    };
    const user = userEvent.setup();
    render(<ResumePanel initial={blankResume} updatedAt={null} resumeFileName={null} hasStoredText={false} />);

    // Each section: add one of everything, fill every field, save.
    for (const name of ['Basics', 'Experience', 'Education', 'Skills', 'Projects', 'Certificates']) {
      const region = section(name);
      await user.click(within(region).getByRole('button', { name: /edit/i }));
      const clicked = new Set<HTMLElement>();
      for (let round = 0; round < 3; round += 1) {
        for (const add of within(region).queryAllByRole('button', { name: /^add /i })) {
          if (clicked.has(add)) continue;
          clicked.add(add);
          await user.click(add);
        }
      }
      for (const field of within(region).getAllByRole('textbox')) {
        if ((field as HTMLInputElement).value) continue;
        await user.type(field, 'x');
      }
      await user.click(within(region).getByRole('button', { name: /^save$/i }));
      await waitFor(() => expect(within(region).queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument());
    }
    // The layout: a heading, a hidden section, the page size.
    const heading = screen.getByLabelText('Skills heading');
    await user.clear(heading);
    await user.type(heading, 'Toolbox{Enter}');
    await user.click(screen.getByRole('button', { name: 'Hide Projects' }));
    await user.selectOptions(screen.getByLabelText('Page size'), 'A4');

    const written = new Set<string>();
    const walk = (value: unknown, path: string) => {
      if (Array.isArray(value)) value.forEach((item) => walk(item, `${path}[]`));
      else if (value && typeof value === 'object') for (const [key, field] of Object.entries(value)) walk(field, path ? `${path}.${key}` : key);
      else if (value !== undefined && value !== '') written.add(path);
    };
    for (const [body] of saveBaseResume.mock.calls) walk(body, '');
    for (const [body] of saveResumeLayout.mock.calls) walk(body, 'layout');
    expect(printed.length).toBeGreaterThan(30);
    expect(printed.filter((path) => !written.has(path))).toEqual([]);
  });

  it('shows the sections in their saved order, and the PDF preview', () => {
    const layout: ResumeLayout = { sections: [{ key: 'education' }, { key: 'skills', title: 'Technical Skills' }] };
    render(<ResumePanel initial={{ ...resume, layout }} updatedAt={null} resumeFileName="cv.pdf" hasStoredText />);
    const sections = screen.getByRole('region', { name: 'Sections' });
    expect(within(sections).getAllByRole('textbox').map((field) => (field as HTMLInputElement).value).slice(0, 2)).toEqual([
      'Education',
      'Technical Skills',
    ]);
    expect(screen.getByRole('button', { name: 'Preview PDF' })).toBeEnabled();
  });

  it('offers no layout or PDF before there is a résumé', () => {
    render(<ResumePanel initial={null} updatedAt={null} resumeFileName={null} hasStoredText={false} />);
    expect(screen.getByRole('button', { name: 'Preview PDF' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
  });
});
