'use client';

import { useHydrated } from '@/hooks/use-hydrated';
import { formatDate } from '@/lib/format';

/**
 * A date in the browser's time zone, after hydration (#412). The server renders in UTC, where from
 * 8 pm in New York it's already tomorrow: another day on the page, and a hydration error.
 */
export function LocalDate({ value, fallback }: { value: string | null | undefined; fallback?: string }) {
  const hydrated = useHydrated();
  return hydrated ? formatDate(value ?? undefined, fallback) : '…';
}
