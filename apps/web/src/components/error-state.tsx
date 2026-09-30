'use client';

import { AlertCircle, RotateCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ErrorStateProps = {
  /** What didn't happen, e.g. "Couldn't score this job". */
  title: string;
  /** Why, in the API's own words (ApiRequestError.message). */
  message?: string | null;
  /** Try the action again. Without it, "Try again" reloads the page's data. */
  onRetry?: () => void;
  className?: string;
};

/**
 * A failure shown where it happened, with the reason and a way to try again (#349). It
 * replaces transient toasts, and the sample data pages used to show when the API failed.
 */
export function ErrorState({ title, message, onRetry, className }: ErrorStateProps) {
  const router = useRouter();

  return (
    <div
      role="alert"
      className={cn('border-destructive/40 bg-destructive/5 flex items-start gap-3 rounded-lg border p-3', className)}
    >
      <AlertCircle className="text-destructive mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-2">
        <div>
          <p className="text-sm font-medium">{title}</p>
          {message ? <p className="text-muted-foreground text-sm">{message}</p> : null}
        </div>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => (onRetry ? onRetry() : router.refresh())}>
          <RotateCw className="size-3.5" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </div>
  );
}
