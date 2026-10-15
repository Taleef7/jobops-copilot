'use client';

import { useHydrated } from '@/hooks/use-hydrated';
import { formatDate } from '@/lib/format';

/**
 * A date in the browser's time zone, after hydration (#412). The server renders in UTC, where from
 * 8 pm in New York it's already tomorrow: another day on the page, and a hydration error.
 */
export function LocalDate({ value, fallback }: { value: string | null | undefined; fallback?: string }) {
  const hydrated = useHydrated();
  if (!value) return formatDate(undefined, fallback);
  return (
    <time dateTime={value} className="tabular-nums">
      {hydrated ? (
        formatDate(value, fallback)
      ) : (
        <>
          {/* About a date's width, so the line moves less when the date comes. */}
          <span aria-hidden="true" className="inline-block min-w-[10ch]">
            …
          </span>
          <span className="sr-only">Loading date</span>
        </>
      )}
    </time>
  );
}
