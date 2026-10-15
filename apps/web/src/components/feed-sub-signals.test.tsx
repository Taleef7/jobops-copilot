import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FeedSubSignals } from './feed-sub-signals';

// #354: a signal nobody measured is "unknown", not 0% (or the 50% the API used to fill in).
it('shows an unknown signal as "unknown" with no percentage', () => {
  const { container } = render(
    <FeedSubSignals
      subSignals={{ skillsMatch: 67, titleSeniority: null, salaryFit: null, sponsorshipLikelihood: null }}
    />,
  );

  expect(screen.getByText('67%')).toBeInTheDocument();
  expect(screen.getAllByText('unknown')).toHaveLength(3);
  expect(container).not.toHaveTextContent('0%');
  expect(container).not.toHaveTextContent('unknown%');
});
