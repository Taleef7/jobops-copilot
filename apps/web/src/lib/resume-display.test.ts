import { describe, expect, it } from 'vitest';
import { formatResumeDate, formatResumeRange, isResumeEmpty } from './resume-display';

describe('résumé display (#350)', () => {
  it('shows a stored date as month and year', () => {
    expect(formatResumeDate('2026-05-01')).toBe('May 2026');
    expect(formatResumeDate('2025-09')).toBe('Sep 2025');
    expect(formatResumeDate('2024')).toBe('2024');
  });

  it('shows anything else as written, and nothing for nothing', () => {
    expect(formatResumeDate('Summer 2023')).toBe('Summer 2023');
    expect(formatResumeDate('')).toBe('');
    expect(formatResumeDate(undefined)).toBe('');
  });

  it('shows a range, with Present for a current or open-ended role', () => {
    expect(formatResumeRange('2025-09-01', '2026-05-01')).toBe('Sep 2025 – May 2026');
    expect(formatResumeRange('2026-05-01', undefined)).toBe('May 2026 – Present');
    expect(formatResumeRange('2026-05-01', 'Present')).toBe('May 2026 – Present');
    expect(formatResumeRange('', '')).toBe('');
    expect(formatResumeRange('', '2019-05-20')).toBe('May 2019');
  });

  it('knows an empty résumé', () => {
    expect(isResumeEmpty(null)).toBe(true);
    expect(
      isResumeEmpty({ basics: { name: '', email: '', summary: '' }, work: [], education: [], skills: [] }),
    ).toBe(true);
    expect(
      isResumeEmpty({ basics: { name: 'Jane', email: '', summary: '' }, work: [], education: [], skills: [] }),
    ).toBe(false);
  });
});
