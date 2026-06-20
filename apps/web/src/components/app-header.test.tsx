import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
let pathname = '/dashboard';
let search = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock('@clerk/nextjs', () => ({ UserButton: () => <div data-testid="user-button" /> }));
vi.mock('@/components/ui/sidebar', () => ({ SidebarTrigger: () => <button type="button">sidebar</button> }));
vi.mock('@/components/mode-toggle', () => ({ ModeToggle: () => <div data-testid="mode-toggle" /> }));

import { AppHeader } from './app-header';

afterEach(() => {
  vi.clearAllMocks();
  pathname = '/dashboard';
  search = '';
});

it('navigates to /jobs with the query when the search is submitted', async () => {
  const user = userEvent.setup();
  render(<AppHeader />);

  const input = screen.getByRole('searchbox', { name: /search/i });
  await user.type(input, 'acme robotics{Enter}');

  expect(push).toHaveBeenCalledWith('/jobs?q=acme+robotics');
});

it('does not navigate when the query is empty/whitespace', async () => {
  const user = userEvent.setup();
  render(<AppHeader />);

  const input = screen.getByRole('searchbox', { name: /search/i });
  await user.type(input, '   {Enter}');

  expect(push).not.toHaveBeenCalled();
});

it('pre-fills the input from ?q= when already on /jobs', () => {
  pathname = '/jobs';
  search = 'q=backend';
  render(<AppHeader />);

  expect(screen.getByRole('searchbox', { name: /search/i })).toHaveValue('backend');
});
