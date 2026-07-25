import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const { saveResumeText, uploadResumeFile, createSavedSearch, runDiscovery } = vi.hoisted(() => ({
  saveResumeText: vi.fn(() => Promise.resolve(null)),
  uploadResumeFile: vi.fn(() => Promise.resolve(null)),
  createSavedSearch: vi.fn(() => Promise.resolve({ id: 's1' })),
  runDiscovery: vi.fn(() => Promise.resolve({ inserted: 3, skipped: 0, source: 'adzuna' })),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock('@/lib/api', () => ({ saveResumeText, uploadResumeFile, createSavedSearch, runDiscovery }));
// The step-1 escape hatch renders a real Clerk button, which needs a provider.
vi.mock('@clerk/nextjs', () => ({
  SignOutButton: ({ children }: { children: React.ReactNode }) => children,
}));

import OnboardingPage from './page';

afterEach(() => {
  vi.clearAllMocks();
});

it('shows an inline alert (in addition to the toast) when continuing with no resume', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(screen.getByRole('button', { name: /continue/i }));

  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/add your resume to continue/i);
});

it('advances to the target-roles step after a resume is saved, then discovers and routes to jobs', async () => {
  const user = userEvent.setup();
  render(<OnboardingPage />);

  await user.click(screen.getByRole('tab', { name: /paste text/i }));
  await user.type(screen.getByPlaceholderText(/paste your resume text/i), 'Senior TypeScript engineer.');
  await user.click(screen.getByRole('button', { name: /continue/i }));

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
  await user.click(screen.getByRole('button', { name: /continue/i }));

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
  await user.click(screen.getByRole('button', { name: /continue/i }));

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
  await user.click(screen.getByRole('button', { name: /continue/i }));

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
