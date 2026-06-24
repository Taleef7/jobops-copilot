import { describe, expect, it } from 'vitest';
import { isWithinRecency, RECENCY_OPTIONS } from './job-recency';

const NOW = Date.parse('2026-06-24T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe('isWithinRecency', () => {
  it('keeps everything for the "all" window', () => {
    expect(isWithinRecency({ discoveredAt: hoursAgo(1000) }, 'all', NOW)).toBe(true);
  });

  it('uses datePosted when present, falling back to discoveredAt', () => {
    expect(isWithinRecency({ datePosted: hoursAgo(2), discoveredAt: hoursAgo(500) }, '24h', NOW)).toBe(true);
    expect(isWithinRecency({ discoveredAt: hoursAgo(2) }, '24h', NOW)).toBe(true);
  });

  it('excludes postings older than the window', () => {
    expect(isWithinRecency({ datePosted: hoursAgo(25) }, '24h', NOW)).toBe(false);
    expect(isWithinRecency({ datePosted: hoursAgo(24 * 4) }, '3d', NOW)).toBe(false);
    expect(isWithinRecency({ datePosted: hoursAgo(24 * 6) }, '7d', NOW)).toBe(true);
  });

  it('excludes rows with no usable date (except for "all")', () => {
    expect(isWithinRecency({}, '24h', NOW)).toBe(false);
    expect(isWithinRecency({ datePosted: 'not-a-date' }, '24h', NOW)).toBe(false);
    expect(isWithinRecency({}, 'all', NOW)).toBe(true);
  });

  it('exposes selectable options with an "all" default first', () => {
    expect(RECENCY_OPTIONS[0]).toEqual({ value: 'all', label: 'Any time' });
    expect(RECENCY_OPTIONS.map((o) => o.value)).toEqual(['all', '24h', '3d', '7d']);
  });
});
