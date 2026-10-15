import '@testing-library/jest-dom/vitest';
import { within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { hydrateInBrowser, renderOnServer } from '@/test/time-zones';
import { LocalDate } from './local-date';

// #412: 1:30 am UTC on Oct 15 is 9:30 pm on Oct 14 in New York, the browser's zone in these tests.
it("leaves the day to the browser: the server's zone can put it on another", async () => {
  const date = (
    <p>
      Posted <LocalDate value="2026-10-15T01:30:00.000Z" />
    </p>
  );
  const html = renderOnServer(date);
  expect(html).not.toContain('Oct 15');

  const { container, hydrationErrors } = await hydrateInBrowser(html, date);
  expect(hydrationErrors).not.toHaveBeenCalled();
  expect(container).toHaveTextContent('Posted Oct 14, 2026');
});

it('is a <time>, and until hydration says the date is loading, out loud only', async () => {
  const date = <LocalDate value="2026-10-15T01:30:00.000Z" />;
  const html = renderOnServer(date);
  const server = document.createElement('div');
  server.innerHTML = html;
  const time = server.querySelector('time');
  expect(time).toHaveAttribute('datetime', '2026-10-15T01:30:00.000Z');
  expect(time).toHaveClass('tabular-nums');
  expect(within(server).getByText('…')).toHaveAttribute('aria-hidden', 'true');
  expect(within(server).getByText('Loading date')).toHaveClass('sr-only');

  const { container } = await hydrateInBrowser(html, date);
  expect(container.querySelector('time')).toHaveTextContent('Oct 14, 2026');
  expect(within(container).queryByText('Loading date')).not.toBeInTheDocument();
});

it('says when there is no date, with nothing to wait for', () => {
  expect(renderOnServer(<LocalDate value={undefined} fallback="unknown date" />)).toBe('unknown date');
  expect(renderOnServer(<LocalDate value={null} />)).toBe('Not set');
});
