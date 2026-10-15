import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs', () => ({
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  SignUpButton: ({ children }: { children: React.ReactNode }) => children,
  UserButton: () => <div data-testid="user-button" />,
}));
vi.mock('@/components/mode-toggle', () => ({ ModeToggle: () => <div data-testid="mode-toggle" /> }));

import { MarketingMobileNav } from './marketing-mobile-nav';

// #356: the landing page has no features section, so the menu has no link to one.
it('has no Features link in the mobile menu', async () => {
  const user = userEvent.setup();
  render(<MarketingMobileNav signedIn={false} />);

  await user.click(screen.getByRole('button', { name: /open navigation menu/i }));

  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /features/i })).not.toBeInTheDocument();
  expect(document.querySelector('a[href="/#features"]')).toBeNull();
});
