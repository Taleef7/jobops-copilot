import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const PARSED = {
  basics: { name: 'Ava Tester', email: 'ava@example.com', summary: '' },
  work: [{ company: 'Medical Informatics Engineering', position: 'Software Developer', startDate: '2026-05-01', highlights: [] }],
  education: [],
  skills: [],
};
const { saveResumeText, uploadResumeFile, createSavedSearch, runDiscovery, parseResume, saveBaseResume } = vi.hoisted(() => ({
  saveResumeText: vi.fn(() => Promise.resolve(null)),
  uploadResumeFile: vi.fn((): Promise<unknown> => Promise.resolve({ profile: null, resumeText: 'TEXT READ FROM PDF' })),
  createSavedSearch: vi.fn(() => Promise.resolve({ id: 's1' })),
  runDiscovery: vi.fn(() => Promise.resolve({ inserted: 3, skipped: 0, source: 'adzuna' })),
  parseResume: vi.fn((): Promise<unknown> => Promise.resolve({ structuredResume: PARSED, flags: [] })),
  saveBaseResume: vi.fn((resume: unknown) => Promise.resolve(resume)),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
const { ApiRequestError } = vi.hoisted(() => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(message: string, public status: number) {
      super(message);
    }
  },
}));
vi.mock('@/lib/api', () => ({
  ApiRequestError,
  saveResumeText,
  uploadResumeFile,
  createSavedSearch,
  runDiscovery,
  parseResume,
  saveBaseResume,
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
}));
// The step-1 escape hatch renders a real Clerk button, which needs a provider.
vi.mock('@clerk/nextjs', () => ({
  SignOutButton: ({ children }: { children: React.ReactNode }) => children,
}));

import OnboardingPage from './page';

afterEach(() => {
  vi.clearAllMocks();
});

/** Step 1 now checks what was read (#350): Continue, then "Looks right". */
async function continueWithResume(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await user.click(await screen.findByRole('button', { name: /looks right/i }));
}

it('shows an inline alert (in addition to the toast) when continuing with no resume', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(screen.getByRole('button', { name: /continue/i }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/add your resume to continue/i);
  // and Continue works again once there's something to send
  expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
});

it('advances to the target-roles step after a resume is saved, then discovers and routes to jobs', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Senior TypeScript engineer.');
  await continueWithResume(user);

  const roleInput = await screen.findByLabelText(/role or keywords/i);
  await user.type(roleInput, 'AI Engineer');
  await user.click(screen.getByRole('button', { name: /find matching jobs/i }));

  await waitFor(() => expect(createSavedSearch).toHaveBeenCalledWith({
    query: 'AI Engineer',
    location: undefined,
    remoteOnly: false,
  }));
  expect(runDiscovery).toHaveBeenCalledOnce();
  await waitFor(() => expect(push).toHaveBeenCalledWith('/jobs'));
});

it('requires a role/keyword before discovering on step 2', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Engineer.');
  await continueWithResume(user);

  await screen.findByLabelText(/role or keywords/i);
  await user.click(screen.getByRole('button', { name: /find matching jobs/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/add at least one role or keyword/i);
  expect(createSavedSearch).not.toHaveBeenCalled();
});

it('treats a "Remote" location as remote-only (the source ignores it as a place)', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Engineer.');
  await continueWithResume(user);

  await user.type(await screen.findByLabelText(/role or keywords/i), 'AI Engineer');
  await user.type(screen.getByLabelText(/^location$/i), 'Remote');
  await user.click(screen.getByRole('button', { name: /find matching jobs/i }));

  await waitFor(() =>
    expect(createSavedSearch).toHaveBeenCalledWith({
      query: 'AI Engineer',
      location: undefined,
      remoteOnly: true,
    }),
  );
});

it('lets the user skip discovery and go to the dashboard', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Engineer.');
  await continueWithResume(user);

  await screen.findByLabelText(/role or keywords/i);
  await user.click(screen.getByRole('button', { name: /skip for now/i }));

  expect(createSavedSearch).not.toHaveBeenCalled();
  await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
});


// --- step 1: file intake -----------------------------------------------------

function dropFile(file: File) {
  const dropzone = screen.getByText(/drop or choose your resume pdf/i).closest('label');
  if (!dropzone) throw new Error('dropzone not found');
  // jsdom has no DataTransfer, so hand fireEvent the shape the handler reads.
  fireEvent.drop(dropzone, { dataTransfer: { files: [file] } });
}

function pdfFile(name = 'resume.pdf', size = 1024) {
  const file = new File(['%PDF-1.4'], name, { type: 'application/pdf' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

it('tells the user which step of the flow they are on', () => {
  render(<OnboardingPage />);
  expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
});

it('offers a way out instead of trapping the user on step 1', () => {
  // A resume is required to pass this step and the app redirects here until a
  // profile exists, so without an escape a PDF that will not parse locks
  // someone out of the product entirely.
  render(<OnboardingPage />);
  expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
});

it('accepts a dropped PDF', () => {
  // The copy promised "Drop or choose your resume PDF" but the label carried no
  // drag handlers, so dropping a file made the browser navigate away to render
  // the PDF and the half-finished onboarding was lost.
  render(<OnboardingPage />);
  dropFile(pdfFile('ava-resume.pdf'));
  expect(screen.getByText('ava-resume.pdf')).toBeInTheDocument();
});

it('rejects a dropped non-PDF and says what to do instead', () => {
  render(<OnboardingPage />);
  dropFile(new File(['x'], 'notes.docx', { type: 'application/msword' }));

  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('notes.docx');
  expect(alert).toHaveTextContent(/paste text/i);
});

it('rejects a file over the 5 MB API limit and reports the actual size', () => {
  render(<OnboardingPage />);
  dropFile(pdfFile('huge.pdf', 6 * 1024 * 1024));

  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('6.0 MB');
  expect(alert).toHaveTextContent(/limit is 5 MB/i);
});

it('shows why an upload was refused, from the API (#389)', async () => {
  uploadResumeFile.mockRejectedValueOnce(new ApiRequestError('Upload your résumé as a PDF, or paste its text.', 415));
  const user = userEvent.setup();
  render(<OnboardingPage />);

  dropFile(pdfFile('photo.pdf'));
  await user.click(screen.getByRole('button', { name: /continue/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Upload your résumé as a PDF, or paste its text.');
});

it('lets a user recover by pasting after a PDF upload fails', async () => {
  // The failure message tells the user to switch to "Paste text". That advice
  // was previously a dead end: `pendingFile` stayed set, so saveResume kept
  // preferring uploadResumeFile and retried the same broken PDF forever.
  uploadResumeFile.mockRejectedValueOnce(new Error('unparseable pdf'));
  const user = userEvent.setup();
  render(<OnboardingPage />);

  dropFile(pdfFile('broken.pdf'));
  await user.click(screen.getByRole('button', { name: /continue/i }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/paste text/i);

  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Ava Tester — AI engineer');
  await user.click(screen.getByRole('button', { name: /continue/i }));

  await waitFor(() => expect(saveResumeText).toHaveBeenCalledWith('Ava Tester — AI engineer'));
  // and crucially: the broken file was not retried
  expect(uploadResumeFile).toHaveBeenCalledTimes(1);
});

// --- step 1: check what was read (#350) ---------------------------------------

it('shows what was read from the PDF and saves the résumé only on "Looks right"', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  dropFile(pdfFile('cv.pdf'));
  await user.click(screen.getByRole('button', { name: /continue/i }));

  expect(await screen.findByText('Check what we read')).toBeInTheDocument();
  expect(screen.getByText('Software Developer at Medical Informatics Engineering · May 2026 – Present')).toBeInTheDocument();
  expect(parseResume).toHaveBeenCalledWith('TEXT READ FROM PDF');
  expect(saveBaseResume).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: /looks right/i }));
  expect(saveBaseResume).toHaveBeenCalledWith(PARSED);
  expect(await screen.findByLabelText(/role or keywords/i)).toBeInTheDocument();
});

it('reads pasted text as typed', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Ava Tester, engineer.');
  await user.click(screen.getByRole('button', { name: /continue/i }));

  await screen.findByText('Check what we read');
  expect(parseResume).toHaveBeenCalledWith('Ava Tester, engineer.');
});

it('when the résumé can\'t be read, says why and lets the user retry or skip', async () => {
  parseResume.mockRejectedValueOnce(new Error("The AI couldn't be reached. Try again in a moment."));
  const user = userEvent.setup();
  render(<OnboardingPage />);

  dropFile(pdfFile('cv.pdf'));
  await user.click(screen.getByRole('button', { name: /continue/i }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent("Couldn't read your résumé");
  expect(alert).toHaveTextContent("The AI couldn't be reached.");

  await user.click(screen.getByRole('button', { name: /skip for now/i }));
  expect(await screen.findByLabelText(/role or keywords/i)).toBeInTheDocument();
  expect(saveBaseResume).not.toHaveBeenCalled();
});

it('cancelling the check goes back to the résumé step without saving it', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  dropFile(pdfFile('cv.pdf'));
  await user.click(screen.getByRole('button', { name: /continue/i }));
  await user.click(await screen.findByRole('button', { name: /cancel/i }));

  expect(screen.getByRole('tab', { name: /upload pdf/i })).toBeInTheDocument();
  expect(saveBaseResume).not.toHaveBeenCalled();
});
