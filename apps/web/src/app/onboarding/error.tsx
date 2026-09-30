'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Onboarding sits outside the app layout, so the app's error boundary doesn't cover it.
 * A crash here left a dead end; now it offers a retry, or a skip since setup is optional
 * (#349).
 */
export default function OnboardingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="bg-background flex min-h-screen items-center justify-center px-4">
      <Card role="alert" className="max-w-md items-center gap-3 p-8 text-center">
        <h1 className="font-heading text-lg font-semibold">Setup didn&apos;t load</h1>
        <p className="text-muted-foreground text-sm">
          Try again, or skip setup for now. You can add your resume later in Settings.
        </p>
        <div className="flex gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button render={<Link href="/dashboard" />} variant="outline">
            Skip for now
          </Button>
        </div>
      </Card>
    </main>
  );
}
