import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import NotFound from './not-found';

// #349: an unknown address gets a page in the app's own look with a way back, not Next's bare 404.
it('says the page does not exist and links back to the pipeline', () => {
  render(<NotFound />);

  expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /go to your pipeline/i })).toHaveAttribute('href', '/jobs');
});
