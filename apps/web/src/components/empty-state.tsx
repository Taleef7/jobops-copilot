import { Inbox } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export function EmptyState({
  title,
  description,
  actionLabel,
  actionHref,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  /** Render the action as a link. Ignored when `onAction` is provided. */
  actionHref?: string;
  /** Render the action as a button that runs this handler (e.g. reset filters). */
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
      <span className="bg-muted text-muted-foreground mb-3 flex size-12 items-center justify-center rounded-full">
        <Inbox className="size-6" />
      </span>
      <h2 className="font-heading text-base font-semibold">{title}</h2>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>
      {actionLabel && onAction ? (
        <Button onClick={onAction} variant="outline" size="sm" className="mt-4">
          {actionLabel}
        </Button>
      ) : actionLabel && actionHref ? (
        <Button
          render={<Link href={actionHref}>{actionLabel}</Link>}
          variant="outline"
          size="sm"
          className="mt-4"
        />
      ) : null}
    </div>
  );
}
