import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { SkipLink } from './skip-link';

it('links to the main-content landmark', () => {
  render(<SkipLink />);
  const link = screen.getByRole('link', { name: /skip to main content/i });
  expect(link).toHaveAttribute('href', '#main-content');
});

it('is visually hidden until focused', () => {
  render(<SkipLink />);
  const link = screen.getByRole('link', { name: /skip to main content/i });
  // sr-only keeps it out of the visual flow; focus:not-sr-only reveals it.
  expect(link).toHaveClass('sr-only');
  expect(link.className).toContain('focus:not-sr-only');
});
