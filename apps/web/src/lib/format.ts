const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A date-only value ("2026-10-01") is that day where the user is: `new Date()` reads it as UTC
 * midnight, the day before in the Americas.
 */
function parseDate(value: string): Date {
  const parts = DATE_ONLY.exec(value);
  if (!parts) return new Date(value);
  const [year, month, day] = [Number(parts[1]), Number(parts[2]) - 1, Number(parts[3])];
  const date = new Date(year, month, day);
  // `new Date(y, m, d)` rolls a day that doesn't exist over ("2026-02-30" is Mar 2): it's no date.
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : new Date(NaN);
}

/** In the runtime's time zone: on a page, render it with `<LocalDate>`, after hydration. */
export function formatDate(value: string | undefined, fallback = 'Not set'): string {
  if (!value) {
    return fallback;
  }

  const date = parseDate(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export function formatCompactDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function toDatetimeLocalValue(value: string | undefined): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

export function fromDatetimeLocalValue(value: string): string {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString();
}
