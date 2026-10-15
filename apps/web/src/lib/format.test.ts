import { expect, it } from 'vitest';
import { formatDate } from './format';

// The tests run in New York (vitest.config.mts), where 1:30 am UTC on Oct 15 is 9:30 pm on Oct 14.
it('formats a timestamp in the time zone it runs in', () => {
  expect(formatDate('2026-10-15T01:30:00.000Z')).toBe('Oct 14, 2026');
});

// #412: `new Date('2026-10-01')` is UTC midnight, the evening of Sep 30 in New York.
it('formats a date-only value as that day, not the day before', () => {
  expect(formatDate('2026-10-01')).toBe('Oct 1, 2026');
});

it('says "Not set" for a day that does not exist, rather than rolling it over', () => {
  expect(formatDate('2026-02-30')).toBe('Not set');
  expect(formatDate('2026-13-01')).toBe('Not set');
});
