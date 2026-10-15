import { expect, it } from 'vitest';
import { formatDate, postedDay } from './format';

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

// A posting date is a day: date_posted is timestamptz, so a source that gives only the day reaches
// the web as UTC midnight, the evening before in New York.
it('reads a posting date at exactly UTC midnight as that day', () => {
  expect(formatDate(postedDay('2026-06-01T00:00:00.000Z'))).toBe('Jun 1, 2026');
  expect(formatDate(postedDay('2026-06-01T00:00:00Z'))).toBe('Jun 1, 2026');
});

it('keeps any other posting time as the instant it is', () => {
  expect(postedDay('2026-06-01T00:00:01.000Z')).toBe('2026-06-01T00:00:01.000Z');
  expect(formatDate(postedDay('2026-06-01T01:30:00.000Z'))).toBe('May 31, 2026');
  expect(postedDay(undefined)).toBeUndefined();
  expect(postedDay('not a date')).toBe('not a date');
});
