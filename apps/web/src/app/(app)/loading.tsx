import { Skeleton } from '@/components/ui/skeleton';

/**
 * Group-level loading fallback for every authed route that doesn't ship its own
 * loading.tsx (dashboard, /assistant, /settings, …). Without it those routes
 * showed a blank frame during data fetches.
 */
export default function AppLoading() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
