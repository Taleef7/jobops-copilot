import type { StructuredResume } from '@/types/job';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-05-01" or "2026-05" → "May 2026", "2024" → "2024"; anything else as written. */
export function formatResumeDate(value: string | undefined | null): string {
  const text = (value ?? '').trim();
  const match = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(text);
  if (!match) return text;
  if (!match[2]) return match[1]!;
  // A month or day out of range is shown as typed, so the mistake stays visible.
  const month = MONTHS[Number(match[2]) - 1];
  if (!month || (match[3] !== undefined && (Number(match[3]) < 1 || Number(match[3]) > 31))) return text;
  return `${month} ${match[1]}`;
}

const isOpenEnded = (end: string) => !end || /^(present|current|now)$/i.test(end);

/** "Sep 2025 – May 2026"; an empty or "Present" end reads "Present". */
export function formatResumeRange(start?: string, end?: string, current?: boolean): string {
  const from = formatResumeDate(start);
  const rawEnd = (end ?? '').trim();
  if (!from) return formatResumeDate(rawEnd);
  return `${from} – ${current || isOpenEnded(rawEnd) ? 'Present' : formatResumeDate(rawEnd)}`;
}

/** Nothing worth showing yet: no name and no entries in any section. */
export function isResumeEmpty(resume: StructuredResume | null | undefined): boolean {
  if (!resume) return true;
  return (
    !resume.basics.name.trim() &&
    resume.work.length === 0 &&
    resume.education.length === 0 &&
    resume.skills.length === 0 &&
    (resume.projects ?? []).length === 0 &&
    (resume.certificates ?? []).length === 0
  );
}

/** Typing a real end date ends a role the parse marked current (#350). */
export function withEndDate<T extends { endDate?: string; current?: boolean }>(item: T, endDate: string): T {
  const ended = endDate.trim() !== '' && !isOpenEnded(endDate.trim());
  return { ...item, endDate, current: ended ? false : item.current };
}
