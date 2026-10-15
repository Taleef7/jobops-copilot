import { expect, it } from 'vitest';
import { hydrateInBrowser, renderOnServer } from './time-zones';

// React recovers from a different text, but only logs a different attribute and keeps the server's.
it('counts an attribute the server and the browser render differently as a hydration error', async () => {
  const Offset = () => <span title={String(new Date('2026-10-15T00:00:00Z').getTimezoneOffset())}>offset</span>;
  const { hydrationErrors } = await hydrateInBrowser(renderOnServer(<Offset />), <Offset />);
  expect(hydrationErrors).toHaveBeenCalled();
});
