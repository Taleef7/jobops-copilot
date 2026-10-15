import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const { auth } = vi.hoisted(() => ({
  auth: vi.fn(async (): Promise<{ userId: string | null }> => ({ userId: null })),
}));
vi.mock('@clerk/nextjs/server', () => ({ auth }));
// Clerk's SignInButton opens sign-in when its child is clicked. The mock marks where it wraps
// so a test can tell a working Sign in from a plain, dead button.
vi.mock('@clerk/nextjs', () => ({
  SignInButton: ({ children, mode }: { children: React.ReactNode; mode?: string }) => (
    <span data-clerk="sign-in" data-mode={mode}>
      {children}
    </span>
  ),
  SignUpButton: ({ children }: { children: React.ReactNode }) => children,
  UserButton: () => <div data-testid="user-button" />,
}));
vi.mock('@/components/mode-toggle', () => ({ ModeToggle: () => <div data-testid="mode-toggle" /> }));

import LandingPage from './(marketing)/page';
import MarketingLayout from './(marketing)/layout';

afterEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ userId: null });
});

// The words #356 takes off the public pages: claims, and talk about how it's built.
const CLAIMS =
  /\bRAG\b|telemetry|verified|guaranteed|100%|\bzero\b|AI-powered|LangChain|pgvector|\bagents?\b|operations|time-series|portfolio|hallucinat/i;

async function renderLanding() {
  const page = await LandingPage();
  const layout = await MarketingLayout({ children: page });
  return render(layout);
}

// #356: the product in one sentence, from docs/SPEC.md, as the page's only heading claim.
it('says what the product does in the one sentence from the spec', async () => {
  await renderLanding();

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Tell me in 10 seconds if a job is worth applying to, give me an honest tailored résumé, and never let me miss a follow-up.',
  );
});

// Each step names something in the app today: Add job, Score fit on the job page, Resume studio.
it('shows three short steps: add a job, the fit, then the résumé and follow-ups', async () => {
  await renderLanding();

  const steps = within(screen.getByRole('list', { name: /how it works/i })).getAllByRole('listitem');
  expect(steps).toHaveLength(3);
  expect(steps[0]).toHaveTextContent(/add a job/i);
  expect(steps[0]).toHaveTextContent(
    'Paste the posting and fill in the company and title, or paste its URL and press Autofill. Then save.',
  );
  expect(steps[1]).toHaveTextContent(/score fit/i);
  expect(steps[2]).toHaveTextContent(/résumé/i);
  expect(steps[2]).toHaveTextContent(/follow-up/i);
});

it('offers a sign-in button to a signed-out visitor that opens Clerk sign-in', async () => {
  await renderLanding();

  const signIn = within(screen.getByRole('main')).getByRole('button', { name: 'Sign in' });
  expect(signIn.closest('[data-clerk="sign-in"]')).toHaveAttribute('data-mode', 'modal');
  // The header's Sign in is wired the same way.
  const headerSignIn = within(screen.getByRole('banner')).getByRole('button', { name: 'Sign in' });
  expect(headerSignIn.closest('[data-clerk="sign-in"]')).toHaveAttribute('data-mode', 'modal');
});

it('links a signed-in visitor into the app instead of offering sign-in', async () => {
  auth.mockResolvedValue({ userId: 'user_1' });
  await renderLanding();

  const main = screen.getByRole('main');
  expect(within(main).queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  expect(within(main).getByRole('link', { name: /open dashboard/i })).toHaveAttribute('href', '/dashboard');
});

it('makes no claims and does not describe how the app is built', async () => {
  const { container } = await renderLanding();

  expect(container.textContent).not.toMatch(CLAIMS);
});

// Design critique on #356: no gradient hero or CTA banner, no hover lift, no badge, no feature grid.
it('has no gradients, hover lift, badge or feature grid', async () => {
  const { container } = await renderLanding();

  expect(container.querySelector('[class*="gradient"]')).toBeNull();
  expect(container.querySelector('[class*="hover:-translate"]')).toBeNull();
  expect(container.querySelector('[data-slot="badge"]')).toBeNull();
  expect(container.querySelector('#features')).toBeNull();
  expect(screen.queryByRole('link', { name: /features/i })).not.toBeInTheDocument();
});

it('has no Features link in the header and a footer that reads "© JobOps"', async () => {
  await renderLanding();

  expect(screen.getByRole('banner').querySelector('a[href="/#features"]')).toBeNull();
  expect(within(screen.getByRole('banner')).queryByText(/features/i)).not.toBeInTheDocument();
  expect(screen.getByRole('contentinfo')).toHaveTextContent(/^© JobOps$/);
});
