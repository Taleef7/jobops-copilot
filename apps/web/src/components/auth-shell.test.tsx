import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AuthShell } from './auth-shell';

// #356: the sign-in and sign-up pages carry the product's name, without an "AI Operations" tagline.
it('shows the name alone above the sign-in form', () => {
  render(
    <AuthShell>
      <div data-testid="clerk-form" />
    </AuthShell>,
  );

  expect(screen.getByRole('link', { name: 'JobOps Copilot home' })).toHaveTextContent(/^JobOps Copilot$/);
  expect(screen.queryByText(/operations/i)).not.toBeInTheDocument();
  expect(screen.getByTestId('clerk-form')).toBeInTheDocument();
});
