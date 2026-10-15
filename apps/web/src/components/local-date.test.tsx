import '@testing-library/jest-dom/vitest';
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

it('says when there is no date', async () => {
  const date = <LocalDate value={undefined} fallback="unknown date" />;
  const { container } = await hydrateInBrowser(renderOnServer(date), date);
  expect(container).toHaveTextContent('unknown date');
});
