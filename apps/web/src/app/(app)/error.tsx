'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Group-level error boundary for the authed app. Previously only /jobs had one,
 * so an uncaught render/data error on the dashboard, /assistant or /settings
 * fell through to Next's default error page. Renders as an alert with a recovery
 * path (retry, or bail to the dashboard).
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the digest in the browser console for support/debugging.
    console.error(error);
  }, [error]);

  return (
    <Card
      role="alert"
      className="mx-auto max-w-md items-center gap-3 p-8 text-center"
    >
      <h2 className="font-heading text-lg font-semibold">Something went wrong</h2>
      <p className="text-muted-foreground text-sm">
        {error.message || 'An unexpected error occurred.'}
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button render={<Link href="/dashboard">Dashboard</Link>} variant="outline" />
      </div>
    </Card>
  );
}
